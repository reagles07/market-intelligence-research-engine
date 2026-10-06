/**
 * Web research + source reconciliation (server only, Pass 1C).
 *
 * Two model calls per run:
 *   1. plan the searches from what the database is MISSING (no web access)
 *   2. run the searches with the web_search tool and return structured findings
 *
 * Everything that matters — URL identity, source tier, whether a claim may be
 * called verified, and whether a disagreement is a conflict — is decided in
 * this file, not by the model.
 */
import {
  DATABASE_MODE_RULES,
  buildResearchContext,
  contextMessage,
  type Db,
} from "@/lib/ai/context.server";
import { runBuildResearchPacket, AI_NOTE_PREFIX } from "@/lib/ai/research.server";
import { canBeCritical } from "@/lib/research/readiness";
import {
  MAX_QUERIES,
  MAX_SOURCES,
  searchPlanJsonSchema,
  searchPlanValidator,
  webResearchJsonSchema,
  webResearchValidator,
  type WebResearchOutput,
} from "@/lib/ai/web-schemas";
import {
  fallbackQueriesForInaccessible,
  inaccessibleSourceNote,
  isInaccessiblePrimary,
} from "@/lib/research/fact-sprint";
import {
  TIER_1,
  TIER_2,
  TIER_4,
  canonicalizeUrl,
  domainOfWebsite,
  tierForUrl,
} from "@/lib/ai/web-sources";
import {
  RAPID_STEPS,
  STORY_BASELINE_TOPICS,
  normalizeQuery,
  planRapidQueries,
  summarizeRapidPass,
  type RapidQuery,
  type RapidSourceClass,
  type RapidTopic,
} from "@/lib/research/rapid-fact-pass";
import { callStructured } from "@/lib/openai.server";

/** Bounded search budget for one Rapid Fact Pass. */
export const RAPID_SEARCH_BUDGET = 8;

export const WEB_NOTE_PREFIX = "[AI · web research]";

type RunArgs = {
  storyId?: string | null;
  companyId?: string | null;
  model?: string | null;
  userId: string;
  /** Build a new research packet version from the enriched context. */
  rebuildPacket?: boolean;
  /**
   * Rapid Fact Pass: seed the run with a deterministic, de-duplicated set of
   * targeted searches across official / filing / press / industry source
   * classes instead of one broad model-written query. Default ON.
   */
  rapidPass?: boolean;
};

const iso = (value: string | null): string | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Which Rapid Fact Pass topics the CURRENT database cannot answer. */
function detectRapidTopics(ctx: {
  bundle: Record<string, unknown>;
  counts: Record<string, number>;
  company: Record<string, unknown>;
  hasValuationInputs: boolean;
}): RapidTopic[] {
  const n = (k: string) => ctx.counts[k] ?? 0;
  const claims = n("claims");
  const topics: RapidTopic[] = [];
  const business = String(ctx.company["business_model"] ?? ctx.company["description"] ?? "").trim();
  if (business.length < 120) topics.push("business_model");
  if (n("events") === 0) topics.push("catalyst");
  if (n("financial_periods") === 0 && n("earnings_reports") === 0) topics.push("financials");
  if (claims < 8) topics.push("moat", "growth_drivers", "risks");
  if (claims < 4) topics.push("history");
  if (!ctx.hasValuationInputs) topics.push("valuation");
  // A company with nothing recorded still deserves the full story baseline.
  return topics.length ? topics : [...STORY_BASELINE_TOPICS];
}

/** Map a stored source tier onto a Rapid Fact Pass source class. */
function classForTier(tier: string): RapidSourceClass {
  if (tier === TIER_1) return "filing";
  if (tier === TIER_4) return "industry";
  return tier === TIER_2 ? "press" : "industry";
}

const domainOfUrl = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

export async function runResearchLatestNews(db: Db, args: RunArgs) {
  let companyId = args.companyId ?? null;
  const storyId = args.storyId ?? null;
  let storyTitle: string | null = null;

  if (storyId) {
    const { data: story } = await db
      .from("stories")
      .select("id,company_id,title")
      .eq("id", storyId)
      .maybeSingle();
    if (!story) throw new Error("Story not found");
    companyId = story.company_id;
    storyTitle = story.title;
  }
  if (!companyId) throw new Error("companyId or storyId is required");

  const ctx = await buildResearchContext(db, { companyId, storyId });
  const company = ctx.company as Record<string, unknown>;
  const ticker = String(company["ticker"] ?? "");
  const name = String(company["name"] ?? "");
  const country = String(company["country"] ?? "");
  const currency = String(company["currency"] ?? "USD");
  const companyDomain = domainOfWebsite(company["website"] as string | null);

  // ------------------------------------------------- 1. Rapid Fact Pass plan
  // Deterministic first stage: instead of one broad query, a small de-duplicated
  // ladder of DIFFERENT formulations across official / filing / press / industry
  // source classes, built from what the database is actually missing.
  const rapidEnabled = args.rapidPass ?? true;
  const rapidCompany = { name, ticker, market: country, domain: companyDomain };
  const rapidTopics: RapidTopic[] = rapidEnabled ? detectRapidTopics(ctx) : [];
  const rapidQueries: RapidQuery[] = rapidEnabled
    ? planRapidQueries({
        company: rapidCompany,
        topics: rapidTopics,
        maxQueries: RAPID_SEARCH_BUDGET,
        maxPerTopic: 2,
      })
    : [];

  const seenQueries = new Set(rapidQueries.map((q) => normalizeQuery(q.query)));
  const queries: Array<{ query: string; purpose: string }> = rapidQueries.map((q) => ({
    query: q.query,
    purpose: `${q.sourceClass} · ${q.purpose}`,
  }));

  // The model planner still runs when the deterministic ladder is thin (or the
  // rapid pass is switched off); when the ladder is already rich we skip that
  // call entirely, which is both cheaper and faster.
  let planFocus = rapidTopics.length
    ? `Close these open research topics with current, citable evidence: ${rapidTopics.join(", ")}.`
    : "Refresh the company's latest verified developments.";
  let planCostUsd = 0;

  if (!rapidEnabled || rapidQueries.length < 4) {
    const plan = await callStructured({
      operation: "plan-web-research",
      mode: "DATABASE",
      model: args.model ?? null,
      instructions: `${DATABASE_MODE_RULES}

TASK: you are about to run a web research pass. Using ONLY the supplied database
context, decide what is missing or stale and write at most ${MAX_QUERIES} search queries
that would close those gaps. Prefer queries that would surface primary sources
(regulator filings, exchange announcements, company press releases and investor
relations pages) and reputable financial press. Anchor each query to the company and,
where relevant, to the story and its date. Do not write queries about companies,
events or periods that the context does not mention.`,
      input: contextMessage(
        ctx,
        `Company: ${name} (${ticker}, ${country}). ${
          storyTitle
            ? `Story under research: "${storyTitle}".`
            : "No specific story — company-level refresh."
        } Context row counts: ${JSON.stringify(ctx.counts)}. Today is ${new Date().toISOString().slice(0, 10)}.`,
      ),
      schemaName: "search_plan",
      jsonSchema: searchPlanJsonSchema,
      validator: searchPlanValidator,
      webSearch: false,
      maxOutputTokens: 4000,
      refs: { companyId, storyId },
      userId: args.userId,
    });

    if (!plan.ok && !queries.length) {
      await logRun(db, {
        companyId,
        storyId,
        model: args.model ?? null,
        ok: false,
        error: plan.error,
        userId: args.userId,
      });
      return { ok: false as const, error: plan.error, needsHumanReview: plan.needsHumanReview };
    }

    if (plan.ok) {
      planCostUsd = plan.usage.estimatedCostUsd;
      planFocus = plan.data.focus || planFocus;
      // Never spend a search on a formulation the ladder already covers.
      for (const q of plan.data.queries) {
        const key = normalizeQuery(q.query);
        if (!key || seenQueries.has(key)) continue;
        seenQueries.add(key);
        queries.push({ query: q.query, purpose: q.purpose });
      }
    }
  }

  const searchBudget = Math.max(MAX_QUERIES, Math.min(RAPID_SEARCH_BUDGET, queries.length));

  // ---------------------------------------------------------------- 2. search
  const web = await callStructured({
    operation: "research-latest-news",
    mode: "WEB",
    model: args.model ?? null,
    instructions: `You are the web research desk of a professional stock research studio.

OPERATING MODE: WEB.
- Use the web_search tool. Run at most ${searchBudget} searches and report at most
  ${MAX_SOURCES} sources — the most useful ones, not the most numerous.
- The supplied searches are a deliberate LADDER across source classes: company/investor
  relations first, then exchange or regulator filings, then reputable financial press,
  then industry coverage. Work down the ladder and STOP for a topic as soon as you have
  either one primary document you actually read, or two independent credible sources.
- Do not repeat a search that returned the same page as an earlier one; vary the wording
  or the source class instead.
- If a primary PDF or filing will not open, do NOT give up on that fact: try the official
  HTML or results page, an exchange or mirrored copy of the same filing, or a reputable
  report that quotes the exact figure. Record honestly which one you actually read, and
  never state anything from a document you could not open.
- Only report a URL you actually opened through the tool. Never reconstruct a URL from
  memory, never cite a page you did not read, and never state a fact your training data
  supplied. If searches return nothing usable, say so with no_new_information = true.
- Source hierarchy, strongest first: (1) regulator, exchange and company primary
  documents, (2) reputable financial press, (3) financial data platforms, (4) social and
  forum posts. Social sources are discovery only and can never establish a fact.
- Categorise every finding honestly: a company statement is a COMPANY CLAIM, a broker
  view is an ANALYST VIEW, a press report is a NEWS REPORT, your own deduction is an
  INFERENCE, an unconfirmed report is a RUMOUR. Only use FACT for something a primary
  source states directly.
- Reconcile every finding against the supplied database context: does it confirm a
  supplied number, contradict it, add something new, or sit outside what the database
  covers? When it contradicts, give both values and where each came from. Never decide
  which one is right, and never average two values.
- ${country === "India" ? "Report Indian figures in INR" : "Report US figures in USD"}; never convert currencies.
- Recency: for the current catalyst prefer the last 7–30 days; for results prefer the
  latest reported period and its primary release; for business model, history, moat and
  turning points an older authoritative source is fine. Preserve every date exactly as
  published. Report a valuation figure only when a reliable source actually states it —
  never infer or compute a missing number.
- Ignore promotional content, price prediction pages and content farms.
Write plainly. No investment advice.`,
    input: [
      `Research ${name} (${ticker}, ${country}, reporting currency ${currency}).`,
      storyTitle ? `Story under research: "${storyTitle}".` : "",
      `Research focus: ${planFocus}`,
      rapidTopics.length ? `Open topics to close: ${rapidTopics.join(", ")}.` : "",
      "",
      "Run these searches, in this order (adapt wording if a search returns nothing):",
      ...queries.map((q, i) => `${i + 1}. ${q.query} — ${q.purpose}`),
      "",
      "Reconcile everything you find against this database context. Cite database metric",
      "keys or claim ids verbatim in database_reference when a finding relates to one.",
      "",
      contextMessage(ctx, "DATABASE CONTEXT FOR RECONCILIATION:"),
    ].join("\n"),
    schemaName: "web_research",
    jsonSchema: webResearchJsonSchema,
    validator: webResearchValidator,
    webSearch: true,
    maxOutputTokens: 20000,
    refs: { companyId, storyId },
    userId: args.userId,
  });

  if (!web.ok) {
    await logRun(db, {
      companyId,
      storyId,
      model: args.model ?? null,
      queries,
      ok: false,
      error: web.error,
      userId: args.userId,
    });
    return { ok: false as const, error: web.error, needsHumanReview: web.needsHumanReview };
  }

  // ---------------------------------------------------------------- 3-5. persist
  const persisted = await persistWebResearch(db, {
    companyId,
    storyId,
    currency,
    companyDomain,
    queryText: queries.map((q) => q.query).join(" | "),
    web,
    existingClaimTexts: new Set(
      (ctx.bundle["claims"] as Array<Record<string, unknown>>).map((c) =>
        String(c["claim_text"]).trim().toLowerCase(),
      ),
    ),
    userId: args.userId,
  });
  const {
    sourcesNew,
    sourcesDuplicate,
    unverifiableUrls,
    claimsAdded,
    conflicts,
    confirmations,
    analystViewsSaved,
  } = persisted;

  // ------------------------------------------------- 5b. source fallback pass
  // One bounded recovery attempt when the pass found official documents it
  // could not open and came back with nothing usable. Alternatives are tried
  // (official HTML, exchange/mirror copy, credible reporting of the same
  // filing); the unopened link stays recorded as an unread reference.
  let fallbackRun: Awaited<ReturnType<typeof runTargetedWebResearch>> | null = null;
  const blockedPrimaries = web.data.sources.filter((s) =>
    isInaccessiblePrimary({
      url: s.url,
      title: s.title,
      summary: s.summary,
      contentAccessible: true,
    }),
  );
  if (blockedPrimaries.length && (web.data.no_new_information || claimsAdded === 0)) {
    const fallbackQueries = blockedPrimaries
      .slice(0, 2)
      .flatMap((s) =>
        fallbackQueriesForInaccessible(
          { url: s.url, title: s.title, summary: s.summary, contentAccessible: false },
          { name, ticker, market: country, domain: companyDomain },
        ),
      )
      .slice(0, GAP_MAX_QUERIES);
    if (fallbackQueries.length) {
      fallbackRun = await runTargetedWebResearch(db, {
        companyId,
        storyId,
        queries: fallbackQueries,
        focus:
          "An official document could not be opened. Find an accessible official copy, an exchange filing page, or credible reporting of the same material fact. Never state anything from the unopened file.",
        evidenceType: "OTHER",
        model: args.model ?? null,
        userId: args.userId,
        allowFallback: false,
      });
    }
  }
  const fallbackStats =
    fallbackRun && fallbackRun.ok
      ? {
          sourcesNew: fallbackRun.persisted.sourcesNew,
          claimsAdded: fallbackRun.persisted.claimsAdded,
          conflicts: fallbackRun.persisted.conflicts,
          webSearchCalls: fallbackRun.usage.webSearchCalls,
          costUsd: fallbackRun.usage.estimatedCostUsd,
        }
      : null;

  // ---------------------------------------------------------------- 6. packet
  let packetId: string | null = null;
  let packetVersion: number | null = null;
  let packetError: string | null = null;

  if (args.rebuildPacket && storyId) {
    const built = await runBuildResearchPacket(db, {
      storyId,
      model: args.model ?? null,
      userId: args.userId,
      updateReason: `Web research update — ${web.data.delta_summary}`.slice(0, 1000),
    });
    if (built.ok) {
      packetId = built.packetId;
      packetVersion = built.version;
    } else {
      packetError = built.error;
    }
  }

  const runId = await logRun(db, {
    companyId,
    storyId,
    packetId,
    model: args.model ?? null,
    queries,
    stats: {
      sources_found: web.data.sources.length,
      sources_new: sourcesNew,
      sources_duplicate: sourcesDuplicate,
      claims_added: claimsAdded,
      conflicts,
      confirmations,
      analyst_views: analystViewsSaved,
      web_search_calls: web.usage.webSearchCalls,
      estimated_cost_usd: planCostUsd + web.usage.estimatedCostUsd,
    },
    delta: web.data.no_new_information
      ? "No new information found in this pass."
      : web.data.delta_summary,
    unresolved: web.data.unresolved_questions,
    ok: true,
    userId: args.userId,
  });

  // Creator-facing summary of what the pass actually checked. Every number is
  // counted from retrieved evidence — nothing here is estimated.
  const evidence = [
    ...web.data.sources.map((s) => ({
      url: canonicalizeUrl(s.url) || s.url,
      domain: domainOfUrl(s.url),
      sourceClass: classForTier(
        tierForUrl(canonicalizeUrl(s.url) || s.url, companyDomain, {
          modelTier: s.source_tier,
          sourceType: s.source_type,
        }),
      ),
      readable: !isInaccessiblePrimary({
        url: s.url,
        title: s.title,
        summary: s.summary,
        contentAccessible: true,
      }),
    })),
    ...(fallbackRun && fallbackRun.ok
      ? fallbackRun.result.sources.map((s) => ({
          url: canonicalizeUrl(s.url) || s.url,
          domain: domainOfUrl(s.url),
          sourceClass: classForTier(
            tierForUrl(canonicalizeUrl(s.url) || s.url, companyDomain, {
              modelTier: s.source_tier,
              sourceType: s.source_type,
            }),
          ),
          readable: true,
        }))
      : []),
  ];
  const rapidSummary = summarizeRapidPass({
    evidence,
    confirmations,
    conflicts: conflicts + (fallbackStats?.conflicts ?? 0),
    searches: web.usage.webSearchCalls + (fallbackStats?.webSearchCalls ?? 0),
    // Honest "still missing": the topics this run set out to close, kept only
    // when the pass came back with no readable evidence at all.
    unresolvedTopics: evidence.some((e) => e.readable) && claimsAdded > 0 ? [] : rapidTopics,
  });

  return {
    ok: true as const,
    runId,
    queries: queries.map((q) => q.query),
    sourcesFound: web.data.sources.length,
    sourcesNew: sourcesNew + (fallbackStats?.sourcesNew ?? 0),
    sourcesDuplicate,
    unverifiableUrls,
    claimsAdded: claimsAdded + (fallbackStats?.claimsAdded ?? 0),
    conflicts: conflicts + (fallbackStats?.conflicts ?? 0),
    confirmations,
    analystViews: analystViewsSaved,
    sourceFallbackUsed: Boolean(fallbackStats),
    inaccessiblePrimaries: persisted.inaccessiblePrimaries,
    managementStatements: web.data.management_statements.length,
    socialSignals: web.data.social_signals.length,
    unresolvedQuestions: web.data.unresolved_questions,
    deltaSummary: web.data.no_new_information
      ? "No new information found in this pass."
      : web.data.delta_summary,
    noNewInformation: web.data.no_new_information && !fallbackStats?.claimsAdded,
    packetId,
    packetVersion,
    packetError,
    webSearchCalls: web.usage.webSearchCalls + (fallbackStats?.webSearchCalls ?? 0),
    estimatedCostUsd: planCostUsd + web.usage.estimatedCostUsd + (fallbackStats?.costUsd ?? 0),
    aiNotePrefix: AI_NOTE_PREFIX,
    rapidPass: rapidEnabled,
    rapidTopics,
    rapidSteps: RAPID_STEPS.map((s) => s.label),
    summary: rapidSummary,
  };
}

async function logRun(
  db: Db,
  args: {
    companyId: string;
    storyId?: string | null;
    packetId?: string | null;
    model: string | null;
    queries?: Array<{ query: string; purpose: string }>;
    stats?: Record<string, number>;
    delta?: string;
    unresolved?: string[];
    ok: boolean;
    error?: string;
    userId: string;
  },
): Promise<string | null> {
  const { data } = await db
    .from("web_research_runs")
    .insert({
      company_id: args.companyId,
      story_id: args.storyId ?? null,
      packet_id: args.packetId ?? null,
      model: args.model,
      queries: args.queries ?? [],
      sources_found: args.stats?.["sources_found"] ?? 0,
      sources_new: args.stats?.["sources_new"] ?? 0,
      sources_duplicate: args.stats?.["sources_duplicate"] ?? 0,
      claims_added: args.stats?.["claims_added"] ?? 0,
      conflicts: args.stats?.["conflicts"] ?? 0,
      confirmations: args.stats?.["confirmations"] ?? 0,
      analyst_views: args.stats?.["analyst_views"] ?? 0,
      web_search_calls: args.stats?.["web_search_calls"] ?? 0,
      estimated_cost_usd: args.stats?.["estimated_cost_usd"] ?? 0,
      delta_summary: args.delta ?? null,
      unresolved_questions: args.unresolved ?? [],
      ok: args.ok,
      error: args.error ?? null,
      created_by: args.userId,
    })
    .select("id")
    .single();
  return data?.id ?? null;
}

// ---------------------------------------------------------------- persistence

type WebCallResult = {
  data: WebResearchOutput;
  citations: Array<{ url: string }>;
  usage: {
    webSearchCalls: number;
    estimatedCostUsd: number;
    inputTokens: number;
    outputTokens: number;
  };
};

export type PersistedWebResearch = Awaited<ReturnType<typeof persistWebResearch>>;

/**
 * Turn one web-research model reply into sources, claims and analyst views.
 *
 * Shared by the full company pass and by targeted research-gap recovery so
 * there is exactly one implementation of URL identity, tiering and the rules
 * that decide whether a finding may be called verified.
 */
export async function persistWebResearch(
  db: Db,
  args: {
    companyId: string;
    storyId: string | null;
    currency: string;
    companyDomain: string | null;
    queryText: string;
    web: WebCallResult;
    existingClaimTexts: Set<string>;
    userId: string;
    /** Extra note appended to every row written by this pass. */
    provenanceNote?: string | null;
  },
) {
  const { web, companyId, storyId, userId } = args;
  const citedUrls = new Set(web.citations.map((c) => canonicalizeUrl(c.url)).filter(Boolean));

  const { data: existingSources } = await db
    .from("sources")
    .select("id,url,canonical_url,source_tier")
    .eq("company_id", companyId)
    .limit(500);

  const byCanonical = new Map<string, { id: string; tier: string }>();
  for (const s of existingSources ?? []) {
    const key = s.canonical_url ?? canonicalizeUrl(s.url ?? "");
    if (key) byCanonical.set(key, { id: s.id, tier: s.source_tier });
  }

  const urlToSource = new Map<string, { id: string; tier: string }>();
  const createdSourceIds: string[] = [];
  const usedSourceIds = new Set<string>();
  const createdClaimIds: string[] = [];
  const tiersSeen: string[] = [];
  let sourcesNew = 0;
  let sourcesDuplicate = 0;
  let unverifiableUrls = 0;
  let inaccessiblePrimaries = 0;
  const inaccessibleSourceIds = new Set<string>();

  for (const s of web.data.sources.slice(0, MAX_SOURCES)) {
    const canonical = canonicalizeUrl(s.url);
    if (!canonical) continue;
    // A URL the search tool never returned cannot be trusted as read.
    if (citedUrls.size > 0 && !citedUrls.has(canonical)) unverifiableUrls += 1;

    // A document the tool could not open is kept as a reference link only —
    // its contents are never asserted, and never inferred from its title.
    const unreadable = isInaccessiblePrimary({
      url: s.url,
      title: s.title,
      summary: s.summary,
      contentAccessible: true,
    });
    if (unreadable) inaccessiblePrimaries += 1;

    const tier = tierForUrl(canonical, args.companyDomain, {
      modelTier: s.source_tier,
      sourceType: s.source_type,
    });
    tiersSeen.push(tier);
    const existing = byCanonical.get(canonical);
    if (existing) {
      sourcesDuplicate += 1;
      if (unreadable) inaccessibleSourceIds.add(existing.id);
      urlToSource.set(s.url, existing);
      urlToSource.set(canonical, existing);
      continue;
    }

    const { data: row } = await db
      .from("sources")
      .insert({
        company_id: companyId,
        story_id: storyId,
        title: s.title.slice(0, 300),
        url: s.url,
        canonical_url: canonical,
        publisher: s.publisher,
        source_type: s.source_type,
        source_tier: tier,
        published_at: iso(s.published_at),
        discovery_query: args.queryText.slice(0, 1000),
        discovered_via: "web-research",
        ai_summary: s.summary,
        notes: [
          `${WEB_NOTE_PREFIX} discovered by web search`,
          args.provenanceNote ?? null,
          s.is_paywalled ? "Paywalled — verify the full text before use." : null,
          s.source_tier !== tier ? `Model proposed ${s.source_tier}; app assigned ${tier}.` : null,
          unreadable
            ? inaccessibleSourceNote({
                url: s.url,
                title: s.title,
                summary: s.summary,
                contentAccessible: false,
              })
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
        created_by: userId,
      })
      .select("id")
      .single();

    if (row) {
      sourcesNew += 1;
      createdSourceIds.push(row.id);
      if (unreadable) inaccessibleSourceIds.add(row.id);
      const entry = { id: row.id, tier };
      byCanonical.set(canonical, entry);
      urlToSource.set(s.url, entry);
      urlToSource.set(canonical, entry);
    }
  }

  const resolve = (urls: string[]) => {
    const hits = urls
      .map((u) => urlToSource.get(u) ?? urlToSource.get(canonicalizeUrl(u) ?? ""))
      .filter((v): v is { id: string; tier: string } => Boolean(v));
    for (const h of hits) usedSourceIds.add(h.id);
    return hits;
  };

  const existingClaimTexts = args.existingClaimTexts;
  let claimsAdded = 0;
  let conflicts = 0;
  let confirmations = 0;

  const insertClaim = async (input: {
    text: string;
    category: string;
    value?: string | null;
    unit?: string | null;
    period?: string | null;
    supports: { id: string; tier: string }[];
    status: string;
    notes: string[];
    critical: boolean;
  }) => {
    const key = input.text.trim().toLowerCase();
    if (!key || existingClaimTexts.has(key)) return false;
    existingClaimTexts.add(key);
    const { data, error } = await db
      .from("claims")
      .insert({
        company_id: companyId,
        story_id: storyId,
        source_id: input.supports[0]?.id ?? null,
        claim_text: input.text,
        claim_category: input.category,
        value: input.value ?? null,
        unit: input.unit ?? null,
        reporting_period: input.period ?? null,
        verification_status: input.status,
        // Evidence-free findings are gap notes; they never become critical
        // claims (that would make research readiness unreachable).
        is_critical: input.supports.length > 0 && input.critical && canBeCritical(input.category),
        notes: [...input.notes, args.provenanceNote ?? ""].filter(Boolean).join("\n"),
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !data) return false;
    claimsAdded += 1;
    createdClaimIds.push(data.id);
    return true;
  };

  for (const f of web.data.findings) {
    const supports = resolve(f.source_urls);
    const hasTier1 = supports.some((s) => s.tier === TIER_1);
    const onlySocial = supports.length > 0 && supports.every((s) => s.tier === TIER_4);
    // Every supporting document was one we could not open: this is a gap note,
    // never evidence, whatever tier the host belongs to.
    const onlyUnreadable =
      supports.length > 0 && supports.every((s) => inaccessibleSourceIds.has(s.id));

    let status: string;
    let category = f.category;

    if (onlyUnreadable) {
      status = "Unsupported";
      category = "UNSUPPORTED";
    } else if (!supports.length) {
      status = "Unsupported";
      category = "UNSUPPORTED";
    } else if (f.reconciliation === "Conflicts with database") {
      status = "Conflicting";
    } else if (onlySocial) {
      status = "Unsupported";
      category = category === "FACT" ? "RUMOUR" : category;
    } else if (hasTier1 && f.reconciliation === "Confirms database" && f.category === "FACT") {
      status = "Verified";
    } else {
      status = "Needs Cross-Check";
    }

    if (f.reconciliation === "Confirms database") confirmations += 1;

    if (f.reconciliation === "Conflicts with database") {
      conflicts += 1;
      await db.from("provider_data_conflicts").insert({
        provider: "AI-WEB",
        company_id: companyId,
        entity: "claims",
        field: f.database_reference ?? "unknown",
        existing_value: "See database context",
        incoming_value: `${f.statement}${f.conflict_detail ? ` — ${f.conflict_detail}` : ""}`,
        resolution: "Kept existing value. Flagged for human review.",
        created_by: userId,
      });
    }

    await insertClaim({
      text: f.statement,
      category,
      value: f.value,
      unit: f.unit,
      period: f.reporting_period,
      supports,
      status,
      critical: f.materiality === "High" && !onlyUnreadable,
      notes: [
        `${WEB_NOTE_PREFIX} research-latest-news`,
        onlyUnreadable
          ? "Supporting document(s) could not be opened — contents NOT read. Recorded as an open gap."
          : "",
        `Reconciliation: ${f.reconciliation}`,
        f.database_reference ? `Database reference: ${f.database_reference}` : "",
        f.conflict_detail ? `Conflict: ${f.conflict_detail}` : "",
        `Materiality: ${f.materiality}`,
        `Retrieved at: ${new Date().toISOString()}`,
        `Sources: ${supports.length ? supports.map((s) => s.id).join(", ") : "none resolved"}`,
      ],
    });
  }

  let analystViewsSaved = 0;
  const analystViewIds: string[] = [];
  for (const v of web.data.analyst_views) {
    const supports = resolve(v.source_urls);
    const { data, error } = await db
      .from("analyst_views")
      .insert({
        company_id: companyId,
        story_id: storyId,
        source_id: supports[0]?.id ?? null,
        firm: v.firm,
        analyst: v.analyst,
        rating: v.rating,
        price_target: v.price_target,
        previous_price_target: v.previous_price_target,
        currency: v.currency ?? args.currency,
        view_date: v.view_date ? v.view_date.slice(0, 10) : null,
        rationale: `${v.rationale}\n\n${WEB_NOTE_PREFIX} An analyst view is an opinion, never a fact. Attribute it to ${v.firm} in any script.`,
        created_by: userId,
      })
      .select("id")
      .single();
    if (!error && data) {
      analystViewsSaved += 1;
      analystViewIds.push(data.id);
    }
  }

  for (const m of web.data.management_statements) {
    const supports = resolve(m.source_urls);
    await insertClaim({
      text: `${m.speaker}${m.role ? ` (${m.role})` : ""}: ${m.statement}`,
      category: "COMPANY CLAIM",
      supports,
      status: supports.length ? "Needs Cross-Check" : "Unsupported",
      critical: false,
      notes: [
        `${WEB_NOTE_PREFIX} management statement`,
        m.context ? `Context: ${m.context}` : "",
        "Must be attributed to the company or its management in any script.",
      ],
    });
  }

  for (const s of web.data.social_signals) {
    const supports = resolve(s.source_urls);
    await insertClaim({
      text: `${s.platform} chatter: ${s.observation}`,
      category: "RUMOUR",
      supports,
      status: "Unsupported",
      critical: false,
      notes: [
        `${WEB_NOTE_PREFIX} social signal — discovery only`,
        "Never usable as evidence. Requires a primary or reputable source before use.",
      ],
    });
  }

  return {
    sourcesNew,
    sourcesDuplicate,
    unverifiableUrls,
    inaccessiblePrimaries,
    inaccessibleSourceIds: [...inaccessibleSourceIds],
    claimsAdded,
    conflicts,
    confirmations,
    analystViewsSaved,
    analystViewIds,
    createdSourceIds,
    createdClaimIds,
    usedSourceIds: [...usedSourceIds],
    tiersSeen,
  };
}

// ---------------------------------------------------------------- targeted

export const GAP_MAX_QUERIES = 3;
export const GAP_MAX_SOURCES = 6;

/**
 * A narrowly scoped web pass for ONE research gap.
 *
 * It reuses the same search tool, the same tiering and the same persistence as
 * the full company pass — it only replaces the planning step with the queries
 * the gap already carries, and caps the run at three searches.
 */
type TargetedArgs = {
  companyId: string;
  storyId: string | null;
  queries: string[];
  focus: string;
  evidenceType: string;
  model?: string | null;
  userId: string;
  gapId?: string | null;
};

/** ONE bounded search pass. Never recurses; the fallback lives in the wrapper. */
async function runTargetedWebPass(db: Db, args: TargetedArgs) {
  const ctx = await buildResearchContext(db, { companyId: args.companyId, storyId: args.storyId });
  const company = ctx.company as Record<string, unknown>;
  const name = String(company["name"] ?? "");
  const ticker = String(company["ticker"] ?? "");
  const country = String(company["country"] ?? "");
  const currency = String(company["currency"] ?? "USD");
  const companyDomain = domainOfWebsite(company["website"] as string | null);
  const queries = args.queries.filter((q) => q.trim()).slice(0, GAP_MAX_QUERIES);
  if (!queries.length)
    return { ok: false as const, error: "No search queries were supplied for this gap." };

  const web = await callStructured({
    operation: "research-gap-recovery",
    mode: "WEB",
    model: args.model ?? null,
    instructions: `You are the web research desk of a professional stock research studio, closing ONE specific evidence gap.

OPERATING MODE: WEB.
- Use the web_search tool. Run at most ${GAP_MAX_QUERIES} searches and report at most
  ${GAP_MAX_SOURCES} sources. Stop as soon as you have adequate evidence.
- Only report a URL you actually opened through the tool. Never reconstruct a URL from
  memory, never cite a page you did not read, and never state a fact your training data
  supplied.
- If you cannot find reliable evidence, return no_new_information = true with empty
  arrays. NEVER invent a source, a URL or a number to make the gap closable.
- Source hierarchy, strongest first: (1) regulator, exchange and company primary
  documents, (2) reputable financial press, (3) financial data platforms, (4) social and
  forum posts. Social sources are discovery only.
- For management guidance prefer the earnings release, transcript or filing and report it
  as a COMPANY CLAIM. For analyst targets report an ANALYST VIEW with firm, analyst,
  rating, target, previous target and date — never as FACT. For a price, report the
  quoted value, the currency and the timestamp of the quote.
- ${country === "India" ? "Report Indian figures in INR" : "Report US figures in USD"}; never convert currencies.
Write plainly. No investment advice.`,
    input: [
      `Company: ${name} (${ticker}, ${country}, reporting currency ${currency}).`,
      `EVIDENCE GAP TYPE: ${args.evidenceType}`,
      `WHAT MUST BE ESTABLISHED: ${args.focus}`,
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      "",
      "Run only these searches (adapt wording if one returns nothing):",
      ...queries.map((q, i) => `${i + 1}. ${q}`),
      "",
      "Reconcile everything you find against this database context.",
      contextMessage(ctx, "DATABASE CONTEXT FOR RECONCILIATION:"),
    ].join("\n"),
    schemaName: "web_research",
    jsonSchema: webResearchJsonSchema,
    validator: webResearchValidator,
    webSearch: true,
    maxOutputTokens: 14000,
    refs: { companyId: args.companyId, storyId: args.storyId },
    userId: args.userId,
  });

  if (!web.ok) {
    await logRun(db, {
      companyId: args.companyId,
      storyId: args.storyId,
      model: args.model ?? null,
      queries: queries.map((q) => ({ query: q, purpose: args.focus })),
      ok: false,
      error: web.error,
      userId: args.userId,
    });
    return { ok: false as const, error: web.error };
  }

  const persisted = await persistWebResearch(db, {
    companyId: args.companyId,
    storyId: args.storyId,
    currency,
    companyDomain,
    queryText: queries.join(" | "),
    web,
    existingClaimTexts: new Set(
      (ctx.bundle["claims"] as Array<Record<string, unknown>>).map((c) =>
        String(c["claim_text"]).trim().toLowerCase(),
      ),
    ),
    userId: args.userId,
    provenanceNote: args.gapId
      ? `Research gap: ${args.gapId}`
      : "Script audit research gap recovery",
  });

  const runId = await logRun(db, {
    companyId: args.companyId,
    storyId: args.storyId,
    model: args.model ?? null,
    queries: queries.map((q) => ({ query: q, purpose: args.focus })),
    stats: {
      sources_found: web.data.sources.length,
      sources_new: persisted.sourcesNew,
      sources_duplicate: persisted.sourcesDuplicate,
      claims_added: persisted.claimsAdded,
      conflicts: persisted.conflicts,
      confirmations: persisted.confirmations,
      analyst_views: persisted.analystViewsSaved,
      web_search_calls: web.usage.webSearchCalls,
      estimated_cost_usd: web.usage.estimatedCostUsd,
    },
    delta: web.data.no_new_information
      ? "No new evidence found for this gap."
      : web.data.delta_summary,
    unresolved: web.data.unresolved_questions,
    ok: true,
    userId: args.userId,
  });

  return {
    ok: true as const,
    runId,
    queries,
    company: { name, ticker, market: country, domain: companyDomain },
    result: web.data,
    persisted,
    noNewInformation: web.data.no_new_information,
    sourcesFound: web.data.sources.length,
    usage: web.usage,
  };
}

/**
 * A narrowly scoped web pass for ONE research gap, with a bounded SOURCE
 * FALLBACK: when the pass finds a primary document it could not open and comes
 * back with nothing usable, it tries alternatives once — an official HTML or
 * press-release rendering, an exchange/mirror copy, or credible reporting of the
 * same filing. The unopened link stays recorded as an unread reference; nothing
 * is ever inferred from its title.
 */
export async function runTargetedWebResearch(
  db: Db,
  args: TargetedArgs & { allowFallback?: boolean },
) {
  const first = await runTargetedWebPass(db, args);
  if (!first.ok) return first;

  const nothingUsable = first.noNewInformation || first.persisted.claimsAdded === 0;
  const blocked = first.result.sources.filter((s) =>
    isInaccessiblePrimary({
      url: s.url,
      title: s.title,
      summary: s.summary,
      contentAccessible: true,
    }),
  );

  let fallback: Awaited<ReturnType<typeof runTargetedWebPass>> | null = null;
  if ((args.allowFallback ?? true) && nothingUsable && blocked.length) {
    const fallbackQueries = blocked
      .slice(0, 2)
      .flatMap((s) =>
        fallbackQueriesForInaccessible(
          { url: s.url, title: s.title, summary: s.summary, contentAccessible: false },
          first.company,
        ),
      )
      .slice(0, GAP_MAX_QUERIES);
    if (fallbackQueries.length) {
      fallback = await runTargetedWebPass(db, {
        ...args,
        queries: fallbackQueries,
        focus: `${args.focus} — the primary document could not be opened. Find an accessible official copy, an exchange/mirror filing page, or credible reporting of the same fact. Never state anything from the unopened file.`,
      });
    }
  }

  const fb = fallback && fallback.ok ? fallback : null;

  return {
    ...first,
    queries: fb ? [...first.queries, ...fb.queries] : first.queries,
    fallbackUsed: Boolean(fb),
    fallbackResult: fb ? fb.result : null,
    fallbackPersisted: fb ? fb.persisted : null,
    inaccessiblePrimaries:
      first.persisted.inaccessiblePrimaries + (fb?.persisted.inaccessiblePrimaries ?? 0),
    sourcesAdded:
      first.persisted.sourcesNew +
      first.persisted.sourcesDuplicate +
      (fb ? fb.persisted.sourcesNew + fb.persisted.sourcesDuplicate : 0),
    claimsAdded: first.persisted.claimsAdded + (fb?.persisted.claimsAdded ?? 0),
    conflicts: first.persisted.conflicts + (fb?.persisted.conflicts ?? 0),
    noNewInformation: first.noNewInformation && (!fb || fb.noNewInformation),
    sourcesFound: first.sourcesFound + (fb?.sourcesFound ?? 0),
    usage: {
      ...first.usage,
      webSearchCalls: first.usage.webSearchCalls + (fb?.usage.webSearchCalls ?? 0),
      estimatedCostUsd: first.usage.estimatedCostUsd + (fb?.usage.estimatedCostUsd ?? 0),
    },
  };
}
