/**
 * Vendor-neutral provider interfaces.
 *
 * Phase 1 ships NO live implementations — these exist so US/India market data,
 * SEC/NSE/BSE filings, news, macro (FRED/RBI) and AI vendors can be plugged in
 * later without touching pages or the database schema.
 *
 * Rule: application code depends on these interfaces, never on a vendor SDK.
 */

import type { Freshness } from "./domain";

export interface DataEnvelope<T> {
  value: T | null;
  source: string | null;
  timestamp: string | null;
  freshness: Freshness;
  /** true when the value is seeded demo content, not market information. */
  isDemo: boolean;
}

export interface Quote {
  ticker: string;
  exchange: string;
  price: number;
  previousClose: number | null;
  dailyChangePct: number | null;
  volume: number | null;
  avgVolume20d: number | null;
  currency: string;
}

export interface MarketDataProvider {
  readonly id: string;
  getQuote(ticker: string, exchange: string): Promise<DataEnvelope<Quote>>;
  getHistory(
    ticker: string,
    exchange: string,
    range: "1M" | "3M" | "1Y" | "5Y",
  ): Promise<DataEnvelope<Array<{ date: string; close: number; volume: number }>>>;
}

export interface FinancialDataProvider {
  readonly id: string;
  getFinancials(
    ticker: string,
    periodType: "Annual" | "Quarterly",
  ): Promise<DataEnvelope<Record<string, number | null>[]>>;
  getValuation(ticker: string): Promise<DataEnvelope<Record<string, number | null>>>;
}

export interface NewsProvider {
  readonly id: string;
  search(
    query: string,
    opts?: { since?: string; limit?: number },
  ): Promise<
    DataEnvelope<Array<{ title: string; url: string; publisher: string; publishedAt: string }>>
  >;
}

export interface FilingsProvider {
  readonly id: string;
  /** SEC (US) / NSE / BSE (India) primary filings. */
  listFilings(
    ticker: string,
    opts?: { forms?: string[]; limit?: number },
  ): Promise<DataEnvelope<Array<{ form: string; url: string; filedAt: string }>>>;
}

export interface MacroDataProvider {
  readonly id: string;
  /** FRED (US) / RBI (India) series. */
  getSeries(seriesId: string): Promise<DataEnvelope<Array<{ date: string; value: number }>>>;
}

export interface AIProvider {
  readonly id: string;
  complete(input: { system?: string; prompt: string }): Promise<DataEnvelope<string>>;
}

export interface ProviderRegistry {
  marketData: Partial<Record<"US" | "India", MarketDataProvider>>;
  financials: FinancialDataProvider | null;
  news: NewsProvider | null;
  filings: Partial<Record<"US" | "India", FilingsProvider>>;
  macro: Partial<Record<"US" | "India", MacroDataProvider>>;
  ai: AIProvider | null;
}

/** Phase 1: nothing is wired. Pages must handle every provider being null. */
export const providers: ProviderRegistry = {
  marketData: {},
  financials: null,
  news: null,
  filings: {},
  macro: {},
  ai: null,
};

export function isProviderConfigured(kind: keyof ProviderRegistry): boolean {
  const entry = providers[kind];
  if (!entry) return false;
  if (typeof entry === "object" && !("id" in entry)) return Object.keys(entry).length > 0;
  return true;
}
