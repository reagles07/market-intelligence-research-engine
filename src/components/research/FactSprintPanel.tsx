import { reportAsyncError } from "@/lib/async-errors";
/**
 * Fast fact sprint — the creator's "find the missing facts" action.
 *
 * It reports only what actually happened: gaps targeted, gaps filled, gaps
 * still unresolved, sources added, conflicts, searches and cost. A gap that
 * could not be closed stays visible as unresolved.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/common/ui-bits";
import { ElapsedIndicator } from "@/components/common/elapsed";
import { useAiModel } from "@/components/providers/use-ai-model";
import { latestFactSprintFn, runFactSprintFn } from "@/lib/research/fact-sprint.functions";
import { FACT_GAP_CATEGORIES, type FactGapKey } from "@/lib/research/fact-sprint";
import { fmtDateTime } from "@/lib/finance";

type Row = Record<string, unknown>;

export function FactSprintPanel({
  storyId,
  packetId,
}: {
  storyId: string;
  packetId: string | null;
}) {
  const qc = useQueryClient();
  const { model } = useAiModel();
  const sprintFn = useServerFn(runFactSprintFn);
  const latestFn = useServerFn(latestFactSprintFn);

  const { data: last } = useQuery({
    queryKey: ["fact-sprint", storyId],
    queryFn: async () => (await latestFn({ data: { storyId } })) as Row | null,
    refetchInterval: (q) => ((q.state.data as Row | null)?.["status"] === "RUNNING" ? 4000 : false),
  });

  const sprint = useMutation({
    mutationFn: async () =>
      (await sprintFn({ data: { storyId, packetId: packetId ?? undefined, model } })) as Row,
    onSuccess: (r) => {
      if (!r["ok"]) return void toast.error(String(r["error"] ?? "Fact sprint failed"));
      const s = (r["summary"] ?? {}) as Record<string, number>;
      toast.success(
        r["nothingToDo"]
          ? "No missing fact categories were detected for this packet."
          : `${s["gapsFilled"] ?? 0}/${s["gapsTargeted"] ?? 0} gaps filled · ${s["sourcesAdded"] ?? 0} sources added`,
      );
      qc.invalidateQueries({ queryKey: ["fact-sprint", storyId] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["packet", storyId] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["story-claims", storyId] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["research-packets"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["web-research-runs", storyId] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const running = sprint.isPending || last?.["status"] === "RUNNING";
  const unresolved = ((last?.["summary"] as Row | null)?.["unresolvedGaps"] ?? []) as FactGapKey[];

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <SectionTitle
        title="Fast fact sprint"
        description="Targets the facts this packet is missing and searches official sources first, then recent reporting. Bounded to a few passes; a fact that cannot be found stays marked unresolved."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => sprint.mutate()} disabled={running}>
          <Compass className="mr-1.5 h-3.5 w-3.5" />
          {running ? "Finding missing facts…" : "Find missing facts"}
        </Button>
      </div>

      <ElapsedIndicator
        active={running}
        step={last?.["current_step"] ? String(last["current_step"]) : null}
      />

      {last ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
          <p className="font-medium">
            Last fact sprint · {fmtDateTime(String(last["created_at"]))}
            {last["status"] === "RUNNING" ? " · running" : ""}
          </p>
          <p className="mt-1 tabular-nums text-muted-foreground">
            {String(last["gaps_targeted"] ?? 0)} gaps targeted · {String(last["gaps_filled"] ?? 0)}{" "}
            filled · {String(last["gaps_unresolved"] ?? 0)} unresolved ·{" "}
            {String(last["sources_added"] ?? 0)} sources added · {String(last["conflicts"] ?? 0)}{" "}
            conflicts · {String(last["searches"] ?? 0)} searches · {String(last["passes"] ?? 0)}{" "}
            passes · ${Number(last["estimated_cost_usd"] ?? 0).toFixed(4)}
          </p>
          <p className="mt-1 text-muted-foreground">
            {last["latest_source_at"]
              ? `Newest source: ${fmtDateTime(String(last["latest_source_at"]))}`
              : "No dated source returned."}
            {Number(last["inaccessible_primaries"] ?? 0) > 0
              ? ` · ${String(last["inaccessible_primaries"])} official document(s) could not be opened — kept as reference links only, contents not read.`
              : ""}
          </p>
          {unresolved.length ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {unresolved.map((k) => (
                <li key={k}>Still unresolved: {FACT_GAP_CATEGORIES[k]?.label ?? k}</li>
              ))}
            </ul>
          ) : null}
          {last["error"] ? <p className="mt-1 text-destructive">{String(last["error"])}</p> : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No fact sprint has run for this story yet.</p>
      )}
    </section>
  );
}
