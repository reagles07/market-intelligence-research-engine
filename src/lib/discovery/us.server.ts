/**
 * US market discovery (server only).
 *
 * IMPORTANT AND DELIBERATE LIMITATION: SEC EDGAR is a filings archive, not a
 * market-movers feed. It cannot tell us the day's largest gainers, largest
 * losers, most active names, unusual volume or after-hours moves. Until a
 * commercial-safe US market-data provider is connected, every US run is
 * flagged PARTIAL_MARKET_COVERAGE and price/volume score components stay
 * unavailable rather than being guessed.
 *
 * Sources used here:
 *   1. SEC filings already ingested for companies in our US universe
 *   2. Events recorded against US companies (earnings, regulatory, product…)
 *   3. Watchlist membership, to weight what our audience already follows
 *   4. At most MAX_US_WEB_QUERIES broad web searches for market stories
 */
import type { Db } from "@/lib/ai/context.server";
import { callStructured } from "@/lib/openai.server";
import { canonicalizeUrl, tierForUrl, TIER_1 } from "@/lib/ai/web-sources";
import { safeIso, typeForSecForm, inferTypeFromText } from "@/lib/discovery/classify";
import {
  MAX_US_WEB_QUERIES,
  US_DISCOVERY_QUERIES,
  type CandidateType,
} from "@/lib/discovery/domain";
import { usDiscoveryJsonSchema, usDiscoveryValidator } from "@/lib/discovery/schemas";
import type { RawSignal } from "@/lib/discovery/cluster";

export type UsCollectResult = {
  signals: RawSignal[];
  webQueries: string[];
  webSearchCalls: number;
  aiCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  errors: string[];
  coverageNote: string;
};

const LOOKBACK_DAYS = 14;

export async function collectUsSignals(args: {
  db: Db;
  userId: string;
  runId: string;
  model: string | null;
  maxQueries?: number;
  companies: Array<{ id: string; name: string; ticker: string; exchange: string | null }>;
  watchlistCompanyIds: Set<string>;
  /** Filing/event window in days. Defaults to the standard 14-day lookback. */
  lookbackDays?: number | undefined;
}): Promise<UsCollectResult> {
  const since = new Date(
    Date.now() - (args.lookbackDays ?? LOOKBACK_DAYS) * 86_400_000,
  ).toISOString();
  const signals: RawSignal[] = [];
  const errors: string[] = [];
  const byId = new Map(args.companies.map((c) => [c.id, c]));

  // ------------------------------------------------------------ 1. SEC filings
  const { data: filings } = await args.db
    .from("sec_filings")
    .select("id,company_id,form,filing_date,report_date,accepted_at,url,accession_number")
    .in("company_id", [...byId.keys()])
    .gte("filing_date", since.slice(0, 10))
    .order("filing_date", { ascending: false })
    .limit(60);

  for (const filing of filings ?? []) {
    const company = filing.company_id ? byId.get(filing.company_id) : null;
    if (!company) continue;
    signals.push({
      provider: "SEC EDGAR",
      endpoint: "/submissions",
      signalType: typeForSecForm(String(filing.form)),
      market: "US",
      companyName: company.name,
      ticker: company.ticker,
      exchange: company.exchange,
      companyId: company.id,
      reason: `New ${filing.form} filing with the SEC`,
      catalyst: `${filing.form} filed ${filing.filing_date}`,
      headline: `${company.name} filed a ${filing.form} with the SEC`,
      ...(filing.url ? { url: filing.url } : {}),
      eventAt: safeIso(filing.accepted_at ?? filing.filing_date),
      providerTimestamp: safeIso(filing.accepted_at ?? filing.filing_date),
      sourceTier: TIER_1,
      sourceType: "SEC Filing",
      publisher: "SEC EDGAR",
      publishedAt: safeIso(filing.filing_date),
    });
  }

  // ------------------------------------------------------------ 2. recorded events
  const { data: events } = await args.db
    .from("events")
    .select("id,company_id,title,event_type,occurred_at,importance,description")
    .in("company_id", [...byId.keys()])
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(60);

  for (const event of events ?? []) {
    const company = byId.get(event.company_id);
    if (!company) continue;
    signals.push({
      provider: "Internal",
      endpoint: "events",
      signalType: inferTypeFromText(`${event.event_type} ${event.title}`),
      market: "US",
      companyName: company.name,
      ticker: company.ticker,
      exchange: company.exchange,
      companyId: company.id,
      reason: `Recorded ${event.event_type} event in our universe`,
      catalyst: event.title,
      headline: event.title,
      eventAt: safeIso(event.occurred_at),
      // An internal record inherits no publisher authority of its own.
      sourceTier: "Tier 3 — Financial Data Platform",
      sourceType: "Other",
      publisher: "Stock Research Studio",
    });
  }

  // ------------------------------------------------------------ 3. broad web pass
  const limit = Math.min(args.maxQueries ?? MAX_US_WEB_QUERIES, MAX_US_WEB_QUERIES);
  const queries = US_DISCOVERY_QUERIES.slice(0, limit);
  let webSearchCalls = 0;
  let aiCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let coverageNote = "";

  if (limit > 0) {
    const universe = args.companies
      .slice(0, 120)
      .map((c) => `${c.ticker} — ${c.name}`)
      .join("; ");

    const web = await callStructured({
      operation: "us-market-discovery",
      mode: "WEB",
      model: args.model,
      instructions: `You are the discovery desk of a stock research studio. You are NOT doing research.

Your only job is to list which US-listed companies are in the news today and what
the development is, so a human can decide what is worth researching later.

RULES
- Run at most ${limit} searches, exactly the ones you are given. Do not branch into
  company-by-company research and do not open more than a handful of pages.
- Only report a company and a development you actually read on a page you opened.
  Never reconstruct a URL, never report a story from memory, never infer a development.
- One line per development. Do not analyse, do not value the company, do not give any
  investment view, do not predict anything.
- reported_price_move_pct: fill it ONLY when the page states the percentage in words or
  figures. Never estimate, never compute one, never carry a number over from another
  company. Null is the correct answer when the page does not state a move.
- If two pages describe the same development, report it once with the strongest source.
- Prefer developments from the last 3 days. Ignore prediction pieces, promotional posts
  and content farms.`,
      input: [
        `Today is ${new Date().toISOString().slice(0, 10)}.`,
        "Run these searches:",
        ...queries.map((q, i) => `${i + 1}. ${q}`),
        "",
        "Companies already in our universe (match to these where the story is about one of them):",
        universe || "(universe empty)",
        "",
        "Return candidate stories only. State in coverage_note what you could not see —",
        "in particular that this is not a complete market-movers scan.",
      ].join("\n"),
      schemaName: "us_discovery",
      jsonSchema: usDiscoveryJsonSchema,
      validator: usDiscoveryValidator,
      webSearch: true,
      maxOutputTokens: 12000,
      userId: args.userId,
    });

    aiCalls = 1;
    inputTokens = web.usage.inputTokens;
    outputTokens = web.usage.outputTokens;
    costUsd = web.usage.estimatedCostUsd;
    webSearchCalls = web.usage.webSearchCalls;

    if (!web.ok) {
      errors.push(`web discovery: ${web.error}`);
    } else {
      coverageNote = web.data.coverage_note;
      for (const c of web.data.candidates) {
        const canonical = canonicalizeUrl(c.url);
        if (!canonical) continue;
        const known =
          args.companies.find(
            (k) => c.ticker && k.ticker.toUpperCase() === c.ticker.toUpperCase(),
          ) ??
          args.companies.find((k) => k.name.toLowerCase() === c.company_name.toLowerCase()) ??
          null;
        signals.push({
          provider: "Web",
          endpoint: "web_search",
          signalType: c.candidate_type as CandidateType,
          market: "US",
          companyName: known?.name ?? c.company_name,
          ticker: known?.ticker ?? c.ticker,
          exchange: known?.exchange ?? c.exchange,
          companyId: known?.id ?? null,
          reason: c.why_it_matters,
          catalyst: c.headline,
          headline: c.headline,
          url: canonical,
          // Recorded for transparency; never scored as measured market data.
          reportedPriceMovePct: c.reported_price_move_pct,
          eventAt: safeIso(c.event_date) ?? safeIso(c.published_at),
          publishedAt: safeIso(c.published_at),
          // The app decides the tier from the host; the model only hints.
          sourceTier: tierForUrl(canonical, null, {
            modelTier: c.source_tier,
            sourceType: c.source_type,
          }),
          sourceType: c.source_type,
          publisher: c.publisher,
        });
      }
    }
  }

  // Watchlist membership is used for scoring rather than as a signal of its own,
  // so a followed company with no development never becomes a candidate.
  return {
    signals,
    webQueries: [...queries],
    webSearchCalls,
    aiCalls,
    inputTokens,
    outputTokens,
    costUsd,
    errors,
    coverageNote,
  };
}
