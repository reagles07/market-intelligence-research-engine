/**
 * Phase 2D-2 — autonomous research + content pipeline (shared UI/server types).
 *
 * The pipeline itself creates nothing new: it sequences the already validated
 * discovery (2A), research orchestrator (2B) and content orchestrator (2C).
 */
export const PIPELINE_STAGES = [
  "QUALIFIED",
  "PROMOTED",
  "RESEARCH",
  "RESEARCH_DONE",
  "CONTENT",
  "DONE",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_STAGE_LABEL: Record<PipelineStage, string> = {
  QUALIFIED: "Qualified",
  PROMOTED: "Promoted to story",
  RESEARCH: "Researching",
  RESEARCH_DONE: "Research complete",
  CONTENT: "Generating content",
  DONE: "Finished",
};

export const PIPELINE_OUTCOMES = [
  "PENDING",
  "READY_FOR_REVIEW",
  "NEEDS_FACT_CHECK",
  "RESEARCH_REQUIRED",
  "RESEARCH_NOT_READY",
  "SKIPPED_BUDGET",
  "SKIPPED_CAP",
  "SKIPPED_DUPLICATE",
  "FAILED",
] as const;
export type PipelineOutcome = (typeof PIPELINE_OUTCOMES)[number];

export const PIPELINE_OUTCOME_LABEL: Record<PipelineOutcome, string> = {
  PENDING: "Pending",
  READY_FOR_REVIEW: "Ready for review",
  NEEDS_FACT_CHECK: "Needs fact check",
  RESEARCH_REQUIRED: "Research required",
  RESEARCH_NOT_READY: "Research not ready",
  SKIPPED_BUDGET: "Stopped — budget",
  SKIPPED_CAP: "Stopped — run cap",
  SKIPPED_DUPLICATE: "Already handled",
  FAILED: "Failed",
};

export const PIPELINE_OUTCOME_TONE: Record<PipelineOutcome, "good" | "warn" | "bad" | "muted"> = {
  PENDING: "muted",
  READY_FOR_REVIEW: "good",
  NEEDS_FACT_CHECK: "warn",
  RESEARCH_REQUIRED: "warn",
  RESEARCH_NOT_READY: "warn",
  SKIPPED_BUDGET: "muted",
  SKIPPED_CAP: "muted",
  SKIPPED_DUPLICATE: "muted",
  FAILED: "bad",
};
