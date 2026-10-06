/**
 * Research-gap server functions — the browser's entry point to Pass 1F.
 *
 * Nothing here writes script text; the script writer still never browses.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const scriptInput = z.object({ scriptId: z.string().uuid(), model: z.string().optional() });

export const detectResearchGaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    scriptInput.extend({ auditId: z.string().uuid().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runDetectResearchGaps } = await import("@/lib/ai/gaps.server");
    return runDetectResearchGaps(context.supabase, {
      scriptId: data.scriptId,
      auditId: data.auditId ?? null,
      model: data.model ?? null,
      userId: context.userId,
    });
  });

export const resolveResearchGap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ gapId: z.string().uuid(), model: z.string().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runResolveResearchGap } = await import("@/lib/ai/gaps.server");
    return runResolveResearchGap(context.supabase, {
      gapId: data.gapId,
      model: data.model ?? null,
      userId: context.userId,
    });
  });

export const resolveScriptGaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    scriptInput.extend({ rebuildPacket: z.boolean().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runResolveScriptGaps } = await import("@/lib/ai/gaps.server");
    return runResolveScriptGaps(context.supabase, {
      scriptId: data.scriptId,
      model: data.model ?? null,
      rebuildPacket: data.rebuildPacket ?? true,
      userId: context.userId,
    });
  });

export const scriptResearchGaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ scriptId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { listScriptGaps } = await import("@/lib/ai/gaps.server");
    return listScriptGaps(context.supabase, data.scriptId);
  });

export const regenerateFromUpdatedResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => scriptInput.parse(i))
  .handler(async ({ data, context }) => {
    const { runRegenerateFromUpdatedResearch } = await import("@/lib/ai/gaps.server");
    return runRegenerateFromUpdatedResearch(context.supabase, {
      scriptId: data.scriptId,
      model: data.model ?? null,
      userId: context.userId,
    });
  });
