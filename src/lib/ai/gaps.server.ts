/**
 * Research gap recovery (Pass 1F, server only).
 *
 * The script writer stays evidence-locked: it never browses. When the fact
 * check finds a statement the packet cannot support, this file decides what
 * kind of failure it is, runs a NARROW web pass for the missing fact only,
 * classifies what came back, and — if real evidence was found — asks the
 * research layer for a NEW packet version. Nothing here writes script text.
 */
import {
  buildScriptContext,
  scriptContextMessage,
  CONTENT_MODE_RULES,
  type Db,
} from "@/lib/ai/script-context.server";
import {
  gapTriageJsonSchema,
  gapTriageValidator,
  gapVerdictJsonSchema,
  gapVerdictValidator,
} from "@/lib/ai/gap-schemas";
import { runTargetedWebResearch } from "@/lib/ai/web.server";
import { TIER_1, TIER_2, TIER_3, TIER_4 } from "@/lib/ai/web-sources";
import { runBuildResearchPacket } from "@/lib/ai/research.server";
import { utilityModel } from "@/lib/ai/script.server";
import { callStructured } from "@/lib/openai.server";
import {
  MAX_GAPS_PER_RUN,
  MAX_QUERIES_PER_GAP,
  STALE_AFTER_DAYS,
  TIME_SENSITIVE_EVIDENCE,
  daysSince,
  gapKey,
  type GapClassification,
  type GapStatus,
  type MissingEvidenceType,
} from "@/lib/content/gaps";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const OPEN_STATUSES = ["OPEN", "RESEARCHING"];
const PRICE_SNAPSHOT_MAX_AGE_HOURS = 24;

type ScriptRow = {
  id: string;
  company_id: string;
  story_id: string | null;
  packet_id: string | null;
  research_packet_version: number | null;
  format: string;
  language: string;
  tone: string | null;
  target_duration: string | null;
  style_profile_id: string | null;
  last_audit_id: string | null;
};

async function loadScript(db: Db, scriptId: string): Promise<ScriptRow> {
  const { data } = await db
    .from("scripts")
    .select(
      "id,company_id,story_id,packet_id,research_packet_version,format,language,tone,target_duration,style_profile_id,last_audit_id",
    )
    .eq("id", scriptId)
    .maybeSingle();
  if (!data) throw new Error("Script not found");
  return data as ScriptRow;
}

async function latestAuditId(db: Db, scriptId: string): Promise<string | null> {
  const { data } = await db
    .from("script_audits")
    .select("id")
    .eq("script_id", scriptId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// ---------------------------------------------------------------- 1. triage

/**
 * Decide, for every failing statement of an audit, whether the fix is already
 * in the packet, needs targeted research, needs a human, or is a deletion.
 */
export async function runDetectResearchGaps(
  db: Db,
  args: { scriptId: string; auditId?: string | null; model?: string | null; userId: string },
) {
  const script = await loadScript(db, args.scriptId);
  if (!script.packet_id)
    return { ok: false as const, error: "This script has no research packet." };

  const auditId = args.auditId ?? script.last_audit_id ?? (await latestAuditId(db, args.scriptId));
  if (!auditId)
    return { ok: false as const, error: "Run the fact check before detecting research gaps." };

  const { data: statements } = await db
    .from("script_statements")
    .select("*")
    .eq("audit_id", auditId)
    .in("status", ["UNSUPPORTED", "CONFLICTING", "NEEDS_QUALIFICATION"]);

  // Cap the triage batch: a very long audit is triaged in order of severity.
  const failing = (statements ?? [])
    .filter((s) => s.severity !== "Info")
    .sort((a, b) => (a.severity === "Blocking" ? -1 : 1) - (b.severity === "Blocking" ? -1 : 1))
    .slice(0, 40);
  if (!failing.length) {
    return {
      ok: true as const,
      gapsCreated: 0,
      gaps: [],
      summary: "The audit found nothing to research.",
    };
  }

  const ctx = await buildScriptContext(db, { packetId: script.packet_id });
  const model = utilityModel(args.model);

  const listed = failing
    .map(
      (s, i) =>
        `[${i}] status=${s.status} severity=${s.severity} type=${s.statement_type}${s.is_numeric ? " numeric" : ""} :: ${s.statement_text}${s.issue ? `\n     issue: ${s.issue}` : ""}${s.research_value ? `\n     research holds: ${s.research_value}` : ""}${s.script_value ? `\n     script says: ${s.script_value}` : ""}`,
    )
    .join("\n");

  const res = await callStructured({
    operation: "detect-research-gaps",
    mode: "DATABASE",
    model,
    instructions: `${CONTENT_MODE_RULES}

TASK: triage failed fact-check statements. You are a research planner, not a writer and
not a researcher. You may NOT state any fact, correct any number or answer any question
here. You only classify each failing statement and, when external evidence is genuinely
missing, propose the searches that would settle it.

Resolution types:
- FIX_FROM_EXISTING — the research packet below ALREADY contains what is needed; the
  script simply worded it wrongly. No research is required.
- RESEARCH_REQUIRED — a real, checkable external fact is missing from the packet
  (a price, an analyst target, company guidance, a filing, an event, a metric).
- HUMAN_REVIEW — the statement rests on judgement, an editorial opinion, an internal
  decision, or something no public source can settle.
- REMOVE — the statement is decorative or redundant; deleting it costs the script nothing.

Rules:
- Prefer FIX_FROM_EXISTING whenever the packet holds the evidence. Research is expensive.
- Give at most ${MAX_QUERIES_PER_GAP} search queries, only for RESEARCH_REQUIRED items.
  Each query must name the company or ticker and anchor a date or period.
- Never propose a query whose only purpose is to confirm an opinion or a price target you
  already believe. State the fact to be established neutrally.
- claim_under_investigation must be ONE specific checkable fact, not a sentence of script.
- If two statements are missing the same fact, still list them separately; the app
  deduplicates.`,
    input: scriptContextMessage(
      ctx,
      `FAILING STATEMENTS FROM THE FACT CHECK (index :: statement):\n${listed}\n\nTriage every index.`,
    ),
    schemaName: "gap_triage",
    jsonSchema: gapTriageJsonSchema,
    validator: gapTriageValidator,
    maxOutputTokens: 12000,
    refs: {
      companyId: script.company_id,
      storyId: script.story_id,
      scriptId: script.id,
      packetId: script.packet_id,
    },
    userId: args.userId,
  });

  if (!res.ok) return { ok: false as const, error: res.error };

  // Existing open/resolved gaps for this company keep us from paying twice.
  const { data: known } = await db
    .from("research_gaps")
    .select("id,gap_key,status")
    .eq("company_id", script.company_id)
    .limit(500);
  const knownByKey = new Map((known ?? []).map((g) => [g.gap_key ?? "", g]));

  const created: Json[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const item of res.data.items) {
    const st = failing[item.statement_index];
    if (!st) continue;

    await db
      .from("script_statements")
      .update({ resolution_type: item.resolution_type })
      .eq("id", st.id);

    if (item.resolution_type !== "RESEARCH_REQUIRED" && item.resolution_type !== "HUMAN_REVIEW")
      continue;

    const key = gapKey({
      companyId: script.company_id,
      evidenceType: item.missing_evidence_type,
      claim: item.claim_under_investigation,
    });
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    const prior = knownByKey.get(key);
    if (prior && OPEN_STATUSES.includes(prior.status)) {
      duplicates += 1;
      continue;
    }

    const { data: row } = await db
      .from("research_gaps")
      .insert({
        company_id: script.company_id,
        story_id: script.story_id,
        script_id: script.id,
        script_version: script.research_packet_version,
        audit_id: auditId,
        statement_id: st.id,
        research_packet_id: script.packet_id,
        ticker: String((ctx.company as Record<string, unknown>)["ticker"] ?? ""),
        market: ctx.market,
        original_statement: st.statement_text,
        missing_evidence_type: item.missing_evidence_type,
        claim_under_investigation: item.claim_under_investigation,
        event_date: item.event_date ? item.event_date.slice(0, 10) : null,
        reason: item.reason,
        priority: item.priority,
        resolution_type: item.resolution_type,
        status: item.resolution_type === "HUMAN_REVIEW" ? "HUMAN_REVIEW" : "OPEN",
        gap_key: key,
        queries: item.search_queries.slice(0, MAX_QUERIES_PER_GAP) as never,
        created_by: args.userId,
      })
      .select("*")
      .single();
    if (row) created.push(row as unknown as Json);
  }

  return {
    ok: true as const,
    auditId,
    gapsCreated: created.length,
    duplicates,
    gaps: created,
    summary: res.data.summary,
    usage: res.usage,
  };
}

// ---------------------------------------------------------------- 2. classify

/**
 * Ask, separately from the search, whether the ONE fact was actually settled.
 * Related-but-different evidence must not close a gap.
 */
async function judgeGapEvidence(args: {
  claim: string;
  evidenceType: string;
  findings: Array<{ statement: string; source_urls: string[] }>;
  model: string | null;
  userId: string;
  companyId: string;
}) {
  if (!args.findings.length) {
    return {
      verdict: "NOT_ESTABLISHED" as const,
      urls: [] as string[],
      explanation: "No evidence was returned.",
    };
  }
  const res = await callStructured({
    operation: "judge-research-gap",
    mode: "DATABASE",
    model: utilityModel(args.model),
    instructions: `You are an evidence adjudicator. You are given ONE claim under investigation and a
list of statements a web search returned, each with its source URLs. Decide whether the
evidence directly establishes that exact claim.

Rules:
- Related, adjacent or near-term facts do NOT establish a different claim. A guidance
  figure for another year, another metric or another basis is NOT_ESTABLISHED.
- CONTRADICTED only when the evidence states the opposite of the claim.
- You may not add knowledge of your own. If the list does not carry the claim, say
  NOT_ESTABLISHED.
- supporting_source_urls must be copied from the list, never invented.`,
    input: [
      `EVIDENCE TYPE: ${args.evidenceType}`,
      `CLAIM UNDER INVESTIGATION: ${args.claim}`,
      "",
      "EVIDENCE RETURNED BY THE SEARCH:",
      ...args.findings.map(
        (f, i) => `[${i}] ${f.statement}\n    sources: ${f.source_urls.join(", ") || "none"}`,
      ),
    ].join("\n"),
    schemaName: "gap_verdict",
    jsonSchema: gapVerdictJsonSchema,
    validator: gapVerdictValidator,
    maxOutputTokens: 4000,
    refs: { companyId: args.companyId },
    userId: args.userId,
  });
  if (!res.ok)
    return { verdict: "NOT_ESTABLISHED" as const, urls: [] as string[], explanation: res.error };
  return {
    verdict: res.data.verdict,
    urls: res.data.supporting_source_urls,
    explanation: res.data.explanation,
    value: res.data.established_value,
  };
}

function classifyFindings(input: {
  evidenceType: MissingEvidenceType;
  verdict: "ESTABLISHED" | "CONTRADICTED" | "NOT_ESTABLISHED";
  noNewInformation: boolean;
  sourcesAccepted: number;
  tiers: string[];
  conflicts: number;
  publishedDates: Array<string | null>;
}): { classification: GapClassification; status: GapStatus; notes: string } {
  if (input.noNewInformation || input.sourcesAccepted === 0) {
    return {
      classification: "NOT_FOUND",
      status: "NOT_FOUND",
      notes:
        "No usable source was found. The statement must be removed or rewritten by hand — nothing may be assumed.",
    };
  }
  if (input.verdict === "CONTRADICTED" || input.conflicts > 0) {
    return {
      classification: "FOUND_CONFLICTING",
      status: "CONFLICTING",
      notes: "Sources disagree with the database. A human must decide which value stands.",
    };
  }
  if (input.verdict !== "ESTABLISHED") {
    return {
      classification: "NOT_FOUND",
      status: "NOT_FOUND",
      notes:
        "The search returned material about the company but nothing that establishes this specific fact. The statement must be removed or rewritten by hand.",
    };
  }
  const strongest = input.tiers.includes(TIER_1)
    ? TIER_1
    : input.tiers.includes(TIER_2)
      ? TIER_2
      : input.tiers.includes(TIER_3)
        ? TIER_3
        : TIER_4;
  if (strongest === TIER_4) {
    return {
      classification: "FOUND_UNRELIABLE",
      status: "NOT_FOUND",
      notes: "Only social or forum chatter was found. That is discovery, never evidence.",
    };
  }
  const ages = input.publishedDates.map((d) => daysSince(d)).filter((n): n is number => n !== null);
  const freshest = ages.length ? Math.min(...ages) : null;
  if (
    TIME_SENSITIVE_EVIDENCE.includes(input.evidenceType) &&
    freshest !== null &&
    freshest > STALE_AFTER_DAYS
  ) {
    return {
      classification: "FOUND_STALE",
      status: "NOT_FOUND",
      notes: `The freshest source is ${freshest} days old — too stale for ${input.evidenceType.toLowerCase().replace(/_/g, " ")}.`,
    };
  }
  if (strongest === TIER_1) {
    return {
      classification: "FOUND_VERIFIED",
      status: "RESOLVED",
      notes:
        "A primary source supports the fact. It may be used once a new packet version is built.",
    };
  }
  return {
    classification: "FOUND_ATTRIBUTED",
    status: "RESOLVED",
    notes: "Evidence found in reporting or a data platform. The script must attribute it by name.",
  };
}

/** Current price is provider data, never a scraped web number. */
async function resolvePriceGap(db: Db, gap: Record<string, unknown>) {
  const { data: snap } = await db
    .from("market_snapshots")
    .select("price,as_of,provider,freshness")
    .eq("company_id", String(gap["company_id"]))
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ageHours = snap?.as_of ? (Date.now() - Date.parse(snap.as_of)) / 3_600_000 : null;
  const fresh =
    ageHours !== null && ageHours <= PRICE_SNAPSHOT_MAX_AGE_HOURS && snap?.price !== null;

  const patch = fresh
    ? {
        status: "RESOLVED",
        classification: "FOUND_VERIFIED",
        resolution_notes: `A market snapshot from ${snap!.as_of} (${snap!.provider ?? "provider"}) already holds the price. Rebuild the packet and regenerate — do not quote a web price.`,
        resolved_at: new Date().toISOString(),
      }
    : {
        status: "NOT_FOUND",
        classification: "PROVIDER_REQUIRED",
        resolution_notes:
          "A live price may only come from the market-data provider, never from a web search. Run a market-data sync for this company, then re-run the gap.",
      };

  await db.from("research_gaps").update(patch).eq("id", String(gap["id"]));
  return { ok: true as const, gapId: String(gap["id"]), ...patch, researched: false as const };
}

// ---------------------------------------------------------------- 3. resolve

export async function runResolveResearchGap(
  db: Db,
  args: { gapId: string; model?: string | null; userId: string },
) {
  const { data: gap } = await db
    .from("research_gaps")
    .select("*")
    .eq("id", args.gapId)
    .maybeSingle();
  if (!gap) return { ok: false as const, error: "Research gap not found" };
  if (gap.status === "RESOLVED")
    return { ok: true as const, gapId: gap.id, status: "RESOLVED", alreadyDone: true };

  if (gap.missing_evidence_type === "CURRENT_PRICE") {
    return resolvePriceGap(db, gap as unknown as Record<string, unknown>);
  }

  await db.from("research_gaps").update({ status: "RESEARCHING" }).eq("id", gap.id);

  const queries = (Array.isArray(gap.queries) ? (gap.queries as string[]) : []).filter(
    (q) => typeof q === "string",
  );
  const run = await runTargetedWebResearch(db, {
    companyId: gap.company_id!,
    storyId: gap.story_id,
    queries,
    focus: gap.claim_under_investigation,
    evidenceType: gap.missing_evidence_type,
    model: args.model ?? null,
    userId: args.userId,
    gapId: gap.id,
  });

  if (!run.ok) {
    await db
      .from("research_gaps")
      .update({ status: "OPEN", resolution_notes: `Search failed: ${run.error}` })
      .eq("id", gap.id);
    return { ok: false as const, error: run.error, gapId: gap.id };
  }

  const judged = await judgeGapEvidence({
    claim: gap.claim_under_investigation,
    evidenceType: gap.missing_evidence_type,
    findings: [
      ...run.result.findings.map((f) => ({ statement: f.statement, source_urls: f.source_urls })),
      ...run.result.management_statements.map((m) => ({
        statement: `${m.speaker}: ${m.statement}`,
        source_urls: m.source_urls,
      })),
      ...run.result.analyst_views.map((v) => ({
        statement: `${v.firm}${v.analyst ? ` (${v.analyst})` : ""}: ${v.rating ?? ""} target ${v.price_target ?? "n/a"} on ${v.view_date ?? "unknown date"}`,
        source_urls: v.source_urls,
      })),
    ],
    model: args.model ?? null,
    userId: args.userId,
    companyId: gap.company_id!,
  });

  const verdict = classifyFindings({
    evidenceType: gap.missing_evidence_type as MissingEvidenceType,
    verdict: judged.verdict,
    noNewInformation: run.noNewInformation,
    sourcesAccepted: run.persisted.sourcesNew + run.persisted.sourcesDuplicate,
    tiers: run.persisted.tiersSeen,
    conflicts: run.persisted.conflicts,
    publishedDates: run.result.sources.map((s) => s.published_at ?? null),
  });

  await db
    .from("research_gaps")
    .update({
      status: verdict.status,
      classification: verdict.classification,
      resolution_notes: `${verdict.notes}\n\nEvidence verdict: ${judged.verdict} — ${judged.explanation}${run.result.delta_summary ? `\n\n${run.result.delta_summary}` : ""}`,
      searches_performed: run.queries.length,
      web_search_calls: run.usage.webSearchCalls,
      ai_calls: 2,
      input_tokens: run.usage.inputTokens,
      output_tokens: run.usage.outputTokens,
      estimated_cost_usd: run.usage.estimatedCostUsd,
      sources_found: run.sourcesFound,
      sources_accepted: run.persisted.sourcesNew,
      sources_rejected: Math.max(
        0,
        run.sourcesFound - run.persisted.sourcesNew - run.persisted.sourcesDuplicate,
      ),
      resolved_source_ids: run.persisted.usedSourceIds,
      resolved_claim_ids: run.persisted.createdClaimIds,
      resolved_at: verdict.status === "RESOLVED" ? new Date().toISOString() : null,
    })
    .eq("id", gap.id);

  return {
    ok: true as const,
    gapId: gap.id,
    researched: true as const,
    status: verdict.status,
    classification: verdict.classification,
    notes: verdict.notes,
    verdict: judged.verdict,
    sourcesFound: run.sourcesFound,
    sourcesAccepted: run.persisted.sourcesNew,
    claimsAdded: run.persisted.claimsAdded,
    costUsd: run.usage.estimatedCostUsd,
  };
}

/**
 * Resolve every open gap of a script, then — only if real evidence arrived —
 * build a NEW research packet version so the script can be regenerated.
 */
export async function runResolveScriptGaps(
  db: Db,
  args: { scriptId: string; model?: string | null; userId: string; rebuildPacket?: boolean },
) {
  const script = await loadScript(db, args.scriptId);
  const { data: open } = await db
    .from("research_gaps")
    .select("id,priority,missing_evidence_type")
    .eq("script_id", args.scriptId)
    .in("status", OPEN_STATUSES)
    .eq("resolution_type", "RESEARCH_REQUIRED")
    .limit(MAX_GAPS_PER_RUN);

  if (!open?.length) {
    return {
      ok: true as const,
      resolved: 0,
      notFound: 0,
      conflicting: 0,
      packet: null,
      gapIds: [],
    };
  }

  let resolved = 0;
  let notFound = 0;
  let conflicting = 0;
  let costUsd = 0;
  const results: Json[] = [];

  for (const g of open) {
    const r = await runResolveResearchGap(db, {
      gapId: g.id,
      model: args.model ?? null,
      userId: args.userId,
    });
    results.push(r as unknown as Json);
    if (!r.ok) continue;
    if (r.status === "RESOLVED") resolved += 1;
    else if (r.status === "CONFLICTING") conflicting += 1;
    else notFound += 1;
    costUsd += Number((r as { costUsd?: number }).costUsd ?? 0);
  }

  let packet: { packetId: string | null; version: number | null } | null = null;
  if (resolved > 0 && args.rebuildPacket !== false && script.story_id) {
    const built = await runBuildResearchPacket(db, {
      storyId: script.story_id,
      model: args.model ?? null,
      updateReason: `Research gap recovery for script ${args.scriptId}: ${resolved} gap(s) closed with new evidence.`,
      userId: args.userId,
    });
    if ((built as { ok?: boolean }).ok !== false) {
      packet = {
        packetId: (built as { packetId?: string }).packetId ?? null,
        version: (built as { version?: number }).version ?? null,
      };
      await db
        .from("research_gaps")
        .update({
          resolved_packet_id: (built as { packetId?: string }).packetId ?? null,
          resolved_packet_version: (built as { version?: number }).version ?? null,
        })
        .in(
          "id",
          open.map((g) => g.id),
        )
        .eq("status", "RESOLVED");
    }
  }

  return {
    ok: true as const,
    resolved,
    notFound,
    conflicting,
    costUsd,
    packet,
    results,
    gapIds: open.map((g) => g.id),
  };
}

// ---------------------------------------------------------------- 4. reads

export async function listScriptGaps(db: Db, scriptId: string) {
  const { data } = await db
    .from("research_gaps")
    .select("*")
    .eq("script_id", scriptId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

// ---------------------------------------------------------------- 5. regenerate

/**
 * Rewrite the script from the LATEST packet version. The old script and its
 * audits stay untouched; provenance is recorded on the new one.
 */
export async function runRegenerateFromUpdatedResearch(
  db: Db,
  args: { scriptId: string; model?: string | null; userId: string },
) {
  const script = await loadScript(db, args.scriptId);
  if (!script.story_id)
    return { ok: false as const, error: "This script is not linked to a story." };

  const { data: latest } = await db
    .from("research_packets")
    .select("id,version_number")
    .eq("story_id", script.story_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return { ok: false as const, error: "No research packet exists for this story." };
  if ((latest.version_number ?? 0) <= (script.research_packet_version ?? 0)) {
    return {
      ok: false as const,
      error: "No newer research packet exists. Resolve the research gaps first.",
    };
  }

  const { runGenerateShortScript, runGenerateLongScript } = await import("@/lib/ai/script.server");
  const isShort = script.format.startsWith("short_");
  const common = {
    packetId: latest.id,
    language: script.language as never,
    tone: script.tone,
    model: args.model ?? null,
    styleProfileId: script.style_profile_id,
    regenerateFromScriptId: script.id,
    userId: args.userId,
  };

  const result = isShort
    ? await runGenerateShortScript(db, { ...common, duration: script.format as never })
    : await runGenerateLongScript(db, {
        ...common,
        targetDuration: (script.target_duration ?? null) as never,
      });

  return { ok: true as const, packetVersion: latest.version_number, result };
}
