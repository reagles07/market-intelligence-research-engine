/**
 * Multi-stock content engine (server only).
 *
 * Same hard rule as the single-stock engine: NO research happens here. Each
 * selected company contributes exactly one immutable research packet version,
 * and the evidence of one company is never allowed to speak for another.
 */
import {
  DEFAULT_PLATFORM,
  DEFAULT_TARGET_DURATION,
  RESEARCH_UPDATE_REQUIRED,
  SHORT_DURATIONS,
  TARGET_DURATIONS,
  countWords,
  estimateSeconds,
  type Platform,
  type TargetDurationKey,
} from "@/lib/content/domain";
import { DISCLAIMER, type Language } from "@/lib/domain";
import { buildScriptContext, type Db, type ScriptContext } from "@/lib/ai/script-context.server";
import {
  longformReadinessForContext,
  narrativeModel,
  TEMPLATE_VERSION,
} from "@/lib/ai/script.server";
import {
  COMBINED_SHORT_CONTRACT,
  COMPANY_SEGMENT_BEATS,
  MULTI_EVIDENCE_CONTRACT,
  MULTI_LONG_SECTIONS,
  MULTI_STORY_ANGLES,
  longformModeInstruction,
} from "@/lib/content/multi-story";
import {
  auditEvidenceSeparation,
  buildEvidenceIndex,
  partitionEvidence,
  type CompanyEvidence,
} from "@/lib/content/multi-evidence";
import {
  evaluateScriptLanguageQuality,
  internalLanguageRepairNote,
} from "@/lib/content/internal-language";
import {
  composeScriptInstructions,
  loadStyleProfile,
  type StyleProfile,
} from "@/lib/ai/style.server";
import { ctaBlock, loadCreatorIdentity, selfIntroBlock } from "@/lib/ai/creator-identity.server";
import {
  combinedShortJsonSchema,
  combinedShortValidator,
  multiLongJsonSchema,
  multiLongValidator,
} from "@/lib/ai/multi-script-schemas";
import { contentHash } from "@/lib/content/hash";
import { callStructured } from "@/lib/openai.server";

export type MultiCompanyContext = {
  ctx: ScriptContext;
  companyId: string;
  ticker: string;
  name: string;
  market: string;
  currency: string;
};

/** Load one curated context per company. Contexts are never merged. */
export async function buildMultiStockContexts(
  db: Db,
  packetIds: string[],
): Promise<MultiCompanyContext[]> {
  const out: MultiCompanyContext[] = [];
  for (const packetId of packetIds) {
    const ctx = await buildScriptContext(db, { packetId });
    out.push({
      ctx,
      companyId: ctx.packet.companyId,
      ticker: String(ctx.company["ticker"] ?? ""),
      name: String(ctx.company["name"] ?? ""),
      market: ctx.market,
      currency: ctx.currency,
    });
  }
  return out;
}

export function companyEvidence(c: MultiCompanyContext): CompanyEvidence {
  return {
    companyId: c.companyId,
    claimIds: c.ctx.claimIds,
    sourceIds: c.ctx.sourceIds,
    researchSectionIds: c.ctx.researchSectionIds,
    metricKeys: c.ctx.metricKeys,
  };
}

/** One prompt message carrying strictly separated per-company context blocks. */
export function multiContextMessage(companies: MultiCompanyContext[], task: string): string {
  const blocks = companies.map((c) =>
    [
      `=== COMPANY BLOCK · company_id ${c.companyId} · ${c.ticker} (${c.name}) ===`,
      `MARKET: ${c.market} · REPORTING CURRENCY: ${c.currency}`,
      `RESEARCH PACKET: ${c.ctx.packet.id} (version ${c.ctx.packet.version})`,
      `VALID CLAIM IDS: ${c.ctx.claimIds.join(", ") || "(none)"}`,
      `VALID SOURCE IDS: ${c.ctx.sourceIds.join(", ") || "(none)"}`,
      `VALID RESEARCH SECTION IDS: ${c.ctx.researchSectionIds.join(", ") || "(none)"}`,
      `VALID METRIC KEYS: ${c.ctx.metricKeys.join(", ") || "(none)"}`,
      `CONTEXT (JSON): ${JSON.stringify(c.ctx.bundle)}`,
      `=== END COMPANY BLOCK ${c.companyId} ===`,
    ].join("\n"),
  );
  return [task, "", ...blocks].join("\n\n");
}

type PersistMultiArgs = {
  db: Db;
  companies: MultiCompanyContext[];
  primary: MultiCompanyContext;
  compositionId: string | null;
  packKey: string;
  seriesPart: number | null;
  format: string;
  language: Language;
  tone: string;
  targetDuration: string;
  title: string;
  body: string;
  model: string;
  userId: string;
  style: StyleProfile | null;
  generationMeta: Record<string, unknown>;
  sections: Array<{
    section_key: string;
    label: string;
    time_range: string | null;
    spoken_text: string;
    on_screen_text: string | null;
    visual_note: string | null;
    micro_hook: string | null;
    claim_ids: string[];
    source_ids: string[];
    research_section_ids: string[];
    metric_keys: string[];
  }>;
};

async function persistMultiScript(a: PersistMultiArgs) {
  const words = countWords(a.body);
  const seconds = estimateSeconds(words);
  const { data, error } = await a.db
    .from("scripts")
    .insert({
      // The primary company keeps the legacy single-company columns populated so
      // every existing screen, audit and query keeps working unchanged.
      company_id: a.primary.companyId,
      story_id: a.primary.ctx.packet.storyId,
      packet_id: a.primary.ctx.packet.id,
      research_packet_version: a.primary.ctx.packet.version,
      composition_id: a.compositionId,
      is_multi_stock: a.companies.length > 1,
      company_ids: a.companies.map((c) => c.companyId),
      format: a.format,
      language: a.language,
      tone: a.tone,
      target_duration: a.targetDuration,
      title: a.title,
      body: a.body,
      model: a.model,
      template_version: TEMPLATE_VERSION,
      generated_at: new Date().toISOString(),
      status: "Needs Fact Check",
      audit_status: "Not Audited",
      is_ai_placeholder: false,
      word_count: words,
      estimated_duration_sec: seconds,
      body_hash: contentHash(a.body),
      audited_body_hash: null,
      ready_for_review: false,
      style_quality_status: "Not Checked",
      series_key: a.packKey,
      series_part: a.seriesPart,
      style_profile_id: a.style?.id ?? null,
      style_profile_version: a.style?.version ?? null,
      generation_meta: a.generationMeta as never,
      created_by: a.userId,
    } as never)
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (a.sections.length) {
    await a.db.from("script_sections").insert(
      a.sections.map((s, i) => ({
        script_id: data.id,
        order_index: i,
        section_key: s.section_key,
        label: s.label,
        time_range: s.time_range,
        spoken_text: s.spoken_text,
        on_screen_text: s.on_screen_text,
        visual_note: s.visual_note,
        micro_hook: s.micro_hook,
        claim_ids: s.claim_ids,
        source_ids: s.source_ids,
        research_section_ids: s.research_section_ids,
        metric_keys: s.metric_keys,
        created_by: a.userId,
      })),
    );
  }

  await a.db.from("script_versions").insert({
    script_id: data.id,
    version: 1,
    body: a.body,
    note: `Multi-stock generation from ${a.companies.length} research packets · ${a.model} · template ${TEMPLATE_VERSION}`,
    packet_id: a.primary.ctx.packet.id,
    research_packet_version: a.primary.ctx.packet.version,
    model: a.model,
    template_version: TEMPLATE_VERSION,
    style_profile_id: a.style?.id ?? null,
    style_profile_version: a.style?.version ?? null,
    audit_status: "Not Audited",
    created_by: a.userId,
  });

  return { scriptId: data.id, words, seconds };
}

const sectionLabel = (key: string) => MULTI_LONG_SECTIONS.find((s) => s.key === key)?.label ?? key;

// ------------------------------------------------------------ long form

export async function runGenerateMultiStockLong(
  db: Db,
  args: {
    packetIds: string[];
    compositionId?: string | null;
    packKey: string;
    longformMode: string;
    allowRanking?: boolean;
    theme?: string | null;
    creatorInstruction?: string | null;
    targetDuration?: TargetDurationKey | null;
    customMinutes?: number | null;
    language?: Language | null;
    tone?: string | null;
    model?: string | null;
    styleProfileId?: string | null;
    platform?: Platform | null;
    userId: string;
  },
) {
  if (args.packetIds.length < 2) {
    return { ok: false as const, error: "A combined long-form video needs at least two stocks." };
  }

  const companies = await buildMultiStockContexts(db, args.packetIds);

  // Each company must independently clear the deterministic storytelling gate —
  // a weak packet is never carried by the others.
  const blocked = companies
    .map((c) => ({ c, r: longformReadinessForContext(c.ctx) }))
    .filter((x) => !x.r.ok);
  if (blocked.length) {
    return {
      ok: false as const,
      error: `${RESEARCH_UPDATE_REQUIRED} — ${blocked.map((b) => `${b.c.ticker}: ${b.r.reason}`).join(" | ")}`,
      researchUpdateRequired: true,
      precheckBlocked: true,
      blockedCompanies: blocked.map((b) => ({
        companyId: b.c.companyId,
        ticker: b.c.ticker,
        reason: b.r.reason,
      })),
    };
  }

  const language: Language = args.language ?? "Tanglish";
  const tone = args.tone ?? "Analytical";
  const duration = args.targetDuration ?? DEFAULT_TARGET_DURATION;
  const durationDef = TARGET_DURATIONS.find((d) => d.key === duration) ?? TARGET_DURATIONS[2];
  const minutes = args.customMinutes ?? null;
  const lowSec = minutes ? minutes * 60 * 0.9 : durationDef.lowSec;
  const highSec = minutes ? minutes * 60 * 1.1 : durationDef.highSec;
  const wordLow = Math.round((lowSec / 60) * 150);
  const wordHigh = Math.round((highSec / 60) * 150);

  const style = await loadStyleProfile(db, args.styleProfileId ?? null);
  const identity = await loadCreatorIdentity(db, args.userId);
  const platform: Platform = args.platform ?? identity.defaultPlatform ?? DEFAULT_PLATFORM;
  const model = narrativeModel(args.model);
  const index = buildEvidenceIndex(companies.map(companyEvidence));

  const roster = companies
    .map(
      (c) => `- company_id ${c.companyId} · ${c.ticker} — ${c.name} (${c.market}, ${c.currency})`,
    )
    .join("\n");

  const formatBlock = `TASK: write ONE coherent multi-stock long-form ${platform} episode covering these companies:
${roster}

TARGET: ${minutes ? `${minutes} minutes` : `${durationDef.label} (${durationDef.minutes})`}, ${wordLow}–${wordHigh} spoken words in total. Never pad.
TONE: ${tone}.
${longformModeInstruction(args.longformMode, Boolean(args.allowRanking))}
${args.theme ? `CREATOR THEME: ${args.theme}` : ""}
${args.creatorInstruction ? `CREATOR INSTRUCTION (obey unless it conflicts with an evidence or safety rule): ${args.creatorInstruction}` : ""}

${MULTI_EVIDENCE_CONTRACT}

THIS IS NOT A CONCATENATION. Do not write several mini-scripts back to back. Write one
episode with a single central thesis, and let each company earn its place in that thesis.

STORY SELECTION: before writing, pick ONE overarching evidence-backed theme and ONE best
verified mini-story per company. Prefer: ${MULTI_STORY_ANGLES.join(", ")}. If a company has
no evidenced history worth telling, use a verified present-day business mystery or contrast
for that company instead. Never invent history, dialogue, motive, a date or a number.

STRUCTURE — emit sections in this order:
- cold_open: open on the shared theme, mystery or question. No greeting, no company list.
- intro_promise: short self intro, then ONE evidence-backed retention promise.
- why_together: say plainly why these specific companies belong in the same video.
- For EACH company, in the order given: one company_block section (company_id set), then a
  transition section (company_id set to the company you are leaving) that compares or
  contrasts it with the next one. The last company needs no transition.
- synthesis: how the companies differ, the common driver connecting them, where the
  evidence is strongest and weakest, and what to watch next.
- full_circle: return to the opening question or story and close it.
- conclusion_cta: balanced, non-advisory conclusion, then the CTA, then the disclaimer.

EACH company_block must cover, in this order: ${COMPANY_SEGMENT_BEATS.join(" → ")}.
Numbers are never dumped: SHOW the number → EXPLAIN what drove it → INTERPRET why it
matters, in plain viewer language.

${selfIntroBlock(identity, "long")}

${ctaBlock(platform, "long")}

EVIDENCE: every section lists the claim ids, source ids, research section ids and metric
keys it rests on, verbatim, and only from the company block it belongs to.`;

  const res = await callStructured({
    operation: "generate-multi-stock-long",
    mode: "DATABASE",
    model,
    instructions: composeScriptInstructions({ language, profile: style, formatBlock }),
    input: multiContextMessage(
      companies,
      `Write the multi-stock episode in ${language} covering ${companies.map((c) => c.ticker).join(", ")}.`,
    ),
    schemaName: "multi_stock_long_script",
    jsonSchema: multiLongJsonSchema,
    validator: multiLongValidator,
    webSearch: false,
    maxOutputTokens: 30000,
    refs: {
      companyId: companies[0]!.companyId,
      storyId: companies[0]!.ctx.packet.storyId,
      packetId: companies[0]!.ctx.packet.id,
    },
    userId: args.userId,
  });

  if (!res.ok)
    return { ok: false as const, error: res.error, needsHumanReview: res.needsHumanReview };
  if (res.data.research_update_required) {
    return {
      ok: false as const,
      error: `${RESEARCH_UPDATE_REQUIRED} — ${res.data.coverage_notes}`,
      researchUpdateRequired: true,
    };
  }

  let draft = res.data;
  const spoken = (d: typeof draft) => d.sections.map((s) => s.spoken_text).join("\n");
  let quality = evaluateScriptLanguageQuality(spoken(draft));
  let internalLanguageRepaired = false;

  if (!quality.ok) {
    const repair = await callStructured({
      operation: "repair-multi-stock-long-language",
      mode: "DATABASE",
      model,
      instructions: composeScriptInstructions({
        language,
        profile: style,
        formatBlock: `${internalLanguageRepairNote(quality.internal.hits)}

Return the SAME sections, in the same order, with the same section_key and company_id
values and the same evidence ids. Only the spoken wording changes.`,
      }),
      input: multiContextMessage(
        companies,
        `Repair the spoken language of this multi-stock episode. PREVIOUS DRAFT (JSON):\n${JSON.stringify(draft)}`,
      ),
      schemaName: "multi_stock_long_script",
      jsonSchema: multiLongJsonSchema,
      validator: multiLongValidator,
      webSearch: false,
      maxOutputTokens: 30000,
      refs: {
        companyId: companies[0]!.companyId,
        storyId: companies[0]!.ctx.packet.storyId,
        packetId: companies[0]!.ctx.packet.id,
      },
      userId: args.userId,
    });
    if (repair.ok && !repair.data.research_update_required) {
      const after = evaluateScriptLanguageQuality(spoken(repair.data), {
        repairAlreadyAttempted: true,
      });
      if (
        after.internal.hits.length < quality.internal.hits.length ||
        after.missingData.mentions < quality.missingData.mentions
      ) {
        draft = repair.data;
        quality = after;
        internalLanguageRepaired = true;
      }
    }
    const final = evaluateScriptLanguageQuality(spoken(draft), { repairAlreadyAttempted: true });
    if (final.action === "research_update_required") {
      return {
        ok: false as const,
        error: `${RESEARCH_UPDATE_REQUIRED} — the draft could only talk about what is missing. Refresh research before writing this episode.`,
        researchUpdateRequired: true,
        languageQualityBlocked: true,
      };
    }
  }

  // Deterministic evidence separation: an id cited for the wrong company is
  // dropped, counted and reported to the reviewer. Nothing is silently mixed.
  const leak = auditEvidenceSeparation(
    draft.sections.map((s) => ({
      sectionKey: s.section_key,
      companyId: s.company_id,
      ids: [...s.claim_ids, ...s.source_ids, ...s.research_section_ids, ...s.metric_keys],
    })),
    index,
  );

  const sections = draft.sections
    .filter((s) => s.spoken_text.trim().length > 0)
    .map((s) => {
      const keep = (ids: string[], valid: Set<string>) => {
        if (!s.company_id) return ids.filter((id) => valid.has(id));
        const p = partitionEvidence(s.company_id, ids, index);
        return p.kept.filter((id) => valid.has(id));
      };
      const allClaims = new Set(companies.flatMap((c) => c.ctx.claimIds));
      const allSources = new Set(companies.flatMap((c) => c.ctx.sourceIds));
      const allSects = new Set(companies.flatMap((c) => c.ctx.researchSectionIds));
      const allMetrics = new Set(companies.flatMap((c) => c.ctx.metricKeys));
      const ticker = companies.find((c) => c.companyId === s.company_id)?.ticker ?? null;
      return {
        section_key: s.section_key,
        label: ticker ? `${sectionLabel(s.section_key)} — ${ticker}` : sectionLabel(s.section_key),
        time_range: s.time_range,
        spoken_text: s.spoken_text,
        on_screen_text: s.on_screen_text,
        visual_note: s.visual_note,
        micro_hook: s.micro_hook,
        claim_ids: keep(s.claim_ids, allClaims),
        source_ids: keep(s.source_ids, allSources),
        research_section_ids: keep(s.research_section_ids, allSects),
        metric_keys: keep(s.metric_keys, allMetrics),
      };
    });

  const body = [
    `# ${draft.working_title}`,
    `${companies.map((c) => `${c.name} (${c.ticker})`).join(" · ")} · ${minutes ? `${minutes} min` : durationDef.label} · ${language} · ${platform}`,
    companies.map((c) => `Research packet v${c.ctx.packet.version} — ${c.ticker}`).join(" · "),
    "",
    `> **Central thesis:** ${draft.central_thesis}`,
    `> **Shared theme:** ${draft.shared_theme}`,
    ...draft.company_angles.map(
      (a) => `> **${a.ticker} angle:** ${a.angle} · risk: ${a.main_risk}`,
    ),
    draft.comparison_caveats.length
      ? `> **Comparison caveats:** ${draft.comparison_caveats.join("; ")}`
      : null,
    "",
    ...sections.flatMap((s) => [
      `## ${s.time_range} — ${s.label}`,
      s.spoken_text,
      s.micro_hook ? `\n_Micro-hook:_ ${s.micro_hook}` : null,
      s.on_screen_text ? `\n**ON-SCREEN:** ${s.on_screen_text}` : null,
      s.visual_note ? `**VISUAL:** ${s.visual_note}` : null,
      "",
    ]),
    "---",
    DISCLAIMER,
  ].filter((l): l is string => typeof l === "string");

  const saved = await persistMultiScript({
    db,
    companies,
    primary: companies[0]!,
    compositionId: args.compositionId ?? null,
    packKey: args.packKey,
    seriesPart: 0,
    format: minutes
      ? "yt_custom"
      : duration === "quick"
        ? "yt_quick"
        : duration === "standard"
          ? "yt_standard"
          : "yt_deep_dive",
    language,
    tone,
    targetDuration: duration,
    title: `${companies.map((c) => c.ticker).join(" · ")} — multi-stock ${args.longformMode} (${language})`,
    body: body.join("\n"),
    model,
    userId: args.userId,
    style,
    generationMeta: {
      operation: "generate-multi-stock-long",
      longform_mode: args.longformMode,
      allow_ranking: Boolean(args.allowRanking),
      theme: args.theme ?? null,
      creator_instruction: args.creatorInstruction ?? null,
      platform,
      pack_key: args.packKey,
      pack_role: "long",
      companies: companies.map((c) => ({
        company_id: c.companyId,
        ticker: c.ticker,
        packet_id: c.ctx.packet.id,
        packet_version: c.ctx.packet.version,
      })),
      central_thesis: draft.central_thesis,
      shared_theme: draft.shared_theme,
      company_angles: draft.company_angles,
      comparison_caveats: draft.comparison_caveats,
      evidence_separation: {
        clean: leak.clean,
        foreign_ids_dropped: leak.foreignCount,
        unknown_ids_dropped: leak.unknownCount,
        details: leak.details,
      },
      internal_language_repaired: internalLanguageRepaired,
      missing_inputs: draft.missing_inputs,
      coverage_notes: draft.coverage_notes,
      usage: res.usage,
    },
    sections,
  });

  return {
    ok: true as const,
    scriptId: saved.scriptId,
    title: draft.working_title,
    words: saved.words,
    estimatedSeconds: saved.seconds,
    companies: companies.map((c) => ({ companyId: c.companyId, ticker: c.ticker })),
    centralThesis: draft.central_thesis,
    evidenceSeparationClean: leak.clean,
    droppedForeignIds: leak.foreignCount,
    internalLanguageRepaired,
    model,
    usage: res.usage,
  };
}

// ------------------------------------------------------------ combined short

export async function runGenerateCombinedShort(
  db: Db,
  args: {
    packetIds: string[];
    compositionId?: string | null;
    packKey: string;
    seriesPart: number;
    theme?: string | null;
    creatorInstruction?: string | null;
    language?: Language | null;
    tone?: string | null;
    model?: string | null;
    styleProfileId?: string | null;
    platform?: Platform | null;
    userId: string;
  },
) {
  const { COMBINED_SHORT_MAX_COMPANIES } = await import("@/lib/content/composer");
  if (args.packetIds.length < 2) {
    return { ok: false as const, error: "A combined Short needs at least two stocks." };
  }
  if (args.packetIds.length > COMBINED_SHORT_MAX_COMPANIES) {
    return {
      ok: false as const,
      error: `A 60-second combined Short cannot cover more than ${COMBINED_SHORT_MAX_COMPANIES} companies. Narrow the selection.`,
    };
  }

  const companies = await buildMultiStockContexts(db, args.packetIds);
  const language: Language = args.language ?? "Tanglish";
  const tone = args.tone ?? "Analytical";
  const style = await loadStyleProfile(db, args.styleProfileId ?? null);
  const identity = await loadCreatorIdentity(db, args.userId);
  const platform: Platform = args.platform ?? identity.defaultPlatform ?? DEFAULT_PLATFORM;
  const model = narrativeModel(args.model);
  const index = buildEvidenceIndex(companies.map(companyEvidence));
  const def = SHORT_DURATIONS.find((d) => d.key === "short_60")!;

  const formatBlock = `TASK: write ONE combined vertical Short for ${platform} covering:
${companies.map((c) => `- company_id ${c.companyId} · ${c.ticker} — ${c.name}`).join("\n")}
TARGET: ${def.label}. Tone: ${tone}.
${args.theme ? `CREATOR THEME: ${args.theme}` : ""}
${args.creatorInstruction ? `CREATOR INSTRUCTION: ${args.creatorInstruction}` : ""}

${MULTI_EVIDENCE_CONTRACT}

${COMBINED_SHORT_CONTRACT}

${selfIntroBlock(identity, "short")}

${ctaBlock(platform, "short")}`;

  const res = await callStructured({
    operation: "generate-combined-short",
    mode: "DATABASE",
    model,
    instructions: composeScriptInstructions({ language, profile: style, formatBlock }),
    input: multiContextMessage(
      companies,
      `Write the combined Short in ${language} covering ${companies.map((c) => c.ticker).join(" vs ")}.`,
    ),
    schemaName: "combined_short_script",
    jsonSchema: combinedShortJsonSchema,
    validator: combinedShortValidator,
    webSearch: false,
    maxOutputTokens: 9000,
    refs: {
      companyId: companies[0]!.companyId,
      storyId: companies[0]!.ctx.packet.storyId,
      packetId: companies[0]!.ctx.packet.id,
    },
    userId: args.userId,
  });

  if (!res.ok)
    return { ok: false as const, error: res.error, needsHumanReview: res.needsHumanReview };
  if (res.data.research_update_required) {
    return {
      ok: false as const,
      error: `${RESEARCH_UPDATE_REQUIRED} — ${res.data.missing_inputs.join("; ")}`,
      researchUpdateRequired: true,
    };
  }

  const draft = res.data;
  const quality = evaluateScriptLanguageQuality(
    [draft.hook_line, ...draft.beats.map((b) => b.spoken_text), draft.cta].join(" "),
  );

  const leak = auditEvidenceSeparation(
    draft.beats.map((b) => ({
      sectionKey: b.beat,
      companyId: b.company_id,
      ids: [...b.claim_ids, ...b.source_ids, ...b.research_section_ids, ...b.metric_keys],
    })),
    index,
  );

  const allClaims = new Set(companies.flatMap((c) => c.ctx.claimIds));
  const allSources = new Set(companies.flatMap((c) => c.ctx.sourceIds));
  const allSects = new Set(companies.flatMap((c) => c.ctx.researchSectionIds));
  const allMetrics = new Set(companies.flatMap((c) => c.ctx.metricKeys));
  const keep = (companyId: string | null, ids: string[], valid: Set<string>) =>
    (companyId ? partitionEvidence(companyId, ids, index).kept : ids).filter((id) => valid.has(id));

  const sections = draft.beats.map((b) => ({
    section_key: b.beat,
    label: b.company_id
      ? `${b.beat} — ${companies.find((c) => c.companyId === b.company_id)?.ticker ?? ""}`
      : b.beat,
    time_range: null,
    spoken_text: b.spoken_text,
    on_screen_text: b.on_screen_text,
    visual_note: null,
    micro_hook: null,
    claim_ids: keep(b.company_id, b.claim_ids, allClaims),
    source_ids: keep(b.company_id, b.source_ids, allSources),
    research_section_ids: keep(b.company_id, b.research_section_ids, allSects),
    metric_keys: keep(b.company_id, b.metric_keys, allMetrics),
  }));

  const body = [
    `# ${companies.map((c) => c.ticker).join(" vs ")} — ${def.label} (${language})`,
    `${draft.angle} · combined Short`,
    "",
    `**HOOK:** ${draft.hook_line}`,
    "",
    ...sections.map((s) =>
      [
        `### ${s.label}`,
        s.spoken_text,
        s.on_screen_text ? `**ON-SCREEN:** ${s.on_screen_text}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    "",
    `**CTA:** ${draft.cta}`,
    draft.visual_notes.length ? `**VISUALS:** ${draft.visual_notes.join(" · ")}` : "",
    "",
    "---",
    DISCLAIMER,
  ]
    .filter(Boolean)
    .join("\n");

  const saved = await persistMultiScript({
    db,
    companies,
    primary: companies[0]!,
    compositionId: args.compositionId ?? null,
    packKey: args.packKey,
    seriesPart: args.seriesPart,
    format: "short_60",
    language,
    tone,
    targetDuration: "short_60",
    title: `${companies.map((c) => c.ticker).join(" vs ")} — combined Short · ${draft.angle}`,
    body,
    model,
    userId: args.userId,
    style,
    generationMeta: {
      operation: "generate-combined-short",
      angle: draft.angle,
      platform,
      pack_key: args.packKey,
      pack_role: "combined_short",
      companies: companies.map((c) => ({
        company_id: c.companyId,
        ticker: c.ticker,
        packet_id: c.ctx.packet.id,
        packet_version: c.ctx.packet.version,
      })),
      evidence_separation: {
        clean: leak.clean,
        foreign_ids_dropped: leak.foreignCount,
        unknown_ids_dropped: leak.unknownCount,
      },
      internal_language_clean: quality.internal.clean,
      missing_inputs: draft.missing_inputs,
      usage: res.usage,
    },
    sections,
  });

  return {
    ok: true as const,
    scriptId: saved.scriptId,
    angle: draft.angle,
    words: saved.words,
    estimatedSeconds: saved.seconds,
    companies: companies.map((c) => ({ companyId: c.companyId, ticker: c.ticker })),
    evidenceSeparationClean: leak.clean,
    droppedForeignIds: leak.foreignCount,
    model,
    usage: res.usage,
  };
}
