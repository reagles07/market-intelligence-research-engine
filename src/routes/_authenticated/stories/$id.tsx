import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CategoryBadge,
  Delta,
  DemoBadge,
  Disclaimer,
  EmptyState,
  KpiCard,
  SectionTitle,
  StatusBadge,
} from "@/components/common/ui-bits";
import { AiResearchPanel } from "@/components/research/AiResearchPanel";
import { FactSprintPanel } from "@/components/research/FactSprintPanel";
import { ResearchOrchestratorPanel } from "@/components/research/ResearchOrchestratorPanel";
import { ContentOrchestratorPanel } from "@/components/content/ContentOrchestratorPanel";

import {
  RESEARCH_SECTIONS,
  SCENARIO_TYPES,
  SCORE_TYPES,
  STORY_STATUSES,
  TIME_HORIZONS,
  classifyScore,
  componentsFor,
  type ScoreTypeKey,
} from "@/lib/domain";
import { researchCompleteness, sectionCoverage } from "@/lib/research/completion";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/stories/$id")({
  validateSearch: (search: Record<string, unknown>): { autostart?: boolean } =>
    search["autostart"] === true || search["autostart"] === "true" ? { autostart: true } : {},

  head: () => ({
    meta: [
      { title: "Research Workspace — Stock Research Studio" },
      {
        name: "description",
        content:
          "Deep-dive research workspace: sections, verified claims, scenarios and scoring for a single equity story.",
      },
      { property: "og:title", content: "Research Workspace" },
      {
        property: "og:description",
        content: "Sections, claims, scenarios and scoring for one equity story.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  errorComponent: () => (
    <EmptyState title="Could not load this story" description="Try again in a moment." />
  ),
  notFoundComponent: () => (
    <EmptyState title="Story not found" description="This story no longer exists." />
  ),
  component: StoryWorkspace,
});

function StoryWorkspace() {
  const { id } = Route.useParams();
  const { autostart } = Route.useSearch();
  const qc = useQueryClient();

  const { data: story } = useQuery({
    queryKey: ["story", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stories")
        .select("*, companies(*)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: packet } = useQuery({
    queryKey: ["packet", id],
    queryFn: async () => {
      // Packets are versioned: always work against the newest version.
      const { data } = await supabase
        .from("research_packets")
        .select("*, research_sections(*)")
        .eq("story_id", id)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const { data: claims } = useQuery({
    queryKey: ["story-claims", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("claims")
        .select("*, sources(title,source_tier,url)")
        .eq("story_id", id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: scenarios } = useQuery({
    queryKey: ["scenarios", packet?.id],
    enabled: !!packet?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("scenario_forecasts")
        .select("*")
        .eq("packet_id", packet!.id);
      return data ?? [];
    },
  });

  const { data: scores } = useQuery({
    queryKey: ["scores", id],
    queryFn: async () => {
      const { data } = await supabase.from("scores").select("*").eq("story_id", id);
      return data ?? [];
    },
  });

  // Canonical readiness for this story, used for honest completion reporting.
  const { data: latestRun } = useQuery({
    queryKey: ["story-latest-run", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("research_orchestration_runs")
        .select("id,status,readiness,readiness_reason,started_at")
        .eq("story_id", id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  // Market metrics fall back to the latest company snapshot when the story row
  // has none (manual research never populates story price fields).
  const { data: snapshot } = useQuery({
    queryKey: ["story-company-snapshot", story?.company_id],
    enabled: Boolean(story?.company_id),
    queryFn: async () => {
      const { data } = await supabase
        .from("market_snapshots")
        .select("price, daily_change_pct, volume_ratio, as_of, source, freshness")
        .eq("company_id", story!.company_id)
        .order("as_of", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const startPacket = useMutation({
    mutationFn: async () => {
      if (!story) throw new Error("Story not loaded");
      const { data, error } = await supabase
        .from("research_packets")
        .insert({ story_id: story.id, company_id: story.company_id, status: "In Progress" })
        .select("id")
        .single();
      if (error) throw error;
      const rows = RESEARCH_SECTIONS.map((s) => ({ packet_id: data.id, section_key: s.key }));
      const { error: e2 } = await supabase.from("research_sections").insert(rows);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Research packet started");
      qc.invalidateQueries({ queryKey: ["packet", id] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["research-packets"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStoryStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from("stories").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["story", id] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["stories"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sections = useMemo(
    () =>
      RESEARCH_SECTIONS.map((meta) => ({
        meta,
        row: (packet?.research_sections ?? []).find((r) => r.section_key === meta.key) ?? null,
      })),
    [packet],
  );

  // Two distinct measures. "Sections written" is a template-fill metric and is
  // never presented as research completeness — a section that says
  // "Insufficient Data" is written, but it is not research.
  const coverage = useMemo(
    () =>
      sectionCoverage(
        (packet?.research_sections ?? []).map((r) => ({
          section_key: r.section_key,
          content: r.content,
        })),
        RESEARCH_SECTIONS.map((s) => s.key),
      ),
    [packet],
  );
  const completeness = useMemo(
    () =>
      researchCompleteness({
        packetCompletionPct: packet?.completion_pct,
        verificationScore: packet?.verification_score,
        readiness: latestRun?.readiness ?? null,
        coverage,
      }),
    [packet?.completion_pct, packet?.verification_score, latestRun?.readiness, coverage],
  );

  const blockingClaims = (claims ?? []).filter((c) =>
    ["Conflicting", "Unsupported"].includes(c.verification_status),
  );

  if (!story) return <div className="text-sm text-muted-foreground">Loading story…</div>;

  const cur = story.companies?.currency ?? "USD";

  // Story field first, latest company snapshot second, honest label third.
  // A snapshot row that exists but carries no number says so explicitly.
  const snapHint = snapshot
    ? `Latest snapshot ${fmtDateTime(snapshot.as_of)}${
        snapshot.source ? ` · ${snapshot.source}` : ""
      }${snapshot.freshness ? ` · ${snapshot.freshness}` : ""}`
    : "No market snapshot recorded for this company";

  function marketMetric(
    storyValue: number | null | undefined,
    snapValue: number | null | undefined,
    render: (v: number) => React.ReactNode,
    storyHint: string,
  ): { value: React.ReactNode; hint: string } {
    if (typeof storyValue === "number") return { value: render(storyValue), hint: storyHint };
    if (typeof snapValue === "number") return { value: render(snapValue), hint: snapHint };
    if (snapshot) {
      return {
        value: "Not provided",
        hint: `No structured value in latest snapshot · ${snapHint}`,
      };
    }
    return { value: "Not loaded", hint: snapHint };
  }

  const priceMetric = marketMetric(
    story.price,
    snapshot?.price,
    (v) => fmtMoney(v, cur),
    story.price_at ? `Story price ${fmtDateTime(story.price_at)}` : "From this story",
  );
  const dailyMetric = marketMetric(
    story.daily_change_pct,
    snapshot?.daily_change_pct,
    (v) => <Delta value={v} />,
    "From this story",
  );
  const volumeMetric = marketMetric(
    story.volume_ratio,
    snapshot?.volume_ratio,
    (v) => fmtNum(v, 2),
    "From this story",
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/stocks/$id"
              params={{ id: story.company_id }}
              className="font-mono text-sm font-semibold hover:underline"
            >
              {story.companies?.ticker}
            </Link>
            <span className="text-xs text-muted-foreground">
              {story.companies?.exchange} · {story.companies?.country}
            </span>
            {story.is_demo ? <DemoBadge /> : null}
            <StatusBadge value={story.priority} />
            {completeness.readiness === "READY_FOR_CONTENT" ||
            completeness.readiness === "NEEDS_REVIEW" ? (
              <Link
                to="/scripts/composer"
                search={{ company: story.company_id }}
                className="rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-muted"
              >
                Add to Content Composer
              </Link>
            ) : null}
          </div>

          <h1 className="mt-1 text-xl font-semibold tracking-tight">{story.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {story.story_type} · event {fmtDateTime(story.event_at)} · catalyst{" "}
            {story.primary_catalyst ?? "—"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={story.status}
            onChange={(e) => setStoryStatus.mutate(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Story status"
          >
            {STORY_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <Button asChild size="sm">
            <Link to="/scripts/$id" params={{ id: story.id }}>
              Script Studio
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard label="Price" value={priceMetric.value} hint={priceMetric.hint} />
        <KpiCard label="Daily move" value={dailyMetric.value} hint={dailyMetric.hint} />
        <KpiCard label="Volume ratio" value={volumeMetric.value} hint={volumeMetric.hint} />
        <KpiCard
          label="Sections written"
          value={`${coverage.written}/${coverage.total}`}
          hint={
            coverage.insufficient > 0
              ? `${coverage.insufficient} record an evidence gap — written is not researched`
              : "Template fill only"
          }
        />
        <KpiCard
          label="Research completeness"
          value={`${completeness.completionPct}%`}
          tone={completeness.tone}
          hint={`${completeness.label} · verification ${completeness.verificationScore}%${
            completeness.readiness
              ? ` · ${completeness.readiness.replaceAll("_", " ").toLowerCase()}`
              : ""
          }`}
        />
        <KpiCard
          label="Blocking claims"
          value={blockingClaims.length}
          tone={blockingClaims.length ? "bad" : "good"}
          hint="Conflicting or unsupported"
        />
      </div>
      <p className="text-xs text-muted-foreground">{completeness.explanation}</p>

      <ResearchOrchestratorPanel storyId={id} autostart={autostart ?? false} />
      <ContentOrchestratorPanel storyId={id} />
      <AiResearchPanel storyId={id} packetId={packet?.id ?? null} />
      <FactSprintPanel storyId={id} packetId={packet?.id ?? null} />

      {!packet ? (
        <EmptyState
          title="No research packet yet"
          description="Start a packet to create all research sections for this story."
          action={
            <Button size="sm" onClick={() => startPacket.mutate()} disabled={startPacket.isPending}>
              {startPacket.isPending ? "Creating…" : "Start research packet"}
            </Button>
          }
        />
      ) : (
        <Tabs defaultValue="sections">
          <TabsList>
            <TabsTrigger value="sections">Research sections</TabsTrigger>
            <TabsTrigger value="claims">Claims</TabsTrigger>
            <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
            <TabsTrigger value="scoring">Scoring</TabsTrigger>
          </TabsList>

          <TabsContent value="sections" className="mt-4 space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {coverage.written} of {coverage.total} sections written · {coverage.substantive}{" "}
                  substantive
                </span>
                <span className="tabular-nums">
                  {coverage.writtenPct}% written / {completeness.completionPct}% researched
                </span>
              </div>
              <Progress value={completeness.completionPct} className="h-1.5" />
            </div>

            {sections.map(({ meta, row }) => (
              <SectionEditor
                key={meta.key}
                packetId={packet.id}
                sectionKey={meta.key}
                label={meta.label}
                critical={meta.critical}
                rowId={row?.id ?? null}
                initial={row?.content ?? ""}
              />
            ))}
          </TabsContent>

          <TabsContent value="claims" className="mt-4">
            {(claims ?? []).length === 0 ? (
              <EmptyState
                title="No claims linked to this story"
                description="Log claims in the Source Verification Center and link them to this story."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link to="/sources">Open verification centre</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-2">
                {(claims ?? []).map((c) => (
                  <div key={c.id} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CategoryBadge value={c.claim_category} />
                        <p className="mt-1.5 text-sm">{c.claim_text}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {c.sources?.title
                            ? `${c.sources.source_tier} — ${c.sources.title}`
                            : "No source attached"}
                        </p>
                      </div>
                      <StatusBadge value={c.verification_status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="scenarios" className="mt-4">
            <ScenarioBoard packetId={packet.id} scenarios={scenarios ?? []} />
          </TabsContent>

          <TabsContent value="scoring" className="mt-4 space-y-4">
            {(Object.keys(SCORE_TYPES) as ScoreTypeKey[]).map((key) => (
              <ScoreCard
                key={key}
                scoreType={key}
                storyId={story.id}
                companyId={story.company_id}
                existing={(scores ?? []).find((s) => s.score_type === SCORE_TYPES[key]) ?? null}
              />
            ))}
          </TabsContent>
        </Tabs>
      )}

      <Disclaimer />
    </div>
  );
}

function SectionEditor({
  packetId,
  sectionKey,
  label,
  critical,
  rowId,
  initial,
}: {
  packetId: string;
  sectionKey: string;
  label: string;
  critical: boolean;
  rowId: string | null;
  initial: string;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);

  useEffect(() => setValue(initial), [initial]);

  const save = useMutation({
    mutationFn: async () => {
      if (rowId) {
        const { error } = await supabase
          .from("research_sections")
          .update({ content: value })
          .eq("id", rowId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("research_sections")
          .insert({ packet_id: packetId, section_key: sectionKey, content: value });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(`${label} saved`);
      qc.invalidateQueries({ queryKey: ["packet"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filled = (initial ?? "").trim().length > 0;

  return (
    <section className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="truncate text-xs text-muted-foreground">
            {critical ? "Critical section" : "Supporting section"}
          </p>
        </div>
        <span
          className={
            filled
              ? "shrink-0 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
              : "shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          }
        >
          {filled ? "Written" : "Empty"}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border p-4">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={8}
            placeholder="Write verified research here. Cite the source for every factual claim."
          />
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save section"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

type ScenarioRow = {
  id: string;
  scenario_type: string;
  probability: number;
  time_horizon: string;
  assumptions: string | null;
  catalysts: string | null;
  risks: string | null;
  invalidation_conditions: string | null;
  valuation_low: number | null;
  valuation_high: number | null;
};

function ScenarioBoard({ packetId, scenarios }: { packetId: string; scenarios: ScenarioRow[] }) {
  const qc = useQueryClient();
  const total = scenarios.reduce((sum, s) => sum + (s.probability ?? 0), 0);

  const upsert = useMutation({
    mutationFn: async ({ type, form }: { type: string; form: FormData }) => {
      const get = (k: string) => String(form.get(k) ?? "").trim();
      const num = (k: string) => (form.get(k) ? Number(form.get(k)) : null);
      const existing = scenarios.find((s) => s.scenario_type === type);
      const payload = {
        packet_id: packetId,
        scenario_type: type,
        probability: Number(form.get("probability") ?? 0),
        time_horizon: get("time_horizon"),
        assumptions: get("assumptions") || null,
        catalysts: get("catalysts") || null,
        risks: get("risks") || null,
        invalidation_conditions: get("invalidation_conditions") || null,
        valuation_low: num("valuation_low"),
        valuation_high: num("valuation_high"),
      };
      const { error } = existing
        ? await supabase.from("scenario_forecasts").update(payload).eq("id", existing.id)
        : await supabase.from("scenario_forecasts").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Scenario saved");
      qc.invalidateQueries({ queryKey: ["scenarios"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div
        className={
          total === 100
            ? "rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400"
            : "rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
        }
      >
        Probabilities total {total}%. Bull + Base + Bear must sum to 100%.
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {SCENARIO_TYPES.map((type) => {
          const s = scenarios.find((x) => x.scenario_type === type);
          return (
            <form
              key={type}
              className="space-y-2 rounded-xl border border-border bg-card p-4"
              onSubmit={(e) => {
                e.preventDefault();
                upsert.mutate({ type, form: new FormData(e.currentTarget) });
              }}
            >
              <h3 className="text-sm font-semibold">{type}</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Probability %</Label>
                  <Input
                    name="probability"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={s?.probability ?? 0}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Horizon</Label>
                  <select
                    name="time_horizon"
                    defaultValue={s?.time_horizon ?? TIME_HORIZONS[0]}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                  >
                    {TIME_HORIZONS.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Valuation low</Label>
                  <Input
                    name="valuation_low"
                    type="number"
                    step="any"
                    defaultValue={s?.valuation_low ?? ""}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Valuation high</Label>
                  <Input
                    name="valuation_high"
                    type="number"
                    step="any"
                    defaultValue={s?.valuation_high ?? ""}
                    className="h-8"
                  />
                </div>
              </div>
              <Textarea
                name="assumptions"
                rows={2}
                placeholder="Assumptions"
                defaultValue={s?.assumptions ?? ""}
              />
              <Textarea
                name="catalysts"
                rows={2}
                placeholder="Catalysts"
                defaultValue={s?.catalysts ?? ""}
              />
              <Textarea name="risks" rows={2} placeholder="Risks" defaultValue={s?.risks ?? ""} />
              <Textarea
                name="invalidation_conditions"
                rows={2}
                placeholder="What invalidates this scenario"
                defaultValue={s?.invalidation_conditions ?? ""}
              />
              <Button type="submit" size="sm" className="w-full">
                Save {type}
              </Button>
            </form>
          );
        })}
      </div>
    </div>
  );
}

function ScoreCard({
  scoreType,
  storyId,
  companyId,
  existing,
}: {
  scoreType: ScoreTypeKey;
  storyId: string;
  companyId: string;
  existing: { id: string; components: unknown; reasoning: string | null } | null;
}) {
  const qc = useQueryClient();
  const components = componentsFor(scoreType);
  const initial = (existing?.components ?? {}) as Record<string, number>;
  const [values, setValues] = useState<Record<string, number>>(initial);
  const [reasoning, setReasoning] = useState(existing?.reasoning ?? "");

  useEffect(() => {
    setValues((existing?.components ?? {}) as Record<string, number>);
    setReasoning(existing?.reasoning ?? "");
  }, [existing]);

  const total = components.reduce((sum, c) => sum + (Number(values[c.key]) || 0), 0);
  const max = components.reduce((sum, c) => sum + c.max, 0);
  const classification = classifyScore(scoreType, total);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        score_type: SCORE_TYPES[scoreType],
        story_id: storyId,
        company_id: companyId,
        components: values,
        total,
        classification,
        reasoning: reasoning || null,
      };
      const { error } = existing
        ? await supabase.from("scores").update(payload).eq("id", existing.id)
        : await supabase.from("scores").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Score saved");
      qc.invalidateQueries({ queryKey: ["scores"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["stories"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <SectionTitle
        title={SCORE_TYPES[scoreType]}
        description="Scores rank research and content effort. They are not buy or sell recommendations."
      />
      <div className="space-y-2">
        {components.map((c) => (
          <div key={c.key} className="flex items-center gap-3">
            <Label className="flex-1 text-xs">{c.label}</Label>
            <Input
              type="number"
              min={0}
              max={c.max}
              value={values[c.key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [c.key]: Math.min(c.max, Number(e.target.value) || 0) }))
              }
              className="h-8 w-20"
            />
            <span className="w-10 text-right text-xs text-muted-foreground">/ {c.max}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
        <span className="text-sm">
          Total <span className="font-semibold tabular-nums">{total}</span> / {max}
        </span>
        <StatusBadge value={classification} />
      </div>

      <Textarea
        className="mt-3"
        rows={2}
        value={reasoning}
        onChange={(e) => setReasoning(e.target.value)}
        placeholder="Reasoning for this score"
      />
      <Button className="mt-2" size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save score"}
      </Button>
    </section>
  );
}
