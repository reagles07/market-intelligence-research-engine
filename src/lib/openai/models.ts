/**
 * OpenAI model registry (client-safe).
 *
 * The model is a configuration value, not a business rule: every AI feature
 * takes the model id from here, so switching models in Settings never requires
 * touching research or script logic.
 *
 * Prices are USD per 1M tokens and are used only for *estimated* cost display.
 */

export type OpenAiModelId = (typeof OPENAI_MODELS)[number]["id"];

export const OPENAI_MODELS = [
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    detail: "Default — deep research, scenarios, final packets",
    inputPer1M: 1.25,
    outputPer1M: 10,
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    detail: "Balanced cost for routine analysis",
    inputPer1M: 0.25,
    outputPer1M: 2,
  },
  {
    id: "gpt-5.4-nano",
    label: "GPT-5.4 nano",
    detail: "Cheapest — classification and short summaries",
    inputPer1M: 0.05,
    outputPer1M: 0.4,
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    detail: "Strongest reasoning, highest cost",
    inputPer1M: 2,
    outputPer1M: 16,
  },
  {
    id: "gpt-5.2",
    label: "GPT-5.2",
    detail: "Previous generation",
    inputPer1M: 1.25,
    outputPer1M: 10,
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    detail: "Non-reasoning fallback",
    inputPer1M: 0.4,
    outputPer1M: 1.6,
  },
] as const;

export const DEFAULT_OPENAI_MODEL: OpenAiModelId = "gpt-5.4";

/** Web search is billed per call, independent of tokens. */
export const WEB_SEARCH_COST_USD = 0.01;

export const MODEL_IDS = OPENAI_MODELS.map((m) => m.id) as readonly string[];

export function isKnownModel(id: string): id is OpenAiModelId {
  return MODEL_IDS.includes(id);
}

export function modelPricing(id: string) {
  return OPENAI_MODELS.find((m) => m.id === id) ?? OPENAI_MODELS[0];
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  webSearchCalls = 0,
): number {
  const p = modelPricing(model);
  return (
    (inputTokens / 1_000_000) * p.inputPer1M +
    (outputTokens / 1_000_000) * p.outputPer1M +
    webSearchCalls * WEB_SEARCH_COST_USD
  );
}

/** The three operating modes from the research architecture. */
export const AI_MODES = ["DATABASE", "WEB", "HYBRID"] as const;
export type AiMode = (typeof AI_MODES)[number];

export const AI_MODE_LABELS: Record<AiMode, string> = {
  DATABASE: "Database research",
  WEB: "Web research",
  HYBRID: "Hybrid research",
};

export const MODEL_STORAGE_KEY = "srs:openai-model";
