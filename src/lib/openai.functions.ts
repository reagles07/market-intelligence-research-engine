/**
 * OpenAI server functions — the browser's only entry point to the AI layer.
 *
 * The API key is read inside handlers and never crosses the RPC boundary.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const modelInput = z.object({ model: z.string().optional() });

export const aiProviderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { model?: string }) => modelInput.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { getAiProviderStatus, resolveModel } = await import("@/lib/openai.server");
    return getAiProviderStatus(resolveModel(data.model ?? null));
  });

export const testAiConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { model?: string }) => modelInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { rawOpenAiCall, resolveModel, logAiRequest, isOpenAiConfigured } =
      await import("@/lib/openai.server");

    if (!isOpenAiConfigured()) {
      return {
        connected: false,
        model: resolveModel(data.model ?? null),
        latencyMs: 0,
        error: "OPENAI_API_KEY is not configured",
        reply: null as string | null,
      };
    }

    const model = resolveModel(data.model ?? null);
    const res = await rawOpenAiCall({
      model,
      instructions:
        "You are a connection test endpoint for a stock research application. Reply with exactly: OK",
      input: "Reply with exactly: OK",
      maxOutputTokens: 2000,
    });

    await logAiRequest({
      model,
      operation: "test-connection",
      mode: "DATABASE",
      usage: res.usage,
      latencyMs: res.latencyMs,
      ok: res.ok,
      error: res.error,
      userId: context.userId,
    });

    return {
      connected: res.ok,
      model,
      latencyMs: res.latencyMs,
      error: res.error,
      reply: res.ok ? res.text.trim().slice(0, 200) : null,
    };
  });
