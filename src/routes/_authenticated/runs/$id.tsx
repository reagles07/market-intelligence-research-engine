import { reportAsyncError } from "@/lib/async-errors";
import { jsonObject } from "@/lib/data-types";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, RotateCcw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/common/ui-bits";
import { cancelExecution, getDailyRun, retryExecution } from "@/lib/schedule.functions";
import { PipelineLineagePanel } from "@/components/schedule/PipelineLineagePanel";
import { CONTROLLER_STEPS, STATUS_TONE } from "@/lib/schedule/domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/runs/$id")({
  head: () => ({
    meta: [
      { title: "Run detail — Stock Research Studio" },
      {
        name: "description",
        content:
          "Step-by-step timeline, budgets, provider usage, failures and discovered candidates for a single scheduled market run.",
      },
      { property: "og:title", content: "Daily run detail" },
      {
        property: "og:description",
        content: "Timeline, budgets and candidates for one market discovery run.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RunDetailPage,
});

function RunDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const fetchRun = useServerFn(getDailyRun);
  const cancel = useServerFn(cancelExecution);
  const retry = useServerFn(retryExecution);

  const { data, isLoading } = useQuery({
    queryKey: ["daily-run", id],
    queryFn: () => fetchRun({ data: { id } }),
    refetchInterval: (q) => (q.state.data?.run?.status === "RUNNING" ? 4000 : false),
  });

  const cancelMut = useMutation({
    mutationFn: (executionId: string) => cancel({ data: { executionId } }),
    onSuccess: () => {
      toast.success("Cancellation requested");
      qc.invalidateQueries({ queryKey: ["daily-run", id] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retryMut = useMutation({
    mutationFn: (executionId: string) => retry({ data: { executionId } }),
    onSuccess: () => {
      toast.success("Retry finished");
      qc.invalidateQueries({ queryKey: ["daily-run", id] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading run…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Run not found.</p>;

  const run = data.run;
  const executions = [...(run.daily_run_executions ?? [])].sort((a, b) =>
    String(a.started_at ?? "").localeCompare(String(b.started_at ?? "")),
  );
  const candidates = data.candidates ?? [];
  const notifications = data.notifications ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/runs"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Daily runs
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          {run.market} · {run.market_date}{" "}
          <span className="text-sm font-normal text-muted-foreground">({run.timezone})</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {run.candidate_count} candidates · {run.provider_calls} provider calls ·{" "}
          {run.web_searches} web searches · {run.ai_calls} AI calls · $
          {Number(run.estimated_cost_usd ?? 0).toFixed(4)}
        </p>
      </div>

      {notifications.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <SectionTitle title="Notifications" />
          <ul className="space-y-1.5 text-sm">
            {notifications.map((n) => (
              <li key={n.id} className="flex items-start gap-2">
                <span
                  className={cn(
                    "mt-0.5 rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium",
                    STATUS_TONE[n.severity] ?? "text-muted-foreground",
                  )}
                >
                  {n.severity}
                </span>
                <span>
                  <span className="font-medium">{n.title}</span>
                  {n.body ? <span className="text-muted-foreground"> — {n.body}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {executions.map((ex) => {
        const steps = Array.isArray(ex.steps)
          ? ex.steps.map((v) => {
              const row = jsonObject(v);
              return {
                key: String(row["key"] ?? ""),
                step: String(row["step"] ?? ""),
                status: String(row["status"] ?? ""),
                detail: String(row["detail"] ?? ""),
              };
            })
          : [];
        return (
          <section key={ex.id} className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  {ex.execution_type.replaceAll("_", " ")}{" "}
                  <span className="text-muted-foreground">· {ex.trigger}</span>
                  {ex.dry_run ? (
                    <span className="ml-2 rounded-md bg-secondary px-2 py-0.5 text-[11px]">
                      dry run
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  scheduled {ex.scheduled_for ? new Date(ex.scheduled_for).toLocaleString() : "—"} ·
                  started {ex.started_at ? new Date(ex.started_at).toLocaleString() : "—"}
                  {ex.lateness_minutes === null || ex.lateness_minutes === undefined
                    ? ""
                    : ` · ${ex.lateness_minutes} min late`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium",
                    STATUS_TONE[ex.status] ?? "text-muted-foreground",
                  )}
                >
                  {String(ex.status).replaceAll("_", " ")}
                </span>
                {ex.status === "RUNNING" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={cancelMut.isPending}
                    onClick={() => cancelMut.mutate(ex.id)}
                  >
                    <XCircle className="mr-1 h-3.5 w-3.5" /> Cancel
                  </Button>
                )}
                {ex.status === "FAILED" && (
                  <Button
                    size="sm"
                    disabled={retryMut.isPending}
                    onClick={() => retryMut.mutate(ex.id)}
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry
                  </Button>
                )}
              </div>
            </div>

            {ex.error && (
              <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                {ex.error}
              </p>
            )}

            <ol className="space-y-1.5">
              {CONTROLLER_STEPS.map((def) => {
                const step = steps.find(
                  (s) => s.key === def.key || s.step === def.key || s.step === def.label,
                );
                return (
                  <li
                    key={def.key}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-sm"
                  >
                    <span className={step ? "" : "text-muted-foreground"}>{def.label}</span>
                    <span className="flex items-center gap-2 text-xs">
                      {step?.detail ? (
                        <span className="text-muted-foreground">{step.detail}</span>
                      ) : null}
                      <span
                        className={cn(
                          "rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium",
                          STATUS_TONE[step?.status ?? ""] ?? "text-muted-foreground",
                        )}
                      >
                        {step?.status ?? "NOT RUN"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}

      <PipelineLineagePanel dailyRunId={String(run.id)} />

      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle
          title="Candidates discovered"
          description="Everything discovery found. Promotion is manual unless the autonomous pipeline is switched on."
        />
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No candidates from this run.</p>
        ) : (
          <ul className="space-y-1.5">
            {candidates.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{c.ticker ?? c.company_name}</span>{" "}
                  <span className="text-muted-foreground">{c.title}</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {c.priority_band}
                  <span className="rounded-md bg-secondary px-2 py-0.5 font-medium text-foreground">
                    {Number(c.content_score ?? 0).toFixed(0)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
