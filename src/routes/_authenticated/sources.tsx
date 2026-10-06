import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Plus } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { ClaimEvidenceLineage } from "@/components/research/ClaimEvidenceLineage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryBadge, EmptyState, KpiCard, StatusBadge } from "@/components/common/ui-bits";
import {
  CLAIM_CATEGORIES,
  FACT_SAFETY_RULES,
  SOURCE_TIERS,
  SOURCE_TYPES,
  VERIFICATION_STATUSES,
  type ClaimCategory,
} from "@/lib/domain";
import { fmtDateTime } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/sources")({
  head: () => ({
    meta: [
      { title: "Source Verification Center — Stock Research Studio" },
      {
        name: "description",
        content:
          "Track sources by tier, log every factual claim, and resolve conflicting or unsupported claims before scripting.",
      },
      { property: "og:title", content: "Source Verification Center" },
      {
        property: "og:description",
        content: "Tiered sources and claim-level verification for equity research.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SourcesPage,
});

function SourcesPage() {
  const qc = useQueryClient();
  const [openSource, setOpenSource] = useState(false);
  const [openClaim, setOpenClaim] = useState(false);
  const [claimCategory, setClaimCategory] = useState<ClaimCategory>(CLAIM_CATEGORIES[0]);

  const { data: companies } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id,name,ticker,exchange,country,currency")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: sources, isLoading } = useQuery({
    queryKey: ["sources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*, companies(ticker,name)")
        .order("retrieved_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: claims } = useQuery({
    queryKey: ["claims"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claims")
        .select("*, sources(title,source_tier,url), companies(ticker)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const stats = useMemo(() => {
    const c = claims ?? [];
    return {
      total: c.length,
      verified: c.filter((x) => x.verification_status === "Verified").length,
      single: c.filter((x) => x.verification_status === "Single Source").length,
      conflicting: c.filter((x) => x.verification_status === "Conflicting").length,
      unsupported: c.filter((x) => x.verification_status === "Unsupported").length,
    };
  }, [claims]);

  const addSource = useMutation({
    mutationFn: async (form: FormData) => {
      const get = (k: string) => String(form.get(k) ?? "").trim();
      const { error } = await supabase.from("sources").insert({
        title: get("title"),
        url: get("url") || null,
        publisher: get("publisher") || null,
        source_type: get("source_type"),
        source_tier: get("source_tier"),
        company_id: get("company_id") || null,
        published_at: get("published_at") ? new Date(get("published_at")).toISOString() : null,
        notes: get("notes") || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Source added");
      setOpenSource(false);
      qc.invalidateQueries({ queryKey: ["sources"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addClaim = useMutation({
    mutationFn: async (form: FormData) => {
      const get = (k: string) => String(form.get(k) ?? "").trim();
      const { error } = await supabase.from("claims").insert({
        claim_text: get("claim_text"),
        claim_category: get("claim_category"),
        value: get("value") || null,
        unit: get("unit") || null,
        reporting_period: get("reporting_period") || null,
        source_id: get("source_id") || null,
        company_id: get("company_id") || null,
        verification_status: get("verification_status"),
        confidence: form.get("confidence") ? Number(form.get("confidence")) : null,
        is_critical: form.get("is_critical") === "on",
        notes: get("notes") || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Claim logged");
      setOpenClaim(false);
      qc.invalidateQueries({ queryKey: ["claims"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["notifications-count"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("claims")
        .update({ verification_status: status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["claims"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["notifications-count"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Source Verification Center</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every factual claim must trace to a source. Conflicting or unsupported claims block script
          approval.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Claims" value={stats.total} />
        <KpiCard label="Verified" value={stats.verified} tone="good" />
        <KpiCard label="Single source" value={stats.single} tone="warn" />
        <KpiCard label="Conflicting" value={stats.conflicting} tone="bad" />
        <KpiCard label="Unsupported" value={stats.unsupported} tone="bad" />
      </div>

      <Tabs defaultValue="claims">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="claims">Claims</TabsTrigger>
            <TabsTrigger value="sources">Sources</TabsTrigger>
          </TabsList>

          <div className="flex gap-2">
            <Dialog open={openSource} onOpenChange={setOpenSource}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus className="mr-1.5 h-4 w-4" />
                  Source
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Add source</DialogTitle>
                </DialogHeader>
                <form
                  id="source-form"
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addSource.mutate(new FormData(e.currentTarget));
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="title">Title</Label>
                    <Input id="title" name="title" required />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="url">URL</Label>
                      <Input id="url" name="url" type="url" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="publisher">Publisher</Label>
                      <Input id="publisher" name="publisher" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Source type</Label>
                      <select
                        name="source_type"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {SOURCE_TYPES.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Source tier</Label>
                      <select
                        name="source_tier"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {SOURCE_TIERS.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Company</Label>
                      <select
                        name="company_id"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">—</option>
                        {(companies ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.ticker}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="published_at">Published at</Label>
                      <Input id="published_at" name="published_at" type="datetime-local" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea id="notes" name="notes" rows={2} />
                  </div>
                </form>
                <DialogFooter>
                  <Button type="submit" form="source-form" disabled={addSource.isPending}>
                    Add source
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={openClaim} onOpenChange={setOpenClaim}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1.5 h-4 w-4" />
                  Claim
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Log claim</DialogTitle>
                </DialogHeader>
                <form
                  id="claim-form"
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addClaim.mutate(new FormData(e.currentTarget));
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="claim_text">Claim</Label>
                    <Textarea id="claim_text" name="claim_text" rows={2} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Category</Label>
                    <select
                      name="claim_category"
                      value={claimCategory}
                      onChange={(e) => setClaimCategory(e.target.value as ClaimCategory)}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {CLAIM_CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <p className="rounded-md bg-muted/60 p-2 text-[11px] text-muted-foreground">
                      Fact-safety rule: {FACT_SAFETY_RULES[claimCategory]}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="value">Value</Label>
                      <Input id="value" name="value" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="unit">Unit</Label>
                      <Input id="unit" name="unit" placeholder="USD mn / %" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reporting_period">Reporting period</Label>
                      <Input id="reporting_period" name="reporting_period" placeholder="Q2 FY25" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="confidence">Confidence (0–100)</Label>
                      <Input id="confidence" name="confidence" type="number" min={0} max={100} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Source</Label>
                      <select
                        name="source_id"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">—</option>
                        {(sources ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.source_tier} · {s.title.slice(0, 40)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Company</Label>
                      <select
                        name="company_id"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        <option value="">—</option>
                        {(companies ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.ticker}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Verification status</Label>
                      <select
                        name="verification_status"
                        defaultValue="Unverified"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {VERIFICATION_STATUSES.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-end gap-2 pb-2 text-sm">
                      <input type="checkbox" name="is_critical" className="h-4 w-4" />
                      Critical claim
                    </label>
                  </div>
                </form>
                <DialogFooter>
                  <Button type="submit" form="claim-form" disabled={addClaim.isPending}>
                    Log claim
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <TabsContent value="claims" className="mt-4">
          {(claims ?? []).length === 0 ? (
            <EmptyState
              title="No claims logged"
              description="Log the factual claims behind your research so each one can be verified."
            />
          ) : (
            <div className="space-y-2">
              {(claims ?? []).map((c) => (
                <div key={c.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <CategoryBadge value={c.claim_category} />
                        {c.companies?.ticker ? (
                          <span className="font-mono text-xs">{c.companies.ticker}</span>
                        ) : null}
                        {c.is_critical ? (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                            CRITICAL
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-sm">{c.claim_text}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {c.value ? `${c.value} ${c.unit ?? ""} · ` : ""}
                        {c.reporting_period ? `${c.reporting_period} · ` : ""}
                        {c.sources?.title
                          ? `${c.sources.source_tier} — ${c.sources.title}`
                          : c.evidence_type && c.evidence_type !== "NONE"
                            ? `${c.evidence_type === "CALCULATION" ? "Calculation" : "Structured metric"} evidence`
                            : "No source attached"}
                      </p>
                      <ClaimEvidenceLineage claim={c as never} />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge value={c.verification_status} />
                      <select
                        value={c.verification_status}
                        onChange={(e) => setStatus.mutate({ id: c.id, status: e.target.value })}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        aria-label="Update verification status"
                      >
                        {VERIFICATION_STATUSES.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sources" className="mt-4">
          {isLoading ? (
            <Skeleton className="h-48 rounded-xl" />
          ) : (sources ?? []).length === 0 ? (
            <EmptyState
              title="No sources"
              description="Add filings, transcripts and news sources."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Tier</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Publisher</th>
                    <th className="px-3 py-2 font-medium">Published</th>
                    <th className="px-3 py-2 font-medium">Retrieved</th>
                  </tr>
                </thead>
                <tbody>
                  {(sources ?? []).map((s) => (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <span className="font-medium">{s.title}</span>
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1.5 inline-flex text-muted-foreground hover:text-foreground"
                            aria-label="Open source"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                        {s.companies?.ticker ? (
                          <p className="text-[11px] text-muted-foreground">{s.companies.ticker}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge value={s.source_tier} />
                      </td>
                      <td className="px-3 py-2 text-xs">{s.source_type}</td>
                      <td className="px-3 py-2 text-xs">{s.publisher ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{fmtDateTime(s.published_at)}</td>
                      <td className="px-3 py-2 text-xs">{fmtDateTime(s.retrieved_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
