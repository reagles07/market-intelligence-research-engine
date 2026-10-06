/**
 * Phase 2A discovery domain constants (client-safe).
 *
 * The Content Opportunity Score measured here answers ONE question:
 * "how good a the editorial workspace story is this?". It is never an investment
 * score, a buy score or a quality judgement about the company. The separate
 * Long-Term Stock Quality and Short-Term Market Setup scores stay untouched.
 */

export const DISCOVERY_MARKETS = ["India", "US"] as const;
export type DiscoveryMarket = (typeof DISCOVERY_MARKETS)[number];

export const RUN_TYPES = ["MANUAL", "SCHEDULED", "DELTA"] as const;
export type RunType = (typeof RUN_TYPES)[number];

/** Only MANUAL executes in Phase 2A; the others exist for later phases. */
export const ACTIVE_RUN_TYPES: RunType[] = ["MANUAL"];

export const RUN_STATUSES = ["RUNNING", "COMPLETED", "PARTIAL", "FAILED"] as const;

export const COVERAGE_FULL = "FULL_MARKET_COVERAGE";
export const COVERAGE_PARTIAL = "PARTIAL_MARKET_COVERAGE";

export const US_COVERAGE_NOTE =
  "US discovery runs on SEC filings, our US universe and watchlists, and a small number of broad web searches. It is NOT a whole-market movers feed: gainers, losers, most active, unusual volume and after-hours moves are not available until a dedicated US market-data provider is connected.";

export const CANDIDATE_TYPES = [
  "EARNINGS",
  "PRICE_MOVE",
  "UNUSUAL_VOLUME",
  "52_WEEK_HIGH",
  "52_WEEK_LOW",
  "TRENDING",
  "REGULATORY",
  "SEC_FILING",
  "PRODUCT",
  "CONTRACT",
  "M_AND_A",
  "MANAGEMENT_CHANGE",
  "GUIDANCE",
  "ANALYST_ACTION",
  "CORPORATE_ACTION",
  "IPO",
  "MACRO_IMPACT",
  "COMMODITY_IMPACT",
  "OTHER",
] as const;
export type CandidateType = (typeof CANDIDATE_TYPES)[number];

export const CANDIDATE_STATUSES = [
  "DISCOVERED",
  "CLUSTERED",
  "SCORED",
  "SHORTLISTED",
  "DISMISSED",
  "PROMOTED_TO_STORY",
  "RESEARCHING",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/**
 * Materiality of each catalyst type, out of the 20-point catalyst weight.
 * A generic trending appearance is a weak signal; an acquisition is not.
 */
export const CATALYST_STRENGTH: Record<CandidateType, number> = {
  M_AND_A: 20,
  EARNINGS: 18,
  GUIDANCE: 18,
  REGULATORY: 17,
  MANAGEMENT_CHANGE: 15,
  SEC_FILING: 14,
  CONTRACT: 14,
  PRODUCT: 12,
  IPO: 12,
  CORPORATE_ACTION: 10,
  "52_WEEK_HIGH": 10,
  "52_WEEK_LOW": 10,
  PRICE_MOVE: 9,
  ANALYST_ACTION: 8,
  UNUSUAL_VOLUME: 8,
  MACRO_IMPACT: 7,
  COMMODITY_IMPACT: 7,
  TRENDING: 6,
  OTHER: 4,
};

/**
 * Candidate types that describe the SAME underlying market event.
 * Trending + Most Active + Price Shocker + 52-week on one company on one day
 * is one story with four signals, not four stories.
 */
export const TYPE_FAMILY: Record<CandidateType, string> = {
  PRICE_MOVE: "MARKET_MOVE",
  UNUSUAL_VOLUME: "MARKET_MOVE",
  TRENDING: "MARKET_MOVE",
  "52_WEEK_HIGH": "MARKET_MOVE",
  "52_WEEK_LOW": "MARKET_MOVE",
  EARNINGS: "EARNINGS",
  GUIDANCE: "EARNINGS",
  M_AND_A: "M_AND_A",
  REGULATORY: "REGULATORY",
  SEC_FILING: "FILING",
  CORPORATE_ACTION: "FILING",
  MANAGEMENT_CHANGE: "MANAGEMENT",
  PRODUCT: "PRODUCT",
  CONTRACT: "CONTRACT",
  ANALYST_ACTION: "ANALYST",
  IPO: "IPO",
  MACRO_IMPACT: "MACRO",
  COMMODITY_IMPACT: "MACRO",
  OTHER: "OTHER",
};

export const SCORE_BANDS = [
  { min: 80, band: "IMMEDIATE" },
  { min: 65, band: "STRONG" },
  { min: 50, band: "WATCH" },
  { min: 0, band: "LOW PRIORITY" },
] as const;

export type PriorityBand = (typeof SCORE_BANDS)[number]["band"];

export function bandForScore(score: number): PriorityBand {
  return (SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[3]).band;
}

/** Content Opportunity Score weights — total 100. */
export const DISCOVERY_SCORE_COMPONENTS = [
  { key: "catalyst_importance", label: "Catalyst Strength", max: 20 },
  { key: "price_movement", label: "Price Move", max: 15 },
  { key: "unusual_volume", label: "Unusual Volume / Activity", max: 15 },
  { key: "audience_interest", label: "Audience Interest", max: 15 },
  { key: "source_reliability", label: "Source Reliability", max: 15 },
  { key: "company_popularity", label: "Company Popularity", max: 10 },
  { key: "story_novelty", label: "Novelty", max: 5 },
  { key: "storytelling_potential", label: "Storytelling Potential", max: 5 },
] as const;

export type DiscoveryComponentKey = (typeof DISCOVERY_SCORE_COMPONENTS)[number]["key"];

/** Default budgets. Discovery must stay cheap. */
export const MAX_INDIA_REQUESTS = 7;
export const MAX_US_WEB_QUERIES = 4;
export const MAX_EVAL_CANDIDATES = 10;

export const INDIA_DISCOVERY_ENDPOINTS = [
  "/trending",
  "/NSE_most_active",
  "/BSE_most_active",
  "/price_shockers",
  "/fetch_52_week_high_low_data",
  "/news",
] as const;

export const US_DISCOVERY_QUERIES = [
  "biggest US stock market company movers today",
  "US earnings stocks moving after hours today",
  "major US company earnings news today",
  "US stocks regulatory M&A product announcement news today",
] as const;

export const CANDIDATE_TYPE_LABELS: Record<CandidateType, string> = {
  EARNINGS: "Earnings",
  PRICE_MOVE: "Price move",
  UNUSUAL_VOLUME: "Unusual volume",
  "52_WEEK_HIGH": "52-week high",
  "52_WEEK_LOW": "52-week low",
  TRENDING: "Trending",
  REGULATORY: "Regulatory",
  SEC_FILING: "SEC filing",
  PRODUCT: "Product",
  CONTRACT: "Contract",
  M_AND_A: "M&A",
  MANAGEMENT_CHANGE: "Management change",
  GUIDANCE: "Guidance",
  ANALYST_ACTION: "Analyst action",
  CORPORATE_ACTION: "Corporate action",
  IPO: "IPO",
  MACRO_IMPACT: "Macro impact",
  COMMODITY_IMPACT: "Commodity impact",
  OTHER: "Other",
};

/** Story type used when a candidate is promoted, per candidate type. */
export const CANDIDATE_TO_STORY_TYPE: Record<CandidateType, string> = {
  EARNINGS: "Earnings Reaction",
  GUIDANCE: "Earnings Reaction",
  PRICE_MOVE: "Major Gainer",
  UNUSUAL_VOLUME: "Unusual Volume",
  "52_WEEK_HIGH": "52 Week High",
  "52_WEEK_LOW": "52 Week Low",
  TRENDING: "Custom",
  REGULATORY: "Regulatory Event",
  SEC_FILING: "Regulatory Event",
  PRODUCT: "Product Launch",
  CONTRACT: "Government Contract",
  M_AND_A: "Acquisition",
  MANAGEMENT_CHANGE: "Management Change",
  ANALYST_ACTION: "Analyst Upgrade",
  CORPORATE_ACTION: "Dividend",
  IPO: "IPO",
  MACRO_IMPACT: "Macro",
  COMMODITY_IMPACT: "Sector Story",
  OTHER: "Custom",
};
