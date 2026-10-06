/**
 * Deterministic numeric extraction and classification (client-safe, no AI).
 *
 * Phase 1.3E. Every number a script speaks is pulled out here by regular
 * expressions and normalised, so the pre-check can compare it against the
 * structured research data BEFORE the model-driven fact audit runs. No model
 * is involved: this layer must be reproducible and free.
 */

export const NUMERIC_MATCH_STATUSES = [
  "EXACT_MATCH",
  "APPROX_MATCH",
  "NO_MATCH",
  "CONFLICT",
  "PERIOD_MISMATCH",
  "UNIT_MISMATCH",
  "CURRENCY_MISMATCH",
  "METRIC_MISMATCH",
] as const;
export type NumericMatchStatus = (typeof NUMERIC_MATCH_STATUSES)[number];

/** Statuses that must always create a blocking audit item. */
export const BLOCKING_MATCH_STATUSES: readonly NumericMatchStatus[] = [
  "CONFLICT",
  "PERIOD_MISMATCH",
  "UNIT_MISMATCH",
  "CURRENCY_MISMATCH",
  "METRIC_MISMATCH",
];

export type NumericKind =
  "currency" | "percent" | "percentage_points" | "multiple" | "count" | "date" | "period";

/** Metric families the extractor can recognise from surrounding words. */
export const METRIC_FAMILIES = [
  "revenue",
  "bookings",
  "backlog",
  "run_rate",
  "eps_gaap",
  "eps_adjusted",
  "eps",
  "net_income",
  "operating_income",
  "ebitda",
  "gross_margin",
  "operating_margin",
  "net_margin",
  "free_cash_flow",
  "operating_cash_flow",
  "capex",
  "debt",
  "cash",
  "market_cap",
  "valuation_multiple",
  "price",
  "price_target",
  "guidance",
  "shares_outstanding",
  "growth",
  "dividend_yield",
  "unknown",
] as const;
export type MetricFamily = (typeof METRIC_FAMILIES)[number];

/** Ordered longest-phrase-first so "adjusted eps" wins over "eps". */
const METRIC_KEYWORDS: Array<[MetricFamily, string[]]> = [
  ["eps_adjusted", ["adjusted eps", "non-gaap eps", "adj eps", "adjusted earnings per share"]],
  ["eps_gaap", ["gaap eps", "basic eps", "diluted eps", "reported eps"]],
  ["eps", ["eps", "earnings per share"]],
  ["run_rate", ["run-rate", "run rate", "annualised revenue", "annualized revenue", "arr"]],
  ["bookings", ["bookings", "order intake", "new orders", "order inflow"]],
  ["backlog", ["backlog", "order book", "orderbook"]],
  ["revenue", ["revenue", "sales", "topline", "top line", "வருமானம்", "விற்பனை"]],
  ["gross_margin", ["gross margin"]],
  ["operating_margin", ["operating margin", "ebit margin", "opm"]],
  ["net_margin", ["net margin", "profit margin"]],
  ["ebitda", ["ebitda"]],
  ["operating_income", ["operating income", "operating profit", "ebit"]],
  ["net_income", ["net income", "net profit", "profit after tax", "pat", "லாபம்"]],
  ["free_cash_flow", ["free cash flow", "fcf"]],
  ["operating_cash_flow", ["operating cash flow", "ocf", "cash from operations"]],
  ["capex", ["capex", "capital expenditure"]],
  ["debt", ["debt", "borrowing", "கடன்"]],
  ["cash", ["cash balance", "net cash", "cash reserve", "cash"]],
  ["market_cap", ["market cap", "market capitalisation", "market capitalization", "mcap"]],
  ["price_target", ["price target", "target price", "target of", "target-a", "தார்கெட்"]],
  [
    "valuation_multiple",
    [
      "p/e",
      "pe ratio",
      "price to earnings",
      "ev/ebitda",
      "p/s",
      "price to sales",
      "peg",
      "p/b",
      "price to book",
    ],
  ],
  ["guidance", ["guidance", "guided", "outlook", "guide"]],
  ["shares_outstanding", ["shares outstanding", "share count", "diluted shares"]],
  ["dividend_yield", ["dividend yield"]],
  ["growth", ["growth", "grew", "increase", "decline", "fell", "rose", "வளர்ச்சி"]],
  ["price", ["share price", "stock price", "price", "closed at", "trading at", "விலை"]],
];

/** Metric pairs that must never be swapped — §10 high-risk errors. */
export const INCOMPATIBLE_METRICS: Array<[MetricFamily, MetricFamily]> = [
  ["revenue", "bookings"],
  ["revenue", "backlog"],
  ["revenue", "run_rate"],
  ["eps_gaap", "eps_adjusted"],
  ["operating_income", "net_income"],
  ["price", "price_target"],
];

const SCALES: Array<[string[], number]> = [
  [["trillion", "tn"], 1e12],
  [["billion", "bn", "b"], 1e9],
  [["crore", "cr", "கோடி"], 1e7],
  [["million", "mn", "m"], 1e6],
  [["lakh", "lac", "லட்சம்"], 1e5],
  [["thousand", "k"], 1e3],
];

export type NumericMention = {
  /** Position in the concatenated spoken text — used to keep ordering stable. */
  index: number;
  raw: string;
  sentence: string;
  sectionKey: string | null;
  value: number | null;
  kind: NumericKind;
  currency: string | null;
  scale: number;
  metric: MetricFamily;
  /** e.g. "Q2 FY2025", "FY2026", "TTM" */
  period: string | null;
  periodKind: "quarter" | "year" | "ttm" | null;
  /** Absolute character offsets inside the text this mention came from. */
  charStart: number;
  charEnd: number;
};

/** Clause separators that end a metric's scope ("… income 40.77bn; GAAP EPS 9.23"). */
const CLAUSE_BREAK = /[;:]|,(?!\d)|\s—\s|\s-\s/g;

/** Text belonging to the clause that immediately precedes the number. */
function beforeClause(before: string): string {
  CLAUSE_BREAK.lastIndex = 0;
  let cut = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE_BREAK.exec(before)) !== null) cut = m.index + m[0].length;
  return before.slice(cut);
}

/** Text belonging to the clause that immediately follows the number. */
function afterClause(after: string): string {
  CLAUSE_BREAK.lastIndex = 0;
  const m = CLAUSE_BREAK.exec(after);
  return m ? after.slice(0, m.index) : after;
}

/**
 * Bind a number to the metric that is actually nearest to it, inside its own
 * clause. Keyword-priority order only breaks ties, so a sentence carrying two
 * metrics ("operating income 40.77 billion; GAAP EPS 9.23") no longer binds the
 * first number to the second metric.
 */
function detectMetric(before: string, after: string): MetricFamily {
  const pre = beforeClause(before).toLowerCase();
  const post = afterClause(after).toLowerCase();
  // A trailing clause is weaker evidence than a leading one: "<metric> <value>"
  // is the dominant phrasing in both English and Tanglish.
  const AFTER_PENALTY = 1000;

  let best: { family: MetricFamily; distance: number; priority: number; len: number } | null = null;
  METRIC_KEYWORDS.forEach(([family, words], priority) => {
    for (const kw of words) {
      const b = pre.lastIndexOf(kw);
      const a = post.indexOf(kw);
      const candidates: number[] = [];
      if (b >= 0) candidates.push(pre.length - (b + kw.length));
      if (a >= 0) candidates.push(a + AFTER_PENALTY);
      for (const distance of candidates) {
        if (
          !best ||
          distance < best.distance ||
          (distance === best.distance &&
            (priority < best.priority || (priority === best.priority && kw.length > best.len)))
        ) {
          best = { family, distance, priority, len: kw.length };
        }
      }
    }
  });
  return best ? (best as { family: MetricFamily }).family : "unknown";
}

function detectScale(after: string): number {
  const a = after.toLowerCase();
  for (const [words, mult] of SCALES) {
    for (const w of words) {
      if (new RegExp(`^\\s*${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(a))
        return mult;
    }
  }
  return 1;
}

const QUARTER_RE = /\bQ([1-4])\s*(?:FY)?\s*'?(\d{2,4})?/i;
const FY_RE = /\bFY\s*'?(\d{2,4})\b/i;
const TTM_RE = /\b(TTM|trailing twelve|last twelve months)\b/i;

export function detectPeriod(window: string): {
  period: string | null;
  kind: NumericMention["periodKind"];
} {
  const q = QUARTER_RE.exec(window);
  if (q) return { period: q[0].trim().toUpperCase().replace(/\s+/g, " "), kind: "quarter" };
  if (TTM_RE.test(window)) return { period: "TTM", kind: "ttm" };
  const f = FY_RE.exec(window);
  if (f) return { period: f[0].trim().toUpperCase().replace(/\s+/g, " "), kind: "year" };
  const y = /\b(19|20)\d{2}\b/.exec(window);
  if (y) return { period: y[0], kind: "year" };
  return { period: null, kind: null };
}

/** Normalise a fiscal-year token to a 4-digit year, or null. */
export function periodYear(period: string | null): number | null {
  if (!period) return null;
  const m = /(\d{2,4})\s*$/.exec(period);
  if (!m || !m[1]) return null;
  const n = Number(m[1]);
  if (Number.isNaN(n)) return null;
  return n < 100 ? 2000 + n : n;
}

export function periodQuarter(period: string | null): number | null {
  if (!period) return null;
  const m = QUARTER_RE.exec(period);
  return m && m[1] ? Number(m[1]) : null;
}

const NUMBER_TOKEN =
  /(?:(₹|rs\.?|inr|\$|usd|us\$)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(%|percent|percentage points?|pp|x|trillion|tn|billion|bn|crore|cr|million|mn|lakh|lac|thousand|k)?/gi;

function splitSentences(text: string): Array<{ text: string; offset: number }> {
  const out: Array<{ text: string; offset: number }> = [];
  const re = /[^\n]*?(?:[.!?।](?=\s|$)|\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed) out.push({ text: trimmed, offset: m.index + lead });
  }
  return out;
}

const CURRENCY_MAP: Record<string, string> = {
  "₹": "INR",
  rs: "INR",
  "rs.": "INR",
  inr: "INR",
  $: "USD",
  usd: "USD",
  us$: "USD",
};

/**
 * Pull every checkable number out of one script section.
 *
 * `excludedRanges` carries absolute character spans (dates, fiscal periods,
 * SEC item numbers) that must never be treated as financial figures.
 */
export function extractNumericMentions(
  text: string,
  sectionKey: string | null,
  startIndex = 0,
  excludedRanges: ReadonlyArray<{ start: number; end: number }> = [],
): NumericMention[] {
  const out: NumericMention[] = [];
  let idx = startIndex;

  const excluded = (start: number, end: number) =>
    excludedRanges.some((r) => start < r.end && r.start < end);

  for (const { text: sentence, offset } of splitSentences(text)) {
    NUMBER_TOKEN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NUMBER_TOKEN.exec(sentence)) !== null) {
      const [raw, cur, num, suffix] = m;
      if (!num) continue;
      // Skip bare years like "2025" that are not a measurement.
      const plain = Number(num.replace(/,/g, ""));
      if (Number.isNaN(plain)) continue;

      // Offsets of the numeric literal itself, in the original text.
      const numOffsetInMatch = raw.indexOf(num);
      const charStart = offset + m.index + (numOffsetInMatch < 0 ? 0 : numOffsetInMatch);
      const charEnd = charStart + num.length;
      if (excluded(offset + m.index, offset + m.index + raw.length)) continue;

      const before = sentence.slice(Math.max(0, m.index - 90), m.index);
      const after = sentence.slice(m.index + raw.length, m.index + raw.length + 40);
      const window = `${before} ${raw} ${after}`;

      const suf = (suffix ?? "").toLowerCase();
      let kind: NumericKind = "count";
      let scale = 1;
      if (suf === "%" || suf === "percent") kind = "percent";
      else if (suf.startsWith("pp") || suf.startsWith("percentage point"))
        kind = "percentage_points";
      else if (suf === "x") kind = "multiple";
      else if (suf) {
        scale = detectScale(suf);
        kind = cur ? "currency" : "count";
      } else if (cur) kind = "currency";

      const isBareYear =
        !cur && !suffix && /^(19|20)\d{2}$/.test(num) && plain > 1900 && plain < 2100;
      if (isBareYear) {
        out.push({
          index: idx++,
          raw: raw.trim(),
          sentence,
          sectionKey,
          value: plain,
          kind: "date",
          currency: null,
          scale: 1,
          metric: "unknown",
          period: num,
          periodKind: "year",
          charStart,
          charEnd,
        });
        continue;
      }

      const currency = cur ? (CURRENCY_MAP[cur.toLowerCase()] ?? null) : null;
      const { period, kind: periodKind } = detectPeriod(window);

      out.push({
        index: idx++,
        raw: raw.trim(),
        sentence,
        sectionKey,
        value: plain * scale,
        kind,
        currency,
        scale,
        metric: detectMetric(before, after),
        period,
        periodKind,
        charStart,
        charEnd,
      });
    }
  }

  return out;
}

/** Relative difference between two numbers, guarding division by zero. */
export function relDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return Math.abs(a - b) === 0 ? 0 : 1;
  return Math.abs(a - b) / denom;
}

/** True when two values differ only by a decimal-scale factor (10M vs 10B). */
export function isScaleError(a: number, b: number): boolean {
  if (a === 0 || b === 0) return false;
  const ratio = Math.abs(a) / Math.abs(b);
  for (const f of [10, 100, 1000, 1e4, 1e5, 1e6, 1e7, 1e9]) {
    if (relDiff(ratio, f) < 0.02 || relDiff(ratio, 1 / f) < 0.02) return true;
  }
  return false;
}

export function metricsIncompatible(a: MetricFamily, b: MetricFamily): boolean {
  if (a === b || a === "unknown" || b === "unknown") return false;
  return INCOMPATIBLE_METRICS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
