import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FileText, FlaskConical, Layers, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { ElapsedIndicator } from "@/components/common/elapsed";
import { SyncIndianApiButton } from "@/components/providers/SyncIndianApiButton";
import { SyncSecButton } from "@/components/providers/SyncSecButton";
import { SecFilingsSection } from "@/components/providers/SecFilingsSection";
import { Button } from "@/components/ui/button";
import { startManualResearch } from "@/lib/creator.functions";
import { plainResearchPhase } from "@/lib/creator/domain";
import { cn } from "@/lib/utils";
import {
  Delta,
  DemoBadge,
  Disclaimer,
  EmptyState,
  FreshnessBadge,
  KpiCard,
  SectionTitle,
  StatusBadge,
} from "@/components/common/ui-bits";
import { fmtDateTime, fmtMarketCap, fmtMoney, fmtNum, fmtPct } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/stocks/$id")({
  head: () => ({
    meta: [
      { title: "Company Profile — Stock Research Studio" },
      {
        name: "description",
        content:
          "Company profile with business model, moat notes, latest market snapshot, valuation and technical metrics.",
      },
      { property: "og:title", content: "Company Profile" },
      {
        property: "og:description",
        content: "Business model, moat, market snapshot, valuation and technicals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  errorComponent: () => (
    <EmptyState title="Could not load company" description="Try again in a moment." />
  ),
  notFoundComponent: () => (
    <EmptyState title="Company not found" description="This company no longer exists." />
  ),
  component: StockDetail,
});

function StockDetail() {
  const { id } = Route.useParams();

  const { data: company } = useQuery({
    queryKey: ["company", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: snapshot } = useQuery({
    queryKey: ["snapshot", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("market_snapshots")
        .select("*")
        .eq("company_id", id)
        .order("as_of", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: valuation } = useQuery({
    queryKey: ["valuation", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("valuations")
        .select("*")
        .eq("company_id", id)
        .order("as_of", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: technical } = useQuery({
    queryKey: ["technical", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("technical_metrics")
        .select("*")
        .eq("company_id", id)
        .order("as_of", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: periods } = useQuery({
    queryKey: ["periods", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("financial_periods")
        .select("*")
        .eq("company_id", id)
        .order("fiscal_year", { ascending: false })
        .limit(8);
      return data ?? [];
    },
  });

  const { data: stories } = useQuery({
    queryKey: ["company-stories", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("stories")
        .select("*")
        .eq("company_id", id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const storyIds = (stories ?? []).map((s) => s.id);

  const { data: latestRun } = useQuery({
    queryKey: ["company-latest-run", id, storyIds.length],
    enabled: storyIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("research_orchestration_runs")
        .select("id,story_id,status,current_step,started_at,readiness")
        .in("story_id", storyIds)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: companyScripts } = useQuery({
    queryKey: ["company-scripts", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("scripts")
        .select("id,status,format,updated_at")
        .eq("company_id", id)
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  const navigate = useNavigate();
  const qc = useQueryClient();
  const startResearchFn = useServerFn(startManualResearch);
  const researchMutation = useMutation({
    mutationFn: () => startResearchFn({ data: { companyId: id } }),
    onSuccess: (res) => {
      toast.success(
        res.runStatus ? `Research finished: ${res.runStatus}` : "Research story created.",
      );
      qc.invalidateQueries({ queryKey: ["company-stories", id] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["company-latest-run", id] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      navigate({ to: "/stories/$id", params: { id: res.storyId } }).catch((error: unknown) =>
        reportAsyncError(error, "navigation"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!company) return <div className="text-sm text-muted-foreground">Loading company…</div>;

  const latestStory = stories?.[0] ?? null;
  const phase = latestRun
    ? plainResearchPhase({
        status: latestRun.status,
        currentStep: latestRun.current_step,
        startedAt: latestRun.started_at,
        readiness: latestRun.readiness,
      })
    : null;
  const scriptReady =
    latestRun?.status === "READY_FOR_CONTENT" ||
    (latestStory
      ? ["Research Complete", "Script Ready", "Approved"].includes(latestStory.status)
      : false);

  const cur = company.currency;

  const isIndia = company.country === "India";
  const isUs = company.country === "United States" || company.country === "US";
  // Honest missing-data wording: a snapshot row with null numbers is not the
  // same thing as having no snapshot at all.
  const missingLabel = snapshot ? "Not provided" : "Not loaded";
  const missingHint = snapshot
    ? "No structured value in the latest market snapshot"
    : "No market snapshot recorded yet";

  const datasets: Array<{ label: string; loaded: boolean; hint: string }> = [
    {
      label: "Market snapshot",
      loaded: Boolean(snapshot),
      hint: snapshot
        ? `As of ${fmtDateTime(snapshot.as_of)}`
        : "Price, daily change and volume ratio",
    },
    {
      label: "Financial periods",
      loaded: (periods ?? []).length > 0,
      hint: (periods ?? []).length
        ? `${periods!.length} reported period(s)`
        : "Revenue, income, cash flow and EPS history",
    },
    {
      label: "Valuation",
      loaded: Boolean(valuation),
      hint: valuation ? `As of ${fmtDateTime(valuation.as_of)}` : "P/E, PEG, P/S, EV multiples",
    },
    {
      label: "Technicals",
      loaded: Boolean(technical),
      hint: technical ? `As of ${fmtDateTime(technical.as_of)}` : "Trend, RSI, moving averages",
    },
    {
      label: "Business profile",
      loaded: Boolean(company.description) || (company.moat_categories?.length ?? 0) > 0,
      hint: "Description, moat categories and peers",
    },
  ];

  const syncHint = isIndia
    ? "Use the Sync IndianAPI button above to load market and fundamental data for this company. Nothing is fetched automatically."
    : isUs
      ? "Use the Sync SEC button above to load filings and reported financials for this company. Nothing is fetched automatically."
      : "No provider sync is configured for this market. Data must come from research.";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {company.name}{" "}
              <span className="font-mono text-base text-muted-foreground">{company.ticker}</span>
            </h1>
            {company.is_demo ? <DemoBadge /> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {company.exchange} · {company.country} · {company.sector ?? "—"} ·{" "}
            {company.industry ?? "—"}
          </p>
        </div>
        <div className="flex items-start gap-2">
          {company.country === "India" ? (
            <SyncIndianApiButton companyId={company.id} companyName={company.name} />
          ) : null}
          {company.country === "United States" || company.country === "US" ? (
            <SyncSecButton companyId={company.id} ticker={company.ticker} />
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link to="/stocks">Back to universe</Link>
          </Button>
        </div>
      </div>

      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        {latestStory ? (
          <>
            <Button asChild size="sm">
              <Link to="/stories/$id" params={{ id: latestStory.id }}>
                <FlaskConical className="mr-1.5 h-4 w-4" />
                {latestRun ? "Open research & evidence" : "Start research"}
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={researchMutation.isPending}
              onClick={() => researchMutation.mutate()}
            >
              {researchMutation.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : null}
              Refresh research
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={researchMutation.isPending}
            onClick={() => researchMutation.mutate()}
          >
            {researchMutation.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="mr-1.5 h-4 w-4" />
            )}
            {researchMutation.isPending
              ? "Researching — can take a few minutes…"
              : "Research this stock"}
          </Button>
        )}

        {latestStory ? (
          scriptReady ? (
            <Button asChild size="sm" variant="outline">
              <Link to="/scripts/$id" params={{ id: latestStory.id }}>
                <FileText className="mr-1.5 h-4 w-4" />
                Generate script
              </Link>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled
              title="Available once research is ready (evidence and readiness gates apply)"
            >
              <FileText className="mr-1.5 h-4 w-4" />
              Script locked until research is ready
            </Button>
          )
        ) : null}

        {scriptReady ? (
          <Button asChild size="sm" variant="outline">
            <Link to="/scripts/composer" search={{ company: company.id }}>
              <Layers className="mr-1.5 h-4 w-4" />
              Add to Content Composer
            </Link>
          </Button>
        ) : null}

        <Button asChild size="sm" variant="ghost">
          <Link to="/scripts">View scripts ({companyScripts?.length ?? 0})</Link>
        </Button>

        <ElapsedIndicator
          active={researchMutation.isPending}
          step="Running research orchestration"
          className="w-full"
        />

        {phase ? (
          <span
            className={cn(
              "ml-auto inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
              phase.tone === "good"
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : phase.tone === "active"
                  ? "border-sky-300 bg-sky-50 text-sky-700"
                  : phase.tone === "bad"
                    ? "border-rose-300 bg-rose-50 text-rose-700"
                    : phase.tone === "warn"
                      ? "border-amber-300 bg-amber-50 text-amber-800"
                      : "border-border bg-muted text-muted-foreground",
            )}
          >
            {phase.label}
          </span>
        ) : null}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="Price"
          value={typeof snapshot?.price === "number" ? fmtMoney(snapshot.price, cur) : missingLabel}
          hint={missingHint}
        />
        <KpiCard
          label="Daily change"
          value={
            typeof snapshot?.daily_change_pct === "number" ? (
              <Delta value={snapshot.daily_change_pct} />
            ) : (
              missingLabel
            )
          }
          hint={missingHint}
        />
        <KpiCard
          label="Volume ratio"
          value={
            typeof snapshot?.volume_ratio === "number"
              ? fmtNum(snapshot.volume_ratio, 2)
              : missingLabel
          }
          hint={missingHint}
        />
        <KpiCard
          label="Market cap"
          value={
            typeof company.market_cap === "number"
              ? fmtMarketCap(company.market_cap, cur)
              : "Not loaded"
          }
          hint={
            typeof company.market_cap === "number"
              ? "From company record"
              : "No fundamentals loaded yet"
          }
        />
        <KpiCard
          label="Data freshness"
          value={<FreshnessBadge freshness={snapshot?.freshness ?? "Unknown"} />}
          hint={snapshot?.as_of ? `As of ${fmtDateTime(snapshot.as_of)}` : "No snapshot recorded"}
        />
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle
          title="Data availability"
          description="Which structured datasets are loaded for this company. Missing data is never estimated."
        />
        <ul className="grid gap-2 sm:grid-cols-2">
          {datasets.map((d) => (
            <li
              key={d.label}
              className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{d.label}</p>
                <p className="text-[11px] text-muted-foreground">{d.hint}</p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium",
                  d.loaded
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {d.loaded ? "Loaded" : "Not loaded"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{syncHint}</p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle title="Business & moat" />
        <p className="text-sm text-muted-foreground">
          {company.description ?? "No description recorded."}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Moat categories</p>
            <p className="mt-1 text-sm">
              {company.moat_categories.length ? company.moat_categories.join(", ") : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">Moat strength</p>
            <p className="mt-1 text-sm">
              {company.moat_strength === null ? "—" : `${company.moat_strength}/10`}
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">Evidence</p>
            <p className="mt-1 text-sm text-muted-foreground">{company.moat_evidence ?? "—"}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">Peers</p>
            <p className="mt-1 text-sm">{company.peers.length ? company.peers.join(", ") : "—"}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <SectionTitle title="Valuation" />
          {valuation ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Row label="Trailing P/E" value={fmtNum(valuation.trailing_pe)} />
              <Row label="Forward P/E" value={fmtNum(valuation.forward_pe)} />
              <Row label="PEG" value={fmtNum(valuation.peg)} />
              <Row label="P/S" value={fmtNum(valuation.price_sales)} />
              <Row label="P/B" value={fmtNum(valuation.price_book)} />
              <Row label="EV/EBITDA" value={fmtNum(valuation.ev_ebitda)} />
              <Row label="FCF yield" value={fmtPct(valuation.fcf_yield)} />
              <Row label="Dividend yield" value={fmtPct(valuation.dividend_yield)} />
              <Row label="Classification" value={valuation.classification ?? "—"} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No valuation data recorded.</p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <SectionTitle title="Technical snapshot" />
          {technical ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Row label="Trend" value={technical.trend ?? "—"} />
              <Row label="RSI" value={fmtNum(technical.rsi)} />
              <Row
                label="MA 20 / 50 / 200"
                value={`${fmtNum(technical.ma_20)} / ${fmtNum(technical.ma_50)} / ${fmtNum(technical.ma_200)}`}
              />
              <Row
                label="52w high / low"
                value={`${fmtNum(technical.high_52w)} / ${fmtNum(technical.low_52w)}`}
              />
              <Row label="Support" value={technical.support_levels.join(", ") || "—"} />
              <Row label="Resistance" value={technical.resistance_levels.join(", ") || "—"} />
              <Row label="Relative strength" value={fmtNum(technical.relative_strength)} />
              <Row label="ATR" value={fmtNum(technical.atr)} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No technical data recorded.</p>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle title="Financial periods" description="Most recent reported periods." />
        {(periods ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No financial periods recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Period</th>
                  <th className="py-2 text-right font-medium">Revenue</th>
                  <th className="py-2 text-right font-medium">Operating income</th>
                  <th className="py-2 text-right font-medium">Net income</th>
                  <th className="py-2 text-right font-medium">FCF</th>
                  <th className="py-2 text-right font-medium">EPS</th>
                </tr>
              </thead>
              <tbody>
                {(periods ?? []).map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="py-2">
                      {p.fiscal_year}
                      {p.fiscal_quarter ? ` ${p.fiscal_quarter}` : ""}{" "}
                      <span className="text-xs text-muted-foreground">({p.period_type})</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{fmtNum(p.revenue, 0)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtNum(p.operating_income, 0)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{fmtNum(p.net_income, 0)}</td>
                    <td className="py-2 text-right tabular-nums">{fmtNum(p.free_cash_flow, 0)}</td>
                    <td className="py-2 text-right tabular-nums">{fmtNum(p.eps_gaap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Units: {periods?.[0]?.units ?? "—"} · Currency: {periods?.[0]?.currency ?? cur}
            </p>
          </div>
        )}
      </section>

      {company.country === "US" || company.country === "United States" ? (
        <SecFilingsSection companyId={company.id} />
      ) : null}

      <section>
        <SectionTitle title="Stories" />
        {(stories ?? []).length === 0 ? (
          <EmptyState title="No stories" description="No research stories for this company yet." />
        ) : (
          <div className="space-y-2">
            {(stories ?? []).map((s) => (
              <Link
                key={s.id}
                to="/stories/$id"
                params={{ id: s.id }}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 hover:border-primary/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {s.story_type} · {fmtDateTime(s.event_at ?? s.created_at)}
                  </p>
                </div>
                <StatusBadge value={s.status} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <Disclaimer />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}
