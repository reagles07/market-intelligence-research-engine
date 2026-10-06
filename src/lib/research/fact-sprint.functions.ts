/**
 * Fact sprint server functions — the browser's entry point to gap-fill research.
 *
 * Research only: nothing here generates, approves or publishes a script.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const runFactSprintFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        storyId: z.string().uuid().optional(),
        packetId: z.string().uuid().optional(),
        gapKeys: z.array(z.string()).optional(),
        model: z.string().optional(),
      })
      .refine((v) => v.storyId || v.packetId, "storyId or packetId is required")
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runFactSprint } = await import("@/lib/research/fact-sprint.server");
    return runFactSprint(context.supabase, {
      storyId: data.storyId ?? null,
      packetId: data.packetId ?? null,
      gapKeys: data.gapKeys ?? null,
      model: data.model ?? null,
      userId: context.userId,
    });
  });

export const latestFactSprintFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ storyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { latestFactSprint } = await import("@/lib/research/fact-sprint.server");
    return latestFactSprint(context.supabase, { storyId: data.storyId });
  });
