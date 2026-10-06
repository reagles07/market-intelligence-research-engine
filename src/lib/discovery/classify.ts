/**
 * Headline → candidate type classification (deterministic, browser-safe).
 *
 * Keyword rules, not a model call. Discovery must stay cheap, and a wrong
 * guess here only affects which family a candidate clusters into — it never
 * asserts a fact.
 */
import type { CandidateType } from "@/lib/discovery/domain";

const RULES: Array<{ type: CandidateType; patterns: RegExp }> = [
  {
    type: "M_AND_A",
    patterns: /\b(acquir|acquisition|merger|merges|takeover|buyout|stake sale|divest)\w*/i,
  },
  {
    type: "EARNINGS",
    patterns:
      /\b(q[1-4]|quarter|earnings|results|profit|revenue|net income|pat|ebitda|beat|miss)\w*/i,
  },
  {
    type: "GUIDANCE",
    patterns: /\b(guidance|outlook|forecast|cuts? target|raises? target|downgrades? outlook)\w*/i,
  },
  {
    type: "REGULATORY",
    patterns:
      /\b(sebi|rbi|regulat|probe|investigat|penalt|fine|lawsuit|court|tribunal|antitrust|ftc|doj|fda)\w*/i,
  },
  {
    type: "MANAGEMENT_CHANGE",
    patterns: /\b(ceo|cfo|chairman|managing director|resign|steps down|appoint)\w*/i,
  },
  {
    type: "CONTRACT",
    patterns: /\b(order win|wins order|contract|bags|awarded|tender|deal worth)\w*/i,
  },
  { type: "PRODUCT", patterns: /\b(launch|unveil|new product|rolls out|introduc)\w*/i },
  {
    type: "ANALYST_ACTION",
    patterns: /\b(upgrade|downgrade|price target|initiat\w+ coverage|brokerage|analyst)\w*/i,
  },
  {
    type: "CORPORATE_ACTION",
    patterns: /\b(dividend|bonus issue|stock split|buyback|rights issue|record date)\w*/i,
  },
  { type: "IPO", patterns: /\b(ipo|listing|lists at|drhp|public issue)\w*/i },
  {
    type: "COMMODITY_IMPACT",
    patterns: /\b(crude|oil price|gold|silver|steel price|commodity)\w*/i,
  },
  {
    type: "MACRO_IMPACT",
    patterns: /\b(inflation|gdp|rate cut|rate hike|fed |budget|tariff|policy)\w*/i,
  },
  { type: "SEC_FILING", patterns: /\b(8-k|10-q|10-k|s-1|13d|form 4|filing)\b/i },
];

export function inferTypeFromText(text: string | null | undefined): CandidateType {
  if (!text) return "OTHER";
  for (const rule of RULES) if (rule.patterns.test(text)) return rule.type;
  return "OTHER";
}

/** SEC form → candidate type. Filings are always at least SEC_FILING. */
export function typeForSecForm(form: string): CandidateType {
  const f = form.toUpperCase();
  if (f.startsWith("10-Q") || f.startsWith("10-K")) return "EARNINGS";
  if (f.startsWith("S-1") || f.startsWith("424")) return "IPO";
  if (f.startsWith("SC 13") || f.startsWith("SC TO")) return "M_AND_A";
  return "SEC_FILING";
}

export function safeIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
