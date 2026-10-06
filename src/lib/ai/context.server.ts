/**
 * Database-only research context builder (server only).
 *
 * This is the ONLY input the research engine receives in DATABASE mode.
 * Anything absent here must come back as "Insufficient Data" — the prompts
 * forbid filling gaps from model knowledge, and nothing in this file reaches
 * outside the project's own tables.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export type Db = SupabaseClient<Database>;

export type ResearchContext = {
  story: Record<string, unknown> | null;
  company: Record<string, unknown>;
  bundle: Record<string, unknown>;
  sourceIds: string[];
  claimIds: string[];
  metricKeys: string[];
  counts: Record<string, number>;
  hasValuationInputs: boolean;
};

/**
 * Label an XBRL fact with the exact window it covers so quarterly, cumulative
 * (year-to-date) and prior-year comparative values are never mistaken for
 * contradictory readings of the same period.
 */
function describeSecFact(row: Record<string, unknown>) {
  const start = typeof row["start_date"] === "string" ? row["start_date"] : null;
  const end = typeof row["end_date"] === "string" ? row["end_date"] : null;
  const months =
    start && end
      ? Math.max(
          1,
          Math.round((Date.parse(end) - Date.parse(start)) / (1000 * 60 * 60 * 24 * 30.44)),
        )
      : null;
  const fy = Number(row["fiscal_year"] ?? 0);
  const endYear = end ? Number(end.slice(0, 4)) : null;
  const comparative = Boolean(fy && endYear && endYear < fy);
  const durationLabel =
    months === null
      ? row["period_kind"] === "Instant"
        ? `as of ${end ?? "unknown date"}`
        : "unknown window"
      : `${months}-month period ${start} to ${end}`;

  return {
    ...row,
    duration_months: months,
    period_window: durationLabel,
    coverage:
      months === null
        ? "POINT_IN_TIME"
        : months <= 3
          ? "QUARTER"
          : months >= 12
            ? "FULL_YEAR"
            : "CUMULATIVE_YTD",
    is_prior_year_comparative: comparative,
    period_label: `${row["fiscal_period"] ?? "?"} FY${row["fiscal_year"] ?? "?"} · ${durationLabel}${comparative ? " · PRIOR-YEAR COMPARATIVE" : ""}`,
  };
}

const strip = <T extends Record<string, unknown>>(row: T, drop: string[] = []) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) continue;
    if (drop.includes(k)) continue;
    out[k] = v;
  }
  return out;
};

const AUDIT = ["user_id", "created_by", "created_at", "updated_at", "is_demo"];

export async function buildResearchContext(
  db: Db,
  args: { companyId: string; storyId?: string | null },
): Promise<ResearchContext> {
  const { companyId, storyId } = args;

  const [
    company,
    story,
    snapshots,
    periods,
    valuations,
    technicals,
    quant,
    sentiment,
    events,
    earnings,
    sources,
    claims,
    conflicts,
    secFilings,
    secFacts,
  ] = await Promise.all([
    db.from("companies").select("*").eq("id", companyId).maybeSingle(),
    storyId ? db.from("stories").select("*").eq("id", storyId).maybeSingle() : null,
    db
      .from("market_snapshots")
      .select("*")
      .eq("company_id", companyId)
      .order("as_of", { ascending: false })
      .limit(3),
    db
      .from("financial_periods")
      .select("*")
      .eq("company_id", companyId)
      .order("fiscal_year", { ascending: false })
      .limit(16),
    db
      .from("valuations")
      .select("*")
      .eq("company_id", companyId)
      .order("as_of", { ascending: false })
      .limit(2),
    db
      .from("technical_metrics")
      .select("*")
      .eq("company_id", companyId)
      .order("as_of", { ascending: false })
      .limit(2),
    db
      .from("quantitative_metrics")
      .select("*")
      .eq("company_id", companyId)
      .order("as_of", { ascending: false })
      .limit(2),
    db
      .from("sentiment_snapshots")
      .select("*")
      .eq("company_id", companyId)
      .order("observed_at", { ascending: false })
      .limit(12),
    db
      .from("events")
      .select("*")
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: false })
      .limit(15),
    db
      .from("earnings_reports")
      .select("*")
      .eq("company_id", companyId)
      .order("earnings_date", { ascending: false })
      .limit(4),
    db
      .from("sources")
      .select("*")
      .eq("company_id", companyId)
      .order("published_at", { ascending: false })
      .limit(40),
    db
      .from("claims")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(60),
    db
      .from("provider_data_conflicts")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(25),
    db
      .from("sec_filings")
      .select("id,form,filing_date,report_date,accession_number,url")
      .eq("company_id", companyId)
      .order("filing_date", { ascending: false })
      .limit(15),
    db
      .from("sec_facts")
      .select(
        "id,metric_key,concept,unit,value,fiscal_year,fiscal_period,form,filed,period_kind,mapping_confidence,start_date,end_date,frame,accession_number",
      )
      .eq("company_id", companyId)
      .order("filed", { ascending: false })
      .limit(60),
  ]);

  if (!company.data) throw new Error("Company not found");

  const rows = <T extends Record<string, unknown>>(r: { data: T[] | null } | null) =>
    (r?.data ?? []) as T[];

  const periodRows = rows(periods);
  const valuationRows = rows(valuations);
  const sourceRows = rows(sources);
  const claimRows = rows(claims);

  const metricKeys: string[] = [];
  for (const p of periodRows) {
    for (const [k, v] of Object.entries(p)) {
      if (v === null || AUDIT.includes(k) || ["id", "company_id"].includes(k)) continue;
      if (typeof v === "number") metricKeys.push(`financial_periods:${String(p["id"])}:${k}`);
    }
  }

  const hasValuationInputs =
    valuationRows.some((v) => {
      const row = v as Record<string, unknown>;
      return ["trailing_pe", "forward_pe", "ev_ebitda", "price_sales", "fcf_yield"].some(
        (k) => row[k] !== null && row[k] !== undefined,
      );
    }) && periodRows.length > 0;

  const bundle = {
    company: strip(company.data as Record<string, unknown>, [...AUDIT, "peers"]),
    peers: (company.data as Record<string, unknown>)["peers"] ?? [],
    story: story?.data ? strip(story.data as Record<string, unknown>, AUDIT) : null,
    market_snapshots: rows(snapshots).map((r) => strip(r, AUDIT)),
    financial_periods: periodRows.map((r) => strip(r, AUDIT)),
    valuations: valuationRows.map((r) => strip(r, AUDIT)),
    technical_metrics: rows(technicals).map((r) => strip(r, AUDIT)),
    quantitative_metrics: rows(quant).map((r) => strip(r, AUDIT)),
    sentiment_snapshots: rows(sentiment).map((r) => strip(r, AUDIT)),
    events: rows(events).map((r) => strip(r, AUDIT)),
    earnings_reports: rows(earnings).map((r) => strip(r, AUDIT)),
    sources: sourceRows.map((r) => strip(r, AUDIT)),
    claims: claimRows.map((r) => strip(r, AUDIT)),
    known_conflicts: rows(conflicts).map((r) => strip(r, AUDIT)),
    sec_filings: rows(secFilings).map((r) => strip(r)),
    // XBRL stamps quarterly, year-to-date and prior-year comparative facts with
    // the same fiscal_year/fiscal_period. Without the duration window they read
    // as four contradictory values for one quarter, so every fact is labelled
    // with its exact window and marked comparative when it predates the period.
    sec_facts: rows(secFacts).map((r) => describeSecFact(strip(r))),
  };

  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(bundle)) {
    if (Array.isArray(v)) counts[k] = v.length;
  }

  return {
    story: (story?.data as Record<string, unknown>) ?? null,
    company: company.data as Record<string, unknown>,
    bundle,
    sourceIds: sourceRows.map((r) => String(r["id"])),
    claimIds: claimRows.map((r) => String(r["id"])),
    metricKeys,
    counts,
    hasValuationInputs,
  };
}

/** Shared system rules — the guardrails every DATABASE-mode call inherits. */
export const DATABASE_MODE_RULES = `You are the research engine of a professional stock research studio.

OPERATING MODE: DATABASE ONLY.
- The JSON context supplied by the user message is your ONLY permitted source of facts.
- You have NO web access in this mode and MUST NOT use anything you remember about the
  company, its numbers, its share price, its management, or recent news. Your training
  knowledge is not evidence.
- If a number, date, name, or event is not present in the context, it does not exist for
  this task. Say "Insufficient Data" and name the missing input instead of estimating,
  approximating, rounding from memory, or reasoning towards a plausible figure.
- Never convert an inference, an analyst view, a company statement, a rumour or a
  scenario into a fact. Categorise it honestly.
- Every factual statement must cite the id of a supplied source (sources[].id) and/or the
  key of a supplied database metric. Ids must be copied verbatim; inventing an id is a
  critical failure. If you cannot cite, downgrade the claim rather than assert it.
- Arithmetic derived from supplied numbers is allowed, but show the inputs.
- Conflicting evidence must be reported as a conflict, never silently resolved.
- Indian companies report in INR and US companies in USD; never convert currencies.
Write in plain, precise, non-promotional English. No investment advice.`;

export function contextMessage(ctx: ResearchContext, task: string): string {
  return [
    task,
    "",
    "VALID SOURCE IDS (only these may be cited):",
    ctx.sourceIds.length ? ctx.sourceIds.join(", ") : "(none — no sources exist for this company)",
    "",
    "VALID CLAIM IDS:",
    ctx.claimIds.length ? ctx.claimIds.join(", ") : "(none)",
    "",
    "DATABASE CONTEXT (JSON):",
    JSON.stringify(ctx.bundle),
  ].join("\n");
}
