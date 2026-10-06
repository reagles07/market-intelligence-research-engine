import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, ChevronDown, Radar } from "lucide-react";

import { useMarket } from "@/lib/market-context-value";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Disclaimer, EmptyState, SectionTitle } from "@/components/common/ui-bits";
import { getAttentionDetail, getTodayOverview } from "@/lib/creator.functions";
import { promoteCandidate } from "@/lib/discovery.functions";

import {
  FRESHNESS_HELP,
  FRESHNESS_LABEL,
  FRESHNESS_TONE,
  deriveDataFreshness,
  formatAge,
  freshnessSummary,
  isTestArtifact,
  plainResearchPhase,
} from "@/lib/creator/domain";

import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Today — Stock Research Studio" },
      {
        name: "description",
        content:
          "What is worth researching now, what needs attention, and how fresh the data is for US and Indian markets.",
      },
      { property: "og:title", content: "Today — Stock Research Studio" },
      {
        property: "og:description",
        content: "Worth researching now, attention items and data freshness per market.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function FreshnessCard({
  market,
  automationEnabled,
  lastRunAt,
}: {
  market: string;
  automationEnabled: boolean;
  lastRunAt: string | null | undefined;
}) {
  const { state, ageState, ageHours, automationOff } = deriveDataFreshness({
    automationEnabled,
    lastRunAt,
  });
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{market}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              FRESHNESS_TONE[state],
            )}
          >
            {FRESHNESS_LABEL[state]}
          </span>
          {/* Automation-off must never hide the real data age. */}
          {automationOff && ageState !== "CURRENT" ? (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                FRESHNESS_TONE[ageState],
              )}
            >
              {FRESHNESS_LABEL[ageState]}
            </span>
          ) : null}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {freshnessSummary({ automationEnabled, lastRunAt })}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {lastRunAt
          ? `Latest completed discovery run ${fmtDateTime(lastRunAt)} (${formatAge(ageHours)})`
          : "No completed discovery run recorded"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {automationOff && ageState !== "CURRENT"
          ? `${FRESHNESS_HELP.AUTOMATION_OFF} ${FRESHNESS_HELP[ageState]}`
          : FRESHNESS_HELP[state]}
      </p>
    </div>
  );
}

function Dashboard() {
  const { market } = useMarket();
  const qc = useQueryClient();
  const overviewFn = useServerFn(getTodayOverview);
  const promote = useServerFn(promoteCandidate);

  const { data, isLoading } = useQuery({
    queryKey: ["today-overview"],
    queryFn: () => overviewFn({}),
    refetchInterval: 60_000,
  });

  const promoteMutation = useMutation({
    mutationFn: (candidateId: string) => promote({ data: { candidateId } }),
    onSuccess: () => {
      toast.success("Promoted — research story created.");
      qc.invalidateQueries({ queryKey: ["today-overview"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["stories"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const marketsShown = market === "All" ? (["India", "US"] as const) : ([market] as const);
  const candidates = (data?.topCandidates ?? []).filter(
    (c) =>
      !isTestArtifact({ ticker: c.ticker, name: c.company_name }) &&
      (market === "All" || c.market === market),
  );
  const openRuns = (data?.attention.openResearchRuns ?? []).map((r) => ({
    ...r,
    phase: plainResearchPhase({
      status: r.status,
      currentStep: r.current_step,
      startedAt: r.started_at,
      readiness: r.readiness,
    }),
  }));
  const researchAttention = openRuns.filter((r) => r.phase.tone !== "active").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Today</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What is worth researching, what needs your attention, and how fresh the data is.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/research">
            <Radar className="mr-1.5 h-4 w-4" />
            Research any stock
          </Link>
        </Button>
      </div>

      <section aria-label="Data freshness">
        <div className="grid gap-3 sm:grid-cols-2">
          {marketsShown.map((m) => (
            <FreshnessCard
              key={m}
              market={m}
              automationEnabled={
                data?.automation
                  ? data.automation.automationEnabled &&
                    (m === "India" ? data.automation.indiaEnabled : data.automation.usEnabled)
                  : false
              }
              lastRunAt={data?.latestRuns?.[m]?.started_at ?? null}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle
          title="Worth researching now"
          description="Top candidates from the latest discovery run for each market — a content signal, not an investment signal."
          action={
            <Button asChild size="sm" variant="ghost">
              <Link to="/candidates">
                All candidates <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          }
        />
        {isLoading ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : candidates.length === 0 ? (
          <EmptyState
            title="No fresh candidates"
            description="Run discovery from the Candidates page, or research any stock directly."
            action={
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/candidates">Open candidates</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/research">Research any stock</Link>
                </Button>
              </div>
            }
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {candidates.slice(0, 6).map((c) => (
              <article key={c.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {c.ticker ?? c.company_name}
                      </span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium">
                        {c.market}
                      </span>
                      <span className="text-xs text-muted-foreground">{c.primary_type}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm">{c.title}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Score {c.content_score} · {c.signal_count} signal
                      {c.signal_count === 1 ? "" : "s"} · found {fmtDateTime(c.discovered_at)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={promoteMutation.isPending}
                    onClick={() => promoteMutation.mutate(c.id)}
                  >
                    Research
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle
          title="Needs attention"
          description="Expand a card to preview the top items — nothing heavy loads until you do."
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <AttentionCard
            kind="research"
            label="Research to review"
            value={researchAttention}
            tone={researchAttention > 0 ? "warn" : "default"}
            hint="Stalled, needs-review or insufficient-evidence runs"
            viewAllTo="/research"
          />
          <AttentionCard
            kind="scripts_review"
            label="Scripts to review"
            value={data?.attention.scriptsNeedingReview ?? 0}
            tone={(data?.attention.scriptsNeedingReview ?? 0) > 0 ? "warn" : "default"}
            hint="Draft or awaiting fact check"
            viewAllTo="/scripts"
          />
          <AttentionCard
            kind="scripts_ready"
            label="Scripts ready"
            value={data?.attention.scriptsReady ?? 0}
            tone={(data?.attention.scriptsReady ?? 0) > 0 ? "good" : "default"}
            hint="Ready for your review"
            viewAllTo="/scripts"
          />
          <AttentionCard
            kind="claims"
            label="Claims in conflict"
            value={data?.attention.claimsAttention ?? 0}
            tone={(data?.attention.claimsAttention ?? 0) > 0 ? "bad" : "default"}
            hint="Conflicting or unsupported evidence"
            viewAllTo="/sources"
          />
        </div>
      </section>

      <Disclaimer />
    </div>
  );
}

type AttentionKind = "research" | "scripts_review" | "scripts_ready" | "claims";

/**
 * A KPI card that expands into a compact preview of the top few items.
 * The detail query only runs after the creator opens the card.
 */
function AttentionCard({
  kind,
  label,
  value,
  tone,
  hint,
  viewAllTo,
}: {
  kind: AttentionKind;
  label: string;
  value: number;
  tone: "default" | "warn" | "good" | "bad";
  hint: string;
  viewAllTo: "/research" | "/scripts" | "/sources";
}) {
  const [open, setOpen] = useState(false);
  const detailFn = useServerFn(getAttentionDetail);

  const { data, isLoading } = useQuery({
    queryKey: ["attention-detail", kind],
    enabled: open && value > 0,
    queryFn: () => detailFn({ data: { kind, limit: 5 } }),
  });

  const items = data?.items ?? [];

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
      >
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              "mt-1.5 text-2xl font-semibold tabular-nums tracking-tight",
              tone === "warn" && "text-amber-600",
              tone === "good" && "text-emerald-600",
              tone === "bad" && "text-rose-600",
            )}
          >
            {value}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <ChevronDown
          className={cn(
            "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="space-y-1.5 border-t border-border p-3">
          {value === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing needs attention here.</p>
          ) : isLoading ? (
            <Skeleton className="h-16 rounded-lg" />
          ) : items.length === 0 ? (
            <p className="text-xs text-muted-foreground">No items could be loaded.</p>
          ) : (
            items.map((item) => <AttentionRow key={item.id} kind={kind} item={item} />)
          )}
          <Button asChild size="sm" variant="ghost" className="w-full justify-center">
            <Link to={viewAllTo}>
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type AttentionItem = Record<string, unknown> & { id: string };

function AttentionRow({ kind, item }: { kind: AttentionKind; item: AttentionItem }) {
  const str = (k: string) => {
    const v = item[k];
    return typeof v === "string" && v.length ? v : null;
  };

  if (kind === "research") {
    const phase = plainResearchPhase({
      status: String(item["status"] ?? ""),
      currentStep: str("currentStep"),
      startedAt: str("startedAt"),
      readiness: str("readiness"),
    });
    return (
      <Link
        to="/stories/$id"
        params={{ id: String(item["storyId"]) }}
        className="block rounded-lg border border-border px-3 py-2 hover:border-primary/50"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs font-semibold">
            {str("ticker") ?? str("companyName") ?? "Unlinked story"}
          </span>
          <span className="text-[11px] text-muted-foreground">{phase.label}</span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{str("title") ?? "—"}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          started {fmtDateTime(str("startedAt"))} · updated {fmtDateTime(str("updatedAt"))}
        </p>
      </Link>
    );
  }

  if (kind === "claims") {
    return (
      <Link
        to="/sources"
        className="block rounded-lg border border-border px-3 py-2 hover:border-primary/50"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs font-semibold">{str("ticker") ?? "Unlinked"}</span>
          <span className="text-[11px] text-muted-foreground">
            {str("verificationStatus") ?? "—"}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {str("claimText") ?? "—"}
        </p>
      </Link>
    );
  }

  return (
    <Link
      to="/scripts/$id"
      params={{ id: String(item["storyId"] ?? "") }}
      className="block rounded-lg border border-border px-3 py-2 hover:border-primary/50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{str("ticker") ?? "—"}</span>
        <span className="text-[11px] text-muted-foreground">
          {str("packRole") ?? str("format") ?? "Script"}
        </span>
      </div>
      <p className="mt-0.5 truncate text-xs">{str("title") ?? "Untitled script"}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {str("status") ?? "—"} · audit {str("auditStatus") ?? "Not Audited"}
      </p>
    </Link>
  );
}
