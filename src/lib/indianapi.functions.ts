/**
 * IndianAPI server functions.
 *
 * Every provider call goes through these — the browser never talks to
 * IndianAPI and never sees the API key. Pages read the application database;
 * provider requests only happen on an explicit user action.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DISCOVERY_ENDPOINTS,
  HISTORICAL_FILTERS,
  HISTORICAL_PERIODS,
} from "@/lib/indianapi/constants";
import { mapDiscoveryRows } from "@/lib/indianapi/mapping";

export const providerStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getProviderStatus } = await import("@/lib/indianapi.server");
    return getProviderStatus();
  });

export const testConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { override?: boolean }) =>
    z.object({ override: z.boolean().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { callIndianApi } = await import("@/lib/indianapi.server");
    const res = await callIndianApi({
      endpoint: "/trending",
      isTest: true,
      override: data.override ?? false,
      userId: context.userId,
    });
    // Test data is intentionally NOT written into production stock records.
    return {
      connected: res.ok,
      status: res.status,
      latencyMs: res.latencyMs,
      error: res.error,
      quota: res.quota,
    };
  });

export const syncStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { companyId?: string; companyName: string; override?: boolean }) =>
    z
      .object({
        companyId: z.string().uuid().optional(),
        companyName: z.string().min(1),
        override: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { syncIndianStock } = await import("@/lib/indianapi.sync.server");
    return syncIndianStock({
      companyId: data.companyId,
      companyName: data.companyName,
      override: data.override,
      userId: context.userId,
    });
  });

export const runDiscovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { endpoint: string; override?: boolean }) =>
    z
      .object({
        endpoint: z.enum(DISCOVERY_ENDPOINTS),
        override: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { callIndianApi, storeRawResponse } = await import("@/lib/indianapi.server");
    const ingestionRunId = crypto.randomUUID();
    const res = await callIndianApi({
      endpoint: data.endpoint,
      override: data.override ?? false,
      ingestionRunId,
      userId: context.userId,
    });
    if (!res.ok) return { ok: false as const, error: res.error, rows: [], quota: res.quota };

    await storeRawResponse({
      endpoint: data.endpoint,
      query: null,
      payload: res.data,
      requestId: res.requestId,
      ingestionRunId,
      userId: context.userId,
    });

    return {
      ok: true as const,
      rows: mapDiscoveryRows(res.data, data.endpoint),
      quota: res.quota,
      ingestionRunId,
    };
  });

/**
 * Per-company endpoints. Provider parameter values (filters / stats codes) are
 * passed through unchanged — we do not guess what abbreviations mean, and
 * provider validation errors are surfaced verbatim.
 */
export const fetchCompanyEndpoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      endpoint: string;
      stockName: string;
      period?: string;
      filter?: string;
      stats?: string;
      override?: boolean;
    }) =>
      z
        .object({
          endpoint: z.enum([
            "/historical_data",
            "/statement",
            "/historical_stats",
            "/corporate_actions",
            "/recent_announcements",
          ]),
          stockName: z.string().min(1),
          period: z.enum(HISTORICAL_PERIODS).optional(),
          filter: z.enum(HISTORICAL_FILTERS).optional(),
          stats: z.string().min(1).optional(),
          override: z.boolean().optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { callIndianApi, storeRawResponse } = await import("@/lib/indianapi.server");
    const params: Record<string, string> = { stock_name: data.stockName };
    if (data.endpoint === "/historical_data") {
      params["period"] = data.period ?? "1yr";
      params["filter"] = data.filter ?? "default";
    }
    if (data.endpoint === "/statement" || data.endpoint === "/historical_stats") {
      if (!data.stats) throw new Error("This endpoint requires a provider 'stats' value.");
      params["stats"] = data.stats;
    }

    const ingestionRunId = crypto.randomUUID();
    const res = await callIndianApi({
      endpoint: data.endpoint,
      params,
      override: data.override ?? false,
      ingestionRunId,
      userId: context.userId,
    });

    if (!res.ok)
      return {
        ok: false as const,
        error: res.error,
        quota: res.quota,
        payloadJson: null as string | null,
        ingestionRunId,
        rawResponseId: null as string | null,
      };

    const rawId = await storeRawResponse({
      endpoint: data.endpoint,
      query: new URLSearchParams(params).toString(),
      payload: res.data,
      requestId: res.requestId,
      ingestionRunId,
      userId: context.userId,
    });

    return {
      ok: true as const,
      error: null as string | null,
      quota: res.quota,
      ingestionRunId,
      rawResponseId: rawId,
      payloadJson: JSON.stringify(res.data ?? null) as string | null,
    };
  });
