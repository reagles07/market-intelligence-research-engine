/**
 * Research orchestration server functions.
 *
 * Thin RPC wrappers only — every runtime helper lives in the server modules.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BATCH_HARD_LIMIT } from "@/lib/research/domain";

const runInput = z.object({
  storyId: z.string().uuid(),
  model: z.string().nullable().optional(),
  forceRefresh: z.boolean().optional(),
});

const batchInput = z.object({
  storyIds: z.array(z.string().uuid()).min(1).max(BATCH_HARD_LIMIT),
  model: z.string().nullable().optional(),
});

export const startResearchOrchestration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => runInput.parse(input))
  .handler(async ({ data, context }) => {
    const { runResearchOrchestration } = await import("@/lib/research/orchestrator.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runResearchOrchestration(supabaseAdmin as never, {
      storyId: data.storyId,
      userId: context.userId,
      model: data.model ?? null,
      forceRefresh: data.forceRefresh ?? false,
      triggerSource: "MANUAL",
    });
  });

export const startBatchResearchOrchestration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => batchInput.parse(input))
  .handler(async ({ data, context }) => {
    const { runResearchOrchestration } = await import("@/lib/research/orchestrator.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const results: Array<{ storyId: string; status: string; error?: string }> = [];
    for (const storyId of data.storyIds) {
      try {
        const res = await runResearchOrchestration(supabaseAdmin as never, {
          storyId,
          userId: context.userId,
          model: data.model ?? null,
          triggerSource: "BATCH",
        });
        results.push({ storyId, status: res.status });
      } catch (e) {
        results.push({
          storyId,
          status: "FAILED",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { results };
  });

export const cancelResearchOrchestration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("research_orchestration_runs")
      .update({ status: "CANCELLED", completed_at: new Date().toISOString() })
      .eq("id", data.runId)
      .in("status", ["QUEUED", "RUNNING"]);
    void context.userId;
    return { ok: true as const };
  });
