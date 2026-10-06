import { reportAsyncError } from "@/lib/async-errors";
/**
 * Research gaps for one script.
 *
 * A gap is a fact the script needs and the research packet does not hold. The
 * script writer never goes looking for it — this panel does, with a narrow,
 * capped search, and shows plainly when nothing was found.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Search, Sparkles, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/common/ui-bits";
import { useAiModel } from "@/components/providers/use-ai-model";
import {
  detectResearchGaps,
  regenerateFromUpdatedResearch,
  resolveResearchGap,
  resolveScriptGaps,
  scriptResearchGaps,
} from "@/lib/ai/gaps.functions";
import { CLASSIFICATION_LABEL, GAP_STATUS_LABEL } from "@/lib/content/gaps";
import { fmtDateTime } from "@/lib/finance";

type Row = Record<string, unknown>;

const tone = (status: string) =>
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium " +
  (status === "RESOLVED"
    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : status === "OPEN" || status === "RESEARCHING"
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : status === "CONFLICTING"
        ? "bg-destructive/10 text-destructive"
        : "bg-muted text-muted-foreground");

export function ResearchGapsPanel({ scriptId }: { scriptId: string }) {
  const qc = useQueryClient();
  const { model } = useAiModel();
  const listFn = useServerFn(scriptResearchGaps);
  const detectFn = useServerFn(detectResearchGaps);
  const resolveOneFn = useServerFn(resolveResearchGap);
  const resolveAllFn = useServerFn(resolveScriptGaps);
  const regenerateFn = useServerFn(regenerateFromUpdatedResearch);

  const { data: gaps } = useQuery({
    queryKey: ["script-gaps", scriptId],
    queryFn: async () => (await listFn({ data: { scriptId } })) as Row[],
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["script-gaps", scriptId] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
    qc.invalidateQueries({ queryKey: ["script-readiness", scriptId] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
    qc.invalidateQueries({ queryKey: ["script-freshness", scriptId] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
    qc.invalidateQueries({ queryKey: ["story-scripts"] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
  };

  const detected = useMutation({
    mutationFn: async () => (await detectFn({ data: { scriptId, model } })) as Row,
    onSuccess: (r) => {
      if (!r["ok"]) return void toast.error(String(r["error"] ?? "Gap detection failed"));
      toast.success(`${String(r["gapsCreated"])} research gap(s) recorded`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolvedOne = useMutation({
    mutationFn: async (gapId: string) => (await resolveOneFn({ data: { gapId, model } })) as Row,
    onSuccess: (r) => {
      if (!r["ok"]) return void toast.error(String(r["error"] ?? "Research failed"));
      toast.success(GAP_STATUS_LABEL[String(r["status"])] ?? String(r["status"]));
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resolvedAll = useMutation({
    mutationFn: async () => (await resolveAllFn({ data: { scriptId, model } })) as Row,
    onSuccess: (r) => {
      const packet = r["packet"] as Row | null;
      toast.success(
        `${String(r["resolved"])} resolved · ${String(r["notFound"])} not found · ${String(r["conflicting"])} conflicting` +
          (packet?.["version"] ? ` · research packet v${String(packet["version"])} created` : ""),
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regenerated = useMutation({
    mutationFn: async () => (await regenerateFn({ data: { scriptId, model } })) as Row,
    onSuccess: (r) => {
      if (!r["ok"]) return void toast.error(String(r["error"] ?? "Regeneration failed"));
      toast.success(`Regenerated from research packet v${String(r["packetVersion"])}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = gaps ?? [];
  const open = rows.filter((g) => ["OPEN", "RESEARCHING"].includes(String(g["status"])));
  const busy =
    detected.isPending || resolvedOne.isPending || resolvedAll.isPending || regenerated.isPending;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <SectionTitle
        title="Research gaps"
        description="Facts the script needs that the packet does not hold. Each gap gets at most three targeted searches; a failed search never becomes evidence."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => detected.mutate()} disabled={busy}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          {detected.isPending ? "Triaging…" : "Detect gaps from last audit"}
        </Button>
        <Button size="sm" onClick={() => resolvedAll.mutate()} disabled={busy || !open.length}>
          <Search className="mr-1.5 h-3.5 w-3.5" />
          {resolvedAll.isPending ? "Researching…" : `Research ${open.length} open gap(s)`}
        </Button>
        <Button size="sm" variant="outline" onClick={() => regenerated.mutate()} disabled={busy}>
          {regenerated.isPending ? "Regenerating…" : "Regenerate using updated research"}
        </Button>
      </div>

      {rows.length ? (
        <div className="space-y-2">
          {rows.map((g) => {
            const status = String(g["status"]);
            const queries = (Array.isArray(g["queries"]) ? g["queries"] : []) as string[];
            return (
              <div key={String(g["id"])} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={tone(status)}>{GAP_STATUS_LABEL[status] ?? status}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {String(g["missing_evidence_type"]).replace(/_/g, " ").toLowerCase()} ·{" "}
                    {String(g["priority"])} priority ·{" "}
                    {String(g["resolution_type"]).replace(/_/g, " ").toLowerCase()}
                    {g["classification"]
                      ? ` · ${CLASSIFICATION_LABEL[String(g["classification"])] ?? String(g["classification"])}`
                      : ""}
                  </span>
                  {["OPEN", "RESEARCHING"].includes(status) &&
                  String(g["resolution_type"]) === "RESEARCH_REQUIRED" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-7 text-xs"
                      disabled={busy}
                      onClick={() => resolvedOne.mutate(String(g["id"]))}
                    >
                      Research this gap
                    </Button>
                  ) : null}
                </div>

                <p className="mt-1.5 text-sm font-medium">
                  {String(g["claim_under_investigation"])}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  From the script: “{String(g["original_statement"])}”
                </p>
                {g["reason"] ? (
                  <p className="mt-1 text-xs text-muted-foreground">{String(g["reason"])}</p>
                ) : null}
                {queries.length ? (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {queries.join(" · ")}
                  </p>
                ) : null}
                {g["resolution_notes"] ? (
                  <p className="mt-1.5 rounded bg-muted/50 px-2 py-1 text-xs">
                    {String(g["resolution_notes"])}
                  </p>
                ) : null}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {String(g["searches_performed"] ?? 0)} searches ·{" "}
                  {String(g["sources_found"] ?? 0)} sources found ·{" "}
                  {String(g["sources_accepted"] ?? 0)} accepted ·{" "}
                  {g["resolved_packet_version"]
                    ? `packet v${String(g["resolved_packet_version"])} · `
                    : ""}
                  {fmtDateTime(String(g["created_at"]))}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <TriangleAlert className="h-3.5 w-3.5" />
          No research gaps recorded. They appear automatically when a fact check still fails after
          the repair pass.
        </p>
      )}
    </section>
  );
}
