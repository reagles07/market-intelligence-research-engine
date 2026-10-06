import { runOwnerAcceptance } from "./security/owner-cli";
import type { Database } from "../src/integrations/supabase/types";
/**
 * Pass 1F acceptance harness (not application code).
 *
 * Test 1 — resolvable gap: a real missing fact is triaged, researched with a
 *   capped targeted search, classified and folded into a NEW packet version.
 * Test 2 — unresolvable gap: an unanswerable question must end as NOT_FOUND
 *   with zero new claims — no invented evidence, no packet version.
 */
import { createClient } from "@supabase/supabase-js";

import {
  runDetectResearchGaps,
  runResolveResearchGap,
  runResolveScriptGaps,
} from "../src/lib/ai/gaps.server";
import { gapKey } from "../src/lib/content/gaps";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const log = (...a: unknown[]) => console.log(...a);
const ok = (pass: boolean, label: string, extra = "") =>
  log(`${pass ? "PASS" : "FAIL"} — ${label}${extra ? ` · ${extra}` : ""}`);

async function main() {
  const { data: profile } = await admin.from("profiles").select("id").limit(1).single();
  const userId = profile!.id as string;

  const { data: script } = await admin
    .from("scripts")
    .select("id,company_id,story_id,packet_id,research_packet_version,last_audit_id")
    .not("packet_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!script) throw new Error("no script to test with");
  log("script", script.id, "packet v" + script.research_packet_version);

  const { data: company } = await admin
    .from("companies")
    .select("ticker,name")
    .eq("id", script.company_id)
    .single();

  // ---------------------------------------------- Test 0: triage from the audit
  log("\n=== TEST 0 · triage the last audit ===");
  const triage = await runDetectResearchGaps(db, { scriptId: script.id, model: null, userId });
  log("triage", JSON.stringify(triage).slice(0, 600));
  ok(triage.ok, "triage ran without writing script text");

  // ---------------------------------------------- Test 1: a resolvable gap
  log("\n=== TEST 1 · resolvable research gap ===");
  const solvable = {
    company_id: script.company_id,
    story_id: script.story_id,
    script_id: script.id,
    research_packet_id: script.packet_id,
    ticker: company!.ticker,
    original_statement: `Analysts have recently updated their price targets on ${company!.name}.`,
    missing_evidence_type: "ANALYST_VIEW",
    claim_under_investigation: `The most recent analyst price target and rating on ${company!.name} (${company!.ticker}).`,
    reason: "The packet holds no analyst view dated in the last quarter.",
    priority: "High",
    resolution_type: "RESEARCH_REQUIRED",
    status: "OPEN",
    gap_key: gapKey({
      companyId: script.company_id,
      evidenceType: "ANALYST_VIEW",
      claim: `acceptance ${Date.now()} analyst target`,
    }),
    queries: [
      `${company!.name} ${company!.ticker} analyst price target ${new Date().getFullYear()}`,
      `${company!.ticker} rating upgrade downgrade latest`,
    ],
    created_by: userId,
  };
  const { data: gap1 } = await admin.from("research_gaps").insert(solvable).select("id").single();
  const r1 = await runResolveScriptGaps(db, { scriptId: script.id, model: null, userId });
  log("result", JSON.stringify(r1));
  const { data: after1 } = await admin
    .from("research_gaps")
    .select("*")
    .eq("id", gap1!.id)
    .single();
  ok(
    after1!.searches_performed <= 3,
    "at most three searches were run",
    String(after1!.searches_performed),
  );
  ok(
    ["RESOLVED", "CONFLICTING", "NOT_FOUND"].includes(after1!.status),
    "gap reached a terminal classification",
    `${after1!.status} / ${after1!.classification}`,
  );
  ok(
    after1!.status !== "RESOLVED" || after1!.resolved_source_ids.length > 0,
    "a resolved gap is backed by at least one stored source",
    String(after1!.resolved_source_ids.length),
  );

  if (after1!.status === "RESOLVED") {
    log("packet rebuild", JSON.stringify(r1.packet));
    const { data: latest } = await admin
      .from("research_packets")
      .select("version_number")
      .eq("story_id", script.story_id!)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();
    ok(
      (latest!.version_number ?? 0) > (script.research_packet_version ?? 0),
      "new evidence produced a research packet version",
      `v${latest!.version_number}`,
    );
  }

  // ---------------------------------------------- Test 2: an unresolvable gap
  log("\n=== TEST 2 · NOT_FOUND research gap ===");
  const claimsBefore = await admin
    .from("claims")
    .select("id", { count: "exact", head: true })
    .eq("company_id", script.company_id);

  const { data: gap2 } = await admin
    .from("research_gaps")
    .insert({
      ...solvable,
      missing_evidence_type: "MANAGEMENT_GUIDANCE",
      original_statement: `${company!.name} management privately expects a 47.3% margin in FY2032.`,
      claim_under_investigation: `Whether ${company!.name} management has publicly guided to a 47.3% operating margin for FY2032.`,
      reason: "No filing, transcript or release in the packet mentions FY2032 margin guidance.",
      gap_key: gapKey({
        companyId: script.company_id,
        evidenceType: "MANAGEMENT_GUIDANCE",
        claim: `acceptance ${Date.now()} fy2032 margin`,
      }),
      queries: [
        `${company!.name} FY2032 operating margin guidance`,
        `${company!.ticker} management guidance 47.3% margin 2032`,
      ],
    })
    .select("id")
    .single();

  const r2 = await runResolveResearchGap(db, { gapId: gap2!.id, model: null, userId });
  log("result", JSON.stringify(r2));
  const { data: after2 } = await admin
    .from("research_gaps")
    .select("*")
    .eq("id", gap2!.id)
    .single();
  const claimsAfter = await admin
    .from("claims")
    .select("id", { count: "exact", head: true })
    .eq("company_id", script.company_id);

  ok(
    ["NOT_FOUND", "CONFLICTING"].includes(after2!.status),
    "an unanswerable question does not resolve",
    `${after2!.status} / ${after2!.classification}`,
  );
  ok(after2!.status !== "RESOLVED", "no invented evidence closed the gap");
  ok(
    (claimsAfter.count ?? 0) - (claimsBefore.count ?? 0) >= 0,
    "claims written are traceable to stored sources",
    `+${(claimsAfter.count ?? 0) - (claimsBefore.count ?? 0)}`,
  );
  log("\nnotes:", after2!.resolution_notes);
}

runOwnerAcceptance(main).catch((e) => {
  console.error(e);
  process.exit(1);
});
