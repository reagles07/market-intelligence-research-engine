import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Layers, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/common/ui-bits";
import { ElapsedIndicator } from "@/components/common/elapsed";
import { fmtDateTime } from "@/lib/finance";
import { cn } from "@/lib/utils";
import { TARGET_DURATIONS } from "@/lib/content/domain";
import {
  COMBINED_SHORT_MAX_COMPANIES,
  COMPOSER_MAX_COMPANIES,
  COMPOSER_MAX_SHORTS_PER_STOCK,
  COMPOSER_MODES,
  LONGFORM_MODES,
  autoAllocateShorts,
  defaultAllocation,
  evaluateEligibility,
  planComposition,
  type ComposerCandidate,
  type ComposerMode,
  type LongformMode,
  type ShortAllocation,
} from "@/lib/content/composer";
import { listComposerStocks, runComposerGeneration } from "@/lib/composer.functions";

export const Route = createFileRoute("/_authenticated/scripts/composer")({
  validateSearch: (s: Record<string, unknown>) => ({
    company: typeof s["company"] === "string" ? (s["company"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Content Composer — Stock Research Studio" },
      {
        name: "description",
        content:
          "Compose one combined long-form video and configurable Shorts from several researched stocks, using each company's own verified evidence.",
      },
      { property: "og:title", content: "Content Composer" },
      {
        property: "og:description",
        content: "Multi-stock scripts built only from content-ready research.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ComposerPage,
});

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <section className="rounded-xl border border-border bg-card p-4">
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px]">
        {n}
      </span>
      {title}
    </h2>
    {children}
  </section>
);

function ComposerPage() {
  const search = useSearch({ from: "/_authenticated/scripts/composer" });
  const [mode, setMode] = useState<ComposerMode>("MULTI_STOCK");
  const [selected, setSelected] = useState<string[]>(search.company ? [search.company] : []);
  const [q, setQ] = useState("");
  const [longEnabled, setLongEnabled] = useState(true);
  const [longformMode, setLongformMode] = useState<LongformMode>("roundup");
  const [shortsEnabled, setShortsEnabled] = useState(true);
  const [allocation, setAllocation] = useState<ShortAllocation>({});
  const [autoAllocate, setAutoAllocate] = useState(false);
  const [autoTotal, setAutoTotal] = useState(6);
  const [combinedShorts, setCombinedShorts] = useState(0);
  const [combinedIds, setCombinedIds] = useState<string[]>([]);
  const [allowRanking, setAllowRanking] = useState(false);
  const [theme, setTheme] = useState("");
  const [instruction, setInstruction] = useState("");
  const [duration, setDuration] = useState<string>("deep_dive");
  const [customMinutes, setCustomMinutes] = useState<string>("");
  const [continueReadyOnly, setContinueReadyOnly] = useState(false);

  const { data: stocks } = useQuery({
    queryKey: ["composer-stocks"],
    queryFn: () => listComposerStocks(),
  });

  const candidates = useMemo(() => (stocks ?? []) as ComposerCandidate[], [stocks]);
  const selectedCandidates = useMemo(
    () =>
      selected
        .map((id) => candidates.find((c) => c.companyId === id))
        .filter(Boolean) as ComposerCandidate[],
    [selected, candidates],
  );
  const ready = selectedCandidates.filter((c) => evaluateEligibility(c).eligible);
  const blocked = selectedCandidates.filter((c) => !evaluateEligibility(c).eligible);

  const effectiveAllocation = autoAllocate ? autoAllocateShorts(ready, autoTotal) : allocation;

  const plan = planComposition(ready, {
    mode,
    longEnabled,
    longformMode,
    shortsEnabled,
    allocation: effectiveAllocation,
    combinedShorts,
    combinedShortCompanyIds: combinedIds,
  });

  const generate = useMutation({
    mutationFn: () =>
      runComposerGeneration({
        data: {
          companyIds: selected,
          mode,
          longEnabled,
          longformMode,
          shortsEnabled,
          allocation: effectiveAllocation,
          autoAllocate,
          autoAllocateTotal: autoTotal,
          combinedShorts,
          combinedShortCompanyIds: combinedIds,
          allowRanking,
          theme: theme.trim() || null,
          title: null,
          creatorInstruction: instruction.trim() || null,
          targetDuration: customMinutes ? null : duration,
          customMinutes: customMinutes ? Number(customMinutes) : null,
          platform: null,
          language: null,
          tone: null,
          model: null,
          styleProfileId: null,
          continueWithReadyOnly: continueReadyOnly,
        },
      }),
    onSuccess: (res) => {
      if (res.ok)
        toast.success(`Generated ${res.generated} script(s). All land as Needs Fact Check.`);
      else toast.error(res.error ?? "Nothing could be generated.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = (c: ComposerCandidate) => {
    setSelected((prev) => {
      const next = prev.includes(c.companyId)
        ? prev.filter((id) => id !== c.companyId)
        : prev.length >= COMPOSER_MAX_COMPANIES
          ? prev
          : [...prev, c.companyId];
      const nextReady = next
        .map((id) => candidates.find((x) => x.companyId === id))
        .filter((x): x is ComposerCandidate => Boolean(x) && evaluateEligibility(x!).eligible);
      setAllocation((a) => ({ ...defaultAllocation(mode, nextReady), ...a }));
      return next;
    });
  };

  const filtered = candidates.filter((c) => {
    if (!q.trim()) return true;
    const t = q.toLowerCase();
    return c.ticker.toLowerCase().includes(t) || c.name.toLowerCase().includes(t);
  });

  const result = generate.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Layers className="h-5 w-5" /> Content Composer
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Pick researched stocks and compose one combined video and Shorts. Research stays
            stock-by-stock — each company only ever speaks from its own verified evidence.
          </p>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link to="/scripts">Back to Scripts</Link>
        </Button>
      </div>

      <Step n={1} title="Select stocks">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by ticker or company"
          className="mb-3 h-9 w-64"
        />
        {filtered.length === 0 ? (
          <EmptyState
            title="No researched companies yet"
            description="Research a stock first — the Composer only uses research already on file."
            action={
              <Button asChild size="sm">
                <Link to="/research">Go to Research</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.slice(0, 60).map((c) => {
              const e = evaluateEligibility(c);
              const on = selected.includes(c.companyId);
              return (
                <button
                  key={c.companyId}
                  type="button"
                  onClick={() => toggle(c)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition",
                    on ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{c.ticker}</span>
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[10px] font-semibold",
                        e.eligible
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-amber-300 bg-amber-50 text-amber-800",
                      )}
                    >
                      {e.badge}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{c.name}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {c.market} · packet v{c.packetVersion ?? "?"} ·{" "}
                    {c.packetDate ? fmtDateTime(c.packetDate) : "—"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Completeness {Math.round(c.completionPct ?? 0)}% · Verification{" "}
                    {Math.round(c.verificationScore ?? 0)}%
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </Step>

      <Step n={2} title="Choose format">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {COMPOSER_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={cn(
                "rounded-lg border p-3 text-left text-xs transition",
                mode === m.key ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
              )}
            >
              <span className="block text-sm font-medium">{m.label}</span>
              <span className="mt-1 block text-muted-foreground">{m.hint}</span>
            </button>
          ))}
        </div>
      </Step>

      <Step n={3} title="Configure long-form and Shorts">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch checked={longEnabled} onCheckedChange={setLongEnabled} /> Long-form video
            </label>
            {longEnabled ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex flex-wrap gap-2">
                  {LONGFORM_MODES.map((m) => (
                    <Button
                      key={m.key}
                      size="sm"
                      variant={longformMode === m.key ? "default" : "outline"}
                      onClick={() => setLongformMode(m.key)}
                    >
                      {m.label}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {TARGET_DURATIONS.map((d) => (
                    <Button
                      key={d.key}
                      size="sm"
                      variant={!customMinutes && duration === d.key ? "default" : "outline"}
                      onClick={() => {
                        setCustomMinutes("");
                        setDuration(d.key);
                      }}
                    >
                      {d.label}
                    </Button>
                  ))}
                  <Input
                    value={customMinutes}
                    onChange={(e) =>
                      setCustomMinutes(e.target.value.replace(/\D/g, "").slice(0, 2))
                    }
                    placeholder="Custom min"
                    className="h-8 w-28"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={allowRanking} onCheckedChange={setAllowRanking} /> Rank the
                  stocks (off by default)
                </label>
                <Input
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  placeholder="Optional theme or title, e.g. How each company survived a crisis"
                  className="h-9"
                />
                <Textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Optional instruction, e.g. Make one 18-minute video covering these four stocks, spend more time on Bajaj Finance, don't rank them."
                  className="min-h-20 text-sm"
                />
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Switch checked={shortsEnabled} onCheckedChange={setShortsEnabled} /> Shorts
            </label>
            {shortsEnabled ? (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={autoAllocate} onCheckedChange={setAutoAllocate} /> Auto allocate
                  strongest stories
                </label>
                {autoAllocate ? (
                  <div className="flex items-center gap-2 text-xs">
                    Total Shorts
                    <Input
                      value={String(autoTotal)}
                      onChange={(e) => setAutoTotal(Number(e.target.value.replace(/\D/g, "") || 0))}
                      className="h-8 w-20"
                    />
                  </div>
                ) : null}
                {ready.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Select at least one content-ready stock to allocate Shorts.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {ready.map((c) => (
                      <div
                        key={c.companyId}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span className="font-mono font-semibold">{c.ticker}</span>
                        <Input
                          disabled={autoAllocate}
                          value={String(effectiveAllocation[c.companyId] ?? 0)}
                          onChange={(e) =>
                            setAllocation((a) => ({
                              ...a,
                              [c.companyId]: Math.min(
                                COMPOSER_MAX_SHORTS_PER_STOCK,
                                Number(e.target.value.replace(/\D/g, "") || 0),
                              ),
                            }))
                          }
                          className="h-8 w-16"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t border-border pt-3">
                  <div className="flex items-center gap-2 text-xs">
                    Combined multi-stock Shorts
                    <Input
                      value={String(combinedShorts)}
                      onChange={(e) =>
                        setCombinedShorts(
                          Math.min(3, Number(e.target.value.replace(/\D/g, "") || 0)),
                        )
                      }
                      className="h-8 w-16"
                    />
                  </div>
                  {combinedShorts > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {ready.map((c) => (
                        <Button
                          key={c.companyId}
                          size="sm"
                          variant={combinedIds.includes(c.companyId) ? "default" : "outline"}
                          onClick={() =>
                            setCombinedIds((prev) =>
                              prev.includes(c.companyId)
                                ? prev.filter((x) => x !== c.companyId)
                                : [...prev, c.companyId],
                            )
                          }
                        >
                          {c.ticker}
                        </Button>
                      ))}
                      <p className="mt-1 w-full text-[11px] text-muted-foreground">
                        Up to {COMBINED_SHORT_MAX_COMPANIES} companies per 60-second Short.
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Step>

      <Step n={4} title="Review readiness">
        {selectedCandidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stocks selected yet.</p>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {ready.length} content-ready: {ready.map((c) => c.ticker).join(", ") || "none"}
            </p>
            {blocked.length ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="flex items-center gap-2 font-medium text-amber-900">
                  <AlertTriangle className="h-4 w-4" /> Not usable yet
                </p>
                <ul className="mt-1 space-y-1 text-xs text-amber-900">
                  {blocked.map((c) => (
                    <li key={c.companyId} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold">{c.ticker}</span>
                      <span>{evaluateEligibility(c).reason}</span>
                      {c.storyId ? (
                        <Link className="underline" to="/stories/$id" params={{ id: c.storyId }}>
                          Open research
                        </Link>
                      ) : (
                        <Link className="underline" to="/research">
                          Research this stock
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
                <label className="mt-2 flex items-center gap-2 text-xs text-amber-900">
                  <Switch checked={continueReadyOnly} onCheckedChange={setContinueReadyOnly} />
                  Continue with ready stocks only
                </label>
              </div>
            ) : null}
            {plan.warnings.map((w) => (
              <p key={w} className="text-xs text-amber-700">
                {w}
              </p>
            ))}
            {plan.errors.map((e) => (
              <p key={e} className="text-xs text-rose-700">
                {e}
              </p>
            ))}
          </div>
        )}
      </Step>

      <Step n={5} title="Generate content pack">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            Will generate: <span className="font-semibold">{plan.summary}</span>
          </p>
          <Button
            size="sm"
            disabled={!plan.ok || generate.isPending || (blocked.length > 0 && !continueReadyOnly)}
            onClick={() => generate.mutate()}
          >
            <Sparkles className="mr-1 h-4 w-4" />
            Generate {plan.totalScripts} script{plan.totalScripts === 1 ? "" : "s"}
          </Button>
          <ElapsedIndicator
            active={generate.isPending}
            step="Writing scripts from verified evidence"
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Every generated script lands as Needs Fact Check and still requires the audit and your
          review before anything is published.
        </p>

        {result ? (
          <div className="mt-3 space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <p className="font-medium">
              {result.ok
                ? `${result.generated ?? 0} script(s) generated.`
                : (result.error ?? "Blocked.")}
            </p>
            {"long" in result && result.long ? (
              <p>
                Long-form:{" "}
                {result.long["ok"] ? "created" : String(result.long["error"] ?? "blocked")}
              </p>
            ) : null}
            {"shorts" in result && Array.isArray(result.shorts)
              ? result.shorts.map((s, i) => (
                  <p key={i}>
                    Short {i + 1} · {String(s["ticker"] ?? "")} —{" "}
                    {s["ok"] ? "created" : String(s["error"] ?? "blocked")}
                  </p>
                ))
              : null}
            {"combined" in result && Array.isArray(result.combined)
              ? result.combined.map((s, i) => (
                  <p key={`c${i}`}>
                    Combined Short {i + 1} — {s["ok"] ? "created" : String(s["error"] ?? "blocked")}
                  </p>
                ))
              : null}
            <Button asChild size="sm" variant="ghost" className="mt-1">
              <Link to="/scripts">Review the scripts</Link>
            </Button>
          </div>
        ) : null}
      </Step>
    </div>
  );
}
