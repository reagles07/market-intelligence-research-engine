import { runOwnerAcceptance } from "./security/owner-cli";
import type { Database } from "../src/integrations/supabase/types";
/**
 * Phase 2D-2 acceptance harness (not application code).
 *
 * Validates the autonomous research + content pipeline: safe defaults,
 * qualification, auto-promotion lineage, research → content sequencing,
 * caps, budget share, and the no-publish guarantee.
 *
 * Real AI/provider spend only happens when P2D2_REAL=1.
 */
import { createClient } from "@supabase/supabase-js";

import { runAutonomousPipeline } from "../src/lib/automation/pipeline.server";
import { loadAutomationSettings } from "../src/lib/schedule/controller.server";
import { marketDateFor } from "../src/lib/schedule/domain";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const USER = process.env["P2D_USER"]!;
const REAL = process.env["P2D2_REAL"] === "1";
const MARKET = (process.env["P2D2_MARKET"] as "India" | "US") ?? "India";

const results: { name: string; pass: boolean; note: string }[] = [];
const log = (...a: unknown[]) => console.log(...a);
function check(name: string, pass: boolean, note = "") {
  results.push({ name, pass, note });
  log(`${pass ? "PASS" : "FAIL"} — ${name}${note ? ` · ${note}` : ""}`);
}

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
async function aiCostSince(iso: string) {
  const { data } = await admin
    .from("ai_requests")
    .select("estimated_cost_usd")
    .gte("created_at", iso);
  return (data ?? []).reduce(
    (a: number, r: { estimated_cost_usd: number | null }) => a + Number(r.estimated_cost_usd ?? 0),
    0,
  );
}

async function latestDiscoveryRun(market: string) {
  const { data } = await admin
    .from("daily_run_executions")
    .select("discovery_run_id,id,daily_run_id")
    .eq("market", market)
    .eq("dry_run", false)
    .not("discovery_run_id", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function main() {
  const marketDate = marketDateFor(MARKET === "India" ? "Asia/Kolkata" : "America/New_York");
  const exec = await latestDiscoveryRun(MARKET);
  let discoveryRunId = exec?.discovery_run_id ? String(exec.discovery_run_id) : null;
  // Acceptance needs a run that still has undecided candidates.
  const { data: openCand } = await admin
    .from("story_candidates")
    .select("discovery_run_id")
    .eq("market", MARKET)
    .is("story_id", null)
    .not("discovery_run_id", "is", null)
    .order("discovered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openCand?.discovery_run_id) discoveryRunId = String(openCand.discovery_run_id);
  log(`Market ${MARKET} · date ${marketDate} · discovery run ${discoveryRunId ?? "none"}`);

  const base = {
    db,
    userId: USER,
    market: MARKET,
    marketDate,
    executionType: "MAIN_DISCOVERY" as const,
    trigger: "ACCEPTANCE",
    discoveryRunId,
    executionId: exec?.id ? String(exec.id) : null,
    dailyRunId: exec?.daily_run_id ? String(exec.daily_run_id) : null,
  };

  // 1 — safe default: autonomous OFF costs nothing and touches nothing -------
  await patch({ autonomous_enabled: false });
  let t0 = new Date().toISOString();
  let r = await runAutonomousPipeline({ ...base, dryRun: false });
  check(
    "Autonomous OFF skips the pipeline at zero cost",
    r.status === "SKIPPED" && r.promoted === 0 && (await aiCostSince(t0)) === 0,
    r.skipReason ?? "",
  );

  // 2 — dry run previews without promoting ----------------------------------
  await patch({
    autonomous_enabled: true,
    min_content_score_india: 0,
    min_content_score_us: 0,
    min_score_coverage_india: 0,
    min_score_coverage_us: 0,
  });
  t0 = new Date().toISOString();
  r = await runAutonomousPipeline({ ...base, dryRun: true });
  const dryCost = await aiCostSince(t0);
  check(
    "Dry run plans only — no promotion, no research, no spend",
    r.status === "PLANNED" && r.promoted === 0 && r.researched === 0 && dryCost === 0,
    `${r.qualified} of ${r.considered} would qualify`,
  );

  // 3 — qualification floors hold -------------------------------------------
  await patch({ min_content_score_india: 999, min_content_score_us: 999 });
  t0 = new Date().toISOString();
  r = await runAutonomousPipeline({ ...base, dryRun: false });
  check(
    "Unreachable score floor qualifies nothing and spends nothing",
    r.qualified === 0 && r.promoted === 0 && (await aiCostSince(t0)) === 0,
    r.skipReason ?? "",
  );

  // 4 — coverage floor is independent of score ------------------------------
  await patch({
    min_content_score_india: 0,
    min_content_score_us: 0,
    min_score_coverage_india: 999,
    min_score_coverage_us: 999,
  });
  r = await runAutonomousPipeline({ ...base, dryRun: false });
  check(
    "Coverage floor blocks high scores computed from thin data",
    r.qualified === 0,
    r.skipReason ?? "",
  );

  // 5 — budget share is enforced before spend -------------------------------
  await patch({
    min_score_coverage_india: 0,
    min_score_coverage_us: 0,
    autonomous_ai_budget_percent: 0.0001,
    max_research_main: 1,
    max_content_main: 1,
  });
  t0 = new Date().toISOString();
  r = await runAutonomousPipeline({ ...base, dryRun: false });
  const budgetCost = await aiCostSince(t0);
  const { data: budgetItems } = await admin
    .from("automation_pipeline_items")
    .select("outcome")
    .eq("pipeline_run_id", r.pipelineRunId ?? "");
  const budgetBlocked =
    r.qualified === 0 ||
    ((budgetItems ?? []).length > 0 &&
      (budgetItems ?? []).every((i) => i.outcome === "SKIPPED_BUDGET"));
  check(
    "Autonomous budget share blocks work before any spend",
    budgetBlocked && budgetCost === 0,
    `cost $${budgetCost.toFixed(4)}`,
  );

  if (!REAL) {
    log("\nP2D2_REAL is not set — skipping the real research + content pass.");
  } else {
    // 6 — real end-to-end pass ----------------------------------------------
    await patch({
      autonomous_ai_budget_percent: 100,
      ai_daily_cost_cap_usd: 60,
      max_research_main: 1,
      max_content_main: 1,
    });
    t0 = new Date().toISOString();
    r = await runAutonomousPipeline({ ...base, dryRun: false });
    log(JSON.stringify(r, null, 2));
    const { data: items } = await admin
      .from("automation_pipeline_items")
      .select("*")
      .eq("pipeline_run_id", r.pipelineRunId ?? "");
    const item = (items ?? [])[0];

    check(
      "A qualifying candidate was promoted automatically",
      Boolean(item?.story_id),
      item?.title ?? "",
    );
    if (item?.story_id) {
      const { data: story } = await admin
        .from("stories")
        .select("promotion_source,pipeline_run_id,content_status")
        .eq("id", item.story_id)
        .maybeSingle();
      check(
        "Story records automation lineage",
        story?.promotion_source === "AUTOMATION" &&
          String(story?.pipeline_run_id) === String(r.pipelineRunId),
      );
    }
    check(
      "Research orchestration ran for the promoted story",
      Boolean(item?.research_run_id),
      String(item?.research_readiness ?? ""),
    );
    check(
      "Content only runs after the research gate",
      item?.research_readiness === "READY_FOR_CONTENT"
        ? Boolean(item?.content_run_id)
        : !item?.content_run_id,
      String(item?.outcome ?? ""),
    );
    check("Research cap respected", r.researched <= 1, `${r.researched} research runs`);
    check("Content cap respected", r.contentRuns <= 1, `${r.contentRuns} content runs`);

    // 7 — no auto-publish -----------------------------------------------------
    const { data: pubs } = await admin
      .from("content_publications")
      .select("id")
      .gte("created_at", t0);
    check("Nothing was published automatically", (pubs ?? []).length === 0);

    const { data: scripts } = await admin.from("scripts").select("status").gte("created_at", t0);
    check(
      "Generated scripts stop at review, never approved",
      (scripts ?? []).every((s) => s.status !== "Published" && s.status !== "Approved"),
      `${(scripts ?? []).length} scripts`,
    );

    // 8 — duplicate pass does not redo paid work -----------------------------
    const again = await runAutonomousPipeline({ ...base, dryRun: false });
    const { data: againItems } = await admin
      .from("automation_pipeline_items")
      .select("candidate_id")
      .eq("pipeline_run_id", again.pipelineRunId ?? "");
    const firstIds = new Set((items ?? []).map((i) => String(i.candidate_id)));
    check(
      "A second pass moves on to fresh candidates instead of redoing one",
      (againItems ?? []).every((i) => !firstIds.has(String(i.candidate_id))),
      `${again.promoted} newly promoted`,
    );
  }

  // restore the safe end state ----------------------------------------------
  await patch({
    autonomous_enabled: false,
    dry_run: true,
    automation_enabled: false,
    autonomous_ai_budget_percent: 70,
    min_content_score_india: 40,
    min_content_score_us: 40,
    min_score_coverage_india: 60,
    min_score_coverage_us: 50,
    max_research_main: 3,
    max_content_main: 2,
    ai_daily_cost_cap_usd: 2,
  });
  log("\nSafe end state restored: automation OFF, dry run ON, autonomous OFF.");

  const failed = results.filter((x) => !x.pass);
  log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) log(failed.map((f) => `  FAIL ${f.name}`).join("\n"));
  log(failed.length ? "PHASE 2D-2 NOT YET VALIDATED" : "PHASE 2D-2 VALIDATED");
}

runOwnerAcceptance(main).catch((e) => {
  console.error(e);
  process.exit(1);
});
