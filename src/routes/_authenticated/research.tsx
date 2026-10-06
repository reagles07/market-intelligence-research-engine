import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Loader2, Search } from "lucide-react";

import { ElapsedIndicator } from "@/components/common/elapsed";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState, StatusBadge } from "@/components/common/ui-bits";
import { Progress } from "@/components/ui/progress";
import { fmtDateTime } from "@/lib/finance";
import { MARKETS } from "@/lib/domain";
import { startManualResearch } from "@/lib/creator.functions";
import { isTestArtifact, plainResearchPhase } from "@/lib/creator/domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/research")({
  head: () => ({
    meta: [
      { title: "Research — Stock Research Studio" },
      {
        name: "description",
        content:
          "Research any US or Indian stock with evidence-backed packets, plain-language status and readiness for scripts.",
      },
      { property: "og:title", content: "Research" },
      {
        property: "og:description",
        content: "Evidence-backed research workspace for any US or Indian stock.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResearchPage,
});

const PHASE_TONE: Record<string, string> = {
  active: "border-sky-300 bg-sky-50 text-sky-700",
  good: "border-emerald-300 bg-emerald-50 text-emerald-700",
  warn: "border-amber-300 bg-amber-50 text-amber-800",
  bad: "border-rose-300 bg-rose-50 text-rose-700",
  muted: "border-border bg-muted text-muted-foreground",
};

function ResearchAnyStockDialog() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"pick" | "new">("pick");
  const start = useServerFn(startManualResearch);

  const { data: companies } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id,name,ticker,exchange,country,is_demo")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (companies ?? [])
      .filter((c) => !c.is_demo && !c.ticker.toUpperCase().startsWith("ZZ"))
      .filter((c) => !t || c.name.toLowerCase().includes(t) || c.ticker.toLowerCase().includes(t))
      .slice(0, 8);
  }, [companies, q]);

  const mutation = useMutation({
    // Create/reuse the story fast and hand off to the research workspace.
    // Orchestration is started there (same engine, same locks) so the modal
    // is never frozen for the duration of a multi-minute run.
    mutationFn: (input: { companyId: string } | { newCompany: Record<string, string> }) =>
      start({ data: { ...input, autostart: false } }),
    onSuccess: (res) => {
      toast.success("Research story ready — start the run from the workspace.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["research-board"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      navigate({
        to: "/stories/$id",
        params: { id: res.storyId },
        search: { autostart: true },
      }).catch((error: unknown) => reportAsyncError(error, "navigation"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FlaskConical className="mr-1.5 h-4 w-4" />
          Research any stock
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Research any stock</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Works even if discovery never selected the stock. Evidence, fact-check and readiness gates
          still apply — nothing is skipped.
        </p>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={mode === "pick" ? "default" : "outline"}
            onClick={() => setMode("pick")}
          >
            Tracked company
          </Button>
          <Button
            size="sm"
            variant={mode === "new" ? "default" : "outline"}
            onClick={() => setMode("new")}
          >
            New ticker
          </Button>
        </div>

        {mode === "pick" ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search ticker or company…"
                className="pl-8"
              />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {matches.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ companyId: c.id })}
                  className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground">
                    {c.ticker} · {c.exchange}
                  </span>
                </button>
              ))}
              {matches.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No tracked company matches — use “New ticker”.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              mutation.mutate({
                newCompany: {
                  ticker: String(form.get("ticker") ?? ""),
                  name: String(form.get("name") ?? ""),
                  exchange: String(form.get("exchange") ?? ""),
                  country: String(form.get("country") ?? "US"),
                  sector: String(form.get("sector") ?? ""),
                },
              });
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="mr-ticker">Ticker</Label>
                <Input id="mr-ticker" name="ticker" required placeholder="RELIANCE / AAPL" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mr-name">Company name</Label>
                <Input id="mr-name" name="name" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mr-exchange">Exchange</Label>
                <Input id="mr-exchange" name="exchange" required placeholder="NSE / NASDAQ" />
              </div>
              <div className="space-y-1.5">
                <Label>Market</Label>
                <select
                  name="country"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  {MARKETS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="mr-sector">Sector (optional)</Label>
                <Input id="mr-sector" name="sector" />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Running research — this can take a few minutes…
                </>
              ) : (
                "Start research"
              )}
            </Button>
          </form>
        )}
        <ElapsedIndicator active={mutation.isPending} step="Running research" />
      </DialogContent>
    </Dialog>
  );
}

function ResearchPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["research-board"],
    queryFn: async () => {
      const [{ data: stories, error }, { data: packets }, { data: runs }, { data: sources }] =
        await Promise.all([
          supabase
            .from("stories")
            .select("id,title,status,updated_at,is_demo,companies(id,ticker,name,country,is_demo)")
            .order("updated_at", { ascending: false })
            .limit(60),
          supabase
            .from("research_packets")
            .select(
              "id,story_id,status,completion_pct,verification_score,version_number,updated_at",
            )
            .order("version_number", { ascending: false }),
          supabase
            .from("research_orchestration_runs")
            .select(
              "id,story_id,status,current_step,started_at,completed_at,readiness,readiness_reason,estimated_cost_usd,sources_added,claims_added",
            )
            .order("started_at", { ascending: false }),
          supabase.from("sources").select("id,story_id"),
        ]);
      if (error) throw error;

      const packetByStory = new Map<string, NonNullable<typeof packets>[number]>();
      for (const p of packets ?? [])
        if (!packetByStory.has(p.story_id)) packetByStory.set(p.story_id, p);
      const runByStory = new Map<string, NonNullable<typeof runs>[number]>();
      for (const r of runs ?? []) if (!runByStory.has(r.story_id)) runByStory.set(r.story_id, r);
      const sourceCount = new Map<string, number>();
      for (const s of sources ?? []) {
        if (s.story_id) sourceCount.set(s.story_id, (sourceCount.get(s.story_id) ?? 0) + 1);
      }

      return (stories ?? [])
        .filter(
          (s) =>
            !isTestArtifact({
              isDemo: s.is_demo || s.companies?.is_demo,
              ticker: s.companies?.ticker,
              name: s.companies?.name,
            }),
        )
        .map((s) => ({
          story: s,
          packet: packetByStory.get(s.id) ?? null,
          run: runByStory.get(s.id) ?? null,
          sources: sourceCount.get(s.id) ?? 0,
        }));
    },
  });

  const rows = data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Research</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every story is backed by an evidence packet. Scripts can only be drafted once research
            is ready.
          </p>
        </div>
        <ResearchAnyStockDialog />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading research…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No research yet"
          description="Research any stock directly, or promote a candidate from the Dashboard."
          action={<ResearchAnyStockDialog />}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map(({ story, packet, run, sources }) => {
            const phase = plainResearchPhase({
              status: run?.status ?? (packet ? packet.status : "NONE"),
              currentStep: run?.current_step,
              startedAt: run?.started_at,
              readiness: run?.readiness,
            });
            const scriptReady =
              run?.status === "READY_FOR_CONTENT" ||
              ["Research Complete", "Script Ready", "Approved"].includes(story.status);
            return (
              <article key={story.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-sm font-semibold">
                      {story.companies?.ticker}
                    </span>
                    <p className="truncate text-sm text-muted-foreground">{story.title}</p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium",
                      PHASE_TONE[phase.tone],
                    )}
                  >
                    {phase.label}
                  </span>
                </div>

                {phase.detail ? (
                  <p className="mt-2 text-xs text-amber-700">{phase.detail}</p>
                ) : null}

                {packet ? (
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Packet v{packet.version_number} completion</span>
                      <span className="tabular-nums">{packet.completion_pct}%</span>
                    </div>
                    <Progress value={packet.completion_pct} className="h-1.5" />
                  </div>
                ) : null}

                <p className="mt-2 text-xs text-muted-foreground">
                  {sources} source{sources === 1 ? "" : "s"}
                  {packet ? ` · verification ${packet.verification_score}` : ""}
                  {run ? ` · last run ${fmtDateTime(run.started_at)}` : ""}
                  {run && run.estimated_cost_usd > 0
                    ? ` · ~$${run.estimated_cost_usd.toFixed(3)}`
                    : ""}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/stories/$id" params={{ id: story.id }}>
                      {run ? "Inspect research" : "Start research"}
                    </Link>
                  </Button>
                  {scriptReady ? (
                    <Button asChild size="sm">
                      <Link to="/scripts/$id" params={{ id: story.id }}>
                        Generate script
                      </Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" disabled title="Research must be ready first">
                      Script locked
                    </Button>
                  )}
                  <StatusBadge value={story.status} className="self-center" />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
