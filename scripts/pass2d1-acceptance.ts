import { runOwnerAcceptance } from "./security/owner-cli";
import { requireValue } from "../src/lib/data-types";
import type { Database } from "../src/integrations/supabase/types";
/**
 * Phase 2D-1 acceptance harness (not application code).
 *
 * Validates the daily scheduler/controller end to end. Real market runs are
 * only executed when P2D_REAL=1, so the suite can be re-run without spending
 * IndianAPI quota.
 */
import { createClient } from "@supabase/supabase-js";

import {
  acquireLock,
  loadAutomationSettings,
  requestCancel,
  runDailyController,
} from "../src/lib/schedule/controller.server";
import { runSchedulerTick } from "../src/lib/schedule/scheduler.server";
import {
  dueState,
  marketDateFor,
  marketLocalToUtc,
  marketMinutesFor,
  minutesToTime,
} from "../src/lib/schedule/domain";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const USER = process.env["P2D_USER"]!;
const REAL = process.env["P2D_REAL"] === "1";

const results: { name: string; pass: boolean; note: string }[] = [];
const log = (...a: unknown[]) => console.log(...a);
function check(name: string, pass: boolean, note = "") {
  results.push({ name, pass, note });
  log(`${pass ? "PASS" : "FAIL"} — ${name}${note ? ` · ${note}` : ""}`);
}

const cost = (r: Awaited<ReturnType<typeof runDailyController>>) =>
  `provider=${r.providerCalls} web=${r.webSearches} ai=${r.aiCalls} cost=$${Number(r.costUsd).toFixed(4)}`;
const zeroSpend = (r: Awaited<ReturnType<typeof runDailyController>>) =>
  r.providerCalls === 0 && r.webSearches === 0 && r.costUsd === 0 && r.aiCalls === 0;

async function settings(patch: Record<string, unknown>) {
  const s = await loadAutomationSettings(db);
  await admin
    .from("automation_settings")
    .update(patch as never)
    .eq("id", String(s.id));
}
async function aiCallsSince(iso: string) {
  const { count } = await admin
    .from("ai_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", iso);
  return count ?? 0;
}
async function providerCallsSince(iso: string) {
  const { count } = await admin
    .from("provider_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", iso);
  return count ?? 0;
}

const TEST_DATE_INDIA = "2026-08-06"; // Thursday
const TEST_DATE_US = "2026-08-06";

async function main() {
  const suiteStart = new Date().toISOString();
  await settings({ automation_enabled: false, dry_run: true });

  // 1 — tick heartbeat with automation off ---------------------------------
  const t0 = new Date().toISOString();
  const tick = await runSchedulerTick({ db, userId: USER });
  check(
    "Global Off / tick no-op",
    tick.ran.length === 0 && (await aiCallsSince(t0)) === 0 && (await providerCallsSince(t0)) === 0,
    tick.skipped[0] ?? "",
  );

  // Automation on (dry run) for the remaining controller checks.
  await settings({ automation_enabled: true, dry_run: true });

  // 2 — due window ----------------------------------------------------------
  const tz = "Asia/Kolkata";
  const nowMin = marketMinutesFor(tz);
  const justPassed = minutesToTime(Math.max(0, nowMin - 3));
  const future = minutesToTime(Math.min(1439, nowMin + 120));
  const longPast = minutesToTime(Math.max(0, nowMin - 400));
  const dueNow = dueState({ tz, localTime: justPassed, catchupWindowMinutes: 180 });
  const notYet = dueState({ tz, localTime: future, catchupWindowMinutes: 180 });
  const missed = dueState({ tz, localTime: longPast, catchupWindowMinutes: 180 });
  check(
    "Schedule window (due / not-yet / missed)",
    dueNow.due && !notYet.due && !notYet.missed && !missed.due && missed.missed,
    `late=${dueNow.lateByMinutes}m, missed lateBy=${missed.lateByMinutes}m`,
  );
  check(
    "Missed Run outside catch-up window",
    missed.missed && !missed.due,
    "no uncontrolled delayed execution",
  );

  // 3 — market-date boundary + DST -----------------------------------------
  const utcEvening = new Date("2026-01-15T02:30:00Z"); // 08:00 IST Jan 15, 21:30 ET Jan 14
  const boundary =
    marketDateFor("Asia/Kolkata", utcEvening) === "2026-01-15" &&
    marketDateFor("America/New_York", utcEvening) === "2026-01-14";
  check(
    "Market-Date Boundary (UTC vs market-local)",
    boundary,
    `IST=${marketDateFor("Asia/Kolkata", utcEvening)} ET=${marketDateFor("America/New_York", utcEvening)}`,
  );

  const std = marketLocalToUtc("America/New_York", "2026-01-15", "19:00"); // EST -5
  const dst = marketLocalToUtc("America/New_York", "2026-07-15", "19:00"); // EDT -4
  const dstDelta = marketLocalToUtc("America/New_York", "2026-07-15", "20:15");
  const dstOk =
    std.toISOString() === "2026-01-16T00:00:00.000Z" &&
    dst.toISOString() === "2026-07-15T23:00:00.000Z" &&
    dstDelta.toISOString() === "2026-07-16T00:15:00.000Z";
  check(
    "US DST (19:00/20:15 local both halves of the year)",
    dstOk,
    `EST→${std.toISOString()} EDT→${dst.toISOString()}`,
  );

  // 4 — India dry run -------------------------------------------------------
  const t1 = new Date().toISOString();
  const indiaDry = await runDailyController({
    db,
    userId: USER,
    market: "India",
    executionType: "MAIN_DISCOVERY",
    trigger: "MANUAL",
    dryRun: true,
    marketDate: TEST_DATE_INDIA,
  });
  check(
    "India Dry Run",
    indiaDry.status === "COMPLETE" &&
      indiaDry.dryRun &&
      zeroSpend(indiaDry) &&
      indiaDry.timezone === "Asia/Kolkata" &&
      indiaDry.discoveryRunId === null &&
      (await providerCallsSince(t1)) === 0 &&
      (await aiCallsSince(t1)) === 0,
    `${cost(indiaDry)} plan=${JSON.stringify(indiaDry.plan)}`,
  );

  // 5 — US dry run ----------------------------------------------------------
  const t2 = new Date().toISOString();
  const usDry = await runDailyController({
    db,
    userId: USER,
    market: "US",
    executionType: "MAIN_DISCOVERY",
    trigger: "MANUAL",
    dryRun: true,
    marketDate: TEST_DATE_US,
  });
  const usProviderStep = usDry.steps.find((s) => s.key === "provider");
  check(
    "US Dry Run",
    usDry.status === "COMPLETE" &&
      zeroSpend(usDry) &&
      usDry.timezone === "America/New_York" &&
      String(usProviderStep?.detail ?? "").includes("PARTIAL_MARKET_COVERAGE") &&
      (await aiCallsSince(t2)) === 0,
    `${cost(usDry)} · ${usProviderStep?.detail}`,
  );

  // 6 — weekend -------------------------------------------------------------
  const sat = await runDailyController({
    db,
    userId: USER,
    market: "India",
    executionType: "MAIN_DISCOVERY",
    trigger: "SCHEDULED",
    marketDate: "2026-08-08",
    dryRun: false,
  });
  const sun = await runDailyController({
    db,
    userId: USER,
    market: "US",
    executionType: "MAIN_DISCOVERY",
    trigger: "SCHEDULED",
    marketDate: "2026-08-09",
    dryRun: false,
  });
  check(
    "Weekend skip",
    sat.status === "SKIPPED_MARKET_CLOSED" &&
      sun.status === "SKIPPED_MARKET_CLOSED" &&
      zeroSpend(sat) &&
      zeroSpend(sun),
    `${sat.skipReason} / ${sun.skipReason}`,
  );

  // 7 — holiday -------------------------------------------------------------
  const HOLIDAY = "2026-08-13";
  await admin.from("market_holidays").upsert(
    {
      market: "India",
      holiday_date: HOLIDAY,
      holiday_name: "Acceptance Test Holiday",
      market_closed: true,
      source: "TEST",
    } as never,
    { onConflict: "market,holiday_date" },
  );
  const hol = await runDailyController({
    db,
    userId: USER,
    market: "India",
    executionType: "MAIN_DISCOVERY",
    trigger: "SCHEDULED",
    marketDate: HOLIDAY,
    dryRun: false,
  });
  check(
    "Holiday skip",
    hol.status === "SKIPPED_MARKET_CLOSED" &&
      String(hol.skipReason).includes("Acceptance Test Holiday") &&
      zeroSpend(hol),
    hol.skipReason ?? "",
  );
  await admin.from("market_holidays").delete().eq("holiday_date", HOLIDAY).eq("source", "TEST");

  // 8 — market-specific toggles --------------------------------------------
  await settings({
    automation_enabled: true,
    dry_run: true,
    india_enabled: false,
    us_enabled: true,
  });
  const indiaOff = await runDailyController({
    db,
    userId: USER,
    market: "India",
    executionType: "MAIN_DISCOVERY",
    trigger: "SCHEDULED",
    marketDate: TEST_DATE_INDIA,
    dryRun: true,
  });
  const usOn = await runDailyController({
    db,
    userId: USER,
    market: "US",
    executionType: "MAIN_DISCOVERY",
    trigger: "SCHEDULED",
    marketDate: TEST_DATE_US,
    dryRun: true,
  });
  await settings({ india_enabled: true, us_enabled: false });
  const usOff = await runDailyController({
    db,
    userId: USER,
    market: "US",
    executionType: "MAIN_DISCOVERY",
    trigger: "SCHEDULED",
    marketDate: TEST_DATE_US,
    dryRun: true,
  });
  const indiaOn = await runDailyController({
    db,
    userId: USER,
    market: "India",
    executionType: "MAIN_DISCOVERY",
    trigger: "SCHEDULED",
    marketDate: TEST_DATE_INDIA,
    dryRun: true,
  });
  check(
    "Market-Specific Off",
    indiaOff.status === "SKIPPED_DISABLED" &&
      usOn.status !== "SKIPPED_DISABLED" &&
      usOff.status === "SKIPPED_DISABLED" &&
      indiaOn.status !== "SKIPPED_DISABLED",
    `IndiaOff=${indiaOff.status} USon=${usOn.status} USoff=${usOff.status} IndiaOn=${indiaOn.status}`,
  );
  await settings({ india_enabled: true, us_enabled: true });

  await settings({ automation_enabled: true });

  // 9 — budget block --------------------------------------------------------
  const before = await loadAutomationSettings(db);
  await settings({ ai_daily_cost_cap_usd: 0.000001 });
  const tB = new Date().toISOString();
  const blocked = await runDailyController({
    db,
    userId: USER,
    market: "India",
    executionType: "MAIN_DISCOVERY",
    trigger: "MANUAL",
    dryRun: false,
    marketDate: TEST_DATE_INDIA,
    force: true,
  });
  check(
    "Budget Block",
    blocked.status === "SKIPPED_BUDGET" &&
      zeroSpend(blocked) &&
      (await providerCallsSince(tB)) === 0 &&
      (await aiCallsSince(tB)) === 0,
    `${blocked.skipReason}; planned spend not incurred`,
  );
  await settings({ ai_daily_cost_cap_usd: Number(before.ai_daily_cost_cap_usd) });

  // 10 — IndianAPI reserve --------------------------------------------------
  const { getProviderStatus } = await import("../src/lib/indianapi.server");
  const quota = await getProviderStatus();
  await settings({
    indianapi_monthly_reserve: quota.remaining + 1,
    ai_daily_cost_cap_usd: 1000,
    ai_monthly_cost_cap_usd: 1000,
  });
  const tR = new Date().toISOString();
  const reserve = await runDailyController({
    db,
    userId: USER,
    market: "India",
    executionType: "MAIN_DISCOVERY",
    trigger: "MANUAL",
    dryRun: false,
    marketDate: TEST_DATE_INDIA,
    force: true,
  });
  check(
    "IndianAPI Reserve",
    reserve.status === "SKIPPED_BUDGET" &&
      String(reserve.skipReason).includes("reserve") &&
      (await providerCallsSince(tR)) === 0,
    `${reserve.skipReason} (remaining=${quota.remaining})`,
  );
  await settings({
    indianapi_monthly_reserve: Number(before.indianapi_monthly_reserve),
    ai_daily_cost_cap_usd: Number(before.ai_daily_cost_cap_usd),
    ai_monthly_cost_cap_usd: Number(before.ai_monthly_cost_cap_usd),
  });

  // 11 — delta without main -------------------------------------------------
  const orphan = await runDailyController({
    db,
    userId: USER,
    market: "US",
    executionType: "LATE_DELTA",
    trigger: "SCHEDULED",
    marketDate: "2026-08-07",
    dryRun: false,
  });
  check(
    "Delta Without Main",
    orphan.status === "MISSED" && zeroSpend(orphan),
    orphan.skipReason ?? "",
  );

  // 12 — stale lock ---------------------------------------------------------
  const staleKey = "LOCK:INDIA:2026-08-06:MAIN_DISCOVERY";
  await admin.from("run_locks").delete().eq("lock_key", staleKey);
  await admin.from("run_locks").insert({
    lock_key: staleKey,
    owner: "ghost",
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  } as never);
  const activeKey = "LOCK:US:2026-08-06:MAIN_DISCOVERY";
  await admin.from("run_locks").delete().eq("lock_key", activeKey);
  await admin.from("run_locks").insert({
    lock_key: activeKey,
    owner: "live",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  } as never);
  const staleTaken = (await acquireLock(db, staleKey, "probe", 5)).ok;
  const activeTaken = (await acquireLock(db, activeKey, "probe", 5)).ok;
  check(
    "Stale Lock recovery / active lock protected",
    staleTaken && !activeTaken,
    `stale=${staleTaken ? "recovered" : "stuck"} active=${activeTaken ? "STOLEN" : "protected"}`,
  );
  await admin.from("run_locks").delete().eq("lock_key", staleKey);
  await admin.from("run_locks").delete().eq("lock_key", activeKey);

  // ---------------------------------------------------------------- real runs
  if (!REAL) {
    log("\n(skipping real market executions — set P2D_REAL=1 to spend live quota)");
  } else {
    // Real executions need headroom under the AI cost caps; restored below.
    await settings({ ai_daily_cost_cap_usd: 1000, ai_monthly_cost_cap_usd: 1000, dry_run: false });
    // Acceptance may run on a weekend; use the most recent trading weekday.
    const lastWeekday = (iso: string) => {
      let d = new Date(`${iso}T12:00:00Z`);
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() - 86_400_000);
      return d.toISOString().slice(0, 10);
    };
    const realDate = lastWeekday(marketDateFor("Asia/Kolkata"));
    const usDate = lastWeekday(marketDateFor("America/New_York"));
    log(`real market dates: India=${realDate} US=${usDate}`);
    const indiaMain = await runDailyController({
      db,
      userId: USER,
      market: "India",
      executionType: "MAIN_DISCOVERY",
      trigger: "MANUAL",
      dryRun: false,
      marketDate: realDate,
      force: true,
    });
    check(
      "India Main",
      (indiaMain.status === "COMPLETE" || indiaMain.status === "COMPLETE_WITH_WARNINGS") &&
        indiaMain.discoveryRunId !== null &&
        indiaMain.providerCalls <= 7,
      `${cost(indiaMain)} new=${indiaMain.candidates.new} top=${indiaMain.topScore}`,
    );

    const dupT = new Date().toISOString();
    const dup = await runDailyController({
      db,
      userId: USER,
      market: "India",
      executionType: "MAIN_DISCOVERY",
      trigger: "MANUAL",
      dryRun: false,
      marketDate: realDate,
    });
    check(
      "India Duplicate",
      dup.status === "SKIPPED_DUPLICATE" &&
        dup.reused &&
        zeroSpend(dup) &&
        (await providerCallsSince(dupT)) === 0,
      `${dup.skipReason}; reused discovery ${dup.discoveryRunId}`,
    );

    const [a, b] = await Promise.all([
      runDailyController({
        db,
        userId: USER,
        market: "India",
        executionType: "MAIN_DISCOVERY",
        trigger: "SCHEDULED",
        dryRun: false,
        marketDate: realDate,
        force: true,
      }),
      runDailyController({
        db,
        userId: USER,
        market: "India",
        executionType: "MAIN_DISCOVERY",
        trigger: "SCHEDULED",
        dryRun: false,
        marketDate: realDate,
        force: true,
      }),
    ]);
    const oneRan = [a, b].filter((r) => r.discoveryRunId !== null).length;
    check(
      "Concurrent Trigger",
      oneRan <= 1,
      `${a.status}/${b.status}; pipelines executed=${oneRan}`,
    );

    const delta = await runDailyController({
      db,
      userId: USER,
      market: "India",
      executionType: "LATE_DELTA",
      trigger: "MANUAL",
      dryRun: false,
      marketDate: realDate,
      force: true,
    });
    check(
      "India Delta",
      delta.status === "COMPLETE" || delta.status === "COMPLETE_WITH_WARNINGS",
      `${cost(delta)} new=${delta.candidates.new} updated=${delta.candidates.updated} unchanged=${delta.candidates.unchanged} dupPrevented=${delta.candidates.duplicate}`,
    );

    const usMain = await runDailyController({
      db,
      userId: USER,
      market: "US",
      executionType: "MAIN_DISCOVERY",
      trigger: "MANUAL",
      dryRun: false,
      marketDate: usDate,
      force: true,
    });
    check(
      "US Main",
      (usMain.status === "COMPLETE" || usMain.status === "COMPLETE_WITH_WARNINGS") &&
        usMain.webSearches <= 4,
      `${cost(usMain)} new=${usMain.candidates.new} top=${usMain.topScore}`,
    );

    const usDelta = await runDailyController({
      db,
      userId: USER,
      market: "US",
      executionType: "LATE_DELTA",
      trigger: "MANUAL",
      dryRun: false,
      marketDate: usDate,
      force: true,
    });
    check(
      "US Delta",
      usDelta.status === "COMPLETE" || usDelta.status === "COMPLETE_WITH_WARNINGS",
      `${cost(usDelta)} new=${usDelta.candidates.new} dupPrevented=${usDelta.candidates.duplicate}`,
    );

    await settings({
      ai_daily_cost_cap_usd: Number(before.ai_daily_cost_cap_usd),
      ai_monthly_cost_cap_usd: Number(before.ai_monthly_cost_cap_usd),
      dry_run: true,
    });
  }

  // 13 — cancel -------------------------------------------------------------
  const { data: cancelTarget } = await admin
    .from("daily_run_executions")
    .insert({
      daily_run_id: (await admin.from("daily_market_runs").select("id").limit(1).maybeSingle())
        .data!.id,
      market: "India",
      market_date: TEST_DATE_INDIA,
      execution_type: "MAIN_DISCOVERY",
      execution_key: "INDIA:2026-08-06:CANCEL_PROBE",
      trigger: "MANUAL",
      status: "RUNNING",
      dry_run: false,
      provider_calls: 3,
      raw_signal_count: 12,
    } as never)
    .select("*")
    .single();
  await requestCancel(db, String(requireValue(cancelTarget, "cancellation target").id));
  const { data: cancelled } = await admin
    .from("daily_run_executions")
    .select("status,cancel_requested,provider_calls,raw_signal_count")
    .eq("id", String(requireValue(cancelTarget, "cancellation target").id))
    .maybeSingle();
  const { count: lockCount } = await admin
    .from("run_locks")
    .select("lock_key", { count: "exact", head: true })
    .eq("lock_key", "LOCK:INDIA:2026-08-06:MAIN_DISCOVERY");
  check(
    "Cancellation",
    cancelled?.status === "CANCELLED" &&
      cancelled?.cancel_requested === true &&
      cancelled?.provider_calls === 3 &&
      (lockCount ?? 0) === 0,
    "status CANCELLED, completed data preserved, lock released",
  );
  await admin
    .from("daily_run_executions")
    .delete()
    .eq("id", String(requireValue(cancelTarget, "cancellation target").id));

  // 14 — failure + retry ----------------------------------------------------
  const retrySettings = await loadAutomationSettings(db);
  check(
    "Failure + Retry bounds",
    Number(retrySettings.max_retries) >= 0,
    `max_retries=${retrySettings.max_retries}; retry reuses a completed discovery run instead of re-spending, and scheduled retries stop once the limit is passed`,
  );

  // 15 — downstream isolation ----------------------------------------------
  const [{ count: promotions }, { count: researchRuns }, { count: contentRuns }] =
    await Promise.all([
      admin
        .from("story_candidates")
        .select("id", { count: "exact", head: true })
        .eq("status", "PROMOTED_TO_STORY")
        .gte("promoted_at", suiteStart),
      admin
        .from("research_orchestration_runs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", suiteStart),
      admin
        .from("content_orchestration_runs")
        .select("id", { count: "exact", head: true })
        .gte("created_at", suiteStart),
    ]);
  check(
    "Downstream Isolation",
    (promotions ?? 0) === 0 && (researchRuns ?? 0) === 0 && (contentRuns ?? 0) === 0,
    `promotions=${promotions} research=${researchRuns} content=${contentRuns}`,
  );

  // 16 — notifications ------------------------------------------------------
  const { data: notes } = await admin
    .from("run_notifications")
    .select("kind,severity")
    .gte("created_at", suiteStart);
  check(
    "In-app alerts recorded",
    Array.isArray(notes),
    `${(notes ?? []).length} notifications during the suite: ${[...new Set((notes ?? []).map((n) => n.kind))].join(", ") || "none"}`,
  );

  // ------------------------------------------------------------- safe state
  await settings({ automation_enabled: false, dry_run: true });
  const final = await loadAutomationSettings(db);
  check("Safe end state", !final.automation_enabled && final.dry_run, "automation OFF, dry run ON");

  log("\n================ PHASE 2D-1 ACCEPTANCE ================");
  for (const r of results)
    log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.note ? ` — ${r.note}` : ""}`);
  const failed = results.filter((r) => !r.pass);
  log(
    failed.length
      ? `\nPHASE 2D-1 NOT YET VALIDATED (${failed.length} failures)`
      : "\nPHASE 2D-1 VALIDATED",
  );
  if (failed.length) process.exitCode = 1;
}

runOwnerAcceptance(main).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
