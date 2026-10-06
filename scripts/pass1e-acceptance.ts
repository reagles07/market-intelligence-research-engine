import { runOwnerAcceptance } from "./security/owner-cli";
import type { Database } from "../src/integrations/supabase/types";
/**
 * Pass 1E acceptance harness (not application code).
 *
 * Test 1 — 60s Tanglish Short: generate, run the hardened pipeline
 *   (pre-check → audit → one repair → re-audit → readiness gate) and assert
 *   the word budget, the readiness gate and full traceability.
 * Test 2 — Deep Dive: every section must carry at least one evidence handle.
 */
import { createClient } from "@supabase/supabase-js";

import { runGenerateShortScript, runGenerateLongScript } from "../src/lib/ai/script.server";
import { runAuditRepairCycle } from "../src/lib/ai/repair.server";
import { shortWordBudget, FALLBACK_WORD_BUDGETS } from "../src/lib/content/style";
import { countWords } from "../src/lib/content/domain";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const log = (...a: unknown[]) => console.log(...a);
const ok = (pass: boolean, label: string, extra = "") =>
  log(`${pass ? "PASS" : "FAIL"} — ${label}${extra ? ` · ${extra}` : ""}`);

async function sections(scriptId: string) {
  const { data } = await admin
    .from("script_sections")
    .select("section_key,spoken_text,claim_ids,source_ids,metric_keys,research_section_ids")
    .eq("script_id", scriptId)
    .order("order_index", { ascending: true });
  return data ?? [];
}

async function main() {
  const { data: profile } = await admin.from("profiles").select("id").limit(1).single();
  const userId = profile!.id as string;

  const { data: packet } = await admin
    .from("research_packets")
    .select("id,story_id,version_number")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!packet) throw new Error("no research packet to write from");
  log("packet", packet.id, "v" + packet.version_number);

  // ------------------------------------------------ Test 1: 60s Tanglish Short
  log("\n=== TEST 1 · 60s Tanglish Short ===");
  const short = (await runGenerateShortScript(db, {
    storyId: null,
    packetId: packet.id,
    duration: "short_60",
    angle: "Why the stock moved",
    language: "Tanglish",
    tone: null,
    model: null,
    styleProfileId: null,
    regenerateFromScriptId: null,
    userId,
  })) as Record<string, unknown>;
  if (!short["ok"]) return log("generation failed:", short["error"]);
  const shortId = String(short["scriptId"]);

  const cycle = (await runAuditRepairCycle(db, {
    scriptId: shortId,
    model: null,
    userId,
  })) as Record<string, unknown>;
  log(
    "cycle:",
    JSON.stringify({
      status: cycle["status"],
      ready: cycle["readyForReview"],
      repaired: cycle["repaired"],
      gate: cycle["readinessGate"],
      precheck: (cycle["precheck"] as Record<string, unknown> | undefined)?.["counts"],
    }),
  );

  const budget = shortWordBudget(FALLBACK_WORD_BUDGETS, "short_60");
  const { data: srow } = await admin
    .from("scripts")
    .select("body,word_count,status,audit_status,ready_for_review,style_quality_status")
    .eq("id", shortId)
    .single();
  const spoken = (await sections(shortId)).map((s) => s.spoken_text).join(" ");
  const words = countWords(spoken);
  ok(
    words >= budget.low && words <= budget.high,
    "60s word budget",
    `${words} words vs ${budget.low}-${budget.high}`,
  );
  ok(
    srow!.status === (srow!.ready_for_review ? "Ready for Review" : "Needs Fact Check"),
    "status matches the readiness gate",
    `${srow!.status} / ready=${srow!.ready_for_review}`,
  );
  ok(cycle["ok"] === true, "pipeline completed");

  const shortSections = await sections(shortId);
  const untraceable = shortSections.filter(
    (s) =>
      !s.claim_ids.length &&
      !s.source_ids.length &&
      !s.metric_keys.length &&
      !s.research_section_ids.length,
  );
  ok(untraceable.length === 0, "every Short beat is traceable", `${untraceable.length} untraced`);

  const { data: styleCheck } = await admin
    .from("script_style_checks")
    .select("status,warnings_total,summary")
    .eq("script_id", shortId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  ok(Boolean(styleCheck), "advisory style check recorded", styleCheck?.summary ?? "");

  const { data: audits } = await admin
    .from("script_audits")
    .select("audit_pass,status,numeric_precheck_blocking,ready_for_review")
    .eq("script_id", shortId)
    .order("created_at", { ascending: true });
  log("audit passes:", JSON.stringify(audits));

  // ------------------------------------------------ Test 2: Deep Dive
  log("\n=== TEST 2 · Deep Dive traceability ===");
  const long = (await runGenerateLongScript(db, {
    storyId: null,
    packetId: packet.id,
    targetDuration: "deep_dive",
    language: "Tanglish",
    tone: null,
    model: null,
    styleProfileId: null,
    regenerateFromScriptId: null,
    userId,
  })) as Record<string, unknown>;
  if (!long["ok"]) return log("long generation failed:", long["error"]);
  const longId = String(long["scriptId"]);

  const longCycle = (await runAuditRepairCycle(db, {
    scriptId: longId,
    model: null,
    userId,
  })) as Record<string, unknown>;
  log(
    "cycle:",
    JSON.stringify({
      status: longCycle["status"],
      ready: longCycle["readyForReview"],
      gate: longCycle["readinessGate"],
    }),
  );

  const longSections = await sections(longId);
  const bare = longSections.filter(
    (s) =>
      !s.claim_ids.length &&
      !s.source_ids.length &&
      !s.metric_keys.length &&
      !s.research_section_ids.length,
  );
  ok(longSections.length > 0, "deep dive produced sections", String(longSections.length));
  ok(bare.length === 0, "every deep-dive section cites evidence", `${bare.length} untraced`);
  ok(longCycle["ok"] === true, "deep dive pipeline completed");
}

runOwnerAcceptance(main).catch((e) => {
  console.error(e);
  process.exit(1);
});
