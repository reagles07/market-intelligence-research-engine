/**
 * Phase 2A discovery orchestrator (server only).
 *
 * Market discovery → candidate collection → clustering → deterministic
 * pre-score → shortlist → light AI evaluation → ranked candidate queue.
 *
 * Nothing here promotes a candidate to a Story and nothing here performs deep
 * research. Discovery only answers "what is worth researching today?".
 */
import type { Db } from "@/lib/ai/context.server";
import { canonicalizeUrl } from "@/lib/ai/web-sources";
import { clusterSignals, type CandidateDraft, type RawSignal } from "@/lib/discovery/cluster";
import {
  COVERAGE_FULL,
  COVERAGE_PARTIAL,
  MAX_EVAL_CANDIDATES,
  MAX_INDIA_REQUESTS,
  MAX_US_WEB_QUERIES,
  US_COVERAGE_NOTE,
  type DiscoveryMarket,
} from "@/lib/discovery/domain";
import { applyEvaluation, bestTier, preScore, type ScoringContext } from "@/lib/discovery/scoring";
import { collectIndiaSignals } from "@/lib/discovery/india.server";
import { collectUsSignals } from "@/lib/discovery/us.server";
import { evaluateCandidates, type EvaluationInput } from "@/lib/discovery/evaluate.server";

export type DiscoveryRunResult = {
  runId: string;
  market: DiscoveryMarket;
  status: string;
  coverage: string;
  rawSignals: number;
  candidatesCreated: number;
  duplicatesMerged: number;
  shortlisted: number;
  evaluated: number;
  providerRequests: number;
  webSearchCalls: number;
  aiCalls: number;
  costUsd: number;
  errors: string[];
  notes: string | null;
};

const NOVELTY_WINDOW_DAYS = 30;

export async function loadDiscoverySettings(db: Db) {
  const { data } = await db.from("discovery_settings").select("*").limit(1).maybeSingle();
  if (data) return data;
  const { data: created } = await db
    .from("discovery_settings")
    .insert({ singleton: true })
    .select("*")
    .single();
  return created;
}

export async function runMarketDiscovery(args: {
  db: Db;
  userId: string;
  market: DiscoveryMarket;
  model?: string | null;
  overrideQuota?: boolean;
  /** Phase 2D-1: the scheduler passes per-execution budgets. */
  budgets?: { provider?: number; web?: number; evaluate?: number };
  runType?: string;
  /** Optional widened filing/event window for US discovery. */
  lookbackDays?: number | undefined;
}): Promise<DiscoveryRunResult> {
  const { db, userId, market } = args;
  const settings = await loadDiscoverySettings(db);

  const indiaBudget = args.budgets?.provider ?? settings?.max_india_requests ?? MAX_INDIA_REQUESTS;
  const usBudget = args.budgets?.web ?? settings?.max_us_web_queries ?? MAX_US_WEB_QUERIES;
  const evalBudget = args.budgets?.evaluate ?? settings?.max_eval_candidates ?? MAX_EVAL_CANDIDATES;
  const coverage = market === "US" ? COVERAGE_PARTIAL : COVERAGE_FULL;

  const { data: run, error: runError } = await db
    .from("discovery_runs")
    .insert({
      market,
      run_type: args.runType ?? "MANUAL",
      status: "RUNNING",
      coverage,
      provider_request_budget: market === "India" ? indiaBudget : 0,
      web_search_budget: market === "US" ? usBudget : 0,
      created_by: userId,
    })
    .select("id")
    .single();
  if (runError || !run) throw new Error(runError?.message ?? "Could not start a discovery run");

  const errors: string[] = [];
  let notes: string | null = market === "US" ? US_COVERAGE_NOTE : null;
  let providerRequests = 0;
  let providerEndpoints: unknown[] = [];
  let webQueries: string[] = [];
  let webSearchCalls = 0;
  let aiCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let signals: RawSignal[] = [];

  try {
    // ---------------------------------------------------------- universe context
    const { data: companyRows } = await db
      .from("companies")
      .select("id,name,ticker,exchange,country,market_cap,primary_index")
      .eq("is_active", true);

    const inMarket = (companyRows ?? []).filter((c) =>
      market === "India"
        ? /india/i.test(c.country ?? "")
        : /united states|^us$|usa/i.test(c.country ?? ""),
    );

    const { data: watchRows } = await db.from("watchlist_items").select("company_id");
    const watchlistCompanyIds = new Set((watchRows ?? []).map((w) => w.company_id));

    // ---------------------------------------------------------- collection
    if (market === "India") {
      const collected = await collectIndiaSignals({
        userId,
        runId: run.id,
        budget: indiaBudget,
        ...(args.overrideQuota === undefined ? {} : { override: args.overrideQuota }),
        companies: inMarket.map((c) => ({ id: c.id, name: c.name, ticker: c.ticker })),
      });
      signals = collected.signals;
      providerRequests = collected.requests;
      providerEndpoints = collected.endpoints;
      errors.push(...collected.errors);
      if (collected.quota) {
        notes = `IndianAPI quota after this run: ${collected.quota.used} used, ${collected.quota.remaining} remaining.`;
      }
    } else {
      const collected = await collectUsSignals({
        db,
        userId,
        runId: run.id,
        model: args.model ?? null,
        maxQueries: usBudget,
        lookbackDays: args.lookbackDays,
        companies: inMarket.map((c) => ({
          id: c.id,
          name: c.name,
          ticker: c.ticker,
          exchange: c.exchange,
        })),
        watchlistCompanyIds,
      });
      signals = collected.signals;
      webQueries = collected.webQueries;
      webSearchCalls = collected.webSearchCalls;
      aiCalls += collected.aiCalls;
      inputTokens += collected.inputTokens;
      outputTokens += collected.outputTokens;
      costUsd += collected.costUsd;
      errors.push(...collected.errors);
      notes = [US_COVERAGE_NOTE, collected.coverageNote].filter(Boolean).join(" ");
    }

    // ---------------------------------------------------------- clustering
    const { candidates: drafts, duplicatesMerged } = clusterSignals(signals);

    // ---------------------------------------------------------- scoring context
    const companyIds = [
      ...new Set(drafts.map((d) => d.companyId).filter((id): id is string => !!id)),
    ];
    const since = new Date(Date.now() - NOVELTY_WINDOW_DAYS * 86_400_000).toISOString();

    const [{ data: recentStories }, { data: recentScripts }, { data: allStories }] =
      await Promise.all([
        companyIds.length
          ? db
              .from("stories")
              .select("company_id,title,story_type,created_at")
              .in("company_id", companyIds)
              .gte("created_at", since)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
        companyIds.length
          ? db
              .from("scripts")
              .select("company_id,created_at")
              .in("company_id", companyIds)
              .gte("created_at", since)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
        companyIds.length
          ? db.from("stories").select("company_id").in("company_id", companyIds)
          : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      ]);

    const contextFor = (draft: CandidateDraft): ScoringContext => {
      const company = draft.companyId ? inMarket.find((c) => c.id === draft.companyId) : null;
      const stories = (
        (recentStories ?? []) as Array<{
          company_id: string;
          title: string;
          story_type: string | null;
          created_at: string;
        }>
      ).filter((s) => s.company_id === draft.companyId);
      return {
        knownCompany: !!company,
        marketCap: company?.market_cap ?? null,
        primaryIndex: company?.primary_index ?? null,
        onWatchlist: draft.companyId ? watchlistCompanyIds.has(draft.companyId) : false,
        existingStoryCount: ((allStories ?? []) as Array<{ company_id: string }>).filter(
          (s) => s.company_id === draft.companyId,
        ).length,
        recentStories: stories.map((s) => ({
          title: s.title,
          story_type: s.story_type,
          created_at: s.created_at,
        })),
        recentScriptCount: ((recentScripts ?? []) as Array<{ company_id: string }>).filter(
          (s) => s.company_id === draft.companyId,
        ).length,
      };
    };

    // ---------------------------------------------------------- persist candidates
    const persisted: Array<{
      id: string;
      draft: CandidateDraft;
      scored: ReturnType<typeof preScore>;
    }> = [];

    for (const draft of drafts) {
      const scored = preScore(draft, contextFor(draft));
      const { data: row, error } = await db
        .from("story_candidates")
        .insert({
          discovery_run_id: run.id,
          market,
          company_id: draft.companyId,
          company_name: draft.companyName,
          ticker: draft.ticker,
          exchange: draft.exchange,
          title: draft.title.slice(0, 300),
          primary_type: draft.primaryType,
          candidate_types: draft.candidateTypes,
          discovery_reason: draft.discoveryReason,
          catalyst: draft.catalyst,
          price_move_pct: draft.priceMovePct,
          price_move_source: draft.priceMoveSource,
          price_move_at: draft.priceMoveAt,
          reported_price_move_pct: draft.reportedPriceMovePct,
          volume: draft.volume,
          volume_ratio: draft.volumeRatio,
          activity_note: draft.activityNote,
          week52_event: draft.week52Event,
          headline: draft.headline,
          url: draft.url,
          event_at: draft.eventAt,
          provider_timestamp: draft.providerTimestamp,
          signal_count: draft.signalCount,
          signals: draft.signals as unknown as never,
          best_source_tier: bestTier(draft),
          coverage_flag: coverage,
          pre_score: scored.total,
          content_score: scored.total,
          score_coverage_pct: scored.coveragePct,
          priority_band: scored.band,
          status: "SCORED",
          cluster_key: draft.clusterKey,
          created_by: userId,
        })
        .select("id")
        .single();

      if (error || !row) {
        errors.push(`candidate "${draft.companyName}": ${error?.message ?? "insert failed"}`);
        continue;
      }

      await db.from("candidate_score_components").insert(
        scored.components.map((c) => ({
          candidate_id: row.id,
          component_key: c.key,
          label: c.label,
          max_points: c.max,
          points: c.points,
          available: c.available,
          reason: c.reason,
          value_text: c.valueText,
          stage: c.stage,
        })),
      );

      await db.from("candidate_sources").insert(
        draft.signals.map((s) => ({
          candidate_id: row.id,
          provider: s.provider,
          endpoint: s.endpoint,
          signal_type: s.signalType,
          url: s.url ?? null,
          canonical_url: s.url ? canonicalizeUrl(s.url) : null,
          title: s.headline ?? s.reason,
          publisher: s.publisher ?? s.provider,
          source_tier: s.sourceTier,
          source_type: s.sourceType,
          published_at: s.publishedAt ?? null,
          raw_response_id: s.rawResponseId ?? null,
          created_by: userId,
        })),
      );

      persisted.push({ id: row.id, draft, scored });
    }

    // ---------------------------------------------------------- Stage 2 evaluation
    const shortlist = [...persisted]
      .sort((a, b) => b.scored.total - a.scored.total)
      .slice(0, evalBudget);

    if (shortlist.length) {
      const inputs: EvaluationInput[] = shortlist.map((c, i) => ({
        ref: `C${i + 1}`,
        draft: c.draft,
        components: c.scored.components,
      }));
      const evaluation = await evaluateCandidates({
        market,
        model: args.model ?? null,
        userId,
        candidates: inputs,
      });
      aiCalls += evaluation.aiCalls;
      inputTokens += evaluation.inputTokens;
      outputTokens += evaluation.outputTokens;
      costUsd += evaluation.costUsd;
      if (!evaluation.ok && evaluation.error) errors.push(evaluation.error);

      // Models sometimes echo the ref as "REF C1" or "c1", so match loosely.
      const norm = (s: string) =>
        s
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .replace(/^REF/, "");
      for (const [index, item] of shortlist.entries()) {
        const ref = `C${index + 1}`;
        const found =
          evaluation.evaluations.find((e) => norm(e.ref) === ref) ??
          (evaluation.evaluations.length === shortlist.length
            ? evaluation.evaluations[index]
            : undefined);
        if (!found) {
          // No evaluation: the deterministic score stands, unadjusted.
          await db.from("story_candidates").update({ status: "SHORTLISTED" }).eq("id", item.id);
          continue;
        }
        const finalScore = applyEvaluation(item.scored.components, found);
        await db
          .from("story_candidates")
          .update({
            content_score: finalScore.total,
            score_coverage_pct: finalScore.coveragePct,
            priority_band: finalScore.band,
            ai_evaluated: true,
            suggested_angle: found.angle,
            suggested_hook: found.hook,
            core_question: found.coreQuestion,
            evaluation_notes: found.notes,
            status: "SHORTLISTED",
          })
          .eq("id", item.id);

        for (const c of finalScore.components) {
          await db
            .from("candidate_score_components")
            .update({ points: c.points, available: c.available, reason: c.reason, stage: c.stage })
            .eq("candidate_id", item.id)
            .eq("component_key", c.key);
        }
        item.scored = finalScore;
      }
    }

    // ---------------------------------------------------------- ranking
    const ranked = [...persisted].sort((a, b) => b.scored.total - a.scored.total);
    for (const [index, item] of ranked.entries()) {
      await db
        .from("story_candidates")
        .update({ score_rank: index + 1 })
        .eq("id", item.id);
    }

    const status = errors.length ? "PARTIAL" : "COMPLETED";
    await db
      .from("discovery_runs")
      .update({
        status,
        completed_at: new Date().toISOString(),
        provider_requests: providerRequests,
        provider_endpoints: providerEndpoints as unknown as never,
        web_search_queries: webQueries as unknown as never,
        web_search_calls: webSearchCalls,
        ai_calls: aiCalls,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: costUsd,
        raw_signals: signals.length,
        candidates_created: persisted.length,
        clustered_duplicates: duplicatesMerged,
        shortlisted: shortlist.length,
        evaluated: shortlist.filter((s) => s.scored.components.some((c) => c.stage === "AI"))
          .length,
        errors: errors as unknown as never,
        notes,
      })
      .eq("id", run.id);

    return {
      runId: run.id,
      market,
      status,
      coverage,
      rawSignals: signals.length,
      candidatesCreated: persisted.length,
      duplicatesMerged,
      shortlisted: shortlist.length,
      evaluated: shortlist.length,
      providerRequests,
      webSearchCalls,
      aiCalls,
      costUsd,
      errors,
      notes,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db
      .from("discovery_runs")
      .update({
        status: "FAILED",
        completed_at: new Date().toISOString(),
        errors: [...errors, message] as unknown as never,
        notes,
      })
      .eq("id", run.id);
    throw e;
  }
}
