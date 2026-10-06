/**
 * Phase 2D-2 autonomous pipeline server functions.
 *
 * The browser can inspect pipeline lineage and ask the server to run a
 * pipeline pass over an existing discovery run. Nothing here publishes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listPipelineRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { market?: string; limit?: number } | undefined) =>
    z
      .object({ market: z.string().optional(), limit: z.number().int().min(1).max(50).optional() })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("automation_pipeline_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(data.limit ?? 15);
    if (data.market) q = q.eq("market", data.market);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getPipelineRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const [{ data: run }, { data: items }] = await Promise.all([
      db.from("automation_pipeline_runs").select("*").eq("id", data.id).maybeSingle(),
      db
        .from("automation_pipeline_items")
        .select("*")
        .eq("pipeline_run_id", data.id)
        .order("rank_index"),
    ]);
    return { run: run ?? null, items: items ?? [] };
  });

/** Pipeline runs attached to a daily run or execution, for the runs detail page. */
export const listPipelineRunsForExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { executionId?: string; dailyRunId?: string }) =>
    z
      .object({
        executionId: z.string().uuid().optional(),
        dailyRunId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    let q = db
      .from("automation_pipeline_runs")
      .select("*")
      .order("started_at", { ascending: false });
    if (data.executionId) q = q.eq("execution_id", data.executionId);
    if (data.dailyRunId) q = q.eq("daily_run_id", data.dailyRunId);
    const { data: runs } = await q;
    const list = runs ?? [];
    if (!list.length) return [];
    const { data: items } = await db
      .from("automation_pipeline_items")
      .select("*")
      .in(
        "pipeline_run_id",
        list.map((r) => r.id),
      )
      .order("rank_index");
    return list.map((r) => ({
      ...r,
      items: (items ?? []).filter((i) => i.pipeline_run_id === r.id),
    }));
  });

/**
 * Run the autonomous pipeline manually over the latest discovery run for a
 * market. Manual triggers may bypass the autonomous toggle, never the caps.
 */
export const runPipelineNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { market: "India" | "US"; dryRun?: boolean; force?: boolean }) =>
    z
      .object({
        market: z.enum(["India", "US"]),
        dryRun: z.boolean().optional(),
        force: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { runAutonomousPipeline } = await import("@/lib/automation/pipeline.server");
    const { marketDateFor } = await import("@/lib/schedule/domain");

    const { data: schedule } = await db
      .from("market_schedules")
      .select("timezone")
      .eq("market", data.market)
      .maybeSingle();
    const marketDate = marketDateFor(String(schedule?.timezone ?? "UTC"));

    const { data: exec } = await db
      .from("daily_run_executions")
      .select("id,daily_run_id,discovery_run_id")
      .eq("market", data.market)
      .eq("dry_run", false)
      .not("discovery_run_id", "is", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return await runAutonomousPipeline({
      db,
      userId: context.userId,
      market: data.market,
      marketDate,
      executionType: "MAIN_DISCOVERY",
      trigger: "MANUAL",
      dryRun: data.dryRun ?? false,
      discoveryRunId: exec?.discovery_run_id ? String(exec.discovery_run_id) : null,
      executionId: exec?.id ? String(exec.id) : null,
      dailyRunId: exec?.daily_run_id ? String(exec.daily_run_id) : null,
      force: data.force ?? true,
    });
  });
