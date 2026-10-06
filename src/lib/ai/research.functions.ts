/**
 * Research engine server functions (database-only mode).
 *
 * The browser calls these; the OpenAI key, the prompts and the persistence
 * rules never leave the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const storyInput = z.object({
  storyId: z.string().uuid(),
  model: z.string().optional(),
});

export const analyzeStory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => storyInput.parse(i))
  .handler(async ({ data, context }) => {
    const { runAnalyzeStory } = await import("@/lib/ai/research.server");
    return runAnalyzeStory(context.supabase, {
      storyId: data.storyId,
      model: data.model ?? null,
      userId: context.userId,
    });
  });

export const verifyClaims = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        storyId: z.string().uuid().optional(),
        companyId: z.string().uuid().optional(),
        model: z.string().optional(),
      })
      .refine((v) => v.storyId || v.companyId, "storyId or companyId is required")
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runVerifyClaims } = await import("@/lib/ai/research.server");
    return runVerifyClaims(context.supabase, {
      storyId: data.storyId ?? null,
      companyId: data.companyId ?? null,
      model: data.model ?? null,
      userId: context.userId,
    });
  });

export const buildResearchPacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    storyInput.extend({ updateReason: z.string().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runBuildResearchPacket } = await import("@/lib/ai/research.server");
    return runBuildResearchPacket(context.supabase, {
      storyId: data.storyId,
      model: data.model ?? null,
      updateReason: data.updateReason ?? null,
      userId: context.userId,
    });
  });

export const generateScenarios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ packetId: z.string().uuid(), model: z.string().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runGenerateScenarios } = await import("@/lib/ai/research.server");
    return runGenerateScenarios(context.supabase, {
      packetId: data.packetId,
      model: data.model ?? null,
      userId: context.userId,
    });
  });

export const researchLatestNews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        storyId: z.string().uuid().optional(),
        companyId: z.string().uuid().optional(),
        model: z.string().optional(),
        rebuildPacket: z.boolean().optional(),
        rapidPass: z.boolean().optional(),
      })
      .refine((v) => v.storyId || v.companyId, "storyId or companyId is required")
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runResearchLatestNews } = await import("@/lib/ai/web.server");
    return runResearchLatestNews(context.supabase, {
      storyId: data.storyId ?? null,
      companyId: data.companyId ?? null,
      model: data.model ?? null,
      rebuildPacket: data.rebuildPacket ?? false,
      rapidPass: data.rapidPass ?? true,
      userId: context.userId,
    });
  });
