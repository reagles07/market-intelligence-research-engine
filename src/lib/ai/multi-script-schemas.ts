/**
 * Structured output contracts for MULTI-STOCK content.
 *
 * Same discipline as the single-stock schemas: strict JSON out, zod in, and
 * every section carries both the company it speaks about and the evidence ids
 * behind it so cross-company mixing can be audited deterministically.
 */
import { z } from "zod";

import { MULTI_LONG_SECTION_KEYS, MULTI_REQUIRED_SECTIONS } from "@/lib/content/multi-story";
import { SHORT_BEAT_KEYS } from "@/lib/content/domain";

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
const enumOf = (values: readonly string[]): JsonSchema => ({ type: "string", enum: [...values] });

const evidenceJson = {
  claim_ids: arr(str("A claim id copied verbatim from THIS company's context block.")),
  source_ids: arr(str("A source id copied verbatim from THIS company's context block.")),
  research_section_ids: arr(str("A research section id from THIS company's context block.")),
  metric_keys: arr(str("A metric key copied verbatim from THIS company's context block.")),
};

const evidenceZod = {
  claim_ids: z.array(z.string()),
  source_ids: z.array(z.string()),
  research_section_ids: z.array(z.string()),
  metric_keys: z.array(z.string()),
};

// ------------------------------------------------------------- multi long

export const multiLongJsonSchema = obj({
  working_title: str("A plain working title for the whole episode. No hype words."),
  central_thesis: str("The one-sentence idea that makes these companies one episode."),
  shared_theme: str("The verified shared theme, question or force connecting the companies."),
  self_intro_line: str("The host intro spoken AFTER the hook, from the supplied identity only."),
  company_angles: arr(
    obj({
      company_id: str("A company id supplied in the context. Never invent one."),
      ticker: str(),
      angle: str("The single verified mini-story or contrast used for this company."),
      key_number_note: str("How the key numbers were framed for a layman, in one sentence."),
      main_risk: str("The strongest evidenced risk for this company, in one sentence."),
    }),
  ),
  comparison_caveats: arr(
    str("A comparison that is NOT apples-to-apples and how the script handled it."),
  ),
  sections: arr(
    obj({
      section_key: enumOf(MULTI_LONG_SECTION_KEYS),
      company_id: nullableStr(
        "The company this section speaks about, or null for shared sections.",
      ),
      time_range: str("e.g. 0:00–0:40"),
      spoken_text: str("The words the presenter says, in the requested language."),
      micro_hook: nullableStr(),
      on_screen_text: nullableStr(),
      visual_note: nullableStr(),
      ...evidenceJson,
    }),
  ),
  research_update_required: bool("True only when the evidence cannot support this episode."),
  missing_inputs: arr(str()),
  coverage_notes: str("One paragraph on what the episode could and could not cover."),
});

export const multiLongValidator = z
  .object({
    working_title: z.string(),
    central_thesis: z.string(),
    shared_theme: z.string(),
    self_intro_line: z.string(),
    company_angles: z.array(
      z.object({
        company_id: z.string(),
        ticker: z.string(),
        angle: z.string(),
        key_number_note: z.string(),
        main_risk: z.string(),
      }),
    ),
    comparison_caveats: z.array(z.string()),
    sections: z.array(
      z.object({
        section_key: z.string(),
        company_id: z.string().nullable(),
        time_range: z.string(),
        spoken_text: z.string(),
        micro_hook: z.string().nullable(),
        on_screen_text: z.string().nullable(),
        visual_note: z.string().nullable(),
        ...evidenceZod,
      }),
    ),
    research_update_required: z.boolean(),
    missing_inputs: z.array(z.string()),
    coverage_notes: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.research_update_required) return;
    const keys = new Set(v.sections.map((s) => s.section_key));
    for (const required of MULTI_REQUIRED_SECTIONS) {
      if (!keys.has(required)) {
        ctx.addIssue({
          code: "custom",
          path: ["sections"],
          message: `missing section ${required}`,
        });
      }
    }
    if (!v.sections.some((s) => s.section_key === "company_block")) {
      ctx.addIssue({ code: "custom", path: ["sections"], message: "no company_block section" });
    }
  });

export type MultiLongOutput = z.infer<typeof multiLongValidator>;

// ------------------------------------------------------------- combined short

export const combinedShortJsonSchema = obj({
  angle: str("The single shared story this combined Short is about, in a few words."),
  hook_line: str("The first spoken line, covering all the companies at once."),
  beats: arr(
    obj({
      beat: enumOf(SHORT_BEAT_KEYS),
      company_id: nullableStr("The company this beat speaks about, or null when shared."),
      spoken_text: str(),
      on_screen_text: nullableStr(),
      ...evidenceJson,
    }),
  ),
  cta: str("A soft, non-advisory call to action in the platform's vocabulary."),
  visual_notes: arr(str()),
  research_update_required: bool(),
  missing_inputs: arr(str()),
});

export const combinedShortValidator = z.object({
  angle: z.string(),
  hook_line: z.string(),
  beats: z
    .array(
      z.object({
        beat: z.enum(SHORT_BEAT_KEYS),
        company_id: z.string().nullable(),
        spoken_text: z.string(),
        on_screen_text: z.string().nullable(),
        ...evidenceZod,
      }),
    )
    .min(1),
  cta: z.string(),
  visual_notes: z.array(z.string()),
  research_update_required: z.boolean(),
  missing_inputs: z.array(z.string()),
});

export type CombinedShortOutput = z.infer<typeof combinedShortValidator>;
