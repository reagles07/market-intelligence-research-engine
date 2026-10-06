import type { TableName } from "@/lib/data-types";
/**
 * Data freshness inspection (server only).
 *
 * Runs BEFORE any provider is contacted: for every dataset the story plan
 * needs we look at what is already stored and decide FRESH / STALE / MISSING,
 * with the reason recorded on the run. Fresh data is never re-fetched.
 */
import type { FreshnessEntry } from "@/lib/research/domain";
import type { DatasetKey, PlannedDataset } from "@/lib/research/plan";
import type { ResearchBudgets } from "@/lib/research/domain";

import type { Db } from "@/lib/ai/context.server";

const hoursSince = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3_600_000;
};

async function latest(
  db: Db,
  table: TableName,
  column: string,
  filters: Array<[string, string]>,
): Promise<string | null> {
  let q = db.from(table).select(column).order(column, { ascending: false }).limit(1);
  for (const [col, val] of filters) q = q.eq(col, val);
  const { data } = await q;
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  return (row?.[column] as string | null) ?? null;
}

export async function checkFreshness(
  db: Db,
  args: {
    companyId: string;
    market: string;
    datasets: PlannedDataset[];
    budgets: ResearchBudgets;
  },
): Promise<FreshnessEntry[]> {
  const { companyId, budgets } = args;
  const marketMax = budgets.marketDataMaxAgeHours;
  const secMax = budgets.secMaxAgeDays * 24;
  const finMax = budgets.financialsMaxAgeDays * 24;

  const { data: company } = await db
    .from("companies")
    .select("id,sec_cik,sec_last_sync,country")
    .eq("id", companyId)
    .maybeSingle();

  const providerEndpointAge = async (endpoint: string) =>
    hoursSince(
      await latest(db, "provider_stock_data", "retrieved_at", [
        ["company_id", companyId],
        ["endpoint", endpoint],
      ]),
    );

  const out: FreshnessEntry[] = [];
  const push = (
    dataset: DatasetKey,
    age: number | null,
    maxAge: number,
    required: boolean,
    missingReason: string,
  ) => {
    if (age === null) {
      out.push({ dataset, state: "MISSING", reason: missingReason, ageHours: null, required });
      return;
    }
    const fresh = age <= maxAge;
    out.push({
      dataset,
      state: fresh ? "FRESH" : "STALE",
      reason: fresh
        ? `Stored ${age.toFixed(1)}h ago, inside the ${maxAge}h threshold — no provider request needed.`
        : `Stored ${age.toFixed(1)}h ago, older than the ${maxAge}h threshold.`,
      ageHours: Number(age.toFixed(2)),
      required,
    });
  };

  for (const d of args.datasets) {
    const required = d.priority === 1;
    switch (d.dataset) {
      case "market_snapshot": {
        if (args.market !== "India") {
          out.push({
            dataset: "market_snapshot",
            state: "NOT_APPLICABLE",
            reason:
              "No US whole-market price/volume provider is connected — PARTIAL_MARKET_COVERAGE. Price, volume and derived indicators stay unavailable rather than being manufactured.",
            ageHours: null,
            required,
          });
          break;
        }
        const age = hoursSince(
          await latest(db, "market_snapshots", "as_of", [["company_id", companyId]]),
        );
        push(
          "market_snapshot",
          age,
          marketMax,
          required,
          "No market snapshot stored for this company.",
        );
        break;
      }
      case "financials": {
        const age = hoursSince(
          await latest(db, "financial_periods", "updated_at", [["company_id", companyId]]),
        );
        push("financials", age, finMax, required, "No financial periods stored.");
        break;
      }
      case "earnings": {
        const age = hoursSince(
          await latest(db, "earnings_reports", "updated_at", [["company_id", companyId]]),
        );
        push("earnings", age, finMax, required, "No earnings report stored.");
        break;
      }
      case "events": {
        const age = hoursSince(
          await latest(db, "events", "occurred_at", [["company_id", companyId]]),
        );
        out.push({
          dataset: "events",
          state: age === null ? "MISSING" : "FRESH",
          reason:
            age === null
              ? "No events recorded for this company."
              : `Most recent event ${age.toFixed(1)}h old; events are derived from other syncs, never fetched directly.`,
          ageHours: age === null ? null : Number(age.toFixed(2)),
          required,
        });
        break;
      }
      case "announcements":
      case "corporate_actions":
      case "historical_stats": {
        const endpoint =
          d.dataset === "announcements"
            ? "/recent_announcements"
            : d.dataset === "corporate_actions"
              ? "/corporate_actions"
              : "/historical_stats";
        const age = await providerEndpointAge(endpoint);
        push(
          d.dataset,
          age,
          marketMax * 2,
          required,
          `IndianAPI ${endpoint} has never been stored for this company.`,
        );
        break;
      }
      case "sec_filings": {
        if (!company?.sec_cik) {
          out.push({
            dataset: "sec_filings",
            state: "MISSING",
            reason: "No SEC CIK resolved for this company yet.",
            ageHours: null,
            required,
          });
          break;
        }
        const age = hoursSince(company.sec_last_sync as string | null);
        push("sec_filings", age, secMax, required, "SEC filings have never been synced.");
        break;
      }
      case "sec_facts": {
        const age = hoursSince(
          await latest(db, "sec_facts", "retrieved_at", [["company_id", companyId]]),
        );
        push("sec_facts", age, secMax, required, "No SEC XBRL facts stored.");
        break;
      }
      case "news": {
        const age = hoursSince(
          await latest(db, "web_research_runs", "created_at", [["company_id", companyId]]),
        );
        push("news", age, marketMax, required, "No web research has run for this company.");
        break;
      }
    }
  }

  return out;
}
