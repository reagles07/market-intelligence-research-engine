// Domain constants and types for Stock Research Studio (Phase 1)

export const MARKETS = ["US", "India"] as const;
export type Market = (typeof MARKETS)[number];

export const STORY_TYPES = [
  "Earnings Reaction",
  "Major Gainer",
  "Major Loser",
  "Unusual Volume",
  "52 Week High",
  "52 Week Low",
  "Breakout",
  "Breakdown",
  "Analyst Upgrade",
  "Analyst Downgrade",
  "Product Launch",
  "Government Contract",
  "Regulatory Event",
  "Merger",
  "Acquisition",
  "CEO Change",
  "CFO Change",
  "Management Change",
  "Buyback",
  "Dividend",
  "Insider Activity",
  "IPO",
  "Turnaround",
  "Long-Term Deep Dive",
  "Macro",
  "Gold",
  "Silver",
  "Oil",
  "Sector Story",
  "Rumour / Unconfirmed",
  "Custom",
] as const;
export type StoryType = (typeof STORY_TYPES)[number];

export const STORY_STATUSES = [
  "New",
  "Researching",
  "Verification Needed",
  "Research Complete",
  "Script Ready",
  "Approved",
  "Rejected",
  "Archived",
] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

export const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;

export const EVENT_TYPES = [
  "Earnings",
  "Guidance",
  "Product Launch",
  "Regulatory Approval",
  "Government Contract",
  "Acquisition",
  "Merger",
  "Spinoff",
  "Buyback",
  "Dividend",
  "CEO Departure",
  "CFO Departure",
  "Insider Transaction",
  "Share Issuance",
  "Debt Issuance",
  "Lawsuit",
  "Investigation",
  "Short Seller Report",
  "Credit Rating Change",
  "IPO Filing",
  "Other",
] as const;

export const CLAIM_CATEGORIES = [
  "FACT",
  "CALCULATION",
  "COMPANY CLAIM",
  "ANALYST VIEW",
  "NEWS REPORT",
  "INFERENCE",
  "RUMOUR",
  "SCENARIO",
  "UNSUPPORTED",
] as const;
export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];

/** Language rules enforced on any claim before it can enter an approved script. */
export const FACT_SAFETY_RULES: Record<ClaimCategory, string> = {
  FACT: "Can be stated directly.",
  CALCULATION: "Only usable when derived from verified data. Show the inputs.",
  "COMPANY CLAIM": "Must be attributed to the company or its management.",
  "ANALYST VIEW": "Must name the analyst or research firm.",
  "NEWS REPORT": "Must name the publication when relevant.",
  INFERENCE: 'Must use hedged language: "This suggests…", "One possible explanation is…".',
  RUMOUR: "Must clearly be stated as unconfirmed.",
  SCENARIO: "Must use conditional language. Never a prediction.",
  UNSUPPORTED: "Must never enter an approved script.",
};

export const SOURCE_TIERS = [
  "Tier 1 — Primary Source",
  "Tier 2 — Reputable News",
  "Tier 3 — Financial Data Platform",
  "Tier 4 — Social / Discovery",
] as const;

export const SOURCE_TYPES = [
  "SEC Filing",
  "NSE / BSE Filing",
  "Company IR",
  "Earnings Call",
  "Press Release",
  "Government Data",
  "News",
  "Data Platform",
  "Analyst Note",
  "Social",
  "Other",
] as const;

export const VERIFICATION_STATUSES = [
  "Verified",
  "Needs Cross-Check",
  "Conflicting",
  "Unsupported",
  "Rejected",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const MOAT_CATEGORIES = [
  "Brand",
  "Network Effect",
  "Switching Costs",
  "Cost Advantage",
  "Scale",
  "Intellectual Property",
  "Distribution",
  "Data Advantage",
  "Regulatory Barrier",
  "No Clear Moat",
] as const;

export const TRENDS = [
  "Strong Uptrend",
  "Uptrend",
  "Sideways",
  "Downtrend",
  "Strong Downtrend",
] as const;

export const SENTIMENT_CATEGORIES = [
  "News Sentiment",
  "Analyst Sentiment",
  "Social Sentiment",
  "Institutional Positioning",
  "Retail Interest",
  "Options Sentiment",
] as const;

export const SENTIMENT_RATINGS = [
  "Very Bullish",
  "Bullish",
  "Neutral",
  "Bearish",
  "Very Bearish",
] as const;

export const VALUATION_CLASSIFICATIONS = [
  "Green — Attractive",
  "Yellow — Fair",
  "Orange — Expensive but Growth Supported",
  "Red — Priced for Near-Perfect Execution",
] as const;

export const TIME_HORIZONS = [
  "Next Session",
  "1–4 Weeks",
  "Next Quarter",
  "6–12 Months",
  "3–5 Years",
] as const;

export const SCENARIO_TYPES = ["Bull Case", "Base Case", "Bear Case"] as const;

export const FRESHNESS_STATUSES = ["Fresh", "Delayed", "Stale", "Unknown"] as const;
export type Freshness = (typeof FRESHNESS_STATUSES)[number];

export const RESEARCH_SECTIONS = [
  { key: "story_summary", label: "Story Summary", critical: true },
  { key: "what_happened", label: "What Happened", critical: true },
  { key: "business", label: "Business", critical: true },
  { key: "moat", label: "Moat", critical: false },
  { key: "financials", label: "Financials", critical: true },
  { key: "earnings", label: "Earnings", critical: false },
  { key: "valuation", label: "Valuation", critical: true },
  { key: "technical", label: "Technical", critical: false },
  { key: "quantitative", label: "Quantitative", critical: false },
  { key: "sentiment", label: "Sentiment", critical: false },
  { key: "events", label: "Events", critical: false },
  { key: "catalysts", label: "Catalysts", critical: true },
  { key: "risks", label: "Risks", critical: true },
  { key: "bull_case", label: "Bull Case", critical: true },
  { key: "base_case", label: "Base Case", critical: true },
  { key: "bear_case", label: "Bear Case", critical: true },
  { key: "invalidation", label: "Invalidation Conditions", critical: false },
  { key: "sources", label: "Sources", critical: false },
] as const;

// ---------------------------------------------------------------- scoring

export type ScoreComponent = { key: string; label: string; max: number };

export const CONTENT_OPPORTUNITY_COMPONENTS: ScoreComponent[] = [
  { key: "catalyst_importance", label: "Catalyst Importance", max: 20 },
  { key: "price_movement", label: "Price Movement", max: 15 },
  { key: "unusual_volume", label: "Unusual Volume", max: 15 },
  { key: "audience_interest", label: "Audience Interest", max: 15 },
  { key: "source_reliability", label: "Source Reliability", max: 15 },
  { key: "company_popularity", label: "Company Popularity", max: 10 },
  { key: "story_novelty", label: "Story Novelty", max: 5 },
  { key: "storytelling_potential", label: "Storytelling Potential", max: 5 },
];

export const LONG_TERM_QUALITY_COMPONENTS: ScoreComponent[] = [
  { key: "business_moat", label: "Business & Moat", max: 15 },
  { key: "revenue_growth", label: "Revenue Growth Quality", max: 10 },
  { key: "earnings_growth", label: "Earnings Growth Quality", max: 10 },
  { key: "margins", label: "Margins & Profitability", max: 10 },
  { key: "roic", label: "ROIC / Capital Efficiency", max: 10 },
  { key: "cash_flow", label: "Cash Flow Quality", max: 10 },
  { key: "balance_sheet", label: "Balance Sheet Strength", max: 10 },
  { key: "valuation", label: "Valuation", max: 15 },
  { key: "management", label: "Management / Capital Allocation", max: 5 },
  { key: "long_term_risk", label: "Long-Term Risk", max: 5 },
];

export const SHORT_TERM_SETUP_COMPONENTS: ScoreComponent[] = [
  { key: "confirmed_catalyst", label: "Confirmed Catalyst", max: 20 },
  { key: "trend_rs", label: "Trend & Relative Strength", max: 15 },
  { key: "volume_confirmation", label: "Volume Confirmation", max: 15 },
  { key: "support_resistance", label: "Support / Resistance", max: 10 },
  { key: "gap_behaviour", label: "Gap Behaviour", max: 10 },
  { key: "volatility", label: "Volatility", max: 10 },
  { key: "sector_index", label: "Sector / Index Support", max: 10 },
  { key: "sentiment", label: "Sentiment", max: 5 },
  { key: "event_risk", label: "Upcoming Event Risk", max: 5 },
];

export const SCORE_TYPES = {
  opportunity: "Content Opportunity Score",
  quality: "Long-Term Stock Quality Score",
  setup: "Short-Term Market Setup Score",
} as const;
export type ScoreTypeKey = keyof typeof SCORE_TYPES;

export function componentsFor(type: ScoreTypeKey): ScoreComponent[] {
  if (type === "opportunity") return CONTENT_OPPORTUNITY_COMPONENTS;
  if (type === "quality") return LONG_TERM_QUALITY_COMPONENTS;
  return SHORT_TERM_SETUP_COMPONENTS;
}

export function classifyScore(type: ScoreTypeKey, total: number): string {
  if (type === "opportunity") {
    if (total >= 80) return "Immediate Story";
    if (total >= 65) return "Strong Opportunity";
    if (total >= 50) return "Watch";
    return "Low Priority";
  }
  if (type === "quality") {
    if (total >= 85) return "High Quality Candidate";
    if (total >= 70) return "Strong, Price Matters";
    if (total >= 55) return "Mixed Fundamentals";
    if (total >= 40) return "Speculative / Turnaround";
    return "High Risk";
  }
  if (total >= 80) return "Strong Setup";
  if (total >= 65) return "Constructive Setup";
  if (total >= 50) return "Mixed Setup";
  return "Weak Setup";
}

// ---------------------------------------------------------------- content

export const SCRIPT_FORMATS = [
  { key: "yt_deep_dive", label: "Deep Dive — 12–15 Minutes", group: "YouTube" },
  { key: "yt_standard", label: "Standard Analysis — 8–10 Minutes", group: "YouTube" },
  { key: "yt_quick", label: "Quick Analysis — 5–7 Minutes", group: "YouTube" },
  { key: "short_90", label: "90 Seconds", group: "Shorts / Reels" },
  { key: "short_60", label: "60 Seconds", group: "Shorts / Reels" },
  { key: "short_30", label: "30–45 Seconds", group: "Shorts / Reels" },
  { key: "short_series", label: "5-Part Short Series", group: "Shorts / Reels" },
] as const;
export type ScriptFormatKey = (typeof SCRIPT_FORMATS)[number]["key"];

export const SUPPORTING_ASSETS = [
  { key: "yt_titles", label: "YouTube Titles" },
  { key: "thumbnail_text", label: "Thumbnail Text" },
  { key: "yt_description", label: "YouTube Description" },
  { key: "ig_caption", label: "Instagram Caption" },
  { key: "hashtags", label: "Hashtags" },
  { key: "broll", label: "B-Roll Ideas" },
  { key: "charts", label: "Chart Ideas" },
  { key: "cta", label: "CTA" },
  { key: "source_list", label: "Source List" },
  { key: "disclaimer", label: "Disclaimer" },
] as const;

export const LANGUAGES = ["English", "Tamil", "Tanglish"] as const;
export type Language = (typeof LANGUAGES)[number];

export const SCRIPT_STATUSES = [
  "Draft",
  "Needs Fact Check",
  "Ready for Review",
  "Approved",
  "Rejected",
  "Published",
] as const;

export const DISCLAIMER =
  "This platform provides financial research and educational content only. It does not provide personalized investment advice. Market investments involve risk. Forecasts and scenarios are analytical estimates based on available information and are not guarantees of future performance.";

export const DEFAULT_WATCHLISTS = [
  "US Core",
  "India Core",
  "Earnings Watch",
  "AI Stocks",
  "High Risk",
  "IPO Watch",
  "Gold & Silver",
  "Audience Requests",
];
