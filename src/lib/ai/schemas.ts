/**
 * Structured output contracts for the database-only research engine.
 *
 * Every AI operation has TWO things here:
 *   - a strict JSON schema sent to OpenAI (Structured Outputs)
 *   - a zod validator applied to the reply before anything is written
 *
 * Strict-mode rules obeyed throughout: object at the root, every property
 * listed in `required`, optional values expressed as nullable, and
 * `additionalProperties: false` on every object.
 */
import { z } from "zod";

import {
  CLAIM_CATEGORIES,
  RESEARCH_SECTIONS,
  SCENARIO_TYPES,
  TIME_HORIZONS,
  VERIFICATION_STATUSES,
} from "@/lib/domain";

/** Literal the model must return instead of inventing a value. */
export const INSUFFICIENT = "Insufficient Data";
export const NO_PRICE_TARGET = "Price target not estimated due to insufficient reliable inputs";

export const DATA_SUFFICIENCY = ["SUFFICIENT", "PARTIAL", "INSUFFICIENT"] as const;

// ---------------------------------------------------------------- helpers

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
const nullableNum = (description?: string): JsonSchema => ({
  type: ["number", "null"],
  ...(description ? { description } : {}),
});
const enumOf = (values: readonly string[], description?: string): JsonSchema => ({
  type: "string",
  enum: [...values],
  ...(description ? { description } : {}),
});
const idList = (what: string): JsonSchema =>
  arr(str(`A ${what} id copied verbatim from the supplied context. Never invent an id.`));

// ---------------------------------------------------------------- analyze-story

const candidateClaimJson = obj({
  claim_text: str("The claim in one sentence, using only supplied data."),
  claim_category: enumOf(CLAIM_CATEGORIES),
  value: nullableStr("The numeric value as text, or null."),
  unit: nullableStr(),
  reporting_period: nullableStr("e.g. FY2025, Q2 FY2026, or null."),
  supporting_source_ids: idList("source"),
  supporting_metric_keys: arr(
    str(
      "Key of a supplied database metric that supports this claim, e.g. financial_periods:<id>:revenue.",
    ),
  ),
  is_critical: { type: "boolean" },
  confidence: nullableNum("0 to 1, or null."),
  reasoning: str(),
});

export const analyzeStoryJsonSchema = obj({
  data_sufficiency: enumOf(DATA_SUFFICIENCY),
  what_happened: str(`Factual recap from supplied data only, or "${INSUFFICIENT}".`),
  primary_catalyst: str(`The single driving catalyst, or "${INSUFFICIENT}".`),
  why_it_matters: str(`Why this matters to a long-term investor, or "${INSUFFICIENT}".`),
  expectation_gap: obj({
    assessment: str(
      `Actual vs expectation using supplied consensus/guidance numbers only, or "${INSUFFICIENT}".`,
    ),
    supporting_source_ids: idList("source"),
  }),
  key_numbers: arr(
    obj({
      label: str(),
      value: str(),
      unit: nullableStr(),
      period: nullableStr(),
      supporting_source_ids: idList("source"),
      derivation: nullableStr("Show the arithmetic when this is a calculation, else null."),
    }),
  ),
  open_questions: arr(str()),
  missing_data: arr(
    str("A named data point that is absent from the supplied context and blocks analysis."),
  ),
  candidate_claims: arr(candidateClaimJson),
  overall_confidence: nullableNum("0 to 1."),
});

export const analyzeStoryValidator = z.object({
  data_sufficiency: z.enum(DATA_SUFFICIENCY),
  what_happened: z.string(),
  primary_catalyst: z.string(),
  why_it_matters: z.string(),
  expectation_gap: z.object({
    assessment: z.string(),
    supporting_source_ids: z.array(z.string()),
  }),
  key_numbers: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      unit: z.string().nullable(),
      period: z.string().nullable(),
      supporting_source_ids: z.array(z.string()),
      derivation: z.string().nullable(),
    }),
  ),
  open_questions: z.array(z.string()),
  missing_data: z.array(z.string()),
  candidate_claims: z.array(
    z.object({
      claim_text: z.string(),
      claim_category: z.enum(CLAIM_CATEGORIES),
      value: z.string().nullable(),
      unit: z.string().nullable(),
      reporting_period: z.string().nullable(),
      supporting_source_ids: z.array(z.string()),
      supporting_metric_keys: z.array(z.string()),
      is_critical: z.boolean(),
      confidence: z.number().nullable(),
      reasoning: z.string(),
    }),
  ),
  overall_confidence: z.number().nullable(),
});

export type AnalyzeStoryOutput = z.infer<typeof analyzeStoryValidator>;

// ---------------------------------------------------------------- verify-claims

export const verifyClaimsJsonSchema = obj({
  assessments: arr(
    obj({
      claim_id: str("Copied verbatim from the supplied claim list."),
      verification_status: enumOf(VERIFICATION_STATUSES),
      claim_category: enumOf(CLAIM_CATEGORIES),
      supporting_source_ids: idList("source"),
      supporting_metric_keys: arr(str()),
      conflict: nullableStr(
        "Describe the disagreement and name both values when sources or database rows disagree, else null.",
      ),
      conflicting_source_ids: idList("source"),
      reasoning: str("Why this status, referring only to supplied evidence."),
      confidence: nullableNum("0 to 1."),
      language_rule: str("The wording rule a script must follow when using this claim."),
    }),
  ),
  unverifiable_claim_ids: idList("claim"),
  notes: str(),
});

export const verifyClaimsValidator = z.object({
  assessments: z.array(
    z.object({
      claim_id: z.string(),
      verification_status: z.enum(VERIFICATION_STATUSES),
      claim_category: z.enum(CLAIM_CATEGORIES),
      supporting_source_ids: z.array(z.string()),
      supporting_metric_keys: z.array(z.string()),
      conflict: z.string().nullable(),
      conflicting_source_ids: z.array(z.string()),
      reasoning: z.string(),
      confidence: z.number().nullable(),
      language_rule: z.string(),
    }),
  ),
  unverifiable_claim_ids: z.array(z.string()),
  notes: z.string(),
});

export type VerifyClaimsOutput = z.infer<typeof verifyClaimsValidator>;

// ---------------------------------------------------------------- research packet

export const SECTION_KEYS = RESEARCH_SECTIONS.map((s) => s.key) as unknown as readonly string[];

const sectionJson = obj({
  section_key: enumOf(SECTION_KEYS),
  content: str(
    `Markdown for this section. Write "${INSUFFICIENT}" plus the named missing inputs when the database does not support the section.`,
  ),
  supporting_source_ids: idList("source"),
  supporting_claim_ids: idList("claim"),
  data_sufficiency: enumOf(DATA_SUFFICIENCY),
  missing_inputs: arr(str()),
});

export const researchPacketJsonSchema = obj({
  sections: arr(sectionJson),
  overall_data_sufficiency: enumOf(DATA_SUFFICIENCY),
  missing_data: arr(str()),
  update_reason: str("One line describing what this revision covers."),
});

export const researchPacketValidator = z.object({
  sections: z.array(
    z.object({
      section_key: z.string(),
      content: z.string(),
      supporting_source_ids: z.array(z.string()),
      supporting_claim_ids: z.array(z.string()),
      data_sufficiency: z.enum(DATA_SUFFICIENCY),
      missing_inputs: z.array(z.string()),
    }),
  ),
  overall_data_sufficiency: z.enum(DATA_SUFFICIENCY),
  missing_data: z.array(z.string()),
  update_reason: z.string(),
});

export type ResearchPacketOutput = z.infer<typeof researchPacketValidator>;

// ---------------------------------------------------------------- scenarios

const scenarioJson = obj({
  scenario_type: enumOf(SCENARIO_TYPES),
  probability: {
    type: "number",
    description: "Whole-number percent. Bull + Base + Bear must total exactly 100.",
  },
  time_horizon: enumOf(TIME_HORIZONS),
  conditions: arr(str("An explicit condition that must hold for this scenario.")),
  assumptions: str(),
  financial_assumptions: str(`Numeric assumptions tied to supplied data, or "${INSUFFICIENT}".`),
  catalysts: str(),
  risks: str(),
  valuation_low: nullableNum("Null unless supplied valuation inputs support it."),
  valuation_high: nullableNum("Null unless supplied valuation inputs support it."),
  valuation_basis: nullableStr(`The multiple/earnings base used, or null when no target is given.`),
  invalidation_conditions: arr(str("An observable event that would kill this scenario.")),
  confidence: enumOf(["High", "Medium", "Low"]),
  supporting_source_ids: idList("source"),
  supporting_claim_ids: idList("claim"),
});

export const scenariosJsonSchema = obj({
  scenarios: arr(scenarioJson),
  valuation_inputs_adequate: { type: "boolean" },
  missing_valuation_inputs: arr(str()),
});

export const scenariosValidator = z
  .object({
    scenarios: z.array(
      z.object({
        scenario_type: z.enum(SCENARIO_TYPES),
        probability: z.number(),
        time_horizon: z.enum(TIME_HORIZONS),
        conditions: z.array(z.string()).min(1, "each scenario needs at least one condition"),
        assumptions: z.string(),
        financial_assumptions: z.string(),
        catalysts: z.string(),
        risks: z.string(),
        valuation_low: z.number().nullable(),
        valuation_high: z.number().nullable(),
        valuation_basis: z.string().nullable(),
        invalidation_conditions: z
          .array(z.string())
          .min(1, "each scenario needs at least one invalidation condition"),
        confidence: z.enum(["High", "Medium", "Low"]),
        supporting_source_ids: z.array(z.string()),
        supporting_claim_ids: z.array(z.string()),
      }),
    ),
    valuation_inputs_adequate: z.boolean(),
    missing_valuation_inputs: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    const types = v.scenarios.map((s) => s.scenario_type);
    for (const required of SCENARIO_TYPES) {
      if (!types.includes(required)) {
        ctx.addIssue({
          code: "custom",
          path: ["scenarios"],
          message: `missing ${required}`,
        });
      }
    }
    const total = v.scenarios.reduce((sum, s) => sum + s.probability, 0);
    if (Math.round(total) !== 100) {
      ctx.addIssue({
        code: "custom",
        path: ["scenarios"],
        message: `probabilities must total exactly 100, got ${total}`,
      });
    }
  });

export type ScenariosOutput = z.infer<typeof scenariosValidator>;
