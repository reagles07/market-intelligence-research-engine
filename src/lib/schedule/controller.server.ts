import type { Row as TableRow } from "@/lib/data-types";
/**
 * Phase 2D-1 daily run controller (server only).
 *
 * One code path serves scheduled and manual execution. The controller only
 * decides WHETHER and HOW discovery may run — the discovery pipeline itself
 * is the existing Phase 2A implementation, untouched.
 *
 * Nothing downstream is automated here: no promotion, no research, no
 * script generation, no publishing. That is Phase 2D-2.
 */
import type { Db } from "@/lib/ai/context.server";
import { runMarketDiscovery } from "@/lib/discovery/run.server";
import {
  CONTROLLER_STEPS,
  executionKey,
  isWeekendDate,
  lockKey,
  marketDateFor,
  marketLocalToUtc,
  type ExecutionType,
  type RunStatus,
  type RunTrigger,
  type ScheduleMarket,
  type StepRecord,
} from "@/lib/schedule/domain";

// Supabase rows are loosely typed here; the controller reads many optional columns.

export type ControllerInput = {
  db: Db;
  userId: string;
  market: ScheduleMarket;
  executionType: Extract<ExecutionType, "MAIN_DISCOVERY" | "LATE_DELTA">;
  trigger: RunTrigger;
  /** Bypass the duplicate gate and start a fresh attempt. */
  force?: boolean;
  /** Override the stored dry-run setting for this call only. */
  dryRun?: boolean;
  /** Override the market date (acceptance tests / holiday simulation). */
  marketDate?: string;
  model?: string | null;
};

export type ControllerResult = {
  status: RunStatus;
  dailyRunId: string | null;
  executionId: string | null;
  executionKey: string;
  market: ScheduleMarket;
  marketDate: string;
  timezone: string;
  executionType: ExecutionType;
  trigger: RunTrigger;
  dryRun: boolean;
  reused: boolean;
  skipReason: string | null;
  steps: StepRecord[];
  plan: Record<string, string | number | boolean | null>;
  providerCalls: number;
  webSearches: number;
  aiCalls: number;
  costUsd: number;
  candidates: { new: number; updated: number; unchanged: number; duplicate: number };
  topScore: number | null;
  discoveryRunId: string | null;
  /** Phase 2D-2 autonomous pipeline pass launched by this execution, if any. */
  pipelineRunId?: string | null;
  warnings: string[];
  errors: string[];
};

const stepLabel = (key: string) => CONTROLLER_STEPS.find((s) => s.key === key)?.label ?? key;

export async function loadAutomationSettings(db: Db) {
  const { data } = await db.from("automation_settings").select("*").limit(1).maybeSingle();
  if (data) return data;
  const { data: created } = await db
    .from("automation_settings")
    .insert({ singleton: true })
    .select("*")
    .single();
  if (!created) throw new Error("Failed to create automation settings");
  return created;
}

export async function loadMarketSchedule(db: Db, market: string) {
  const { data } = await db.from("market_schedules").select("*").eq("market", market).maybeSingle();
  if (!data) throw new Error(`No schedule configured for ${market}`);
  return data;
}

async function audit(db: Db, action: string, meta: Record<string, unknown>) {
  // Never log credentials — only controller decisions.
  await db.from("audit_logs").insert({ action, entity: "daily_run", meta: meta as never });
}

async function notify(
  db: Db,
  input: {
    kind: string;
    severity?: string;
    title: string;
    body?: string | null;
    market?: string | null;
    dailyRunId?: string | null;
    executionId?: string | null;
    candidateId?: string | null;
  },
) {
  await db.from("run_notifications").insert({
    kind: input.kind,
    severity: input.severity ?? "INFO",
    title: input.title,
    body: input.body ?? null,
    market: input.market ?? null,
    daily_run_id: input.dailyRunId ?? null,
    execution_id: input.executionId ?? null,
    candidate_id: input.candidateId ?? null,
  });
}

async function ensureDailyRun(args: {
  db: Db;
  market: string;
  marketDate: string;
  timezone: string;
  userId: string;
}) {
  const { db, market, marketDate } = args;
  const { data: existing } = await db
    .from("daily_market_runs")
    .select("*")
    .eq("market", market)
    .eq("market_date", marketDate)
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await db
    .from("daily_market_runs")
    .insert({
      market,
      market_date: marketDate,
      timezone: args.timezone,
      status: "SCHEDULED",
      created_by: args.userId,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the daily run");
  return data;
}

/** Roll the child executions up into the parent daily run row. */
async function rollupDailyRun(db: Db, dailyRunId: string) {
  const { data: rows } = await db
    .from("daily_run_executions")
    .select("*")
    .eq("daily_run_id", dailyRunId)
    .order("started_at", { ascending: true });
  const execs = rows ?? [];
  const real = execs.filter((e) => !e.dry_run);
  const sum = (k: keyof TableRow<"daily_run_executions">) =>
    real.reduce((a, e) => a + Number(e[k] ?? 0), 0);
  const main = [...real].reverse().find((e) => e.execution_type === "MAIN_DISCOVERY");
  const delta = [...real].reverse().find((e) => e.execution_type === "LATE_DELTA");
  const statuses = real.map((e) => String(e.status));
  const anyRunning = statuses.includes("RUNNING");
  const anyFailed = statuses.includes("FAILED");
  const anyWarn = statuses.includes("COMPLETE_WITH_WARNINGS") || statuses.includes("PARTIAL");
  const anyComplete = statuses.some((s) => s === "COMPLETE" || s === "COMPLETE_WITH_WARNINGS");

  const status = anyRunning
    ? "RUNNING"
    : anyFailed && anyComplete
      ? "PARTIAL"
      : anyFailed
        ? "FAILED"
        : anyWarn
          ? "COMPLETE_WITH_WARNINGS"
          : anyComplete
            ? "COMPLETE"
            : (real[real.length - 1]?.status ?? "SCHEDULED");

  const topScore = real.reduce<number | null>((acc, e) => {
    const v = e.top_score === null || e.top_score === undefined ? null : Number(e.top_score);
    return v !== null && (acc === null || v > acc) ? v : acc;
  }, null);

  await db
    .from("daily_market_runs")
    .update({
      status,
      main_run_status: main ? String(main.status) : null,
      delta_run_status: delta ? String(delta.status) : null,
      started_at: (real[0]?.started_at as string | undefined) ?? null,
      completed_at: anyRunning ? null : new Date().toISOString(),
      raw_signal_count: sum("raw_signal_count"),
      candidate_count: sum("new_candidates"),
      shortlisted_count: sum("high_priority_candidates"),
      top_score: topScore,
      provider_calls: sum("provider_calls"),
      web_searches: sum("web_searches"),
      ai_calls: sum("ai_calls"),
      input_tokens: sum("input_tokens"),
      output_tokens: sum("output_tokens"),
      estimated_cost_usd: real.reduce((a, e) => a + Number(e.estimated_cost_usd ?? 0), 0),
      warnings: real.flatMap((e) => (Array.isArray(e.warnings) ? e.warnings : [])) as never,
      errors: real.filter((e) => e.error).map((e) => e.error) as never,
    })
    .eq("id", dailyRunId);
}

// ------------------------------------------------------------------ locking
export async function acquireLock(db: Db, key: string, owner: string, ttlMinutes: number) {
  const now = Date.now();
  const { data: existing } = await db
    .from("run_locks")
    .select("*")
    .eq("lock_key", key)
    .maybeSingle();

  if (existing) {
    const expires = new Date(String(existing.expires_at)).getTime();
    if (expires > now) return { ok: false as const, holder: existing };
    // Stale lock from a crashed process — safe to take over.
    await db.from("run_locks").delete().eq("lock_key", key);
  }

  const { error } = await db.from("run_locks").insert({
    lock_key: key,
    owner,
    expires_at: new Date(now + ttlMinutes * 60_000).toISOString(),
  });
  if (error) return { ok: false as const, holder: null };
  return { ok: true as const, holder: null };
}

async function releaseLock(db: Db, key: string, owner: string) {
  await db.from("run_locks").delete().eq("lock_key", key).eq("owner", owner);
}

export async function heartbeat(db: Db, key: string, executionId: string, ttlMinutes: number) {
  const now = Date.now();
  await db
    .from("run_locks")
    .update({
      heartbeat_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttlMinutes * 60_000).toISOString(),
    })
    .eq("lock_key", key);
  await db
    .from("daily_run_executions")
    .update({ heartbeat_at: new Date(now).toISOString() })
    .eq("id", executionId);
}

// ------------------------------------------------------------------ budgets
async function usageToday(db: Db) {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [{ data: dayRows }, { data: monthRows }, { data: runRows }] = await Promise.all([
    db.from("ai_requests").select("estimated_cost_usd").gte("created_at", since),
    db.from("ai_requests").select("estimated_cost_usd").gte("created_at", monthStart.toISOString()),
    db.from("discovery_runs").select("web_search_calls").gte("started_at", since),
  ]);
  const sum = <T extends Record<string, number>>(rows: T[] | null, key: keyof T) =>
    (rows ?? []).reduce((a, r) => a + Number(r[key] ?? 0), 0);
  return {
    aiCostToday: sum(dayRows, "estimated_cost_usd"),
    aiCostMonth: sum(monthRows, "estimated_cost_usd"),
    webSearchesToday: sum(runRows, "web_search_calls"),
  };
}

// ------------------------------------------------------------------ delta compare
type DeltaCounts = { new: number; updated: number; unchanged: number; duplicate: number };

async function reconcileDelta(args: {
  db: Db;
  deltaRunId: string;
  baselineRunIds: string[];
}): Promise<DeltaCounts> {
  const { db, deltaRunId, baselineRunIds } = args;
  const counts: DeltaCounts = { new: 0, updated: 0, unchanged: 0, duplicate: 0 };
  if (!baselineRunIds.length) return counts;

  const { data: baselineRows } = await db
    .from("story_candidates")
    .select("id,cluster_key,content_score,signal_count")
    .in("discovery_run_id", baselineRunIds);
  const baseline = new Map<
    string,
    Pick<TableRow<"story_candidates">, "id" | "cluster_key" | "content_score" | "signal_count">
  >();
  for (const row of baselineRows ?? []) {
    if (row.cluster_key) baseline.set(String(row.cluster_key), row);
  }

  const { data: freshRows } = await db
    .from("story_candidates")
    .select("id,cluster_key,content_score,signal_count,title,catalyst,headline,url,event_at")
    .eq("discovery_run_id", deltaRunId);

  for (const fresh of freshRows ?? []) {
    const key = fresh.cluster_key ? String(fresh.cluster_key) : null;
    const prior = key ? baseline.get(key) : undefined;
    if (!prior) {
      counts.new += 1;
      continue;
    }
    counts.duplicate += 1;
    const materiallyChanged =
      Number(fresh.signal_count ?? 0) > Number(prior.signal_count ?? 0) ||
      Math.abs(Number(fresh.content_score ?? 0) - Number(prior.content_score ?? 0)) >= 1;

    if (materiallyChanged) {
      counts.updated += 1;
      await db
        .from("story_candidates")
        .update({
          content_score: fresh.content_score,
          signal_count: fresh.signal_count,
          headline: fresh.headline,
          url: fresh.url,
          event_at: fresh.event_at,
          catalyst: fresh.catalyst,
        })
        .eq("id", String(prior.id));
    } else {
      counts.unchanged += 1;
    }
    // The delta must never leave a second copy of an existing candidate.
    await db.from("story_candidates").delete().eq("id", String(fresh.id));
  }
  return counts;
}

// ------------------------------------------------------------------ controller
export async function runDailyController(input: ControllerInput): Promise<ControllerResult> {
  const { db, userId, market, executionType, trigger } = input;
  const settings = await loadAutomationSettings(db);
  const schedule = await loadMarketSchedule(db, market);

  const timezone = String(schedule.timezone);
  const marketDate = input.marketDate ?? marketDateFor(timezone);
  const key = executionKey(market, marketDate, executionType);
  const dryRun = input.dryRun ?? Boolean(settings.dry_run);

  // Scheduling telemetry: the 15-minute heartbeat means a run almost never
  // starts on the exact configured second, so lateness is recorded explicitly.
  const configuredLocal = String(
    executionType === "LATE_DELTA" ? schedule.delta_run_local : schedule.main_run_local,
  );
  const scheduledFor = marketLocalToUtc(timezone, marketDate, configuredLocal);
  const triggeredAt = new Date();
  const latenessMinutes = Math.round((triggeredAt.getTime() - scheduledFor.getTime()) / 60_000);
  const timing = {
    scheduled_for: scheduledFor.toISOString(),
    triggered_at: triggeredAt.toISOString(),
    lateness_minutes: latenessMinutes,
  };

  const steps: StepRecord[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const push = (
    stepKey: string,
    status: StepRecord["status"],
    detail?: string | null,
  ): StepRecord => {
    const rec: StepRecord = {
      key: stepKey,
      label: stepLabel(stepKey),
      status,
      detail: detail ?? null,
      at: new Date().toISOString(),
    };
    steps.push(rec);
    return rec;
  };

  const base = {
    status: "SCHEDULED" as RunStatus,
    dailyRunId: null as string | null,
    executionId: null as string | null,
    executionKey: key,
    market,
    marketDate,
    timezone,
    executionType: executionType as ExecutionType,
    trigger,
    dryRun,
    reused: false,
    skipReason: null as string | null,
    steps,
    plan: {} as Record<string, string | number | boolean | null>,
    providerCalls: 0,
    webSearches: 0,
    aiCalls: 0,
    costUsd: 0,
    candidates: { new: 0, updated: 0, unchanged: 0, duplicate: 0 },
    topScore: null as number | null,
    discoveryRunId: null as string | null,
    warnings,
    errors,
  };

  const dailyRun = await ensureDailyRun({ db, market, marketDate, timezone, userId });
  base.dailyRunId = String(dailyRun.id);

  // Executions are always recorded, including skips, so every decision is auditable.
  const recordSkip = async (status: RunStatus, reason: string) => {
    const { data } = await db
      .from("daily_run_executions")
      .insert({
        daily_run_id: base.dailyRunId!,
        market,
        market_date: marketDate,
        execution_type: executionType,
        execution_key: key,
        trigger,
        status,
        dry_run: dryRun,
        ...timing,
        skip_reason: reason,
        steps: steps as never,
        completed_at: new Date().toISOString(),
        created_by: userId,
      })
      .select("id")
      .single();
    await audit(db, `run.${status.toLowerCase()}`, { key, reason, trigger });
    await rollupDailyRun(db, base.dailyRunId!);
    return { ...base, status, skipReason: reason, executionId: data ? String(data.id) : null };
  };

  // -------------------------------------------------- market day / holiday
  const weekend = isWeekendDate(marketDate);
  if (schedule.skip_weekends && weekend) {
    push("market_day", "SKIPPED", "Weekend — the market is closed.");
    return recordSkip("SKIPPED_MARKET_CLOSED", "Weekend");
  }
  push("market_day", "OK", `${marketDate} is a weekday in ${timezone}.`);

  if (schedule.honor_holidays) {
    const { data: holiday } = await db
      .from("market_holidays")
      .select("holiday_name,market_closed")
      .eq("market", market)
      .eq("holiday_date", marketDate)
      .maybeSingle();
    if (holiday && holiday.market_closed) {
      push("holiday", "SKIPPED", String(holiday.holiday_name));
      return recordSkip("SKIPPED_MARKET_CLOSED", `Holiday: ${holiday.holiday_name}`);
    }
    push("holiday", "OK", "No configured market holiday.");
  } else {
    push("holiday", "SKIPPED", "Holiday calendar disabled for this market.");
  }

  // -------------------------------------------------- automation toggles
  const marketEnabled =
    market === "India" ? Boolean(settings.india_enabled) : Boolean(settings.us_enabled);
  if (trigger === "SCHEDULED" || trigger === "CATCHUP") {
    if (!settings.automation_enabled) {
      push("automation", "SKIPPED", "Global automation is off.");
      return recordSkip("SKIPPED_DISABLED", "Automation disabled");
    }
    if (!marketEnabled || !schedule.enabled) {
      push("automation", "SKIPPED", `${market} automation is off.`);
      return recordSkip("SKIPPED_DISABLED", `${market} automation disabled`);
    }
  }
  push("automation", "OK", trigger === "MANUAL" ? "Manual trigger." : "Automation enabled.");

  // -------------------------------------------------- idempotency
  const { data: priorRows } = await db
    .from("daily_run_executions")
    .select("*")
    .eq("execution_key", key)
    .eq("dry_run", false)
    .order("started_at", { ascending: false });
  const priors = priorRows ?? [];
  const running = priors.find((p) => p.status === "RUNNING");
  const completed = priors.find(
    (p) =>
      p.status === "COMPLETE" || p.status === "COMPLETE_WITH_WARNINGS" || p.status === "PARTIAL",
  );
  const failedCount = priors.filter((p) => p.status === "FAILED").length;

  if (!dryRun && running) {
    const stuckAfter = Number(settings.stuck_after_minutes ?? 30) * 60_000;
    const stale = Date.now() - new Date(String(running.started_at)).getTime() > stuckAfter;
    if (stale) {
      await db
        .from("daily_run_executions")
        .update({ status: "POSSIBLY_STUCK" })
        .eq("id", String(running.id));
      await notify(db, {
        kind: "RUN_STUCK",
        severity: "WARNING",
        title: `${market} ${executionType} may be stuck`,
        body: `Execution ${key} has been running longer than the configured threshold.`,
        market,
        dailyRunId: base.dailyRunId,
      });
    }
    push("duplicate", "SKIPPED", "An execution with this identity is already running.");
    return recordSkip("SKIPPED_DUPLICATE", "Execution already running");
  }

  if (!dryRun && completed && !input.force) {
    push("duplicate", "SKIPPED", "A completed execution already exists for this market date.");
    const skipped = await recordSkip("SKIPPED_DUPLICATE", "Already completed for this market date");
    return {
      ...skipped,
      reused: true,
      discoveryRunId: completed.discovery_run_id ? String(completed.discovery_run_id) : null,
      topScore: completed.top_score === null ? null : Number(completed.top_score),
    };
  }

  if (!dryRun && failedCount > 0 && trigger !== "MANUAL") {
    const maxRetries = Number(settings.max_retries ?? 1);
    if (failedCount > maxRetries) {
      push("duplicate", "SKIPPED", `Retry limit of ${maxRetries} reached.`);
      return recordSkip("FAILED", `Retry limit of ${maxRetries} reached`);
    }
  }
  push("duplicate", "OK", input.force ? "Force run requested." : "No conflicting execution.");

  // -------------------------------------------------- run order
  if (executionType === "LATE_DELTA") {
    const mainKey = executionKey(market, marketDate, "MAIN_DISCOVERY");
    const { data: mainRows } = await db
      .from("daily_run_executions")
      .select("id,status,discovery_run_id")
      .eq("execution_key", mainKey)
      .eq("dry_run", false)
      .order("started_at", { ascending: false });
    const mains = mainRows ?? [];
    if (mains.some((m) => m.status === "RUNNING")) {
      push("order", "SKIPPED", "The main discovery run is still running.");
      return recordSkip("SKIPPED_DUPLICATE", "Main run still in progress");
    }
    const doneMain = mains.find(
      (m) =>
        m.status === "COMPLETE" || m.status === "COMPLETE_WITH_WARNINGS" || m.status === "PARTIAL",
    );
    if (!doneMain && trigger !== "MANUAL") {
      push("order", "SKIPPED", "No completed main discovery run for this market date.");
      return recordSkip("MISSED", "Late delta has no main-run baseline");
    }
    push("order", "OK", doneMain ? "Main run baseline found." : "Manual delta without a baseline.");
  } else {
    push("order", "OK", "Main discovery runs first.");
  }

  // -------------------------------------------------- budget preflight
  const isDelta = executionType === "LATE_DELTA";
  const providerBudget =
    market === "India"
      ? Number(isDelta ? schedule.delta_max_provider_requests : schedule.main_max_provider_requests)
      : 0;
  const webBudget =
    market === "US"
      ? Number(isDelta ? schedule.delta_max_web_searches : schedule.main_max_web_searches)
      : 0;
  const evalBudget = Number(
    isDelta ? schedule.delta_max_eval_candidates : schedule.main_max_eval_candidates,
  );
  const estimatedAiCalls = evalBudget > 0 ? (market === "US" ? 2 : 1) : 0;

  base.plan = {
    providerBudget,
    webBudget,
    evalBudget,
    estimatedAiCalls,
    marketDate,
    timezone,
    executionType,
    trigger,
    configuredLocalTime: configuredLocal,
    scheduledFor: scheduledFor.toISOString(),
    latenessMinutes,
  };

  const usage = await usageToday(db);
  const aiDailyCap = Number(settings.ai_daily_cost_cap_usd ?? 0);
  const aiMonthlyCap = Number(settings.ai_monthly_cost_cap_usd ?? 0);
  const webCap = Number(settings.daily_web_search_cap ?? 0);

  // A dry run spends nothing, so a breached cap is reported as a warning
  // instead of stopping the preview of what a real run would do.
  const budgetBlock = async (detail: string, reason: string): Promise<ControllerResult | null> => {
    if (dryRun) {
      push("budget", "WARNING", `${detail} A real run would be blocked here.`);
      warnings.push(reason);
      return null;
    }
    push("budget", "SKIPPED", detail);
    return recordSkip("SKIPPED_BUDGET", reason);
  };

  if (aiDailyCap > 0 && usage.aiCostToday >= aiDailyCap) {
    if (!dryRun) {
      await notify(db, {
        kind: "AI_BUDGET",
        severity: "WARNING",
        title: "Daily AI cost cap reached",
        body: `Scheduled ${market} discovery was blocked before any spend.`,
        market,
        dailyRunId: base.dailyRunId,
      });
    }
    const stop = await budgetBlock(
      `Daily AI cost cap reached ($${usage.aiCostToday.toFixed(4)} of $${aiDailyCap}).`,
      `Daily AI cost cap ($${aiDailyCap})`,
    );
    if (stop) return stop;
  }
  if (aiMonthlyCap > 0 && usage.aiCostMonth >= aiMonthlyCap) {
    const stop = await budgetBlock(
      `Monthly AI cost cap reached ($${usage.aiCostMonth.toFixed(4)} of $${aiMonthlyCap}).`,
      `Monthly AI cost cap ($${aiMonthlyCap})`,
    );
    if (stop) return stop;
  }
  if (webBudget > 0 && webCap > 0 && usage.webSearchesToday + webBudget > webCap) {
    const stop = await budgetBlock(
      `Daily web-search cap would be exceeded (${usage.webSearchesToday}/${webCap}).`,
      `Daily web-search cap (${webCap})`,
    );
    if (stop) return stop;
  }

  // -------------------------------------------------- provider preflight
  let providerNote = "";
  if (market === "India" && providerBudget > 0) {
    const { getProviderStatus } = await import("@/lib/indianapi.server");
    const status = await getProviderStatus();
    if (!status.keyConfigured) {
      push("provider", "FAILED", "IndianAPI key is not configured.");
      return recordSkip("FAILED", "IndianAPI is not configured");
    }
    const reserve = Number(settings.indianapi_monthly_reserve ?? 0);
    if (status.remaining - providerBudget < reserve) {
      if (!dryRun) {
        await notify(db, {
          kind: "QUOTA_LOW",
          severity: "WARNING",
          title: "IndianAPI quota low",
          body: `Scheduled discovery stopped: ${status.remaining} requests remain and ${reserve} are reserved for manual work.`,
          market,
          dailyRunId: base.dailyRunId,
        });
      }
      const stop = await budgetBlock(
        `IndianAPI reserve protection: ${status.remaining} remaining, reserve ${reserve}, this run needs ${providerBudget}.`,
        `IndianAPI monthly reserve (${reserve})`,
      );
      if (stop) return stop;
    }
    providerNote = `IndianAPI ${status.remaining} requests remaining (reserve ${reserve}).`;
  } else if (market === "US") {
    providerNote = "SEC EDGAR + web discovery — PARTIAL_MARKET_COVERAGE.";
  }
  push(
    "budget",
    "OK",
    `Provider ${providerBudget}, web ${webBudget}, AI candidates ${evalBudget}.`,
  );
  push("provider", "OK", providerNote || "No critical provider required.");

  // -------------------------------------------------- dry run stops here
  if (dryRun) {
    push("discovery", "PLANNED", "Dry run — no provider, web or AI calls were made.");
    const { data } = await db
      .from("daily_run_executions")
      .insert({
        daily_run_id: base.dailyRunId,
        market,
        market_date: marketDate,
        execution_type: executionType,
        execution_key: key,
        trigger,
        status: "COMPLETE",
        dry_run: true,
        ...timing,
        steps: steps as never,
        plan: base.plan as never,
        completed_at: new Date().toISOString(),
        created_by: userId,
      })
      .select("id")
      .single();
    const dryExecutionId = data ? String(data.id) : null;

    // Phase 2D-2 preview: show what the autonomous pipeline WOULD do without
    // promoting, researching or writing anything.
    let dryPipelineId: string | null = null;
    try {
      const { runAutonomousPipeline } = await import("@/lib/automation/pipeline.server");
      const preview = await runAutonomousPipeline({
        db,
        userId,
        market,
        marketDate,
        executionType,
        trigger,
        dryRun: true,
        discoveryRunId: null,
        executionId: dryExecutionId,
        dailyRunId: base.dailyRunId,
        model: input.model ?? null,
      });
      dryPipelineId = preview.pipelineRunId;
      push(
        "pipeline",
        preview.status === "SKIPPED" ? "SKIPPED" : "PLANNED",
        preview.status === "SKIPPED"
          ? "Autonomous research + content is off."
          : `${preview.qualified} of ${preview.considered} recent candidates would qualify.`,
      );
      await db
        .from("daily_run_executions")
        .update({ steps: steps as never })
        .eq("id", dryExecutionId ?? "");
    } catch {
      // A preview must never fail the dry run.
    }

    await audit(db, "run.dry_run", { key, plan: base.plan });
    return {
      ...base,
      status: "COMPLETE",
      executionId: dryExecutionId,
      pipelineRunId: dryPipelineId,
      skipReason: "Dry run",
    };
  }

  // -------------------------------------------------- lock
  const lk = lockKey(market, marketDate, executionType);
  const owner = `${userId}:${Date.now()}`;
  const ttl = Number(settings.lock_ttl_minutes ?? 20);
  const lock = await acquireLock(db, lk, owner, ttl);
  if (!lock.ok) {
    push("lock", "SKIPPED", "Another execution holds the lock for this market date.");
    await audit(db, "run.lock_denied", { key });
    return recordSkip("SKIPPED_DUPLICATE", "Run lock held by another execution");
  }
  push("lock", "OK", "Lock acquired.");
  await audit(db, "run.lock_acquired", { key, trigger });

  const { data: execRow, error: execError } = await db
    .from("daily_run_executions")
    .insert({
      daily_run_id: base.dailyRunId,
      market,
      market_date: marketDate,
      execution_type: executionType,
      execution_key: key,
      attempt: priors.length + 1,
      trigger,
      status: "RUNNING",
      dry_run: false,
      ...timing,
      steps: steps as never,
      plan: base.plan as never,
      heartbeat_at: new Date().toISOString(),
      created_by: userId,
    })
    .select("id")
    .single();
  if (execError || !execRow) {
    await releaseLock(db, lk, owner);
    throw new Error(execError?.message ?? "Could not create the execution record");
  }
  base.executionId = String(execRow.id);
  await rollupDailyRun(db, base.dailyRunId);

  try {
    await heartbeat(db, lk, base.executionId, ttl);

    // Retry safety: if an earlier attempt already paid for discovery, reuse
    // that discovery run instead of spending provider/web/AI budget again.
    const salvageable = priors.find(
      (p) => p.status === "FAILED" && p.discovery_run_id && Number(p.raw_signal_count ?? 0) > 0,
    );
    if (salvageable) {
      const { data: reusedRun } = await db
        .from("discovery_runs")
        .select("*")
        .eq("id", String(salvageable.discovery_run_id))
        .maybeSingle();
      const prev = reusedRun;
      if (prev && (prev.status === "COMPLETE" || prev.status === "COMPLETE_WITH_WARNINGS")) {
        push(
          "discovery",
          "OK",
          `Reused discovery run from attempt ${salvageable.attempt} — no provider, web or AI spend.`,
        );
        const { data: kept } = await db
          .from("story_candidates")
          .select("id,content_score")
          .eq("discovery_run_id", String(prev.id))
          .order("content_score", { ascending: false });
        const keptRows = kept ?? [];
        await releaseLock(db, lk, owner);
        push("unlock", "OK", "Lock released.");
        await db
          .from("daily_run_executions")
          .update({
            status: "COMPLETE",
            completed_at: new Date().toISOString(),
            steps: steps as never,
            discovery_run_id: String(prev.id),
            raw_signal_count: Number(prev.raw_signals ?? 0),
            new_candidates: keptRows.length,
            top_score: keptRows.length ? Number(keptRows[0]!.content_score ?? 0) : null,
          })
          .eq("id", base.executionId);
        await rollupDailyRun(db, base.dailyRunId);
        await audit(db, "run.retry_reused", { key, discoveryRunId: String(prev.id) });
        return {
          ...base,
          status: "COMPLETE",
          reused: true,
          discoveryRunId: String(prev.id),
          candidates: { new: keptRows.length, updated: 0, unchanged: 0, duplicate: 0 },
          topScore: keptRows.length ? Number(keptRows[0]!.content_score ?? 0) : null,
        };
      }
    }

    const discovery = await runMarketDiscovery({
      db,
      userId,
      market,
      model: input.model ?? null,
      runType: isDelta ? "DELTA" : trigger === "MANUAL" ? "MANUAL" : "SCHEDULED",
      budgets: { provider: providerBudget, web: webBudget, evaluate: evalBudget },
    });
    base.discoveryRunId = discovery.runId;
    base.providerCalls = discovery.providerRequests;
    base.webSearches = discovery.webSearchCalls;
    base.aiCalls = discovery.aiCalls;
    base.costUsd = discovery.costUsd;
    errors.push(...discovery.errors);
    push(
      "discovery",
      discovery.errors.length ? "WARNING" : "OK",
      `${discovery.rawSignals} raw signals, ${discovery.candidatesCreated} candidates, ${discovery.duplicatesMerged} clustered duplicates.`,
    );

    // Cancellation is observed at the next step boundary; work already paid
    // for is preserved and no further orchestration steps are launched.
    const { data: cancelRow } = await db
      .from("daily_run_executions")
      .select("cancel_requested")
      .eq("id", base.executionId)
      .maybeSingle();
    if (cancelRow?.cancel_requested) {
      await releaseLock(db, lk, owner);
      push("unlock", "OK", "Cancelled — lock released, completed data preserved.");
      await db
        .from("daily_run_executions")
        .update({
          status: "CANCELLED",
          completed_at: new Date().toISOString(),
          steps: steps as never,
          discovery_run_id: discovery.runId,
          provider_calls: base.providerCalls,
          web_searches: base.webSearches,
          ai_calls: base.aiCalls,
          estimated_cost_usd: base.costUsd,
          raw_signal_count: discovery.rawSignals,
        })
        .eq("id", base.executionId);
      await rollupDailyRun(db, base.dailyRunId);
      await audit(db, "run.cancelled", { key });
      return { ...base, status: "CANCELLED", skipReason: "Cancelled by request" };
    }

    // -------------------------------------------------- delta reconciliation
    let counts: DeltaCounts = {
      new: discovery.candidatesCreated,
      updated: 0,
      unchanged: 0,
      duplicate: 0,
    };
    if (isDelta) {
      const mainKey = executionKey(market, marketDate, "MAIN_DISCOVERY");
      const { data: mainRows } = await db
        .from("daily_run_executions")
        .select("discovery_run_id")
        .eq("execution_key", mainKey)
        .eq("dry_run", false)
        .not("discovery_run_id", "is", null);
      const baselineRunIds = (mainRows ?? [])
        .map((m) => String(m.discovery_run_id))
        .filter(Boolean);
      counts = await reconcileDelta({ db, deltaRunId: discovery.runId, baselineRunIds });
      push(
        "delta",
        "OK",
        `${counts.new} new, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.duplicate} duplicates prevented.`,
      );
    } else {
      push("delta", "SKIPPED", "Main run — no baseline comparison needed.");
    }
    base.candidates = counts;

    // -------------------------------------------------- ranked queue + alerts
    const { data: remaining } = await db
      .from("story_candidates")
      .select("id,content_score,company_name,title")
      .eq("discovery_run_id", discovery.runId)
      .order("content_score", { ascending: false });
    const surviving = remaining ?? [];
    const threshold = Number(settings.high_priority_delta_threshold ?? 80);
    const highPriority = surviving.filter((c) => Number(c.content_score ?? 0) >= threshold);
    base.topScore = surviving.length ? Number(surviving[0]!.content_score ?? 0) : null;
    push("persist", "OK", `${surviving.length} candidates in the ranked queue.`);

    if (isDelta && highPriority.length) {
      for (const c of highPriority) {
        await notify(db, {
          kind: "DELTA_HIGH_PRIORITY",
          severity: "WARNING",
          title: "New high-priority story found after the main run",
          body: `${c.company_name}: ${c.title} (score ${Number(c.content_score ?? 0).toFixed(0)})`,
          market,
          dailyRunId: base.dailyRunId,
          executionId: base.executionId,
          candidateId: String(c.id),
        });
      }
    }

    // -------------------------------------------------- Phase 2D-2 pipeline
    // Discovery is finished and paid for. The autonomous pipeline runs only
    // when its own switch is on, and it stops itself on caps and budget.
    let pipelineRunId: string | null = null;
    try {
      const { runAutonomousPipeline } = await import("@/lib/automation/pipeline.server");
      const pipeline = await runAutonomousPipeline({
        db,
        userId,
        market,
        marketDate,
        executionType,
        trigger,
        dryRun: false,
        discoveryRunId: discovery.runId,
        executionId: base.executionId,
        dailyRunId: base.dailyRunId,
        model: input.model ?? null,
      });
      pipelineRunId = pipeline.pipelineRunId;
      warnings.push(...pipeline.warnings);
      errors.push(...pipeline.errors);
      push(
        "pipeline",
        pipeline.status === "SKIPPED" ? "SKIPPED" : pipeline.errors.length ? "WARNING" : "OK",
        pipeline.status === "SKIPPED"
          ? (pipeline.skipReason ?? "Autonomous pipeline is off.")
          : `${pipeline.promoted} promoted · ${pipeline.researchReady}/${pipeline.researched} research ready · ${pipeline.readyForReview}/${pipeline.contentRuns} scripts ready for review.`,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      warnings.push(`Autonomous pipeline error: ${message}`);
      push("pipeline", "FAILED", message);
    }

    const status: RunStatus = errors.length ? "COMPLETE_WITH_WARNINGS" : "COMPLETE";
    if (errors.length) warnings.push(...errors);

    await releaseLock(db, lk, owner);
    push("unlock", "OK", "Lock released.");

    await db
      .from("daily_run_executions")
      .update({
        status,
        completed_at: new Date().toISOString(),
        steps: steps as never,
        discovery_run_id: discovery.runId,
        provider_calls: base.providerCalls,
        web_searches: base.webSearches,
        ai_calls: base.aiCalls,
        estimated_cost_usd: base.costUsd,
        raw_signal_count: discovery.rawSignals,
        new_candidates: counts.new,
        updated_candidates: counts.updated,
        unchanged_candidates: counts.unchanged,
        duplicate_candidates: counts.duplicate,
        high_priority_candidates: highPriority.length,
        top_score: base.topScore,
        warnings: warnings as never,
      })
      .eq("id", base.executionId);
    await rollupDailyRun(db, base.dailyRunId);

    await notify(db, {
      kind: errors.length ? "DISCOVERY_WARNING" : "DISCOVERY_COMPLETE",
      severity: errors.length ? "WARNING" : "INFO",
      title: `${market} ${isDelta ? "late delta" : "discovery"} ${errors.length ? "completed with warnings" : "complete"}`,
      body: `${counts.new} new candidates for ${marketDate}.`,
      market,
      dailyRunId: base.dailyRunId,
      executionId: base.executionId,
    });
    await audit(db, "run.completed", { key, status, cost: base.costUsd });

    return { ...base, status, pipelineRunId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    errors.push(message);
    push("discovery", "FAILED", message);
    await releaseLock(db, lk, owner);
    await db
      .from("daily_run_executions")
      .update({
        status: "FAILED",
        completed_at: new Date().toISOString(),
        steps: steps as never,
        error: message,
        discovery_run_id: base.discoveryRunId,
        provider_calls: base.providerCalls,
        web_searches: base.webSearches,
        ai_calls: base.aiCalls,
        estimated_cost_usd: base.costUsd,
      })
      .eq("id", base.executionId);
    await rollupDailyRun(db, base.dailyRunId);
    await notify(db, {
      kind: "DISCOVERY_FAILED",
      severity: "ERROR",
      title: `${market} ${executionType} failed`,
      body: message.slice(0, 400),
      market,
      dailyRunId: base.dailyRunId,
      executionId: base.executionId,
    });
    await audit(db, "run.failed", { key, error: message.slice(0, 300) });
    return { ...base, status: "FAILED" };
  }
}

/** Cancel a running execution; active provider calls are allowed to finish. */
export async function requestCancel(db: Db, executionId: string) {
  await db
    .from("daily_run_executions")
    .update({ cancel_requested: true, status: "CANCELLED", completed_at: new Date().toISOString() })
    .eq("id", executionId);
  const { data } = await db
    .from("daily_run_executions")
    .select("daily_run_id,market,market_date,execution_type")
    .eq("id", executionId)
    .maybeSingle();
  if (data) {
    const row = data;
    await db
      .from("run_locks")
      .delete()
      .eq(
        "lock_key",
        lockKey(String(row.market), String(row.market_date), row.execution_type as ExecutionType),
      );
    await rollupDailyRun(db, String(row.daily_run_id));
  }
  return { ok: true };
}
