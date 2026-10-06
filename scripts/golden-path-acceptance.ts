import { runOwnerAcceptance } from "./security/owner-cli";
import { jsonArray } from "../src/lib/data-types";
import type { Database } from "../src/integrations/supabase/types";
/**
 * PHASE 2 — Golden path end-to-end production validation (not application code).
 *
 * Drives ONE genuinely data-rich story through the existing production
 * pipeline only: SEC sync (2B importer) → discovery (2A) → autonomous
 * pipeline (2D-2) → research orchestration (2B) → content orchestration (2C)
 * → fact audit / repair / gap recovery (1.3D–1.3F) → READY_FOR_REVIEW.
 *
 * The only special behaviour is explicitly selecting the candidate.
 * No thresholds are relaxed, no evidence is fabricated, nothing is published.
 *
 * Run:  GP_TICKER=GOOGL P2D_USER=<uuid> bun scripts/golden-path-acceptance.ts
 */
import { createClient } from "@supabase/supabase-js";

import { runAutonomousPipeline } from "../src/lib/automation/pipeline.server";
import { runMarketDiscovery } from "../src/lib/discovery/run.server";
import { loadAutomationSettings } from "../src/lib/schedule/controller.server";
import { marketDateFor } from "../src/lib/schedule/domain";
import { syncSecCompanyData } from "../src/lib/sec.sync.server";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const USER = process.env["P2D_USER"]!;
const TICKER = process.env["GP_TICKER"] ?? "GOOGL";
const SKIP_SYNC = process.env["GP_SKIP_SYNC"] === "1";
const SKIP_DISCOVERY = process.env["GP_SKIP_DISCOVERY"] === "1";

const log = (...a: unknown[]) => console.log(...a);
const results: { name: string; pass: boolean; note: string }[] = [];
function check(name: string, pass: boolean, note = "") {
  results.push({ name, pass, note });
  log(`${pass ? "PASS" : "FAIL"} — ${name}${note ? ` · ${note}` : ""}`);
}
const n = (v: unknown) => Number(v ?? 0) || 0;

async function settingsId() {
  const s = await loadAutomationSettings(db);
  return String(s.id);
}
async function patch(fields: Record<string, unknown>) {
  await admin
    .from("automation_settings")
    .update(fields as never)
    .eq("id", await settingsId());
}
async function spendSince(iso: string) {
  const { data } = await admin
    .from("ai_requests")
    .select("estimated_cost_usd,operation,created_at")
    .gte("created_at", iso);
  const rows = data ?? [];
  return { calls: rows.length, cost: rows.reduce((a, r) => a + n(r.estimated_cost_usd), 0) };
}
async function providerCallsSince(iso: string) {
  const { count } = await admin
    .from("provider_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", iso);
  return count ?? 0;
}

async function main() {
  const t0Global = new Date().toISOString();
  log(`Golden path · ticker ${TICKER} · user ${USER}`);

  // ---------------------------------------------------------- 0. company
  const { data: company } = await admin
    .from("companies")
    .select("id,name,ticker,country")
    .eq("ticker", TICKER)
    .maybeSingle();
  if (!company) throw new Error(`No company row for ${TICKER}`);
  const companyId = String(company.id);
  log(`Company: ${company.name} (${companyId})`);

  // ---------------------------------------------------------- 1. real SEC refresh
  if (!SKIP_SYNC) {
    const sync = await syncSecCompanyData({ companyId, ticker: TICKER, userId: USER });
    log(
      `SEC sync: ${sync.report.filingsRetrieved} filings retrieved · ${sync.report.factsStored} facts · ${sync.report.requests} requests`,
    );
  }

  // ---------------------------------------------------------- 2. discovery (2A)
  let discoveryRunId: string | null = null;
  let candidate: Pick<
    Database["public"]["Tables"]["story_candidates"]["Row"],
    "id" | "title" | "content_score" | "score_coverage_pct" | "discovery_run_id" | "story_id"
  > | null = null;

  if (!SKIP_DISCOVERY) {
    const disc = await runMarketDiscovery({
      db,
      userId: USER,
      market: "US",
      runType: "GOLDEN_PATH",
      lookbackDays: Number(process.env["GP_LOOKBACK_DAYS"] ?? 14),
    });
    discoveryRunId = disc.runId;
    log(
      `Discovery run ${disc.runId}: ${disc.candidatesCreated} candidates · ${disc.webSearchCalls} web searches · ${disc.aiCalls} AI calls · $${disc.costUsd.toFixed(4)}`,
    );
  }

  const { data: cands } = await admin
    .from("story_candidates")
    .select("*")
    .eq("market", "US")
    .eq("company_id", companyId)
    .is("story_id", null)
    .order("discovered_at", { ascending: false })
    .limit(1);
  candidate = (cands ?? [])[0] ?? null;
  check(
    `Discovery produced an open ${TICKER} candidate`,
    Boolean(candidate),
    candidate?.title ?? "",
  );
  if (!candidate) {
    log("GOLDEN PATH NOT YET VALIDATED — no data-rich candidate surfaced by discovery.");
    return;
  }
  discoveryRunId = candidate.discovery_run_id ?? discoveryRunId;

  // ------------------------------------------------ 5. pre-research evidence state
  const settings = await loadAutomationSettings(db);
  const minScore = n(settings.min_content_score_us);
  const minCoverage = n(settings.min_score_coverage_us);
  const { count: sourcesBefore } = await admin
    .from("sources")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  const { count: claimsBefore } = await admin
    .from("claims")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  log("\n--- CANDIDATE ---");
  log(`Candidate:            ${candidate.title}`);
  log(`Content opportunity:  ${n(candidate.content_score)} (floor ${minScore})`);
  log(`Score coverage:       ${n(candidate.score_coverage_pct)}% (floor ${minCoverage}%)`);
  log(`Sources before:       ${sourcesBefore ?? 0}`);
  log(`Claims before:        ${claimsBefore ?? 0}`);
  check(
    "Candidate qualifies under unchanged Phase 2D-2 floors",
    n(candidate.content_score) >= minScore && n(candidate.score_coverage_pct) >= minCoverage,
  );

  // ---------------------------------------------------------- 3. autonomous pass
  await patch({
    autonomous_enabled: true,
    autonomous_long_enabled: false,
    autonomous_short_duration: "short_60",
    max_research_main: 1,
    max_content_main: 1,
    autonomous_ai_budget_percent: 100,
    ai_daily_cost_cap_usd: 60,
  });
  const providersBefore = await providerCallsSince(t0Global);
  const run = await runAutonomousPipeline({
    db,
    userId: USER,
    market: "US",
    marketDate: marketDateFor("America/New_York"),
    executionType: "MAIN_DISCOVERY",
    trigger: "GOLDEN_PATH",
    dryRun: false,
    discoveryRunId,
    candidateIds: [String(candidate.id)],
    force: true,
  });
  log("\n--- PIPELINE RESULT ---");
  log(JSON.stringify(run, null, 2));

  const { data: itemRows } = await admin
    .from("automation_pipeline_items")
    .select("*")
    .eq("pipeline_run_id", run.pipelineRunId ?? "");
  const item = (itemRows ?? [])[0];
  check("Candidate auto-promoted by AUTOMATION", Boolean(item?.story_id));
  const storyId = item?.story_id ? String(item.story_id) : null;
  if (!storyId) {
    log("GOLDEN PATH NOT YET VALIDATED — promotion did not occur.");
    return;
  }

  const { data: story } = await admin
    .from("stories")
    .select(
      "id,title,status,content_status,promotion_source,pipeline_run_id,candidate_id,discovery_run_id",
    )
    .eq("id", storyId)
    .maybeSingle();
  check(
    "Story records automation lineage",
    story?.promotion_source === "AUTOMATION" &&
      String(story?.pipeline_run_id) === String(run.pipelineRunId),
  );

  // ---------------------------------------------------------- 5. research report
  const { data: research } = await admin
    .from("research_orchestration_runs")
    .select("*")
    .eq("story_id", storyId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = research;
  const { data: srcRows } = await admin
    .from("sources")
    .select("source_tier")
    .eq("company_id", companyId);
  const tier = (t: number) =>
    (srcRows ?? []).filter((s) => String(s.source_tier ?? "").includes(`Tier ${t}`)).length;
  const { data: claimRows } = await admin
    .from("claims")
    .select("verification_status,is_critical")
    .eq("company_id", companyId);
  const cl = (status: string) =>
    (claimRows ?? []).filter((c) => c.verification_status === status).length;

  log("\n--- RESEARCH ---");
  log(`Orchestration run:    ${r?.id}`);
  log(`Freshness decisions:  ${JSON.stringify(r?.freshness ?? {})}`);
  log(
    `Provider calls:       ${n(r?.provider_requests)} (SEC ${n(r?.sec_requests)} · IndianAPI ${n(r?.indianapi_requests)})`,
  );
  log(`Web searches:         ${n(r?.web_searches)}`);
  log(`AI calls:             ${n(r?.ai_calls)} · $${n(r?.estimated_cost_usd).toFixed(4)}`);
  log(`Sources added:        ${n(r?.sources_added)} · claims added ${n(r?.claims_added)}`);
  log(
    `Claims verified:      ${cl("Verified")} · attributed ${cl("Attributed")} · needs cross-check ${cl("Needs Cross-Check")} · unsupported ${cl("Unsupported")}`,
  );
  log(`Conflicts:            ${n(r?.conflicts_found)}`);
  log(
    `Tier 1 sources:       ${tier(1)} · Tier 2 ${tier(2)} · Tier 3 ${tier(3)} · Tier 4 ${tier(4)}`,
  );
  log(`Packet:               v${n(r?.packet_final_version)} (${r?.packet_final_id})`);
  log(`Readiness:            ${r?.readiness} — ${r?.readiness_reason ?? ""}`);

  const { data: scenarios } = await admin
    .from("scenario_forecasts")
    .select("scenario_type")
    .eq("packet_id", r?.packet_final_id ?? "");
  log(
    `Scenarios:            ${(scenarios ?? []).map((s) => s.scenario_type).join(", ") || "none"}`,
  );

  check(
    "Research reached READY_FOR_CONTENT under existing rules",
    r?.readiness === "READY_FOR_CONTENT",
    String(r?.readiness_reason ?? ""),
  );
  if (r?.readiness !== "READY_FOR_CONTENT") {
    log("\nGOLDEN PATH NOT YET VALIDATED — research readiness gate not met.");
    await restore();
    return;
  }

  // ---------------------------------------------------------- 6/7. content report
  const { data: content } = await admin
    .from("content_orchestration_runs")
    .select("*")
    .eq("story_id", storyId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const c = content;
  const shortIds: string[] = (c?.short_script_ids ?? []) as string[];
  const scriptId = shortIds[0] ?? null;

  log("\n--- CONTENT ---");
  log(`Content run:          ${c?.id} (cache hit: ${Boolean(c?.cache_hit)})`);
  log(`Style profile:        ${c?.style_profile_id} v${c?.style_profile_version}`);
  log(`Packet:               v${c?.packet_version} (${c?.packet_id})`);
  log(`Word counts:          ${JSON.stringify(c?.word_counts ?? {})}`);
  log(
    `Repairs run:          ${n(c?.repairs_run)} · gaps ${n(c?.gaps)} resolved ${n(c?.gaps_resolved)} unresolved ${n(c?.gaps_unresolved)}`,
  );
  log(`Content AI:           ${n(c?.ai_calls)} calls · $${n(c?.estimated_cost_usd).toFixed(4)}`);
  log(`Readiness:            ${c?.readiness} — ${c?.readiness_reason ?? ""}`);

  let script: Database["public"]["Tables"]["scripts"]["Row"] | null = null;
  if (scriptId) {
    const { data: s } = await admin.from("scripts").select("*").eq("id", scriptId).maybeSingle();
    script = s;
    const { data: audits } = await admin
      .from("script_audits")
      .select("*")
      .eq("script_id", scriptId)
      .order("created_at", { ascending: true });
    const first = (audits ?? [])[0];
    const last = (audits ?? [])[(audits ?? []).length - 1];
    const { data: statements } = await admin
      .from("script_statements")
      .select("is_numeric,status,matched_claim_id,matched_source_id")
      .eq("audit_id", last?.id ?? "");
    const numeric = (statements ?? []).filter((s) => s.is_numeric);

    log("\n--- SHORT (60s Tanglish) ---");
    log(
      `Script:               ${scriptId} · format ${script?.format} · ${script?.target_duration}`,
    );
    log(
      `Word count:           ${n(script?.word_count)} (final) · initial ${JSON.stringify(c?.word_counts ?? {})}`,
    );
    log(
      `Numeric statements:   ${numeric.length} · matched ${numeric.filter((s) => s.status === "SUPPORTED" || s.status === "MATCH").length}`,
    );
    log(`Numeric pre-check:    ${last?.numeric_precheck_blocking ?? 0} blocking`);
    log(
      `Initial audit:        ${jsonArray(first?.blocking_reasons).length} blockers · status ${first?.status}`,
    );
    log(
      `Final audit:          ${jsonArray(last?.blocking_reasons).length} blockers · status ${last?.status}`,
    );
    log(`Audit passes:         ${(audits ?? []).length}`);
    log(`Readiness gate:       ${last?.readiness_gate} · ready ${Boolean(last?.ready_for_review)}`);

    check("Short script generated", Boolean(script?.body?.length));
    check(
      "Final audit clears the readiness gate",
      Boolean(last?.ready_for_review),
      String(last?.status ?? ""),
    );
    check(
      "Every supported factual statement retains evidence references",
      (statements ?? [])
        .filter((s) => s.status === "SUPPORTED" || s.status === "SUPPORTED_WITH_ATTRIBUTION")
        .every((s) => s.matched_claim_id || s.matched_source_id),
    );
  }

  check(
    "Content orchestration reached READY_FOR_REVIEW",
    c?.readiness === "READY_FOR_REVIEW",
    String(c?.readiness_reason ?? ""),
  );

  // ---------------------------------------------------------- 9. traceability
  const { data: version } = await admin
    .from("script_versions")
    .select("id,version,packet_id")
    .eq("script_id", scriptId ?? "")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lineageOk =
    Boolean(discoveryRunId) &&
    Boolean(candidate.id) &&
    Boolean(storyId) &&
    Boolean(r?.id) &&
    Boolean(r?.packet_final_id) &&
    (scenarios ?? []).length > 0 &&
    Boolean(c?.id) &&
    Boolean(scriptId) &&
    Boolean(version?.id);
  check("Full lineage is queryable end to end", lineageOk);
  log(
    `\nLineage: discovery ${discoveryRunId} → candidate ${candidate.id} → story ${storyId} → research ${r?.id} → packet ${r?.packet_final_id} v${n(r?.packet_final_version)} → content ${c?.id} → script ${scriptId} → version ${version?.version}`,
  );

  // ---------------------------------------------------------- 10. duplicate run
  const tDup = new Date().toISOString();
  const provBeforeDup = await providerCallsSince(t0Global);
  const again = await runAutonomousPipeline({
    db,
    userId: USER,
    market: "US",
    marketDate: marketDateFor("America/New_York"),
    executionType: "MAIN_DISCOVERY",
    trigger: "GOLDEN_PATH_DUPLICATE",
    dryRun: false,
    discoveryRunId,
    candidateIds: [String(candidate.id)],
    force: true,
  });
  const dupSpend = await spendSince(tDup);
  const provAfterDup = await providerCallsSince(t0Global);
  const { count: storiesForCandidate } = await admin
    .from("stories")
    .select("id", { count: "exact", head: true })
    .eq("candidate_id", String(candidate.id));
  const { count: scriptsNow } = await admin
    .from("scripts")
    .select("id", { count: "exact", head: true })
    .eq("story_id", storyId)
    .gte("created_at", tDup);
  const { count: packetsNow } = await admin
    .from("research_packets")
    .select("id", { count: "exact", head: true })
    .eq("story_id", storyId)
    .gte("created_at", tDup);

  log("\n--- DUPLICATE PASS ---");
  log(JSON.stringify(again, null, 2));
  check(
    "No duplicate promotion",
    (storiesForCandidate ?? 0) === 1,
    `${storiesForCandidate} stories`,
  );
  check("No new research packet", (packetsNow ?? 0) === 0);
  check("No new script", (scriptsNow ?? 0) === 0);
  check("No provider calls on the duplicate pass", provAfterDup === provBeforeDup);
  check(
    "No incremental AI spend on the duplicate pass",
    dupSpend.cost === 0,
    `${dupSpend.calls} calls · $${dupSpend.cost.toFixed(4)}`,
  );

  // ---------------------------------------------------------- 11. approval boundary
  const { data: finalScript } = await admin
    .from("scripts")
    .select("status,ready_for_review,approved_at")
    .eq("id", scriptId ?? "")
    .maybeSingle();
  const { count: pubs } = await admin
    .from("content_publications")
    .select("id", { count: "exact", head: true })
    .gte("created_at", t0Global);
  check(
    "Script stops at review — never approved or published",
    finalScript?.status !== "Approved" &&
      finalScript?.status !== "Published" &&
      !finalScript?.approved_at &&
      (pubs ?? 0) === 0,
    String(finalScript?.status ?? ""),
  );

  // ---------------------------------------------------------- 12. cost report
  const total = await spendSince(t0Global);
  log("\n--- COST REPORT (one review-ready story) ---");
  log(`Discovery AI:         $${n((await discoveryCost(discoveryRunId)).cost).toFixed(4)}`);
  log(`Research provider:    ${n(r?.provider_requests)} calls`);
  log(`Research web search:  ${n(r?.web_searches)} searches`);
  log(`Research AI:          $${n(r?.estimated_cost_usd).toFixed(4)} (${n(r?.ai_calls)} calls)`);
  log(
    `Content + audit + repair + gaps: $${n(c?.estimated_cost_usd).toFixed(4)} (${n(c?.ai_calls)} calls)`,
  );
  log(`TOTAL AI cost:        $${total.cost.toFixed(4)} across ${total.calls} calls`);
  log(
    `Provider requests:    ${(await providerCallsSince(t0Global)) - providersBefore + providersBefore}`,
  );

  await restore();

  const failed = results.filter((x) => !x.pass);
  log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) log(failed.map((f) => `  FAIL ${f.name}`).join("\n"));
  log(failed.length ? "GOLDEN PATH NOT YET VALIDATED" : "GOLDEN PATH VALIDATED");
}

async function discoveryCost(runId: string | null) {
  if (!runId) return { cost: 0 };
  const { data } = await admin
    .from("discovery_runs")
    .select("estimated_cost_usd")
    .eq("id", runId)
    .maybeSingle();
  return { cost: n(data?.estimated_cost_usd) };
}

async function restore() {
  await patch({
    autonomous_enabled: false,
    automation_enabled: false,
    dry_run: true,
    autonomous_ai_budget_percent: 70,
    max_research_main: 3,
    max_content_main: 2,
    ai_daily_cost_cap_usd: 2,
  });
  log("\nSafe end state restored: automation OFF, autonomous OFF, dry run ON.");
}

runOwnerAcceptance(main).catch(async (e) => {
  console.error(e);
  try {
    await restore();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
