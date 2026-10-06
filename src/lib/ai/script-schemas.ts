/**
 * Structured output contracts for the content engine (Pass 1D).
 *
 * Same discipline as the research schemas: strict JSON schema out, zod in,
 * nothing saved unless it validates. Every generated section carries the ids
 * of the research evidence that produced it.
 */
import { z } from "zod";

import {
  AUDIT_SEVERITIES,
  AUDIT_STATUSES,
  LONG_SECTION_KEYS,
  SHORT_BEAT_KEYS,
  STATEMENT_TYPES,
  TITLE_STYLES,
} from "@/lib/content/domain";

type JsonSchema = Record<string, unknown>;

const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const arr = (items: JsonSchema): JsonSchema => ({ type: "array", items });
const str = (description?: string): JsonSchema =>
  description ? { type: "string", description } : { type: "string" };
const nullableStr = (description?: string): JsonSchema => ({
  type: ["string", "null"],
  ...(description ? { description } : {}),
});
const bool = (description?: string): JsonSchema => ({
  type: "boolean",
  ...(description ? { description } : {}),
});
const enumOf = (values: readonly string[], description?: string): JsonSchema => ({
  type: "string",
  enum: [...values],
  ...(description ? { description } : {}),
});
const idList = (what: string): JsonSchema =>
  arr(str(`A ${what} id copied verbatim from the supplied Script Context. Never invent an id.`));

const evidenceJson = {
  claim_ids: idList("claim"),
  source_ids: idList("source"),
  research_section_ids: idList("research section"),
  metric_keys: arr(str("A metric key copied verbatim from the supplied Script Context.")),
};

const evidenceZod = {
  claim_ids: z.array(z.string()),
  source_ids: z.array(z.string()),
  research_section_ids: z.array(z.string()),
  metric_keys: z.array(z.string()),
};

// ---------------------------------------------------------------- long form

export const longScriptJsonSchema = obj({
  working_title: str("A plain working title. No hype words."),
  story_angle: str(
    "The single verified story angle this script is built on, in one sentence. If no historical story is evidenced, name the present-day business contradiction used instead.",
  ),
  reveal_point: str("The approximate timestamp where the company is named/revealed, e.g. 2:40."),
  key_thesis: str("The one-sentence thesis a viewer should leave with."),
  main_risk: str("The strongest evidenced counterargument or risk, in one sentence."),
  retention_device_label: str(
    "The wording used for the repeated retention loops, chosen to fit the evidence: clues, signals, turning points, things most people miss, lessons, reasons, growth drivers, decisions, numbers to watch, red flags, hidden strengths, challenges or catalysts. Never 'secrets' unless the evidence genuinely is a set of secrets.",
  ),
  retention_device_count: {
    type: "integer",
    description:
      "How many of those items the script actually delivers. It must match the script exactly.",
  },
  self_intro_line: str(
    "The one- or two-sentence host intro spoken AFTER the hook, using only the supplied creator identity. If no name is supplied, a role-based intro with no invented name or channel.",
  ),
  sections: arr(
    obj({
      section_key: enumOf(LONG_SECTION_KEYS),
      time_range: str("e.g. 0:00–0:20"),
      spoken_text: str(
        "The words the presenter says, in the requested language. No stage directions.",
      ),
      micro_hook: nullableStr(
        "A short retention device that closes this section, varied in wording, or null.",
      ),
      on_screen_text: nullableStr(),
      visual_note: nullableStr("What should be on screen. Never claim an asset exists."),
      ...evidenceJson,
    }),
  ),
  research_update_required: bool(
    "True only when the packet cannot support a usable script at all.",
  ),
  missing_inputs: arr(str("A named research input the script had to write around.")),
  coverage_notes: str("One paragraph on what the script could and could not cover."),
});

const longSectionZod = z.object({
  section_key: z.string(),
  time_range: z.string(),
  spoken_text: z.string(),
  micro_hook: z.string().nullable(),
  on_screen_text: z.string().nullable(),
  visual_note: z.string().nullable(),
  ...evidenceZod,
});

export const longScriptValidator = z
  .object({
    working_title: z.string(),
    story_angle: z.string(),
    reveal_point: z.string(),
    key_thesis: z.string(),
    main_risk: z.string(),
    retention_device_label: z.string(),
    retention_device_count: z.number().int(),
    self_intro_line: z.string(),
    sections: z.array(longSectionZod),
    research_update_required: z.boolean(),
    missing_inputs: z.array(z.string()),
    coverage_notes: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.research_update_required) return;
    const keys = new Set(v.sections.map((s) => s.section_key));
    for (const required of LONG_SECTION_KEYS) {
      if (!keys.has(required)) {
        ctx.addIssue({
          code: "custom",
          path: ["sections"],
          message: `missing section ${required}`,
        });
      }
    }
  });

export type LongScriptOutput = z.infer<typeof longScriptValidator>;

// ---------------------------------------------------------------- short form

const shortBeatJson = obj({
  beat: enumOf(SHORT_BEAT_KEYS),
  spoken_text: str("The words spoken for this beat, in the requested language."),
  on_screen_text: nullableStr(),
  ...evidenceJson,
});

const shortBeatZod = z.object({
  beat: z.enum(SHORT_BEAT_KEYS),
  spoken_text: z.string(),
  on_screen_text: z.string().nullable(),
  ...evidenceZod,
});

const shortBodyJson = {
  angle: str("The single story this Short is about, in a few words."),
  angle_key: str(
    "The planned angle key this Short fulfils, copied verbatim from the supplied angle plan, or 'other' when a substitute verified angle had to be used.",
  ),
  hook_line: str("The first spoken line. It must earn the next three seconds."),
  beats: arr(shortBeatJson),
  cta: str("A soft, non-advisory call to action using the requested platform's vocabulary."),
  visual_notes: arr(str()),
};

const shortBodyZod = {
  angle: z.string(),
  angle_key: z.string(),
  hook_line: z.string(),
  beats: z.array(shortBeatZod).min(1),
  cta: z.string(),
  visual_notes: z.array(z.string()),
};

export const shortScriptJsonSchema = obj({
  ...shortBodyJson,
  research_update_required: bool(),
  missing_inputs: arr(str()),
});

export const shortScriptValidator = z.object({
  ...shortBodyZod,
  research_update_required: z.boolean(),
  missing_inputs: z.array(z.string()),
});

export type ShortScriptOutput = z.infer<typeof shortScriptValidator>;

export const shortSeriesJsonSchema = obj({
  shorts: arr(obj({ ...shortBodyJson })),
  research_update_required: bool(),
  missing_inputs: arr(str()),
});

export const shortSeriesValidator = z.object({
  shorts: z
    .array(z.object({ ...shortBodyZod }))
    .min(1)
    .max(8),
  research_update_required: z.boolean(),
  missing_inputs: z.array(z.string()),
});

export type ShortSeriesOutput = z.infer<typeof shortSeriesValidator>;

// ---------------------------------------------------------------- content package

export const contentPackageJsonSchema = obj({
  long_titles: arr(
    obj({
      text: str("Under 80 characters. No hype or guarantee language."),
      style: enumOf(TITLE_STYLES),
    }),
  ),
  short_titles: arr(str()),
  thumbnail_texts: arr(str("Two to six words, upper case.")),
  youtube_description: str("Includes chapters, a source note and the educational disclaimer."),
  instagram_caption: str(),
  hashtags: arr(str("Without the # character.")),
  cta: str(),
  broll_plan: arr(
    obj({
      chapter: str("A long-form chapter key or label this shot belongs to."),
      visual_type: str("e.g. stock chart, filing screenshot, product footage."),
      search_concept: str("What the editor should search for."),
      chart_type: nullableStr(),
      source_id: nullableStr(
        "Only a source id supplied in the Script Context, or null. Never invent one.",
      ),
    }),
  ),
  chart_plan: arr(
    obj({
      title: str(),
      metric: str("The metric name, which must exist in the supplied Script Context."),
      period: str(),
      purpose: str("What story this chart tells."),
      chart_type: str(),
      metric_keys: arr(str()),
    }),
  ),
  on_screen_texts: arr(str()),
  source_screenshots: arr(
    obj({
      source_id: str("A source id supplied in the Script Context."),
      why: str("Why this stored source is worth showing on screen."),
    }),
  ),
  short_ideas: arr(str()),
  short_scripts: arr(obj({ ...shortBodyJson })),
  missing_inputs: arr(str()),
});

export const contentPackageValidator = z.object({
  long_titles: z.array(z.object({ text: z.string(), style: z.enum(TITLE_STYLES) })).min(3),
  short_titles: z.array(z.string()),
  thumbnail_texts: z.array(z.string()).min(3),
  youtube_description: z.string(),
  instagram_caption: z.string(),
  hashtags: z.array(z.string()).min(5),
  cta: z.string(),
  broll_plan: z.array(
    z.object({
      chapter: z.string(),
      visual_type: z.string(),
      search_concept: z.string(),
      chart_type: z.string().nullable(),
      source_id: z.string().nullable(),
    }),
  ),
  chart_plan: z.array(
    z.object({
      title: z.string(),
      metric: z.string(),
      period: z.string(),
      purpose: z.string(),
      chart_type: z.string(),
      metric_keys: z.array(z.string()),
    }),
  ),
  on_screen_texts: z.array(z.string()),
  source_screenshots: z.array(z.object({ source_id: z.string(), why: z.string() })),
  short_ideas: z.array(z.string()).min(3),
  short_scripts: z.array(z.object({ ...shortBodyZod })).min(1),
  missing_inputs: z.array(z.string()),
});

export type ContentPackageOutput = z.infer<typeof contentPackageValidator>;

// ---------------------------------------------------------------- extraction

export const extractStatementsJsonSchema = obj({
  statements: arr(
    obj({
      section_key: str("The script section the sentence came from."),
      statement_text: str("The sentence exactly as written in the script."),
      statement_type: enumOf(STATEMENT_TYPES),
      is_numeric: bool("True when the sentence carries a number, percentage, price or date."),
      quoted_value: nullableStr("The number/price/percentage as written, or null."),
      quoted_unit: nullableStr("Currency symbol, %, x, bps, crore, million… or null."),
      quoted_period: nullableStr("Q2 FY2026, FY2025, TTM, as-of date… or null."),
      attribution_present: bool("True when the sentence already names its source or speaker."),
      hedged: bool("True when the sentence already uses conditional or hedged language."),
    }),
  ),
});

export const extractStatementsValidator = z.object({
  statements: z.array(
    z.object({
      section_key: z.string(),
      statement_text: z.string(),
      statement_type: z.enum(STATEMENT_TYPES),
      is_numeric: z.boolean(),
      quoted_value: z.string().nullable(),
      quoted_unit: z.string().nullable(),
      quoted_period: z.string().nullable(),
      attribution_present: z.boolean(),
      hedged: z.boolean(),
    }),
  ),
});

export type ExtractStatementsOutput = z.infer<typeof extractStatementsValidator>;

// ---------------------------------------------------------------- audit

export const auditScriptJsonSchema = obj({
  assessments: arr(
    obj({
      statement_index: {
        type: "integer",
        description: "Zero-based index into the supplied statement list.",
      },
      status: enumOf(AUDIT_STATUSES),
      matched_claim_id: nullableStr("A claim id from the Script Context, or null."),
      matched_source_id: nullableStr("A source id from the Script Context, or null."),
      matched_metric_key: nullableStr("A metric key from the Script Context, or null."),
      research_value: nullableStr("The value the research packet actually holds, or null."),
      script_value: nullableStr("The value the script stated, or null."),
      issue: nullableStr("What is wrong: unit, magnitude, period, basis, attribution… or null."),
      recommended_wording: nullableStr("A corrected sentence the writer can paste in, or null."),
      severity: enumOf(AUDIT_SEVERITIES),
    }),
  ),
  summary: str("A short human-readable summary of the fact check."),
});

export const auditScriptValidator = z.object({
  assessments: z.array(
    z.object({
      statement_index: z.number().int(),
      status: z.enum(AUDIT_STATUSES),
      matched_claim_id: z.string().nullable(),
      matched_source_id: z.string().nullable(),
      matched_metric_key: z.string().nullable(),
      research_value: z.string().nullable(),
      script_value: z.string().nullable(),
      issue: z.string().nullable(),
      recommended_wording: z.string().nullable(),
      severity: z.enum(AUDIT_SEVERITIES),
    }),
  ),
  summary: z.string(),
});

export type AuditScriptOutput = z.infer<typeof auditScriptValidator>;

// ---------------------------------------------------------------- repair

export const REPAIR_ACTIONS = ["KEEP", "CORRECT", "ATTRIBUTE", "QUALIFY", "REMOVE"] as const;
export type RepairAction = (typeof REPAIR_ACTIONS)[number];

export const repairScriptJsonSchema = obj({
  items: arr(
    obj({
      finding_index: {
        type: "integer",
        description: "Zero-based index into the supplied list of failing statements.",
      },
      action: enumOf(
        REPAIR_ACTIONS,
        "KEEP only when the statement is already correct. CORRECT replaces a wrong number with the research value. ATTRIBUTE names the analyst/firm/management. QUALIFY makes a forecast conditional. REMOVE deletes an unsupportable sentence.",
      ),
      new_text: nullableStr(
        "The full replacement sentence in the SAME language as the original, or null when the action is REMOVE or KEEP.",
      ),
      evidence_metric_key: nullableStr(
        "Metric key from the Script Context that justifies a corrected number, or null.",
      ),
      evidence_claim_id: nullableStr("Claim id from the Script Context, or null."),
      evidence_source_id: nullableStr("Source id from the Script Context, or null."),
      reason: str("One short sentence explaining the repair."),
    }),
  ),
  notes: str("A short summary of what was repaired and what had to be removed."),
});

export const repairScriptValidator = z.object({
  items: z.array(
    z.object({
      finding_index: z.number().int(),
      action: z.enum(REPAIR_ACTIONS),
      new_text: z.string().nullable(),
      evidence_metric_key: z.string().nullable(),
      evidence_claim_id: z.string().nullable(),
      evidence_source_id: z.string().nullable(),
      reason: z.string(),
    }),
  ),
  notes: z.string(),
});

export type RepairScriptOutput = z.infer<typeof repairScriptValidator>;

/**
 * Evidence-locked word-budget rebalance (expansion or compression) applied to
 * an already-repaired script. The model may only restate evidence that is
 * already present — it returns the full spoken text of each section.
 */
export const rebalanceScriptJsonSchema = obj({
  sections: arr(
    obj({
      section_id: str("The section id exactly as supplied."),
      spoken_text: str(
        "The full rewritten spoken text for this section, same language and register.",
      ),
    }),
  ),
  notes: str("One short sentence on what was expanded or trimmed."),
});

export const rebalanceScriptValidator = z.object({
  sections: z.array(z.object({ section_id: z.string(), spoken_text: z.string() })),
  notes: z.string(),
});

export type RebalanceScriptOutput = z.infer<typeof rebalanceScriptValidator>;
