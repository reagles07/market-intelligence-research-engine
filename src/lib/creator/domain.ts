/**
 * Creator-facing presentation domain (UX cleanup phase).
 *
 * Pure, client-safe helpers that translate backend pipeline vocabulary into
 * plain creator language: data freshness states, research phase labels,
 * stalled-run detection and demo/test-artifact filtering.
 *
 * Nothing here changes research, evidence or audit behaviour — it only
 * decides how existing records are presented.
 */

// ---------------------------------------------------------------- freshness

export const DATA_FRESHNESS_STATES = [
  "CURRENT",
  "DELAYED",
  "STALE",
  "NO_RECENT_RUN",
  "AUTOMATION_OFF",
] as const;
export type DataFreshnessState = (typeof DATA_FRESHNESS_STATES)[number];

/** Hours thresholds for market/discovery data freshness. */
export const FRESHNESS_THRESHOLDS_HOURS = {
  current: 30, // roughly one market day plus processing slack
  delayed: 96, // up to 4 days
  noRunWindowDays: 14,
} as const;

export const FRESHNESS_LABEL: Record<DataFreshnessState, string> = {
  CURRENT: "Current",
  DELAYED: "Delayed",
  STALE: "Stale",
  NO_RECENT_RUN: "No recent run",
  AUTOMATION_OFF: "Automation off",
};

export const FRESHNESS_TONE: Record<DataFreshnessState, string> = {
  CURRENT: "border-emerald-300 bg-emerald-50 text-emerald-700",
  DELAYED: "border-sky-300 bg-sky-50 text-sky-700",
  STALE: "border-orange-300 bg-orange-50 text-orange-700",
  NO_RECENT_RUN: "border-border bg-muted text-muted-foreground",
  AUTOMATION_OFF: "border-slate-300 bg-slate-50 text-slate-700",
};

export const FRESHNESS_HELP: Record<DataFreshnessState, string> = {
  CURRENT: "A discovery run completed recently. Candidates reflect the latest scan.",
  DELAYED: "The last run is more than a day old. Consider running discovery again.",
  STALE: "The last run is several days old. Treat candidates as historical context.",
  NO_RECENT_RUN: "No discovery run in the last two weeks. Run discovery to get fresh ideas.",
  AUTOMATION_OFF:
    "Scheduled automation is off, so data only updates when you run discovery manually.",
};

/** Discovery run statuses that may represent "current market intelligence". */
export const ELIGIBLE_RUN_STATUSES = ["COMPLETED", "PARTIAL"] as const;

/** Run types that are acceptance/test artifacts and must never be the default run. */
export const TEST_RUN_TYPES = ["GOLDEN_PATH", "TEST", "ACCEPTANCE"] as const;

export function isEligibleRun(run: { status?: string | null; run_type?: string | null }): boolean {
  if (!run.status) return false;
  if (!(ELIGIBLE_RUN_STATUSES as readonly string[]).includes(run.status)) return false;
  return !(TEST_RUN_TYPES as readonly string[]).includes(run.run_type ?? "");
}

/** Age-only freshness, independent of whether the scheduler is on. */
export type DataAgeState = "CURRENT" | "DELAYED" | "STALE" | "NO_RECENT_RUN";

export const AGE_LABEL: Record<DataAgeState, string> = {
  CURRENT: "current",
  DELAYED: "delayed",
  STALE: "stale",
  NO_RECENT_RUN: "no recent run",
};

export function deriveDataAge(args: { lastRunAt: string | null | undefined; now?: Date }): {
  ageState: DataAgeState;
  ageHours: number | null;
} {
  const now = args.now ?? new Date();
  const ageHours = args.lastRunAt
    ? Math.max(0, (now.getTime() - new Date(args.lastRunAt).getTime()) / 3_600_000)
    : null;
  if (ageHours === null || ageHours > FRESHNESS_THRESHOLDS_HOURS.noRunWindowDays * 24) {
    return { ageState: "NO_RECENT_RUN", ageHours };
  }
  if (ageHours <= FRESHNESS_THRESHOLDS_HOURS.current) return { ageState: "CURRENT", ageHours };
  if (ageHours <= FRESHNESS_THRESHOLDS_HOURS.delayed) return { ageState: "DELAYED", ageHours };
  return { ageState: "STALE", ageHours };
}

/**
 * Derive the presentation freshness for one market.
 *
 * `state` is the headline badge (automation-off wins because it explains why
 * nothing will refresh), but `ageState` always reports the real data age so
 * "Automation off" can never hide the fact that the data is also stale.
 */
export function deriveDataFreshness(args: {
  automationEnabled: boolean;
  lastRunAt: string | null | undefined;
  now?: Date;
}): {
  state: DataFreshnessState;
  ageState: DataAgeState;
  ageHours: number | null;
  automationOff: boolean;
} {
  const { ageState, ageHours } = deriveDataAge({
    lastRunAt: args.lastRunAt,
    ...(args.now ? { now: args.now } : {}),
  });
  const automationOff = !args.automationEnabled;
  const state: DataFreshnessState = automationOff ? "AUTOMATION_OFF" : ageState;
  return { state, ageState, ageHours, automationOff };
}

export function formatAge(ageHours: number | null): string {
  if (ageHours === null) return "never";
  if (ageHours < 1) return "just now";
  if (ageHours < 24) return `${Math.round(ageHours)}h ago`;
  return `${Math.round(ageHours / 24)}d ago`;
}

/**
 * One honest line combining schedule state and data age, e.g.
 * "Automation off · last run 5d ago · stale".
 */
export function freshnessSummary(args: {
  automationEnabled: boolean;
  lastRunAt: string | null | undefined;
  now?: Date;
}): string {
  const { ageState, ageHours, automationOff } = deriveDataFreshness(args);
  const parts = [automationOff ? "Automation off" : "Automation on"];
  parts.push(ageHours === null ? "no discovery run recorded" : `last run ${formatAge(ageHours)}`);
  if (ageHours !== null) parts.push(AGE_LABEL[ageState]);
  return parts.join(" · ");
}

// ------------------------------------------------------- research in plain words

export type ResearchPhase = {
  label: string;
  tone: "active" | "good" | "warn" | "bad" | "muted";
  detail?: string | undefined;
};

/** Map an orchestration step key to a plain-language phase. */
export function phaseForStep(stepKey: string | null | undefined): string {
  switch (stepKey) {
    case "verify_claims":
    case "final_claim_check":
      return "Verifying claims";
    case "initial_packet":
    case "final_packet":
    case "scenarios":
      return "Assembling research packet";
    case "readiness":
      return "Checking readiness";
    default:
      return "Gathering sources";
  }
}

/**
 * Translate a research orchestration run (or packet status) into plain
 * language. Old RUNNING/QUEUED records are presented as stalled, never as
 * if work is actively happening.
 */
export function plainResearchPhase(args: {
  status: string | null | undefined;
  currentStep?: string | null | undefined;
  startedAt?: string | null | undefined;
  readiness?: string | null | undefined;
  stalledAfterMinutes?: number;
  now?: Date;
}): ResearchPhase {
  const status = args.status ?? "NONE";
  const stalledAfterMinutes = args.stalledAfterMinutes ?? 30;
  const now = args.now ?? new Date();

  if (status === "QUEUED" || status === "RUNNING") {
    const started = args.startedAt ? new Date(args.startedAt).getTime() : null;
    const isStalled = started !== null && now.getTime() - started > stalledAfterMinutes * 60_000;
    if (isStalled) {
      return {
        label: "Stalled",
        tone: "warn",
        detail: `Started ${formatAge(
          started === null ? null : (now.getTime() - started) / 3_600_000,
        )} with no completion — likely abandoned. You can safely re-run research.`,
      };
    }
    return { label: phaseForStep(args.currentStep), tone: "active" };
  }

  switch (status) {
    case "READY_FOR_CONTENT":
      return { label: "Ready for script", tone: "good" };
    case "NEEDS_REVIEW":
    case "PARTIAL":
      return { label: "Needs review", tone: "warn", detail: args.readiness ?? undefined };
    case "INSUFFICIENT_DATA":
      return { label: "Insufficient evidence", tone: "warn" };
    case "BLOCKED_BY_CONFLICT":
      return { label: "Blocked by conflicting sources", tone: "bad" };
    case "FAILED":
      return { label: "Failed", tone: "bad" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "muted" };
    default:
      return { label: "Not started", tone: "muted" };
  }
}

/** Minutes after which an in-flight operational run is presented as stalled. */
export const STALLED_AFTER_MINUTES = 30;

/**
 * Presentation-level stale detection for any operational run row
 * (research or content orchestration). The database status is never mutated —
 * historical acceptance semantics stay intact; we only stop showing ancient
 * RUNNING/QUEUED rows as if work were happening right now.
 */
export function isStalledRun(args: {
  status: string | null | undefined;
  startedAt: string | null | undefined;
  stalledAfterMinutes?: number;
  now?: Date;
}): boolean {
  const status = args.status ?? "";
  if (status !== "RUNNING" && status !== "QUEUED") return false;
  if (!args.startedAt) return false;
  const now = args.now ?? new Date();
  const minutes = args.stalledAfterMinutes ?? STALLED_AFTER_MINUTES;
  return now.getTime() - new Date(args.startedAt).getTime() > minutes * 60_000;
}

/** Plain label for an operational run, accounting for stalled state. */
export function operationalRunLabel(args: {
  status: string | null | undefined;
  startedAt: string | null | undefined;
  now?: Date;
}): { label: string; stalled: boolean } {
  if (isStalledRun(args)) return { label: "Stalled / abandoned", stalled: true };
  return { label: args.status ?? "—", stalled: false };
}

// ------------------------------------------------------------- test artifacts

/** Demo companies/stories and ZZTEST-style acceptance artifacts. */
export function isTestArtifact(input: {
  isDemo?: boolean | null;
  ticker?: string | null;
  name?: string | null;
}): boolean {
  if (input.isDemo) return true;
  const t = (input.ticker ?? "").toUpperCase();
  if (t.startsWith("ZZ")) return true;
  const n = (input.name ?? "").toLowerCase();
  return n.includes("acceptance") && n.includes("test");
}

// ------------------------------------------------------------------- universe

export const DISCOVERY_TRENDING_LABEL = "Discovery Trending 50";
export const DISCOVERY_TRENDING_NOTE =
  "Ranked by recent discovery activity (news, filings and web signals) — not by price or volume movers. A true Market Dynamic 50 will arrive with a structured movers/price/volume provider.";
