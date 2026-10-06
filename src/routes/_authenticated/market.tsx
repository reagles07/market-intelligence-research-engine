import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/common/ui-bits";
import { listUniverse, refreshDynamic50 } from "@/lib/universe.functions";
import type { UniverseMarket, UniverseTier } from "@/lib/universe/domain";
import { DISCOVERY_TRENDING_NOTE } from "@/lib/creator/domain";

export const Route = createFileRoute("/_authenticated/market")({
  head: () => ({
    meta: [
      { title: "Market Intelligence — Stock Research Studio" },
      {
        name: "description",
        content:
          "Core 50 and Discovery Trending 50 coverage universes for the US and Indian markets, ranked by discovery activity.",
      },
      { property: "og:title", content: "Market Intelligence" },
      {
        property: "og:description",
        content: "Core 50 and Discovery Trending 50 coverage universes for US and India.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketIntelligencePage,
});

function UniverseTable({ market, tier }: { market: UniverseMarket; tier: UniverseTier }) {
  const load = useServerFn(listUniverse);
  const { data, isLoading } = useQuery({
    queryKey: ["universe", market, tier],
    queryFn: () => load({ data: { market, tier } }),
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        title={tier === "CORE_50" ? "No core list yet" : "No dynamic list yet"}
        description={
          tier === "CORE_50"
            ? "The curated core universe is empty for this market."
            : "Refresh the Discovery Trending 50 to rank companies by recent discovery activity."
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">#</th>
            <th className="px-3 py-2 text-left font-medium">Ticker</th>
            <th className="px-3 py-2 text-left font-medium">Company</th>
            <th className="px-3 py-2 text-left font-medium">Sector</th>
            {tier === "DYNAMIC_50" ? (
              <>
                <th className="px-3 py-2 text-left font-medium">Score</th>
                <th className="px-3 py-2 text-left font-medium">Why it is here</th>
                <th className="px-3 py-2 text-left font-medium">Updated</th>
              </>
            ) : null}
            <th className="px-3 py-2 text-right font-medium">Research</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <td className="px-3 py-2 text-muted-foreground">{row.rank ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-xs">{row.ticker}</td>
              <td className="px-3 py-2">{row.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{row.sector ?? "—"}</td>
              {tier === "DYNAMIC_50" ? (
                <>
                  <td className="px-3 py-2">
                    <Badge variant="secondary">{row.score ?? 0}</Badge>
                  </td>
                  <td className="px-3 py-2 max-w-[22rem] truncate text-muted-foreground">
                    {row.reason ?? "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                    {row.updated_at ? new Date(row.updated_at).toLocaleDateString() : "—"}
                  </td>
                </>
              ) : null}
              <td className="px-3 py-2 text-right">
                {row.company_id ? (
                  <Link
                    to="/stocks/$id"
                    params={{ id: row.company_id }}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Open
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">Not tracked</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarketIntelligencePage() {
  const qc = useQueryClient();
  const [market, setMarket] = useState<UniverseMarket>("US");
  const refresh = useServerFn(refreshDynamic50);

  const refreshMutation = useMutation({
    mutationFn: () => refresh({ data: { market } }),
    onSuccess: (res) => {
      toast.success(
        `Discovery Trending 50 refreshed — ${res.selected} companies from ${res.considered} candidates (${res.lookbackDays}d).`,
      );
      qc.invalidateQueries({ queryKey: ["universe"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Market Intelligence</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Coverage universes for the US and India. Core 50 is curated and stable; Discovery
            Trending 50 rotates with recent discovery activity.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${refreshMutation.isPending ? "animate-spin" : ""}`}
            />
            Refresh Trending 50 ({market})
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Universe</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={market} onValueChange={(v) => setMarket(v as UniverseMarket)}>
            <TabsList>
              <TabsTrigger value="US">United States</TabsTrigger>
              <TabsTrigger value="India">India</TabsTrigger>
            </TabsList>
            {(["US", "India"] as const).map((m) => (
              <TabsContent key={m} value={m} className="space-y-6 pt-4">
                <section className="space-y-2">
                  <h2 className="text-sm font-medium">Core 50</h2>
                  <UniverseTable market={m} tier="CORE_50" />
                </section>
                <section className="space-y-2">
                  <div>
                    <h2 className="text-sm font-medium">Discovery Trending 50</h2>
                    <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
                      {DISCOVERY_TRENDING_NOTE}
                    </p>
                  </div>
                  <UniverseTable market={m} tier="DYNAMIC_50" />
                </section>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
