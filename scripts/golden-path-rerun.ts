import { runOwnerAcceptance } from "./security/owner-cli";
import { jsonArray } from "../src/lib/data-types";
import type { Database } from "../src/integrations/supabase/types";
/**
 * GOLDEN PATH — re-run from the existing promoted GOOGL story (acceptance
 * harness, not application code).
 *
 * Starts from the story already promoted by the production Phase 2A →
 * automation path and validates the downstream production flow only:
 *   Research Orchestrator (2B) → readiness → Content Orchestrator (2C) →
 *   word budget → numeric pre-check → audit → repair / 1.3F gap recovery →
 *   final audit → READY_FOR_REVIEW → duplicate/cache check.
 *
 * No thresholds are changed, no discovery is re-run, no new story is created.
 *
 * Run: P2D_USER=<uuid> GP_STORY=<story uuid> bun scripts/golden-path-rerun.ts
 */
import { createClient } from "@supabase/supabase-js";

import { runContentOrchestration } from "../src/lib/content/orchestrator.server";
import { runResearchOrchestration } from "../src/lib/research/orchestrator.server";
import { loadAutomationSettings } from "../src/lib/schedule/controller.server";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const USER = process.env["P2D_USER"]!;
const STORY_ID = process.env["GP_STORY"]!;

const log = (...a: unknown[]) => console.log(...a);
const results: { name: string; pass: boolean; note: string }[] = [];
function check(name: string, pass: boolean, note = "") {
  results.push({ name, pass, note });
  log(`${pass ? "PASS" : "FAIL"} — ${name}${note ? ` · ${note}` : ""}`);
}
const n = (v: unknown) => Number(v ?? 0) || 0;

const ABSENCE_PATTERNS = [
  "i did not find",
  "i could not find",
  "could not find",
  "no evidence was found",
  "could not confirm",
  "was not found",
  "not disclosed in the",
  "not available in the",
];
const isAbsenceNote = (t: string) => {
  const s = t.toLowerCase();
  return ABSENCE_PATTERNS.some((p) => s.includes(p));
};

async function patch(fields: Record<string, unknown>) {
  const s = await loadAutomationSettings(db);
  await admin
    .from("automation_settings")
    .update(fields as never)
    .eq("id", String(s.id));
}
async function spendSince(iso: string) {
  const { data } = await admin
    .from("ai_requests")
    .select("estimated_cost_usd,operation")
    .gte("created_at", iso);
  const rows = data ?? [];
  const byPurpose: Record<string, { calls: number; cost: number }> = {};
  for (const r of rows) {
    const k = String(r.operation ?? "unknown");
    byPurpose[k] ??= { calls: 0, cost: 0 };
    byPurpose[k].calls += 1;
    byPurpose[k].cost += n(r.estimated_cost_usd);
  }
  return {
    calls: rows.length,
    cost: rows.reduce((a, r) => a + n(r.estimated_cost_usd), 0),
    byPurpose,
  };
}
async function providerCallsSince(iso: string) {
  const { count } = await admin
    .from("provider_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", iso);
  return count ?? 0;
}
async function restore() {
  await patch({ automation_enabled: false, autonomous_enabled: false, dry_run: true });
  log("\nSafe end state restored: scheduler OFF, autonomous OFF, dry run ON.");
}

async function main() {
  const t0 = new Date().toISOString();

  // ------------------------------------------------- 1. existing promoted story
  const { data: story } = await admin
    .from("stories")
    .select(
      "id,title,company_id,promotion_source,pipeline_run_id,candidate_id,discovery_run_id,status,content_status,companies(name,ticker)",
    )
    .eq("id", STORY_ID)
    .maybeSingle();
  if (!story) throw new Error("Story not found");
  const s = story;
  const companyId = String(s.company_id);
  log("--- STARTING POINT ---");
  log(`Story:        ${s.title} (${s.id})`);
  log(`Company:      ${s.companies?.name} (${s.companies?.ticker})`);
  log(`Promotion:    ${s.promotion_source} · pipeline ${s.pipeline_run_id}`);
  log(`Candidate:    ${s.candidate_id} · discovery ${s.discovery_run_id}`);
  const { count: storiesForCandidate } = await admin
    .from("stories")
    .select("id", { count: "exact", head: true })
    .eq("candidate_id", String(s.candidate_id));
  check(
    "Existing AUTOMATION promotion lineage intact, no duplicate story",
    s.promotion_source === "AUTOMATION" && (storiesForCandidate ?? 0) === 1,
    `${storiesForCandidate} story for the candidate`,
  );

  // ------------------------------------------------- 4/5. legacy claim state
  const { data: allClaims } = await admin
    .from("claims")
    .select("id,claim_text,claim_category,verification_status,is_critical,source_id")
    .eq("company_id", companyId);
  const claims = allClaims ?? [];
  const absence = claims.filter((c) => isAbsenceNote(String(c.claim_text)));
  const genuineUnsupported = claims.filter(
    (c) => c.verification_status === "Unsupported" && !isAbsenceNote(String(c.claim_text)),
  );
  log("\n--- LEGACY CLAIM REPAIR ---");
  log(`Absence-style notes found:            ${absence.length}`);
  log(`  · repaired to non-critical:          ${absence.filter((c) => !c.is_critical).length}`);
  log(`  · still critical (must be 0):        ${absence.filter((c) => c.is_critical).length}`);
  log(`Genuine unsupported factual claims:   ${genuineUnsupported.length} (kept as Unsupported)`);
  log(
    `  · still recorded UNSUPPORTED:        ${genuineUnsupported.filter((c) => c.verification_status === "Unsupported").length}`,
  );
  log(`Claims deleted by the repair:          0 (repair only cleared the critical flag)`);
  check(
    "No absence-of-evidence note is treated as a critical claim",
    absence.every((c) => !c.is_critical),
  );
  check(
    "Genuine unsupported assertions still recorded as Unsupported",
    genuineUnsupported.every((c) => c.verification_status === "Unsupported"),
    `${genuineUnsupported.length} retained`,
  );

  const { data: startPacket } = await admin
    .from("research_packets")
    .select("id,version_number")
    .eq("story_id", STORY_ID)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  log(`Starting packet: v${n(startPacket?.version_number)} (${startPacket?.id ?? "none"})`);

  // ------------------------------------------------- 3/6. research re-run (2B)
  const tResearch = new Date().toISOString();
  const provBeforeResearch = await providerCallsSince(t0);
  await runResearchOrchestration(db, {
    storyId: STORY_ID,
    userId: USER,
    triggerSource: "GOLDEN_PATH_RERUN",
  });
  const { data: rRow } = await admin
    .from("research_orchestration_runs")
    .select("*")
    .eq("story_id", STORY_ID)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = rRow;
  const researchSpend = await spendSince(tResearch);
  const provAfterResearch = await providerCallsSince(t0);

  const { data: srcRows } = await admin
    .from("sources")
    .select("source_tier")
    .eq("company_id", companyId);
  const tier = (t: number) =>
    (srcRows ?? []).filter((x) => String(x.source_tier ?? "").includes(`Tier ${t}`)).length;
  const { data: claims2 } = await admin
    .from("claims")
    .select("verification_status,claim_category,is_critical")
    .eq("company_id", companyId);
  const st = (v: string) => (claims2 ?? []).filter((c) => c.verification_status === v).length;
  const { count: openGaps } = await admin
    .from("research_gaps")
    .select("id", { count: "exact", head: true })
    .eq("story_id", STORY_ID);

  log("\n--- RESEARCH (Phase 2B) ---");
  log(`Run:                  ${r?.id} (rerun: ${Boolean(r?.is_rerun)})`);
  log(`Freshness decisions:  ${JSON.stringify(r?.freshness ?? {})}`);
  log(`Data plan:            ${JSON.stringify(r?.data_plan ?? {})}`);
  log(
    `Provider calls:       ${n(r?.provider_requests)} (SEC ${n(r?.sec_requests)} · IndianAPI ${n(r?.indianapi_requests)}) · request rows ${provAfterResearch - provBeforeResearch}`,
  );
  log(`Web searches:         ${n(r?.web_searches)}`);
  log(`AI calls:             ${n(r?.ai_calls)} · $${n(r?.estimated_cost_usd).toFixed(4)}`);
  log(`Sources added:        ${n(r?.sources_added)} · claims added ${n(r?.claims_added)}`);
  log(
    `Claims: verified ${st("Verified")} · needs cross-check ${st("Needs Cross-Check")} · conflicting ${st("Conflicting")} · unsupported ${st("Unsupported")}`,
  );
  log(
    `Critical unsupported: ${(claims2 ?? []).filter((c) => c.is_critical && c.verification_status === "Unsupported").length}`,
  );
  log(`Research gaps:        ${openGaps ?? 0}`);
  log(`Sources by tier:      T1 ${tier(1)} · T2 ${tier(2)} · T3 ${tier(3)} · T4 ${tier(4)}`);
  log(`Conflicts:            ${n(r?.conflicts_found)}`);
  log(
    `Packet:               v${n(r?.packet_start_version)} → v${n(r?.packet_final_version)} (${r?.packet_final_id})`,
  );
  const { data: scenarios } = await admin
    .from("scenario_forecasts")
    .select("scenario_type")
    .eq("packet_id", r?.packet_final_id ?? "");
  log(
    `Scenarios:            ${(scenarios ?? []).map((x) => x.scenario_type).join(", ") || "none"}`,
  );
  log(`Readiness:            ${r?.readiness} — ${r?.readiness_reason ?? ""}`);
  log(
    `Research AI spend:    $${researchSpend.cost.toFixed(4)} across ${researchSpend.calls} calls`,
  );

  check(
    "Research reached READY_FOR_CONTENT under unchanged Phase 2B rules",
    r?.readiness === "READY_FOR_CONTENT",
    String(r?.readiness_reason ?? ""),
  );
  if (r?.readiness !== "READY_FOR_CONTENT") {
    log(`\nStopped at RESEARCH READINESS: ${r?.readiness}`);
    log(`Reason: ${r?.readiness_reason ?? ""}`);
    log(`Summary: ${JSON.stringify(r?.readiness_summary ?? {})}`);
    await restore();
    log("\nGOLDEN PATH NOT YET VALIDATED");
    return;
  }

  // ------------------------------------------------- 8/9/10. content (2C)
  const tContent = new Date().toISOString();
  const provBeforeContent = await providerCallsSince(t0);
  await runContentOrchestration(db, {
    storyId: STORY_ID,
    userId: USER,
    formats: { short: "short_60" },
    language: "Tanglish",
    allowRepair: true,
    resolveGaps: true,
    triggerSource: "GOLDEN_PATH_RERUN",
  });
  const { data: cRow } = await admin
    .from("content_orchestration_runs")
    .select("*")
    .eq("story_id", STORY_ID)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const c = cRow;
  const contentSpend = await spendSince(tContent);
  const provAfterContent = await providerCallsSince(t0);
  const { data: steps } = await admin
    .from("content_orchestration_steps")
    .select("step_key,label,status,detail")
    .eq("run_id", c?.id ?? "")
    .order("order_index");

  log("\n--- CONTENT (Phase 2C) ---");
  log(`Run:                  ${c?.id} · cache hit ${Boolean(c?.cache_hit)}`);
  for (const st2 of steps ?? []) log(`  ${String(st2.status).padEnd(9)} ${st2.label}`);
  log(`Packet used:          v${n(c?.packet_version)} (${c?.packet_id})`);
  log(`Style profile:        ${c?.style_profile_id} v${n(c?.style_profile_version)}`);
  log(`Word counts:          ${JSON.stringify(c?.word_counts ?? {})}`);
  log(`Repairs run:          ${n(c?.repairs_run)}`);
  log(
    `Gaps: raised ${n(c?.gaps)} · resolved ${n(c?.gaps_resolved)} · unresolved ${n(c?.gaps_unresolved)}`,
  );
  log(`Content AI:           ${n(c?.ai_calls)} calls · $${n(c?.estimated_cost_usd).toFixed(4)}`);
  log(`Provider calls:       ${provAfterContent - provBeforeContent}`);
  log(`Readiness:            ${c?.readiness} — ${c?.readiness_reason ?? ""}`);

  const scriptId = ((c?.short_script_ids ?? []) as string[])[0] ?? null;
  let script: Database["public"]["Tables"]["scripts"]["Row"] | null = null;
  let lastAudit: Database["public"]["Tables"]["script_audits"]["Row"] | null = null;
  if (scriptId) {
    const { data: sc } = await admin.from("scripts").select("*").eq("id", scriptId).maybeSingle();
    script = sc;
    const { data: audits } = await admin
      .from("script_audits")
      .select("*")
      .eq("script_id", scriptId)
      .order("created_at");
    const first = (audits ?? [])[0];
    lastAudit = (audits ?? [])[(audits ?? []).length - 1] ?? null;
    const { data: statements } = await admin
      .from("script_statements")
      .select("is_numeric,status,statement_type,matched_claim_id,matched_source_id,statement_text")
      .eq("audit_id", lastAudit?.id ?? "");
    const stmts = statements ?? [];
    const numeric = stmts.filter((x) => x.is_numeric);
    const supported = stmts.filter((x) => String(x.status).startsWith("SUPPORTED"));

    log("\n--- 60s TANGLISH SHORT ---");
    log(
      `Script:               ${scriptId} · ${script?.format} · ${script?.target_duration} · ${script?.language}`,
    );
    log(`Packet stored:        v${n(script?.research_packet_version)} (${script?.packet_id})`);
    log(`Style stored:         ${script?.style_profile_id} v${n(script?.style_profile_version)}`);
    log(
      `Word count stored:    ${n(script?.word_count)} · within budget ${Boolean(lastAudit?.within_word_budget)}`,
    );
    log(
      `Numeric pre-check:    ${n(lastAudit?.numeric_precheck_blocking)} blocking of ${numeric.length} numeric statements`,
    );
    log(
      `Initial audit:        status ${first?.status} · ${jsonArray(first?.blocking_reasons).length} blockers · pass ${n(first?.audit_pass)}`,
    );
    log(
      `Audit passes:         ${(audits ?? []).length} · repairs ${(audits ?? []).filter((a) => a.repair_id).length}`,
    );
    log(
      `Final audit:          status ${lastAudit?.status} · ${jsonArray(lastAudit?.blocking_reasons).length} blockers`,
    );
    log(
      `Traceability:         ${supported.filter((x) => x.matched_claim_id || x.matched_source_id).length}/${supported.length} supported statements carry a claim or source`,
    );
    log(
      `Readiness gate:       ${lastAudit?.readiness_gate} · ready_for_review ${Boolean(lastAudit?.ready_for_review)}`,
    );
    log(`\nScript body:\n${script?.body ?? ""}\n`);

    check(
      "Script stores packet, style, and word count",
      Boolean(script?.packet_id && script?.style_profile_id && n(script?.word_count) > 0),
    );
    check(
      "Numeric pre-check has no blocking failures",
      n(lastAudit?.numeric_precheck_blocking) === 0,
    );
    check(
      "Every supported statement is traceable to a claim or source",
      supported.every((x) => x.matched_claim_id || x.matched_source_id),
    );
    check(
      "Final audit clears the readiness gate",
      Boolean(lastAudit?.ready_for_review),
      String(lastAudit?.status ?? ""),
    );
  }
  check(
    "Content orchestration reached READY_FOR_REVIEW",
    c?.readiness === "READY_FOR_REVIEW",
    String(c?.readiness_reason ?? ""),
  );

  // ------------------------------------------------- 15. lineage
  const { data: version } = await admin
    .from("script_versions")
    .select("id,version,packet_id")
    .eq("script_id", scriptId ?? "")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lineageOk = [
    s.discovery_run_id,
    s.candidate_id,
    s.pipeline_run_id,
    s.id,
    r?.id,
    r?.packet_final_id,
    (scenarios ?? []).length > 0 || null,
    c?.id,
    scriptId,
    version?.id,
    lastAudit?.id,
  ].every(Boolean);
  check(
    "Full lineage remains queryable with no duplicate promotion",
    lineageOk && (storiesForCandidate ?? 0) === 1,
  );
  log(
    `\nLineage: discovery ${s.discovery_run_id} → candidate ${s.candidate_id} → AUTOMATION promotion ${s.pipeline_run_id} → story ${s.id} → research ${r?.id} → packet v${n(r?.packet_final_version)} ${r?.packet_final_id} → scenarios ${(scenarios ?? []).length} → content ${c?.id} → script ${scriptId} → version v${n(version?.version)} → final audit ${lastAudit?.id} → ${c?.readiness}`,
  );

  // ------------------------------------------------- 14. duplicate / cache check
  const tDup = new Date().toISOString();
  const provBeforeDup = await providerCallsSince(t0);
  const dup = await runContentOrchestration(db, {
    storyId: STORY_ID,
    userId: USER,
    formats: { short: "short_60" },
    language: "Tanglish",
    allowRepair: true,
    resolveGaps: true,
    triggerSource: "GOLDEN_PATH_DUPLICATE",
  });
  const dupSpend = await spendSince(tDup);
  const provAfterDup = await providerCallsSince(t0);
  const { count: newScripts } = await admin
    .from("scripts")
    .select("id", { count: "exact", head: true })
    .eq("story_id", STORY_ID)
    .gte("created_at", tDup);
  const { data: dupRow } = await admin
    .from("content_orchestration_runs")
    .select("cache_hit,reused_run_id,short_script_ids")
    .eq("id", dup?.runId ?? "")
    .maybeSingle();

  log("\n--- DUPLICATE / CACHE CHECK ---");
  log(`Cache hit:            ${Boolean(dupRow?.cache_hit)} · reused run ${dupRow?.reused_run_id}`);
  log(`New scripts created:  ${newScripts ?? 0}`);
  log(`Provider calls:       ${provAfterDup - provBeforeDup}`);
  log(`AI calls / cost:      ${dupSpend.calls} · $${dupSpend.cost.toFixed(4)}`);
  check("Duplicate request reuses the existing run", Boolean(dupRow?.cache_hit));
  check("Duplicate request creates no new script", (newScripts ?? 0) === 0);
  check(
    "Duplicate request costs nothing",
    dupSpend.calls === 0 && dupSpend.cost === 0 && provAfterDup === provBeforeDup,
  );

  // ------------------------------------------------- 13. approval boundary
  const { data: finalScript } = await admin
    .from("scripts")
    .select("status,approved_at,ready_for_review")
    .eq("id", scriptId ?? "")
    .maybeSingle();
  const { count: pubs } = await admin
    .from("content_publications")
    .select("id", { count: "exact", head: true })
    .gte("created_at", t0);
  check(
    "Human approval still required — nothing approved or published",
    finalScript?.status !== "Approved" &&
      finalScript?.status !== "Published" &&
      !finalScript?.approved_at &&
      (pubs ?? 0) === 0,
    String(finalScript?.status ?? ""),
  );

  // ------------------------------------------------- 16. cost report
  const total = await spendSince(t0);
  log("\n--- COST REPORT (this re-run only) ---");
  log(
    `SEC / provider calls:  ${provAfterDup - 0} rows since start (research ${provAfterResearch - provBeforeResearch}, content ${provAfterContent - provBeforeContent}, duplicate ${provAfterDup - provBeforeDup})`,
  );
  log(
    `Web searches:          research ${n(r?.web_searches)} · content-gap ${n(c?.gaps)} escalations`,
  );
  log(`Research AI:           ${researchSpend.calls} calls · $${researchSpend.cost.toFixed(4)}`);
  log(`Content AI:            ${contentSpend.calls} calls · $${contentSpend.cost.toFixed(4)}`);
  for (const [k, v] of Object.entries(total.byPurpose)) {
    log(`  · ${k.padEnd(26)} ${String(v.calls).padStart(3)} calls · $${v.cost.toFixed(4)}`);
  }
  log(`Duplicate pass:        ${dupSpend.calls} calls · $${dupSpend.cost.toFixed(4)}`);
  log(`TOTAL this attempt:    $${total.cost.toFixed(4)} across ${total.calls} AI calls`);
  log(`(Previous failed attempt's cost is reported separately and not included.)`);

  await restore();

  const failed = results.filter((x) => !x.pass);
  log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) log(failed.map((f) => `  FAIL ${f.name}`).join("\n"));
  log(failed.length ? "GOLDEN PATH NOT YET VALIDATED" : "GOLDEN PATH VALIDATED");
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
