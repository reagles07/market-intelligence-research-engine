/**
 * Phase 2D-1 scheduling server functions.
 *
 * The browser never runs the controller itself; it only asks the server to.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SCHEDULE_MARKETS } from "@/lib/schedule/domain";

const runInput = z.object({
  market: z.enum(SCHEDULE_MARKETS),
  executionType: z.enum(["MAIN_DISCOVERY", "LATE_DELTA"]),
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  marketDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const getAutomationConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;
    const { loadAutomationSettings } = await import("@/lib/schedule/controller.server");
    const settings = await loadAutomationSettings(db);
    const [{ data: schedules }, { data: holidays }] = await Promise.all([
      db.from("market_schedules").select("*").order("market"),
      db
        .from("market_holidays")
        .select("*")
        .gte("holiday_date", new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10))
        .order("holiday_date"),
    ]);
    return { settings, schedules: schedules ?? [], holidays: holidays ?? [] };
  });

export const updateAutomationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Record<string, unknown>) =>
    z
      .object({
        automation_enabled: z.boolean().optional(),
        dry_run: z.boolean().optional(),
        india_enabled: z.boolean().optional(),
        us_enabled: z.boolean().optional(),
        max_retries: z.number().int().min(0).max(5).optional(),
        catchup_window_minutes: z.number().int().min(0).max(720).optional(),
        stuck_after_minutes: z.number().int().min(5).max(720).optional(),
        ai_daily_cost_cap_usd: z.number().min(0).optional(),
        ai_monthly_cost_cap_usd: z.number().min(0).optional(),
        daily_web_search_cap: z.number().int().min(0).optional(),
        indianapi_monthly_reserve: z.number().int().min(0).optional(),
        high_priority_delta_threshold: z.number().min(0).max(100).optional(),
        autonomous_enabled: z.boolean().optional(),
        autonomous_ai_budget_percent: z.number().min(0).max(100).optional(),
        min_content_score_india: z.number().min(0).max(100).optional(),
        min_content_score_us: z.number().min(0).max(100).optional(),
        min_score_coverage_india: z.number().min(0).max(100).optional(),
        min_score_coverage_us: z.number().min(0).max(100).optional(),
        max_research_main: z.number().int().min(0).max(10).optional(),
        max_content_main: z.number().int().min(0).max(10).optional(),
        max_research_delta: z.number().int().min(0).max(10).optional(),
        max_content_delta: z.number().int().min(0).max(10).optional(),
        autonomous_long_enabled: z.boolean().optional(),
        autonomous_long_min_score: z.number().min(0).max(100).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { loadAutomationSettings } = await import("@/lib/schedule/controller.server");
    const current = await loadAutomationSettings(context.supabase);
    const { error } = await context.supabase
      .from("automation_settings")
      .update(data as never)
      .eq("id", String(current.id));
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateMarketSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Record<string, unknown>) =>
    z
      .object({
        market: z.enum(SCHEDULE_MARKETS),
        patch: z.object({
          enabled: z.boolean().optional(),
          timezone: z.string().min(2).optional(),
          market_close_local: z.string().optional(),
          main_run_local: z.string().optional(),
          delta_run_local: z.string().optional(),
          skip_weekends: z.boolean().optional(),
          honor_holidays: z.boolean().optional(),
          main_max_provider_requests: z.number().int().min(0).max(100).optional(),
          main_max_web_searches: z.number().int().min(0).max(50).optional(),
          main_max_eval_candidates: z.number().int().min(0).max(50).optional(),
          delta_max_provider_requests: z.number().int().min(0).max(100).optional(),
          delta_max_web_searches: z.number().int().min(0).max(50).optional(),
          delta_max_eval_candidates: z.number().int().min(0).max(50).optional(),
        }),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("market_schedules")
      .update(data.patch as never)
      .eq("market", data.market);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addMarketHoliday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Record<string, unknown>) =>
    z
      .object({
        market: z.enum(SCHEDULE_MARKETS),
        holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        holiday_name: z.string().min(1).max(160),
        market_closed: z.boolean().optional(),
        source: z.string().max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("market_holidays").upsert(
      {
        market: data.market,
        holiday_date: data.holiday_date,
        holiday_name: data.holiday_name,
        market_closed: data.market_closed ?? true,
        source: data.source ?? "MANUAL",
        created_by: context.userId,
      },
      { onConflict: "market,holiday_date" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMarketHoliday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("market_holidays").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Manual "Run now" — identical code path to the scheduler. */
export const runMarketNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof runInput>) => runInput.parse(input))
  .handler(async ({ data, context }) => {
    const { runDailyController } = await import("@/lib/schedule/controller.server");
    return runDailyController({
      db: context.supabase,
      userId: context.userId,
      market: data.market,
      executionType: data.executionType,
      trigger: "MANUAL",
      ...(data.force === undefined ? {} : { force: data.force }),
      ...(data.dryRun === undefined ? {} : { dryRun: data.dryRun }),
      ...(data.marketDate === undefined ? {} : { marketDate: data.marketDate }),
    });
  });

export const listDailyRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { market?: string; status?: string; date?: string }) =>
    z
      .object({
        market: z.enum(SCHEDULE_MARKETS).optional(),
        status: z.string().optional(),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("daily_market_runs")
      .select("*, daily_run_executions(*)")
      .order("market_date", { ascending: false })
      .limit(60);
    if (data.market) q = q.eq("market", data.market);
    if (data.status) q = q.eq("status", data.status);
    if (data.date) q = q.eq("market_date", data.date);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getDailyRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: run, error } = await db
      .from("daily_market_runs")
      .select("*, daily_run_executions(*)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run) throw new Error("Daily run not found");

    const runIds = (run.daily_run_executions ?? [])
      .map((e) => e.discovery_run_id)
      .filter((id): id is string => id !== null);
    const { data: candidates } = runIds.length
      ? await db
          .from("story_candidates")
          .select(
            "id,company_name,ticker,title,content_score,priority_band,status,discovery_run_id",
          )
          .in("discovery_run_id", runIds)
          .order("content_score", { ascending: false })
          .limit(30)
      : { data: [] };
    const { data: notifications } = await db
      .from("run_notifications")
      .select("*")
      .eq("daily_run_id", data.id)
      .order("created_at", { ascending: false });
    return { run, candidates: candidates ?? [], notifications: notifications ?? [] };
  });

export const cancelExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { executionId: string }) =>
    z.object({ executionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requestCancel } = await import("@/lib/schedule/controller.server");
    return requestCancel(context.supabase, data.executionId);
  });

/** Retry a failed execution. Bounded by the configured retry limit. */
export const retryExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { executionId: string }) =>
    z.object({ executionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { data: exec } = await db
      .from("daily_run_executions")
      .select("*")
      .eq("id", data.executionId)
      .maybeSingle();
    if (!exec) throw new Error("Execution not found");
    const row = exec;
    const { runDailyController, loadAutomationSettings } =
      await import("@/lib/schedule/controller.server");
    const settings = await loadAutomationSettings(db);
    const { count } = await db
      .from("daily_run_executions")
      .select("id", { count: "exact", head: true })
      .eq("execution_key", row.execution_key)
      .eq("status", "FAILED");
    const maxRetries = Number(settings.max_retries ?? 1);
    if ((count ?? 0) > maxRetries) {
      throw new Error(`Retry limit of ${maxRetries} reached for ${row.execution_key}.`);
    }
    return runDailyController({
      db,
      userId: context.userId,
      market: row.market as "India" | "US",
      executionType: row.execution_type as "MAIN_DISCOVERY" | "LATE_DELTA",
      trigger: "RETRY",
      force: true,
      dryRun: false,
      marketDate: row.market_date,
    });
  });

export const listRunNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("run_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    return data ?? [];
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await context.supabase
      .from("run_notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    return { ok: true };
  });

/** Evaluate the schedule right now (used by the cron endpoint and the UI). */
export const schedulerTick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { runSchedulerTick } = await import("@/lib/schedule/scheduler.server");
    return runSchedulerTick({ db: context.supabase, userId: context.userId });
  });
