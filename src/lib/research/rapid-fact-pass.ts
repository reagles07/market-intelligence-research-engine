/**
 * Rapid Fact Pass — deterministic multi-source query planning and
 * reconciliation rules (pure, browser-safe, no model call, no network).
 *
 * The system must not answer "data missing" while the fact is sitting on the
 * open web. Before a research question is declared unanswerable, a small,
 * bounded set of DIFFERENT targeted searches is issued across DIFFERENT source
 * classes — official/IR/filings first, then reputable financial press, then
 * industry coverage — de-duplicated so two formulations that would return the
 * same page are never both spent.
 *
 * Nothing here loosens factual integrity: it only decides WHICH searches to
 * run, WHEN a section already has enough evidence to stop, and HOW retrieved
 * evidence is graded. Grading still prefers primary sources, still requires two
 * independent credible sources when no primary exists, and still preserves a
 * conflict as a conflict.
 */

// ------------------------------------------------------------------ classes

export const RAPID_SOURCE_CLASSES = [
  "official", // company website / investor relations / newsroom
  "filing", // regulator + exchange documents (SEC, NSE/BSE, annual report)
  "press", // reputable financial press
  "industry", // trade / sector coverage, conference-call summaries, interviews
] as const;
export type RapidSourceClass = (typeof RAPID_SOURCE_CLASSES)[number];

/** Ranking used everywhere: primary beats strong secondary beats weak secondary. */
export const SOURCE_CLASS_RANK: Record<RapidSourceClass, number> = {
  official: 1,
  filing: 1,
  press: 2,
  industry: 3,
};

export const PRIMARY_CLASSES: readonly RapidSourceClass[] = ["official", "filing"];

// ------------------------------------------------------------------ topics

export const RAPID_TOPICS = [
  "catalyst",
  "financials",
  "business_model",
  "history",
  "moat",
  "growth_drivers",
  "risks",
  "valuation",
] as const;
export type RapidTopic = (typeof RAPID_TOPICS)[number];

export type RapidTopicSpec = {
  key: RapidTopic;
  label: string;
  /** How recent the evidence must be to count. */
  recency: "last_30_days" | "latest_reported_period" | "any_age";
  /** Only chased when the story actually needs it. */
  optional: boolean;
};

export const RAPID_TOPIC_SPECS: Record<RapidTopic, RapidTopicSpec> = {
  catalyst: {
    key: "catalyst",
    label: "Current catalyst / latest development",
    recency: "last_30_days",
    optional: false,
  },
  financials: {
    key: "financials",
    label: "Latest reported financials",
    recency: "latest_reported_period",
    optional: false,
  },
  business_model: {
    key: "business_model",
    label: "How the business makes money",
    recency: "any_age",
    optional: false,
  },
  history: {
    key: "history",
    label: "Origin, founder and turning points",
    recency: "any_age",
    optional: true,
  },
  moat: {
    key: "moat",
    label: "Competitive position",
    recency: "any_age",
    optional: false,
  },
  growth_drivers: {
    key: "growth_drivers",
    label: "Growth drivers and strategy",
    recency: "any_age",
    optional: false,
  },
  risks: {
    key: "risks",
    label: "Strongest risk / counterargument",
    recency: "any_age",
    optional: false,
  },
  valuation: {
    key: "valuation",
    label: "Valuation and market statistics",
    recency: "latest_reported_period",
    optional: true,
  },
};

/**
 * The story-quality baseline a long-form opening needs. Rapid Fact Pass chases
 * these before any deterministic storytelling precheck decides pass/block.
 */
export const STORY_BASELINE_TOPICS: readonly RapidTopic[] = [
  "history",
  "business_model",
  "catalyst",
  "financials",
  "growth_drivers",
  "risks",
  "moat",
];

// ------------------------------------------------------------------ planning

export type RapidCompany = {
  name: string;
  ticker: string;
  /** "India" or anything else (treated as US/other). */
  market: string;
  domain?: string | null;
};

export type RapidQuery = {
  query: string;
  topic: RapidTopic;
  sourceClass: RapidSourceClass;
  purpose: string;
};

/** Regulator/exchange wording for the filing rung of the ladder. */
export function filingAnchor(market: string): string {
  return market === "India"
    ? "NSE BSE exchange filing annual report results"
    : "SEC filing 10-K 10-Q 8-K press release";
}

/** Normalised form used for de-duplication: two formulations that are the same search. */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9: ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** Drop duplicate formulations, preserving the first (strongest) occurrence. */
export function dedupeQueries(queries: readonly RapidQuery[]): RapidQuery[] {
  const seen = new Set<string>();
  const out: RapidQuery[] = [];
  for (const q of queries) {
    const key = normalizeQuery(q.query);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

const yearNow = () => new Date().getFullYear();

/** One topic → up to four differently-formulated searches across source classes. */
export function topicQueries(company: RapidCompany, topic: RapidTopic): RapidQuery[] {
  const who = `${company.name} ${company.ticker}`.trim();
  const site = company.domain ? ` site:${company.domain}` : "";
  const year = yearNow();
  const anchor = filingAnchor(company.market);
  const make = (sourceClass: RapidSourceClass, query: string, purpose: string): RapidQuery => ({
    query,
    topic,
    sourceClass,
    purpose,
  });

  switch (topic) {
    case "catalyst":
      return [
        make(
          "official",
          `${who} newsroom press release ${year}${site}`,
          "Official statement of the latest development",
        ),
        make(
          "filing",
          `${who} ${anchor} ${year} announcement`,
          "Exchange/regulator record of the same event",
        ),
        make(
          "press",
          `${who} latest news ${year} what happened`,
          "Reputable reporting of the development",
        ),
        make(
          "industry",
          `${who} sector news ${year} impact analysis`,
          "Industry context for the development",
        ),
      ];
    case "financials":
      return [
        make(
          "official",
          `${who} quarterly results investor relations ${year}${site}`,
          "Primary earnings release",
        ),
        make(
          "filing",
          `${who} ${anchor} revenue profit margin`,
          "Filed statement of the reported period",
        ),
        make(
          "press",
          `${who} latest quarter results revenue profit ${year}`,
          "Press reporting of the same figures",
        ),
        make(
          "industry",
          `${who} earnings call summary ${year} management commentary`,
          "Call summary and guidance",
        ),
      ];
    case "business_model":
      return [
        make(
          "official",
          `${who} business segments revenue breakdown investor presentation${site}`,
          "Official segment disclosure",
        ),
        make(
          "filing",
          `${who} annual report business description segments`,
          "Filed business description",
        ),
        make(
          "press",
          `${who} how the company makes money explained`,
          "Plain-language reporting of the model",
        ),
        make("industry", `${who} industry business model analysis`, "Industry view of the model"),
      ];
    case "history":
      return [
        make(
          "official",
          `${who} company history milestones about us${site}`,
          "Official history page",
        ),
        make("press", `${who} founder story profile origin`, "Reported founding story"),
        make(
          "industry",
          `${who} turning point pivot acquisition history`,
          "Documented turning point",
        ),
      ];
    case "moat":
      return [
        make(
          "official",
          `${who} market share leadership annual report${site}`,
          "Company-disclosed position",
        ),
        make(
          "press",
          `${who} competitors market share comparison ${year}`,
          "Reported competitive position",
        ),
        make("industry", `${who} industry competitive landscape report`, "Sector landscape"),
      ];
    case "growth_drivers":
      return [
        make(
          "official",
          `${who} strategy expansion capex guidance${site}`,
          "Official strategy statement",
        ),
        make("press", `${who} growth drivers ${year} expansion plans`, "Reported growth drivers"),
        make("industry", `${who} sector growth outlook ${year}`, "Industry demand backdrop"),
      ];
    case "risks":
      return [
        make("filing", `${who} annual report risk factors`, "Filed risk factors"),
        make("press", `${who} risks concerns ${year} bear case`, "Reported counterargument"),
        make("industry", `${who} regulatory competitive pressure ${year}`, "Industry pressure"),
      ];
    case "valuation":
      return [
        make(
          "press",
          `${who} PE ratio EV EBITDA valuation ${year}`,
          "Reported valuation multiples",
        ),
        make("industry", `${who} peer valuation comparison ${year}`, "Peer comparison"),
      ];
    default:
      return [];
  }
}

export const RAPID_MAX_TOPICS = 6;
export const RAPID_MAX_QUERIES = 12;
export const RAPID_MAX_QUERIES_PER_TOPIC = 3;

/**
 * Build the bounded, de-duplicated query plan for one Rapid Fact Pass.
 * Non-optional topics come first; within a topic the primary rungs come first.
 */
export function planRapidQueries(args: {
  company: RapidCompany;
  topics: readonly RapidTopic[];
  maxTopics?: number;
  maxQueries?: number;
  maxPerTopic?: number;
  /** Searches already spent in this session — never repeat one. */
  alreadyRun?: readonly string[];
}): RapidQuery[] {
  const seen = new Set<RapidTopic>();
  const ordered = args.topics
    .filter((t) => Boolean(RAPID_TOPIC_SPECS[t]))
    .filter((t) => (seen.has(t) ? false : (seen.add(t), true)))
    .sort((a, b) => Number(RAPID_TOPIC_SPECS[a].optional) - Number(RAPID_TOPIC_SPECS[b].optional))
    .slice(0, args.maxTopics ?? RAPID_MAX_TOPICS);

  const spent = new Set((args.alreadyRun ?? []).map(normalizeQuery));
  const perTopic = args.maxPerTopic ?? RAPID_MAX_QUERIES_PER_TOPIC;

  const planned: RapidQuery[] = [];
  for (const topic of ordered) {
    const qs = dedupeQueries(topicQueries(args.company, topic))
      .sort((a, b) => SOURCE_CLASS_RANK[a.sourceClass] - SOURCE_CLASS_RANK[b.sourceClass])
      .filter((q) => !spent.has(normalizeQuery(q.query)))
      .slice(0, perTopic);
    planned.push(...qs);
  }
  return dedupeQueries(planned).slice(0, args.maxQueries ?? RAPID_MAX_QUERIES);
}

// ------------------------------------------------------------- sufficiency

export type RetrievedEvidence = {
  /** Canonical URL — identity for de-duplication. */
  url: string;
  domain: string;
  sourceClass: RapidSourceClass;
  /** False when the document could not actually be opened/read. */
  readable: boolean;
};

/** De-duplicate retrieved evidence by canonical URL, then keep domain diversity honest. */
export function dedupeEvidence(items: readonly RetrievedEvidence[]): RetrievedEvidence[] {
  const seen = new Set<string>();
  const out: RetrievedEvidence[] = [];
  for (const item of items) {
    const key = item.url.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export type SectionSufficiency = {
  enough: boolean;
  readableSources: number;
  primarySources: number;
  independentDomains: number;
  reason: string;
};

/**
 * Stop searching a section once it holds defensible evidence:
 *   one readable PRIMARY document, or two readable credible sources from
 *   DIFFERENT domains. Unreadable documents never count towards either.
 */
export function evaluateSectionSufficiency(
  evidence: readonly RetrievedEvidence[],
): SectionSufficiency {
  const readable = dedupeEvidence(evidence).filter((e) => e.readable);
  const primary = readable.filter((e) => PRIMARY_CLASSES.includes(e.sourceClass));
  const domains = new Set(readable.map((e) => e.domain.toLowerCase()));

  if (primary.length >= 1) {
    return {
      enough: true,
      readableSources: readable.length,
      primarySources: primary.length,
      independentDomains: domains.size,
      reason: "A primary company, exchange or regulator document was read.",
    };
  }
  if (domains.size >= 2) {
    return {
      enough: true,
      readableSources: readable.length,
      primarySources: 0,
      independentDomains: domains.size,
      reason: "Two independent credible sources report the same material.",
    };
  }
  return {
    enough: false,
    readableSources: readable.length,
    primarySources: 0,
    independentDomains: domains.size,
    reason: readable.length
      ? "Only a single secondary source so far — keep searching for a primary or a second independent source."
      : "No readable source retrieved yet.",
  };
}

// ------------------------------------------------------------ reconciliation

export type ReconciliationInput = {
  supports: readonly RetrievedEvidence[];
  /** A retrieved value that disagrees with an existing recorded value. */
  conflictsWithRecorded: boolean;
};

export type ReconciliationOutcome = {
  status: "Verified" | "Needs Cross-Check" | "Conflicting" | "Unsupported";
  note: string;
};

/**
 * Grade one material claim. Primary wins; two independent credible sources are
 * the fallback; a conflict is preserved as a conflict and never averaged away.
 */
export function reconcileMaterialClaim(input: ReconciliationInput): ReconciliationOutcome {
  const readable = dedupeEvidence(input.supports).filter((e) => e.readable);
  if (input.conflictsWithRecorded) {
    return {
      status: "Conflicting",
      note: "Sources disagree. Both values are kept with their provenance; neither is chosen and nothing is averaged.",
    };
  }
  if (!readable.length) {
    return {
      status: "Unsupported",
      note: "No readable source supports this. Recorded as an open gap, never as evidence.",
    };
  }
  if (readable.some((e) => PRIMARY_CLASSES.includes(e.sourceClass))) {
    return {
      status: "Verified",
      note: "Stated directly by a primary company, exchange or regulator document.",
    };
  }
  const domains = new Set(readable.map((e) => e.domain.toLowerCase()));
  if (domains.size >= 2) {
    return { status: "Verified", note: "Two independent credible sources report the same figure." };
  }
  return {
    status: "Needs Cross-Check",
    note: "Single secondary source — must stay attributed until a second independent source corroborates it.",
  };
}

// ------------------------------------------------------------- steps/summary

/** Honest stage labels. No percentage, no ETA — the UI pairs these with an elapsed timer. */
export const RAPID_STEPS = [
  { key: "plan", label: "Planning targeted searches" },
  { key: "filings", label: "Searching company filings" },
  { key: "news", label: "Checking recent news" },
  { key: "crosscheck", label: "Cross-checking numbers" },
  { key: "evidence", label: "Building evidence" },
] as const;
export type RapidStepKey = (typeof RAPID_STEPS)[number]["key"];

export type RapidPassSummary = {
  sourcesChecked: number;
  primarySources: number;
  independentConfirmations: number;
  conflicts: number;
  unreadableDocuments: number;
  searches: number;
  stillMissing: string[];
};

export function summarizeRapidPass(args: {
  evidence: readonly RetrievedEvidence[];
  confirmations: number;
  conflicts: number;
  searches: number;
  /** Topics whose sufficiency test still fails. */
  unresolvedTopics: readonly RapidTopic[];
}): RapidPassSummary {
  const unique = dedupeEvidence(args.evidence);
  const readable = unique.filter((e) => e.readable);
  return {
    sourcesChecked: unique.length,
    primarySources: readable.filter((e) => PRIMARY_CLASSES.includes(e.sourceClass)).length,
    independentConfirmations: Math.max(0, args.confirmations),
    conflicts: Math.max(0, args.conflicts),
    unreadableDocuments: unique.length - readable.length,
    searches: Math.max(0, args.searches),
    stillMissing: args.unresolvedTopics.map((t) => RAPID_TOPIC_SPECS[t]?.label ?? t),
  };
}

/**
 * "Insufficient data" is only an honest answer once targeted searching has
 * actually been attempted and still produced nothing defensible.
 */
export function insufficientDataIsHonest(args: {
  searchesRun: number;
  readableSourcesFound: number;
  sourceClassesTried: readonly RapidSourceClass[];
}): boolean {
  const classes = new Set(args.sourceClassesTried);
  return args.searchesRun >= 2 && classes.size >= 2 && args.readableSourcesFound === 0;
}
