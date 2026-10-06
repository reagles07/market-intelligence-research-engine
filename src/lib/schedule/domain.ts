/**
 * Phase 2D-1 scheduling domain (client-safe).
 *
 * Everything here is pure: timezone maths, statuses and step definitions.
 * No provider, AI or database access. Market-local time is always derived
 * with Intl timezone rules — never with a fixed UTC offset, so US daylight
 * saving is handled correctly all year.
 */

export const SCHEDULE_MARKETS = ["India", "US"] as const;
export type ScheduleMarket = (typeof SCHEDULE_MARKETS)[number];

export const EXECUTION_TYPES = ["MAIN_DISCOVERY", "LATE_DELTA", "MANUAL", "RETRY"] as const;
export type ExecutionType = (typeof EXECUTION_TYPES)[number];

export const RUN_TRIGGERS = ["SCHEDULED", "MANUAL", "RETRY", "CATCHUP"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const RUN_STATUSES = [
  "SCHEDULED",
  "RUNNING",
  "COMPLETE",
  "COMPLETE_WITH_WARNINGS",
  "PARTIAL",
  "FAILED",
  "SKIPPED_MARKET_CLOSED",
  "SKIPPED_DISABLED",
  "SKIPPED_BUDGET",
  "SKIPPED_DUPLICATE",
  "CANCELLED",
  "MISSED",
  "POSSIBLY_STUCK",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_OK_STATUSES: RunStatus[] = ["COMPLETE", "COMPLETE_WITH_WARNINGS"];

export const STATUS_TONE: Record<string, string> = {
  COMPLETE: "text-emerald-600",
  COMPLETE_WITH_WARNINGS: "text-amber-600",
  PARTIAL: "text-amber-600",
  RUNNING: "text-sky-600",
  SCHEDULED: "text-muted-foreground",
  FAILED: "text-destructive",
  CANCELLED: "text-muted-foreground",
  MISSED: "text-amber-600",
  POSSIBLY_STUCK: "text-amber-600",
  SKIPPED_MARKET_CLOSED: "text-muted-foreground",
  SKIPPED_DISABLED: "text-muted-foreground",
  SKIPPED_BUDGET: "text-amber-600",
  SKIPPED_DUPLICATE: "text-muted-foreground",
};

/** The controller timeline, in execution order. */
export const CONTROLLER_STEPS = [
  { key: "market_day", label: "Market day check" },
  { key: "holiday", label: "Holiday check" },
  { key: "automation", label: "Automation enabled" },
  { key: "duplicate", label: "Duplicate run check" },
  { key: "order", label: "Run order check" },
  { key: "budget", label: "Budget preflight" },
  { key: "provider", label: "Provider health" },
  { key: "lock", label: "Acquire lock" },
  { key: "discovery", label: "Run discovery" },
  { key: "delta", label: "Delta baseline compare" },
  { key: "persist", label: "Save ranked queue" },
  { key: "pipeline", label: "Autonomous research + content" },
  { key: "unlock", label: "Release lock" },
] as const;

export type StepRecord = {
  key: string;
  label: string;
  status: "OK" | "SKIPPED" | "FAILED" | "WARNING" | "PLANNED";
  detail?: string | null;
  at: string;
};

export type ExecutionPlan = {
  market: ScheduleMarket;
  marketDate: string;
  timezone: string;
  executionType: ExecutionType;
  trigger: RunTrigger;
  marketOpen: boolean;
  marketClosedReason: string | null;
  executionKey: string;
  dryRun: boolean;
  estimatedProviderCalls: number;
  estimatedWebSearches: number;
  estimatedAiCalls: number;
  duplicateWouldBlock: boolean;
  notes: string[];
};

/** Stable identity for one scheduled execution. */
export function executionKey(
  market: string,
  marketDate: string,
  executionType: ExecutionType,
): string {
  return `${market.toUpperCase()}:${marketDate}:${executionType}`;
}

export function lockKey(market: string, marketDate: string, executionType: ExecutionType): string {
  return `LOCK:${executionKey(market, marketDate, executionType)}`;
}

function partsFor(tz: string, at: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) if (p.type !== "literal") out[p.type] = p.value;
  return out;
}

/** Market-local calendar date (YYYY-MM-DD) for an instant. */
export function marketDateFor(tz: string, at: Date = new Date()): string {
  const p = partsFor(tz, at);
  return `${p["year"]}-${p["month"]}-${p["day"]}`;
}

/** Minutes since market-local midnight. */
export function marketMinutesFor(tz: string, at: Date = new Date()): number {
  const p = partsFor(tz, at);
  const hour = Number(p["hour"]) % 24;
  return hour * 60 + Number(p["minute"]);
}

/** Market-local weekday short name, e.g. "Sat". */
export function marketWeekdayFor(tz: string, at: Date = new Date()): string {
  return partsFor(tz, at)["weekday"] ?? "";
}

export function isWeekend(tz: string, at: Date = new Date()): boolean {
  const day = marketWeekdayFor(tz, at);
  return day === "Sat" || day === "Sun";
}

export function isWeekendDate(isoDate: string): boolean {
  // A plain calendar date has no timezone; compare at UTC noon to avoid edges.
  const d = new Date(`${isoDate}T12:00:00Z`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** "18:30:00" | "18:30" → minutes since midnight. */
export function timeToMinutes(value: string): number {
  const [h = "0", m = "0"] = value.split(":");
  return Number(h) * 60 + Number(m);
}

export function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60)
    .toString()
    .padStart(2, "0");
  const m = (mins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Is a configured local time due right now, and is it still within the
 * catch-up window? Returns null when it is not due at all.
 */
export function dueState(args: {
  tz: string;
  localTime: string;
  catchupWindowMinutes: number;
  at?: Date;
}): { due: boolean; lateByMinutes: number; missed: boolean } {
  const now = marketMinutesFor(args.tz, args.at ?? new Date());
  const target = timeToMinutes(args.localTime);
  const lateBy = now - target;
  if (lateBy < 0) return { due: false, lateByMinutes: lateBy, missed: false };
  if (lateBy > args.catchupWindowMinutes)
    return { due: false, lateByMinutes: lateBy, missed: true };
  return { due: true, lateByMinutes: lateBy, missed: false };
}

export function isHighPriority(score: number | null | undefined, threshold: number): boolean {
  return typeof score === "number" && score >= threshold;
}

/** Minutes that `tz` is ahead of UTC at the given instant. */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const p = partsFor(tz, at);
  const asUtc = Date.UTC(
    Number(p["year"]),
    Number(p["month"]) - 1,
    Number(p["day"]),
    Number(p["hour"]) % 24,
    Number(p["minute"]),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/**
 * The UTC instant of a market-local wall time. DST-correct: the offset is
 * resolved from the candidate instant itself, never from a fixed constant.
 */
export function marketLocalToUtc(tz: string, isoDate: string, localTime: string): Date {
  const mins = timeToMinutes(localTime);
  const naive = Date.parse(`${isoDate}T00:00:00Z`) + mins * 60_000;
  let instant = new Date(naive - tzOffsetMinutes(tz, new Date(naive)) * 60_000);
  // One refinement pass handles instants that cross a DST transition.
  instant = new Date(naive - tzOffsetMinutes(tz, instant) * 60_000);
  return instant;
}
