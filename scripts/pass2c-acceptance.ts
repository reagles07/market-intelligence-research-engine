import { runOwnerAcceptance } from "./security/owner-cli";
import { jsonArray, jsonObject } from "../src/lib/data-types";
import type { Database } from "../src/integrations/supabase/types";
/**
 * Pass 2C acceptance harness (not application code).
 *
 * Test 1 — research gate: a story whose research is not ready must be BLOCKED
 *   with zero AI calls.
 * Test 2 — India story, 60-second Short: full content pipeline with style,
 *   word budget, numeric pre-check, fact audit and readiness verdict.
 * Test 3 — US story, Deep Dive long form.
 * Test 4 — duplicate request: an identical re-run must reuse the earlier run
 *   and spend zero AI calls.
 */
import { createClient } from "@supabase/supabase-js";

import { runContentOrchestration } from "../src/lib/content/orchestrator.server";
import { CONTENT_STEPS } from "../src/lib/content/orchestration";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const log = (...a: unknown[]) => console.log(...a);
const ok = (pass: boolean, label: string, extra = "") =>
  log(`${pass ? "PASS" : "FAIL"} — ${label}${extra ? ` · ${extra}` : ""}`);

const INDIA_STORY = process.env["P2C_INDIA_STORY"]!;
const US_STORY = process.env["P2C_US_STORY"]!;
const USER = process.env["P2C_USER"]!;

async function showSteps(runId: string) {
  const { data } = await admin
    .from("content_orchestration_steps")
    .select("step_key,label,status,detail,order_index")
    .eq("run_id", runId)
    .order("order_index");
  const steps = data ?? [];
  for (const s of steps) {
    log(
      `    ${String(s["order_index"]).padStart(2)} ${String(s["label"]).padEnd(28)} ${String(s["status"]).padEnd(8)} ${String(jsonObject(s["detail"])["summary"] ?? "").slice(0, 110)}`,
    );
  }
  return steps;
}

async function run(label: string, args: Parameters<typeof runContentOrchestration>[1]) {
  log(`\n=== ${label} ===`);
  const res = (await runContentOrchestration(db, args)) as Record<string, unknown>;
  log(
    `  status=${res["status"]} readiness=${res["readiness"]} aiCalls=${res["aiCalls"]} cost=$${Number(res["estimatedCostUsd"]).toFixed(4)} cacheHit=${res["cacheHit"]}`,
  );
  log(`  reason: ${res["reason"]}`);
  const steps = await showSteps(String(res["runId"]));
  return { res, steps };
}

async function main() {
  // --- Test 1: research gate ------------------------------------------------
  const gate = await run("TEST 1 — research gate (no override)", {
    storyId: INDIA_STORY,
    userId: USER,
    formats: { short: "short_60" },
  });
  ok(
    gate.res["status"] === "BLOCKED" && gate.res["aiCalls"] === 0,
    "not-research-ready story is blocked before any AI call",
    `status=${gate.res["status"]} aiCalls=${gate.res["aiCalls"]}`,
  );
  ok(
    gate.steps.filter((s) => s["status"] === "SKIPPED").length >= CONTENT_STEPS.length - 2,
    "every later step is skipped when the gate blocks",
  );

  // --- Test 2: India Short --------------------------------------------------
  const india = await run("TEST 2 — India story · 60-second Short", {
    storyId: INDIA_STORY,
    userId: USER,
    formats: { short: "short_60" },
    overrideReadiness: true,
  });
  const order = india.steps.map((s) => String(s["step_key"]));
  ok(
    JSON.stringify(order) === JSON.stringify(CONTENT_STEPS.map((s) => s.key)),
    "steps are recorded in the fixed pipeline order",
  );
  const styleStep = india.steps.find((s) => s["step_key"] === "select_style");
  ok(
    String(jsonObject(styleStep?.["detail"])["summary"] ?? "").includes("Tamil"),
    "the editorial workspace style profile was applied",
    String(jsonObject(styleStep?.["detail"])["summary"] ?? ""),
  );
  const wordStep = india.steps.find((s) => s["step_key"] === "word_budget");
  log(`  word budget: ${jsonObject(wordStep?.["detail"])["summary"]}`);
  const preStep = india.steps.find((s) => s["step_key"] === "numeric_precheck");
  ok(
    ["COMPLETE", "WARNING"].includes(String(preStep?.["status"])),
    "the deterministic numeric pre-check ran",
    String(jsonObject(preStep?.["detail"])["summary"] ?? ""),
  );
  ok(
    (india.res["shortScriptIds"] as string[]).length === 1,
    "one Short script was produced and linked to the run",
  );

  // --- Test 3: US deep dive -------------------------------------------------
  const us = await run("TEST 3 — US story · Deep Dive long form", {
    storyId: US_STORY,
    userId: USER,
    formats: { long: "deep_dive" },
    overrideReadiness: true,
  });
  ok(Boolean(us.res["longScriptId"]), "a deep-dive long-form script was produced");
  ok(
    ["READY_FOR_REVIEW", "NEEDS_FACT_CHECK", "RESEARCH_REQUIRED"].includes(
      String(us.res["readiness"]),
    ),
    "the run ends with a content readiness verdict",
    String(us.res["readiness"]),
  );
  ok(
    us.res["status"] !== "COMPLETE" ||
      us.res["readiness"] !== "READY_FOR_REVIEW" ||
      jsonArray(jsonObject(us.res["auditSummary"])["scripts"]).every(
        (a) => jsonObject(a)["blocking"] === 0,
      ),
    "READY_FOR_REVIEW is only reached with zero blocking issues",
  );

  // --- Test 4: duplicate request cache -------------------------------------
  const dup = await run("TEST 4 — identical repeat request", {
    storyId: INDIA_STORY,
    userId: USER,
    formats: { short: "short_60" },
    overrideReadiness: true,
  });
  ok(
    dup.res["cacheHit"] === true && dup.res["aiCalls"] === 0,
    "an identical request reuses the earlier run and spends no AI calls",
    `cacheHit=${dup.res["cacheHit"]} aiCalls=${dup.res["aiCalls"]}`,
  );
  ok(
    JSON.stringify(dup.res["shortScriptIds"]) === JSON.stringify(india.res["shortScriptIds"]),
    "the reused run points at the same script",
  );

  log("\nDone.");
}

runOwnerAcceptance(main).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
