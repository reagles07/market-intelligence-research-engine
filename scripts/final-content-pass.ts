import { runOwnerAcceptance } from "./security/owner-cli";
import { jsonArray, jsonObject, requireValue } from "../src/lib/data-types";
import type { Database } from "../src/integrations/supabase/types";
/**
 * GOLDEN PATH — final content pass on the EXISTING GOOGL short (acceptance
 * harness, not application code).
 *
 * Freezes the current story / packet / script. Runs ONE evidence-locked
 * combined repair (qualification + word budget) followed by a from-scratch
 * final audit on the new body, then the duplicate/cache check.
 *
 * Run: P2D_USER=<uuid> GP_SCRIPT=<script uuid> bun scripts/final-content-pass.ts
 */
import { createClient } from "@supabase/supabase-js";

import { runScriptRepair } from "../src/lib/ai/repair.server";
import { runAuditScript } from "../src/lib/ai/audit.server";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const USER = process.env["P2D_USER"]!;
const SCRIPT_ID = process.env["GP_SCRIPT"]!;
const log = (...a: unknown[]) => console.log(...a);

async function spendSince(iso: string) {
  const { data } = await admin
    .from("ai_requests")
    .select("estimated_cost_usd")
    .gte("created_at", iso);
  const rows = data ?? [];
  return {
    calls: rows.length,
    cost: rows.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0),
  };
}

async function main() {
  const startedAt = new Date().toISOString();

  const { data: script } = await admin
    .from("scripts")
    .select("id,title,format,target_duration,word_count,status,packet_id,body_hash")
    .eq("id", SCRIPT_ID)
    .maybeSingle();
  const s = script;
  if (!s) throw new Error("script not found");
  log(
    `Frozen script: ${s.title} · ${s.format}/${s.target_duration} · ${s.word_count} words · ${s.status}`,
  );
  const startWords = Number(s.word_count ?? 0);

  // ---- 1. ONE combined evidence-locked repair (qualification + word budget).
  const repair = await runScriptRepair(db, { scriptId: SCRIPT_ID, userId: USER });
  if (!repair.ok) {
    log(`Repair failed: ${repair.error}`);
  } else {
    log(
      `Repair: ${repair.corrected ?? "?"} corrected · ${repair.attributed ?? "?"} attributed · ${
        repair.qualified ?? "?"
      } qualified · ${repair.removed ?? "?"} removed`,
    );
    if (repair.rebalance)
      log(
        `  rebalance ${repair.rebalance.direction} ${repair.rebalance.from} → ${repair.rebalance.to}`,
      );
    if (repair.rebalanceDiscarded) log(`  ${repair.rebalanceDiscarded}`);
  }

  const { data: after } = await admin
    .from("scripts")
    .select("word_count,body_hash,body")
    .eq("id", SCRIPT_ID)
    .maybeSingle();
  const a = requireValue(after, "after");
  log(`After repair: ${a.word_count} words · body_hash ${String(a.body_hash).slice(0, 12)}`);

  // ---- 2. Final audit, computed from scratch against the new body.
  const audit = await runAuditScript(db, {
    scriptId: SCRIPT_ID,
    userId: USER,
    repairId: repair.ok ? (repair.repairId ?? null) : null,
    pass: 2,
  });
  if (!audit.ok) {
    log(`Audit failed: ${audit.error}`);
    return;
  }

  const { data: auditRow } = await admin
    .from("script_audits")
    .select(
      "id,status,body_hash,word_count,within_word_budget,readiness_gate,ready_for_review,blocking_reasons,numeric_precheck_blocking,numeric_precheck",
    )
    .eq("script_id", SCRIPT_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = requireValue(auditRow, "auditRow");
  const gate = jsonObject(r.readiness_gate);
  const pre = jsonObject(r.numeric_precheck);

  log("\n--- FINAL AUDIT ---");
  log(
    `audit ${r.id} · body_hash ${String(r.body_hash).slice(0, 12)} (script ${String(a.body_hash).slice(0, 12)})`,
  );
  log(`status: ${r.status} · ready_for_review: ${r.ready_for_review}`);
  log(`word count: ${r.word_count} (budget ${gate["word_budget"]}) ok=${r.within_word_budget}`);
  log(
    `temporal blockers: ${jsonObject(pre["counts"])["temporalBlocking"] ?? jsonObject(pre["counts"])["temporal_blocking"] ?? 0}`,
  );
  log(`numeric precheck blocking: ${r.numeric_precheck_blocking}`);
  log(
    `unsupported numbers: ${gate["unsupported_numbers"]} · numeric conflicts: ${gate["numeric_conflicts"]}`,
  );
  log(
    `attribution gaps: ${gate["attribution_gaps"]} · forecast/inference: ${gate["forecast_errors"]}`,
  );
  for (const b of jsonArray(r.blocking_reasons).map(jsonObject)) {
    log(
      `  BLOCKER [${b["type"]}/${b["status"]}/${b["origin"]}] ${b["statement"]}\n    → ${b["issue"]}`,
    );
  }

  const { data: fresh } = await admin
    .from("scripts")
    .select("status,audit_status,ready_for_review,word_count")
    .eq("id", SCRIPT_ID)
    .maybeSingle();
  log(
    `\nScript now: ${requireValue(fresh, "fresh script").status} · audit ${requireValue(fresh, "fresh script").audit_status} · ready_for_review ${requireValue(fresh, "fresh script").ready_for_review}`,
  );

  const spend = await spendSince(startedAt);
  log(`\nIncremental AI calls: ${spend.calls} · $${spend.cost.toFixed(4)}`);
  log(`Word count: ${startWords} → ${r.word_count} (required 135–165, preferred 145–155)`);
}

runOwnerAcceptance(main).catch((e) => {
  console.error(e);
  process.exit(1);
});
