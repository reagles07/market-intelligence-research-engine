/**
 * SEC EDGAR server functions.
 *
 * The browser never calls SEC directly. Pages read backend data; SEC is
 * only contacted when a user explicitly presses Test connection or Sync SEC data.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SEC_METRICS } from "@/lib/sec/constants";

const TICKER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const secStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getSecStatus } = await import("@/lib/sec.server");
    return getSecStatus();
  });

export const secTestConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { callSec } = await import("@/lib/sec.server");
    // Read-only metadata request. Nothing is written into financial records.
    const res = await callSec({
      endpoint: "/submissions/CIK0001652044.json",
      isTest: true,
      userId: context.userId,
    });
    const root = (res.data ?? {}) as Record<string, unknown>;
    return {
      ok: res.ok,
      status: res.status,
      latencyMs: res.latencyMs,
      error: res.error,
      attempts: res.attempts,
      sample: res.ok ? String(root["name"] ?? "") : null,
    };
  });

/** Resolve a US ticker to its SEC CIK, using the cached ticker file. */
export const resolveCik = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ticker: string; forceRefresh?: boolean }) =>
    z
      .object({ ticker: z.string().min(1).max(12), forceRefresh: z.boolean().optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { resolveTickerToCik } = await import("@/lib/sec.server.resolve");
    return resolveTickerToCik(data.ticker, {
      forceRefresh: data.forceRefresh ?? false,
      userId: context.userId,
      maxAgeMs: TICKER_CACHE_MAX_AGE_MS,
    });
  });

export const syncSecCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { companyId: string; ticker?: string }) =>
    z
      .object({ companyId: z.string().uuid(), ticker: z.string().min(1).max(12).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { syncSecCompanyData } = await import("@/lib/sec.sync.server");
    return syncSecCompanyData({
      companyId: data.companyId,
      ticker: data.ticker,
      userId: context.userId,
    });
  });

export const SEC_METRIC_LABELS = Object.fromEntries(SEC_METRICS.map((m) => [m.key, m.label]));
