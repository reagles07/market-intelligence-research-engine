/**
 * Evidence lineage resolution (server only).
 *
 * Turns the metric keys the research engine already validates
 * (`financial_periods:<period_id>:<column>`) into a real, inspectable
 * provenance chain:
 *
 *   metric column → financial period → SEC fact (XBRL concept) → accession
 *   → SEC filing → Tier-1 source
 *
 * Every link is looked up in the database. Nothing is fabricated: when a link
 * genuinely does not exist the field stays null and the claim simply is not
 * metric-traceable.
 */
import { SEC_METRICS, SEC_PROVIDER } from "@/lib/sec/constants";
import type { TraceableClaim } from "@/lib/research/traceability";

import type { Db } from "@/lib/ai/context.server";

export type ClaimEvidence = {
  evidence_type: "SOURCE" | "METRIC" | "CALCULATION" | "NONE";
  evidence_metric_keys: string[];
  financial_period_id: string | null;
  sec_fact_id: string | null;
  sec_filing_id: string | null;
  evidence_provider: string | null;
  evidence_accession: string | null;
  evidence_period: string | null;
  // Stored as jsonb; typed loosely so generated Supabase Json types accept it.
  evidence_detail: Record<string, import("@/integrations/supabase/types").Json | undefined>;
  source_id: string | null;
};

const COLUMN_TO_METRIC = new Map<string, string>(
  SEC_METRICS.filter((m) => m.periodColumn).map((m) => [m.periodColumn!, m.key]),
);

export function parseMetricKey(key: string): { periodId: string; column: string } | null {
  const parts = key.split(":");
  if (parts.length !== 3 || parts[0] !== "financial_periods") return null;
  return { periodId: parts[1]!, column: parts[2]! };
}

export function periodLabel(period: Record<string, unknown> | null): string | null {
  if (!period) return null;
  const q = period["fiscal_quarter"] ? String(period["fiscal_quarter"]) : null;
  const y = period["fiscal_year"] ? `FY${String(period["fiscal_year"])}` : null;
  return [q, y].filter(Boolean).join(" ") || null;
}

/** Resolve one metric key into its full provenance chain. */
export async function resolveMetricEvidence(
  db: Db,
  companyId: string,
  metricKey: string,
): Promise<TraceableClaim & { label: string | null }> {
  const parsed = parseMetricKey(metricKey);
  const empty = {
    evidence_type: "METRIC",
    evidence_metric_keys: [metricKey],
    financial_period_id: null,
    sec_fact_id: null,
    sec_filing_id: null,
    evidence_provider: null,
    evidence_accession: null,
    evidence_period: null,
    evidence_detail: {},
    label: null,
  } as TraceableClaim & { label: string | null };
  if (!parsed) return empty;

  const { data: period } = await db
    .from("financial_periods")
    .select("id,company_id,fiscal_year,fiscal_quarter,period_type,period_end,currency,units")
    .eq("id", parsed.periodId)
    .maybeSingle();
  if (!period) return empty;

  const secMetricKey = COLUMN_TO_METRIC.get(parsed.column) ?? null;
  let fact: Record<string, unknown> | null = null;
  if (secMetricKey) {
    const fp = String(period["fiscal_quarter"] ?? "");
    let q = db
      .from("sec_facts")
      .select(
        "id,metric_key,concept,taxonomy,unit,value,fiscal_year,fiscal_period,form,filed,accession_number",
      )
      .eq("company_id", companyId)
      .eq("metric_key", secMetricKey)
      .eq("fiscal_year", period["fiscal_year"]);
    if (fp) q = q.eq("fiscal_period", fp);
    const { data } = await q.order("filed", { ascending: false }).limit(1);
    fact = (data ?? [])[0] ?? null;
  }

  const accession = fact ? (fact["accession_number"] as string | null) : null;
  let filing: Record<string, unknown> | null = null;
  if (accession) {
    const { data } = await db
      .from("sec_filings")
      .select("id,form,filing_date,accession_number,url,source_id,primary_document")
      .eq("company_id", companyId)
      .eq("accession_number", accession)
      .maybeSingle();
    filing = data ?? null;
  }

  return {
    evidence_type: "METRIC",
    evidence_metric_keys: [metricKey],
    financial_period_id: String(period["id"]),
    sec_fact_id: fact ? String(fact["id"]) : null,
    sec_filing_id: filing ? String(filing["id"]) : null,
    // Provider is only claimed when an authoritative row actually backs it.
    evidence_provider: fact ? SEC_PROVIDER : null,
    evidence_accession: accession,
    evidence_period: periodLabel(period),
    evidence_detail: {
      metric_column: parsed.column,
      metric_label: secMetricKey,
      concept: fact?.["concept"] ?? null,
      taxonomy: fact?.["taxonomy"] ?? null,
      unit: fact?.["unit"] ?? null,
      metric_value: period[parsed.column as keyof typeof period] ?? null,
      fact_value: fact?.["value"] ?? null,
      form: filing?.["form"] ?? fact?.["form"] ?? null,
      filing_url: filing?.["url"] ?? null,
      filing_source_id: filing?.["source_id"] ?? null,
      currency: period["currency"] ?? null,
      units: period["units"] ?? null,
    },
    label: `${secMetricKey ?? parsed.column} · ${periodLabel(period) ?? "period"}`,
  };
}

/**
 * Build the evidence columns for a claim from the evidence the verifier
 * accepted. Direct sources win; metric keys give the structured path;
 * a claim the model categorised CALCULATION records its inputs so the
 * traceability helper can require each of them to be traceable too.
 */
export async function buildClaimEvidence(
  db: Db,
  args: {
    companyId: string;
    sourceIds: string[];
    metricKeys: string[];
    claimCategory?: string | null;
  },
): Promise<ClaimEvidence> {
  const sourceId = args.sourceIds[0] ?? null;
  const keys = [...new Set(args.metricKeys.filter(Boolean))];
  const resolved = [] as Array<TraceableClaim & { label: string | null }>;
  for (const k of keys) resolved.push(await resolveMetricEvidence(db, args.companyId, k));

  const primary = resolved.find((r) => r.sec_fact_id) ?? resolved[0] ?? null;
  const isCalculation = String(args.claimCategory ?? "").toUpperCase() === "CALCULATION";

  const type: ClaimEvidence["evidence_type"] =
    isCalculation && keys.length
      ? "CALCULATION"
      : sourceId
        ? "SOURCE"
        : keys.length
          ? "METRIC"
          : "NONE";

  return {
    evidence_type: type,
    evidence_metric_keys: keys,
    financial_period_id: primary?.financial_period_id ?? null,
    sec_fact_id: primary?.sec_fact_id ?? null,
    sec_filing_id: primary?.sec_filing_id ?? null,
    evidence_provider: primary?.evidence_provider ?? (sourceId ? "Source" : null),
    evidence_accession: primary?.evidence_accession ?? null,
    evidence_period: primary?.evidence_period ?? null,
    evidence_detail: {
      ...(primary?.evidence_detail ?? {}),
      ...(type === "CALCULATION"
        ? {
            inputs: resolved.map((r) => ({
              evidence_type: "METRIC",
              evidence_metric_keys: r.evidence_metric_keys,
              financial_period_id: r.financial_period_id,
              sec_fact_id: r.sec_fact_id,
              sec_filing_id: r.sec_filing_id,
              evidence_provider: r.evidence_provider,
              evidence_accession: r.evidence_accession,
              evidence_period: r.evidence_period,
              label: r.label,
            })),
          }
        : {}),
      source_ids: args.sourceIds,
    },
    source_id: sourceId,
  };
}
