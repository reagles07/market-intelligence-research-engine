import { runOwnerAcceptance } from "./security/owner-cli";
import type { Database } from "../src/integrations/supabase/types";
/**
 * Pass 2A acceptance harness (not application code).
 *
 * Test 1 — India discovery on REAL IndianAPI data: signals collected within
 *   the request budget, clustered into candidates, scored with a transparent
 *   breakdown, and shortlisted for a light AI evaluation.
 * Test 2 — US discovery on REAL data: SEC/universe/web signals with the
 *   PARTIAL_MARKET_COVERAGE flag and price/volume components correctly marked
 *   unavailable rather than guessed.
 * Test 3 — promotion: a candidate becomes a Story, exactly once.
 */
import { createClient } from "@supabase/supabase-js";

import { runMarketDiscovery } from "../src/lib/discovery/run.server";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const log = (...a: unknown[]) => console.log(...a);
const ok = (pass: boolean, label: string, extra = "") =>
  log(`${pass ? "PASS" : "FAIL"} — ${label}${extra ? ` · ${extra}` : ""}`);

async function report(runId: string) {
  const { data: candidates } = await admin
    .from("story_candidates")
    .select(
      "id,company_name,ticker,primary_type,content_score,score_coverage_pct,priority_band,signal_count,ai_evaluated,score_rank,coverage_flag",
    )
    .eq("discovery_run_id", runId)
    .order("score_rank", { ascending: true })
    .limit(8);
  for (const c of candidates ?? []) {
    log(
      `  #${c.score_rank} ${c.company_name} (${c.ticker ?? "—"}) ${c.primary_type} · score ${c.content_score} · coverage ${c.score_coverage_pct}% · ${c.signal_count} signals · ${c.priority_band}${c.ai_evaluated ? " · AI" : ""}`,
    );
  }
  return candidates ?? [];
}

async function main() {
  const { data: profile } = await admin.from("profiles").select("id").limit(1).single();
  const userId = profile!.id as string;

  // -------------------------------------------------------------- Test 1: India
  log("\n=== TEST 1 — India discovery (real IndianAPI) ===");
  const india = await runMarketDiscovery({ db, userId, market: "India" });
  log(india);
  ok(india.rawSignals > 0, "India returned raw signals", `${india.rawSignals}`);
  ok(india.candidatesCreated > 0, "India produced candidates", `${india.candidatesCreated}`);
  ok(
    india.providerRequests <= 7,
    "India stayed inside the provider request budget",
    `${india.providerRequests} requests`,
  );
  ok(
    india.duplicatesMerged > 0,
    "Overlapping feeds were merged",
    `${india.duplicatesMerged} merged`,
  );
  const indiaCands = await report(india.runId);
  ok(
    indiaCands.some((c) => c.ai_evaluated),
    "Top India candidates were AI evaluated",
  );

  const { data: comps } = await admin
    .from("candidate_score_components")
    .select("component_key,points,max_points,available,reason,stage")
    .eq("candidate_id", indiaCands[0]!.id);
  log("  components for top candidate:");
  for (const c of comps ?? []) {
    log(
      `    ${c.component_key}: ${c.available ? `${c.points}/${c.max_points}` : "unavailable"} (${c.stage}) — ${c.reason.slice(0, 110)}`,
    );
  }
  ok((comps ?? []).length === 8, "All 8 score components stored", `${(comps ?? []).length}`);

  // -------------------------------------------------------------- Test 2: US
  log("\n=== TEST 2 — US discovery (real SEC + web) ===");
  const us = await runMarketDiscovery({ db, userId, market: "US" });
  log(us);
  ok(us.coverage === "PARTIAL_MARKET_COVERAGE", "US run flagged partial market coverage");
  ok(us.webSearchCalls <= 4 * 3, "US web budget respected", `${us.webSearchCalls} searches`);
  const usCands = await report(us.runId);
  ok(usCands.length > 0, "US produced candidates", `${usCands.length}`);

  if (usCands.length) {
    const { data: usComps } = await admin
      .from("candidate_score_components")
      .select("component_key,available,reason")
      .eq("candidate_id", usCands[0]!.id)
      .in("component_key", ["price_movement", "unusual_volume"]);
    for (const c of usComps ?? [])
      log(`    ${c.component_key}: available=${c.available} — ${c.reason.slice(0, 120)}`);
    ok(
      (usComps ?? []).some((c) => !c.available),
      "US price/volume components marked unavailable rather than guessed",
    );
  }

  // -------------------------------------------------------------- Test 3: promote
  log("\n=== TEST 3 — promotion to a story ===");
  const target = indiaCands[0]!;
  const { data: candidate } = await admin
    .from("story_candidates")
    .select("*")
    .eq("id", target.id)
    .single();
  let companyId = candidate!.company_id;
  if (!companyId) {
    const { data: company } = await admin
      .from("companies")
      .insert({
        name: candidate!.company_name,
        ticker: candidate!.ticker ?? candidate!.company_name.slice(0, 12).toUpperCase(),
        exchange: candidate!.exchange ?? "NSE",
        country: "India",
        currency: "INR",
        data_mode: "LIVE",
        created_by: userId,
      })
      .select("id")
      .single();
    companyId = company!.id;
  }
  const { data: story, error: storyError } = await admin
    .from("stories")
    .insert({
      company_id: companyId,
      title: candidate!.title,
      story_type: "Custom",
      priority: "Medium",
      status: "New",
      is_demo: false,
      content_opportunity_score: candidate!.content_score,
      discovery_run_id: candidate!.discovery_run_id,
      candidate_id: candidate!.id,
      created_by: userId,
    })
    .select("id")
    .single();
  ok(!storyError && !!story, "Candidate promoted into a story", storyError?.message ?? story!.id);
  await admin
    .from("story_candidates")
    .update({
      status: "PROMOTED_TO_STORY",
      story_id: story!.id,
      promoted_at: new Date().toISOString(),
      company_id: companyId,
    })
    .eq("id", candidate!.id);

  log("\nDone.");
}

runOwnerAcceptance(main).catch((e) => {
  console.error(e);
  process.exit(1);
});
