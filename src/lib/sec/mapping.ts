/**
 * Pure SEC EDGAR mapping helpers — no network, no database.
 */
import { SEC_FORMS, SEC_METRICS, filingUrl, type MappingConfidence } from "./constants";

export type SecFiling = {
  form: string;
  filingDate: string | null;
  reportDate: string | null;
  acceptedAt: string | null;
  accessionNumber: string;
  primaryDocument: string | null;
  url: string;
};

type RecentBlock = Record<string, unknown[]>;

/** SEC returns submissions.filings.recent as parallel arrays. */
export function parseSubmissions(
  payload: unknown,
  cik: string,
): {
  name: string | null;
  tickers: string[];
  exchanges: string[];
  sic: string | null;
  filings: SecFiling[];
} {
  const root = (payload ?? {}) as Record<string, unknown>;
  const filingsRoot = (root["filings"] ?? {}) as Record<string, unknown>;
  const recent = (filingsRoot["recent"] ?? {}) as RecentBlock;

  const get = (k: string): unknown[] => (Array.isArray(recent[k]) ? (recent[k] as unknown[]) : []);
  const forms = get("form");
  const out: SecFiling[] = [];

  for (let i = 0; i < forms.length; i += 1) {
    const form = String(forms[i] ?? "");
    if (!SEC_FORMS.includes(form as (typeof SEC_FORMS)[number])) continue;
    const accession = String(get("accessionNumber")[i] ?? "");
    if (!accession) continue;
    const primaryDoc = get("primaryDocument")[i];
    out.push({
      form,
      filingDate: str(get("filingDate")[i]),
      reportDate: str(get("reportDate")[i]),
      acceptedAt: str(get("acceptanceDateTime")[i]),
      accessionNumber: accession,
      primaryDocument: str(primaryDoc),
      url: filingUrl(cik, accession, str(primaryDoc)),
    });
  }

  const tickers = (root["tickers"] as unknown[] | undefined) ?? [];
  const exchanges = (root["exchanges"] as unknown[] | undefined) ?? [];

  return {
    name: str(root["name"]),
    tickers: tickers.map((t) => String(t)),
    exchanges: exchanges.map((e) => String(e)),
    sic: str(root["sicDescription"]),
    filings: out,
  };
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export type MappedFact = {
  metricKey: string;
  concept: string;
  taxonomy: string;
  unit: string;
  value: number;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  form: string | null;
  filed: string | null;
  startDate: string | null;
  endDate: string | null;
  frame: string | null;
  accessionNumber: string | null;
  periodKind: "Duration" | "Instant";
  mappingConfidence: MappingConfidence;
  candidateConcepts: string[];
};

export type FactsSummary = {
  conceptsFound: number;
  facts: MappedFact[];
  needsReview: string[];
  unsupported: string[];
};

/**
 * Extract only the supported concepts. Annual/quarterly, instant/duration,
 * units and amended filings are all kept distinct — nothing is merged.
 */
export function mapCompanyFacts(
  payload: unknown,
  opts: { maxPerMetric?: number } = {},
): FactsSummary {
  const maxPerMetric = opts.maxPerMetric ?? 40;
  const root = (payload ?? {}) as Record<string, unknown>;
  const facts = (root["facts"] ?? {}) as Record<string, Record<string, unknown>>;

  let conceptsFound = 0;
  for (const tax of Object.values(facts)) conceptsFound += Object.keys(tax ?? {}).length;

  const out: MappedFact[] = [];
  const needsReview: string[] = [];
  const unsupported: string[] = [];

  for (const spec of SEC_METRICS) {
    const tax = (facts[spec.taxonomy] ?? {}) as Record<string, unknown>;
    const present = spec.concepts.filter((c) => tax[c] !== undefined);
    if (present.length === 0) {
      unsupported.push(spec.key);
      continue;
    }
    // More than one plausible concept → we do not guess which is authoritative.
    const confidence: MappingConfidence = present.length > 1 ? "Needs Review" : "Mapped";
    if (confidence === "Needs Review") needsReview.push(spec.key);

    const chosen = present[0]!;
    const conceptNode = (tax[chosen] ?? {}) as Record<string, unknown>;
    const units = (conceptNode["units"] ?? {}) as Record<string, unknown[]>;

    for (const unit of spec.units) {
      const rows = Array.isArray(units[unit]) ? (units[unit] as Record<string, unknown>[]) : [];
      const filtered = rows.filter((r) => {
        const hasStart = r["start"] !== undefined;
        return spec.periodKind === "Duration" ? hasStart : !hasStart;
      });
      const recent = filtered.slice(-maxPerMetric);
      for (const r of recent) {
        const value = Number(r["val"]);
        if (!Number.isFinite(value)) continue;
        out.push({
          metricKey: spec.key,
          concept: chosen,
          taxonomy: spec.taxonomy,
          unit,
          value,
          fiscalYear: r["fy"] === null || r["fy"] === undefined ? null : Number(r["fy"]),
          fiscalPeriod: str(r["fp"]),
          form: str(r["form"]),
          filed: str(r["filed"]),
          startDate: str(r["start"]),
          endDate: str(r["end"]),
          frame: str(r["frame"]),
          accessionNumber: str(r["accn"]),
          periodKind: spec.periodKind,
          mappingConfidence: confidence,
          candidateConcepts: present,
        });
      }
    }
  }

  return { conceptsFound, facts: out, needsReview, unsupported };
}

export type PeriodBucket = {
  periodType: "Annual" | "Quarterly";
  fiscalYear: number;
  fiscalQuarter: string | null;
  periodEnd: string | null;
  form: string;
  values: Record<string, number>;
};

/**
 * Group mapped facts into period buckets. Annual (10-K / FY) and quarterly
 * (10-Q / Q1-Q3) are never mixed, and each bucket keeps the form it came from.
 */
export function bucketPeriods(facts: MappedFact[]): PeriodBucket[] {
  const buckets = new Map<string, PeriodBucket>();

  for (const f of facts) {
    if (!f.fiscalYear || !f.fiscalPeriod || !f.form) continue;
    const isAnnual = f.fiscalPeriod === "FY" && f.form.startsWith("10-K");
    const isQuarter = /^Q[1-4]$/.test(f.fiscalPeriod) && f.form.startsWith("10-Q");
    if (!isAnnual && !isQuarter) continue;

    const spec = SEC_METRICS.find((s) => s.key === f.metricKey);
    if (!spec?.periodColumn) continue;

    const key = `${isAnnual ? "A" : "Q"}:${f.fiscalYear}:${f.fiscalPeriod}`;
    const existing = buckets.get(key) ?? {
      periodType: isAnnual ? ("Annual" as const) : ("Quarterly" as const),
      fiscalYear: f.fiscalYear,
      fiscalQuarter: isAnnual ? null : f.fiscalPeriod,
      periodEnd: f.endDate,
      form: f.form,
      values: {},
    };
    if (f.endDate && (!existing.periodEnd || f.endDate > existing.periodEnd)) {
      existing.periodEnd = f.endDate;
    }
    // Last write wins within a bucket only when the value is absent — the most
    // recent filing for a period is what SEC lists last.
    existing.values[spec.periodColumn] = f.value;
    buckets.set(key, existing);
  }

  return [...buckets.values()].sort((a, b) =>
    a.fiscalYear === b.fiscalYear
      ? String(b.fiscalQuarter).localeCompare(String(a.fiscalQuarter))
      : b.fiscalYear - a.fiscalYear,
  );
}
