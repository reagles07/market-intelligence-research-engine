/**
 * Phase 2B research orchestration — shared vocabulary (client-safe).
 *
 * The orchestrator only sequences the research engines that already exist.
 * Nothing here performs research; it names the steps, the statuses and the
 * default budgets so the UI and the server agree on one vocabulary.
 */

export const RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "PARTIAL",
  "READY_FOR_CONTENT",
  "NEEDS_REVIEW",
  "INSUFFICIENT_DATA",
  "FAILED",
  "CANCELLED",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETE",
  "SKIPPED",
  "WARNING",
  "FAILED",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const READINESS_RESULTS = [
  "READY_FOR_CONTENT",
  "NEEDS_REVIEW",
  "INSUFFICIENT_DATA",
  "BLOCKED_BY_CONFLICT",
] as const;
export type Readiness = (typeof READINESS_RESULTS)[number];

export const ORCHESTRATION_STEPS = [
  { key: "resolve_company", label: "Resolve Company" },
  { key: "data_freshness", label: "Check Data Freshness" },
  { key: "provider_sync", label: "Sync Provider Data" },
  { key: "analyze_database", label: "Analyze Database" },
  { key: "verify_claims", label: "Verify Claims" },
  { key: "initial_packet", label: "Build Initial Packet" },
  { key: "web_research", label: "Target Web Research" },
  { key: "reconcile", label: "Reconcile Sources" },
  { key: "final_packet", label: "Build Final Packet" },
  { key: "final_claim_check", label: "Final Claim Check" },
  { key: "scenarios", label: "Generate Scenarios" },
  { key: "readiness", label: "Research Readiness" },
] as const;
export type StepKey = (typeof ORCHESTRATION_STEPS)[number]["key"];

export const STEP_LABELS: Record<string, string> = Object.fromEntries(
  ORCHESTRATION_STEPS.map((s) => [s.key, s.label]),
);

/** Freshness verdicts for a stored dataset. */
export const FRESHNESS_STATES = ["FRESH", "STALE", "MISSING", "NOT_APPLICABLE"] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export type FreshnessEntry = {
  dataset: string;
  state: FreshnessState;
  reason: string;
  ageHours: number | null;
  required: boolean;
};

export const DEFAULT_RESEARCH_BUDGETS = {
  indiaMaxCompanyCalls: 5,
  webMaxQueries: 6,
  maxPacketBuilds: 2,
  maxScenarioRuns: 1,
  marketDataMaxAgeHours: 12,
  secMaxAgeDays: 7,
  financialsMaxAgeDays: 30,
  batchMaxStories: 3,
  indianApiQuotaReserve: 50,
};
export type ResearchBudgets = typeof DEFAULT_RESEARCH_BUDGETS;

/** Batch research is deliberately capped during Phase 2B. */
export const BATCH_HARD_LIMIT = 3;

export const READINESS_LABEL: Record<Readiness, string> = {
  READY_FOR_CONTENT: "Ready for content",
  NEEDS_REVIEW: "Needs review",
  INSUFFICIENT_DATA: "Insufficient data",
  BLOCKED_BY_CONFLICT: "Blocked by conflict",
};
