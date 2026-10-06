/**
 * OpenAI provider adapter (server only).
 *
 * Responsibilities:
 *  - authenticate with the OPENAI_API_KEY secret (never leaves the server)
 *  - talk to the OpenAI **Responses API** with streaming enabled
 *  - enforce structured outputs (strict json_schema) for every research call
 *  - validate the parsed payload and retry ONCE with validation feedback
 *  - log every attempt into ai_requests for quota / cost / latency reporting
 *
 * The API key is never returned, logged, or stored.
 */
import type { z } from "zod";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_OPENAI_MODEL,
  estimateCostUsd,
  isKnownModel,
  type AiMode,
} from "@/lib/openai/models";

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export type AiCallRefs = {
  companyId?: string | null;
  storyId?: string | null;
  packetId?: string | null;
  scriptId?: string | null;
};

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  webSearchCalls: number;
  estimatedCostUsd: number;
};

const EMPTY_USAGE: AiUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  webSearchCalls: 0,
  estimatedCostUsd: 0,
};

export function resolveModel(requested?: string | null): string {
  if (requested && isKnownModel(requested)) return requested;
  return DEFAULT_OPENAI_MODEL;
}

function apiKey(): string {
  // Read inside the call: env is injected per request on the edge runtime.
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  return key;
}

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env["OPENAI_API_KEY"]);
}

type RawCallInput = {
  model: string;
  instructions?: string;
  input: string;
  /** Strict JSON schema; omit for plain text replies (connection test only). */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  webSearch?: boolean;
  maxOutputTokens?: number;
};

export type RawCallResult = {
  ok: boolean;
  text: string;
  usage: AiUsage;
  latencyMs: number;
  status: number;
  error: string | null;
  /** Citations surfaced by the web_search tool, when it ran. */
  citations: Array<{ url: string; title: string | null }>;
};

/**
 * Single streamed Responses API call.
 *
 * Streaming is mandatory: research prompts routinely run for minutes and a
 * buffered request would be severed by the edge runtime before it returns.
 */
export async function rawOpenAiCall(input: RawCallInput): Promise<RawCallResult> {
  const started = Date.now();
  const body: Record<string, unknown> = {
    model: input.model,
    input: input.input,
    stream: true,
  };
  if (input.instructions) body["instructions"] = input.instructions;
  if (input.maxOutputTokens) body["max_output_tokens"] = input.maxOutputTokens;
  if (input.webSearch) body["tools"] = [{ type: "web_search" }];
  if (input.jsonSchema) {
    body["text"] = {
      format: {
        type: "json_schema",
        name: input.jsonSchema.name,
        strict: true,
        schema: input.jsonSchema.schema,
      },
    };
  }

  let res: Response;
  try {
    res = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey()}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return {
      ok: false,
      text: "",
      usage: EMPTY_USAGE,
      latencyMs: Date.now() - started,
      status: 0,
      error: e instanceof Error ? e.message : "Network error",
      citations: [],
    };
  }

  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`;
    try {
      const payload = (await res.json()) as { error?: { message?: string } };
      if (payload.error?.message) detail = payload.error.message;
    } catch {
      /* non-JSON error body */
    }
    return {
      ok: false,
      text: "",
      usage: EMPTY_USAGE,
      latencyMs: Date.now() - started,
      status: res.status,
      error: detail,
      citations: [],
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage: AiUsage = { ...EMPTY_USAGE };
  let webSearchCalls = 0;
  let streamError: string | null = null;
  const citations = new Map<string, string | null>();

  const handleEvent = (payload: string) => {
    if (!payload || payload === "[DONE]") return;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(evt["type"] ?? "");

    if (type === "response.output_text.delta") {
      text += String(evt["delta"] ?? "");
      return;
    }
    if (type === "error" || type === "response.failed") {
      const err = (evt["error"] ?? (evt["response"] as Record<string, unknown>)?.["error"]) as
        { message?: string } | undefined;
      streamError = err?.message ?? "OpenAI stream error";
      return;
    }
    if (type === "response.output_item.done") {
      const item = evt["item"] as Record<string, unknown> | undefined;
      if (item && String(item["type"] ?? "").includes("web_search")) webSearchCalls += 1;
      // Annotations carry the web-search citations we must preserve.
      const content = (item?.["content"] ?? []) as Array<Record<string, unknown>>;
      for (const part of Array.isArray(content) ? content : []) {
        const anns = (part["annotations"] ?? []) as Array<Record<string, unknown>>;
        for (const a of Array.isArray(anns) ? anns : []) {
          const url = a["url"];
          if (typeof url === "string" && url) {
            citations.set(url, typeof a["title"] === "string" ? (a["title"] as string) : null);
          }
        }
      }
      return;
    }
    if (type === "response.completed" || type === "response.incomplete") {
      const response = evt["response"] as Record<string, unknown> | undefined;
      const u = response?.["usage"] as Record<string, unknown> | undefined;
      if (u) {
        const inputTokens = Number(u["input_tokens"] ?? 0);
        const outputTokens = Number(u["output_tokens"] ?? 0);
        const details = u["output_tokens_details"] as Record<string, unknown> | undefined;
        const reasoningTokens = Number(details?.["reasoning_tokens"] ?? 0);
        usage = {
          inputTokens,
          outputTokens,
          reasoningTokens,
          webSearchCalls,
          estimatedCostUsd: 0,
        };
      }
      if (type === "response.incomplete" && !streamError) {
        streamError = "Model stopped before completing the response";
      }
    }
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (line.startsWith("data:")) handleEvent(line.slice(5).trim());
      }
    }
  }

  usage.webSearchCalls = webSearchCalls;
  usage.estimatedCostUsd = estimateCostUsd(
    input.model,
    usage.inputTokens,
    usage.outputTokens,
    webSearchCalls,
  );

  return {
    ok: !streamError && text.length > 0,
    text,
    usage,
    latencyMs: Date.now() - started,
    status: res.status,
    error: streamError ?? (text.length === 0 ? "Model returned an empty response" : null),
    citations: [...citations.entries()].map(([url, title]) => ({ url, title })),
  };
}

export async function logAiRequest(args: {
  model: string;
  operation: string;
  mode: AiMode;
  refs?: AiCallRefs;
  usage: AiUsage;
  latencyMs: number;
  ok: boolean;
  error?: string | null;
  validationRetries?: number;
  userId: string;
}) {
  await supabaseAdmin.from("ai_requests").insert({
    provider: "OpenAI",
    model: args.model,
    operation: args.operation,
    mode: args.mode,
    company_id: args.refs?.companyId ?? null,
    story_id: args.refs?.storyId ?? null,
    packet_id: args.refs?.packetId ?? null,
    script_id: args.refs?.scriptId ?? null,
    input_tokens: args.usage.inputTokens,
    output_tokens: args.usage.outputTokens,
    reasoning_tokens: args.usage.reasoningTokens,
    web_search_calls: args.usage.webSearchCalls,
    estimated_cost_usd: args.usage.estimatedCostUsd,
    latency_ms: args.latencyMs,
    ok: args.ok,
    error: args.error ?? null,
    validation_retries: args.validationRetries ?? 0,
    created_by: args.userId,
  });
}

export type StructuredResult<T> =
  | { ok: true; data: T; usage: AiUsage; latencyMs: number; citations: RawCallResult["citations"] }
  | { ok: false; error: string; usage: AiUsage; latencyMs: number; needsHumanReview: boolean };

/**
 * Structured research call: strict JSON schema out, zod-validated in.
 *
 * On a validation failure the model gets ONE retry that includes the exact
 * validation feedback. A second failure returns an error — malformed research
 * is never partially saved.
 */
export async function callStructured<T>(args: {
  operation: string;
  mode: AiMode;
  model?: string | null;
  instructions: string;
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  validator: z.ZodType<T>;
  webSearch?: boolean;
  maxOutputTokens?: number;
  refs?: AiCallRefs;
  userId: string;
}): Promise<StructuredResult<T>> {
  const model = resolveModel(args.model);
  const totals: AiUsage = { ...EMPTY_USAGE };
  let latency = 0;
  let attemptInput = args.input;
  let lastError = "Unknown error";
  let citations: RawCallResult["citations"] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await rawOpenAiCall({
      model,
      instructions: args.instructions,
      input: attemptInput,
      jsonSchema: { name: args.schemaName, schema: args.jsonSchema },
      ...(args.webSearch === undefined ? {} : { webSearch: args.webSearch }),
      ...(args.maxOutputTokens === undefined ? {} : { maxOutputTokens: args.maxOutputTokens }),
    });

    totals.inputTokens += res.usage.inputTokens;
    totals.outputTokens += res.usage.outputTokens;
    totals.reasoningTokens += res.usage.reasoningTokens;
    totals.webSearchCalls += res.usage.webSearchCalls;
    totals.estimatedCostUsd += res.usage.estimatedCostUsd;
    latency += res.latencyMs;
    if (res.citations.length) citations = res.citations;

    if (!res.ok) {
      lastError = res.error ?? "OpenAI request failed";
      // Transport/provider failures are not validation problems — stop here.
      await logAiRequest({
        model,
        operation: args.operation,
        mode: args.mode,
        ...(args.refs ? { refs: args.refs } : {}),
        usage: totals,
        latencyMs: latency,
        ok: false,
        error: lastError,
        validationRetries: attempt,
        userId: args.userId,
      });
      return {
        ok: false,
        error: lastError,
        usage: totals,
        latencyMs: latency,
        needsHumanReview: false,
      };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(res.text);
    } catch {
      lastError = "Model returned invalid JSON";
      attemptInput = `${args.input}\n\nYour previous reply was not valid JSON. Return ONLY a JSON object matching the required schema.`;
      continue;
    }

    const parsed = args.validator.safeParse(parsedJson);
    if (parsed.success) {
      await logAiRequest({
        model,
        operation: args.operation,
        mode: args.mode,
        ...(args.refs ? { refs: args.refs } : {}),
        usage: totals,
        latencyMs: latency,
        ok: true,
        validationRetries: attempt,
        userId: args.userId,
      });
      return { ok: true, data: parsed.data, usage: totals, latencyMs: latency, citations };
    }

    lastError = parsed.error.issues
      .slice(0, 12)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    attemptInput = `${args.input}\n\nYour previous reply failed validation with these problems:\n${lastError}\nReturn a corrected JSON object that satisfies every requirement.`;
  }

  await logAiRequest({
    model,
    operation: args.operation,
    mode: args.mode,
    ...(args.refs ? { refs: args.refs } : {}),
    usage: totals,
    latencyMs: latency,
    ok: false,
    error: `Validation failed twice: ${lastError}`,
    validationRetries: 2,
    userId: args.userId,
  });

  return {
    ok: false,
    error: `Validation failed twice: ${lastError}`,
    usage: totals,
    latencyMs: latency,
    needsHumanReview: true,
  };
}

export type AiProviderStatus = {
  provider: "OpenAI";
  keyConfigured: boolean;
  connected: boolean;
  model: string;
  requestsToday: number;
  inputTokensToday: number;
  outputTokensToday: number;
  costTodayUsd: number;
  costMonthUsd: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  avgLatencyMs: number | null;
};

export async function getAiProviderStatus(model: string): Promise<AiProviderStatus> {
  const now = new Date();
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { data: monthRows } = await supabaseAdmin
    .from("ai_requests")
    .select("ok,error,latency_ms,input_tokens,output_tokens,estimated_cost_usd,created_at")
    .eq("provider", "OpenAI")
    .gte("created_at", monthStart)
    .order("created_at", { ascending: false })
    .limit(1000);

  const all = monthRows ?? [];
  const today = all.filter((r) => r.created_at >= dayStart);
  const success = all.filter((r) => r.ok);
  const failures = all.filter((r) => !r.ok);
  const latencies = success
    .map((r) => r.latency_ms)
    .filter((n): n is number => typeof n === "number");

  return {
    provider: "OpenAI",
    keyConfigured: isOpenAiConfigured(),
    connected: success.length > 0,
    model,
    requestsToday: today.length,
    inputTokensToday: today.reduce((s, r) => s + (r.input_tokens ?? 0), 0),
    outputTokensToday: today.reduce((s, r) => s + (r.output_tokens ?? 0), 0),
    costTodayUsd: today.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0),
    costMonthUsd: all.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0),
    lastSuccessAt: success[0]?.created_at ?? null,
    lastFailureAt: failures[0]?.created_at ?? null,
    lastError: failures[0]?.error ?? null,
    avgLatencyMs: latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null,
  };
}
