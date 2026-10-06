/**
 * Content engine — script generation (server only).
 *
 * Hard rule for this whole file: NO research happens here. No web search, no
 * SEC, no IndianAPI, no provider tables. Everything comes from one immutable
 * research packet version via buildScriptContext, and every generated script
 * permanently records which packet version produced it.
 */
import {
  CONTENT_PACK_MIN_SHORTS,
  DEFAULT_PLATFORM,
  DEFAULT_TARGET_DURATION,
  LONG_SECTIONS,
  RESEARCH_UPDATE_REQUIRED,
  RETENTION_DEVICE_LABELS,
  SHORT_ANGLE_PLAN,
  SHORT_DURATIONS,
  TARGET_DURATIONS,
  countWords,
  estimateSeconds,
  type Platform,
  type ShortDurationKey,
  type TargetDurationKey,
} from "@/lib/content/domain";
import { DISCLAIMER, type Language } from "@/lib/domain";
import {
  buildScriptContext,
  scriptContextMessage,
  type Db,
  type ScriptContext,
} from "@/lib/ai/script-context.server";
import { evaluateLongformReadiness } from "@/lib/ai/longform-readiness";
import { missingFactCategories } from "@/lib/research/fact-sprint";
import {
  evaluateScriptLanguageQuality,
  internalLanguageRepairNote,
  missingDataRepairNote,
  type InternalLanguageScan,
} from "@/lib/content/internal-language";

import {
  composeScriptInstructions,
  compressionInstruction,
  expansionInstruction,
  loadStyleProfile,
  type StyleProfile,
} from "@/lib/ai/style.server";
import {
  ctaBlock,
  loadCreatorIdentity,
  selfIntroBlock,
  type CreatorIdentity,
} from "@/lib/ai/creator-identity.server";
import { duplicateNote, findNearDuplicates } from "@/lib/content/uniqueness";

import { shortWordBudget } from "@/lib/content/style";
import {
  contentPackageJsonSchema,
  contentPackageValidator,
  longScriptJsonSchema,
  longScriptValidator,
  shortScriptJsonSchema,
  shortScriptValidator,
  shortSeriesJsonSchema,
  shortSeriesValidator,
  type ContentPackageOutput,
  type ShortScriptOutput,
} from "@/lib/ai/script-schemas";
import { contentHash } from "@/lib/content/hash";
import { callStructured, resolveModel } from "@/lib/openai.server";
import { isKnownModel } from "@/lib/openai/models";

export const TEMPLATE_VERSION = "3.0-story-first";

/** Model routing: strong model writes narrative, cheap model does metadata. */
export function narrativeModel(requested?: string | null): string {
  return resolveModel(requested);
}
export function utilityModel(requested?: string | null): string {
  const cheap = "gpt-5.4-mini";
  if (isKnownModel(cheap)) return cheap;
  return resolveModel(requested);
}

const filterIds = (ids: string[], valid: Set<string>) => ids.filter((id) => valid.has(id));

function evidenceFooter(e: {
  claim_ids: string[];
  source_ids: string[];
  metric_keys: string[];
}): string {
  const parts: string[] = [];
  if (e.claim_ids.length) parts.push(`claims ${e.claim_ids.length}`);
  if (e.source_ids.length) parts.push(`sources ${e.source_ids.length}`);
  if (e.metric_keys.length) parts.push(`metrics ${e.metric_keys.length}`);
  return parts.length ? ` _(evidence: ${parts.join(", ")})_` : "";
}

// ---------------------------------------------------------------- helpers

async function loadPacketForStory(db: Db, storyId: string, packetId?: string | null) {
  if (packetId) {
    const { data } = await db
      .from("research_packets")
      .select("id,version_number,story_id")
      .eq("id", packetId)
      .maybeSingle();
    if (!data) throw new Error("Research packet not found");
    return data;
  }
  const { data } = await db
    .from("research_packets")
    .select("id,version_number,story_id")
    .eq("story_id", storyId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("This story has no research packet yet. Build one first.");
  return data;
}

async function nextScriptVersion(db: Db, scriptId: string) {
  const { data } = await db
    .from("script_versions")
    .select("version")
    .eq("script_id", scriptId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.version ?? 0) + 1;
}

type PersistArgs = {
  ctx: ScriptContext;
  format: string;
  language: Language;
  tone: string;
  targetDuration: string;
  title: string;
  body: string;
  model: string;
  userId: string;
  style?: StyleProfile | null;
  regenerateFromScriptId?: string | null;
  seriesKey?: string | null;
  seriesPart?: number | null;
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

async function persistScript(db: Db, a: PersistArgs) {
  const words = countWords(a.body);
  const seconds = estimateSeconds(words);
  const base = {
    company_id: a.ctx.packet.companyId,
    story_id: a.ctx.packet.storyId,
    packet_id: a.ctx.packet.id,
    research_packet_version: a.ctx.packet.version,
    format: a.format,
    language: a.language,
    tone: a.tone,
    target_duration: a.targetDuration,
    title: a.title,
    body: a.body,
    model: a.model,
    template_version: TEMPLATE_VERSION,
    generated_at: new Date().toISOString(),
    // A freshly generated script is never trusted: it must survive the audit.
    status: "Needs Fact Check",
    audit_status: "Not Audited",
    is_ai_placeholder: false,
    word_count: words,
    estimated_duration_sec: seconds,
    body_hash: contentHash(a.body),
    audited_body_hash: null,
    ready_for_review: false,
    style_quality_status: "Not Checked",
    series_key: a.seriesKey ?? null,
    series_part: a.seriesPart ?? null,
    style_profile_id: a.style?.id ?? null,
    style_profile_version: a.style?.version ?? null,
    generation_meta: a.generationMeta as never,
    created_by: a.userId,
  };

  let scriptId: string;
  let reusedExisting = false;

  if (a.regenerateFromScriptId) {
    const { data: prev } = await db
      .from("scripts")
      .select("id,status")
      .eq("id", a.regenerateFromScriptId)
      .maybeSingle();
    // An approved or published script is immutable — regeneration forks it.
    if (prev && !["Approved", "Published"].includes(prev.status)) {
      const { error } = await db.from("scripts").update(base).eq("id", prev.id);
      if (error) throw new Error(error.message);
      scriptId = prev.id;
      reusedExisting = true;
    } else {
      const { data, error } = await db
        .from("scripts")
        .insert({
          ...base,
          generation_meta: {
            ...a.generationMeta,
            forked_from_script_id: a.regenerateFromScriptId,
          } as never,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      scriptId = data.id;
    }
  } else {
    const { data, error } = await db.from("scripts").insert(base).select("id").single();
    if (error) throw new Error(error.message);
    scriptId = data.id;
  }

  if (reusedExisting) {
    await db.from("script_sections").delete().eq("script_id", scriptId);
  }

  if (a.sections.length) {
    await db.from("script_sections").insert(
      a.sections.map((s, i) => ({
        script_id: scriptId,
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

  const version = await nextScriptVersion(db, scriptId);
  await db.from("script_versions").insert({
    script_id: scriptId,
    version,
    body: a.body,
    note: `Generated from research packet v${a.ctx.packet.version} · ${a.model} · template ${TEMPLATE_VERSION}${a.style ? ` · style ${a.style.slug} v${a.style.version}` : ""}`,
    packet_id: a.ctx.packet.id,
    research_packet_version: a.ctx.packet.version,
    model: a.model,
    template_version: TEMPLATE_VERSION,
    style_profile_id: a.style?.id ?? null,
    style_profile_version: a.style?.version ?? null,
    audit_status: "Not Audited",
    created_by: a.userId,
  });

  return { scriptId, version, words, seconds };
}

// ---------------------------------------------------------------- long form

/** Map one curated Script Context onto the deterministic readiness gate. */
export function longformReadinessForContext(ctx: ScriptContext) {
  const bundle = ctx.bundle as Record<string, unknown>;
  const sections = (
    Array.isArray(bundle["research_sections"])
      ? (bundle["research_sections"] as Array<Record<string, unknown>>)
      : []
  ).map((s) => ({
    section_key: String(s["section_key"] ?? ""),
    content: typeof s["content"] === "string" ? s["content"] : null,
  }));
  const businessModel = bundle["business_model"];
  return evaluateLongformReadiness({
    sections,
    businessModelText: typeof businessModel === "string" ? businessModel : null,
    usableClaimCount: ctx.claimIds.length,
    numericFactCount: ctx.metricKeys.length,
    eventCount: ctx.counts["events"] ?? 0,
    financialPeriodCount: ctx.counts["financial_periods"] ?? 0,
    sourceCount: ctx.sourceIds.length,
  });
}

export async function runGenerateLongScript(
  db: Db,
  args: {
    storyId?: string | null;
    packetId?: string | null;
    targetDuration?: TargetDurationKey | null;
    language?: Language | null;
    tone?: string | null;
    model?: string | null;
    styleProfileId?: string | null;
    platform?: Platform | null;
    regenerateFromScriptId?: string | null;
    packKey?: string | null;
    userId: string;
  },
) {
  const duration = args.targetDuration ?? DEFAULT_TARGET_DURATION;
  const durationDef = TARGET_DURATIONS.find((d) => d.key === duration) ?? TARGET_DURATIONS[2];
  const language: Language = args.language ?? "Tanglish";
  const tone = args.tone ?? "Analytical";

  let packetId = args.packetId ?? null;
  if (!packetId) {
    if (!args.storyId) throw new Error("storyId or packetId is required");
    packetId = (await loadPacketForStory(db, args.storyId)).id;
  }

  const ctx = await buildScriptContext(db, { packetId });

  // Deterministic storytelling-readiness gate — runs BEFORE any paid call so a
  // packet made of "Insufficient Data" can never become a padded long-form video.
  const readiness = longformReadinessForContext(ctx);
  if (!readiness.ok) {
    // The blocked reason is structured so the creator UI can offer a fact
    // sprint targeted at exactly these missing categories.
    const missingCategories = missingFactCategories(readiness.failed);
    return {
      ok: false as const,
      error: `${RESEARCH_UPDATE_REQUIRED} — ${readiness.reason}`,
      researchUpdateRequired: true,
      precheckBlocked: true,
      precheck: readiness,
      missingCategories: missingCategories.map((c) => ({
        key: c.key,
        label: c.label,
        question: c.question,
        optional: c.optional,
      })),
      factSprintAvailable: missingCategories.length > 0,
      storyId: ctx.packet.storyId,
      packetId: ctx.packet.id,
    };
  }

  const style = await loadStyleProfile(db, args.styleProfileId ?? null);
  const identity = await loadCreatorIdentity(db, args.userId);
  const platform: Platform = args.platform ?? identity.defaultPlatform ?? DEFAULT_PLATFORM;
  const model = narrativeModel(args.model);
  const wordLow = Math.round((durationDef.lowSec / 60) * 150);
  const wordHigh = Math.round((durationDef.highSec / 60) * 150);
  const targetWords = Math.round((wordLow + wordHigh) / 2);
  const loopCount = Math.max(3, Math.round(durationDef.highSec / 75));

  const res = await callStructured({
    operation: "generate-long-script",
    mode: "DATABASE",
    model,
    instructions: composeScriptInstructions({
      language,
      profile: style,
      formatBlock: `TASK: write a STORY-FIRST long-form ${platform} script for this research packet.
TARGET: ${durationDef.label} (${durationDef.minutes}), ${wordLow}–${wordHigh} spoken words in total
(aim for about ${targetWords}). Natural delivery and factual completeness matter more than
hitting the number exactly — never pad.
TONE: ${tone}.

STORYTELLING BOUNDARY (this outranks every storytelling instruction below):
- Every story beat must come from the Script Context. You may choose the ORDER, the
  emphasis and the spoken framing; you may NEVER invent a founder story, dialogue, a quote,
  a childhood anecdote, a boardroom conversation, a motive, an emotional state, a date, a
  historical incident, a near-bankruptcy claim, a competitor reaction or a number.
- Curiosity must come from real evidence, never from manufactured suspense.
- If the packet holds no evidenced historical story, do NOT manufacture one. Open instead
  with a verified PRESENT-DAY business mystery, contradiction or underappreciated fact from
  the packet, and say plainly what it is.
- THE BRIDGE TEST: a historical story may only be used when it connects directly to
  something that matters today — management culture, the moat, current strategy, the growth
  engine, capital discipline, the business model, competitive position or customer
  behaviour. If that bridge is weak or unevidenced, drop the story and use a present-day
  angle instead.
- If the packet cannot support an honest long-form script at all, set
  research_update_required to true instead of padding it with narrative.

Write EXACTLY these chapters, in this order, using the given time ranges:
${LONG_SECTIONS.map((s) => `- ${s.key} (${s.range}) — ${s.label}`).join("\n")}

Chapter guidance:
- cold_open: open INSIDE a verified founder, business, failure, comeback or competitive
  story — not with the company name, not with a greeting, not with a summary, and never
  with the self intro. Do not reveal everything: close with ONE meaningful curiosity gap,
  the question the viewer now needs answered.
- intro_promise: the short self intro (see SELF INTRO below), then the retention promise /
  open loop (see RETENTION LOOPS below).
- layman_story: keep telling the story in plain language, as if to someone who does not
  follow markets, and build to the conflict: what went wrong, what was hard, what was at
  stake. Evidence only.
- turning_point: what changed and why.
- turning_point / company reveal: name the company here, naturally — e.g. "Indha company
  yaaru-na... [COMPANY]." Reveal it earlier only when the story cannot be told without the
  name, and record where you revealed it in reveal_point.
- why_it_matters_today: the CRITICAL bridge — say out loud why that older story matters to
  this company today. One explicit, evidenced connection, not a vague gesture.
- business_model: what it sells and how the money actually arrives, in simple language.
- why_now: the current catalyst from the packet — the recent event, the market reaction,
  why this company is worth discussing right now.
- numbers: never dump numbers. Each important number must ANSWER a question: SHOW (the
  number) → EXPLAIN (what drove it) → INTERPRET (why it matters). Copy values, units,
  currency and periods exactly as the packet states them.
- growth_potential: where growth can come from and how much runway is evidenced.
  Conditional language, never a forecast of your own.
- competitive_advantage: what actually protects this business, and how durable the packet
  shows it to be. If the evidence is thin, say so rather than asserting a moat.
- counterargument_risk: play devil's advocate — the STRONGEST honest case against the
  story, plus the main real risk. Do not soften it.
- valuation: cheap/fair/expensive versus its own history, peers and the growth embedded in
  the price. If the packet lacks reliable valuation data, say the valuation evidence is
  incomplete and keep this chapter short — never guess.
- market_missing: what the market or investors MAY be missing, framed cautiously and
  hedged as a reading of the evidence, never as a certainty or a call.
- what_to_watch: 2–4 concrete indicators, metrics, dates or events that would prove or
  disprove the thesis. Use the supplied scenarios array where it exists; never invent a
  scenario or a price target.
- full_circle: return to the opening story and close the curiosity gap you opened.
- conclusion_cta: a balanced, non-advisory conclusion, then the CTA, then the educational
  disclaimer. No personalised financial advice.

RETENTION LOOPS: near the beginning (in intro_promise) state ONE evidence-backed open loop
that gives a concrete reason to keep watching. Set retention_device_label to the wording the
EVIDENCE actually supports — one of: ${RETENTION_DEVICE_LABELS.join(", ")} — and use
"secrets" ONLY when the items genuinely are little-known. Set retention_device_count to how
many items you actually deliver, and deliver exactly that many. The count spoken in the
script and retention_device_count must match; aim for around ${loopCount} items so the loops
land roughly every 45–90 seconds.
EXAMPLES OF STYLE ONLY — never copy this wording, vary it every time:
- "Kadaisi varaikum video paarunga... indha company growth-ku pinnadi irukkura 5 important
  signals paakaporom."
- "Video end varaikum stay pannunga... indha business pathi market underestimate pannura 4
  things irukku."
- "Indha company success-ku pinnadi 5 major turning points irukku. Last one dhaan company-a
  completely change pannuchu."
- "Before conclusion-ku varom, 5 numbers check pannuvom."
NEVER use a hard-coded "5 secrets" formula, and never promise items the packet cannot
deliver.

CURIOSITY LOOPS THROUGHOUT: beyond the opening promise, open a fresh natural loop roughly
every 45–90 seconds where it fits — a new unanswered question, a contradiction, a twist, a
risk, a surprising comparison or an evidence transition. Every chapter also ends with a
short micro-hook. VARY the wording; never repeat the same formula twice; never manufacture
suspense the evidence cannot pay off.

${selfIntroBlock(identity, "long")}

${ctaBlock(platform, "long")}

CREATOR METADATA: fill story_angle, reveal_point, key_thesis and main_risk honestly from
what you actually wrote — they are shown to the human reviewer and are NOT spoken in the
voiceover.

EVIDENCE: for every chapter list the claim ids, source ids, research section ids and
metric keys from the Script Context that the chapter rests on. Ids must be verbatim.`,
    }),

    input: scriptContextMessage(
      ctx,
      `Write the ${durationDef.label} script in ${language} for story "${String(ctx.story?.["title"] ?? "")}" (${String(ctx.company["ticker"])}). Context row counts: ${JSON.stringify(ctx.counts)}. Scenarios available: ${ctx.scenarioCount}.`,
    ),
    schemaName: "long_form_script",
    jsonSchema: longScriptJsonSchema,
    validator: longScriptValidator,
    webSearch: false,
    maxOutputTokens: 26000,
    refs: { companyId: ctx.packet.companyId, storyId: ctx.packet.storyId, packetId: ctx.packet.id },
    userId: args.userId,
  });

  if (!res.ok) return { ok: false, error: res.error, needsHumanReview: res.needsHumanReview };
  if (res.data.research_update_required) {
    return {
      ok: false,
      error: `${RESEARCH_UPDATE_REQUIRED} — ${res.data.coverage_notes}`,
      researchUpdateRequired: true,
    };
  }

  // Deterministic language quality gate + ONE bounded repair pass. A viewer must
  // never hear "research packet" or "source id", and a script must never turn the
  // evidence gap itself into the storyline.
  let draft = res.data;
  let internalLanguageRepaired = false;
  const longText = (d: typeof draft) => d.sections.map((s) => s.spoken_text).join("\n");
  let quality = evaluateScriptLanguageQuality(longText(draft));
  let internalScan = quality.internal;
  if (!quality.ok) {
    const repairNotes = [
      quality.internal.clean ? "" : internalLanguageRepairNote(quality.internal.hits),
      quality.missingData.dominated ? missingDataRepairNote(quality.missingData) : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const repair = await callStructured({
      operation: "repair-long-script-language",
      mode: "DATABASE",
      model,
      instructions: composeScriptInstructions({
        language,
        profile: style,
        formatBlock: `${repairNotes}

Return the SAME chapters, in the same order, with the same section_key values, the same
evidence ids and the same metadata fields. Only the spoken wording changes.`,
      }),
      input: scriptContextMessage(
        ctx,
        `Repair the spoken language of this long-form script for ${String(ctx.company["ticker"])}. PREVIOUS DRAFT (JSON):\n${JSON.stringify(draft)}`,
      ),
      schemaName: "long_form_script",
      jsonSchema: longScriptJsonSchema,
      validator: longScriptValidator,
      webSearch: false,
      maxOutputTokens: 26000,
      refs: {
        companyId: ctx.packet.companyId,
        storyId: ctx.packet.storyId,
        packetId: ctx.packet.id,
      },
      userId: args.userId,
    });
    if (repair.ok && !repair.data.research_update_required) {
      const after = evaluateScriptLanguageQuality(longText(repair.data), {
        repairAlreadyAttempted: true,
      });
      const improved =
        after.internal.hits.length < quality.internal.hits.length ||
        after.missingData.mentions < quality.missingData.mentions;
      if (improved) {
        draft = repair.data;
        quality = after;
        internalScan = after.internal;
        internalLanguageRepaired = true;
      }
    }
    // Facts are never repaired by invention: a draft still dominated by
    // missing-data commentary is a research problem, so it is handed back.
    const final = evaluateScriptLanguageQuality(longText(draft), {
      repairAlreadyAttempted: true,
    });
    if (final.action === "research_update_required") {
      return {
        ok: false as const,
        error: `${RESEARCH_UPDATE_REQUIRED} — the draft could only talk about what is missing (${final.missingData.mentions} mentions). Run a fact sprint before writing this long-form.`,
        researchUpdateRequired: true,
        languageQualityBlocked: true,
        missingDataMentions: final.missingData.mentions,
      };
    }
  }

  const validClaims = new Set(ctx.claimIds);
  const validSources = new Set(ctx.sourceIds);
  const validSections = new Set(ctx.researchSectionIds);
  const validMetrics = new Set(ctx.metricKeys);

  const ordered = LONG_SECTIONS.map((def) => {
    const s = draft.sections.find((x) => x.section_key === def.key);
    return {
      section_key: def.key,
      label: def.label,
      time_range: s?.time_range ?? def.range,
      spoken_text: s?.spoken_text ?? "",
      on_screen_text: s?.on_screen_text ?? null,
      visual_note: s?.visual_note ?? null,
      micro_hook: s?.micro_hook ?? null,
      claim_ids: filterIds(s?.claim_ids ?? [], validClaims),
      source_ids: filterIds(s?.source_ids ?? [], validSources),
      research_section_ids: filterIds(s?.research_section_ids ?? [], validSections),
      metric_keys: filterIds(s?.metric_keys ?? [], validMetrics),
    };
  }).filter((s) => s.spoken_text.trim().length > 0);

  const body = [
    `# ${draft.working_title}`,
    `${String(ctx.company["name"])} (${String(ctx.company["ticker"])}) · ${durationDef.label} · ${language} · ${platform}`,
    `Research packet v${ctx.packet.version}`,
    "",
    `> **Story angle:** ${draft.story_angle}`,
    `> **Company revealed at:** ${draft.reveal_point}`,
    `> **Key thesis:** ${draft.key_thesis}`,
    `> **Main risk:** ${draft.main_risk}`,
    `> **Retention loops:** ${draft.retention_device_count} ${draft.retention_device_label}`,
    "",
    ...ordered.flatMap((s) => [
      `## ${s.time_range} — ${s.label}${evidenceFooter(s)}`,
      s.spoken_text,
      s.micro_hook ? `\n_Micro-hook:_ ${s.micro_hook}` : null,
      s.on_screen_text ? `\n**ON-SCREEN:** ${s.on_screen_text}` : null,
      s.visual_note ? `**VISUAL:** ${s.visual_note}` : null,
      "",
    ]),
    "---",
    DISCLAIMER,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const saved = await persistScript(db, {
    ctx,
    format:
      duration === "quick" ? "yt_quick" : duration === "standard" ? "yt_standard" : "yt_deep_dive",
    language,
    tone,
    targetDuration: duration,
    title: `${String(ctx.company["ticker"])} — ${durationDef.label} (${language})`,
    body,
    model,
    userId: args.userId,
    style,
    regenerateFromScriptId: args.regenerateFromScriptId ?? null,
    seriesKey: args.packKey ?? null,
    seriesPart: args.packKey ? 0 : null,
    generationMeta: {
      operation: "generate-long-script",
      target_duration: duration,
      tone,
      platform,
      pack_key: args.packKey ?? null,
      pack_role: args.packKey ? "long" : null,
      style_profile: style ? { slug: style.slug, version: style.version } : null,
      target_word_low: wordLow,
      target_word_high: wordHigh,
      story_angle: draft.story_angle,
      reveal_point: draft.reveal_point,
      key_thesis: draft.key_thesis,
      main_risk: draft.main_risk,
      retention_device_label: draft.retention_device_label,
      retention_device_count: draft.retention_device_count,
      self_intro_line: draft.self_intro_line,
      creator_identity: {
        channel_name: identity.channelName,
        host_name: identity.hostName,
      },
      evidence_reference_counts: {
        claims: new Set(ordered.flatMap((s) => s.claim_ids)).size,
        sources: new Set(ordered.flatMap((s) => s.source_ids)).size,
        metrics: new Set(ordered.flatMap((s) => s.metric_keys)).size,
      },
      missing_inputs: draft.missing_inputs,
      coverage_notes: draft.coverage_notes,
      usage: res.usage,
    },

    sections: ordered,
  });

  return {
    ok: true,
    scriptId: saved.scriptId,
    scriptVersion: saved.version,
    packetId: ctx.packet.id,
    packetVersion: ctx.packet.version,
    title: draft.working_title,
    sections: ordered.length,
    words: saved.words,
    estimatedSeconds: saved.seconds,
    platform,
    storyAngle: draft.story_angle,
    revealPoint: draft.reveal_point,
    keyThesis: draft.key_thesis,
    mainRisk: draft.main_risk,
    retentionDeviceLabel: draft.retention_device_label,
    retentionDeviceCount: draft.retention_device_count,
    missingInputs: draft.missing_inputs,
    coverageNotes: draft.coverage_notes,
    internalLanguageRepaired,
    internalLanguageHits: internalScan.hits.map((h) => h.phrase),

    model,
    usage: res.usage,
    latencyMs: res.latencyMs,
  };
}

// ---------------------------------------------------------------- short form

function shortBody(
  short: ShortScriptOutput | ContentPackageOutput["short_scripts"][number],
  header: string,
): string {
  return [
    header,
    "",
    `**HOOK:** ${short.hook_line}`,
    "",
    ...short.beats.map((b) =>
      [
        `### ${b.beat}`,
        b.spoken_text,
        b.on_screen_text ? `**ON-SCREEN:** ${b.on_screen_text}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    "",
    `**CTA:** ${short.cta}`,
    short.visual_notes.length ? `**VISUALS:** ${short.visual_notes.join(" · ")}` : "",
    "",
    "---",
    DISCLAIMER,
  ]
    .filter(Boolean)
    .join("\n");
}

function shortInstructions(identity: CreatorIdentity, platform: Platform): string {
  return `
STRUCTURE (~60 seconds, same storytelling philosophy as the long form, compressed). The
timings are DELIVERY GUIDANCE, not rigid marks — keep the delivery natural:
- HOOK (0–7s): open inside the story or the contradiction — never with a summary, a
  greeting or the intro.
- CONFLICT (7–13s): the tension, the problem or the thing that does not add up.
- INTRO (13–17s): the mini self intro, only after the hook and the conflict have landed.
- TURN (17–25s): the turning point plus the company reveal that answers the hook.
- WHY_NOW (25–45s): why this matters right now, carried by the strongest verified evidence
  in the packet for this angle.
- OPPORTUNITY_RISK (45–55s): the evidenced upside set against the evidenced risk.
Then the cta field carries the call to action (55–60s).

Each Short covers ONE story angle only and must stand alone. Do not compress the long-form
script, and never invent a founder story, dialogue, quote, motive, emotional state, date,
historical incident or number to make a beat land. Curiosity comes from real evidence only.
List the claim/source/metric ids each beat rests on, verbatim from the Script Context.

${selfIntroBlock(identity, "short")}

${ctaBlock(platform, "short")}`;
}

/** Deterministic spoken word count — the model's own estimate is never trusted. */
function shortSpokenWords(
  d: ShortScriptOutput | ContentPackageOutput["short_scripts"][number],
): number {
  return countWords([d.hook_line, ...d.beats.map((b) => b.spoken_text), d.cta].join(" "));
}

export async function runGenerateShortScript(
  db: Db,
  args: {
    storyId?: string | null;
    packetId?: string | null;
    duration?: ShortDurationKey | null;
    angle?: string | null;
    angleKey?: string | null;
    language?: Language | null;
    tone?: string | null;
    model?: string | null;
    styleProfileId?: string | null;
    platform?: Platform | null;
    regenerateFromScriptId?: string | null;
    packKey?: string | null;
    packPart?: number | null;
    userId: string;
  },
) {
  const durationKey = args.duration ?? "short_60";
  const def =
    SHORT_DURATIONS.find((d) => d.key === durationKey) ??
    SHORT_DURATIONS.find((d) => d.key === "short_60")!;

  const language: Language = args.language ?? "Tanglish";
  const tone = args.tone ?? "Analytical";

  let packetId = args.packetId ?? null;
  if (!packetId) {
    if (!args.storyId) throw new Error("storyId or packetId is required");
    packetId = (await loadPacketForStory(db, args.storyId)).id;
  }

  const ctx = await buildScriptContext(db, { packetId });
  const style = await loadStyleProfile(db, args.styleProfileId ?? null);
  const identity = await loadCreatorIdentity(db, args.userId);
  const platform: Platform = args.platform ?? identity.defaultPlatform ?? DEFAULT_PLATFORM;
  const model = narrativeModel(args.model);
  // The style profile owns the Short word budgets; they replace the generic default.
  const budget = shortWordBudget(style?.wordBudgets ?? {}, durationKey);
  const shortRules = shortInstructions(identity, platform);

  const formatBlock = `TASK: write ONE vertical Short for ${platform}.
TARGET: ${def.label} — ${budget.low}–${budget.high} spoken words in total (hook + beats + CTA).
Tone: ${tone}.
${args.angle ? `ANGLE (mandatory): ${args.angle}` : "Pick the single strongest angle in the packet."}
${args.angleKey ? `angle_key must be exactly "${args.angleKey}".` : `Set angle_key to the planned angle key that fits best, or "other".`}
${shortRules}`;

  const res = await callStructured({
    operation: "generate-short-script",
    mode: "DATABASE",
    model,
    instructions: composeScriptInstructions({ language, profile: style, formatBlock }),
    input: scriptContextMessage(
      ctx,
      `Write the ${def.label} in ${language} for ${String(ctx.company["ticker"])}. Context row counts: ${JSON.stringify(ctx.counts)}.`,
    ),
    schemaName: "short_form_script",
    jsonSchema: shortScriptJsonSchema,
    validator: shortScriptValidator,
    webSearch: false,
    maxOutputTokens: 9000,
    refs: { companyId: ctx.packet.companyId, storyId: ctx.packet.storyId, packetId: ctx.packet.id },
    userId: args.userId,
  });

  if (!res.ok) return { ok: false, error: res.error, needsHumanReview: res.needsHumanReview };
  if (res.data.research_update_required) {
    return {
      ok: false,
      error: `${RESEARCH_UPDATE_REQUIRED} — ${res.data.missing_inputs.join("; ")}`,
      researchUpdateRequired: true,
    };
  }

  let draft: ShortScriptOutput = res.data;
  let spokenWords = shortSpokenWords(draft);
  let compressed = false;
  let expanded = false;

  // Up to TWO evidence-locked budget passes. BOTH bounds are constraints: an
  // over-long draft is compressed, an under-length draft is expanded. No new
  // facts may enter in either direction.
  for (let pass = 0; pass < 2; pass++) {
    const tooLong = spokenWords > budget.high;
    const tooShort = spokenWords < budget.low;
    if (!tooLong && !tooShort) break;

    const retry = await callStructured({
      operation: tooLong ? "compress-short-script" : "expand-short-script",
      mode: "DATABASE",
      model,
      instructions: composeScriptInstructions({
        language,
        profile: style,
        formatBlock: `${
          tooLong
            ? compressionInstruction(budget, spokenWords)
            : expansionInstruction(budget, spokenWords)
        }\n${shortRules}`,
      }),
      input: scriptContextMessage(
        ctx,
        `${tooLong ? "Compress" : "Expand"} this Short for ${String(ctx.company["ticker"])} to ${budget.low}–${budget.high} spoken words (currently ${spokenWords}). PREVIOUS DRAFT (JSON):\n${JSON.stringify(draft)}`,
      ),
      schemaName: "short_form_script",
      jsonSchema: shortScriptJsonSchema,
      validator: shortScriptValidator,
      webSearch: false,
      maxOutputTokens: 9000,
      refs: {
        companyId: ctx.packet.companyId,
        storyId: ctx.packet.storyId,
        packetId: ctx.packet.id,
      },
      userId: args.userId,
    });
    if (!retry.ok || retry.data.research_update_required) break;

    const retryWords = shortSpokenWords(retry.data);
    // Only keep the rewrite when it actually moves toward the band.
    const improved = tooLong
      ? retryWords < spokenWords && retryWords >= budget.low
      : retryWords > spokenWords && retryWords <= budget.high;
    const closer =
      Math.abs(retryWords - (tooLong ? budget.high : budget.low)) <
      Math.abs(spokenWords - (tooLong ? budget.high : budget.low));
    if (!improved && !closer) break;

    draft = retry.data;
    spokenWords = retryWords;
    if (tooLong) compressed = true;
    else expanded = true;
  }

  const validClaims = new Set(ctx.claimIds);
  const validSources = new Set(ctx.sourceIds);
  const validMetrics = new Set(ctx.metricKeys);

  const sections = draft.beats.map((b) => ({
    section_key: b.beat,
    label: b.beat,
    time_range: null,
    spoken_text: b.spoken_text,
    on_screen_text: b.on_screen_text,
    visual_note: null,
    micro_hook: null,
    claim_ids: filterIds(b.claim_ids, validClaims),
    source_ids: filterIds(b.source_ids, validSources),
    research_section_ids: filterIds(b.research_section_ids, new Set(ctx.researchSectionIds)),
    metric_keys: filterIds(b.metric_keys, validMetrics),
  }));

  const body = shortBody(
    draft,
    `# ${String(ctx.company["ticker"])} — ${def.label} (${language})\n${draft.angle} · research packet v${ctx.packet.version}`,
  );

  const saved = await persistScript(db, {
    ctx,
    format: durationKey,
    language,
    tone,
    targetDuration: durationKey,
    title: `${String(ctx.company["ticker"])} — ${def.label} · ${draft.angle}`,
    body,
    model,
    userId: args.userId,
    style,
    regenerateFromScriptId: args.regenerateFromScriptId ?? null,
    seriesKey: args.packKey ?? null,
    seriesPart: args.packPart ?? null,
    generationMeta: {
      operation: "generate-short-script",
      angle: draft.angle,
      angle_key: draft.angle_key,
      platform,
      pack_key: args.packKey ?? null,
      pack_role: args.packKey ? "short" : null,
      style_profile: style ? { slug: style.slug, version: style.version } : null,
      target_word_low: budget.low,
      target_word_high: budget.high,
      spoken_word_count: spokenWords,
      compression_pass: compressed,
      expansion_pass: expanded,

      missing_inputs: draft.missing_inputs,
      usage: res.usage,
    },

    sections,
  });

  return {
    ok: true,
    scriptId: saved.scriptId,
    scriptVersion: saved.version,
    packetId: ctx.packet.id,
    packetVersion: ctx.packet.version,
    angle: draft.angle,
    words: saved.words,
    spokenWords,
    targetWordLow: budget.low,
    targetWordHigh: budget.high,
    compressionPass: compressed,
    expansionPass: expanded,

    withinWordBudget: spokenWords >= budget.low && spokenWords <= budget.high,
    styleProfile: style ? { id: style.id, name: style.name, version: style.version } : null,
    estimatedSeconds: saved.seconds,
    missingInputs: draft.missing_inputs,
    model,
    usage: res.usage,
    latencyMs: res.latencyMs,
  };
}

// ---------------------------------------------------------------- shorts pack

const ANGLE_PLAN_BLOCK = SHORT_ANGLE_PLAN.map(
  (a, i) => `${i + 1}. ${a.key} — ${a.label}: ${a.brief}`,
).join("\n");

/** Flattened spoken text of one Short, used for the near-duplicate check. */
function shortText(s: { hook_line: string; beats: Array<{ spoken_text: string }> }): string {
  return [s.hook_line, ...s.beats.map((b) => b.spoken_text)].join(" ");
}

export async function runGenerateShortSeries(
  db: Db,
  args: {
    storyId?: string | null;
    packetId?: string | null;
    language?: Language | null;
    tone?: string | null;
    model?: string | null;
    styleProfileId?: string | null;
    platform?: Platform | null;
    packKey?: string | null;
    userId: string;
  },
) {
  const language: Language = args.language ?? "Tanglish";
  const tone = args.tone ?? "Analytical";

  let packetId = args.packetId ?? null;
  if (!packetId) {
    if (!args.storyId) throw new Error("storyId or packetId is required");
    packetId = (await loadPacketForStory(db, args.storyId)).id;
  }

  const ctx = await buildScriptContext(db, { packetId });
  const style = await loadStyleProfile(db, args.styleProfileId ?? null);
  const identity = await loadCreatorIdentity(db, args.userId);
  const platform: Platform = args.platform ?? identity.defaultPlatform ?? DEFAULT_PLATFORM;
  const model = narrativeModel(args.model);
  const seriesBudget = shortWordBudget(style?.wordBudgets ?? {}, "short_60");
  const shortRules = shortInstructions(identity, platform);

  const packBlock = `TASK: write ${CONTENT_PACK_MIN_SHORTS} standalone 60-second Shorts for ${platform}.
TARGET per Short: ${seriesBudget.low}–${seriesBudget.high} spoken words. Tone: ${tone}.

ANGLE PLAN — one Short per angle, in this order:
${ANGLE_PLAN_BLOCK}

SUBSTITUTION RULE: if the packet genuinely cannot evidence one of these angles, do NOT pad
it and do NOT paraphrase another Short. Replace it with a different VERIFIED angle from the
packet, set that Short's angle_key to "other", and name the substitute in angle.

UNIQUENESS (hard requirement): the ${CONTENT_PACK_MIN_SHORTS} Shorts must be genuinely
different pieces — different opening line, different central fact, different evidence and a
different takeaway. Two Shorts must never rest on the same headline number or the same
sentence rewritten. Each Short must stand alone for a viewer who has seen none of the others.
${shortRules}`;

  const res = await callStructured({
    operation: "generate-short-series",
    mode: "DATABASE",
    model,
    instructions: composeScriptInstructions({ language, profile: style, formatBlock: packBlock }),
    input: scriptContextMessage(
      ctx,
      `Write the ${CONTENT_PACK_MIN_SHORTS}-Short pack in ${language} for ${String(ctx.company["ticker"])}. Context row counts: ${JSON.stringify(ctx.counts)}.`,
    ),
    schemaName: "short_series",
    jsonSchema: shortSeriesJsonSchema,
    validator: shortSeriesValidator,
    webSearch: false,
    maxOutputTokens: 30000,
    refs: { companyId: ctx.packet.companyId, storyId: ctx.packet.storyId, packetId: ctx.packet.id },
    userId: args.userId,
  });

  if (!res.ok) return { ok: false, error: res.error, needsHumanReview: res.needsHumanReview };
  if (res.data.research_update_required) {
    return {
      ok: false,
      error: `${RESEARCH_UPDATE_REQUIRED} — ${res.data.missing_inputs.join("; ")}`,
      researchUpdateRequired: true,
    };
  }

  let shorts = res.data.shorts;
  let dup = findNearDuplicates(shorts.map(shortText));
  let uniquenessRetry = false;

  // ONE deterministic uniqueness pass: near-duplicate Shorts are rewritten with
  // the offending overlap named. No new evidence may enter the rewrite.
  if (dup.pairs.length) {
    const retry = await callStructured({
      operation: "diversify-short-series",
      mode: "DATABASE",
      model,
      instructions: composeScriptInstructions({
        language,
        profile: style,
        formatBlock: `${packBlock}

UNIQUENESS REPAIR PASS. The previous draft collapsed into near-duplicates:
${duplicateNote(dup.pairs)}.
Rewrite ONLY those Shorts (${dup.rewriteIndexes.map((i) => `Short ${i + 1}`).join(", ")}) so
each rests on different evidence and tells a different story. Keep the other Shorts exactly
as they were. Do not introduce any fact that is not already in the Script Context, and do not
drop a required attribution or hedge.`,
      }),
      input: scriptContextMessage(
        ctx,
        `De-duplicate this Shorts pack for ${String(ctx.company["ticker"])}. PREVIOUS DRAFT (JSON):\n${JSON.stringify(res.data.shorts)}`,
      ),
      schemaName: "short_series",
      jsonSchema: shortSeriesJsonSchema,
      validator: shortSeriesValidator,
      webSearch: false,
      maxOutputTokens: 30000,
      refs: {
        companyId: ctx.packet.companyId,
        storyId: ctx.packet.storyId,
        packetId: ctx.packet.id,
      },
      userId: args.userId,
    });
    if (retry.ok && !retry.data.research_update_required) {
      const retryDup = findNearDuplicates(retry.data.shorts.map(shortText));
      // Only keep the rewrite when it actually reduces the overlap.
      if (retryDup.pairs.length < dup.pairs.length) {
        shorts = retry.data.shorts;
        dup = retryDup;
        uniquenessRetry = true;
      }
    }
  }

  // ONE bounded language-quality repair pass for the pack, same contract as
  // the long-form gate: wording only, no new evidence.
  let shortsQuality = evaluateScriptLanguageQuality(shorts.map(shortText).join("\n"));
  let languageScan: InternalLanguageScan = shortsQuality.internal;
  let shortsLanguageRepaired = false;
  if (!shortsQuality.ok) {
    const repairNotes = [
      shortsQuality.internal.clean ? "" : internalLanguageRepairNote(shortsQuality.internal.hits),
      shortsQuality.missingData.dominated ? missingDataRepairNote(shortsQuality.missingData) : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const repair = await callStructured({
      operation: "repair-short-series-language",
      mode: "DATABASE",
      model,
      instructions: composeScriptInstructions({
        language,
        profile: style,
        formatBlock: `${repairNotes}

Return all ${shorts.length} Shorts in the same order with the same angles and the same
evidence ids. Only the spoken wording changes.`,
      }),
      input: scriptContextMessage(
        ctx,
        `Repair the spoken language of this Shorts pack for ${String(ctx.company["ticker"])}. PREVIOUS DRAFT (JSON):\n${JSON.stringify(shorts)}`,
      ),
      schemaName: "short_series",
      jsonSchema: shortSeriesJsonSchema,
      validator: shortSeriesValidator,
      webSearch: false,
      maxOutputTokens: 30000,
      refs: {
        companyId: ctx.packet.companyId,
        storyId: ctx.packet.storyId,
        packetId: ctx.packet.id,
      },
      userId: args.userId,
    });
    if (repair.ok && !repair.data.research_update_required) {
      const after = evaluateScriptLanguageQuality(repair.data.shorts.map(shortText).join("\n"), {
        repairAlreadyAttempted: true,
      });
      if (
        after.internal.hits.length < shortsQuality.internal.hits.length ||
        after.missingData.mentions < shortsQuality.missingData.mentions
      ) {
        shorts = repair.data.shorts;
        shortsQuality = after;
        languageScan = after.internal;

        shortsLanguageRepaired = true;
      }
    }
  }

  const validClaims = new Set(ctx.claimIds);
  const validSources = new Set(ctx.sourceIds);
  const validMetrics = new Set(ctx.metricKeys);
  const validSections = new Set(ctx.researchSectionIds);
  const seriesKey = args.packKey ?? `series-${ctx.packet.id.slice(0, 8)}-${Date.now()}`;
  const created: Array<{ scriptId: string; angle: string; angleKey: string; words: number }> = [];

  for (const [i, short] of shorts.entries()) {
    const saved = await persistScript(db, {
      ctx,
      format: "short_series",
      language,
      tone,
      targetDuration: "short_60",
      title: `${String(ctx.company["ticker"])} — Short ${i + 1}: ${short.angle}`,
      body: shortBody(
        short,
        `# ${String(ctx.company["ticker"])} — Short ${i + 1} of ${shorts.length} (${language})\n${short.angle} · ${platform} · research packet v${ctx.packet.version}`,
      ),
      model,
      userId: args.userId,
      style,
      seriesKey,
      seriesPart: i + 1,
      generationMeta: {
        operation: "generate-short-series",
        angle: short.angle,
        angle_key: short.angle_key,
        part: i + 1,
        platform,
        pack_key: args.packKey ?? null,
        pack_role: args.packKey ? "short" : null,
        style_profile: style ? { slug: style.slug, version: style.version } : null,
        target_word_low: seriesBudget.low,
        target_word_high: seriesBudget.high,
        spoken_word_count: shortSpokenWords(short),
        uniqueness_retry: uniquenessRetry,
        uniqueness_note: duplicateNote(dup.pairs),
        usage: res.usage,
      },

      sections: short.beats.map((b) => ({
        section_key: b.beat,
        label: b.beat,
        time_range: null,
        spoken_text: b.spoken_text,
        on_screen_text: b.on_screen_text,
        visual_note: null,
        micro_hook: null,
        claim_ids: filterIds(b.claim_ids, validClaims),
        source_ids: filterIds(b.source_ids, validSources),
        research_section_ids: filterIds(b.research_section_ids, validSections),
        metric_keys: filterIds(b.metric_keys, validMetrics),
      })),
    });
    created.push({
      scriptId: saved.scriptId,
      angle: short.angle,
      angleKey: short.angle_key,
      words: saved.words,
    });
  }

  return {
    ok: true,
    seriesKey,
    packetId: ctx.packet.id,
    packetVersion: ctx.packet.version,
    platform,
    shorts: created,
    count: created.length,
    metMinimumShorts: created.length >= CONTENT_PACK_MIN_SHORTS,
    uniquenessRetry,
    uniquenessNote: duplicateNote(dup.pairs),
    internalLanguageRepaired: shortsLanguageRepaired,
    internalLanguageHits: languageScan.hits.map((h) => h.phrase),
    missingInputs: res.data.missing_inputs,
    model,
    usage: res.usage,
    latencyMs: res.latencyMs,
  };
}

// ---------------------------------------------------------------- content pack

/**
 * ONE creator action → one content pack: {CONTENT_PACK_MIN_SHORTS}+ distinct
 * Shorts plus one long-form script, all bound to the same packet version by a
 * shared pack key. Nothing here researches, approves or publishes anything: the
 * scripts land as "Needs Fact Check" exactly like every other generation.
 */
export async function runGenerateContentPack(
  db: Db,
  args: {
    storyId?: string | null;
    packetId?: string | null;
    targetDuration?: TargetDurationKey | null;
    language?: Language | null;
    tone?: string | null;
    model?: string | null;
    styleProfileId?: string | null;
    platform?: Platform | null;
    userId: string;
  },
) {
  let packetId = args.packetId ?? null;
  if (!packetId) {
    if (!args.storyId) throw new Error("storyId or packetId is required");
    packetId = (await loadPacketForStory(db, args.storyId)).id;
  }
  const packKey = `pack-${packetId.slice(0, 8)}-${Date.now()}`;

  const shorts = await runGenerateShortSeries(db, {
    packetId,
    language: args.language ?? null,
    tone: args.tone ?? null,
    model: args.model ?? null,
    styleProfileId: args.styleProfileId ?? null,
    platform: args.platform ?? null,
    packKey,
    userId: args.userId,
  });

  const long = await runGenerateLongScript(db, {
    packetId,
    targetDuration: args.targetDuration ?? null,
    language: args.language ?? null,
    tone: args.tone ?? null,
    model: args.model ?? null,
    styleProfileId: args.styleProfileId ?? null,
    platform: args.platform ?? null,
    packKey,
    userId: args.userId,
  });

  const shortCount = typeof shorts.count === "number" ? shorts.count : 0;

  return {
    ok: shorts.ok || long.ok,
    packKey,
    packetId,
    shorts,
    long,
    shortCount,
    metMinimumShorts: shortCount >= CONTENT_PACK_MIN_SHORTS,
    longScriptId: long.ok ? (long.scriptId ?? null) : null,
    // Insufficient evidence keeps the existing blocked behaviour — nothing is padded.
    longBlockedReason: long.ok ? null : (long.error ?? null),
    shortsBlockedReason: shorts.ok ? null : (shorts.error ?? null),
  };
}

// ---------------------------------------------------------------- content package

export async function runGenerateContentPackage(
  db: Db,
  args: {
    storyId?: string | null;
    packetId?: string | null;
    scriptId?: string | null;
    language?: Language | null;
    model?: string | null;
    styleProfileId?: string | null;
    userId: string;
  },
) {
  const language: Language = args.language ?? "Tanglish";

  let packetId = args.packetId ?? null;
  if (!packetId && args.scriptId) {
    const { data } = await db
      .from("scripts")
      .select("packet_id")
      .eq("id", args.scriptId)
      .maybeSingle();
    packetId = data?.packet_id ?? null;
  }
  if (!packetId) {
    if (!args.storyId) throw new Error("storyId, packetId or scriptId is required");
    packetId = (await loadPacketForStory(db, args.storyId)).id;
  }

  const ctx = await buildScriptContext(db, { packetId });
  const style = await loadStyleProfile(db, args.styleProfileId ?? null);
  // Metadata is cheap work: route it to the cheaper configured model.
  const model = utilityModel(args.model);

  const res = await callStructured({
    operation: "generate-content-package",
    mode: "DATABASE",
    model,
    instructions: composeScriptInstructions({
      language,
      profile: style,
      formatBlock: `Titles, thumbnail text and hashtags may be in English even for a Tanglish video.

TASK: produce the publishing package for this research packet.
- long_titles: exactly 5 candidates, one per style — Contrarian, Curiosity, Risk,
  Expectation Gap, Straight Analysis. Never use "guaranteed", "must buy", "100% return",
  "sure shot" or "next multibagger" as an endorsement.
- thumbnail_texts: 3 to 5 options, 2–6 words, upper case, e.g. "WHAT CHANGED?",
  "BIGGEST RISK", "TOO EXPENSIVE?". Do not put a price target on a thumbnail unless it is
  central to the story AND present in the packet.
- youtube_description: chapters, a source note and an educational disclaimer.
- hashtags: 5 to 10, relevant, no hype tags.
- broll_plan: one or more shots per long-form chapter — visual type, what to search for,
  chart type where relevant. Reference a source_id ONLY when that source exists in the
  Script Context. NEVER claim an image, filing screenshot or newspaper clipping exists
  unless it is a stored source.
- chart_plan: only charts the packet's data can actually produce. Give title, metric,
  period, purpose, chart type and the metric keys. If the data is missing, omit the chart.
- source_screenshots: only stored sources, quoting their real stored titles. Never invent
  a headline or a newspaper.
- short_ideas: 5 ideas. short_scripts: 3 complete Shorts using
  HOOK → CONFLICT → INTRO → TURN → WHY_NOW → OPPORTUNITY_RISK, each standalone, with
  angle_key set to a planned angle key or "other".`,
    }),

    input: scriptContextMessage(
      ctx,
      `Build the content package in ${language} for ${String(ctx.company["ticker"])}. Context row counts: ${JSON.stringify(ctx.counts)}.`,
    ),
    schemaName: "content_package",
    jsonSchema: contentPackageJsonSchema,
    validator: contentPackageValidator,
    webSearch: false,
    maxOutputTokens: 26000,
    refs: {
      companyId: ctx.packet.companyId,
      storyId: ctx.packet.storyId,
      packetId: ctx.packet.id,
      scriptId: args.scriptId ?? null,
    },
    userId: args.userId,
  });

  if (!res.ok) return { ok: false, error: res.error, needsHumanReview: res.needsHumanReview };

  const validSources = new Set(ctx.sourceIds);
  const sourceById = new Map(
    (ctx.bundle["sources"] as Array<Record<string, unknown>>).map((s) => [String(s["id"]), s]),
  );
  const pkg = res.data;

  // Never let an invented source reference survive into an asset.
  const broll = pkg.broll_plan.map((b) => ({
    ...b,
    source_id: b.source_id && validSources.has(b.source_id) ? b.source_id : null,
  }));
  const screenshots = pkg.source_screenshots
    .filter((s) => validSources.has(s.source_id))
    .map((s) => ({
      ...s,
      title: String(sourceById.get(s.source_id)?.["title"] ?? ""),
      publisher: String(sourceById.get(s.source_id)?.["publisher"] ?? ""),
      url: String(sourceById.get(s.source_id)?.["url"] ?? ""),
    }));
  const droppedScreenshots = pkg.source_screenshots.length - screenshots.length;

  const assets: Array<{ key: string; content: string; payload: unknown }> = [
    {
      key: "long_titles",
      content: pkg.long_titles.map((t) => `${t.style}: ${t.text}`).join("\n"),
      payload: pkg.long_titles,
    },
    { key: "short_titles", content: pkg.short_titles.join("\n"), payload: pkg.short_titles },
    {
      key: "thumbnail_text",
      content: pkg.thumbnail_texts.join("\n"),
      payload: pkg.thumbnail_texts,
    },
    { key: "yt_description", content: pkg.youtube_description, payload: null },
    { key: "ig_caption", content: pkg.instagram_caption, payload: null },
    {
      key: "hashtags",
      content: pkg.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" "),
      payload: pkg.hashtags,
    },
    { key: "cta", content: pkg.cta, payload: null },
    {
      key: "broll_plan",
      content: broll.map((b) => `${b.chapter} — ${b.visual_type}: ${b.search_concept}`).join("\n"),
      payload: broll,
    },
    {
      key: "chart_plan",
      content: pkg.chart_plan
        .map((c) => `${c.title} (${c.chart_type}, ${c.period}) — ${c.purpose}`)
        .join("\n"),
      payload: pkg.chart_plan,
    },
    {
      key: "on_screen_text",
      content: pkg.on_screen_texts.join("\n"),
      payload: pkg.on_screen_texts,
    },
    {
      key: "source_screenshots",
      content: screenshots.map((s) => `${s.publisher} — ${s.title}: ${s.why}`).join("\n"),
      payload: screenshots,
    },
    { key: "short_ideas", content: pkg.short_ideas.join("\n"), payload: pkg.short_ideas },
    {
      key: "short_scripts",
      content: pkg.short_scripts
        .map((s, i) => shortBody(s, `## Short ${i + 1} — ${s.angle}`))
        .join("\n\n"),
      payload: pkg.short_scripts,
    },
    { key: "disclaimer", content: DISCLAIMER, payload: null },
  ];

  await db.from("content_assets").insert(
    assets.map((a) => ({
      asset_type: a.key,
      company_id: ctx.packet.companyId,
      story_id: ctx.packet.storyId,
      script_id: args.scriptId ?? null,
      packet_id: ctx.packet.id,
      packet_version: ctx.packet.version,
      content: a.content,
      payload: (a.payload ?? {}) as never,
      created_by: args.userId,
    })),
  );

  return {
    ok: true,
    packetId: ctx.packet.id,
    packetVersion: ctx.packet.version,
    assets: assets.length,
    titles: pkg.long_titles.length,
    thumbnails: pkg.thumbnail_texts.length,
    hashtags: pkg.hashtags.length,
    brollShots: broll.length,
    charts: pkg.chart_plan.length,
    shortIdeas: pkg.short_ideas.length,
    shortScripts: pkg.short_scripts.length,
    sourceScreenshots: screenshots.length,
    droppedScreenshots,
    missingInputs: pkg.missing_inputs,
    model,
    usage: res.usage,
    latencyMs: res.latencyMs,
  };
}

// ---------------------------------------------------------------- freshness

export async function checkResearchFreshness(db: Db, scriptId: string) {
  const { data: script } = await db
    .from("scripts")
    .select("id,story_id,packet_id,research_packet_version")
    .eq("id", scriptId)
    .maybeSingle();
  if (!script) throw new Error("Script not found");
  if (!script.story_id) throw new Error("Script is not linked to a story");

  const { data: latest } = await db
    .from("research_packets")
    .select("id,version_number,update_reason,created_at")
    .eq("story_id", script.story_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const scriptVersion = script.research_packet_version ?? 0;
  const latestVersion = latest?.version_number ?? 0;

  return {
    scriptPacketId: script.packet_id,
    scriptPacketVersion: scriptVersion,
    latestPacketId: latest?.id ?? null,
    latestPacketVersion: latestVersion,
    updateAvailable: latestVersion > scriptVersion,
    latestUpdateReason: latest?.update_reason ?? null,
  };
}
