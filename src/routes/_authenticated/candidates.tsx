import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { History, Info, Loader2, Radar } from "lucide-react";

import { ElapsedIndicator } from "@/components/common/elapsed";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, SectionTitle } from "@/components/common/ui-bits";
import { CandidateCard, type CandidateRow } from "@/components/discovery/CandidateCard";
import {
  dismissCandidate,
  promoteCandidate,
  restoreCandidate,
  startDiscoveryRun,
} from "@/lib/discovery.functions";
import { listRunBoard } from "@/lib/creator.functions";
import { US_COVERAGE_NOTE } from "@/lib/discovery/domain";
import { isEligibleRun, isTestArtifact } from "@/lib/creator/domain";
import { fmtDateTime } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/candidates")({
  head: () => ({
    meta: [
      { title: "Story Candidates — Stock Research Studio" },
      {
        name: "description",
        content:
          "Ranked India and US story candidates from the latest discovery run, with history for older runs.",
      },
      { property: "og:title", content: "Story Candidates" },
      {
        property: "og:description",
        content: "Latest-run candidates with scoring breakdowns and run history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CandidatesPage,
});

type Market = "India" | "US";

function CandidatesPage() {
  const queryClient = useQueryClient();
  const [market, setMarket] = useState<Market>("India");
  const [runId, setRunId] = useState<string | null>(null); // null = latest run
  const [showDismissed, setShowDismissed] = useState(false);
  const [showTest, setShowTest] = useState(false);

  const fetchBoard = useServerFn(listRunBoard);
  const start = useServerFn(startDiscoveryRun);
  const promote = useServerFn(promoteCandidate);
  const dismiss = useServerFn(dismissCandidate);
  const restore = useServerFn(restoreCandidate);

  const board = useQuery({
    queryKey: ["run-board", market, runId ?? "latest"],
    queryFn: () => fetchBoard({ data: runId ? { market, runId } : { market } }),
  });

  const run = board.data?.run ?? null;
  const runs = board.data?.runs ?? [];
  const latestEligible = runs.find((r) => isEligibleRun(r)) ?? null;
  const isLatest = Boolean(run && latestEligible?.id === run.id);

  const invalidate = () => {
    queryClient
      .invalidateQueries({ queryKey: ["run-board"] })
      .catch((error: unknown) => reportAsyncError(error, "refresh"));
    queryClient
      .invalidateQueries({ queryKey: ["today-overview"] })
      .catch((error: unknown) => reportAsyncError(error, "refresh"));
  };

  const runDiscovery = useMutation({
    mutationFn: () => start({ data: { market } }),
    onSuccess: (res) => {
      setRunId(null);
      invalidate();
      toast.success(
        `${res.candidatesCreated} candidates from ${res.rawSignals} signals · ${res.duplicatesMerged} merged`,
      );
      if (res.errors.length) toast.warning(res.errors[0] ?? "Run completed with issues");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const act = useMutation({
    mutationFn: async (input: { kind: "promote" | "dismiss" | "restore"; id: string }) => {
      if (input.kind === "promote") return promote({ data: { candidateId: input.id } });
      if (input.kind === "dismiss") return dismiss({ data: { candidateId: input.id } });
      return restore({ data: { candidateId: input.id } });
    },
    onSuccess: (_res, input) => {
      invalidate();
      toast.success(
        input.kind === "promote"
          ? "Promoted into the story queue"
          : input.kind === "dismiss"
            ? "Candidate dismissed"
            : "Candidate restored",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = ((board.data?.candidates ?? []) as unknown as CandidateRow[]).filter((c) => {
    if (!showDismissed && c.status === "DISMISSED") return false;
    if (!showTest && isTestArtifact({ ticker: c.ticker, name: c.company_name })) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle
          title="Story candidates"
          description="What is worth researching, ranked by content opportunity — not by investment merit."
        />

        <div className="flex items-center gap-2">
          <Tabs
            value={market}
            onValueChange={(v) => {
              setMarket(v as Market);
              setRunId(null);
            }}
          >
            <TabsList>
              <TabsTrigger value="India">India</TabsTrigger>
              <TabsTrigger value="US">US</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={() => runDiscovery.mutate()} disabled={runDiscovery.isPending}>
            {runDiscovery.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Radar className="mr-1 h-4 w-4" />
            )}
            Run {market} discovery
          </Button>
        </div>
      </div>

      <ElapsedIndicator active={runDiscovery.isPending} step={`${market} discovery`} />

      {market === "US" ? (
        <Card className="flex items-start gap-2 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{US_COVERAGE_NOTE}</span>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <Select
          value={runId ?? "latest"}
          onValueChange={(v) => setRunId(v === "latest" ? null : v)}
        >
          <SelectTrigger className="h-8 w-72">
            <SelectValue placeholder="Latest run" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">Latest run</SelectItem>
            {runs.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {fmtDateTime(r.started_at)} · {r.status} · {r.candidates_created} candidates
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {run ? (
          <span className="text-xs text-muted-foreground">
            {isLatest ? "Showing the latest run" : "Showing a historical run"} ·{" "}
            {fmtDateTime(run.started_at)} · {run.status}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No runs yet for {market}.</span>
        )}
      </div>

      {run ? (
        <Card className="p-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Run: {fmtDateTime(run.started_at)}</span>
            <span>Status {run.status}</span>
            <span>{run.raw_signals} signals</span>
            <span>{run.candidates_created} candidates</span>
            <span>${Number(run.estimated_cost_usd).toFixed(4)} AI cost</span>
          </div>
          {run.notes ? <p className="mt-1">{run.notes}</p> : null}
        </Card>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{rows.length} candidate(s)</p>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setShowTest((v) => !v)}>
            {showTest ? "Hide test artifacts" : "Show test artifacts"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? "Hide dismissed" : "Show dismissed"}
          </Button>
        </div>
      </div>

      {board.isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading candidates…</Card>
      ) : rows.length === 0 ? (
        <EmptyState
          title={run ? "No candidates in this run" : "No candidates yet"}
          description={`Run ${market} discovery to collect today's signals, cluster them into candidates and rank them.`}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              busy={act.isPending}
              onPromote={(id) => act.mutate({ kind: "promote", id })}
              onDismiss={(id) => act.mutate({ kind: "dismiss", id })}
              onRestore={(id) => act.mutate({ kind: "restore", id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
