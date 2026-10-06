/**
 * Curated Script Context builder (server only).
 *
 * The content engine is deliberately blind: it never touches the web, SEC,
 * IndianAPI or the raw provider tables. It receives ONLY this curated view of
 * ONE research packet version, and every id it may cite comes from here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { RESEARCH_SECTIONS } from "@/lib/domain";
import { RESEARCH_UPDATE_REQUIRED } from "@/lib/content/domain";

export type Db = SupabaseClient<Database>;

/** Claim states that may reach a script. Everything else is excluded outright. */
const ALLOWED_CLAIM_STATUSES = ["Verified", "Needs Cross-Check"];
const EXCLUDED_CATEGORIES = ["UNSUPPORTED"];

const drop = ["created_by", "created_at", "updated_at", "is_demo", "notes"];

function clean<T extends Record<string, unknown>>(row: T, extra: string[] = []) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) continue;
    if (drop.includes(k) || extra.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export type ScriptContext = {
  packet: {
    id: string;
    version: number;
    storyId: string;
    companyId: string;
    completionPct: number;
    verificationScore: number;
  };
  story: Record<string, unknown> | null;
  company: Record<string, unknown>;
  currency: string;
  market: "US" | "India";
  bundle: Record<string, unknown>;
  claimIds: string[];
  sourceIds: string[];
  researchSectionIds: string[];
  metricKeys: string[];
  scenarioCount: number;
  counts: Record<string, number>;
  excluded: { unsupported: number; rumours: number; rejected: number; conflicting: number };
};

export async function buildScriptContext(
  db: Db,
  args: { packetId: string },
): Promise<ScriptContext> {
  const { data: packet } = await db
    .from("research_packets")
    .select("id,story_id,company_id,version_number,completion_pct,verification_score,update_reason")
    .eq("id", args.packetId)
    .maybeSingle();
  if (!packet) throw new Error("Research packet not found");

  const [
    company,
    story,
    sections,
    scenarios,
    claims,
    sources,
    analystViews,
    periods,
    valuations,
    technicals,
    quant,
    sentiment,
    events,
    earnings,
    filings,
    snapshots,
  ] = await Promise.all([
    db.from("companies").select("*").eq("id", packet.company_id).maybeSingle(),
    db.from("stories").select("*").eq("id", packet.story_id).maybeSingle(),
    db.from("research_sections").select("id,section_key,content").eq("packet_id", packet.id),
    db.from("scenario_forecasts").select("*").eq("packet_id", packet.id),
    db
      .from("claims")
      .select("*")
      .eq("company_id", packet.company_id)
      .order("created_at", { ascending: false })
      .limit(120),
    db
      .from("sources")
      .select("id,title,url,publisher,source_type,source_tier,published_at,ai_summary")
      .eq("company_id", packet.company_id)
      .order("published_at", { ascending: false })
      .limit(60),
    db
      .from("analyst_views")
      .select("*")
      .eq("company_id", packet.company_id)
      .order("view_date", { ascending: false })
      .limit(20),
    db
      .from("financial_periods")
      .select("*")
      .eq("company_id", packet.company_id)
      .order("fiscal_year", { ascending: false })
      .limit(12),
    db
      .from("valuations")
      .select("*")
      .eq("company_id", packet.company_id)
      .order("as_of", { ascending: false })
      .limit(1),
    db
      .from("technical_metrics")
      .select("*")
      .eq("company_id", packet.company_id)
      .order("as_of", { ascending: false })
      .limit(1),
    db
      .from("quantitative_metrics")
      .select("*")
      .eq("company_id", packet.company_id)
      .order("as_of", { ascending: false })
      .limit(1),
    db
      .from("sentiment_snapshots")
      .select("*")
      .eq("company_id", packet.company_id)
      .order("observed_at", { ascending: false })
      .limit(10),
    db
      .from("events")
      .select("*")
      .eq("company_id", packet.company_id)
      .order("occurred_at", { ascending: false })
      .limit(10),
    db
      .from("earnings_reports")
      .select("*")
      .eq("company_id", packet.company_id)
      .order("earnings_date", { ascending: false })
      .limit(2),
    db
      .from("sec_filings")
      .select(
        "id,form,filing_date,report_date,accession_number,primary_document,filing_items,items_extracted_at,url",
      )
      .eq("company_id", packet.company_id)
      .order("filing_date", { ascending: false })
      .limit(15),
    db
      .from("market_snapshots")
      .select("*")
      .eq("company_id", packet.company_id)
      .order("as_of", { ascending: false })
      .limit(1),
  ]);

  if (!company.data) throw new Error("Company not found");

  const rows = <T extends Record<string, unknown>>(r: { data: T[] | null } | null) =>
    (r?.data ?? []) as T[];

  const allClaims = rows(claims);
  const excluded = {
    unsupported: allClaims.filter(
      (c) => c["verification_status"] === "Unsupported" || c["claim_category"] === "UNSUPPORTED",
    ).length,
    rumours: allClaims.filter(
      (c) => c["claim_category"] === "RUMOUR" && c["verification_status"] !== "Verified",
    ).length,
    rejected: allClaims.filter((c) => c["verification_status"] === "Rejected").length,
    conflicting: allClaims.filter((c) => c["verification_status"] === "Conflicting").length,
  };

  const usableClaims = allClaims.filter(
    (c) =>
      ALLOWED_CLAIM_STATUSES.includes(String(c["verification_status"])) &&
      !EXCLUDED_CATEGORIES.includes(String(c["claim_category"])) &&
      !(String(c["claim_category"]) === "RUMOUR" && c["verification_status"] !== "Verified"),
  );

  const periodRows = rows(periods);
  const metricKeys: string[] = [];
  for (const p of periodRows) {
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === "number" && !["id", "fiscal_year"].includes(k)) {
        metricKeys.push(`financial_periods:${String(p["id"])}:${k}`);
      }
    }
  }
  for (const t of rows(technicals)) {
    for (const [k, v] of Object.entries(t)) {
      if (typeof v === "number") metricKeys.push(`technical_metrics:${String(t["id"])}:${k}`);
    }
  }
  for (const v0 of rows(valuations)) {
    for (const [k, v] of Object.entries(v0)) {
      if (typeof v === "number") metricKeys.push(`valuations:${String(v0["id"])}:${k}`);
    }
  }
  for (const q of rows(quant)) {
    for (const [k, v] of Object.entries(q)) {
      if (typeof v === "number") metricKeys.push(`quantitative_metrics:${String(q["id"])}:${k}`);
    }
  }

  const sectionRows = rows(sections);
  const sectionLabel = new Map(RESEARCH_SECTIONS.map((s) => [s.key, s.label] as const));

  const companyRow = company.data as Record<string, unknown>;
  const market: "US" | "India" = String(companyRow["exchange"] ?? "").match(/NSE|BSE/i)
    ? "India"
    : String(companyRow["country"] ?? "") === "India"
      ? "India"
      : "US";

  const bundle = {
    packet: {
      id: packet.id,
      version: packet.version_number,
      completion_pct: packet.completion_pct,
      verification_score: packet.verification_score,
      update_reason: packet.update_reason,
    },
    company: clean(companyRow, ["business_model", "moat_evidence"]),
    business_model: companyRow["business_model"] ?? null,
    story: story.data ? clean(story.data as Record<string, unknown>) : null,
    research_sections: sectionRows.map((s) => ({
      id: s.id,
      section_key: s.section_key,
      label: sectionLabel.get(s.section_key as never) ?? s.section_key,
      content: s.content,
    })),
    scenarios: rows(scenarios).map((s) => clean(s)),
    usable_claims: usableClaims.map((c) => clean(c, ["company_id", "story_id"])),
    analyst_views: rows(analystViews).map((a) => clean(a, ["company_id", "story_id"])),
    sources: rows(sources).map((s) => clean(s)),
    financial_periods: periodRows.map((p) => clean(p, ["company_id"])),
    valuations: rows(valuations).map((v) => clean(v, ["company_id"])),
    technical_metrics: rows(technicals).map((t) => clean(t, ["company_id"])),
    quantitative_metrics: rows(quant).map((q) => clean(q, ["company_id"])),
    sentiment_snapshots: rows(sentiment).map((s) => clean(s, ["company_id"])),
    events: rows(events).map((e) => clean(e, ["company_id"])),
    earnings_reports: rows(earnings).map((e) => clean(e, ["company_id"])),
    sec_filings: rows(filings).map((f) => clean(f)),

    market_snapshot: rows(snapshots).map((s) => clean(s, ["company_id"]))[0] ?? null,
    excluded_from_script: excluded,
  };

  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(bundle)) if (Array.isArray(v)) counts[k] = v.length;

  return {
    packet: {
      id: packet.id,
      version: packet.version_number,
      storyId: packet.story_id,
      companyId: packet.company_id,
      completionPct: Number(packet.completion_pct ?? 0),
      verificationScore: Number(packet.verification_score ?? 0),
    },
    story: (story.data as Record<string, unknown>) ?? null,
    company: companyRow,
    currency: String(companyRow["currency"] ?? (market === "India" ? "INR" : "USD")),
    market,
    bundle,
    claimIds: usableClaims.map((c) => String(c["id"])),
    sourceIds: rows(sources).map((s) => String(s["id"])),
    researchSectionIds: sectionRows.map((s) => String(s.id)),
    metricKeys,
    scenarioCount: rows(scenarios).length,
    counts,
    excluded,
  };
}

/** The guardrails every content-generation call inherits. */
export const CONTENT_MODE_RULES = `You are the content writer of a professional stock research studio.

OPERATING MODE: RESEARCH PACKET ONLY.
- The Script Context JSON is your ONLY permitted source of facts. You have no web
  access, no filings access and no market data access in this mode.
- Your training knowledge about this company, its numbers, its price, its management or
  recent news is NOT evidence and must never appear in the script.
- If a fact is absent from the Script Context, write around it or say plainly that the
  research does not cover it. Never estimate, round from memory or infer a number.
- Do NOT invent new scenarios, new price targets, new analyst opinions or new sources.
  Scenarios come only from the supplied scenarios array.

SAFETY CLASSIFICATION RULES (non-negotiable):
- FACT — state directly, only when the supporting claim is verified.
- CALCULATION — state directly only when derived from supplied verified inputs; say what
  it was derived from.
- COMPANY CLAIM — attribute: "Management said…", "The company guided…".
- ANALYST VIEW — attribute the named firm/analyst: "Analysts at <firm> expect…".
- NEWS REPORT — attribute the publication when the point is not independently verified.
- INFERENCE — hedge: "This may suggest…", "One reading is…".
- RUMOUR — normally omit. If unavoidable for the story, say "unconfirmed" in the sentence.
- SCENARIO — conditional only: "If X holds, then…". Never a prediction.
- UNSUPPORTED — prohibited. It is not in your context and must not be written.

NUMBERS:
- Copy values, units, currency and period exactly as the research states them.
- Indian companies report in INR (₹) and US companies in USD ($). Never convert.
- Never swap GAAP and adjusted, quarter and year, revenue and bookings, or run-rate and
  actual figures.

TONE: clear, conversational, analytical, curious. Never promotional. Never a buy or sell
recommendation. No "guaranteed", "must buy", "sure shot", "multibagger" language.

If the packet is so thin that no honest script is possible, set
research_update_required to true and explain what is missing instead of inventing filler.
The literal phrase to use in that case is "${RESEARCH_UPDATE_REQUIRED}".`;

export const LANGUAGE_RULES: Record<string, string> = {
  English:
    "LANGUAGE: plain spoken English. Short sentences suited to a voiceover. No jargon without a one-line explanation.",
  Tamil:
    "LANGUAGE: Tamil script. Keep widely used English finance terms (Revenue, Profit, EPS, Margin, Cash Flow, Capex, Guidance, Valuation, Support, Resistance, Bull Case, Bear Case, Debt, Market, Stock) in English where a Tamil translation would confuse a retail investor.",
  Tanglish: `LANGUAGE: TANGLISH — modern Coimbatore spoken Tamil written in English script, the way a
calm, professional Indian retail investor actually talks. This is a voiceover script: it must
sound natural when read aloud in one take.
- MIX: roughly 70–80% spoken Tamil and 20–30% natural English business vocabulary. Do not
  drop below that Tamil share, and do not drift into full English paragraphs — the Tamil
  connective tissue must carry the sentences.
- Keep these terms in English: Revenue, Profit, EPS, Margin, Cash Flow, Free Cash Flow,
  Capex, Guidance, Valuation, Support, Resistance, Bull Case, Base Case, Bear Case, Debt,
  Market, Stock, P/E, Volume, Trend.
- Do NOT write textbook or literary Tamil, and do NOT translate common finance vocabulary
  into Tamil.
- Do NOT lean on slang, meme phrasing, film dialogue, shouting or hype. The register is
  calm, warm and professional — a knowledgeable friend explaining, not a hype channel.
- Keep FACT and OPINION audibly separate: state a verified fact plainly, and mark every
  interpretation as one ("… nu therigiradhu", "oru reading idhu thaan", "indha data
  padi"). Never let an inference sound like a reported number.
- Sentence length must suit a voiceover: mostly 8–18 words, one idea per sentence.
Example tone: "Revenue vandhu 18% grow aagirukku. Nalla number thaan. Aana oru
problem irukku — margin konjam kammi aayiduchu."`,
};

export function scriptContextMessage(ctx: ScriptContext, task: string): string {
  return [
    task,
    "",
    `MARKET: ${ctx.market} · REPORTING CURRENCY: ${ctx.currency}`,
    `RESEARCH PACKET: ${ctx.packet.id} (version ${ctx.packet.version}, completion ${ctx.packet.completionPct}%, verification ${ctx.packet.verificationScore}%)`,
    "",
    "VALID CLAIM IDS (only these may be cited):",
    ctx.claimIds.length ? ctx.claimIds.join(", ") : "(none)",
    "",
    "VALID SOURCE IDS:",
    ctx.sourceIds.length ? ctx.sourceIds.join(", ") : "(none)",
    "",
    "VALID RESEARCH SECTION IDS:",
    ctx.researchSectionIds.length ? ctx.researchSectionIds.join(", ") : "(none)",
    "",
    "VALID METRIC KEYS:",
    ctx.metricKeys.length ? ctx.metricKeys.join(", ") : "(none)",
    "",
    "SCRIPT CONTEXT (JSON):",
    JSON.stringify(ctx.bundle),
  ].join("\n");
}
