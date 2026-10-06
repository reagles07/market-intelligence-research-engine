/**
 * Candidate clustering (deterministic, browser-safe).
 *
 * Discovery feeds overlap heavily: one stock that moved hard today typically
 * shows up in Trending, Most Active, Price Shockers, the 52-week scanner and
 * the news feed. That is ONE story carrying five signals — not five stories.
 *
 * Equally, we must not over-merge: an earnings report and an acquisition
 * announced by the same company are genuinely different stories and stay
 * apart, even on the same day.
 */
import { TYPE_FAMILY, type CandidateType } from "@/lib/discovery/domain";

export type RawSignal = {
  provider: string;
  endpoint: string | null;
  signalType: CandidateType;
  market: "India" | "US";
  companyName: string;
  ticker: string | null;
  exchange: string | null;
  companyId?: string | null;
  /** Short human sentence: why this feed surfaced the company. */
  reason: string;
  catalyst?: string | null;
  headline?: string | null;
  url?: string | null;
  /** Provider-measured daily move. Never a model estimate. */
  priceMovePct?: number | null;
  priceMoveSource?: string | null;
  priceMoveAt?: string | null;
  /** A move a web source reported. Recorded, but never scored as market data. */
  reportedPriceMovePct?: number | null;
  volume?: number | null;
  volumeRatio?: number | null;
  activityNote?: string | null;
  week52Event?: string | null;
  eventAt?: string | null;
  providerTimestamp?: string | null;
  sourceTier: string;
  sourceType: string;
  publisher?: string | null;
  publishedAt?: string | null;
  rawResponseId?: string | null;
  sourceId?: string | null;
};

export type CandidateDraft = {
  clusterKey: string;
  market: "India" | "US";
  companyId: string | null;
  companyName: string;
  ticker: string | null;
  exchange: string | null;
  title: string;
  primaryType: CandidateType;
  candidateTypes: CandidateType[];
  discoveryReason: string;
  catalyst: string | null;
  priceMovePct: number | null;
  priceMoveSource: string | null;
  priceMoveAt: string | null;
  reportedPriceMovePct: number | null;
  volume: number | null;
  volumeRatio: number | null;
  activityNote: string | null;
  week52Event: string | null;
  headline: string | null;
  url: string | null;
  eventAt: string | null;
  providerTimestamp: string | null;
  signalCount: number;
  signals: RawSignal[];
};

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "with",
  "as",
  "is",
  "are",
  "was",
  "were",
  "after",
  "amid",
  "from",
  "its",
  "it",
  "says",
  "said",
  "new",
  "stock",
  "stocks",
  "shares",
  "share",
  "ltd",
  "limited",
  "inc",
]);

const tokens = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Company identity used for grouping.
 *
 * The normalised NAME wins, because one provider returns the same company as
 * SAMD.NS, SAMD.BO and an opaque internal code across its feeds — keying on
 * the ticker would split one story into three. The ticker is only a fallback
 * when no usable name came back.
 */
export function companyKey(signal: { ticker: string | null; companyName: string }): string {
  const name = signal.companyName
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|corp|corporation|plc|co|company|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (name.length >= 3) return name;
  // Strip the exchange suffix so NSE and BSE listings still land together.
  return (signal.ticker ?? "")
    .trim()
    .toUpperCase()
    .replace(/\.(NS|BO|BSE|NSE)$/i, "");
}

const dayOf = (signal: RawSignal): string =>
  (signal.eventAt ?? signal.providerTimestamp ?? new Date().toISOString()).slice(0, 10);

/** Headlines this similar describe the same development. */
const HEADLINE_MATCH = 0.45;

/**
 * Group signals into candidates.
 *
 * Primary grouping is company + event day + catalyst family. Within a family
 * that carries headlines (news, filings, web results), headlines that describe
 * clearly different developments are kept as separate candidates.
 */
export function clusterSignals(signals: RawSignal[]): {
  candidates: CandidateDraft[];
  duplicatesMerged: number;
} {
  type Bucket = { key: string; signals: RawSignal[]; headline: Set<string> | null };
  const buckets: Bucket[] = [];

  for (const signal of signals) {
    const family = TYPE_FAMILY[signal.signalType] ?? "OTHER";
    const base = `${signal.market}:${companyKey(signal)}:${dayOf(signal)}:${family}`;
    const headline = signal.headline ? tokens(signal.headline) : null;

    const existing = buckets.find((b) => {
      if (b.key !== base) return false;
      // Market-move families always merge: they describe one day of trading.
      if (family === "MARKET_MOVE") return true;
      if (!headline || !b.headline) return true;
      return jaccard(headline, b.headline) >= HEADLINE_MATCH;
    });

    if (existing) {
      existing.signals.push(signal);
      if (!existing.headline && headline) existing.headline = headline;
    } else {
      buckets.push({ key: base, signals: [signal], headline });
    }
  }

  let duplicatesMerged = 0;
  const candidates = buckets.map((bucket, index) => {
    duplicatesMerged += bucket.signals.length - 1;
    return toCandidate(bucket.signals, `${bucket.key}#${index}`);
  });

  return { candidates, duplicatesMerged };
}

const strongest = (types: CandidateType[]): CandidateType => {
  // Prefer the most material catalyst as the headline type of the candidate.
  const order: CandidateType[] = [
    "M_AND_A",
    "EARNINGS",
    "GUIDANCE",
    "REGULATORY",
    "MANAGEMENT_CHANGE",
    "SEC_FILING",
    "CONTRACT",
    "PRODUCT",
    "IPO",
    "CORPORATE_ACTION",
    "ANALYST_ACTION",
    "52_WEEK_HIGH",
    "52_WEEK_LOW",
    "PRICE_MOVE",
    "UNUSUAL_VOLUME",
    "MACRO_IMPACT",
    "COMMODITY_IMPACT",
    "TRENDING",
    "OTHER",
  ];
  for (const t of order) if (types.includes(t)) return t;
  return "OTHER";
};

const firstOf = <T>(values: Array<T | null | undefined>): T | null =>
  values.find((v) => v !== null && v !== undefined) ?? null;

function toCandidate(signals: RawSignal[], clusterKey: string): CandidateDraft {
  const types = [...new Set(signals.map((s) => s.signalType))];
  const primaryType = strongest(types);
  const withName = signals.find((s) => s.companyName && s.companyName.length > 1) ?? signals[0]!;
  const headline = firstOf(signals.map((s) => s.headline));
  const moves = signals
    .filter((s) => typeof s.priceMovePct === "number")
    .sort((a, b) => Math.abs(b.priceMovePct!) - Math.abs(a.priceMovePct!));
  const move = moves[0] ?? null;
  const ratios = signals
    .map((s) => s.volumeRatio)
    .filter((v): v is number => typeof v === "number");

  return {
    clusterKey,
    market: withName.market,
    companyId: firstOf(signals.map((s) => s.companyId ?? null)),
    companyName: withName.companyName,
    ticker: firstOf(signals.map((s) => s.ticker)),
    exchange: firstOf(signals.map((s) => s.exchange)),
    title: headline ?? `${withName.companyName} — ${signals.map((s) => s.reason)[0]}`,
    primaryType,
    candidateTypes: types,
    discoveryReason: [...new Set(signals.map((s) => s.reason))].join(" · "),
    catalyst: firstOf(signals.map((s) => s.catalyst ?? null)) ?? headline,
    priceMovePct: move?.priceMovePct ?? null,
    priceMoveSource: move?.priceMoveSource ?? null,
    priceMoveAt: move?.priceMoveAt ?? move?.providerTimestamp ?? null,
    reportedPriceMovePct: firstOf(signals.map((s) => s.reportedPriceMovePct ?? null)),
    volume: firstOf(signals.map((s) => s.volume ?? null)),
    volumeRatio: ratios.length ? Math.max(...ratios) : null,
    activityNote: firstOf(signals.map((s) => s.activityNote ?? null)),
    week52Event: firstOf(signals.map((s) => s.week52Event ?? null)),
    headline,
    url: firstOf(signals.map((s) => s.url ?? null)),
    eventAt: firstOf(signals.map((s) => s.eventAt ?? null)),
    providerTimestamp: firstOf(signals.map((s) => s.providerTimestamp ?? null)),
    signalCount: signals.length,
    signals,
  };
}
