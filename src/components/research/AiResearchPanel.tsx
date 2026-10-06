import { reportAsyncError } from "@/lib/async-errors";
/**
 * AI research controls for one story.
 *
 * Every action is a server function; nothing here talks to OpenAI directly.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/common/ui-bits";
import { supabase } from "@/integrations/supabase/client";
import { useAiModel } from "@/components/providers/use-ai-model";
import {
  analyzeStory,
  buildResearchPacket,
  generateScenarios,
  researchLatestNews,
  verifyClaims,
} from "@/lib/ai/research.functions";
import { ElapsedIndicator } from "@/components/common/elapsed";
import { fmtDateTime } from "@/lib/finance";

export function AiResearchPanel({
  storyId,
  packetId,
}: {
  storyId: string;
  packetId: string | null;
}) {
  const qc = useQueryClient();
  const { model } = useAiModel();

  const analyze = useServerFn(analyzeStory);
  const verify = useServerFn(verifyClaims);
  const web = useServerFn(researchLatestNews);
  const build = useServerFn(buildResearchPacket);
  const scenarios = useServerFn(generateScenarios);

  const { data: runs } = useQuery({
    queryKey: ["web-research-runs", storyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("web_research_runs")
        .select("*")
        .eq("story_id", storyId)
        .order("created_at", { ascending: false })
        .limit(3);
      return data ?? [];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["story-claims", storyId] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
    qc.invalidateQueries({ queryKey: ["packet", storyId] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
    qc.invalidateQueries({ queryKey: ["web-research-runs", storyId] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
    qc.invalidateQueries({ queryKey: ["scenarios"] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
    qc.invalidateQueries({ queryKey: ["research-packets"] }).catch((error: unknown) =>
      reportAsyncError(error, "refresh"),
    );
  };

  const analyzeM = useMutationFactory(
    "Analyse story",
    () => analyze({ data: { storyId, model } }),
    (r) => `${r.claimsInserted} claims extracted · ${r.unsupportedClaims} unsupported`,
    refresh,
  );
  const verifyM = useMutationFactory(
    "Verify claims",
    () => verify({ data: { storyId, model } }),
    (r) => `${r.updated ?? 0} updated · ${r.conflicts ?? 0} conflicts`,
    refresh,
  );
  const webM = useMutationFactory(
    "Research latest news",
    () => web({ data: { storyId, model, rebuildPacket: false } }),
    (r) =>
      r.noNewInformation
        ? "No new information found after the multi-source pass"
        : `${r.sourcesNew} new sources · ${r.claimsAdded} claims · ${r.conflicts} conflicts`,
    refresh,
  );
  const webPacketM = useMutationFactory(
    "Research + new packet version",
    () => web({ data: { storyId, model, rebuildPacket: true } }),
    (r) =>
      `${r.sourcesNew} new sources · packet v${r.packetVersion ?? "—"}${
        r.packetError ? ` (packet failed: ${r.packetError})` : ""
      }`,
    refresh,
  );
  const buildM = useMutationFactory(
    "Build research packet",
    () => build({ data: { storyId, model } }),
    (r) => `Version ${r.version} · ${r.completionPct}% complete`,
    refresh,
  );
  const scenariosM = useMutationFactory(
    "Generate scenarios",
    () => scenarios({ data: { packetId: packetId ?? "", model } }),
    (r) => `${r.scenarios} scenarios · ${r.priceTargetsWithheld} targets withheld`,
    refresh,
  );

  const busy =
    analyzeM.isPending ||
    verifyM.isPending ||
    webM.isPending ||
    webPacketM.isPending ||
    buildM.isPending ||
    scenariosM.isPending;

  const last = runs?.[0];
  const summary =
    (webM.data && webM.data.ok ? webM.data.summary : null) ??
    (webPacketM.data && webPacketM.data.ok ? webPacketM.data.summary : null);
  const stages = (webM.data && webM.data.ok ? webM.data.rapidSteps : null) ??
    (webPacketM.data && webPacketM.data.ok ? webPacketM.data.rapidSteps : null) ?? [
      "Planning targeted searches",
      "Searching company filings",
      "Checking recent news",
      "Cross-checking numbers",
      "Building evidence",
    ];

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <SectionTitle
        title="AI research engine"
        description={`Model ${model}. Database mode never leaves your data; web mode searches the open web and records every source.`}
      />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => analyzeM.mutate()}>
          {analyzeM.isPending ? "Analysing…" : "Analyse story"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => verifyM.mutate()}>
          {verifyM.isPending ? "Verifying…" : "Verify claims"}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => webM.mutate()}>
          {webM.isPending ? "Searching the web…" : "Research latest news"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => webPacketM.mutate()}>
          {webPacketM.isPending ? "Researching…" : "Research + new packet version"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => buildM.mutate()}>
          {buildM.isPending ? "Building…" : "Build packet version"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !packetId}
          onClick={() => scenariosM.mutate()}
        >
          {scenariosM.isPending ? "Generating…" : "Generate scenarios"}
        </Button>
      </div>

      <ElapsedIndicator active={busy} />

      {webM.isPending || webPacketM.isPending ? (
        <p className="text-xs text-muted-foreground">
          Rapid Fact Pass stages: {stages.join(" → ")}. Each stage runs a small set of different
          targeted searches; there is no progress percentage or ETA.
        </p>
      ) : null}

      {summary ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
          <p className="font-medium">This pass</p>
          <p className="mt-1 tabular-nums text-muted-foreground">
            {summary.sourcesChecked} sources checked · {summary.primarySources} primary ·{" "}
            {summary.independentConfirmations} independent confirmations · {summary.conflicts}{" "}
            conflicts · {summary.searches} searches
            {summary.unreadableDocuments
              ? ` · ${summary.unreadableDocuments} documents could not be opened`
              : ""}
          </p>
          <p className="mt-1 text-muted-foreground">
            Still missing:{" "}
            {summary.stillMissing.length ? summary.stillMissing.join(", ") : "nothing flagged"}
          </p>
        </div>
      ) : null}

      {last ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
          <p className="font-medium">Last web research · {fmtDateTime(last.created_at)}</p>
          <p className="mt-1 text-muted-foreground">{last.delta_summary ?? "—"}</p>
          <p className="mt-1 tabular-nums text-muted-foreground">
            {last.sources_new} new sources · {last.sources_duplicate} duplicates ·{" "}
            {last.claims_added} claims · {last.conflicts} conflicts · {last.confirmations}{" "}
            confirmations · {last.web_search_calls} searches · $
            {Number(last.estimated_cost_usd ?? 0).toFixed(4)}
          </p>
          {Array.isArray(last.unresolved_questions) && last.unresolved_questions.length ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {(last.unresolved_questions as string[]).map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No web research run yet for this story.</p>
      )}
    </section>
  );
}

/** Shared mutation wrapper: one toast contract for every AI action. */
function useMutationFactory<T extends { ok: boolean }>(
  label: string,
  fn: () => Promise<T>,
  describe: (res: Extract<T, { ok: true }>) => string,
  refresh: () => void,
) {
  return useMutation({
    mutationFn: fn,
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(`${label} failed: ${(res as { error?: string }).error ?? "unknown error"}`);
        return;
      }
      toast.success(`${label} — ${describe(res as Extract<T, { ok: true }>)}`);
      refresh();
    },
    onError: (e: Error) => toast.error(`${label} failed: ${e.message}`),
  });
}
