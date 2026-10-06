import type { z } from "zod";
import type { AiUsage } from "@/lib/openai.server";
/**
 * Database-only research operations (server only).
 *
 * Each operation: build context from our own tables -> strict structured call ->
 * enforce the safety rules in CODE (never trust the model to police itself) ->
 * persist with full source/claim traceability.
 */
import { RESEARCH_SECTIONS } from "@/lib/domain";
import {
  DATABASE_MODE_RULES,
  buildResearchContext,
  contextMessage,
  type Db,
  type ResearchContext,
} from "@/lib/ai/context.server";
import {
  INSUFFICIENT,
  NO_PRICE_TARGET,
  analyzeStoryJsonSchema,
  analyzeStoryValidator,
  researchPacketJsonSchema,
  researchPacketValidator,
  scenariosJsonSchema,
  scenariosValidator,
  verifyClaimsJsonSchema,
  verifyClaimsValidator,
} from "@/lib/ai/schemas";
import { callStructured } from "@/lib/openai.server";
import { buildClaimEvidence } from "@/lib/research/evidence.server";
import { canBeCritical } from "@/lib/research/readiness";

/** Marks rows written by the AI layer so human edits are never overwritten. */
export const AI_NOTE_PREFIX = "[AI · database-only]";

const TIER1 = "Tier 1 — Primary Source";

type Usage = { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
type OpMeta = { model: string | null; usage: Usage; latencyMs: number };

const meta = (usage: Usage, latencyMs: number, model: string | null): OpMeta => ({
  model,
  usage,
  latencyMs,
});

function traceFooter(sourceIds: string[], claimIds: string[], missing: string[]) {
  const parts: string[] = [];
  if (sourceIds.length) parts.push(`Sources: ${sourceIds.join(", ")}`);
  if (claimIds.length) parts.push(`Claims: ${claimIds.join(", ")}`);
  if (missing.length) parts.push(`Missing inputs: ${missing.join("; ")}`);
  return parts.length ? `\n\n---\n${parts.join("\n")}` : "";
}

// ---------------------------------------------------------------- analyze story

export async function runAnalyzeStory(
  db: Db,
  args: { storyId: string; model?: string | null; userId: string },
) {
  const { data: story } = await db
    .from("stories")
    .select("id,company_id,title")
    .eq("id", args.storyId)
    .maybeSingle();
  if (!story) throw new Error("Story not found");

  const ctx = await buildResearchContext(db, {
    companyId: story.company_id,
    storyId: story.id,
  });

  const res = await callStructured({
    operation: "analyze-story",
    mode: "DATABASE",
    model: args.model ?? null,
    instructions: `${DATABASE_MODE_RULES}

TASK: analyse one story. Establish what happened, the single primary catalyst, the
expectation gap (actual versus expectation) using ONLY supplied consensus, guidance or
prior-period numbers, and why it matters. Extract candidate claims, each categorised and
each carrying the ids of the supplied evidence that supports it. A claim with no
supporting source id and no supporting metric key MUST be categorised UNSUPPORTED.
If the context cannot support a field, return exactly "${INSUFFICIENT}" for it and list
the specific missing inputs in missing_data.`,
    input: contextMessage(
      ctx,
      `Analyse this story: "${story.title}". Context row counts: ${JSON.stringify(ctx.counts)}.`,
    ),
    schemaName: "analyze_story",
    jsonSchema: analyzeStoryJsonSchema,
    validator: analyzeStoryValidator,
    webSearch: false,
    maxOutputTokens: 12000,
    refs: { companyId: story.company_id, storyId: story.id },
    userId: args.userId,
  });

  if (!res.ok)
    return { ok: false as const, error: res.error, needsHumanReview: res.needsHumanReview };

  const validSources = new Set(ctx.sourceIds);
  const validMetrics = new Set(ctx.metricKeys);
  const existingTexts = new Set(
    (ctx.bundle["claims"] as Array<Record<string, unknown>>).map((c) =>
      String(c["claim_text"]).trim().toLowerCase(),
    ),
  );

  const inserted: string[] = [];
  let unsupported = 0;
  let droppedIds = 0;

  for (const c of res.data.candidate_claims) {
    const key = c.claim_text.trim().toLowerCase();
    if (!key || existingTexts.has(key)) continue;
    existingTexts.add(key);

    const sourceIds = c.supporting_source_ids.filter((id) => validSources.has(id));
    const metricKeys = c.supporting_metric_keys.filter((k) => validMetrics.has(k));
    droppedIds +=
      c.supporting_source_ids.length -
      sourceIds.length +
      (c.supporting_metric_keys.length - metricKeys.length);

    const hasEvidence = sourceIds.length > 0 || metricKeys.length > 0;
    // The AI can never mint a verified fact: unsupported stays unsupported,
    // everything else enters the queue as Needs Cross-Check for a human.
    const category = hasEvidence ? c.claim_category : "UNSUPPORTED";
    const status = hasEvidence ? "Needs Cross-Check" : "Unsupported";
    if (!hasEvidence) unsupported += 1;

    const evidence = await buildClaimEvidence(db, {
      companyId: String(story.company_id),
      sourceIds,
      metricKeys,
      claimCategory: category,
    });

    const { data: row } = await db
      .from("claims")
      .insert({
        company_id: story.company_id,
        story_id: story.id,
        ...evidence,
        source_id: sourceIds[0] ?? null,
        claim_text: c.claim_text,
        claim_category: category,
        value: c.value,
        unit: c.unit,
        reporting_period: c.reporting_period,
        verification_status: status,
        confidence: c.confidence,
        // A claim with no evidence is a research gap, not a load-bearing fact
        // of the story. Marking it critical would block readiness forever
        // instead of routing it through Phase 1.3F gap recovery.
        is_critical: hasEvidence && canBeCritical(category) ? c.is_critical : false,
        notes: [
          `${AI_NOTE_PREFIX} analyze-story`,
          `Supporting sources: ${sourceIds.length ? sourceIds.join(", ") : "none"}`,
          `Supporting metrics: ${metricKeys.length ? metricKeys.join(", ") : "none"}`,
          `Reasoning: ${c.reasoning}`,
        ].join("\n"),
        created_by: args.userId,
      })
      .select("id")
      .single();
    if (row) inserted.push(row.id);
  }

  // Fill the story's catalyst only when a human has not written one.
  const storyRow = ctx.story as Record<string, unknown> | null;
  if (
    storyRow &&
    !storyRow["primary_catalyst"] &&
    res.data.primary_catalyst &&
    res.data.primary_catalyst !== INSUFFICIENT
  ) {
    await db
      .from("stories")
      .update({ primary_catalyst: res.data.primary_catalyst })
      .eq("id", story.id);
  }

  return {
    ok: true as const,
    analysis: res.data,
    claimsInserted: inserted.length,
    claimIds: inserted,
    unsupportedClaims: unsupported,
    invalidIdsDropped: droppedIds,
    contextCounts: ctx.counts,
    ...meta(res.usage, res.latencyMs, args.model ?? null),
  };
}

// ---------------------------------------------------------------- verify claims

export async function runVerifyClaims(
  db: Db,
  args: {
    storyId?: string | null;
    companyId?: string | null;
    model?: string | null;
    userId: string;
  },
) {
  let companyId = args.companyId ?? null;
  const storyId = args.storyId ?? null;
  if (storyId) {
    const { data: story } = await db
      .from("stories")
      .select("id,company_id")
      .eq("id", storyId)
      .maybeSingle();
    if (!story) throw new Error("Story not found");
    companyId = story.company_id;
  }
  if (!companyId) throw new Error("companyId or storyId is required");

  const ctx = await buildResearchContext(db, { companyId, storyId });

  const claimRows = ctx.bundle["claims"] as Array<Record<string, unknown>>;
  const scoped = storyId ? claimRows.filter((c) => c["story_id"] === storyId) : claimRows;
  if (!scoped.length) {
    return {
      ok: true as const,
      assessed: 0,
      updated: 0,
      conflicts: 0,
      locked: 0,
      note: "No claims to verify.",
    };
  }

  const sourceTier = new Map<string, string>();
  for (const s of ctx.bundle["sources"] as Array<Record<string, unknown>>) {
    sourceTier.set(String(s["id"]), String(s["source_tier"] ?? ""));
  }

  // Large stories exceed the output budget in one call and the model stops
  // mid-response, so verification is issued in bounded batches.
  const BATCH = 25;
  const batches: Array<Array<Record<string, unknown>>> = [];
  for (let i = 0; i < scoped.length; i += BATCH) batches.push(scoped.slice(i, i + BATCH));

  const assessments: Array<z.infer<typeof verifyClaimsValidator>["assessments"][number]> = [];
  const unverifiable: string[] = [];
  const noteLines: string[] = [];
  let usage: AiUsage | undefined;
  let latency = 0;

  for (const batch of batches) {
    const res = await callStructured({
      operation: "verify-claims",
      mode: "DATABASE",
      model: args.model ?? null,
      instructions: `${DATABASE_MODE_RULES}

TASK: verify each supplied claim against the supplied evidence only.
- "Verified" requires at least one supplied Tier 1 primary source id, or an exact match
  against a supplied database metric. Anything weaker is "Needs Cross-Check".
- If two supplied sources or database rows disagree, return "Conflicting" and describe
  both values in the conflict field. Never pick a winner.
- SEC facts are NOT in conflict merely because several rows share a fiscal_year and
  fiscal_period. Each sec_facts row carries coverage, duration_months, period_window
  and is_prior_year_comparative. A quarterly figure (coverage QUARTER) and a
  year-to-date figure (CUMULATIVE_YTD) for the same quarter measure different windows,
  and rows with is_prior_year_comparative true describe an earlier year. Compare a
  claim only against rows with the SAME coverage and the SAME period window, and report
  a conflict only when two rows with matching coverage and window disagree.
- If nothing in the context supports the claim, return "Unsupported" and category
  UNSUPPORTED. Do not confirm it from memory.
- language_rule states how a script must phrase the claim given its category.
- Assess ONLY the claim ids listed in the user message.`,
      input: contextMessage(
        ctx,
        `Verify these claim ids: ${batch.map((c) => String(c["id"])).join(", ")}`,
      ),
      schemaName: "verify_claims",
      jsonSchema: verifyClaimsJsonSchema,
      validator: verifyClaimsValidator,
      webSearch: false,
      maxOutputTokens: 12000,
      refs: { companyId, storyId },
      userId: args.userId,
    });

    if (!res.ok) {
      if (!assessments.length)
        return { ok: false as const, error: res.error, needsHumanReview: res.needsHumanReview };
      noteLines.push(`Batch failed and was skipped: ${res.error}`);
      continue;
    }
    assessments.push(...res.data.assessments);
    unverifiable.push(...res.data.unverifiable_claim_ids);
    if (res.data.notes) noteLines.push(String(res.data.notes));
    usage = usage
      ? {
          ...usage!,
          inputTokens: (usage!.inputTokens ?? 0) + (res.usage?.inputTokens ?? 0),
          outputTokens: (usage!.outputTokens ?? 0) + (res.usage?.outputTokens ?? 0),
        }
      : res.usage;
    latency += res.latencyMs;
  }

  const byId = new Map(scoped.map((c) => [String(c["id"]), c]));
  const validSources = new Set(ctx.sourceIds);
  let updated = 0;
  let conflicts = 0;
  let locked = 0;
  let downgraded = 0;

  for (const a of assessments) {
    const claim = byId.get(a.claim_id);
    if (!claim) continue;

    const support = (a.supporting_source_ids as string[]).filter((id: string) =>
      validSources.has(id),
    );
    const hasTier1 = support.some((id: string) => sourceTier.get(id) === TIER1);
    const hasMetric = (a.supporting_metric_keys as string[]).some((k: string) =>
      ctx.metricKeys.includes(k),
    );

    let status = a.verification_status;
    if (status === "Verified" && !hasTier1 && !hasMetric) {
      status = "Needs Cross-Check";
      downgraded += 1;
    }
    if (!support.length && !hasMetric && status !== "Conflicting") {
      status = "Unsupported";
    }
    const category = status === "Unsupported" ? "UNSUPPORTED" : a.claim_category;

    const existingStatus = String(claim["verification_status"] ?? "");
    const existingNotes = String(claim["notes"] ?? "");
    const humanLocked =
      (existingStatus === "Verified" || existingStatus === "Rejected") &&
      !existingNotes.startsWith(AI_NOTE_PREFIX);

    if (a.conflict) {
      conflicts += 1;
      await db.from("provider_data_conflicts").insert({
        provider: "AI-VERIFY",
        company_id: companyId,
        entity: "claims",
        entity_id: a.claim_id,
        field: "verification_status",
        existing_value: existingStatus,
        incoming_value: `${status} — ${a.conflict}`,
        resolution: "Kept existing value. Flagged for human review.",
        created_by: args.userId,
      });
    }

    if (humanLocked) {
      locked += 1;
      continue;
    }

    const verifiedMetricKeys = (a.supporting_metric_keys as string[]).filter((k: string) =>
      ctx.metricKeys.includes(k),
    );
    const evidence = await buildClaimEvidence(db, {
      companyId,
      sourceIds: support,
      metricKeys: verifiedMetricKeys,
      claimCategory: category,
    });

    await db
      .from("claims")
      .update({
        verification_status: status,
        claim_category: category,
        confidence: a.confidence,
        // Re-categorising to a non-establishing category also clears the
        // critical flag: an inference can never be a load-bearing fact.
        ...(canBeCritical(category) ? {} : { is_critical: false }),
        ...evidence,
        source_id: support[0] ?? (claim["source_id"] as string | null) ?? null,
        notes: [
          `${AI_NOTE_PREFIX} verify-claims`,
          `Status: ${status}${status !== a.verification_status ? ` (downgraded from ${a.verification_status} — evidence insufficient)` : ""}`,
          `Supporting sources: ${support.length ? support.join(", ") : "none"}`,
          `Supporting metrics: ${a.supporting_metric_keys.join(", ") || "none"}`,
          a.conflict ? `Conflict: ${a.conflict}` : null,
          `Language rule: ${a.language_rule}`,
          `Reasoning: ${a.reasoning}`,
        ]
          .filter(Boolean)
          .join("\n"),
      })
      .eq("id", a.claim_id);
    updated += 1;
  }

  return {
    ok: true as const,
    assessed: assessments.length,
    updated,
    conflicts,
    locked,
    downgraded,
    unverifiable: unverifiable.length,
    notes: noteLines.join("\n"),
    batches: batches.length,
    ...meta(
      usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        webSearchCalls: 0,
        estimatedCostUsd: 0,
      },
      latency,
      args.model ?? null,
    ),
  };
}

// ---------------------------------------------------------------- research packet

export async function runBuildResearchPacket(
  db: Db,
  args: { storyId: string; model?: string | null; userId: string; updateReason?: string | null },
) {
  const { data: story } = await db
    .from("stories")
    .select("id,company_id,title")
    .eq("id", args.storyId)
    .maybeSingle();
  if (!story) throw new Error("Story not found");

  const ctx = await buildResearchContext(db, { companyId: story.company_id, storyId: story.id });

  const res = await callStructured({
    operation: "build-research-packet",
    mode: "DATABASE",
    model: args.model ?? null,
    instructions: `${DATABASE_MODE_RULES}

TASK: produce a research packet with EXACTLY these ${RESEARCH_SECTIONS.length} sections,
one object each, in this order: ${RESEARCH_SECTIONS.map((s) => s.key).join(", ")}.
Each section cites the supplied source ids and claim ids it rests on. A section with no
supporting data must start with "${INSUFFICIENT}" and list what is missing in
missing_inputs — an empty section is far better than a plausible invention. Never restate
an Unsupported or Rejected claim as fact.`,
    input: contextMessage(
      ctx,
      `Build the research packet for story "${story.title}". Context row counts: ${JSON.stringify(ctx.counts)}.`,
    ),
    schemaName: "research_packet",
    jsonSchema: researchPacketJsonSchema,
    validator: researchPacketValidator,
    webSearch: false,
    maxOutputTokens: 24000,
    refs: { companyId: story.company_id, storyId: story.id },
    userId: args.userId,
  });

  if (!res.ok)
    return { ok: false as const, error: res.error, needsHumanReview: res.needsHumanReview };

  // Versioned, never overwritten: a rerun creates v(n+1) pointing at v(n).
  const { data: previous } = await db
    .from("research_packets")
    .select("id,version_number")
    .eq("story_id", story.id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = (previous?.version_number ?? 0) + 1;

  const claimRows = ctx.bundle["claims"] as Array<Record<string, unknown>>;
  const verified = claimRows.filter((c) => c["verification_status"] === "Verified").length;
  const verificationScore = claimRows.length ? Math.round((verified / claimRows.length) * 100) : 0;
  const covered = res.data.sections.filter(
    (s) => s.data_sufficiency !== "INSUFFICIENT" && !s.content.startsWith(INSUFFICIENT),
  ).length;
  const completion = Math.round((covered / RESEARCH_SECTIONS.length) * 100);

  const { data: packet, error: packetError } = await db
    .from("research_packets")
    .insert({
      story_id: story.id,
      company_id: story.company_id,
      status: res.data.overall_data_sufficiency === "SUFFICIENT" ? "In Review" : "Draft",
      completion_pct: completion,
      verification_score: verificationScore,
      version_number: version,
      parent_packet_id: previous?.id ?? null,
      update_reason:
        args.updateReason ??
        (version === 1 ? "Initial database-only packet" : res.data.update_reason),
      created_by: args.userId,
    })
    .select("id,version_number")
    .single();
  if (packetError || !packet) throw new Error(packetError?.message ?? "Could not create packet");

  const validSources = new Set(ctx.sourceIds);
  const validClaims = new Set(ctx.claimIds);
  const byKey = new Map(res.data.sections.map((s) => [s.section_key, s]));

  const rows = RESEARCH_SECTIONS.map((def) => {
    const s = byKey.get(def.key);
    if (!s) {
      return {
        packet_id: packet.id,
        section_key: def.key,
        content: `${INSUFFICIENT} — the research engine returned no content for this section.`,
        created_by: args.userId,
      };
    }
    const srcs = s.supporting_source_ids.filter((id) => validSources.has(id));
    const clms = s.supporting_claim_ids.filter((id) => validClaims.has(id));
    return {
      packet_id: packet.id,
      section_key: def.key,
      content: `${s.content}${traceFooter(srcs, clms, s.missing_inputs)}`,
      created_by: args.userId,
    };
  });

  await db.from("research_sections").insert(rows);

  return {
    ok: true as const,
    packetId: packet.id,
    version: packet.version_number,
    parentPacketId: previous?.id ?? null,
    completionPct: completion,
    verificationScore,
    sections: rows.length,
    insufficientSections: res.data.sections.filter((s) => s.data_sufficiency === "INSUFFICIENT")
      .length,
    missingData: res.data.missing_data,
    ...meta(res.usage, res.latencyMs, args.model ?? null),
  };
}

// ---------------------------------------------------------------- scenarios

export async function runGenerateScenarios(
  db: Db,
  args: { packetId: string; model?: string | null; userId: string },
) {
  const { data: packet } = await db
    .from("research_packets")
    .select("id,story_id,company_id,version_number")
    .eq("id", args.packetId)
    .maybeSingle();
  if (!packet) throw new Error("Research packet not found");

  const { data: existing } = await db
    .from("scenario_forecasts")
    .select("id")
    .eq("packet_id", packet.id)
    .limit(1);
  if (existing?.length) {
    return {
      ok: false as const,
      error:
        "This packet version already has scenarios. Build a new research packet version instead of overwriting them.",
      needsHumanReview: false,
    };
  }

  const ctx = await buildResearchContext(db, {
    companyId: packet.company_id,
    storyId: packet.story_id,
  });

  const res = await callStructured({
    operation: "generate-scenarios",
    mode: "DATABASE",
    model: args.model ?? null,
    instructions: `${DATABASE_MODE_RULES}

TASK: build exactly three scenarios — Bull Case, Base Case, Bear Case.
- probability is a whole-number percent and the three MUST total exactly 100.
- Every scenario needs explicit conditions (what must hold) and explicit invalidation
  conditions (observable events that would kill it). Both use conditional language.
- Price targets are OPTIONAL. Only give valuation_low/valuation_high when the supplied
  valuation and financial rows genuinely support the arithmetic, and show the basis.
  Otherwise return null for both and set valuation_inputs_adequate to false, listing the
  missing inputs. Never estimate a target from memory or from a "reasonable" multiple.
- Valuation inputs detected in the database for this company: ${ctx.hasValuationInputs ? "present" : "NOT sufficient — you should return null price targets"}.`,
    input: contextMessage(
      ctx,
      `Generate Bull/Base/Bear scenarios for research packet version ${packet.version_number}.`,
    ),
    schemaName: "scenario_forecasts",
    jsonSchema: scenariosJsonSchema,
    validator: scenariosValidator,
    webSearch: false,
    maxOutputTokens: 16000,
    refs: { companyId: packet.company_id, storyId: packet.story_id, packetId: packet.id },
    userId: args.userId,
  });

  if (!res.ok)
    return { ok: false as const, error: res.error, needsHumanReview: res.needsHumanReview };

  const validSources = new Set(ctx.sourceIds);
  const validClaims = new Set(ctx.claimIds);
  let targetsWithheld = 0;

  const rows = res.data.scenarios.map((s) => {
    const adequate =
      res.data.valuation_inputs_adequate &&
      ctx.hasValuationInputs &&
      s.valuation_low !== null &&
      s.valuation_high !== null;
    if (!adequate) targetsWithheld += 1;

    const srcs = s.supporting_source_ids.filter((id) => validSources.has(id));
    const clms = s.supporting_claim_ids.filter((id) => validClaims.has(id));

    return {
      packet_id: packet.id,
      scenario_type: s.scenario_type,
      probability: s.probability,
      time_horizon: s.time_horizon,
      assumptions: [
        "Conditions that must hold:",
        ...s.conditions.map((c) => `- ${c}`),
        "",
        s.assumptions,
        traceFooter(srcs, clms, []),
      ].join("\n"),
      financial_assumptions: adequate
        ? `${s.financial_assumptions}\n\nValuation basis: ${s.valuation_basis ?? "not stated"}`
        : `${s.financial_assumptions}\n\n${NO_PRICE_TARGET}.${
            res.data.missing_valuation_inputs.length
              ? ` Missing: ${res.data.missing_valuation_inputs.join("; ")}`
              : ""
          }`,
      catalysts: s.catalysts,
      risks: s.risks,
      valuation_low: adequate ? s.valuation_low : null,
      valuation_high: adequate ? s.valuation_high : null,
      invalidation_conditions: s.invalidation_conditions.map((c) => `- ${c}`).join("\n"),
      confidence: s.confidence,
      created_by: args.userId,
    };
  });

  const { error } = await db.from("scenario_forecasts").insert(rows);
  if (error) throw new Error(error.message);

  return {
    ok: true as const,
    packetId: packet.id,
    scenarios: rows.length,
    probabilityTotal: res.data.scenarios.reduce((sum, s) => sum + s.probability, 0),
    priceTargetsWithheld: targetsWithheld,
    valuationInputsAdequate: res.data.valuation_inputs_adequate && ctx.hasValuationInputs,
    missingValuationInputs: res.data.missing_valuation_inputs,
    ...meta(res.usage, res.latencyMs, args.model ?? null),
  };
}

export type ResearchContextType = ResearchContext;
