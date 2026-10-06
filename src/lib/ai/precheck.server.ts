/**
 * Deterministic numeric pre-check (server only, NO model call).
 *
 * Runs before the AI fact audit. It pulls every number out of the script with
 * regular expressions, matches each against the structured research data of the
 * SAME packet, and classifies the result. High-risk mismatches (scale, currency,
 * period, unit, metric family, unsourced current price) become blocking audit
 * items regardless of what the model later says.
 */
import {
  BLOCKING_MATCH_STATUSES,
  extractNumericMentions,
  isScaleError,
  metricsIncompatible,
  periodQuarter,
  periodYear,
  relDiff,
  type MetricFamily,
  type NumericMatchStatus,
  type NumericMention,
} from "@/lib/content/numeric";
import {
  EMPTY_TEMPORAL_EVIDENCE,
  extractNonNumericSpans,
  extractTemporalTokens,
  temporalSeverity,
  validateTemporalToken,
  type TemporalEvidence,
  type TemporalStatus,
  type TokenType,
} from "@/lib/content/temporal";
import type { ScriptContext } from "@/lib/ai/script-context.server";

export type ResearchNumber = {
  label: string;
  metric: MetricFamily;
  value: number;
  currency: string | null;
  kind: "currency" | "percent" | "multiple" | "count";
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  periodLabel: string | null;
  origin: string;
  metricKey: string | null;
};

export type PrecheckFinding = {
  index: number;
  raw: string;
  sentence: string;
  sectionKey: string | null;
  metric: MetricFamily;
  kind: string;
  /** Classified expression type — temporal tokens never hit the figure matcher. */
  tokenType: TokenType;
  temporalStatus: TemporalStatus | null;
  scriptValue: number | null;
  scriptCurrency: string | null;
  scriptPeriod: string | null;
  status: NumericMatchStatus;
  severity: "Blocking" | "Warning" | "Info";
  matchedLabel: string | null;
  matchedValue: number | null;
  matchedMetricKey: string | null;
  issue: string | null;
};

export type PrecheckResult = {
  findings: PrecheckFinding[];
  total: number;
  blocking: number;
  warnings: number;
  counts: Record<string, number>;
  currentPriceAllowed: boolean;
  currentPriceReason: string | null;
};

const COLUMN_METRIC: Record<string, MetricFamily> = {
  revenue: "revenue",
  gross_profit: "revenue",
  operating_income: "operating_income",
  ebitda: "ebitda",
  net_income: "net_income",
  eps_gaap: "eps_gaap",
  eps_adjusted: "eps_adjusted",
  operating_cash_flow: "operating_cash_flow",
  capex: "capex",
  free_cash_flow: "free_cash_flow",
  cash: "cash",
  debt: "debt",
  shares_outstanding: "shares_outstanding",
  gross_margin: "gross_margin",
  operating_margin: "operating_margin",
  net_margin: "net_margin",
  market_cap: "market_cap",
  trailing_pe: "valuation_multiple",
  forward_pe: "valuation_multiple",
  price_sales: "valuation_multiple",
  price_book: "valuation_multiple",
  ev_sales: "valuation_multiple",
  ev_ebitda: "valuation_multiple",
  peg: "valuation_multiple",
  dividend_yield: "dividend_yield",
  fcf_yield: "dividend_yield",
  price: "price",
  previous_close: "price",
  closing_price: "price",
  opening_price: "price",
  after_hours_price: "price",
  ma_20: "price",
  ma_50: "price",
  ma_200: "price",
  high_52w: "price",
  low_52w: "price",
  price_target: "price_target",
  revenue_actual: "revenue",
  revenue_consensus: "revenue",
  eps_consensus: "eps",
  daily_change_pct: "growth",
  return_1d: "growth",
  return_5d: "growth",
  return_1m: "growth",
  return_3m: "growth",
  return_ytd: "growth",
  return_1y: "growth",
  revenue_surprise_pct: "growth",
  eps_surprise_pct: "growth",
  next_day_reaction_pct: "growth",
};

const PERCENT_COLUMNS = new Set([
  "gross_margin",
  "operating_margin",
  "net_margin",
  "dividend_yield",
  "fcf_yield",
  "daily_change_pct",
  "revenue_surprise_pct",
  "eps_surprise_pct",
  "next_day_reaction_pct",
  "return_1d",
  "return_5d",
  "return_1m",
  "return_3m",
  "return_ytd",
  "return_1y",
  "volatility",
  "max_drawdown",
  "rsi",
]);

const MULTIPLE_COLUMNS = new Set([
  "trailing_pe",
  "forward_pe",
  "price_sales",
  "price_book",
  "ev_sales",
  "ev_ebitda",
  "peg",
  "volume_ratio",
]);

function unitScale(units: unknown): number {
  const u = String(units ?? "").toLowerCase();
  if (u.includes("crore")) return 1e7;
  if (u.includes("lakh")) return 1e5;
  if (u.includes("billion")) return 1e9;
  if (u.includes("million")) return 1e6;
  if (u.includes("thousand")) return 1e3;
  return 1;
}

function quarterNumber(q: unknown): number | null {
  const m = /([1-4])/.exec(String(q ?? ""));
  return m && m[1] ? Number(m[1]) : null;
}

/** Flatten the packet's structured data into comparable numeric facts. */
export function collectResearchNumbers(ctx: ScriptContext): ResearchNumber[] {
  const out: ResearchNumber[] = [];
  const bundle = ctx.bundle as Record<string, unknown>;
  const rows = (key: string) =>
    Array.isArray(bundle[key]) ? (bundle[key] as Record<string, unknown>[]) : [];

  const push = (
    row: Record<string, unknown>,
    column: string,
    origin: string,
    opts: {
      scale?: number;
      currency?: string | null;
      fiscalYear?: number | null;
      fiscalQuarter?: number | null;
      periodLabel?: string | null;
      table?: string | null;
    } = {},
  ) => {
    const v = row[column];
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    const metric = COLUMN_METRIC[column] ?? "unknown";
    const kind = PERCENT_COLUMNS.has(column)
      ? "percent"
      : MULTIPLE_COLUMNS.has(column)
        ? "multiple"
        : metric === "shares_outstanding"
          ? "count"
          : "currency";
    out.push({
      label: `${origin}.${column}`,
      metric,
      value: kind === "currency" ? v * (opts.scale ?? 1) : v,
      currency: kind === "currency" ? (opts.currency ?? ctx.currency) : null,
      kind,
      fiscalYear: opts.fiscalYear ?? null,
      fiscalQuarter: opts.fiscalQuarter ?? null,
      periodLabel: opts.periodLabel ?? null,
      origin,
      metricKey: opts.table && row["id"] ? `${opts.table}:${String(row["id"])}:${column}` : null,
    });
  };

  for (const p of rows("financial_periods")) {
    const scale = unitScale(p["units"]);
    const fy = typeof p["fiscal_year"] === "number" ? (p["fiscal_year"] as number) : null;
    const fq = quarterNumber(p["fiscal_quarter"]);
    for (const col of Object.keys(COLUMN_METRIC)) {
      push(p, col, "financial_period", {
        scale,
        currency: String(p["currency"] ?? ctx.currency),
        fiscalYear: fy,
        fiscalQuarter: fq,
        periodLabel: `${p["fiscal_quarter"] ?? "FY"} ${fy ?? ""}`.trim(),
        table: "financial_periods",
      });
    }
  }

  for (const e of rows("earnings_reports")) {
    const scale = unitScale(e["units"]);
    const fq = quarterNumber(e["fiscal_quarter"]);
    const fy = periodYear(String(e["fiscal_quarter"] ?? "")) ?? null;
    for (const col of Object.keys(COLUMN_METRIC)) {
      push(e, col, "earnings_report", {
        scale,
        currency: String(e["currency"] ?? ctx.currency),
        fiscalYear: fy,
        fiscalQuarter: fq,
        periodLabel: String(e["fiscal_quarter"] ?? ""),
        table: "earnings_reports",
      });
    }
  }

  for (const v of rows("valuations")) {
    for (const col of Object.keys(COLUMN_METRIC))
      push(v, col, "valuation", { table: "valuations" });
  }
  for (const t of rows("technical_metrics")) {
    for (const col of Object.keys(COLUMN_METRIC))
      push(t, col, "technical", { table: "technical_metrics" });
  }
  for (const q of rows("quantitative_metrics")) {
    for (const col of Object.keys(COLUMN_METRIC))
      push(q, col, "quantitative", { table: "quantitative_metrics" });
  }

  const snap = bundle["market_snapshot"] as Record<string, unknown> | null;
  if (snap)
    for (const col of Object.keys(COLUMN_METRIC))
      push(snap, col, "market_snapshot", { table: "market_snapshots" });

  for (const a of rows("analyst_views")) {
    for (const col of ["price_target", "previous_price_target"]) {
      const v = a[col];
      if (typeof v === "number") {
        out.push({
          label: `analyst_view.${String(a["firm"] ?? "firm")}.${col}`,
          metric: "price_target",
          value: v,
          currency: String(a["currency"] ?? ctx.currency),
          kind: "currency",
          fiscalYear: null,
          fiscalQuarter: null,
          periodLabel: null,
          origin: "analyst_view",
          metricKey: null,
        });
      }
    }
  }

  for (const s of rows("scenarios")) {
    for (const col of ["valuation_low", "valuation_high", "probability"]) {
      const v = s[col];
      if (typeof v === "number") {
        out.push({
          label: `scenario.${String(s["scenario_type"] ?? "")}.${col}`,
          metric: col === "probability" ? "unknown" : "price_target",
          value: col === "probability" ? v * 100 : v,
          currency: col === "probability" ? null : ctx.currency,
          kind: col === "probability" ? "percent" : "currency",
          fiscalYear: null,
          fiscalQuarter: null,
          periodLabel: String(s["time_horizon"] ?? ""),
          origin: "scenario",
          metricKey: null,
        });
      }
    }
  }

  // Verified claims that carry an explicit value.
  for (const c of rows("usable_claims")) {
    const rawValue = String(c["value"] ?? "");
    const num = Number(rawValue.replace(/[^0-9.-]/g, ""));
    if (!rawValue || Number.isNaN(num)) continue;
    const unit = String(c["unit"] ?? "");
    const scale = unitScale(unit);
    const isPct = unit.includes("%");
    out.push({
      label: `claim.${String(c["id"]).slice(0, 8)}`,
      metric: "unknown",
      value: isPct ? num : num * scale,
      currency: /INR|₹/.test(unit) ? "INR" : /USD|\$/.test(unit) ? "USD" : null,
      kind: isPct ? "percent" : "currency",
      fiscalYear: periodYear(String(c["reporting_period"] ?? "")),
      fiscalQuarter: periodQuarter(String(c["reporting_period"] ?? "")),
      periodLabel: String(c["reporting_period"] ?? ""),
      origin: "claim",
      metricKey: null,
    });
  }

  return out;
}

/** Is a current share price allowed to appear at all? §8 current price rule. */
export function currentPriceAllowed(ctx: ScriptContext): {
  allowed: boolean;
  reason: string | null;
} {
  const snap = (ctx.bundle as Record<string, unknown>)["market_snapshot"] as Record<
    string,
    unknown
  > | null;
  if (!snap)
    return {
      allowed: false,
      reason: "The packet holds no market snapshot, so no current price may be stated.",
    };
  const missing: string[] = [];
  if (typeof snap["price"] !== "number") missing.push("price");
  if (!ctx.currency) missing.push("currency");
  if (!snap["as_of"]) missing.push("timestamp");
  if (!snap["source"] && !snap["provider"]) missing.push("provider/source");
  return missing.length
    ? {
        allowed: false,
        reason: `The market snapshot is missing ${missing.join(", ")} — a current price may not be stated.`,
      }
    : { allowed: true, reason: null };
}

const PRICE_METRICS: MetricFamily[] = ["price", "price_target", "market_cap"];

function classify(
  m: NumericMention,
  candidates: ResearchNumber[],
): { status: NumericMatchStatus; match: ResearchNumber | null; issue: string | null } {
  if (m.value === null || m.kind === "date" || m.kind === "period") {
    return { status: "EXACT_MATCH", match: null, issue: null };
  }

  const sameKind = candidates.filter((c) => {
    if (m.kind === "percent" || m.kind === "percentage_points") return c.kind === "percent";
    if (m.kind === "multiple") return c.kind === "multiple";
    return c.kind === "currency" || c.kind === "count";
  });

  const byMetric =
    m.metric === "unknown" ? sameKind : sameKind.filter((c) => c.metric === m.metric);
  const pool = byMetric.length ? byMetric : sameKind;

  // 1. Exact / approximate value match inside the right metric family.
  let best: { c: ResearchNumber; d: number } | null = null;
  for (const c of pool) {
    const d = relDiff(m.value, c.value);
    if (!best || d < best.d) best = { c, d };
  }

  if (best && best.d <= 0.005) {
    const c = best.c;
    // currency mismatch
    if (m.currency && c.currency && m.currency !== c.currency) {
      return {
        status: "CURRENCY_MISMATCH",
        match: c,
        issue: `The script says ${m.currency} but the research holds ${c.currency}.`,
      };
    }
    // period mismatch
    const sy = periodYear(m.period);
    const sq = periodQuarter(m.period);
    if (sy && c.fiscalYear && sy !== c.fiscalYear) {
      return {
        status: "PERIOD_MISMATCH",
        match: c,
        issue: `The script says ${m.period} but this figure is ${c.periodLabel ?? c.fiscalYear}.`,
      };
    }
    if (sq && c.fiscalQuarter && sq !== c.fiscalQuarter) {
      return {
        status: "PERIOD_MISMATCH",
        match: c,
        issue: `Quarter mismatch: script ${m.period}, research ${c.periodLabel}.`,
      };
    }
    if (metricsIncompatible(m.metric, c.metric)) {
      return {
        status: "METRIC_MISMATCH",
        match: c,
        issue: `The script frames this as ${m.metric} but the research value is ${c.metric}.`,
      };
    }
    return { status: "EXACT_MATCH", match: c, issue: null };
  }

  if (best && best.d <= 0.03) {
    return {
      status: "APPROX_MATCH",
      match: best.c,
      issue: `Rounded: research holds ${best.c.value} (${best.c.label}).`,
    };
  }

  // 2. Scale error against any candidate of the same metric family.
  for (const c of pool) {
    if (isScaleError(m.value, c.value)) {
      return {
        status: "UNIT_MISMATCH",
        match: c,
        issue: `Magnitude error: the script states ${m.raw} where the research holds ${c.value} (${c.label}).`,
      };
    }
  }

  // 3. Same metric AND same period but a different value → conflict.
  if (m.metric !== "unknown") {
    const sy = periodYear(m.period);
    const conflict = pool.find(
      (c) => c.metric === m.metric && (!sy || !c.fiscalYear || c.fiscalYear === sy),
    );
    if (conflict) {
      return {
        status: "CONFLICT",
        match: conflict,
        issue: `The research holds ${conflict.value} for ${conflict.label}, the script says ${m.raw}.`,
      };
    }
  }

  // 4. Percentage points stated as a percent (or vice versa).
  if (m.kind === "percentage_points" && pool.some((c) => relDiff(m.value!, c.value) <= 0.005)) {
    return {
      status: "UNIT_MISMATCH",
      match: null,
      issue: "Percentage points and percent are not interchangeable.",
    };
  }

  return {
    status: "NO_MATCH",
    match: null,
    issue: "No figure in the research packet supports this number.",
  };
}

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;

/** Collect every date, reporting period and filing item the packet can prove. */
export function collectTemporalEvidence(ctx: ScriptContext): TemporalEvidence {
  const bundle = ctx.bundle as Record<string, unknown>;
  const rows = (key: string) =>
    Array.isArray(bundle[key]) ? (bundle[key] as Record<string, unknown>[]) : [];

  const ev: TemporalEvidence = {
    dates: [],
    years: [],
    fiscalPeriods: [],
    secItems: [],
  };
  const seenDates = new Set<string>();
  const seenPeriods = new Set<string>();

  const addDate = (value: unknown, label: string) => {
    const s = String(value ?? "");
    const m = ISO_DATE.exec(s);
    if (!m) return;
    const iso = m[0];
    if (seenDates.has(iso)) return;
    seenDates.add(iso);
    ev.dates.push({ iso, label });
    const y = Number(iso.slice(0, 4));
    if (!ev.years.includes(y)) ev.years.push(y);
  };
  const addYear = (y: unknown) => {
    const n = typeof y === "number" ? y : Number(String(y ?? ""));
    if (Number.isFinite(n) && n > 1900 && n < 2100 && !ev.years.includes(n)) ev.years.push(n);
  };
  const addPeriod = (year: number | null, quarter: number | null, label: string) => {
    const key = `${year ?? "?"}-${quarter ?? "FY"}`;
    if (seenPeriods.has(key)) return;
    seenPeriods.add(key);
    ev.fiscalPeriods.push({ year, quarter, label });
    if (year) addYear(year);
  };
  const addItem = (item: unknown) => {
    const s = String(item ?? "")
      .replace(/^item\s*/i, "")
      .trim();
    if (/^\d{1,2}\.\d{2}$/.test(s) && !ev.secItems.includes(s)) ev.secItems.push(s);
  };
  /** Free text can carry dates and item numbers the columns don't hold. */
  const scanText = (value: unknown, label: string) => {
    const text = String(value ?? "");
    if (!text || text.length > 8000) return;
    for (const tok of extractTemporalTokens(text)) {
      if (tok.type === "DATE" && tok.year !== null && tok.month !== null && tok.day !== null) {
        addDate(
          `${tok.year}-${String(tok.month).padStart(2, "0")}-${String(tok.day).padStart(2, "0")}`,
          label,
        );
      } else if (tok.type === "SEC_ITEM") {
        addItem(tok.item);
      } else if (tok.type === "FISCAL_PERIOD" && tok.fiscalYear) {
        addPeriod(tok.fiscalYear, tok.quarter, tok.raw);
      } else if (tok.type === "YEAR" && tok.year) {
        addYear(tok.year);
      }
    }
  };

  for (const f of rows("sec_filings")) {
    addDate(f["filing_date"], `${String(f["form"] ?? "filing")} filing date`);
    addDate(f["report_date"], `${String(f["form"] ?? "filing")} report date`);
    const items = f["filing_items"];
    if (Array.isArray(items))
      for (const i of items)
        addItem(typeof i === "string" ? i : (i as Record<string, unknown>)?.["item"]);
    else if (items && typeof items === "object")
      for (const k of Object.keys(items as object)) addItem(k);
  }
  for (const e of rows("events")) {
    addDate(e["occurred_at"], String(e["title"] ?? "event"));
    scanText(e["title"], "event title");
    scanText(e["description"], "event description");
  }
  for (const s of rows("sources")) {
    addDate(s["published_at"], String(s["publisher"] ?? "source"));
    scanText(s["title"], "source title");
    scanText(s["ai_summary"], "source summary");
  }
  for (const e of rows("earnings_reports")) {
    addDate(e["earnings_date"], "earnings date");
    const fq = quarterNumber(e["fiscal_quarter"]);
    addPeriod(periodYear(String(e["fiscal_quarter"] ?? "")), fq, String(e["fiscal_quarter"] ?? ""));
  }
  for (const p of rows("financial_periods")) {
    addDate(p["period_end"], "period end");
    addDate(p["period_start"], "period start");
    addDate(p["report_date"], "period report date");
    const fy = typeof p["fiscal_year"] === "number" ? (p["fiscal_year"] as number) : null;
    addPeriod(
      fy,
      quarterNumber(p["fiscal_quarter"]),
      `${p["fiscal_quarter"] ?? "FY"} ${fy ?? ""}`.trim(),
    );
  }
  for (const c of rows("usable_claims")) {
    addDate(c["as_of_date"], "claim as-of date");
    const rp = String(c["reporting_period"] ?? "");
    if (rp) addPeriod(periodYear(rp), periodQuarter(rp), rp);
    scanText(c["claim_text"], "verified claim");
    scanText(c["value"], "verified claim value");
  }
  for (const s of rows("research_sections"))
    scanText(s["content"], `research section ${String(s["section_key"] ?? "")}`);
  const snap = bundle["market_snapshot"] as Record<string, unknown> | null;
  if (snap) addDate(snap["as_of"], "market snapshot");
  const story = bundle["story"] as Record<string, unknown> | null;
  if (story) {
    scanText(story["title"], "story title");
    scanText(story["summary"], "story summary");
  }

  return ev;
}

function numericTokenType(m: NumericMention): TokenType {
  switch (m.kind) {
    case "percent":
    case "percentage_points":
      return "PERCENTAGE";
    case "multiple":
      return "MULTIPLE";
    case "currency":
      return "CURRENCY_VALUE";
    case "date":
      return "YEAR";
    case "count":
      return m.metric === "shares_outstanding" ? "SHARE_COUNT" : "FINANCIAL_NUMBER";
    default:
      return "OTHER_NUMERIC";
  }
}

/**
 * Run the whole pre-check over a script's spoken sections.
 * `sections` is the ordered spoken text; body text is used when there are none.
 */
export function runNumericPrecheck(
  ctx: ScriptContext,
  sections: Array<{ section_key: string; spoken_text: string }>,
): PrecheckResult {
  const research = collectResearchNumbers(ctx);
  const price = currentPriceAllowed(ctx);
  const temporalEvidence = ctx ? collectTemporalEvidence(ctx) : EMPTY_TEMPORAL_EVIDENCE;

  const findings: PrecheckFinding[] = [];
  const mentions: NumericMention[] = [];
  let idx = 0;
  let temporalTotal = 0;

  for (const s of sections) {
    // 1. Classify temporal / filing-item expressions FIRST and keep their spans
    //    out of the financial figure matcher.
    const tokens = extractTemporalTokens(s.spoken_text);
    temporalTotal += tokens.length;
    for (const tok of tokens) {
      const { status, matched, issue } = validateTemporalToken(tok, temporalEvidence);
      const severity = temporalSeverity(tok, status);
      if (severity === "Info") continue;
      findings.push({
        index: idx++,
        raw: tok.raw,
        sentence: tok.sentence,
        sectionKey: s.section_key,
        metric: "unknown",
        kind: tok.type.toLowerCase(),
        tokenType: tok.type,
        temporalStatus: status,
        scriptValue: null,
        scriptCurrency: null,
        scriptPeriod: tok.raw,
        status: status === "CONFLICTING" ? "CONFLICT" : "NO_MATCH",
        severity,
        matchedLabel: matched,
        matchedValue: null,
        matchedMetricKey: null,
        issue,
      });
    }

    // 2. Financial figures, with the temporal spans excluded.
    const found = extractNumericMentions(s.spoken_text, s.section_key, idx, [
      ...tokens.map((t) => ({ start: t.start, end: t.end })),
      ...extractNonNumericSpans(s.spoken_text),
    ]);
    idx += found.length;
    mentions.push(...found);
  }

  for (const m of mentions) {
    if (m.kind === "date" || m.kind === "period") continue;

    // §8: an unsourced current price is blocking on its own.
    if (m.metric === "price" && !price.allowed) {
      findings.push({
        index: m.index,
        raw: m.raw,
        sentence: m.sentence,
        sectionKey: m.sectionKey,
        metric: m.metric,
        kind: m.kind,
        tokenType: numericTokenType(m),
        temporalStatus: null,
        scriptValue: m.value,
        scriptCurrency: m.currency,
        scriptPeriod: m.period,
        status: "NO_MATCH",
        severity: "Blocking",
        matchedLabel: null,
        matchedValue: null,
        matchedMetricKey: null,
        issue: price.reason,
      });
      continue;
    }

    const { status, match, issue } = classify(m, research);
    if (status === "EXACT_MATCH") continue;

    const blocking =
      BLOCKING_MATCH_STATUSES.includes(status) ||
      (status === "NO_MATCH" && (m.metric !== "unknown" || PRICE_METRICS.includes(m.metric)));

    findings.push({
      index: m.index,
      raw: m.raw,
      sentence: m.sentence,
      sectionKey: m.sectionKey,
      metric: m.metric,
      kind: m.kind,
      tokenType: numericTokenType(m),
      temporalStatus: null,
      scriptValue: m.value,
      scriptCurrency: m.currency,
      scriptPeriod: m.period,
      status,
      severity: blocking ? "Blocking" : status === "APPROX_MATCH" ? "Info" : "Warning",
      matchedLabel: match?.label ?? null,
      matchedValue: match?.value ?? null,
      matchedMetricKey: match?.metricKey ?? null,
      issue,
    });
  }

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.status] = (counts[f.status] ?? 0) + 1;

  return {
    findings,
    total: mentions.length + temporalTotal,
    blocking: findings.filter((f) => f.severity === "Blocking").length,
    warnings: findings.filter((f) => f.severity === "Warning").length,
    counts,
    currentPriceAllowed: price.allowed,
    currentPriceReason: price.reason,
  };
}
