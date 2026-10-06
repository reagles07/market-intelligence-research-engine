/**
 * Ticker → CIK resolution (server only).
 *
 * SEC's company_tickers.json is ~1MB, so it is cached in the database and
 * refreshed at most weekly. Lookups normally cost zero SEC requests.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callSec } from "@/lib/sec.server";
import { padCik } from "@/lib/sec/constants";

export type CikResolution = {
  ticker: string;
  cik: string | null;
  title: string | null;
  cached: boolean;
  requests: number;
  error: string | null;
};

export async function resolveTickerToCik(
  rawTicker: string,
  opts: { forceRefresh?: boolean; userId?: string | null; maxAgeMs: number },
): Promise<CikResolution> {
  const ticker = rawTicker.trim().toUpperCase();
  let requests = 0;

  if (!opts.forceRefresh) {
    const { data: hit } = await supabaseAdmin
      .from("sec_ticker_cik")
      .select("cik,title,refreshed_at")
      .eq("ticker", ticker)
      .maybeSingle();
    if (hit && Date.now() - new Date(hit.refreshed_at).getTime() < opts.maxAgeMs) {
      return {
        ticker,
        cik: padCik(hit.cik),
        title: hit.title,
        cached: true,
        requests,
        error: null,
      };
    }
  }

  const res = await callSec({
    endpoint: "/files/company_tickers.json",
    host: "www",
    userId: opts.userId ?? null,
  });
  requests += 1;
  if (!res.ok) {
    return { ticker, cik: null, title: null, cached: false, requests, error: res.error };
  }

  const rows = Object.values((res.data ?? {}) as Record<string, unknown>) as Array<{
    cik_str?: number | string;
    ticker?: string;
    title?: string;
  }>;

  const refreshedAt = new Date().toISOString();
  const upsertRows = rows
    .filter((r) => r?.ticker && r?.cik_str !== undefined)
    .map((r) => ({
      ticker: String(r.ticker).toUpperCase(),
      cik: padCik(r.cik_str as string | number),
      title: String(r.title ?? ""),
      refreshed_at: refreshedAt,
    }));

  for (let i = 0; i < upsertRows.length; i += 500) {
    await supabaseAdmin
      .from("sec_ticker_cik")
      .upsert(upsertRows.slice(i, i + 500), { onConflict: "ticker" });
  }

  const match = upsertRows.find((r) => r.ticker === ticker);
  return {
    ticker,
    cik: match?.cik ?? null,
    title: match?.title ?? null,
    cached: false,
    requests,
    error: match ? null : `Ticker ${ticker} is not present in the SEC ticker file.`,
  };
}
