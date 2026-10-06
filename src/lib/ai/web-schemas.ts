/**
 * Structured output contracts for WEB-mode research (Pass 1C).
 *
 * Same strict rules as the database-only schemas: object at the root, every
 * property required, optionals expressed as nullable, additionalProperties
 * false everywhere.
 */
import { z } from "zod";

import { CLAIM_CATEGORIES, SOURCE_TIERS, SOURCE_TYPES } from "@/lib/domain";

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

// ---------------------------------------------------------------- search plan

export const MAX_QUERIES = 6;
export const MAX_SOURCES = 15;

export const searchPlanJsonSchema = obj({
  queries: arr(
    obj({
      query: str("A precise search query. Include the company name or ticker and a date anchor."),
      purpose: str("What gap in the database this query is meant to close."),
    }),
  ),
  focus: str("One line describing the overall focus of this research run."),
});

export const searchPlanValidator = z.object({
  queries: z
    .array(z.object({ query: z.string().min(3), purpose: z.string() }))
    .min(1)
    .max(MAX_QUERIES),
  focus: z.string(),
});

export type SearchPlanOutput = z.infer<typeof searchPlanValidator>;

// ---------------------------------------------------------------- web research

export const RECONCILIATIONS = [
  "Confirms database",
  "Conflicts with database",
  "New information",
  "Not in database",
  "Unverifiable",
] as const;

export const MATERIALITY = ["High", "Medium", "Low"] as const;

const webSourceJson = obj({
  url: str("The exact URL you actually read. Never invent a URL."),
  title: str(),
  publisher: nullableStr("Publication or organisation name."),
  source_type: enumOf(SOURCE_TYPES),
  source_tier: enumOf(SOURCE_TIERS, "Your best read of the tier; the app re-checks it."),
  published_at: nullableStr("ISO date of publication, or null when the page does not state one."),
  summary: str("Two sentences on what this source actually says."),
  is_paywalled: { type: "boolean" },
});

const findingJson = obj({
  statement: str("One factual sentence, written only from what the cited pages say."),
  category: enumOf(CLAIM_CATEGORIES),
  value: nullableStr(),
  unit: nullableStr(),
  reporting_period: nullableStr(),
  source_urls: arr(str("A URL that appears in the sources array of this same reply.")),
  materiality: enumOf(MATERIALITY),
  reconciliation: enumOf(RECONCILIATIONS),
  database_reference: nullableStr(
    "The supplied metric key or claim id this relates to, or null when nothing in the database covers it.",
  ),
  conflict_detail: nullableStr(
    "When reconciliation is 'Conflicts with database', state both values and their origins. Else null.",
  ),
});

const analystViewJson = obj({
  firm: str(),
  analyst: nullableStr(),
  rating: nullableStr("e.g. Buy, Hold, Overweight."),
  price_target: nullableNum(),
  previous_price_target: nullableNum(),
  currency: nullableStr(),
  view_date: nullableStr("ISO date, or null."),
  rationale: str(),
  source_urls: arr(str()),
});

const managementStatementJson = obj({
  speaker: str(),
  role: nullableStr(),
  statement: str("The company/management claim, quoted or closely paraphrased."),
  context: nullableStr("Where it was said: earnings call, press release, interview."),
  source_urls: arr(str()),
});

const socialSignalJson = obj({
  platform: str(),
  observation: str("What is being said. This is discovery only, never evidence."),
  source_urls: arr(str()),
});

export const webResearchJsonSchema = obj({
  queries_used: arr(str()),
  sources: arr(webSourceJson),
  findings: arr(findingJson),
  analyst_views: arr(analystViewJson),
  management_statements: arr(managementStatementJson),
  social_signals: arr(socialSignalJson),
  unresolved_questions: arr(str()),
  delta_summary: str("What genuinely changed versus the supplied database context."),
  no_new_information: { type: "boolean" },
});

export const webResearchValidator = z.object({
  queries_used: z.array(z.string()),
  sources: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      publisher: z.string().nullable(),
      source_type: z.enum(SOURCE_TYPES),
      source_tier: z.enum(SOURCE_TIERS),
      published_at: z.string().nullable(),
      summary: z.string(),
      is_paywalled: z.boolean(),
    }),
  ),
  findings: z.array(
    z.object({
      statement: z.string(),
      category: z.enum(CLAIM_CATEGORIES),
      value: z.string().nullable(),
      unit: z.string().nullable(),
      reporting_period: z.string().nullable(),
      source_urls: z.array(z.string()),
      materiality: z.enum(MATERIALITY),
      reconciliation: z.enum(RECONCILIATIONS),
      database_reference: z.string().nullable(),
      conflict_detail: z.string().nullable(),
    }),
  ),
  analyst_views: z.array(
    z.object({
      firm: z.string(),
      analyst: z.string().nullable(),
      rating: z.string().nullable(),
      price_target: z.number().nullable(),
      previous_price_target: z.number().nullable(),
      currency: z.string().nullable(),
      view_date: z.string().nullable(),
      rationale: z.string(),
      source_urls: z.array(z.string()),
    }),
  ),
  management_statements: z.array(
    z.object({
      speaker: z.string(),
      role: z.string().nullable(),
      statement: z.string(),
      context: z.string().nullable(),
      source_urls: z.array(z.string()),
    }),
  ),
  social_signals: z.array(
    z.object({
      platform: z.string(),
      observation: z.string(),
      source_urls: z.array(z.string()),
    }),
  ),
  unresolved_questions: z.array(z.string()),
  delta_summary: z.string(),
  no_new_information: z.boolean(),
});

export type WebResearchOutput = z.infer<typeof webResearchValidator>;
