/**
 * Phase 2C — Content orchestration server functions.
 *
 * Thin RPC wrappers only. Manual execution, no scheduling, no auto-publish.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CONTENT_BATCH_HARD_LIMIT } from "@/lib/content/orchestration";
import { SHORT_DURATIONS, TARGET_DURATIONS } from "@/lib/content/domain";

const shortKeys = SHORT_DURATIONS.map((d) => d.key) as [string, ...string[]];
const longKeys = TARGET_DURATIONS.map((d) => d.key) as [string, ...string[]];

const runInput = z.object({
  storyId: z.string().uuid(),
  short: z.enum(shortKeys).nullable().optional(),
  long: z.enum(longKeys).nullable().optional(),
  angle: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  tone: z.string().nullable().optional(),
  styleProfileId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  allowRepair: z.boolean().optional(),
  resolveGaps: z.boolean().optional(),
  force: z.boolean().optional(),
  overrideReadiness: z.boolean().optional(),
});

export const startContentOrchestration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => runInput.parse(input))
  .handler(async ({ data, context }) => {
    const { runContentOrchestration } = await import("@/lib/content/orchestrator.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runContentOrchestration(supabaseAdmin as never, {
      storyId: data.storyId,
      userId: context.userId,
      formats: {
        short: (data.short ?? null) as never,
        long: (data.long ?? null) as never,
        angle: data.angle ?? null,
      },
      language: data.language ?? null,
      tone: data.tone ?? null,
      styleProfileId: data.styleProfileId ?? null,
      model: data.model ?? null,
      allowRepair: data.allowRepair ?? true,
      resolveGaps: data.resolveGaps ?? true,
      force: data.force ?? false,
      overrideReadiness: data.overrideReadiness ?? false,
      triggerSource: "MANUAL",
    });
  });

export const startBatchContentOrchestration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    runInput
      .omit({ storyId: true })
      .extend({ storyIds: z.array(z.string().uuid()).min(1).max(CONTENT_BATCH_HARD_LIMIT) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { runContentOrchestration } = await import("@/lib/content/orchestrator.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const results: Array<{ storyId: string; status: string; readiness?: string; error?: string }> =
      [];
    for (const storyId of data.storyIds) {
      try {
        const res = await runContentOrchestration(supabaseAdmin as never, {
          storyId,
          userId: context.userId,
          formats: {
            short: (data.short ?? null) as never,
            long: (data.long ?? null) as never,
            angle: data.angle ?? null,
          },
          language: data.language ?? null,
          tone: data.tone ?? null,
          styleProfileId: data.styleProfileId ?? null,
          model: data.model ?? null,
          allowRepair: data.allowRepair ?? true,
          resolveGaps: data.resolveGaps ?? true,
          force: data.force ?? false,
          overrideReadiness: data.overrideReadiness ?? false,
          triggerSource: "BATCH",
        });
        results.push({ storyId, status: res.status, readiness: res.readiness });
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

export const contentOrchestrationRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ storyId: z.string().uuid(), limit: z.number().int().min(1).max(20).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { listContentRuns } = await import("@/lib/content/orchestrator.server");
    void context.userId;
    return listContentRuns(context.supabase as never, data.storyId, data.limit ?? 5);
  });
