/**
 * Deterministic temporal / token classification (client-safe, no AI).
 *
 * The numeric pre-check used to hand every digit it found to the financial
 * value matcher, so "July 22, 2026", "Q1 FY2026" and "Item 2.02" were compared
 * against revenue and EPS figures and blocked as unsupported numbers.
 *
 * This module classifies expressions BEFORE numeric validation so that
 * temporal and filing-item tokens are routed to their own validators, while
 * ordinary financial numbers keep going through the strict figure matcher.
 */

export const TOKEN_TYPES = [
  "FINANCIAL_NUMBER",
  "PERCENTAGE",
  "CURRENCY_VALUE",
  "MULTIPLE",
  "SHARE_COUNT",
  "DATE",
  "PARTIAL_DATE",
  "YEAR",
  "FISCAL_PERIOD",
  "QUARTER",
  "SEC_ITEM",
  "RANGE",
  "OTHER_NUMERIC",
] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

/** Token types that must NEVER go through the financial value matcher. */
export const NON_FINANCIAL_TOKEN_TYPES: readonly TokenType[] = [
  "DATE",
  "PARTIAL_DATE",
  "YEAR",
  "FISCAL_PERIOD",
  "QUARTER",
  "SEC_ITEM",
];

export type TemporalToken = {
  type: Extract<
    TokenType,
    "DATE" | "PARTIAL_DATE" | "YEAR" | "FISCAL_PERIOD" | "QUARTER" | "SEC_ITEM"
  >;
  raw: string;
  /** Character offsets into the text the token was extracted from. */
  start: number;
  end: number;
  month: number | null;
  day: number | null;
  year: number | null;
  fiscalYear: number | null;
  quarter: number | null;
  item: string | null;
  sentence: string;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** Ordered longest-first; earlier patterns win when spans overlap. */
const PATTERNS: Array<{ type: TemporalToken["type"]; re: RegExp }> = [
  // "Item 2.02", "Items 2.02 and 9.01"
  { type: "SEC_ITEM", re: /\bitems?\s+(\d{1,2}\.\d{2})\b/gi },
  { type: "SEC_ITEM", re: /(?<=\bitems?\s+\d{1,2}\.\d{2}\s+(?:and|&|,)\s*)(\d{1,2}\.\d{2})\b/gi },
  // ISO date
  { type: "DATE", re: /\b(\d{4})-(\d{2})-(\d{2})\b/g },
  // "22 July 2026" / "22 July"
  {
    type: "DATE",
    re: new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})\\.?(?:,?\\s*(\\d{4}))?\\b`,
      "gi",
    ),
  },
  // "July 22, 2026" / "July 22" / "July 2026"
  {
    type: "DATE",
    re: new RegExp(
      `\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`,
      "gi",
    ),
  },
  { type: "DATE", re: new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{4})\\b`, "gi") },
  // "Q1 FY2026", "Q1 FY26", "Q1 2026", "Q1"
  { type: "QUARTER", re: /\bQ([1-4])\s*(?:FY\s*)?'?(\d{2,4})?\b/gi },
  // "FY2026", "FY 26"
  { type: "FISCAL_PERIOD", re: /\bFY\s*'?(\d{2,4})\b/gi },
  // bare year, not preceded by a currency symbol
  { type: "YEAR", re: /(?<![$₹\d.,])\b(19|20)\d{2}\b(?!\s*(?:%|x\b))/g },
];

function fourDigitYear(v: string | undefined | null): number | null {
  if (!v) return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n < 100 ? 2000 + n : n;
}

function overlaps(a: { start: number; end: number }, list: TemporalToken[]): boolean {
  return list.some((t) => a.start < t.end && t.start < a.end);
}

export function sentenceAt(text: string, index: number): string {
  const before = text.lastIndexOf("\n", index);
  const start = Math.max(0, before + 1);
  const seg = text.slice(start);
  const m = /[.!?।\n]/.exec(seg.slice(index - start));
  const end = m ? index + m.index + 1 : Math.min(text.length, index + 200);
  return text.slice(start, end).trim();
}

/** Pull every temporal / filing-item expression out of a piece of text. */
export function extractTemporalTokens(text: string): TemporalToken[] {
  const found: TemporalToken[] = [];

  for (const { type, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (overlaps({ start, end }, found)) continue;

      const tok: TemporalToken = {
        type,
        raw: m[0],
        start,
        end,
        month: null,
        day: null,
        year: null,
        fiscalYear: null,
        quarter: null,
        item: null,
        sentence: sentenceAt(text, start),
      };

      if (type === "SEC_ITEM") {
        tok.item = m[1] ?? null;
      } else if (type === "DATE") {
        if (/^\d{4}-/.test(m[0])) {
          tok.year = Number(m[1]);
          tok.month = Number(m[2]);
          tok.day = Number(m[3]);
        } else if (MONTHS[(m[1] ?? "").toLowerCase().replace(/\.$/, "")] !== undefined) {
          // "July 22, 2026" or "July 2026"
          tok.month = MONTHS[(m[1] ?? "").toLowerCase().replace(/\.$/, "")]!;
          const second = m[2] ?? "";
          if (/^\d{4}$/.test(second) && m[3] === undefined) {
            tok.year = Number(second);
          } else {
            tok.day = Number(second);
            tok.year = m[3] ? Number(m[3]) : null;
          }
        } else {
          // "22 July 2026"
          tok.day = Number(m[1]);
          tok.month = MONTHS[(m[2] ?? "").toLowerCase().replace(/\.$/, "")] ?? null;
          tok.year = m[3] ? Number(m[3]) : null;
        }
        if (tok.day !== null && tok.year === null) tok.type = "PARTIAL_DATE";
      } else if (type === "QUARTER") {
        tok.quarter = Number(m[1]);
        tok.fiscalYear = fourDigitYear(m[2]);
        tok.year = tok.fiscalYear;
        tok.type = "FISCAL_PERIOD";
      } else if (type === "FISCAL_PERIOD") {
        tok.fiscalYear = fourDigitYear(m[1]);
        tok.year = tok.fiscalYear;
      } else if (type === "YEAR") {
        tok.year = Number(m[0]);
      }

      found.push(tok);
    }
  }

  return found.sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------------ validation

export const TEMPORAL_STATUSES = [
  "EXACT",
  "SUPPORTED_CONTEXTUAL",
  "CONFLICTING",
  "UNSUPPORTED",
] as const;
export type TemporalStatus = (typeof TEMPORAL_STATUSES)[number];

export type TemporalEvidence = {
  /** ISO yyyy-mm-dd dates found anywhere in the packet. */
  dates: Array<{ iso: string; label: string }>;
  years: number[];
  fiscalPeriods: Array<{ year: number | null; quarter: number | null; label: string }>;
  secItems: string[];
};

export const EMPTY_TEMPORAL_EVIDENCE: TemporalEvidence = {
  dates: [],
  years: [],
  fiscalPeriods: [],
  secItems: [],
};

export function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type TemporalFinding = {
  status: TemporalStatus;
  matched: string | null;
  issue: string | null;
};

export function validateTemporalToken(tok: TemporalToken, ev: TemporalEvidence): TemporalFinding {
  if (tok.type === "SEC_ITEM") {
    if (!tok.item)
      return {
        status: "UNSUPPORTED",
        matched: null,
        issue: "Filing item number could not be read.",
      };
    if (ev.secItems.includes(tok.item))
      return { status: "EXACT", matched: `Item ${tok.item}`, issue: null };
    if (ev.secItems.length) {
      return {
        status: "CONFLICTING",
        matched: ev.secItems.map((i) => `Item ${i}`).join(", "),
        issue: `The script says Item ${tok.item} but the parsed filing carries ${ev.secItems.map((i) => `Item ${i}`).join(", ")}.`,
      };
    }
    return {
      status: "UNSUPPORTED",
      matched: null,
      issue: `No parsed filing item numbers support Item ${tok.item}.`,
    };
  }

  if (tok.type === "FISCAL_PERIOD") {
    const fy = tok.fiscalYear;
    const q = tok.quarter;
    const pool = ev.fiscalPeriods;
    if (q !== null) {
      if (pool.some((p) => p.quarter === q && (fy === null || p.year === fy))) {
        return {
          status: fy === null ? "SUPPORTED_CONTEXTUAL" : "EXACT",
          matched: `Q${q}${fy ? ` FY${fy}` : ""}`,
          issue: null,
        };
      }
      const sameYear = pool.filter((p) => fy !== null && p.year === fy);
      if (sameYear.length) {
        return {
          status: "CONFLICTING",
          matched: sameYear.map((p) => p.label).join(", "),
          issue: `The script says Q${q} FY${fy} but the research holds ${sameYear.map((p) => p.label).join(", ")} for that year.`,
        };
      }
      return {
        status: "UNSUPPORTED",
        matched: null,
        issue: `No reporting period in the packet matches Q${q}${fy ? ` FY${fy}` : ""}.`,
      };
    }
    if (fy !== null) {
      if (pool.some((p) => p.year === fy) || ev.years.includes(fy)) {
        return { status: "EXACT", matched: `FY${fy}`, issue: null };
      }
      return {
        status: "UNSUPPORTED",
        matched: null,
        issue: `No reporting period in the packet matches FY${fy}.`,
      };
    }
    return { status: "SUPPORTED_CONTEXTUAL", matched: null, issue: null };
  }

  if (tok.type === "YEAR") {
    const y = tok.year!;
    if (ev.years.includes(y)) return { status: "EXACT", matched: String(y), issue: null };
    return {
      status: "UNSUPPORTED",
      matched: null,
      issue: `The year ${y} does not appear in the packet's evidence.`,
    };
  }

  // DATE / PARTIAL_DATE
  const month = tok.month;
  const day = tok.day;

  if (tok.type === "DATE" && day === null && month !== null && tok.year !== null) {
    // "July 2026" — month + year only.
    const hit = ev.dates.find((d) =>
      d.iso.startsWith(`${tok.year}-${String(month).padStart(2, "0")}`),
    );
    if (hit) return { status: "EXACT", matched: hit.label, issue: null };
    return { status: "UNSUPPORTED", matched: null, issue: `No evidence dated ${tok.raw}.` };
  }

  if (month === null || day === null) {
    return { status: "SUPPORTED_CONTEXTUAL", matched: null, issue: null };
  }

  const sameMonthDay = ev.dates.filter((d) => {
    const [, mm, dd] = d.iso.split("-");
    return Number(mm) === month && Number(dd) === day;
  });

  if (tok.type === "DATE") {
    const iso = isoOf(tok.year!, month, day);
    const exact = ev.dates.find((d) => d.iso === iso);
    if (exact) return { status: "EXACT", matched: exact.label, issue: null };
    if (sameMonthDay.length) {
      return {
        status: "CONFLICTING",
        matched: sameMonthDay.map((d) => d.iso).join(", "),
        issue: `The script says ${tok.raw} but the evidence carries ${sameMonthDay.map((d) => d.iso).join(", ")}.`,
      };
    }
    return { status: "UNSUPPORTED", matched: null, issue: `No evidence dated ${tok.raw}.` };
  }

  // PARTIAL_DATE — the year must be deterministically supplied by context.
  const years = Array.from(new Set(sameMonthDay.map((d) => Number(d.iso.slice(0, 4)))));
  if (years.length === 1) {
    return { status: "SUPPORTED_CONTEXTUAL", matched: isoOf(years[0]!, month, day), issue: null };
  }
  if (years.length > 1) {
    return {
      status: "UNSUPPORTED",
      matched: years.join(", "),
      issue: `"${tok.raw}" is ambiguous — the evidence carries this date in ${years.join(", ")}.`,
    };
  }

  // Not in the evidence directly: allow when the packet establishes exactly one
  // year for that month (e.g. the July 2026 filing window) — day-level detail
  // still has to survive the statement audit.
  const monthYears = Array.from(
    new Set(
      ev.dates
        .filter((d) => Number(d.iso.split("-")[1]) === month)
        .map((d) => Number(d.iso.slice(0, 4))),
    ),
  );
  if (monthYears.length === 1) {
    return {
      status: "SUPPORTED_CONTEXTUAL",
      matched: isoOf(monthYears[0]!, month, day),
      issue: null,
    };
  }
  return {
    status: "UNSUPPORTED",
    matched: null,
    issue: `No evidence establishes the date "${tok.raw}".`,
  };
}

/** Only conflicting or materially unsupported temporal tokens may block. */
export function temporalSeverity(
  tok: TemporalToken,
  status: TemporalStatus,
): "Blocking" | "Warning" | "Info" {
  if (status === "EXACT" || status === "SUPPORTED_CONTEXTUAL") return "Info";
  if (status === "CONFLICTING") return "Blocking";
  // UNSUPPORTED
  if (tok.type === "DATE" || tok.type === "FISCAL_PERIOD") return "Blocking";
  return "Warning";
}

/**
 * Spans that are neither financial figures nor validatable temporal facts —
 * SEC form names ("8-K", "10-Q"), so the "8" is never matched against revenue.
 */
const FORM_NAME =
  /\b(?:10-K\/A|10-Q\/A|8-K\/A|10-K|10-Q|8-K|6-K|20-F|40-F|S-1|S-3|13F|13D|13G|11-K|424B\d?)\b/gi;

export function extractNonNumericSpans(
  text: string,
): Array<{ start: number; end: number; raw: string }> {
  const out: Array<{ start: number; end: number; raw: string }> = [];
  FORM_NAME.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FORM_NAME.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  return out;
}
