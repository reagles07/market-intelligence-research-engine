/**
 * Phase 2D-2 — autonomous research + content pipeline (server only).
 *
 * This module orchestrates ONLY components that were already validated:
 *   discovery (2A) → qualification → auto-promotion → research orchestrator
 *   (2B) → readiness gate → content orchestrator (2C) → ready for review.
 *
 * It never researches, writes, repairs or publishes anything itself, it never
 * schedules anything (the Phase 2D-1 controller owns scheduling), and it stops
 * before spending when a cap, reserve or budget share would be breached.
 * Nothing here publishes: the terminal state is always human review.
 */
import type { Db } from "@/lib/ai/context.server";
import { promoteCandidateToStory } from "@/lib/discovery/promote.server";
import type { PipelineOutcome, PipelineStage } from "@/lib/automation/domain";

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

export type PipelineInput = {
  db: Db;
  userId: string;
  market: "India" | "US";
  marketDate: string;
  executionType: "MAIN_DISCOVERY" | "LATE_DELTA";
  trigger: string;
  dryRun: boolean;
  discoveryRunId: string | null;
  executionId?: string | null;
  dailyRunId?: string | null;
  model?: string | null;
  /** Manual runs may bypass the autonomous toggle for a single execution. */
  force?: boolean;
  /**
   * Restrict the pass to specific candidates (acceptance runs and targeted
   * manual passes). Qualification floors still apply — this only narrows the
   * pool, it never admits a candidate that would otherwise fail.
   */
  candidateIds?: string[] | null;
};

export type PipelineResult = {
  pipelineRunId: string | null;
  status: "COMPLETE" | "COMPLETE_WITH_WARNINGS" | "SKIPPED" | "PLANNED" | "FAILED";
  skipReason: string | null;
  considered: number;
  qualified: number;
  promoted: number;
  researched: number;
  researchReady: number;
  contentRuns: number;
  readyForReview: number;
  needsAttention: number;
  aiCalls: number;
  costUsd: number;
  budgetUsd: number;
  warnings: string[];
  errors: string[];
};

async function costSince(db: Db, iso: string) {
  const { data } = await db.from("ai_requests").select("estimated_cost_usd").gte("created_at", iso);
  const rows = data ?? [];
  return { calls: rows.length, cost: rows.reduce((a, r) => a + num(r["estimated_cost_usd"]), 0) };
}

async function notify(
  db: Db,
  input: {
    kind: string;
    severity?: string;
    title: string;
    body?: string;
    market: string;
    dailyRunId?: string | null;
  },
) {
  await db.from("run_notifications").insert({
    kind: input.kind,
    severity: input.severity ?? "INFO",
    title: input.title,
    body: input.body ?? null,
    market: input.market,
    daily_run_id: input.dailyRunId ?? null,
  });
}

/**
 * Candidates the pipeline is allowed to act on: discovered in this run, not
 * already promoted, and above BOTH the score and the score-coverage floor.
 * A high score computed from thin data is not a qualification.
 */
async function qualifyCandidates(
  db: Db,
  args: {
    discoveryRunId: string | null;
    market: string;
    minScore: number;
    minCoverage: number;
    candidateIds?: string[] | null;
  },
) {
  let query = db
    .from("story_candidates")
    .select("id,company_name,ticker,title,content_score,score_coverage_pct,status,story_id,market")
    .eq("market", args.market)
    .is("story_id", null)
    .order("content_score", { ascending: false })
    .limit(50);
  if (args.candidateIds?.length) query = query.in("id", args.candidateIds);
  else if (args.discoveryRunId) query = query.eq("discovery_run_id", args.discoveryRunId);
  const { data } = await query;
  const all = data ?? [];
  // Anything discovery left in the queue is fair game; promoted and dismissed
  // candidates are already decided.
  const open = all.filter(
    (c) => !["PROMOTED_TO_STORY", "DISMISSED", "MERGED"].includes(String(c.status)),
  );
  const qualified = open.filter(
    (c) => num(c.content_score) >= args.minScore && num(c.score_coverage_pct) >= args.minCoverage,
  );
  return { considered: all.length, qualified };
}

export async function runAutonomousPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { db, userId, market, marketDate, dryRun } = input;
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  const errors: string[] = [];

  const { loadAutomationSettings } = await import("@/lib/schedule/controller.server");
  const settings = await loadAutomationSettings(db);

  const empty = (
    status: PipelineResult["status"],
    skipReason: string | null,
    pipelineRunId: string | null = null,
  ): PipelineResult => ({
    pipelineRunId,
    status,
    skipReason,
    considered: 0,
    qualified: 0,
    promoted: 0,
    researched: 0,
    researchReady: 0,
    contentRuns: 0,
    readyForReview: 0,
    needsAttention: 0,
    aiCalls: 0,
    costUsd: 0,
    budgetUsd: 0,
    warnings,
    errors,
  });

  // The autonomous pipeline is a separate switch from scheduling. Off means
  // discovery still runs, and nothing downstream is touched, at zero cost.
  if (!settings.autonomous_enabled && !input.force) {
    return empty("SKIPPED", "Autonomous research + content is off");
  }

  const isDelta = input.executionType === "LATE_DELTA";
  const minScore = num(
    market === "India" ? settings.min_content_score_india : settings.min_content_score_us,
  );
  const minCoverage = num(
    market === "India" ? settings.min_score_coverage_india : settings.min_score_coverage_us,
  );
  const maxResearch = Math.max(
    0,
    Number(isDelta ? settings.max_research_delta : settings.max_research_main),
  );
  const maxContent = Math.max(
    0,
    Number(isDelta ? settings.max_content_delta : settings.max_content_main),
  );

  // Manual work keeps whatever share of the daily cap automation may not use.
  const dailyCap = num(settings.ai_daily_cost_cap_usd);
  const sharePct = Math.min(100, Math.max(0, num(settings.autonomous_ai_budget_percent)));
  const budgetUsd = dailyCap > 0 ? (dailyCap * sharePct) / 100 : 0;
  const dayStart = new Date(Date.now() - 24 * 3600_000).toISOString();
  const spentBefore = (await costSince(db, dayStart)).cost;

  const { considered, qualified } = await qualifyCandidates(db, {
    discoveryRunId: input.discoveryRunId,
    market,
    minScore,
    minCoverage,
    candidateIds: input.candidateIds ?? null,
  });
  const selected = qualified.slice(0, maxResearch);

  const plan = {
    minScore,
    minCoverage,
    maxResearch,
    maxContent,
    budgetUsd,
    spentBefore,
    dailyCap,
    sharePct,
    shortDuration: String(settings.autonomous_short_duration ?? "short_60"),
    longEnabled: Boolean(settings.autonomous_long_enabled),
    longMinScore: num(settings.autonomous_long_min_score),
  };

  const { data: runRow, error: runError } = await db
    .from("automation_pipeline_runs")
    .insert({
      execution_id: input.executionId ?? null,
      daily_run_id: input.dailyRunId ?? null,
      discovery_run_id: input.discoveryRunId,
      market,
      market_date: marketDate,
      execution_type: input.executionType,
      trigger: input.trigger,
      dry_run: dryRun,
      status: dryRun ? "PLANNED" : "RUNNING",
      candidates_considered: considered,
      candidates_qualified: qualified.length,
      autonomous_budget_usd: budgetUsd,
      plan: plan as never,
      created_by: userId,
    })
    .select("id")
    .single();
  if (runError || !runRow)
    throw new Error(runError?.message ?? "Could not create the pipeline run");
  const pipelineRunId = String(runRow.id);

  // Every selected candidate gets a lineage row before any spend happens.
  const items: Array<{
    id: string;
    candidate: Awaited<ReturnType<typeof qualifyCandidates>>["qualified"][number];
  }> = [];
  for (let i = 0; i < selected.length; i += 1) {
    const c = selected[i]!;
    const { data: item } = await db
      .from("automation_pipeline_items")
      .insert({
        pipeline_run_id: pipelineRunId,
        candidate_id: String(c.id),
        market,
        company_name: String(c.company_name ?? ""),
        ticker: c.ticker ?? null,
        title: String(c.title ?? ""),
        content_score: num(c.content_score),
        score_coverage_pct: num(c.score_coverage_pct),
        rank_index: i + 1,
        stage: "QUALIFIED" as PipelineStage,
        outcome: "PENDING" as PipelineOutcome,
      })
      .select("id")
      .single();
    if (item) items.push({ id: String(item.id), candidate: c });
  }

  const totals = {
    promoted: 0,
    researched: 0,
    researchReady: 0,
    contentRuns: 0,
    readyForReview: 0,
    needsAttention: 0,
  };

  const finalize = async (
    status: PipelineResult["status"],
    skipReason: string | null,
  ): Promise<PipelineResult> => {
    const spend = await costSince(db, startedAt);
    await db
      .from("automation_pipeline_runs")
      .update({
        status,
        skip_reason: skipReason,
        stories_promoted: totals.promoted,
        research_runs: totals.researched,
        research_ready: totals.researchReady,
        content_runs: totals.contentRuns,
        ready_for_review: totals.readyForReview,
        needs_attention: totals.needsAttention,
        ai_calls: spend.calls,
        estimated_cost_usd: spend.cost,
        warnings: warnings as never,
        errors: errors as never,
        completed_at: new Date().toISOString(),
      })
      .eq("id", pipelineRunId);
    return {
      pipelineRunId,
      status,
      skipReason,
      considered,
      qualified: qualified.length,
      ...totals,
      aiCalls: spend.calls,
      costUsd: spend.cost,
      budgetUsd,
      warnings,
      errors,
    };
  };

  // Dry run previews the decision only — no promotion, no research, no spend.
  if (dryRun) {
    return await finalize("PLANNED", "Dry run — nothing was promoted, researched or written.");
  }

  if (!selected.length) {
    return await finalize(
      "COMPLETE",
      `No candidate met score ≥ ${minScore} with coverage ≥ ${minCoverage}%.`,
    );
  }

  const budgetLeft = async () => {
    if (budgetUsd <= 0) return true;
    const spentNow = (await costSince(db, dayStart)).cost;
    return spentNow < budgetUsd;
  };

  let contentUsed = 0;
  let stoppedForBudget = false;

  for (const item of items) {
    const patch = async (fields: Record<string, unknown>) => {
      await db
        .from("automation_pipeline_items")
        .update(fields as never)
        .eq("id", item.id);
    };

    if (stoppedForBudget) {
      await patch({
        outcome: "SKIPPED_BUDGET",
        skip_reason: "Autonomous AI budget exhausted",
        completed_at: new Date().toISOString(),
      });
      continue;
    }
    if (!(await budgetLeft())) {
      stoppedForBudget = true;
      warnings.push(
        `Autonomous AI budget share ($${budgetUsd.toFixed(2)}) reached — remaining stories were left untouched.`,
      );
      await notify(db, {
        kind: "AI_BUDGET",
        severity: "WARNING",
        title: "Autonomous pipeline stopped on budget",
        body: `The autonomous share of the daily AI cap was reached before ${item.candidate.company_name}.`,
        market,
        dailyRunId: input.dailyRunId ?? null,
      });
      await patch({
        outcome: "SKIPPED_BUDGET",
        skip_reason: "Autonomous AI budget exhausted",
        completed_at: new Date().toISOString(),
      });
      continue;
    }

    const itemStart = new Date().toISOString();
    try {
      // 1 — auto-promotion (lineage recorded on the story itself)
      const promoted = await promoteCandidateToStory(db, {
        candidateId: String(item.candidate.id),
        userId,
        promotionSource: "AUTOMATION",
        pipelineRunId,
      });
      if (promoted.created) totals.promoted += 1;
      await patch({ story_id: promoted.storyId, stage: "PROMOTED" as PipelineStage });

      // 2 — research orchestration (Phase 2B, unchanged)
      await patch({ stage: "RESEARCH" as PipelineStage });
      const { runResearchOrchestration } = await import("@/lib/research/orchestrator.server");
      const research = await runResearchOrchestration(db, {
        storyId: promoted.storyId,
        userId,
        model: input.model ?? null,
        triggerSource: "AUTOMATION",
      });
      totals.researched += 1;
      const readiness = String(research?.readiness ?? research?.status ?? "");
      await patch({
        research_run_id: research?.runId ?? null,
        research_readiness: readiness,
        stage: "RESEARCH_DONE" as PipelineStage,
      });

      if (readiness !== "READY_FOR_CONTENT") {
        totals.needsAttention += 1;
        const spend = await costSince(db, itemStart);
        await patch({
          outcome: "RESEARCH_NOT_READY" as PipelineOutcome,
          skip_reason: String(
            research?.readiness_reason ?? "Research did not reach the content gate.",
          ),
          stage: "DONE" as PipelineStage,
          ai_calls: spend.calls,
          estimated_cost_usd: spend.cost,
          completed_at: new Date().toISOString(),
        });
        continue;
      }
      totals.researchReady += 1;

      // 3 — content generation, capped separately from research
      if (contentUsed >= maxContent) {
        const spend = await costSince(db, itemStart);
        await patch({
          outcome: "SKIPPED_CAP" as PipelineOutcome,
          skip_reason: `Content cap of ${maxContent} per run reached — research is stored and ready.`,
          stage: "DONE" as PipelineStage,
          ai_calls: spend.calls,
          estimated_cost_usd: spend.cost,
          completed_at: new Date().toISOString(),
        });
        continue;
      }
      if (!(await budgetLeft())) {
        stoppedForBudget = true;
        const spend = await costSince(db, itemStart);
        await patch({
          outcome: "SKIPPED_BUDGET" as PipelineOutcome,
          skip_reason: "Autonomous AI budget exhausted before content generation.",
          stage: "DONE" as PipelineStage,
          ai_calls: spend.calls,
          estimated_cost_usd: spend.cost,
          completed_at: new Date().toISOString(),
        });
        continue;
      }

      await patch({ stage: "CONTENT" as PipelineStage });
      const { runContentOrchestration } = await import("@/lib/content/orchestrator.server");
      const wantsLong = plan.longEnabled && num(item.candidate.content_score) >= plan.longMinScore;
      const content = await runContentOrchestration(db, {
        storyId: promoted.storyId,
        userId,
        formats: {
          short: plan.shortDuration as never,
          long: wantsLong ? ("deep_dive" as never) : null,
        },
        allowRepair: true,
        resolveGaps: true,
        triggerSource: "AUTOMATION",
      });
      contentUsed += 1;
      totals.contentRuns += 1;

      const contentReadiness = String(content?.readiness ?? "FAILED");
      const outcome: PipelineOutcome =
        contentReadiness === "READY_FOR_REVIEW"
          ? "READY_FOR_REVIEW"
          : contentReadiness === "RESEARCH_REQUIRED"
            ? "RESEARCH_REQUIRED"
            : contentReadiness === "NEEDS_FACT_CHECK"
              ? "NEEDS_FACT_CHECK"
              : "FAILED";
      if (outcome === "READY_FOR_REVIEW") totals.readyForReview += 1;
      else totals.needsAttention += 1;

      const spend = await costSince(db, itemStart);
      await patch({
        content_run_id: content?.runId ?? null,
        content_readiness: contentReadiness,
        outcome,
        stage: "DONE" as PipelineStage,
        skip_reason: outcome === "READY_FOR_REVIEW" ? null : String(content?.reason ?? ""),
        ai_calls: spend.calls,
        estimated_cost_usd: spend.cost,
        detail: {
          longScriptId: content?.longScriptId ?? null,
          shortScriptIds: content?.shortScriptIds ?? [],
          wordCounts: content?.wordCounts ?? null,
          auditSummary: content?.auditSummary ?? null,
        } as never,
        completed_at: new Date().toISOString(),
      });

      if (outcome === "READY_FOR_REVIEW") {
        await notify(db, {
          kind: "CONTENT_READY",
          title: `${item.candidate.company_name} — script ready for review`,
          body: `${item.candidate.title} passed research, fact audit and the readiness gate. Nothing was published.`,
          market,
          dailyRunId: input.dailyRunId ?? null,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(`${item.candidate.company_name}: ${message}`);
      totals.needsAttention += 1;
      await patch({
        outcome: "FAILED" as PipelineOutcome,
        skip_reason: message,
        stage: "DONE" as PipelineStage,
        completed_at: new Date().toISOString(),
      });
    }
  }

  return await finalize(
    errors.length || warnings.length ? "COMPLETE_WITH_WARNINGS" : "COMPLETE",
    null,
  );
}
