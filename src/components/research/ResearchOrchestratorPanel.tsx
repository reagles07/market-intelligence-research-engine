/**
 * Research Orchestrator panel — Phase 2B.
 *
 * Shows the full run timeline, the story-aware data plan, the freshness
 * verdicts, resource usage and the readiness gate for the selected story.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Play, RefreshCw, Square } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { cancelResearchOrchestration, startResearchOrchestration } from "@/lib/research.functions";
import {
  ORCHESTRATION_STEPS,
  READINESS_LABEL,
  type FreshnessEntry,
  type Readiness,
} from "@/lib/research/domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/common/ui-bits";
import { ElapsedIndicator } from "@/components/common/elapsed";
import { fmtDateTime } from "@/lib/finance";

const stepTone: Record<string, string> = {
  COMPLETE: "text-emerald-600",
  RUNNING: "text-primary",
  WARNING: "text-amber-600",
  FAILED: "text-destructive",
  SKIPPED: "text-muted-foreground",
  PENDING: "text-muted-foreground",
};

const freshTone: Record<string, string> = {
  FRESH: "text-emerald-600",
  STALE: "text-amber-600",
  MISSING: "text-destructive",
  NOT_APPLICABLE: "text-muted-foreground",
};

export function ResearchOrchestratorPanel({
  storyId,
  autostart = false,
}: {
  storyId: string;
  autostart?: boolean;
}) {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  const start = useServerFn(startResearchOrchestration);
  const cancel = useServerFn(cancelResearchOrchestration);

  const runQuery = useQuery({
    queryKey: ["orchestration-run", storyId],
    refetchInterval: live ? 3000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("research_orchestration_runs")
        .select("*")
        .eq("story_id", storyId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const run = runQuery.data;

  const stepsQuery = useQuery({
    queryKey: ["orchestration-steps", run?.["id"]],
    enabled: Boolean(run?.["id"]),
    refetchInterval: live ? 3000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("research_orchestration_steps")
        .select("*")
        .eq("run_id", run!["id"])
        .order("step_index");
      if (error) throw error;
      return data;
    },
  });

  const runStatus = run?.status;
  useEffect(() => {
    setLive(runStatus === "RUNNING" || runStatus === "QUEUED");
  }, [runStatus]);

  const runMutation = useMutation({
    mutationFn: async (forceRefresh: boolean) => start({ data: { storyId, forceRefresh } }),
    onMutate: () => setLive(true),
    onSuccess: () => {
      toast.success("Research run finished");
      return qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      setLive(false);
      return Promise.all([runQuery.refetch(), stepsQuery.refetch()]);
    },
  });

  // Manual "Research any stock" hands off here: start the standard
  // orchestration once, with visible progress, instead of blocking a modal.
  const autostartedRef = useRef(false);
  useEffect(() => {
    if (!autostart || autostartedRef.current) return;
    if (runQuery.isLoading) return;
    if (run && (run["status"] === "RUNNING" || run["status"] === "QUEUED")) return;
    autostartedRef.current = true;
    runMutation.mutate(false);
  }, [autostart, runQuery.isLoading, run, runMutation]);

  const cancelMutation = useMutation({
    mutationFn: async () => cancel({ data: { runId: run!["id"] } }),
    onSuccess: () => {
      toast.message("Cancellation requested — the run stops after the current step.");
      return runQuery.refetch();
    },
  });

  const steps = stepsQuery.data ?? [];
  const done = steps.filter((s) =>
    ["COMPLETE", "SKIPPED", "WARNING"].includes(String(s["status"])),
  ).length;
  const plan = (run?.["data_plan"] ?? {}) as {
    category?: string;
    datasets?: import("@/lib/research/plan").PlannedDataset[];
  };
  const freshness = ((run?.["freshness"] ?? {}) as { entries?: FreshnessEntry[] }).entries ?? [];
  const warnings = (run?.["warnings"] ?? []) as string[];
  const errors = (run?.["errors"] ?? []) as string[];
  const readiness = run?.["readiness"] as Readiness | null;
  const busy = runMutation.isPending;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Research Orchestrator</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Runs provider sync, database analysis, verification, web research, packet build and
            scenarios in order — skipping anything already fresh.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => runMutation.mutate(false)} disabled={busy}>
            <Play className="mr-1.5 h-3.5 w-3.5" />
            {busy ? "Researching…" : run ? "Re-run research" : "Run research"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runMutation.mutate(true)}
            disabled={busy}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Force refresh
          </Button>
          {run && (run["status"] === "RUNNING" || run["status"] === "QUEUED") ? (
            <Button size="sm" variant="outline" onClick={() => cancelMutation.mutate()}>
              <Square className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <ElapsedIndicator
        active={busy}
        step={run?.["current_step"] ? String(run["current_step"]) : null}
        className="mt-2 justify-end"
      />

      {!run ? (
        <p className="mt-4 text-xs text-muted-foreground">No research run yet for this story.</p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge value={String(run["status"])} />
            {readiness ? (
              <Badge variant="outline">{READINESS_LABEL[readiness] ?? readiness}</Badge>
            ) : null}
            {run["coverage_flag"] ? (
              <Badge variant="outline">{String(run["coverage_flag"])}</Badge>
            ) : null}
            {run["is_rerun"] ? <Badge variant="outline">Re-run</Badge> : null}
            <span className="text-muted-foreground">
              started {fmtDateTime(run["started_at"])}
              {run["completed_at"] ? ` · finished ${fmtDateTime(run["completed_at"])}` : ""}
            </span>
          </div>

          {run["readiness_reason"] ? (
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
              {String(run["readiness_reason"])}
            </p>
          ) : null}

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Pipeline</span>
              <span className="tabular-nums">
                {done}/{ORCHESTRATION_STEPS.length}
              </span>
            </div>
            <Progress value={(done / ORCHESTRATION_STEPS.length) * 100} className="h-1.5" />
          </div>

          <ol className="space-y-1.5">
            {steps.map((s) => (
              <li key={String(s["id"])} className="rounded-lg border border-border/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">{String(s["label"])}</span>
                  <span className={stepTone[String(s["status"])] ?? ""}>{String(s["status"])}</span>
                </div>
                {s["detail"] ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">{String(s["detail"])}</p>
                ) : null}
                {s["error"] ? (
                  <p className="mt-1 text-[11px] text-destructive">{String(s["error"])}</p>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold">
                Data plan {plan.category ? `· ${plan.category}` : ""}
              </h3>
              <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
                {(plan.datasets ?? []).map((d) => (
                  <li key={String(d.dataset)}>
                    <span className="font-medium text-foreground">{String(d.dataset)}</span> (P
                    {d.priority}
                    {d.provider ? ` · ${d.provider}` : ""}) — {String(d.reason)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold">Freshness</h3>
              <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
                {freshness.map((f) => (
                  <li key={f.dataset}>
                    <span className="font-medium text-foreground">{f.dataset}</span>{" "}
                    <span className={freshTone[f.state] ?? ""}>{f.state}</span> — {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            <Metric label="Provider calls" value={run["provider_requests"]} />
            <Metric label="AI calls" value={run["ai_calls"]} />
            <Metric label="Web searches" value={run["web_searches"]} />
            <Metric
              label="Est. cost"
              value={`$${Number(run["estimated_cost_usd"] ?? 0).toFixed(4)}`}
            />
            <Metric label="Packet builds" value={run["packet_builds"]} />
            <Metric
              label="Packet version"
              value={
                run["packet_final_version"]
                  ? `v${run["packet_start_version"]} → v${run["packet_final_version"]}`
                  : "—"
              }
            />
            <Metric label="Input tokens" value={run["input_tokens"]} />
            <Metric label="Output tokens" value={run["output_tokens"]} />
          </div>

          {warnings.length ? (
            <div>
              <h3 className="text-xs font-semibold text-amber-600">Warnings</h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {errors.length ? (
            <div>
              <h3 className="text-xs font-semibold text-destructive">Errors</h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-border/60 px-2.5 py-1.5">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{String(value ?? "—")}</p>
    </div>
  );
}
