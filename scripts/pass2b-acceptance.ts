import { runOwnerAcceptance } from "./security/owner-cli";
import type { Database } from "../src/integrations/supabase/types";
/**
 * Pass 2B acceptance harness (not application code).
 *
 * Test 1 — India story: full orchestration on real data, ordered steps,
 *   provider budget respected, packet versioned, readiness recorded.
 * Test 2 — US story: SEC path with PARTIAL_MARKET_COVERAGE handling.
 * Test 3 — cache path: an immediate re-run must skip fresh datasets and
 *   issue no new provider requests.
 * Test 4 — incomplete story: a company with no data must end
 *   INSUFFICIENT_DATA without inventing evidence.
 */
import { createClient } from "@supabase/supabase-js";

import { runResearchOrchestration } from "../src/lib/research/orchestrator.server";
import { computePacketDelta, type EvidenceSnapshot } from "../src/lib/research/material.server";
import { decideWebResearch } from "../src/lib/research/webfreshness";
import { isScenarioFresh } from "../src/lib/research/scenarios";
import {
  evaluateReadiness,
  isClaimAttributed,
  isClaimSupported,
  summarizeClaims,
} from "../src/lib/research/readiness";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const log = (...a: unknown[]) => console.log(...a);
const ok = (pass: boolean, label: string, extra = "") =>
  log(`${pass ? "PASS" : "FAIL"} — ${label}${extra ? ` · ${extra}` : ""}`);
async function aiCallsDuring(
  run: Database["public"]["Tables"]["research_orchestration_runs"]["Row"],
) {
  const { data } = await admin
    .from("ai_requests")
    .select("operation,input_tokens,output_tokens,estimated_cost_usd,created_at")
    .eq("story_id", run["story_id"])
    .gte("created_at", run["started_at"])
    .order("created_at");
  const rows = data ?? [];
  log(`  AI calls during this run: ${rows.length}`);
  for (const r of rows) {
    log(
      `    · ${String(r["operation"]).padEnd(24)} in ${r["input_tokens"]} / out ${r["output_tokens"]} · $${Number(r["estimated_cost_usd"]).toFixed(4)}`,
    );
  }
  return rows;
}

async function evidenceProfile(companyId: string, storyId: string) {
  const [{ data: claims }, { data: sources }, { data: conflicts }] = await Promise.all([
    admin
      .from("claims")
      .select("claim_category,verification_status,is_critical")
      .eq("story_id", storyId),
    admin.from("sources").select("source_tier").eq("company_id", companyId),
    admin
      .from("provider_data_conflicts")
      .select("id")
      .eq("company_id", companyId)
      .is("resolution", null),
  ]);
  const tally = (rows: Array<Record<string, unknown>>, key: string) =>
    rows.reduce<Record<string, number>>((a, r) => {
      const k = String(r[key] ?? "—");
      a[k] = (a[k] ?? 0) + 1;
      return a;
    }, {});
  const c = claims ?? [];
  log(`  claims by category: ${JSON.stringify(tally(c, "claim_category"))}`);
  log(`  claims by status:   ${JSON.stringify(tally(c, "verification_status"))}`);
  log(`  sources by tier:    ${JSON.stringify(tally((sources ?? []) as never, "source_tier"))}`);
  log(`  unresolved conflicts (resolution IS NULL): ${(conflicts ?? []).length}`);
}

async function showRun(runId: string) {
  const { data: run } = await admin
    .from("research_orchestration_runs")
    .select("*")
    .eq("id", runId)
    .single();
  const { data: steps } = await admin
    .from("research_orchestration_steps")
    .select("step_index,label,status,detail")
    .eq("run_id", runId)
    .order("step_index");
  for (const s of steps ?? []) {
    log(
      `  ${String(s.step_index).padStart(2)} ${s.label.padEnd(24)} ${String(s.status).padEnd(9)} ${s.detail ?? ""}`,
    );
  }
  log(
    `  → status ${run!.status} · readiness ${run!.readiness ?? "—"} · provider ${run!.provider_requests} · ai ${run!.ai_calls} · $${Number(run!.estimated_cost_usd).toFixed(4)} · packets ${run!.packet_start_version ?? "—"}→${run!.packet_final_version ?? "—"}`,
  );
  if ((run!.warnings as string[]).length) log(`  ! ${(run!.warnings as string[]).join(" | ")}`);
  return run!;
}

async function main() {
  const { data: profile } = await admin.from("profiles").select("id").limit(1).single();
  const userId = profile!.id as string;

  const ids = {
    india: "<INDIA_RUN_ID>",
    us: "<US_RUN_ID>",
  };

  // ------------------------------------------------------------- Test 1: India
  log("\n=== Test 1 — India orchestration (Tata Steel) ===");
  const r1 = await runResearchOrchestration(db, { storyId: ids.india, userId });
  const run1 = await showRun(r1.runId);
  ok(run1.status !== "FAILED", "India run completed without failure", String(run1.status));
  ok(!!run1.readiness, "Readiness verdict recorded", String(run1.readiness));
  ok(!!run1.packet_final_version, "Research packet produced", `v${run1.packet_final_version}`);
  ok(
    run1.indianapi_requests <= 5,
    "IndianAPI per-story budget respected",
    `${run1.indianapi_requests} calls`,
  );

  // ---------------------------------------------------------- Test 3: cache path
  log("\n=== Test 3 — cache path (immediate India re-run) ===");
  const r3 = await runResearchOrchestration(db, { storyId: ids.india, userId });
  const run3 = await showRun(r3.runId);
  ok(run3.is_rerun === true, "Re-run flagged as a re-run");
  ok(
    run3.indianapi_requests < Math.max(1, run1.indianapi_requests) || run3.indianapi_requests === 0,
    "Fresh data reused — fewer/no provider calls on re-run",
    `${run1.indianapi_requests} → ${run3.indianapi_requests}`,
  );
  ok(run3.web_searches === 0, "Cache re-run spends no web searches", `${run3.web_searches}`);
  ok(
    run3.packet_final_version === run3.packet_start_version,
    "Cache re-run does not mint a packet version",
    `v${run3.packet_start_version} → v${run3.packet_final_version}`,
  );
  ok(
    Number(run3.estimated_cost_usd) <= Number(run1.estimated_cost_usd),
    "Cache re-run is not more expensive than the first run",
    `$${Number(run1.estimated_cost_usd).toFixed(4)} → $${Number(run3.estimated_cost_usd).toFixed(4)}`,
  );
  log(`  delta: ${JSON.stringify(run3.delta)}`);
  const cacheAi = await aiCallsDuring(run3);
  ok(
    cacheAi.length === 0,
    "Cache re-run spends no AI tokens when evidence is semantically unchanged",
    `${cacheAi.length} call(s)`,
  );
  await evidenceProfile(String(run3.company_id), ids.india);

  // ---------------------------------------------------------------- Test 2: US
  log("\n=== Test 2 — US orchestration (Alphabet) ===");
  const r2 = await runResearchOrchestration(db, { storyId: ids.us, userId });
  const run2 = await showRun(r2.runId);
  ok(run2.status !== "FAILED", "US run completed without failure", String(run2.status));
  ok(
    run2.coverage_flag === "PARTIAL_MARKET_COVERAGE" || run2.coverage_flag === null,
    "US market coverage handled honestly",
    String(run2.coverage_flag),
  );
  ok(!!run2.readiness, "US readiness verdict recorded", String(run2.readiness));
  log(
    `  packets: v${run2.packet_start_version} → v${run2.packet_final_version} · SEC requests ${run2.sec_requests} · web ${run2.web_searches}`,
  );
  log(`  readiness reason: ${run2.readiness_reason ?? "—"}`);
  log(`  delta: ${JSON.stringify(run2.delta)}`);
  await aiCallsDuring(run2);
  await evidenceProfile(String(run2.company_id), ids.us);
  ok(
    run2.indianapi_requests === 0,
    "US story issues no IndianAPI calls",
    `${run2.indianapi_requests}`,
  );

  // -------------------------------------------------- Test 4: incomplete story
  log("\n=== Test 4 — incomplete story (no data on file) ===");
  const { data: company } = await admin
    .from("companies")
    .insert({
      name: `Acceptance Shell Corp ${Date.now()}`,
      ticker: `ZZTEST${Math.floor(Math.random() * 999)}`,
      exchange: "NASDAQ",
      country: "US",
      currency: "USD",
      is_demo: true,
      created_by: userId,
    })
    .select("id")
    .single();
  const { data: story } = await admin
    .from("stories")
    .insert({
      company_id: company!.id,
      title: "Shell company with no evidence on file",
      story_type: "Custom",
      priority: "Low",
      status: "New",
      is_demo: true,
      created_by: userId,
    })
    .select("id")
    .single();

  const r4 = await runResearchOrchestration(db, { storyId: story!.id, userId });
  const run4 = await showRun(r4.runId);
  ok(
    ["INSUFFICIENT_DATA", "NEEDS_REVIEW", "FAILED"].includes(String(run4.status)),
    "Empty story does not report READY_FOR_CONTENT",
    String(run4.status),
  );
  ok(
    run4.readiness !== "READY_FOR_CONTENT",
    "Readiness gate refuses content on missing evidence",
    `${run4.readiness ?? "—"} · ${run4.readiness_reason ?? ""}`,
  );
  const { data: shellClaims } = await admin
    .from("claims")
    .select("id,claim_category,verification_status")
    .eq("story_id", story!.id);
  const { data: shellSources } = await admin
    .from("sources")
    .select("id")
    .eq("company_id", company!.id);
  const { data: shellScenarios } = await admin
    .from("scenario_forecasts")
    .select("id,packet_id")
    .eq("packet_id", run4.packet_final_id ?? "00000000-0000-0000-0000-000000000000");
  const unsupportedOnly = (shellClaims ?? []).every(
    (c) => String(c.verification_status) === "Unsupported",
  );
  ok(
    unsupportedOnly,
    "Every claim on an evidence-free story stays Unsupported",
    `${(shellClaims ?? []).length} claim(s)`,
  );
  ok(
    (shellSources ?? []).length === 0,
    "No sources fabricated for a story with no evidence",
    `${(shellSources ?? []).length}`,
  );
  ok(
    run4.web_searches <= 6,
    "Search effort bounded on an empty story",
    `${run4.web_searches} search(es)`,
  );

  ok(
    (shellScenarios ?? []).length === 0,
    "No scenarios produced without supporting evidence",
    `${(shellScenarios ?? []).length}`,
  );
  await aiCallsDuring(run4);

  // ------------------------------------------- Test 5: readiness regression
  log("\n=== Test 5 — readiness regression on claim_category ===");
  const src = "00000000-0000-0000-0000-000000000001";
  const cat = (
    claim_category: string,
    verification_status: string,
    source_id: string | null = src,
  ) => ({ claim_category, verification_status, source_id, is_critical: true });

  ok(isClaimSupported(cat("FACT", "Verified", null)), "FACT / Verified counts as supported");
  ok(
    isClaimSupported(cat("CALCULATION", "Needs Cross-Check")),
    "CALCULATION with a source is supported",
  );
  ok(
    isClaimAttributed(cat("ANALYST VIEW", "Needs Cross-Check")) &&
      isClaimSupported(cat("ANALYST VIEW", "Needs Cross-Check")),
    "ANALYST VIEW stays attributed without becoming FACT",
  );
  ok(
    isClaimAttributed(cat("COMPANY CLAIM", "Needs Cross-Check")),
    "COMPANY CLAIM stays attributed without becoming FACT",
  );
  ok(
    isClaimAttributed(cat("NEWS REPORT", "Needs Cross-Check")),
    "NEWS REPORT attributed via its source",
  );
  ok(
    !isClaimSupported(cat("NEWS REPORT", "Unsupported")),
    "Unsupported NEWS REPORT carries no weight",
  );
  ok(
    !isClaimSupported(cat("INFERENCE", "Needs Cross-Check")),
    "INFERENCE is not treated as evidence",
  );
  ok(
    !isClaimSupported(cat("SCENARIO", "Needs Cross-Check")),
    "SCENARIO is not a verified historical fact",
  );
  ok(!isClaimSupported(cat("UNSUPPORTED", "Unsupported")), "UNSUPPORTED never supports readiness");
  ok(!isClaimSupported(cat("RUMOUR", "Verified")), "RUMOUR cannot establish critical readiness");
  ok(!isClaimSupported(cat("SCENARIO", "Verified")), "SCENARIO is never current/historical fact");
  ok(!isClaimSupported(cat("INFERENCE", "Verified")), "INFERENCE stays qualified, never a fact");

  const summary = summarizeClaims([
    cat("FACT", "Verified"),
    cat("ANALYST VIEW", "Needs Cross-Check"),
    cat("UNSUPPORTED", "Unsupported"),
  ]);
  ok(
    summary.verified === 1 && summary.attributed === 1 && summary.unsupported === 1,
    "summarizeClaims reads claim_category",
    JSON.stringify(summary),
  );

  const blocked = evaluateReadiness({
    catalyst: "VERIFIED",
    criticalClaimsTotal: 2,
    criticalClaimsSupported: 1,
    coreUnsupportedClaims: 1,
    claims: { total: 2, verified: 1, attributed: 0, crossCheck: 0, unsupported: 1, conflicting: 0 },
    criticalConflicts: 0,
    sources: { total: 2, tier1: 1, tier2: 1, tier3: 0, tier4: 0 },
    packetExists: true,
    scenarioExpected: true,
    scenarioComplete: true,
    completionPct: 80,
    verificationScore: 70,
    traceabilityIntact: true,
  });
  ok(
    blocked.readiness !== "READY_FOR_CONTENT",
    "UNSUPPORTED core claim blocks readiness",
    blocked.readiness,
  );

  const attributedOnly = evaluateReadiness({
    catalyst: "ATTRIBUTED",
    criticalClaimsTotal: 2,
    criticalClaimsSupported: 2,
    coreUnsupportedClaims: 0,
    claims: { total: 4, verified: 1, attributed: 3, crossCheck: 0, unsupported: 0, conflicting: 0 },
    criticalConflicts: 0,
    sources: { total: 3, tier1: 1, tier2: 2, tier3: 0, tier4: 0 },
    packetExists: true,
    scenarioExpected: true,
    scenarioComplete: true,
    completionPct: 80,
    verificationScore: 75,
    traceabilityIntact: true,
  });
  ok(
    attributedOnly.readiness === "READY_FOR_CONTENT",
    "Attributed analyst/company claims do not block readiness",
    attributedOnly.readiness,
  );

  // ------------------------------------------------ Test 6: packet versioning
  log("\n=== Test 6 — packet version discipline ===");
  ok(
    run3.packet_final_version === run1.packet_final_version,
    "Bare re-run does not mint a new packet version",
    `run1 v${run1.packet_final_version} · run3 v${run3.packet_final_version}`,
  );

  // ------------------------------------------- Test 7: packet-version assertions
  log("\n=== Test 7 — packet version assertions (pure) ===");
  const snap = (o: Partial<EvidenceSnapshot>): EvidenceSnapshot => ({
    hash: "h",
    claims: {},
    sources: {},
    conflicts: {},
    sections: {},
    gaps: {},
    ...o,
  });
  const now = new Date().toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  const base = snap({ claims: { c1: "aaa" }, sources: { s1: "bbb" } });

  const caseA = computePacketDelta({
    previous: base,
    current: snap({ claims: { c1: "aaa" }, sources: { s1: "bbb" } }),
    touchedAt: { "claim:c1": now, "source:s1": now },
    since: past,
  });
  ok(
    !caseA.material && caseA.counts.timestampOnlyIgnored === 2,
    "CASE A — updated_at only → no new packet",
    caseA.detail,
  );

  const caseB = computePacketDelta({
    previous: base,
    current: snap({ claims: { c1: "aaa" }, sources: { s1: "bbb" } }),
    touchedAt: { "claim:c1": now },
    since: past,
  });
  ok(!caseB.material, "CASE B — verification rerun, same conclusion → no new packet", caseB.detail);

  const caseC = computePacketDelta({
    previous: base,
    current: snap({ claims: { c1: "aaa" }, sources: { s1: "bbb", s2: "tier2-new" } }),
    touchedAt: {},
    since: past,
  });
  ok(
    caseC.material && caseC.counts.newSources === 1,
    "CASE C — new Tier-2 source → new packet",
    caseC.detail,
  );

  const caseD = computePacketDelta({
    previous: base,
    current: snap({ claims: { c1: "aaa-verified" }, sources: { s1: "bbb" } }),
    touchedAt: {},
    since: past,
  });
  ok(
    caseD.material && caseD.counts.changedClaims === 1,
    "CASE D — Needs Cross-Check → Verified → new packet",
    caseD.detail,
  );

  const caseE = computePacketDelta({
    previous: base,
    current: snap({ claims: { c1: "aaa" }, sources: { s1: "bbb" }, conflicts: { k1: "open" } }),
    touchedAt: {},
    since: past,
  });
  ok(
    caseE.material && caseE.counts.conflictDelta === 1,
    "CASE E — new conflict → new packet",
    caseE.detail,
  );

  const caseF = computePacketDelta({
    previous: snap({ claims: { c1: "aaa" }, conflicts: { k1: "open" } }),
    current: snap({ claims: { c1: "aaa" }, conflicts: { k1: "resolved" } }),
    touchedAt: {},
    since: past,
  });
  ok(
    caseF.material && caseF.counts.conflictDelta === 1,
    "CASE F — conflict resolves → new packet",
    caseF.detail,
  );

  const caseG = computePacketDelta({
    previous: base,
    current: snap({ claims: { c1: "aaa" }, sources: { s1: "bbb" } }),
    touchedAt: { "source:s1": now },
    since: past,
  });
  ok(
    !caseG.material && caseG.counts.timestampOnlyIgnored === 1,
    "CASE G — retrieved_at only → no new packet",
    caseG.detail,
  );

  const caseH = isScenarioFresh({
    packetId: "packet-v11",
    scenarios: [
      { packet_id: "packet-v10", scenario_type: "Bull" },
      { packet_id: "packet-v10", scenario_type: "Base" },
      { packet_id: "packet-v10", scenario_type: "Bear" },
    ],
  });
  ok(!caseH.fresh, "CASE H — new packet invalidates old scenarios", caseH.reason);

  // ------------------------------------------- Test 8: web freshness assertions
  log("\n=== Test 8 — web research freshness assertions (pure) ===");
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
  const thirteenHoursAgo = new Date(Date.now() - 13 * 3600_000).toISOString();
  const webBase = {
    now: new Date().toISOString(),
    freshnessHours: 12,
    planWantsWeb: true,
    newResearchGaps: 0,
    newMaterialEvents: 0,
    staleCriticalSources: 0,
    forceRefresh: false,
  };
  const wA = decideWebResearch({ ...webBase, lastRunAt: twoHoursAgo });
  ok(!wA.run, "CASE A — 2h old, nothing changed → skip", wA.reason);
  const wB = decideWebResearch({ ...webBase, lastRunAt: twoHoursAgo, newResearchGaps: 1 });
  ok(wB.run, "CASE B — 2h old + new RESEARCH_REQUIRED gap → run", wB.reason);
  const wC = decideWebResearch({ ...webBase, lastRunAt: twoHoursAgo, newMaterialEvents: 1 });
  ok(wC.run, "CASE C — 2h old + new SEC/company event → run", wC.reason);
  const wD = decideWebResearch({ ...webBase, lastRunAt: thirteenHoursAgo, planWantsWeb: false });
  ok(!wD.run, "CASE D — timer expired but plan needs no web evidence → skip", wD.reason);
  const wE = decideWebResearch({ ...webBase, lastRunAt: null });
  ok(wE.run, "No prior web research → run", wE.reason);

  // ------------------------------------------ Test 9: scenario freshness assertions
  log("\n=== Test 9 — scenario freshness assertions (pure) ===");
  const sFresh = isScenarioFresh({
    packetId: "p10",
    scenarios: [
      { packet_id: "p10", scenario_type: "Bull" },
      { packet_id: "p10", scenario_type: "Base" },
      { packet_id: "p10", scenario_type: "Bear" },
    ],
  });
  ok(sFresh.fresh, "Packet v10 scenarios reused when nothing changed", sFresh.reason);
  const sStory = isScenarioFresh({
    packetId: "p11",
    scenarios: [
      { packet_id: "p10", scenario_type: "Bull" },
      { packet_id: "p10", scenario_type: "Base" },
      { packet_id: "p10", scenario_type: "Bear" },
      { packet_id: "p9", scenario_type: "Bull" },
    ],
  });
  ok(!sStory.fresh, "Story-level scenario count is not proof of freshness", sStory.reason);

  log("\n=== Cost comparison — first run vs cache run ===");
  for (const [label, r] of [
    ["FIRST", run1],
    ["CACHE", run3],
  ] as const) {
    log(
      `  ${label}: provider ${r.provider_requests} · web ${r.web_searches} · ai ${r.ai_calls} · tokens ${r.input_tokens}/${r.output_tokens} · $${Number(r.estimated_cost_usd).toFixed(4)} · packet v${r.packet_start_version}→v${r.packet_final_version}`,
    );
  }

  log("\nDone.");
}

runOwnerAcceptance(main).catch((e) => {
  console.error(e);
  process.exit(1);
});
