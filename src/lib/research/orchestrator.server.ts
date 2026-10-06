import type { Row, TableName } from "@/lib/data-types";
/**
 * Phase 2B — Selected Story Research Orchestrator (server only).
 *
 * The orchestrator does NOT invent research. It sequences the engines built in
 * Phase 1 (provider sync → database analysis → verification → packet → web
 * research → reconciliation → final packet → scenarios) in the correct order
 * for ONE selected story, records every step, respects budgets, skips fresh
 * data, and finishes with a readiness verdict.
 */
import {
  DEFAULT_RESEARCH_BUDGETS,
  ORCHESTRATION_STEPS,
  STEP_LABELS,
  type ResearchBudgets,
  type StepKey,
  type StepStatus,
} from "@/lib/research/domain";
import { buildDataPlan, type PlannedDataset } from "@/lib/research/plan";
import { checkFreshness } from "@/lib/research/freshness.server";
import { isClaimTraceable } from "@/lib/research/traceability";
import {
  evaluateReadiness,
  isClaimSupported,
  summarizeClaims,
  type CatalystStatus,
} from "@/lib/research/readiness";

import type { Db } from "@/lib/ai/context.server";

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

export async function loadBudgets(db: Db): Promise<ResearchBudgets> {
  const { data } = await db
    .from("research_orchestration_settings")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1);
  const row = (data ?? [])[0];
  if (!row) return { ...DEFAULT_RESEARCH_BUDGETS };
  return {
    indiaMaxCompanyCalls: row.india_max_company_calls,
    webMaxQueries: row.web_max_queries,
    maxPacketBuilds: row.max_packet_builds,
    maxScenarioRuns: row.max_scenario_runs,
    marketDataMaxAgeHours: row.market_data_max_age_hours,
    secMaxAgeDays: row.sec_max_age_days,
    financialsMaxAgeDays: row.financials_max_age_days,
    batchMaxStories: row.batch_max_stories,
    indianApiQuotaReserve: row.indianapi_quota_reserve,
  };
}

// ------------------------------------------------------------------ step log

class StepLog {
  constructor(
    private db: Db,
    private runId: string,
  ) {}

  async seed() {
    const rows = ORCHESTRATION_STEPS.map((s, i) => ({
      run_id: this.runId,
      step_key: s.key,
      step_index: i,
      label: s.label,
      status: "PENDING",
    }));
    await this.db.from("research_orchestration_steps").insert(rows);
  }

  async start(key: StepKey) {
    await this.db
      .from("research_orchestration_runs")
      .update({ current_step: key, status: "RUNNING" })
      .eq("id", this.runId);
    await this.db
      .from("research_orchestration_steps")
      .update({ status: "RUNNING", started_at: new Date().toISOString() })
      .eq("run_id", this.runId)
      .eq("step_key", key);
  }

  async finish(
    key: StepKey,
    status: StepStatus,
    detail: string,
    metrics: Record<string, unknown> = {},
    error: string | null = null,
  ) {
    await this.db
      .from("research_orchestration_steps")
      .update({
        status,
        detail,
        metrics: metrics as never,
        error,
        completed_at: new Date().toISOString(),
      })
      .eq("run_id", this.runId)
      .eq("step_key", key);
  }
}

// --------------------------------------------------------------- India extras

const INDIA_ENDPOINT: Record<string, string> = {
  announcements: "/recent_announcements",
  corporate_actions: "/corporate_actions",
  historical_stats: "/historical_stats",
};

async function fetchIndiaExtra(args: {
  dataset: string;
  companyId: string;
  companyName: string;
  userId: string;
}) {
  const { callIndianApi, storeRawResponse } = await import("@/lib/indianapi.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const endpoint = INDIA_ENDPOINT[args.dataset]!;
  const ingestionRunId = crypto.randomUUID();

  const res = await callIndianApi({
    endpoint,
    params: { stock_name: args.companyName },
    ingestionRunId,
    userId: args.userId,
  });
  if (!res.ok) return { ok: false as const, error: res.error ?? "request failed" };

  const rawId = await storeRawResponse({
    endpoint,
    query: `stock_name=${args.companyName}`,
    payload: res.data,
    requestId: res.requestId,
    ingestionRunId,
    userId: args.userId,
  });

  await supabaseAdmin.from("provider_stock_data").insert({
    company_id: args.companyId,
    provider: "IndianAPI",
    endpoint,
    company_searched: args.companyName,
    data_mode: "LIVE_PROVIDER",
    mapped: {} as never,
    unmapped: (res.data ?? {}) as never,
    retrieved_at: new Date().toISOString(),
    ingestion_run_id: ingestionRunId,
    raw_response_id: rawId,
    created_by: args.userId,
  });

  return { ok: true as const, error: null };
}

// ------------------------------------------------- packet material-change gate

/** Latest research packet for a story, or null. */
async function latestPacket(db: Db, storyId: string) {
  const { data } = await db
    .from("research_packets")
    .select("id,version_number,created_at")
    .eq("story_id", storyId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data
    ? {
        id: String(data.id),
        version: num(data["version_number"]),
        createdAt: String(data.created_at),
      }
    : null;
}

/**
 * Decide whether the evidence changed SEMANTICALLY since a packet was built.
 * Timestamp-only churn (a verification pass that reaches the same conclusion,
 * a re-read source, a metadata refresh) never justifies a new version.
 */
async function packetDeltaSince(
  db: Db,
  args: { storyId: string; companyId: string; packet: { id: string; createdAt: string } | null },
) {
  const { buildEvidenceSnapshot, computePacketDelta, readPacketSnapshot } =
    await import("@/lib/research/material.server");
  const { snapshot, touchedAt } = await buildEvidenceSnapshot(db, {
    storyId: args.storyId,
    companyId: args.companyId,
    packetId: args.packet?.id ?? null,
  });

  if (!args.packet) {
    return {
      material: true,
      detail: "no packet on file",
      counts: null as Record<string, number> | null,
      snapshot,
    };
  }

  const previous = await readPacketSnapshot(db, args.packet.id);
  if (!previous) {
    // Legacy packet with no snapshot: fall back to genuinely NEW rows
    // (created_at), never to updated_at churn, then adopt a snapshot.
    const [c, s] = await Promise.all([
      db
        .from("claims")
        .select("id")
        .eq("story_id", args.storyId)
        .gt("created_at", args.packet.createdAt),
      db
        .from("sources")
        .select("id")
        .eq("company_id", args.companyId)
        .gt("created_at", args.packet.createdAt),
    ]);
    const added = (c.data ?? []).length + (s.data ?? []).length;
    return {
      material: added > 0,
      detail: added
        ? `${added} evidence row(s) created since v-current (no snapshot baseline)`
        : "no new evidence since the packet was built (snapshot baseline adopted)",
      counts: null,
      snapshot,
    };
  }

  const delta = computePacketDelta({
    previous,
    current: snapshot,
    touchedAt,
    since: args.packet.createdAt,
  });
  return { material: delta.material, detail: delta.detail, counts: delta.counts, snapshot };
}

/** Persist the evidence snapshot a packet was built from. */
async function snapshotPacket(
  db: Db,
  args: { storyId: string; companyId: string; packetId: string },
) {
  const { buildEvidenceSnapshot, writePacketSnapshot } =
    await import("@/lib/research/material.server");
  const { snapshot } = await buildEvidenceSnapshot(db, {
    storyId: args.storyId,
    companyId: args.companyId,
    packetId: args.packetId,
  });
  await writePacketSnapshot(db, args.packetId, snapshot);
  return snapshot;
}

// ------------------------------------------------------------------ readiness

async function gatherReadiness(
  db: Db,
  args: { storyId: string; companyId: string; packetId: string | null; scenarioExpected: boolean },
) {
  const { data: claims } = await db
    .from("claims")
    .select(
      "id,claim_category,verification_status,is_critical,source_id,confidence,evidence_type,evidence_metric_keys,financial_period_id,sec_fact_id,sec_filing_id,evidence_provider,evidence_accession,evidence_period,evidence_detail",
    )
    .eq("story_id", args.storyId);
  const list = claims ?? [];

  const counted = summarizeClaims(list as never);
  const critical = list.filter((c) => c["is_critical"]);
  const supported = (c: Record<string, unknown>) => isClaimSupported(c as never);

  const { data: sources } = await db
    .from("sources")
    .select("id,source_tier")
    .eq("company_id", args.companyId);
  const sList = sources ?? [];
  const tier = (n: number) =>
    sList.filter((s) =>
      String(s["source_tier"] ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .startsWith(`tier ${n}`),
    ).length;

  const { data: conflicts } = await db
    .from("provider_data_conflicts")
    .select("id,resolution,field")
    .eq("company_id", args.companyId)
    .is("resolution", null);

  let packet: Pick<Row<"research_packets">, "id" | "completion_pct" | "verification_score"> | null =
    null;
  if (args.packetId) {
    const { data } = await db
      .from("research_packets")
      .select("id,completion_pct,verification_score")
      .eq("id", args.packetId)
      .maybeSingle();
    packet = data ?? null;
  }

  let scenarioComplete = false;
  if (args.packetId) {
    const { data: sc } = await db
      .from("scenario_forecasts")
      .select("id")
      .eq("packet_id", args.packetId);
    scenarioComplete = (sc ?? []).length >= 3;
  }

  const catalystClaim = critical.find((c) => supported(c)) ?? list.find((c) => supported(c));
  const catalyst: CatalystStatus = !catalystClaim
    ? "MISSING"
    : catalystClaim["verification_status"] === "Verified"
      ? "VERIFIED"
      : "ATTRIBUTED";

  return evaluateReadiness({
    catalyst,
    criticalClaimsTotal: critical.length,
    criticalClaimsSupported: critical.filter(supported).length,
    coreUnsupportedClaims: critical.filter(
      (c) => c["verification_status"] === "Unsupported" || c["verification_status"] === "Rejected",
    ).length,
    claims: counted,
    criticalConflicts: (conflicts ?? []).length,
    sources: {
      total: sList.length,
      tier1: tier(1),
      tier2: tier(2),
      tier3: tier(3),
      tier4: tier(4),
    },
    packetExists: Boolean(packet),
    scenarioExpected: args.scenarioExpected,
    scenarioComplete,
    completionPct: num(packet?.["completion_pct"]),
    verificationScore: num(packet?.["verification_score"]),
    // Traceability accepts more than one valid evidence path: a direct source,
    // or structured metric evidence with complete provenance.
    traceabilityIntact: list.every((c) => !supported(c) || isClaimTraceable(c as never).traceable),
  });
}

// ---------------------------------------------------------------- main runner

export async function runResearchOrchestration(
  db: Db,
  args: {
    storyId: string;
    userId: string;
    model?: string | null;
    triggerSource?: string;
    forceRefresh?: boolean;
  },
) {
  const budgets = await loadBudgets(db);
  const startedAt = new Date().toISOString();

  const { data: story } = await db
    .from("stories")
    .select("id,company_id,title,story_type,primary_catalyst,companies(id,name,ticker,country)")
    .eq("id", args.storyId)
    .maybeSingle();
  if (!story) throw new Error("Story not found");

  const company = story.companies;
  const market = String(company?.["country"] ?? "");

  const { data: priorRuns } = await db
    .from("research_orchestration_runs")
    .select("id")
    .eq("story_id", args.storyId)
    .limit(1);

  const { data: runRow } = await db
    .from("research_orchestration_runs")
    .insert({
      story_id: args.storyId,
      company_id: story.company_id,
      market,
      trigger_source: args.triggerSource ?? "MANUAL",
      status: "RUNNING",
      is_rerun: (priorRuns ?? []).length > 0,
      started_at: startedAt,
      created_by: args.userId,
    })
    .select("id")
    .single();

  if (!runRow) throw new Error("Failed to create orchestration run");
  const runId = runRow.id;
  const log = new StepLog(db, runId);
  await log.seed();

  const warnings: string[] = [];
  const errors: string[] = [];
  let coverageFlag: string | null = null;
  let packetBuilds = 0;
  let webSearches = 0;
  const deltaReport: Record<string, unknown> = {};
  let packetStart: { id: string; version: number } | null = null;
  let packetFinal: { id: string; version: number } | null = null;

  const cancelled = async () => {
    const { data } = await db
      .from("research_orchestration_runs")
      .select("status")
      .eq("id", runId)
      .maybeSingle();
    return data?.status === "CANCELLED";
  };

  const finalize = async (
    status: string,
    extra: {
      readiness?: string;
      readiness_reason?: string;
      readiness_summary?: import("@/integrations/supabase/types").Json;
      packet_start_id?: string | null;
      packet_start_version?: number | null;
      packet_final_id?: string | null;
      packet_final_version?: number | null;
      delta?: import("@/integrations/supabase/types").Json;
    } = {},
  ) => {
    const { data: aiRows } = await db
      .from("ai_requests")
      .select("input_tokens,output_tokens,estimated_cost_usd,web_search_calls")
      .eq("story_id", args.storyId)
      .gte("created_at", startedAt);
    const ai = aiRows ?? [];

    const { data: provRows } = await db
      .from("provider_requests")
      .select("provider")
      .gte("created_at", startedAt);
    const prov = provRows ?? [];

    await db
      .from("research_orchestration_runs")
      .update({
        status,
        current_step: null,
        completed_at: new Date().toISOString(),
        ai_calls: ai.length,
        input_tokens: ai.reduce((a, r) => a + num(r["input_tokens"]), 0),
        output_tokens: ai.reduce((a, r) => a + num(r["output_tokens"]), 0),
        estimated_cost_usd: ai.reduce((a, r) => a + num(r["estimated_cost_usd"]), 0),
        provider_requests: prov.length,
        indianapi_requests: prov.filter((r) => r["provider"] === "IndianAPI").length,
        sec_requests: prov.filter((r) => r["provider"] === "SEC EDGAR").length,
        web_searches: webSearches,
        packet_builds: packetBuilds,
        coverage_flag: coverageFlag,
        warnings: warnings as never,
        errors: errors as never,
        ...extra,
      })
      .eq("id", runId);
    return { runId, status, warnings, errors, ...extra };
  };

  try {
    // 1 — resolve company -----------------------------------------------------
    await log.start("resolve_company");
    if (!company) {
      await log.finish("resolve_company", "FAILED", "Story has no linked company.");
      errors.push("Story has no linked company.");
      return await finalize("FAILED");
    }
    await log.finish(
      "resolve_company",
      "COMPLETE",
      `${company["ticker"]} — ${company["name"]} (${market || "market unknown"}).`,
      { companyId: company["id"], market },
    );

    // 2 — data plan + freshness ----------------------------------------------
    await log.start("data_freshness");
    const plan = buildDataPlan({
      market,
      storyType: String(story.story_type ?? ""),
      title: String(story.title ?? ""),
      catalyst: String(story.primary_catalyst ?? ""),
    });
    const freshness = await checkFreshness(db, {
      companyId: company["id"],
      market,
      datasets: plan.datasets,
      budgets,
    });
    if (freshness.some((f) => f.dataset === "market_snapshot" && f.state === "NOT_APPLICABLE")) {
      coverageFlag = "PARTIAL_MARKET_COVERAGE";
      warnings.push(
        "US market price/volume coverage is unavailable — indicators derived from it are omitted, not estimated.",
      );
    }
    await db
      .from("research_orchestration_runs")
      .update({ data_plan: plan as never, freshness: { entries: freshness } as never })
      .eq("id", runId);
    const fresh = freshness.filter((f) => f.state === "FRESH").length;
    await log.finish(
      "data_freshness",
      "COMPLETE",
      `${plan.category} plan · ${plan.datasets.length} datasets · ${fresh} already fresh, ${freshness.length - fresh} to refresh or unavailable.`,
      { entries: freshness },
    );

    if (await cancelled()) return await finalize("CANCELLED");

    // 3 — provider sync -------------------------------------------------------
    await log.start("provider_sync");
    const syncNotes: string[] = [];
    const needsRefresh = (d: PlannedDataset) => {
      const f = freshness.find((e) => e.dataset === d.dataset);
      if (!f) return false;
      if (f.state === "NOT_APPLICABLE") return false;
      return args.forceRefresh || f.state !== "FRESH";
    };

    if (market === "India") {
      const { getProviderStatus } = await import("@/lib/indianapi.server");
      const status = await getProviderStatus();
      let callsLeft = Math.min(
        budgets.indiaMaxCompanyCalls,
        Math.max(0, status.remaining - budgets.indianApiQuotaReserve),
      );
      if (callsLeft <= 0) {
        warnings.push(
          `IndianAPI quota reserve reached (${status.remaining} left of ${status.monthlyLimit}); the run continued on stored data only.`,
        );
      }

      const wantsStock = plan.datasets.some(
        (d) => ["market_snapshot", "financials", "earnings"].includes(d.dataset) && needsRefresh(d),
      );
      if (wantsStock && callsLeft > 0) {
        const { syncIndianStock } = await import("@/lib/indianapi.sync.server");
        const res = await syncIndianStock({
          companyId: company["id"],
          companyName: String(company["name"]),
          userId: args.userId,
        });
        callsLeft -= 1;
        syncNotes.push(
          res.ok ? "IndianAPI /stock refreshed" : `IndianAPI /stock failed: ${res.error}`,
        );
        if (!res.ok) warnings.push(`IndianAPI /stock failed: ${res.error}`);
      } else if (wantsStock) {
        syncNotes.push("IndianAPI /stock skipped (budget)");
      } else {
        syncNotes.push("IndianAPI /stock skipped (data already fresh)");
      }

      for (const d of plan.datasets) {
        if (!(d.dataset in INDIA_ENDPOINT)) continue;
        if (!needsRefresh(d)) {
          syncNotes.push(`${d.dataset} skipped (fresh)`);
          continue;
        }
        if (callsLeft <= 0) {
          syncNotes.push(`${d.dataset} skipped (budget)`);
          warnings.push(`${d.dataset} was not refreshed: per-story IndianAPI budget exhausted.`);
          continue;
        }
        const res = await fetchIndiaExtra({
          dataset: d.dataset,
          companyId: company["id"],
          companyName: String(company["name"]),
          userId: args.userId,
        });
        callsLeft -= 1;
        syncNotes.push(res.ok ? `${d.dataset} refreshed` : `${d.dataset} failed: ${res.error}`);
        if (!res.ok) warnings.push(`IndianAPI ${d.dataset} failed: ${res.error}`);
      }
    } else {
      const wantsSec = plan.datasets.some(
        (d) => ["sec_filings", "sec_facts"].includes(d.dataset) && needsRefresh(d),
      );
      if (wantsSec) {
        const { syncSecCompanyData } = await import("@/lib/sec.sync.server");
        const res = await syncSecCompanyData({
          companyId: company["id"],
          ticker: String(company["ticker"] ?? "") || undefined,
          userId: args.userId,
        });
        syncNotes.push(
          res.ok
            ? `SEC sync: ${res.report.filingsRetrieved} filings, ${res.report.factsStored} facts, ${res.report.conflicts} conflicts`
            : `SEC sync failed: ${res.error}`,
        );
        if (!res.ok) warnings.push(`SEC sync failed: ${res.error}`);
      } else {
        syncNotes.push("SEC data already fresh — no request issued");
      }
    }

    await log.finish(
      "provider_sync",
      warnings.length ? "WARNING" : "COMPLETE",
      syncNotes.join(" · ") || "No provider refresh was required.",
      { notes: syncNotes },
    );

    if (await cancelled()) return await finalize("CANCELLED");

    // 4 — analyze database ----------------------------------------------------
    const { runAnalyzeStory, runVerifyClaims, runBuildResearchPacket, runGenerateScenarios } =
      await import("@/lib/ai/research.server");
    const { decideAnalyze, decideVerify, decideFinalVerify } =
      await import("@/lib/research/aigates");

    const lastAiRun = async (operation: string) => {
      const { data } = await db
        .from("ai_requests")
        .select("created_at")
        .eq("story_id", args.storyId)
        .eq("operation", operation)
        .eq("ok", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.created_at ? String(data.created_at) : null;
    };
    const countSince = async (table: TableName, column: string, id: string, since: string) => {
      const { data } = await db.from(table).select("id").eq(column, id).gt("created_at", since);
      return (data ?? []).length;
    };

    await log.start("analyze_database");
    const lastAnalyzeAt = await lastAiRun("analyze-story");
    const analyzeSince = lastAnalyzeAt ?? "1970-01-01T00:00:00Z";
    const [providerNew, secFactsNew, periodsNew, earningsNew, eventsNew, filingsNew, sourcesNewA] =
      await Promise.all([
        countSince("provider_stock_data", "company_id", company["id"], analyzeSince),
        countSince("sec_facts", "company_id", company["id"], analyzeSince),
        countSince("financial_periods", "company_id", company["id"], analyzeSince),
        countSince("earnings_reports", "company_id", company["id"], analyzeSince),
        countSince("events", "company_id", company["id"], analyzeSince),
        countSince("sec_filings", "company_id", company["id"], analyzeSince),
        countSince("sources", "company_id", company["id"], analyzeSince),
      ]);
    const { data: allClaimRows } = await db
      .from("claims")
      .select("id,verification_status,created_at")
      .eq("story_id", args.storyId);
    const claimList = allClaimRows ?? [];
    const analyzeDecision = decideAnalyze({
      lastRunAt: lastAnalyzeAt,
      newInputRows:
        providerNew + secFactsNew + periodsNew + earningsNew + eventsNew + filingsNew + sourcesNewA,
      claimCount: claimList.length,
      forceRefresh: Boolean(args.forceRefresh),
    });
    deltaReport["analyze"] = analyzeDecision as never;

    if (!analyzeDecision.run) {
      await log.finish(
        "analyze_database",
        "SKIPPED",
        `Database analysis skipped — ${analyzeDecision.reason}.`,
        analyzeDecision as never,
      );
    } else {
      const analyze = await runAnalyzeStory(db as never, {
        storyId: args.storyId,
        model: args.model ?? null,
        userId: args.userId,
      });
      await log.finish(
        "analyze_database",
        analyze.ok === false ? "FAILED" : "COMPLETE",
        analyze.ok === false
          ? String((analyze as { error?: string }).error ?? "Analysis failed")
          : `Database analysis complete (${analyzeDecision.reason}).`,
        analyze as never,
        analyze.ok === false ? String((analyze as { error?: string }).error ?? "") : null,
      );
      if (analyze.ok === false) {
        errors.push("Database analysis failed.");
        return await finalize("FAILED");
      }
    }

    // 5 — verify claims -------------------------------------------------------
    await log.start("verify_claims");
    const lastVerifyAt = await lastAiRun("verify-claims");
    const verifySince = lastVerifyAt ?? "1970-01-01T00:00:00Z";
    const pendingVerdict = (rows: Array<Record<string, unknown>>) =>
      rows.filter((c) => !String(c["verification_status"] ?? "").trim()).length;
    const { data: claimsNowRows } = await db
      .from("claims")
      .select("id,verification_status,created_at")
      .eq("story_id", args.storyId);
    const claimsNow = claimsNowRows ?? [];
    const verifyDecision = decideVerify({
      lastRunAt: lastVerifyAt,
      pendingClaims: pendingVerdict(claimsNow),
      newClaims: claimsNow.filter((c) => String(c["created_at"]) > verifySince).length,
      newSources: await countSince("sources", "company_id", company["id"], verifySince),
      forceRefresh: Boolean(args.forceRefresh),
    });
    deltaReport["verify"] = verifyDecision as never;

    if (!verifyDecision.run) {
      await log.finish(
        "verify_claims",
        "SKIPPED",
        `Claim verification skipped — ${verifyDecision.reason}.`,
        verifyDecision as never,
      );
    } else {
      const verify = (await runVerifyClaims(db as never, {
        storyId: args.storyId,
        model: args.model ?? null,
        userId: args.userId,
      })) as Record<string, unknown>;
      await log.finish(
        "verify_claims",
        verify["ok"] === false ? "WARNING" : "COMPLETE",
        verify["ok"] === false
          ? `Claim verification failed — ${String(verify["error"] ?? "unknown error")}.`
          : `Claim verification pass complete (${verifyDecision.reason}).`,
        verify as never,
      );
    }

    if (await cancelled()) return await finalize("CANCELLED");

    // 6 — initial packet ------------------------------------------------------
    await log.start("initial_packet");
    const existing = await latestPacket(db, args.storyId);
    const changedSincePacket = await packetDeltaSince(db, {
      storyId: args.storyId,
      companyId: company["id"],
      packet: existing,
    });
    deltaReport["initial"] = {
      material: changedSincePacket.material,
      reasons: changedSincePacket.detail,
      counts: changedSincePacket.counts,
    };

    if (existing && !changedSincePacket.material && !args.forceRefresh) {
      packetStart = { id: existing.id, version: existing.version };
      packetFinal = packetStart;
      await snapshotPacket(db, {
        storyId: args.storyId,
        companyId: company["id"],
        packetId: existing.id,
      });
      await log.finish(
        "initial_packet",
        "SKIPPED",
        `Packet Reused — v${existing.version}. Material Change: NO (${changedSincePacket.detail}).`,
        {
          reusedPacketId: existing.id,
          version: existing.version,
          delta: changedSincePacket.counts,
        },
      );
    } else {
      const first = await runBuildResearchPacket(db as never, {
        storyId: args.storyId,
        model: args.model ?? null,
        userId: args.userId,
        updateReason: `Orchestration packet · ${changedSincePacket.detail}`,
      });
      if ((first as { ok?: boolean }).ok === false) {
        await log.finish("initial_packet", "FAILED", "Packet build failed.");
        errors.push("Initial research packet build failed.");
        return await finalize("FAILED");
      }
      packetBuilds += 1;
      const fp = first as Record<string, unknown>;
      packetStart = {
        id: String(fp["packetId"] ?? fp["id"]),
        version: num(fp["versionNumber"] ?? fp["version"]),
      };
      packetFinal = packetStart;
      await snapshotPacket(db, {
        storyId: args.storyId,
        companyId: company["id"],
        packetId: packetStart.id,
      });
      await log.finish(
        "initial_packet",
        "COMPLETE",
        `Research packet v${packetStart.version} built. Material Change: YES (${changedSincePacket.detail}).`,
        { ...(first as Record<string, unknown>), delta: changedSincePacket.counts } as never,
      );
    }

    // 7/8 — web research + reconciliation -------------------------------------
    await log.start("web_research");
    const { decideWebResearch } = await import("@/lib/research/webfreshness");
    const { data: lastWeb } = await db
      .from("web_research_runs")
      .select("id,created_at")
      .eq("story_id", args.storyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastWebAt = lastWeb?.created_at ? String(lastWeb.created_at) : null;
    const sinceWeb = lastWebAt ?? "1970-01-01T00:00:00Z";

    const [gapRows, eventRows, filingRows, conflictRows] = await Promise.all([
      db
        .from("research_gaps")
        .select("id,status")
        .eq("story_id", args.storyId)
        .gt("created_at", sinceWeb),
      db.from("events").select("id").eq("company_id", company["id"]).gt("created_at", sinceWeb),
      db
        .from("sec_filings")
        .select("id")
        .eq("company_id", company["id"])
        .gt("created_at", sinceWeb),
      db
        .from("provider_data_conflicts")
        .select("id")
        .eq("company_id", company["id"])
        .is("resolution", null)
        .gt("created_at", sinceWeb),
    ]);
    const openGaps = (gapRows.data ?? []).filter(
      (g) => !["RESOLVED", "NOT_FOUND", "CLOSED"].includes(String(g["status"] ?? "").toUpperCase()),
    ).length;

    const webDecision = decideWebResearch({
      lastRunAt: lastWebAt,
      now: new Date().toISOString(),
      freshnessHours: 12,
      planWantsWeb: plan.datasets.some((d) => d.dataset === "news"),
      newResearchGaps: openGaps,
      newMaterialEvents: (eventRows.data ?? []).length + (filingRows.data ?? []).length,
      staleCriticalSources: (conflictRows.data ?? []).length,
      forceRefresh: Boolean(args.forceRefresh),
    });
    deltaReport["web"] = webDecision as never;

    let web: Record<string, unknown> = { ok: true, skipped: true };
    if (!webDecision.run) {
      await log.finish("web_research", "SKIPPED", `Web research skipped — ${webDecision.reason}.`);
      await log.finish("reconcile", "SKIPPED", "No new web results to reconcile.");
    } else {
      const { runResearchLatestNews } = await import("@/lib/ai/web.server");
      web = (await runResearchLatestNews(db as never, {
        storyId: args.storyId,
        companyId: company["id"],
        model: args.model ?? null,
        userId: args.userId,
        rebuildPacket: false,
      })) as Record<string, unknown>;

      if (web["ok"] === false) {
        warnings.push(`Web research failed: ${web["error"]}`);
        await log.finish("web_research", "WARNING", `Web research failed: ${web["error"]}`);
        await log.finish("reconcile", "SKIPPED", "No web results to reconcile.");
      } else {
        webSearches = num(
          web["queriesRun"] ?? (Array.isArray(web["queries"]) ? web["queries"].length : undefined),
        );
        await log.finish(
          "web_research",
          "COMPLETE",
          `${num(web["sourcesAdded"] ?? web["sourcesCreated"])} new sources from ${webSearches || "planned"} searches (${webDecision.reason}).`,
          web as never,
        );
        await log.start("reconcile");
        await log.finish(
          "reconcile",
          "COMPLETE",
          `Reconciliation recorded: ${num(web["confirmed"])} confirmed, ${num(web["conflicts"])} conflicting, ${num(web["newFacts"] ?? web["newInformation"])} new.`,
          web as never,
        );
      }
    }

    if (await cancelled()) return await finalize("CANCELLED");

    // 9 — final packet --------------------------------------------------------
    const current = await latestPacket(db, args.storyId);
    const postWeb = await packetDeltaSince(db, {
      storyId: args.storyId,
      companyId: company["id"],
      packet: current,
    });
    deltaReport["final"] = {
      material: postWeb.material,
      reasons: postWeb.detail,
      counts: postWeb.counts,
    };

    if (packetBuilds >= budgets.maxPacketBuilds) {
      await log.finish("final_packet", "SKIPPED", "Packet-build budget reached for this run.");
    } else if (web["ok"] === false) {
      await log.finish("final_packet", "SKIPPED", "Web research failed — no rebuild attempted.");
    } else if (!postWeb.material) {
      await log.finish(
        "final_packet",
        "SKIPPED",
        `Packet Reused — v${packetFinal?.version}. Material Change: NO (${postWeb.detail}).`,
        { delta: postWeb.counts },
      );
    } else {
      await log.start("final_packet");
      const second = (await runBuildResearchPacket(db as never, {
        storyId: args.storyId,
        model: args.model ?? null,
        userId: args.userId,
        updateReason: `Rebuilt after web research · ${postWeb.detail}`,
      })) as Record<string, unknown>;
      if (second["ok"] === false) {
        warnings.push("Final packet rebuild failed; the initial packet remains current.");
        await log.finish("final_packet", "WARNING", "Rebuild failed — initial packet kept.");
      } else {
        packetBuilds += 1;
        packetFinal = {
          id: String(second["packetId"] ?? second["id"]),
          version: num(second["versionNumber"] ?? second["version"]),
        };
        await snapshotPacket(db, {
          storyId: args.storyId,
          companyId: company["id"],
          packetId: packetFinal.id,
        });
        await log.finish(
          "final_packet",
          "COMPLETE",
          `Research packet v${packetFinal.version} supersedes v${packetStart?.version}. Material Change: YES (${postWeb.detail}).`,
          { ...second, delta: postWeb.counts } as never,
        );
      }
    }

    // 10 — final claim check --------------------------------------------------
    await log.start("final_claim_check");
    const { data: claimsPostRows } = await db
      .from("claims")
      .select("id,verification_status")
      .eq("story_id", args.storyId);
    const finalDecision = decideFinalVerify({
      verifyRan: verifyDecision.run,
      webResearchRan: webDecision.run && web["ok"] !== false,
      packetRebuilt: packetBuilds > 0,
      pendingClaims: pendingVerdict(claimsPostRows ?? []),
      forceRefresh: Boolean(args.forceRefresh),
    });
    deltaReport["finalVerify"] = finalDecision as never;

    if (!finalDecision.run) {
      await log.finish(
        "final_claim_check",
        "SKIPPED",
        `Final verification skipped — ${finalDecision.reason}.`,
        finalDecision as never,
      );
    } else {
      const finalVerify = await runVerifyClaims(db as never, {
        storyId: args.storyId,
        model: args.model ?? null,
        userId: args.userId,
      });
      await log.finish(
        "final_claim_check",
        "COMPLETE",
        `Final verification pass complete (${finalDecision.reason}).`,
        finalVerify as never,
      );
    }

    // 11 — scenarios ----------------------------------------------------------
    // Scenarios are projections built on evidence. With zero supported claims there
    // is nothing to project from, so we refuse rather than let the model improvise.
    const { data: postVerifyClaims } = await db
      .from("claims")
      .select("id,verification_status")
      .eq("story_id", args.storyId);
    const supportedEvidence = (postVerifyClaims ?? []).filter(
      (c) => String((c as Record<string, unknown>)["verification_status"] ?? "") !== "Unsupported",
    ).length;

    const scenarioExpected = budgets.maxScenarioRuns > 0;
    const { isScenarioFresh } = await import("@/lib/research/scenarios");
    const { data: storyScenarios } = await db
      .from("scenario_forecasts")
      .select("id,packet_id,scenario_type")
      .in(
        "packet_id",
        packetFinal?.id ? [packetFinal.id] : ["00000000-0000-0000-0000-000000000000"],
      );
    const scenarioFresh = isScenarioFresh({
      packetId: packetFinal?.id ?? null,
      scenarios: (storyScenarios ?? []) as never,
    });
    if (scenarioExpected && supportedEvidence === 0) {
      await log.finish(
        "scenarios",
        "SKIPPED",
        "Scenarios skipped — no supported claims on file to project from.",
      );
    } else if (scenarioExpected && packetFinal?.id && scenarioFresh.fresh) {
      await log.finish(
        "scenarios",
        "SKIPPED",

        `Scenarios reused for packet v${packetFinal.version} — ${scenarioFresh.reason}.`,
      );
    } else if (scenarioExpected && packetFinal?.id) {
      await log.start("scenarios");
      const sc = (await runGenerateScenarios(db as never, {
        packetId: packetFinal.id,
        model: args.model ?? null,
        userId: args.userId,
      })) as Record<string, unknown>;
      await log.finish(
        "scenarios",
        sc["ok"] === false ? "WARNING" : "COMPLETE",
        sc["ok"] === false ? String(sc["error"]) : "Bull / base / bear scenarios generated.",
        sc as never,
      );
      if (sc["ok"] === false) warnings.push(`Scenarios: ${sc["error"]}`);
    } else {
      await log.finish("scenarios", "SKIPPED", "Scenario generation disabled by budget.");
    }

    // 12 — readiness ----------------------------------------------------------
    await log.start("readiness");
    const readiness = await gatherReadiness(db, {
      storyId: args.storyId,
      companyId: company["id"],
      packetId: packetFinal?.id ?? null,
      scenarioExpected,
    });
    await log.finish("readiness", "COMPLETE", readiness.reason, readiness.summary as never);

    const status =
      readiness.readiness === "READY_FOR_CONTENT"
        ? "READY_FOR_CONTENT"
        : readiness.readiness === "INSUFFICIENT_DATA"
          ? "INSUFFICIENT_DATA"
          : "NEEDS_REVIEW";

    return await finalize(warnings.length && status !== "READY_FOR_CONTENT" ? status : status, {
      readiness: readiness.readiness,
      readiness_reason: readiness.reason,
      readiness_summary: readiness.summary as never,
      packet_start_id: packetStart?.id ?? null,
      packet_start_version: packetStart?.version ?? null,
      packet_final_id: packetFinal?.id ?? null,
      packet_final_version: packetFinal?.version ?? null,
      delta: {
        packetVersions: [packetStart?.version ?? null, packetFinal?.version ?? null],
        packetReused: packetStart?.version === packetFinal?.version && packetBuilds === 0,
        ...deltaReport,
      } as never,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    errors.push(message);
    await db
      .from("research_orchestration_steps")
      .update({ status: "FAILED", error: message, completed_at: new Date().toISOString() })
      .eq("run_id", runId)
      .eq("status", "RUNNING");
    return await finalize("FAILED");
  }
}

export { STEP_LABELS };
