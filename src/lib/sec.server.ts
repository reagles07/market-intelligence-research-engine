/**
 * SEC EDGAR adapter (server only).
 *
 * - builds the required User-Agent from SEC_USER_AGENT_APP_NAME / SEC_USER_AGENT_CONTACT
 * - throttles to the internal fair-access limit (max 5 requests/second)
 * - handles 429 / 403 / 5xx with at most 2 automatic retries and backoff
 * - logs every attempt into provider_requests
 * - stores sanitized payloads as RAW_PROVIDER_DATA
 *
 * SEC needs no API key; the contact value is never returned to the browser.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  SEC_DATA_BASE,
  SEC_MAX_RETRIES,
  SEC_MIN_INTERVAL_MS,
  SEC_PROVIDER,
  SEC_WWW_BASE,
} from "@/lib/sec/constants";

let lastRequestAt = 0;

export function secUserAgent(): { ua: string | null; appName: string | null; configured: boolean } {
  const appName = process.env["SEC_USER_AGENT_APP_NAME"]?.trim() || null;
  const contact = process.env["SEC_USER_AGENT_CONTACT"]?.trim() || null;
  if (!appName || !contact) return { ua: null, appName, configured: false };
  return { ua: `${appName} ${contact}`, appName, configured: true };
}

/** Masked so the configured contact is never exposed to the client. */
export function maskedContact(): string | null {
  const contact = process.env["SEC_USER_AGENT_CONTACT"]?.trim();
  if (!contact) return null;
  const [user, domain] = contact.split("@");
  if (!domain) return `${contact.slice(0, 2)}***`;
  return `${(user ?? "").slice(0, 2)}***@${domain}`;
}

export type SecStatus = "Not Configured" | "Connected" | "Error" | "Rate Limited" | "Disabled";

export type SecProviderStatus = {
  provider: string;
  status: SecStatus;
  userAgentAppName: string | null;
  userAgentContactMasked: string | null;
  configured: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  requestsToday: number;
  avgLatencyMs: number | null;
  lastSyncAt: string | null;
};

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

export async function getSecStatus(): Promise<SecProviderStatus> {
  const { appName, configured } = secUserAgent();

  const { data: recent } = await supabaseAdmin
    .from("provider_requests")
    .select("ok,latency_ms,error,status_code,created_at")
    .eq("provider", SEC_PROVIDER)
    .order("created_at", { ascending: false })
    .limit(500);

  const list = recent ?? [];
  const today = startOfTodayIso();
  const success = list.filter((r) => r.ok);
  const failures = list.filter((r) => !r.ok);
  const latencies = success
    .map((r) => r.latency_ms)
    .filter((n): n is number => typeof n === "number");

  const { data: lastSync } = await supabaseAdmin
    .from("companies")
    .select("sec_last_sync")
    .not("sec_last_sync", "is", null)
    .order("sec_last_sync", { ascending: false })
    .limit(1)
    .maybeSingle();

  let status: SecStatus = "Not Configured";
  if (configured) {
    const newest = list[0];
    if (!newest) status = "Not Configured";
    else if (newest.ok) status = "Connected";
    else if (newest.status_code === 429) status = "Rate Limited";
    else if (newest.status_code === 403) status = "Disabled";
    else status = "Error";
  }

  return {
    provider: SEC_PROVIDER,
    status,
    userAgentAppName: appName,
    userAgentContactMasked: maskedContact(),
    configured,
    lastSuccessAt: success[0]?.created_at ?? null,
    lastFailureAt: failures[0]?.created_at ?? null,
    lastError: failures[0]?.error ?? null,
    requestsToday: list.filter((r) => r.created_at >= today).length,
    avgLatencyMs: latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null,
    lastSyncAt: lastSync?.sec_last_sync ?? null,
  };
}

async function throttle() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < SEC_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, SEC_MIN_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

export type SecCall = {
  /** Path on data.sec.gov, or an absolute https://www.sec.gov URL. */
  endpoint: string;
  host?: "data" | "www";
  isTest?: boolean;
  ingestionRunId?: string | null;
  userId?: string | null;
};

export type SecResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  data: unknown;
  error: string | null;
  requestId: string | null;
  attempts: number;
};

export async function callSec(call: SecCall): Promise<SecResult> {
  const { ua } = secUserAgent();
  if (!ua) {
    throw new Error(
      "SEC user agent is not configured. Set the application name and contact in Settings → Data providers.",
    );
  }

  const base = call.host === "www" ? SEC_WWW_BASE : SEC_DATA_BASE;
  const url = `${base}${call.endpoint}`;

  const started = Date.now();
  let status = 0;
  let ok = false;
  let payload: unknown = null;
  let error: string | null = null;
  let attempts = 0;

  for (let attempt = 0; attempt <= SEC_MAX_RETRIES; attempt += 1) {
    attempts = attempt + 1;
    await throttle();
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": ua,
          accept: "application/json",
          "accept-encoding": "gzip, deflate",
        },
        signal: AbortSignal.timeout(60_000),
      });
      status = res.status;
      const text = await res.text();
      ok = res.ok;
      if (ok) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
        error = null;
        break;
      }
      error = `HTTP ${status}: ${text.slice(0, 300)}`;
      // 403 means SEC rejected the request (usually the User-Agent) — never retry.
      if (status === 403 || (status >= 400 && status < 500 && status !== 429)) break;
      if (attempt < SEC_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      if (attempt < SEC_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  const latencyMs = Date.now() - started;

  const { data: logged } = await supabaseAdmin
    .from("provider_requests")
    .insert({
      provider: SEC_PROVIDER,
      endpoint: call.endpoint,
      params: {},
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

  return { ok, status, latencyMs, data: payload, error, requestId: logged?.id ?? null, attempts };
}

export async function storeSecRaw(input: {
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
      provider: SEC_PROVIDER,
      endpoint: input.endpoint,
      query: input.query,
      label: "RAW_PROVIDER_DATA",
      payload: (input.payload ?? {}) as never,
      request_id: input.requestId,
      ingestion_run_id: input.ingestionRunId,
      created_by: input.userId,
    })
    .select("id")
    .single();
  return data?.id ?? null;
}
