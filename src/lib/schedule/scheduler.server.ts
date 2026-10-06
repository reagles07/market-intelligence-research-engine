/**
 * Phase 2D-1 scheduler tick (server only).
 *
 * Decides which market executions are due right now using market-local time,
 * then hands each one to the SAME controller manual runs use.
 */
import type { Db } from "@/lib/ai/context.server";
import { dueState, marketDateFor, type ScheduleMarket } from "@/lib/schedule/domain";
import { loadAutomationSettings, runDailyController } from "@/lib/schedule/controller.server";

export type TickOutcome = {
  market: ScheduleMarket;
  executionType: "MAIN_DISCOVERY" | "LATE_DELTA";
  marketDate: string;
  status: string;
  skipReason: string | null;
};

export async function runSchedulerTick(args: {
  db: Db;
  userId: string;
  at?: Date;
}): Promise<{ ran: TickOutcome[]; skipped: string[] }> {
  const { db, userId } = args;
  const at = args.at ?? new Date();
  const settings = await loadAutomationSettings(db);
  const ran: TickOutcome[] = [];
  const skipped: string[] = [];

  if (!settings.automation_enabled) {
    return { ran, skipped: ["Global automation is off — nothing was scheduled."] };
  }

  const { data: schedules } = await db.from("market_schedules").select("*").eq("enabled", true);
  const catchup = Number(settings.catchup_window_minutes ?? 180);

  for (const schedule of schedules ?? []) {
    const market = String(schedule["market"]) as ScheduleMarket;
    const marketEnabled = market === "India" ? settings.india_enabled : settings.us_enabled;
    if (!marketEnabled) {
      skipped.push(`${market}: market automation disabled`);
      continue;
    }
    const tz = String(schedule["timezone"]);
    const marketDate = marketDateFor(tz, at);

    for (const [type, localTime] of [
      ["MAIN_DISCOVERY", String(schedule["main_run_local"])],
      ["LATE_DELTA", String(schedule["delta_run_local"])],
    ] as const) {
      const due = dueState({ tz, localTime, catchupWindowMinutes: catchup, at });
      if (!due.due) {
        skipped.push(
          `${market} ${type}: ${due.missed ? "missed (outside catch-up window)" : "not due yet"}`,
        );
        continue;
      }
      const result = await runDailyController({
        db,
        userId,
        market,
        executionType: type,
        trigger: due.lateByMinutes > 5 ? "CATCHUP" : "SCHEDULED",
        marketDate,
      });
      ran.push({
        market,
        executionType: type,
        marketDate,
        status: result.status,
        skipReason: result.skipReason,
      });
    }
  }

  return { ran, skipped };
}
