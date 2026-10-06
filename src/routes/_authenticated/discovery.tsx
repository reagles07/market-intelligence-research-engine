import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, SectionTitle } from "@/components/common/ui-bits";
import {
  COMPANY_ENDPOINTS,
  DISCOVERY_ENDPOINTS,
  HISTORICAL_FILTERS,
  HISTORICAL_PERIODS,
} from "@/lib/indianapi/constants";
import { fetchCompanyEndpoint, runDiscovery } from "@/lib/indianapi.functions";
import { fmtNum } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/discovery")({
  head: () => ({
    meta: [
      { title: "Provider Discovery — Stock Research Studio" },
      {
        name: "description",
        content:
          "Pull trending, most-active, price-shocker and 52-week data from IndianAPI on demand and turn results into research stories.",
      },
      { property: "og:title", content: "Provider Discovery" },
      {
        property: "og:description",
        content: "On-demand IndianAPI discovery feeds and per-company endpoints.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DiscoveryPage,
});

type Row = {
  companyName: string | null;
  ticker: string | null;
  price: number | null;
  movement: number | null;
  volume: number | null;
  category: string | null;
  providerTimestamp: string | null;
};

function DiscoveryPage() {
  const navigate = useNavigate();
  const discover = useServerFn(runDiscovery);
  const companyEndpoint = useServerFn(fetchCompanyEndpoint);
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [payload, setPayload] = useState<string | null>(null);

  const [stockName, setStockName] = useState("Tata Steel");
  const [period, setPeriod] = useState<(typeof HISTORICAL_PERIODS)[number]>("1yr");
  const [filter, setFilter] = useState<(typeof HISTORICAL_FILTERS)[number]>("default");
  const [stats, setStats] = useState("");

  const pull = useMutation({
    mutationFn: async (endpoint: (typeof DISCOVERY_ENDPOINTS)[number]) => {
      setActive(endpoint);
      return discover({ data: { endpoint } });
    },
    onSuccess: (res) => {
      if (!res.ok) {
        setRows([]);
        toast.error(res.error ?? "Provider request failed");
        return;
      }
      setRows(res.rows as Row[]);
      toast.success(`${res.rows.length} rows · ${res.quota.used}/500 used`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const companyCall = useMutation({
    mutationFn: async (endpoint: string) =>
      companyEndpoint({
        data: {
          endpoint,
          stockName,
          period,
          filter,
          ...(stats.trim() ? { stats: stats.trim() } : {}),
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setPayload(null);
        toast.error(res.error ?? "Provider request failed");
        return;
      }
      setPayload(res.payloadJson);
      toast.success(`Stored as RAW_PROVIDER_DATA · ${res.quota.used}/500 used`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createStory = useMutation({
    mutationFn: async (row: Row) => {
      const name = row.companyName ?? row.ticker ?? "Unknown";
      const { data: company } = await supabase
        .from("companies")
        .select("id")
        .ilike("name", name)
        .maybeSingle();

      let companyId = company?.id ?? null;
      if (!companyId) {
        const { data: created, error } = await supabase
          .from("companies")
          .insert({
            name,
            ticker: row.ticker ?? name.slice(0, 12).toUpperCase(),
            exchange: "NSE",
            country: "India",
            currency: "INR",
            data_mode: "LIVE_PROVIDER",
          })
          .select("id")
          .single();
        if (error) throw error;
        companyId = created.id;
      }

      const { data: story, error: storyError } = await supabase
        .from("stories")
        .insert({
          company_id: companyId,
          title: `${name} — ${row.category ?? "Provider discovery"}`,
          story_type: "Custom",
          priority: "Medium",
          status: "New",
          price: row.price,
          daily_change_pct: row.movement,
          primary_catalyst: row.category,
          is_demo: false,
        })
        .select("id")
        .single();
      if (storyError) throw storyError;
      return story.id;
    },
    onSuccess: (id) => {
      toast.success("Story created");
      navigate({ to: "/stories/$id", params: { id } }).catch((error: unknown) =>
        reportAsyncError(error, "navigation"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Provider Discovery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manual IndianAPI pulls. Nothing is scheduled — each button spends one request from the
          500/month plan.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle title="Discovery endpoints" />
        <div className="flex flex-wrap gap-2">
          {DISCOVERY_ENDPOINTS.map((e) => (
            <Button
              key={e}
              size="sm"
              variant={active === e ? "default" : "outline"}
              disabled={pull.isPending}
              onClick={() => pull.mutate(e)}
            >
              {e}
            </Button>
          ))}
        </div>

        <div className="mt-4">
          {rows.length === 0 ? (
            <EmptyState
              title="No preview yet"
              description="Pick an endpoint above to preview provider results."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/60 text-muted-foreground">
                  <tr>
                    {[
                      "Company",
                      "Ticker",
                      "Price",
                      "Movement",
                      "Volume",
                      "Category",
                      "Provider time",
                      "",
                    ].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.companyName}-${i}`} className="border-t border-border">
                      <td className="px-3 py-2">{r.companyName ?? "—"}</td>
                      <td className="px-3 py-2 font-mono">{r.ticker ?? "—"}</td>
                      <td className="px-3 py-2">{fmtNum(r.price)}</td>
                      <td className="px-3 py-2">{fmtNum(r.movement)}</td>
                      <td className="px-3 py-2">{fmtNum(r.volume)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.category ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.providerTimestamp ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={createStory.isPending}
                          onClick={() => createStory.mutate(r)}
                        >
                          Create story
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle
          title="Company endpoints"
          description="Provider parameter codes are passed through unchanged. Validation errors from the provider are shown as returned."
        />
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="stock_name">stock_name</Label>
            <Input
              id="stock_name"
              value={stockName}
              onChange={(e) => setStockName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>period</Label>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as typeof period)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {HISTORICAL_PERIODS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>filter</Label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {HISTORICAL_FILTERS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="stats">stats (required by /statement and /historical_stats)</Label>
            <Input
              id="stats"
              value={stats}
              onChange={(e) => setStats(e.target.value)}
              placeholder="provider value — not guessed"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {COMPANY_ENDPOINTS.map((e) => (
            <Button
              key={e}
              size="sm"
              variant="outline"
              disabled={companyCall.isPending}
              onClick={() => companyCall.mutate(e)}
            >
              {e}
            </Button>
          ))}
        </div>

        {payload ? (
          <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-[11px]">
            {payload.slice(0, 20000)}
          </pre>
        ) : null}
      </section>
    </div>
  );
}
