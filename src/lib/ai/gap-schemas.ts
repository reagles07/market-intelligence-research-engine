/**
 * Structured-output contracts for research-gap triage.
 *
 * Triage never writes script text and never states a fact: it only decides
 * whether a failing statement can be fixed from evidence already in the
 * packet, needs targeted research, needs a human, or must be removed.
 */
import { z } from "zod";

import {
  MISSING_EVIDENCE_TYPES,
  MAX_QUERIES_PER_GAP,
  GAP_PRIORITIES,
  RESOLUTION_TYPES,
} from "@/lib/content/gaps";

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
const enumOf = (values: readonly string[], description?: string): JsonSchema => ({
  type: "string",
  enum: [...values],
  ...(description ? { description } : {}),
});

export const gapTriageJsonSchema = obj({
  items: arr(
    obj({
      statement_index: {
        type: "integer",
        description: "Index of the failing statement exactly as given in the input list.",
      },
      resolution_type: enumOf(
        RESOLUTION_TYPES,
        "FIX_FROM_EXISTING when the packet already holds the evidence; RESEARCH_REQUIRED when a real external fact is missing; HUMAN_REVIEW when judgement or an internal decision is needed; REMOVE when the line adds nothing and can simply be deleted.",
      ),
      missing_evidence_type: enumOf(MISSING_EVIDENCE_TYPES),
      claim_under_investigation: str(
        "The single specific fact that must be established, written plainly. No script wording.",
      ),
      reason: str("Why the packet cannot support the statement today."),
      priority: enumOf(GAP_PRIORITIES),
      event_date: nullableStr("ISO date the claim refers to, or null."),
      search_queries: arr(
        str("A precise search query including the company name or ticker and a date anchor."),
      ),
    }),
  ),
  summary: str("One or two plain sentences describing the evidence gaps found."),
});

export const gapTriageValidator = z.object({
  items: z
    .array(
      z.object({
        statement_index: z.number().int().min(0),
        resolution_type: z.enum(RESOLUTION_TYPES),
        missing_evidence_type: z.enum(MISSING_EVIDENCE_TYPES),
        claim_under_investigation: z.string().min(3),
        reason: z.string(),
        priority: z.enum(GAP_PRIORITIES),
        event_date: z.string().nullable(),
        search_queries: z.array(z.string().min(3)).max(MAX_QUERIES_PER_GAP),
      }),
    )
    .max(60),
  summary: z.string(),
});

export type GapTriageOutput = z.infer<typeof gapTriageValidator>;

/**
 * Did the targeted search actually settle the gap?
 *
 * Finding *something* about a company is not the same as establishing the one
 * fact the script needs, so this verdict is asked separately and the app —
 * not the search reply — decides whether a gap may close.
 */
export const gapVerdictJsonSchema = obj({
  verdict: enumOf(
    ["ESTABLISHED", "CONTRADICTED", "NOT_ESTABLISHED"],
    "ESTABLISHED only when the evidence below directly states the claim under investigation. CONTRADICTED when it states the opposite. NOT_ESTABLISHED for anything else, including related-but-different facts.",
  ),
  supporting_source_urls: arr(str("URLs from the evidence list that carry the claim.")),
  established_value: nullableStr("The value or wording the evidence establishes, or null."),
  explanation: str("One or two sentences. Never assert a fact that is not in the evidence list."),
});

export const gapVerdictValidator = z.object({
  verdict: z.enum(["ESTABLISHED", "CONTRADICTED", "NOT_ESTABLISHED"]),
  supporting_source_urls: z.array(z.string()).max(10),
  established_value: z.string().nullable(),
  explanation: z.string(),
});
