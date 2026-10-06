/**
 * Phase 2C — Content Orchestrator domain constants (client-safe).
 *
 * The content orchestrator NEVER researches and NEVER publishes. It only
 * sequences the content engines that already exist:
 *   packet selection → style → script generation → word budget →
 *   numeric pre-check → fact audit → repair → gap escalation → readiness.
 */

export const CONTENT_STEPS = [
  { key: "validate_story", label: "Validate Story" },
  { key: "select_packet", label: "Select Research Packet" },
  { key: "select_style", label: "Apply Script Style" },
  { key: "cache_check", label: "Duplicate Request Check" },
  { key: "generate_scripts", label: "Generate Scripts" },
  { key: "word_budget", label: "Word Budget Check" },
  { key: "numeric_precheck", label: "Numeric Pre-Check" },
  { key: "fact_audit", label: "Fact Audit" },
  { key: "repair", label: "Evidence-Locked Repair" },
  { key: "gap_escalation", label: "Research Gap Escalation" },
  { key: "readiness", label: "Content Readiness" },
] as const;
export type ContentStepKey = (typeof CONTENT_STEPS)[number]["key"];

export const CONTENT_STEP_LABELS: Record<string, string> = Object.fromEntries(
  CONTENT_STEPS.map((s) => [s.key, s.label]),
);

export const CONTENT_STEP_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETE",
  "SKIPPED",
  "WARNING",
  "FAILED",
] as const;
export type ContentStepStatus = (typeof CONTENT_STEP_STATUSES)[number];

export const CONTENT_READINESS = [
  "READY_FOR_REVIEW",
  "NEEDS_FACT_CHECK",
  "RESEARCH_REQUIRED",
  "BLOCKED",
  "FAILED",
] as const;
export type ContentReadiness = (typeof CONTENT_READINESS)[number];

export const CONTENT_READINESS_LABEL: Record<ContentReadiness, string> = {
  READY_FOR_REVIEW: "Ready for human review",
  NEEDS_FACT_CHECK: "Needs fact check",
  RESEARCH_REQUIRED: "Research required",
  BLOCKED: "Blocked",
  FAILED: "Failed",
};

/** Story-level content production status. */
export const CONTENT_STORY_STATUSES = [
  "NOT_STARTED",
  "IN_PRODUCTION",
  "READY_FOR_REVIEW",
  "NEEDS_FACT_CHECK",
  "RESEARCH_REQUIRED",
  "FAILED",
] as const;

/** Manual batches stay deliberately small during Phase 2C. */
export const CONTENT_BATCH_HARD_LIMIT = 3;

/** Only these research verdicts may enter content production. */
export const CONTENT_ELIGIBLE_READINESS = ["READY_FOR_CONTENT", "NEEDS_REVIEW"] as const;
