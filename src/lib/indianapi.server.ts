/**
 * IndianAPI provider adapter (server only).
 *
 * Responsibilities:
 *  - authenticate with the INDIAN_API_KEY secret (header: x-api-key)
 *  - enforce the 500 requests/month plan limit and >=1100ms request spacing
 *  - log every attempt (success or failure) into provider_requests
 *  - store sanitized raw payloads as RAW_PROVIDER_DATA
 *
 * The API key is never returned, logged, or stored.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const INDIANAPI_BASE_URL = "https://stock.indianapi.in";
export const MONTHLY_LIMIT = 500;
export const MIN_INTERVAL_MS = 1100;

export type QuotaLevel = "Normal" | "Warning" | "Critical" | "Emergency Reserve" | "Blocked";

export function quotaLevel(used: number): QuotaLevel {
  if (used >= MONTHLY_LIMIT) return "Blocked";
  if (used >= 480) return "Emergency Reserve";
  if (used >= 450) return "Critical";
  if (used >= 400) return "Warning";
  return "Normal";
}

function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export type ProviderStatus = {
  provider: "IndianAPI";
  connected: boolean;
  monthlyLimit: number;
  used: number;
  remaining: number;
  level: QuotaLevel;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  avgLatencyMs: number | null;
  keyConfigured: boolean;
};

export async function getProviderStatus(): Promise<ProviderStatus> {
  const since = monthStartIso();
  const { data: rows } = await supabaseAdmin
    .from("provider_requests")
    .select("ok,latency_ms,error,created_at")
    .eq("provider", "IndianAPI")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);

  const list = rows ?? [];
  const used = list.length;
  const success = list.filter((r) => r.ok);
  const failures = list.filter((r) => !r.ok);
  const latencies = success
    .map((r) => r.latency_ms)
    .filter((n): n is number => typeof n === "number");

  return {
    provider: "IndianAPI",
    connected: success.length > 0,
    monthlyLimit: MONTHLY_LIMIT,
    used,
    remaining: Math.max(0, MONTHLY_LIMIT - used),
    level: quotaLevel(used),
    lastSuccessAt: success[0]?.created_at ?? null,
    lastError: failures[0]?.error ?? null,
    lastErrorAt: failures[0]?.created_at ?? null,
    avgLatencyMs: latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null,
    keyConfigured: Boolean(process.env["INDIAN_API_KEY"]),
  };
}

async function enforceRateLimit() {
  const { data } = await supabaseAdmin
    .from("provider_requests")
    .select("created_at")
    .eq("provider", "IndianAPI")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.created_at) return;
  const elapsed = Date.now() - new Date(data.created_at).getTime();
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
}

export type ProviderCall = {
  endpoint: string;
  params?: Record<string, string>;
  isTest?: boolean;
  override?: boolean;
  ingestionRunId?: string | null;
  userId?: string | null;
};

export type ProviderResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  data: unknown;
  error: string | null;
  requestId: string | null;
  quota: { used: number; remaining: number; level: QuotaLevel };
};

export async function callIndianApi(call: ProviderCall): Promise<ProviderResult> {
  const apiKey = process.env["INDIAN_API_KEY"];
  if (!apiKey) throw new Error("INDIAN_API_KEY is not configured on the server.");

  const before = await getProviderStatus();
  if (before.used >= MONTHLY_LIMIT && !call.override) {
    throw new Error(
      `Monthly IndianAPI limit reached (${before.used}/${MONTHLY_LIMIT}). Automatic requests are blocked.`,
    );
  }

  await enforceRateLimit();

  const url = new URL(`${INDIANAPI_BASE_URL}${call.endpoint}`);
  for (const [k, v] of Object.entries(call.params ?? {})) url.searchParams.set(k, v);

  const started = Date.now();
  let status = 0;
  let ok = false;
  let payload: unknown = null;
  let error: string | null = null;

  try {
    const res = await fetch(url, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    status = res.status;
    const text = await res.text();
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    ok = res.ok;
    if (!ok) error = `HTTP ${status}: ${text.slice(0, 300)}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const latencyMs = Date.now() - started;

  const { data: logged } = await supabaseAdmin
    .from("provider_requests")
    .insert({
      provider: "IndianAPI",
      endpoint: call.endpoint,
      params: call.params ?? {},
      status_code: status || null,
      ok,
      latency_ms: latencyMs,
      error,
      is_test: call.isTest ?? false,
      ingestion_run_id: call.ingestionRunId ?? null,
      created_by: call.userId ?? null,
    })
    .select("id")
    .single();

  const used = before.used + 1;
  return {
    ok,
    status,
    latencyMs,
    data: payload,
    error,
    requestId: logged?.id ?? null,
    quota: { used, remaining: Math.max(0, MONTHLY_LIMIT - used), level: quotaLevel(used) },
  };
}

export async function storeRawResponse(input: {
  endpoint: string;
  query: string | null;
  payload: unknown;
  requestId: string | null;
  ingestionRunId: string | null;
  userId: string | null;
}): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("provider_raw_responses")
    .insert({
      provider: "IndianAPI",
      endpoint: input.endpoint,
      query: input.query,
      label: "RAW_PROVIDER_DATA",
      // Only the response body is stored — never request headers or credentials.
      payload: (input.payload ?? {}) as never,
      request_id: input.requestId,
      ingestion_run_id: input.ingestionRunId,
      created_by: input.userId,
    })
    .select("id")
    .single();
  return data?.id ?? null;
}
