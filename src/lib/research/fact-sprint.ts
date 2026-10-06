/**
 * Fast fact sprint — pure planning and reconciliation rules (browser-safe).
 *
 * The sprint is GAP-DRIVEN: it starts from what the packet is missing, builds a
 * bounded query ladder per gap (primary → reputable secondary → industry), and
 * decides deterministically what may count as evidence. Nothing here calls a
 * model, a provider or the network, so every rule below is testable.
 *
 * Factual standards do not move: an unopened PDF is never treated as read, a
 * conflict stays a conflict, and a gap only closes on evidence that was
 * actually retrieved.
 */

export const FACT_GAP_KEYS = [
  "business_model",
  "catalyst",
  "financials",
  "history",
  "moat",
  "valuation",
  "unverified_claims",
] as const;
export type FactGapKey = (typeof FACT_GAP_KEYS)[number];

export type FactGapCategory = {
  key: FactGapKey;
  label: string;
  /** What the sprint must establish, in creator language. */
  question: string;
  /** research_gaps.missing_evidence_type this maps onto. */
  evidenceType: string;
  /** Only chased when the intended story actually needs it. */
  optional: boolean;
};

export const FACT_GAP_CATEGORIES: Record<FactGapKey, FactGapCategory> = {
  business_model: {
    key: "business_model",
    label: "What the company does and how it makes money",
    question: "What does the company sell, who pays for it, and how does revenue actually arrive?",
    evidenceType: "OTHER",
    optional: false,
  },
  catalyst: {
    key: "catalyst",
    label: "Current catalyst / latest material development",
    question: "What is the most recent material development, with its date?",
    evidenceType: "EVENT",
    optional: false,
  },
  financials: {
    key: "financials",
    label: "Latest reported financials and key figures",
    question:
      "What are the latest reported revenue, profit and margin figures, and for which period?",
    evidenceType: "FINANCIAL_METRIC",
    optional: false,
  },
  history: {
    key: "history",
    label: "Historical turning point / founding story",
    question: "What documented turning point or founding fact shaped the business?",
    evidenceType: "OTHER",
    optional: true,
  },
  moat: {
    key: "moat",
    label: "Competitive position / moat evidence",
    question: "What evidence exists for the company's competitive position versus named peers?",
    evidenceType: "PEER_COMPARISON",
    optional: false,
  },
  valuation: {
    key: "valuation",
    label: "Valuation / market metrics",
    question: "What valuation multiples are currently reported, and as of when?",
    evidenceType: "FINANCIAL_METRIC",
    optional: true,
  },
  unverified_claims: {
    key: "unverified_claims",
    label: "Unverified dates, numbers and company-specific claims",
    question: "Which specific unverified figures or dates can a source settle?",
    evidenceType: "OTHER",
    optional: false,
  },
};

/**
 * Map a failed long-form readiness check onto the gap categories a fact sprint
 * can actually target. Anything unmapped is dropped rather than guessed.
 */
const READINESS_TO_GAPS: Record<string, FactGapKey[]> = {
  business: ["business_model"],
  catalyst: ["catalyst"],
  story_angle: ["history", "moat", "catalyst"],
  quantitative: ["financials"],
  verified_evidence: ["business_model", "catalyst", "unverified_claims"],
};

export function missingFactCategories(failedCheckKeys: readonly string[]): FactGapCategory[] {
  const keys: FactGapKey[] = [];
  for (const check of failedCheckKeys) {
    for (const k of READINESS_TO_GAPS[check] ?? []) if (!keys.includes(k)) keys.push(k);
  }
  return keys.map((k) => FACT_GAP_CATEGORIES[k]);
}

// ---------------------------------------------------------------- query ladder

export type CompanyRef = {
  name: string;
  ticker: string;
  market: string;
  /** Canonical company domain, when known (investor-relations lives there). */
  domain?: string | null;
};

/** Exchange/regulator anchor for the primary rung of the ladder. */
export function primaryAnchor(market: string): string {
  return market === "India"
    ? "NSE BSE exchange filing OR annual report"
    : "SEC filing OR 8-K OR press release";
}

/**
 * Three rungs, always in this order, always bounded:
 *   A primary (company IR / newsroom / filing),
 *   B reputable recent secondary (financial press, found by the search engine),
 *   C industry / trade coverage.
 * No single publication is hard-coded as truth: rungs B and C describe the
 * KIND of source wanted and let the search engine surface it.
 */
export function sourceLadderQueries(company: CompanyRef, gap: FactGapCategory): string[] {
  const who = `${company.name} ${company.ticker}`.trim();
  const site = company.domain ? ` site:${company.domain}` : "";
  const year = new Date().getFullYear();
  const ladder: Record<FactGapKey, string[]> = {
    business_model: [
      `${who} investor relations business segments revenue breakdown${site}`,
      `${who} how the company makes money segment revenue ${year}`,
      `${who} industry overview business model analysis`,
    ],
    catalyst: [
      `${who} press release ${primaryAnchor(company.market)} ${year}`,
      `${who} latest news ${year} material development`,
      `${who} sector news ${year} impact`,
    ],
    financials: [
      `${who} quarterly results ${year} revenue profit ${primaryAnchor(company.market)}`,
      `${who} latest quarterly earnings report revenue margin ${year}`,
      `${who} financial performance analysis ${year}`,
    ],
    history: [
      `${who} company history founding milestones${site}`,
      `${who} founder story turning point profile`,
      `${who} industry history expansion timeline`,
    ],
    moat: [
      `${who} market share competitive position annual report${site}`,
      `${who} competitors market share comparison ${year}`,
      `${who} industry competitive landscape report`,
    ],
    valuation: [
      `${who} valuation multiples PE EV EBITDA ${year}`,
      `${who} stock valuation analysis ${year}`,
      `${who} peer valuation comparison ${year}`,
    ],
    unverified_claims: [
      `${who} ${primaryAnchor(company.market)} disclosure ${year}`,
      `${who} report ${year} confirmation of figures`,
      `${who} trade press coverage ${year}`,
    ],
  };
  return ladder[gap.key];
}

export type PlannedFactGap = {
  key: FactGapKey;
  label: string;
  question: string;
  evidenceType: string;
  queries: string[];
};

export const FACT_SPRINT_MAX_GAPS = 5;
export const FACT_SPRINT_MAX_PASSES = 3;

/** Build the bounded gap plan for one sprint. Critical gaps come first. */
export function buildFactGapPlan(args: {
  company: CompanyRef;
  categories: readonly FactGapCategory[];
  /** Cap; the sprint must stay quick. */
  maxGaps?: number;
}): PlannedFactGap[] {
  const seen = new Set<FactGapKey>();
  const ordered = [...args.categories]
    .filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)))
    .sort((a, b) => Number(a.optional) - Number(b.optional));
  return ordered.slice(0, args.maxGaps ?? FACT_SPRINT_MAX_GAPS).map((c) => ({
    key: c.key,
    label: c.label,
    question: c.question,
    evidenceType: c.evidenceType,
    queries: sourceLadderQueries(args.company, c),
  }));
}

// ---------------------------------------------------------------- fallbacks

const INACCESSIBLE_MARKERS = [
  "could not open",
  "could not be opened",
  "failed to load",
  "too large",
  "file too large",
  "not accessible",
  "inaccessible",
  "unable to read",
  "unable to open",
  "download failed",
  "timed out",
  "403",
  "404",
];

export type RetrievedSource = {
  url: string;
  title: string;
  /** What the model says about the page; may report a retrieval failure. */
  summary: string;
  /** False when the tool could not actually open/read the document. */
  contentAccessible: boolean;
};

/** A PDF whose bytes were never read is a retrieval failure, not evidence. */
export function isInaccessiblePrimary(source: RetrievedSource): boolean {
  if (!source.contentAccessible) return true;
  const hay = `${source.summary}`.toLowerCase();
  return INACCESSIBLE_MARKERS.some((m) => hay.includes(m));
}

/**
 * When a primary document will not open we do NOT stop and we do NOT guess its
 * contents from the filename. We try, in order: an official HTML/press-release
 * rendering, an exchange/mirror copy, and finally the exact title/date so a
 * credible copy can corroborate the same material fact.
 */
export function fallbackQueriesForInaccessible(
  source: RetrievedSource,
  company: CompanyRef,
): string[] {
  const who = `${company.name} ${company.ticker}`.trim();
  const title = source.title.replace(/\.pdf$/i, "").trim();
  const site = company.domain ? ` site:${company.domain}` : "";
  return [
    `${who} ${title} press release HTML${site}`,
    `${who} ${title} ${primaryAnchor(company.market)} copy`,
    `"${title}" ${who} report coverage`,
  ];
}

/**
 * The permanent record for a document we could not read. The original link is
 * kept as a source and as a gap note; its contents are never asserted.
 */
export function inaccessibleSourceNote(source: RetrievedSource): string {
  return [
    "PRIMARY DOCUMENT NOT READ — the retrieval tool could not open this file.",
    `Kept as a reference link only: ${source.url}`,
    "No number, date or statement may be taken from this document until it is opened.",
  ].join(" ");
}

/**
 * Evidence status for a finding, given the sources that support it.
 * A finding whose every support was unreadable can never be verified.
 */
export function evidenceStatusForSupports(input: {
  supportCount: number;
  allSupportsInaccessible: boolean;
  hasPrimary: boolean;
  corroborations: number;
}): { status: string; critical: boolean; note: string } {
  if (input.supportCount === 0 || input.allSupportsInaccessible) {
    return {
      status: "Unsupported",
      critical: false,
      note: "No readable source supports this yet — recorded as an open gap, not as evidence.",
    };
  }
  if (input.hasPrimary) {
    return {
      status: "Verified",
      critical: true,
      note: "Stated directly by a primary company/regulator document.",
    };
  }
  if (input.corroborations >= 2) {
    return {
      status: "Verified",
      critical: true,
      note: "Two independent secondary sources report the same figure.",
    };
  }
  return {
    status: "Needs Cross-Check",
    critical: false,
    note: "Single secondary source — must be attributed until a second source corroborates it.",
  };
}

// ---------------------------------------------------------------- steps + summary

export const FACT_SPRINT_STEPS = [
  { key: "plan", label: "Planning missing facts" },
  { key: "primary", label: "Searching official sources" },
  { key: "secondary", label: "Checking recent news" },
  { key: "crosscheck", label: "Cross-checking numbers" },
  { key: "rebuild", label: "Rebuilding readiness" },
] as const;
export type FactSprintStepKey = (typeof FACT_SPRINT_STEPS)[number]["key"];

export type FactSprintPassResult = {
  gapKey: FactGapKey;
  filled: boolean;
  sourcesAdded: number;
  conflicts: number;
  searches: number;
  costUsd: number;
  inaccessiblePrimaries: number;
  latestSourceAt: string | null;
  note: string;
};

export type FactSprintSummary = {
  gapsTargeted: number;
  gapsFilled: number;
  gapsUnresolved: number;
  sourcesAdded: number;
  conflicts: number;
  searches: number;
  passes: number;
  costUsd: number;
  inaccessiblePrimaries: number;
  latestSourceAt: string | null;
  unresolvedGaps: FactGapKey[];
};

export function summarizeFactSprint(
  passes: readonly FactSprintPassResult[],
  passCount: number,
): FactSprintSummary {
  const byGap = new Map<FactGapKey, boolean>();
  let latest: string | null = null;
  for (const p of passes) {
    byGap.set(p.gapKey, (byGap.get(p.gapKey) ?? false) || p.filled);
    if (p.latestSourceAt && (!latest || p.latestSourceAt > latest)) latest = p.latestSourceAt;
  }
  const unresolved = [...byGap.entries()].filter(([, ok]) => !ok).map(([k]) => k);
  const sum = (pick: (p: FactSprintPassResult) => number) =>
    passes.reduce((acc, p) => acc + pick(p), 0);
  return {
    gapsTargeted: byGap.size,
    gapsFilled: byGap.size - unresolved.length,
    gapsUnresolved: unresolved.length,
    sourcesAdded: sum((p) => p.sourcesAdded),
    conflicts: sum((p) => p.conflicts),
    searches: sum((p) => p.searches),
    passes: passCount,
    costUsd: Number(sum((p) => p.costUsd).toFixed(4)),
    inaccessiblePrimaries: sum((p) => p.inaccessiblePrimaries),
    latestSourceAt: latest,
    unresolvedGaps: unresolved,
  };
}

/** Stop early once every non-optional gap is filled — speed is a feature. */
export function shouldRunAnotherPass(args: {
  pass: number;
  remainingCriticalGaps: number;
  maxPasses?: number;
}): boolean {
  const max = args.maxPasses ?? FACT_SPRINT_MAX_PASSES;
  if (args.pass >= max) return false;
  return args.remainingCriticalGaps > 0;
}
