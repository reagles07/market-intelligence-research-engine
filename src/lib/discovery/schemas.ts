/**
 * Structured output contracts for the discovery layer.
 *
 * Two AI touch points only, both deliberately small:
 *   1. US broad web discovery — turns 4 searches into candidate stories.
 *   2. Lightweight candidate evaluation — storytelling, novelty nuance, angle.
 *
 * Neither may perform company research, invent an event, or state a price move
 * as measured market data.
 */
import { z } from "zod";

import { SOURCE_TIERS, SOURCE_TYPES } from "@/lib/domain";
import { CANDIDATE_TYPES } from "@/lib/discovery/domain";

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
const num = (description?: string): JsonSchema => ({
  type: "number",
  ...(description ? { description } : {}),
});
const enumOf = (values: readonly string[], description?: string): JsonSchema => ({
  type: "string",
  enum: [...values],
  ...(description ? { description } : {}),
});

// ---------------------------------------------------------------- US web discovery

export const usDiscoveryJsonSchema = obj({
  queries_used: arr(str()),
  candidates: arr(
    obj({
      company_name: str("The company the story is about, as the source names it."),
      ticker: nullableStr("US ticker if the source states it, else null."),
      exchange: nullableStr(),
      headline: str("The development itself, in one factual line taken from the page you read."),
      candidate_type: enumOf(CANDIDATE_TYPES),
      why_it_matters: str("One line on why this could make a story. No investment view."),
      event_date: nullableStr("ISO date of the event when the page states one, else null."),
      reported_price_move_pct: nullableNum(
        "Only if the page explicitly states a percentage move. Never estimate one. Null otherwise.",
      ),
      url: str("The exact URL you opened. Never reconstruct a URL."),
      title: str("The page title."),
      publisher: nullableStr(),
      source_type: enumOf(SOURCE_TYPES),
      source_tier: enumOf(SOURCE_TIERS, "Your read of the tier; the app re-decides it."),
      published_at: nullableStr("ISO date, or null."),
    }),
  ),
  coverage_note: str("State plainly what this pass could not cover."),
  no_new_information: { type: "boolean" },
});

export const usDiscoveryValidator = z.object({
  queries_used: z.array(z.string()),
  candidates: z
    .array(
      z.object({
        company_name: z.string().min(1),
        ticker: z.string().nullable(),
        exchange: z.string().nullable(),
        headline: z.string().min(3),
        candidate_type: z.enum(CANDIDATE_TYPES),
        why_it_matters: z.string(),
        event_date: z.string().nullable(),
        reported_price_move_pct: z.number().nullable(),
        url: z.string().min(4),
        title: z.string(),
        publisher: z.string().nullable(),
        source_type: z.enum(SOURCE_TYPES),
        source_tier: z.enum(SOURCE_TIERS),
        published_at: z.string().nullable(),
      }),
    )
    .max(40),
  coverage_note: z.string(),
  no_new_information: z.boolean(),
});

export type UsDiscoveryOutput = z.infer<typeof usDiscoveryValidator>;

// ---------------------------------------------------------------- candidate evaluation

export const candidateEvaluationJsonSchema = obj({
  evaluations: arr(
    obj({
      candidate_ref: str("The exact ref string supplied with the candidate."),
      storytelling_potential: num(
        "0-5. Score the narrative tension that the SUPPLIED facts already contain: contradiction, mystery, expectation gap, risk/reward tension. Score 0 when the supplied facts carry no narrative.",
      ),
      storytelling_reason: str("One line naming the tension, referring only to supplied facts."),
      novelty_adjust: num("-2 to +2. Refine how fresh this story is versus recent coverage."),
      audience_adjust: num("-2 to +2. Refine audience relevance."),
      catalyst_adjust: num("-3 to +3. Refine how material the catalyst really is."),
      suggested_angle: str("The angle a presenter would take. One line."),
      suggested_hook: str("A hook concept. Not a script, not a full sentence of narration."),
      core_question: str("The single question the video would answer."),
      notes: str("One line on your reasoning, including anything the data does not show."),
    }),
  ),
});

export const candidateEvaluationValidator = z.object({
  evaluations: z
    .array(
      z.object({
        candidate_ref: z.string(),
        storytelling_potential: z.number().min(0).max(5),
        storytelling_reason: z.string(),
        novelty_adjust: z.number().min(-2).max(2),
        audience_adjust: z.number().min(-2).max(2),
        catalyst_adjust: z.number().min(-3).max(3),
        suggested_angle: z.string(),
        suggested_hook: z.string(),
        core_question: z.string(),
        notes: z.string(),
      }),
    )
    .max(20),
});

export type CandidateEvaluationOutput = z.infer<typeof candidateEvaluationValidator>;
