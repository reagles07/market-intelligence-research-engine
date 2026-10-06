/**
 * Deterministic story-aware data plan (pure, client-safe).
 *
 * The plan decides which stored datasets matter for THIS story before any
 * provider is contacted. It is deliberately rule-based: the AI layer never
 * gets to pick arbitrary provider endpoints.
 */

export type ResearchCategory =
  | "EARNINGS"
  | "PRICE_MOVE"
  | "REGULATORY"
  | "ANALYST_ACTION"
  | "MNA"
  | "CORPORATE_ACTION"
  | "GENERAL";

export type DatasetKey =
  | "market_snapshot"
  | "financials"
  | "earnings"
  | "announcements"
  | "corporate_actions"
  | "historical_stats"
  | "sec_filings"
  | "sec_facts"
  | "events"
  | "news";

export type PlannedDataset = {
  dataset: DatasetKey;
  /** Provider that can refresh it, or null when it is derived/stored only. */
  provider: "IndianAPI" | "SEC EDGAR" | "Web" | null;
  priority: 1 | 2 | 3;
  reason: string;
};

const T = (s: string) => s.toLowerCase();

export function categorizeStory(storyType: string, title = "", catalyst = ""): ResearchCategory {
  const hay = T(`${storyType} ${title} ${catalyst}`);
  if (/earning|result|quarter|q[1-4]\b|profit|revenue|guidance/.test(hay)) return "EARNINGS";
  if (/merger|acquisi|takeover|stake sale|m&a|deal/.test(hay)) return "MNA";
  if (/regulat|sebi|rbi|sec |probe|investigat|penalt|filing|lawsuit|compliance/.test(hay))
    return "REGULATORY";
  if (/analyst|upgrade|downgrade|target price|rating|brokerage/.test(hay)) return "ANALYST_ACTION";
  if (/buyback|dividend|bonus|split|insider|ipo/.test(hay)) return "CORPORATE_ACTION";
  if (/gainer|loser|volume|52 week|breakout|breakdown|surge|slump|rally|crash|price/.test(hay))
    return "PRICE_MOVE";
  return "GENERAL";
}

const INDIA_ONLY: DatasetKey[] = ["announcements", "corporate_actions", "historical_stats"];
const US_ONLY: DatasetKey[] = ["sec_filings", "sec_facts"];

const BY_CATEGORY: Record<ResearchCategory, Array<[DatasetKey, 1 | 2 | 3, string]>> = {
  EARNINGS: [
    ["financials", 1, "Earnings story: reported financials are the core evidence."],
    ["earnings", 1, "Earnings story: the reported quarter must be on record."],
    ["sec_facts", 1, "Earnings story: XBRL facts are the primary US numbers."],
    ["sec_filings", 1, "Earnings story: the 10-Q/8-K filing is the primary source."],
    ["announcements", 1, "Earnings story: exchange announcement carries guidance."],
    ["market_snapshot", 2, "Market reaction gives context to the result."],
    ["news", 2, "Management commentary and analyst reaction come from news."],
  ],
  PRICE_MOVE: [
    ["market_snapshot", 1, "Price-move story: the move itself must be measured, not described."],
    ["news", 1, "Price-move story: the catalyst has to be explained by a source."],
    ["events", 2, "A recorded event may explain the move."],
    ["announcements", 2, "An exchange announcement may explain the move."],
    ["sec_filings", 2, "A recent filing may explain the move."],
    ["financials", 3, "Fundamentals give the move context."],
  ],
  REGULATORY: [
    ["sec_filings", 1, "Regulatory story: the filing is the primary source."],
    ["announcements", 1, "Regulatory story: the exchange/regulator notice is primary."],
    ["events", 2, "The regulatory event should be on the timeline."],
    ["news", 1, "Regulatory story: reporting establishes scope and reaction."],
    ["financials", 3, "Financial exposure gives the action context."],
  ],
  ANALYST_ACTION: [
    ["news", 1, "Analyst action: the rating/target must be attributed to a firm."],
    ["market_snapshot", 1, "Market reaction to the rating change."],
    ["financials", 2, "Fundamentals underpin the analyst's case."],
    ["sec_facts", 3, "US fundamentals for the analyst thesis."],
  ],
  MNA: [
    ["announcements", 1, "M&A: the deal announcement is primary."],
    ["sec_filings", 1, "M&A: the 8-K/merger filing is primary."],
    ["news", 1, "M&A: transaction terms and market reaction."],
    ["financials", 2, "Financial context for the transaction."],
    ["market_snapshot", 2, "Deal reaction in the price."],
  ],
  CORPORATE_ACTION: [
    ["corporate_actions", 1, "Corporate action: the record is primary."],
    ["announcements", 1, "Corporate action: exchange announcement is primary."],
    ["sec_filings", 2, "US corporate actions are disclosed in filings."],
    ["market_snapshot", 2, "Price reaction to the action."],
    ["news", 2, "Reporting adds context."],
  ],
  GENERAL: [
    ["news", 1, "The story needs at least one sourced account of what happened."],
    ["market_snapshot", 2, "Current market context."],
    ["financials", 2, "Baseline fundamentals."],
    ["sec_facts", 3, "US baseline fundamentals."],
    ["sec_filings", 3, "Recent US disclosure."],
    ["announcements", 3, "Recent India disclosure."],
  ],
};

const PROVIDER: Record<DatasetKey, PlannedDataset["provider"]> = {
  market_snapshot: "IndianAPI",
  financials: null,
  earnings: null,
  announcements: "IndianAPI",
  corporate_actions: "IndianAPI",
  historical_stats: "IndianAPI",
  sec_filings: "SEC EDGAR",
  sec_facts: "SEC EDGAR",
  events: null,
  news: "Web",
};

export function buildDataPlan(args: {
  market: string;
  storyType: string;
  title?: string;
  catalyst?: string;
}): { category: ResearchCategory; datasets: PlannedDataset[] } {
  const category = categorizeStory(args.storyType, args.title ?? "", args.catalyst ?? "");
  const isIndia = args.market === "India";

  const datasets = BY_CATEGORY[category]
    .filter(([key]) => {
      if (INDIA_ONLY.includes(key)) return isIndia;
      if (US_ONLY.includes(key)) return !isIndia;
      return true;
    })
    .map(([dataset, priority, reason]) => ({
      dataset,
      provider: dataset === "market_snapshot" && !isIndia ? null : PROVIDER[dataset],
      priority,
      reason,
    }));

  return { category, datasets };
}
