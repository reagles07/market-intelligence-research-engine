/**
 * India market discovery (server only).
 *
 * Uses market-wide IndianAPI endpoints only. We never call /stock,
 * /statement, /historical_stats or /recent_announcements per discovered
 * company here — that is deep research for a promoted story, and it would
 * burn the 500/month plan in a single run.
 *
 * Budget: at most MAX_INDIA_REQUESTS provider requests for a whole run.
 */
import { mapDiscoveryRows } from "@/lib/indianapi/mapping";
import {
  INDIA_DISCOVERY_ENDPOINTS,
  MAX_INDIA_REQUESTS,
  type CandidateType,
} from "@/lib/discovery/domain";
import { inferTypeFromText, safeIso } from "@/lib/discovery/classify";
import type { RawSignal } from "@/lib/discovery/cluster";
import { TIER_2, TIER_3 } from "@/lib/ai/web-sources";

export type CollectResult = {
  signals: RawSignal[];
  requests: number;
  endpoints: Array<{ endpoint: string; ok: boolean; rows: number; error: string | null }>;
  errors: string[];
  quota: { used: number; remaining: number; level: string } | null;
};

type KnownCompany = { id: string; name: string; ticker: string };

/** Signal type for a numeric feed row, from the endpoint and the bucket label. */
function typeForRow(endpoint: string, label: string): CandidateType {
  const l = label.toLowerCase();
  if (endpoint === "/price_shockers") return "PRICE_MOVE";
  if (endpoint.includes("most_active")) return "UNUSUAL_VOLUME";
  if (endpoint === "/fetch_52_week_high_low_data") {
    if (l.includes("low")) return "52_WEEK_LOW";
    return "52_WEEK_HIGH";
  }
  return "TRENDING";
}

function reasonFor(endpoint: string, label: string, movement: number | null): string {
  const feed = endpoint.replace("/", "").replace(/_/g, " ");
  if (endpoint === "/price_shockers")
    return `Price shocker feed${movement === null ? "" : ` (${movement}%)`}`;
  if (endpoint.includes("most_active")) return `${feed} listing`;
  if (endpoint === "/fetch_52_week_high_low_data")
    return `52-week ${label.toLowerCase().includes("low") ? "low" : "high"} scanner`;
  if (endpoint === "/trending")
    return `Trending feed${label.toLowerCase().includes("loser") ? " (top losers)" : label.toLowerCase().includes("gainer") ? " (top gainers)" : ""}`;
  return `${feed} feed`;
}

const matchCompany = (text: string, companies: KnownCompany[]): KnownCompany | null => {
  const hay = text.toLowerCase();
  let best: KnownCompany | null = null;
  for (const c of companies) {
    const name = c.name.toLowerCase();
    if (name.length > 3 && hay.includes(name)) {
      if (!best || name.length > best.name.length) best = c;
    }
  }
  return best;
};
/** Resolve a feed row to a company already in our universe, when possible. */
function matchByTickerOrName(
  ticker: string | null,
  name: string,
  companies: KnownCompany[],
): KnownCompany | null {
  if (ticker) {
    const t = ticker.trim().toUpperCase();
    const hit = companies.find((c) => c.ticker.toUpperCase() === t);
    if (hit) return hit;
  }
  const n = name.trim().toLowerCase();
  return companies.find((c) => c.name.toLowerCase() === n) ?? matchCompany(n, companies);
}

export async function collectIndiaSignals(args: {
  userId: string;
  runId: string;
  budget?: number;
  override?: boolean;
  companies: KnownCompany[];
}): Promise<CollectResult> {
  const { callIndianApi, storeRawResponse } = await import("@/lib/indianapi.server");

  const budget = Math.min(args.budget ?? MAX_INDIA_REQUESTS, MAX_INDIA_REQUESTS);
  const endpoints = INDIA_DISCOVERY_ENDPOINTS.slice(0, budget);
  const signals: RawSignal[] = [];
  const log: CollectResult["endpoints"] = [];
  const errors: string[] = [];
  let requests = 0;
  let quota: CollectResult["quota"] = null;

  for (const endpoint of endpoints) {
    let res;
    try {
      res = await callIndianApi({
        endpoint,
        ingestionRunId: args.runId,
        userId: args.userId,
        ...(args.override === undefined ? {} : { override: args.override }),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`${endpoint}: ${message}`);
      log.push({ endpoint, ok: false, rows: 0, error: message });
      break; // quota block or missing key — stop spending
    }
    requests += 1;
    quota = res.quota;

    if (!res.ok) {
      errors.push(`${endpoint}: ${res.error ?? "provider error"}`);
      log.push({ endpoint, ok: false, rows: 0, error: res.error });
      continue;
    }

    const rawId = await storeRawResponse({
      endpoint,
      query: null,
      payload: res.data,
      requestId: res.requestId,
      ingestionRunId: args.runId,
      userId: args.userId,
    });

    const before = signals.length;

    if (endpoint === "/news") {
      signals.push(...newsSignals(res.data, rawId, args.companies));
    } else {
      for (const row of mapDiscoveryRows(res.data, endpoint)) {
        const name = row.companyName ?? row.ticker;
        if (!name) continue;
        const type = typeForRow(endpoint, row.category ?? endpoint);
        const known = matchByTickerOrName(row.ticker, name, args.companies);
        signals.push({
          provider: "IndianAPI",
          endpoint,
          signalType: type,
          market: "India",
          companyName: name,
          ticker: row.ticker,
          exchange: endpoint.includes("BSE") ? "BSE" : "NSE",
          companyId: known?.id ?? null,
          reason: reasonFor(endpoint, row.category ?? "", row.movement),
          catalyst: null,
          priceMovePct: row.movement,
          priceMoveSource: `IndianAPI ${endpoint}`,
          priceMoveAt: safeIso(row.providerTimestamp),
          volume: row.volume,
          volumeRatio: null,
          activityNote: endpoint.includes("most_active") ? "Most-active listing" : null,
          week52Event:
            type === "52_WEEK_HIGH"
              ? "New 52-week high"
              : type === "52_WEEK_LOW"
                ? "New 52-week low"
                : null,
          providerTimestamp: safeIso(row.providerTimestamp),
          // A data provider feed is a data platform, never a primary document.
          sourceTier: TIER_3,
          sourceType: "Data Platform",
          publisher: "IndianAPI",
          rawResponseId: rawId,
        });
      }
    }

    log.push({ endpoint, ok: true, rows: signals.length - before, error: null });
  }

  return { signals, requests, endpoints: log, errors, quota };
}

type AnyRec = Record<string, unknown>;

/** /news returns headlines; we attach them to a company only when we can. */
function newsSignals(
  payload: unknown,
  rawId: string | null,
  companies: KnownCompany[],
): RawSignal[] {
  const items: AnyRec[] = [];
  const walk = (value: unknown, depth = 0) => {
    if (depth > 3 || !value) return;
    if (Array.isArray(value)) {
      for (const v of value) if (v && typeof v === "object") items.push(v as AnyRec);
      return;
    }
    if (typeof value === "object")
      for (const v of Object.values(value as AnyRec)) walk(v, depth + 1);
  };
  walk(payload);

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const out: RawSignal[] = [];

  for (const item of items.slice(0, 40)) {
    const headline = str(item["title"]) ?? str(item["headline"]) ?? str(item["summary"]);
    if (!headline) continue;
    const url = str(item["url"]) ?? str(item["link"]);
    const publisher = str(item["source"]) ?? str(item["publisher"]) ?? "IndianAPI /news";
    const published = safeIso(
      str(item["pub_date"]) ?? str(item["date"]) ?? str(item["publishedAt"]),
    );
    const match = matchCompany(headline, companies);
    // Without a company we cannot build a stock story, so the headline is dropped.
    if (!match) continue;

    out.push({
      provider: "IndianAPI",
      endpoint: "/news",
      signalType: inferTypeFromText(headline),
      market: "India",
      companyName: match.name,
      ticker: match.ticker,
      exchange: null,
      companyId: match.id,
      reason: "Named in the market news feed",
      catalyst: headline,
      headline,
      ...(url ? { url } : {}),
      eventAt: published,
      providerTimestamp: published,
      // Press carried through a data feed is treated as reputable news, not primary.
      sourceTier: TIER_2,
      sourceType: "News",
      publisher,
      publishedAt: published,
      rawResponseId: rawId,
    });
  }
  return out;
}
