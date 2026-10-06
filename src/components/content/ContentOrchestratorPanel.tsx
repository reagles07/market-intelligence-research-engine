import { jsonObject } from "@/lib/data-types";
/**
 * Content Orchestrator panel — Phase 2C.
 *
 * Manual execution only. Shows the production timeline (validation → style →
 * generation → word budget → numeric pre-check → fact audit → repair → gap
 * escalation → readiness), the scripts produced and the cost of the run.
 * Nothing here publishes anything.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Clapperboard, RefreshCw } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { startContentOrchestration } from "@/lib/content.functions";
import {
  CONTENT_READINESS_LABEL,
  CONTENT_STEPS,
  type ContentReadiness,
} from "@/lib/content/orchestration";
import { SHORT_DURATIONS, TARGET_DURATIONS } from "@/lib/content/domain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/common/ui-bits";
import { fmtDateTime } from "@/lib/finance";
import { isStalledRun } from "@/lib/creator/domain";

const stepTone: Record<string, string> = {
  COMPLETE: "text-emerald-600",
  RUNNING: "text-primary",
  WARNING: "text-amber-600",
  FAILED: "text-destructive",
  SKIPPED: "text-muted-foreground",
  PENDING: "text-muted-foreground",
};

const NONE = "none";

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-border/60 px-2.5 py-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium tabular-nums text-foreground">{String(value ?? "—")}</div>
    </div>
  );
}

export function ContentOrchestratorPanel({ storyId }: { storyId: string }) {
  const qc = useQueryClient();
  const start = useServerFn(startContentOrchestration);
  const [shortKey, setShortKey] = useState<string>("short_60");
  const [longKey, setLongKey] = useState<string>(NONE);
  const [override, setOverride] = useState(false);

  const runQuery = useQuery({
    queryKey: ["content-run", storyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_orchestration_runs")
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
    queryKey: ["content-run-steps", run?.["id"]],
    enabled: Boolean(run?.["id"]),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_orchestration_steps")
        .select("*")
        .eq("run_id", run!["id"])
        .order("order_index");
      if (error) throw error;
      return data;
    },
  });

  const runMutation = useMutation({
    mutationFn: async (force: boolean) =>
      start({
        data: {
          storyId,
          short: shortKey === NONE ? null : shortKey,
          long: longKey === NONE ? null : longKey,
          force,
          overrideReadiness: override,
        },
      }),
    onSuccess: (res) => {
      if (res?.cacheHit)
        toast.success("Identical request — reused the earlier content, no AI calls.");
      else if (res?.readiness === "READY_FOR_REVIEW")
        toast.success("Content is ready for human review.");
      else toast.message(`Content run finished — ${res?.readiness ?? "see the timeline"}.`);
      return qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      return Promise.all([runQuery.refetch(), stepsQuery.refetch()]);
    },
  });

  const steps = stepsQuery.data ?? [];
  const done = steps.filter((s) =>
    ["COMPLETE", "SKIPPED", "WARNING"].includes(String(s["status"])),
  ).length;
  const warnings = (run?.["warnings"] ?? []) as string[];
  const errors = (run?.["errors"] ?? []) as string[];
  const readiness = run?.["readiness"] as ContentReadiness | null;
  const shortIds = (run?.["short_script_ids"] ?? []) as string[];
  const busy = runMutation.isPending;
  const stalled = isStalledRun({
    status: run?.["status"] as string | undefined,
    startedAt: run?.["started_at"] as string | undefined,
  });

  const nothingSelected = shortKey === NONE && longKey === NONE;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Content Orchestrator</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Generates scripts from the latest research packet, then runs the word budget, numeric
            pre-check, fact audit, repair and gap escalation. Never publishes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => runMutation.mutate(false)}
            disabled={busy || nothingSelected}
          >
            <Clapperboard className="mr-1.5 h-3.5 w-3.5" />
            {busy ? "Producing…" : "Generate content"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => runMutation.mutate(true)}
            disabled={busy || nothingSelected}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Force regenerate
          </Button>
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-primary"
          checked={override}
          onChange={(e) => setOverride(e.target.checked)}
        />
        Produce a draft even when research readiness is not met (the fact audit still decides)
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Short format</Label>
          <Select value={shortKey} onValueChange={setShortKey}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No Short</SelectItem>
              {SHORT_DURATIONS.map((d) => (
                <SelectItem key={d.key} value={d.key}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Long-form format</Label>
          <Select value={longKey} onValueChange={setLongKey}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No long-form</SelectItem>
              {TARGET_DURATIONS.map((d) => (
                <SelectItem key={d.key} value={d.key}>
                  {d.label} — {d.minutes}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!run ? (
        <p className="mt-4 text-xs text-muted-foreground">No content run yet for this story.</p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {stalled ? (
              <Badge
                variant="outline"
                className="border-orange-300 bg-orange-50 text-orange-700"
                title="This run has been in progress far longer than the stuck threshold and is almost certainly abandoned. You can safely start a new run."
              >
                Stalled / abandoned
              </Badge>
            ) : (
              <StatusBadge value={String(run["status"])} />
            )}
            {readiness ? (
              <Badge variant="outline">{CONTENT_READINESS_LABEL[readiness] ?? readiness}</Badge>
            ) : null}
            {run["cache_hit"] ? <Badge variant="outline">Reused — 0 AI calls</Badge> : null}
            {run["packet_version"] ? (
              <Badge variant="outline">Packet v{String(run["packet_version"])}</Badge>
            ) : null}
            <span className="text-muted-foreground">
              started {fmtDateTime(run["started_at"])}
              {run["completed_at"] ? ` · finished ${fmtDateTime(run["completed_at"])}` : ""}
            </span>
          </div>

          {stalled ? (
            <p className="rounded-lg border border-orange-200 bg-orange-50/60 p-3 text-xs text-orange-800">
              This run never completed (recorded status {String(run["status"])}). It is shown as
              abandoned rather than active. The historical record is unchanged — start a new run
              when you need fresh content.
            </p>
          ) : null}

          {run["readiness_reason"] ? (
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
              {String(run["readiness_reason"])}
            </p>
          ) : null}

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Pipeline</span>
              <span className="tabular-nums">
                {done}/{CONTENT_STEPS.length}
              </span>
            </div>
            <Progress value={(done / CONTENT_STEPS.length) * 100} className="h-1.5" />
          </div>

          <ol className="space-y-1.5">
            {steps.map((s) => (
              <li key={String(s["id"])} className="rounded-lg border border-border/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">{String(s["label"])}</span>
                  <span className={stepTone[String(s["status"])] ?? ""}>{String(s["status"])}</span>
                </div>
                {jsonObject(s["detail"])["summary"] ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {String(jsonObject(s["detail"])["summary"])}
                  </p>
                ) : null}
                {s["error"] ? (
                  <p className="mt-1 text-[11px] text-destructive">{String(s["error"])}</p>
                ) : null}
              </li>
            ))}
          </ol>

          {run["long_script_id"] || shortIds.length ? (
            <div>
              <h3 className="text-xs font-semibold">Scripts produced</h3>
              <ul className="mt-1.5 space-y-1 text-[11px]">
                {run["long_script_id"] ? (
                  <li>
                    <Link
                      to="/scripts/$id"
                      params={{ id: String(run["long_script_id"]) }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      Long-form script
                    </Link>
                  </li>
                ) : null}
                {shortIds.map((id) => (
                  <li key={id}>
                    <Link
                      to="/scripts/$id"
                      params={{ id }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      Short script
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            <Metric label="Scripts" value={run["scripts_generated"]} />
            <Metric label="AI calls" value={run["ai_calls"]} />
            <Metric label="Repairs" value={run["repairs_run"]} />
            <Metric
              label="Est. cost"
              value={`$${Number(run["estimated_cost_usd"] ?? 0).toFixed(4)}`}
            />
            <Metric label="Gaps closed" value={run["gaps_resolved"]} />
            <Metric label="Gaps open" value={run["gaps_unresolved"]} />
            <Metric label="Input tokens" value={run["input_tokens"]} />
            <Metric label="Output tokens" value={run["output_tokens"]} />
          </div>

          {warnings.length ? (
            <ul className="space-y-1 text-[11px] text-amber-600">
              {warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
          {errors.length ? (
            <ul className="space-y-1 text-[11px] text-destructive">
              {errors.map((e, i) => (
                <li key={i}>✕ {e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}
