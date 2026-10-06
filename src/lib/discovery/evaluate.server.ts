/**
 * Stage 2 — lightweight candidate evaluation (server only).
 *
 * Runs on the top N candidates of ONE market, in a single batched call.
 * It may weigh storytelling, refine novelty/audience/catalyst within tight
 * bounds and propose an angle. It may not research the company, add an event,
 * assert a number, or turn a rumour into a fact.
 */
import { callStructured } from "@/lib/openai.server";
import {
  candidateEvaluationJsonSchema,
  candidateEvaluationValidator,
} from "@/lib/discovery/schemas";
import type { CandidateDraft } from "@/lib/discovery/cluster";
import type { ScoreComponentResult } from "@/lib/discovery/scoring";

export type EvaluationInput = {
  ref: string;
  draft: CandidateDraft;
  components: ScoreComponentResult[];
};

export type Evaluation = {
  ref: string;
  storytelling: number;
  storytellingReason: string;
  noveltyAdjust: number;
  audienceAdjust: number;
  catalystAdjust: number;
  angle: string;
  hook: string;
  coreQuestion: string;
  notes: string;
};

export async function evaluateCandidates(args: {
  market: "India" | "US";
  model: string | null;
  userId: string;
  candidates: EvaluationInput[];
}): Promise<{
  ok: boolean;
  error: string | null;
  evaluations: Evaluation[];
  aiCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}> {
  if (!args.candidates.length) {
    return {
      ok: true,
      error: null,
      evaluations: [],
      aiCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  }

  const brief = args.candidates
    .map((c) => {
      const d = c.draft;
      const missing = c.components.filter((x) => !x.available).map((x) => x.label);
      return [
        `REF ${c.ref}`,
        `Company: ${d.companyName}${d.ticker ? ` (${d.ticker})` : ""} · ${d.market}`,
        `Candidate: ${d.title}`,
        `Signals (${d.signalCount}): ${d.discoveryReason}`,
        `Types: ${d.candidateTypes.join(", ")}`,
        `Catalyst: ${d.catalyst ?? "not stated"}`,
        `Provider price move: ${d.priceMovePct === null ? "not available" : `${d.priceMovePct}%`}`,
        `Volume ratio: ${d.volumeRatio === null ? "not available" : `${d.volumeRatio}x`}`,
        `52-week: ${d.week52Event ?? "none"}`,
        `Headline: ${d.headline ?? "none"}`,
        `Deterministic score so far: ${c.components.filter((x) => x.available).reduce((s, x) => s + x.points, 0)}`,
        `Data NOT available: ${missing.length ? missing.join(", ") : "none"}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const res = await callStructured({
    operation: "discovery-candidate-evaluation",
    mode: "DATABASE",
    model: args.model,
    instructions: `You are triaging story candidates for a Tamil-language stock content studio.

WHAT YOU ARE SCORING
Content Opportunity — how good a STORY this is for an audience. This is NOT a buy
score, NOT an investment score, NOT stock quality, NOT return potential. Never phrase
anything as a recommendation and never say whether the stock is attractive.

HARD RULES
- Judge ONLY the facts supplied below. You have no web access here and no company
  knowledge you may use. If the supplied facts are thin, say so and score low.
- Never invent an event, a number, a reaction or a reason to raise storytelling.
- A missing data point stays missing. Do not compensate for it with a guess.
- Storytelling 0-5 rewards real narrative tension already visible in the supplied
  facts: a contradiction (results strong, stock fell), a mystery (large move with no
  stated cause), an expectation gap, or a risk/reward tension. Generic "this is
  interesting" is 0-1.
- Adjustments are nudges, not rewrites: novelty and audience -2..+2, catalyst -3..+3.
- Angle, hook and core question are one line each. Do NOT write script lines, do NOT
  write narration, do NOT do the research.`,
    input: `Market: ${args.market}. Today is ${new Date().toISOString().slice(0, 10)}.

Evaluate each candidate below and return one evaluation per REF, using the REF verbatim.

${brief}`,
    schemaName: "candidate_evaluation",
    jsonSchema: candidateEvaluationJsonSchema,
    validator: candidateEvaluationValidator,
    webSearch: false,
    maxOutputTokens: 12000,
    userId: args.userId,
  });

  if (!res.ok) {
    return {
      ok: false,
      error: res.error,
      evaluations: [],
      aiCalls: 1,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      costUsd: res.usage.estimatedCostUsd,
    };
  }

  return {
    ok: true,
    error: null,
    evaluations: res.data.evaluations.map((e) => ({
      ref: e.candidate_ref,
      storytelling: e.storytelling_potential,
      storytellingReason: e.storytelling_reason,
      noveltyAdjust: e.novelty_adjust,
      audienceAdjust: e.audience_adjust,
      catalystAdjust: e.catalyst_adjust,
      angle: e.suggested_angle,
      hook: e.suggested_hook,
      coreQuestion: e.core_question,
      notes: e.notes,
    })),
    aiCalls: 1,
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
    costUsd: res.usage.estimatedCostUsd,
  };
}
