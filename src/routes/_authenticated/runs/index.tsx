import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Play, FlaskConical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/common/ui-bits";
import { listDailyRuns, runMarketNow } from "@/lib/schedule.functions";
import { SCHEDULE_MARKETS, STATUS_TONE, type ScheduleMarket } from "@/lib/schedule/domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/runs/")({
  head: () => ({
    meta: [
      { title: "Daily Runs — Stock Research Studio" },
      {
        name: "description",
        content:
          "Scheduled and manual India and US discovery runs: status, budgets, provider usage and candidate counts for every market date.",
      },
      { property: "og:title", content: "Daily Runs" },
      {
        property: "og:description",
        content: "Scheduled market discovery runs, budgets and execution history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DailyRunsPage,
});

function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium",
        STATUS_TONE[status] ?? "text-muted-foreground",
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function DailyRunsPage() {
  const qc = useQueryClient();
  const fetchRuns = useServerFn(listDailyRuns);
  const runNow = useServerFn(runMarketNow);
  const [market, setMarket] = useState<ScheduleMarket | "All">("All");
  const [status, setStatus] = useState<string>("All");

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["daily-runs", market, status],
    queryFn: () =>
      fetchRuns({
        data: {
          ...(market === "All" ? {} : { market }),
          ...(status === "All" ? {} : { status }),
        },
      }),
  });

  const trigger = useMutation({
    mutationFn: (input: {
      market: ScheduleMarket;
      executionType: "MAIN_DISCOVERY" | "LATE_DELTA";
      dryRun?: boolean;
      force?: boolean;
    }) => runNow({ data: input }),
    onSuccess: (res) => {
      toast[res.status.startsWith("SKIPPED") || res.status === "FAILED" ? "warning" : "success"](
        `${res.market} ${res.executionType}: ${res.status.replaceAll("_", " ")}`,
        { description: res.skipReason ?? `${res.candidates.new} new candidates` },
      );
      qc.invalidateQueries({ queryKey: ["daily-runs"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <CalendarClock className="h-5 w-5" /> Daily Runs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scheduled and manual market discovery. Discovery only — nothing is promoted, researched,
            scripted or published automatically.
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle
          title="Run now"
          description="Manual runs use the same controller, gates and budgets as the scheduler."
        />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SCHEDULE_MARKETS.flatMap((m) =>
            (["MAIN_DISCOVERY", "LATE_DELTA"] as const).map((t) => (
              <div key={`${m}-${t}`} className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">
                  {m} {t === "MAIN_DISCOVERY" ? "main" : "late delta"}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={trigger.isPending}
                    onClick={() => trigger.mutate({ market: m, executionType: t, dryRun: true })}
                  >
                    <FlaskConical className="mr-1 h-3.5 w-3.5" /> Dry run
                  </Button>
                  <Button
                    size="sm"
                    disabled={trigger.isPending}
                    onClick={() => trigger.mutate({ market: m, executionType: t, dryRun: false })}
                  >
                    <Play className="mr-1 h-3.5 w-3.5" /> Run
                  </Button>
                </div>
              </div>
            )),
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={market}
            onChange={(e) => setMarket(e.target.value as ScheduleMarket | "All")}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="All">All markets</option>
            {SCHEDULE_MARKETS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {[
              "All",
              "COMPLETE",
              "COMPLETE_WITH_WARNINGS",
              "PARTIAL",
              "RUNNING",
              "FAILED",
              "SKIPPED_MARKET_CLOSED",
              "SKIPPED_DISABLED",
              "SKIPPED_BUDGET",
              "SKIPPED_DUPLICATE",
            ].map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Market</th>
                <th className="py-2 pr-3">Timezone</th>
                <th className="py-2 pr-3">Started</th>
                <th className="py-2 pr-3">Main</th>
                <th className="py-2 pr-3">Delta</th>
                <th className="py-2 pr-3">Candidates</th>
                <th className="py-2 pr-3">Top score</th>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Web</th>
                <th className="py-2 pr-3">AI</th>
                <th className="py-2 pr-3">Cost</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={13} className="py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-6 text-center text-muted-foreground">
                    No daily runs yet.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="py-2 pr-3">
                      <Link
                        to="/runs/$id"
                        params={{ id: r.id }}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {r.market_date}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{r.market}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{r.timezone}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {r.started_at ? new Date(r.started_at).toLocaleString() : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusPill status={r.main_run_status} />
                    </td>
                    <td className="py-2 pr-3">
                      <StatusPill status={r.delta_run_status} />
                    </td>
                    <td className="py-2 pr-3">{r.candidate_count}</td>
                    <td className="py-2 pr-3">
                      {r.top_score === null ? "—" : Number(r.top_score).toFixed(0)}
                    </td>
                    <td className="py-2 pr-3">{r.provider_calls}</td>
                    <td className="py-2 pr-3">{r.web_searches}</td>
                    <td className="py-2 pr-3">{r.ai_calls}</td>
                    <td className="py-2 pr-3">${Number(r.estimated_cost_usd ?? 0).toFixed(4)}</td>
                    <td className="py-2 pr-3">
                      <StatusPill status={r.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
