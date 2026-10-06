import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useMarket } from "@/lib/market-context-value";
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
import { Skeleton } from "@/components/ui/skeleton";
import { DemoBadge, EmptyState } from "@/components/common/ui-bits";
import { fmtMarketCap } from "@/lib/finance";
import { MARKETS } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/stocks/")({
  head: () => ({
    meta: [
      { title: "Stock Universe — Stock Research Studio" },
      {
        name: "description",
        content:
          "Browse the tracked universe of US and Indian companies with sector, exchange and market-cap detail.",
      },
      { property: "og:title", content: "Stock Universe" },
      {
        property: "og:description",
        content: "Tracked US and Indian companies with sector and market-cap detail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StocksPage,
});

function StocksPage() {
  const { market } = useMarket();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [showTest, setShowTest] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const rows = useMemo(
    () =>
      (data ?? []).filter((c) => {
        if (!showTest && (c.is_demo || c.ticker.toUpperCase().startsWith("ZZ"))) return false;
        if (market !== "All" && c.country !== market) return false;
        if (!q.trim()) return true;
        const t = q.trim().toLowerCase();
        return c.name.toLowerCase().includes(t) || c.ticker.toLowerCase().includes(t);
      }),
    [data, market, q, showTest],
  );

  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const get = (k: string) => String(form.get(k) ?? "").trim();
      const { error } = await supabase.from("companies").insert({
        name: get("name"),
        ticker: get("ticker").toUpperCase(),
        exchange: get("exchange"),
        country: get("country"),
        currency: get("country") === "India" ? "INR" : "USD",
        sector: get("sector") || null,
        industry: get("industry") || null,
        website: get("website") || null,
        ir_url: get("ir_url") || null,
        description: get("description") || null,
        market_cap: form.get("market_cap") ? Number(form.get("market_cap")) : null,
        peers: get("peers")
          ? get("peers")
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean)
          : [],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Company added");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["companies"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Stock Universe</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} compan{rows.length === 1 ? "y" : "ies"} · market {market}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowTest((v) => !v)}>
            {showTest ? "Hide test" : "Show test"}
          </Button>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name or ticker"
            className="h-9 w-56"
          />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 h-4 w-4" />
                Add company
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Add company</DialogTitle>
              </DialogHeader>
              <form
                id="company-form"
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate(new FormData(e.currentTarget));
                }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <Field name="name" label="Company name" required />
                  <Field name="ticker" label="Ticker" required />
                  <Field name="exchange" label="Exchange" placeholder="NASDAQ / NSE" required />
                  <div className="space-y-1.5">
                    <Label>Country</Label>
                    <select
                      name="country"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {MARKETS.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <Field name="sector" label="Sector" />
                  <Field name="industry" label="Industry" />
                  <Field name="market_cap" label="Market cap" type="number" />
                  <Field name="website" label="Website" />
                  <Field name="ir_url" label="Investor relations URL" />
                  <Field name="peers" label="Peers (comma separated)" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Business description</Label>
                  <Textarea id="description" name="description" rows={3} />
                </div>
              </form>
              <DialogFooter>
                <Button type="submit" form="company-form" disabled={create.isPending}>
                  {create.isPending ? "Saving…" : "Add company"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyState title="No companies" description="Add a company to start tracking it." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => (
            <Link
              key={c.id}
              to="/stocks/$id"
              params={{ id: c.id }}
              className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{c.ticker}</span>
                    {c.is_demo ? <DemoBadge /> : null}
                  </div>
                  <p className="truncate text-sm">{c.name}</p>
                </div>
                <span className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-[11px]">
                  {c.country}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {c.exchange} · {c.sector ?? "—"} · {c.industry ?? "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Market cap: {fmtMarketCap(c.market_cap, c.currency)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  required,
  placeholder,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} required={required} placeholder={placeholder} />
    </div>
  );
}
