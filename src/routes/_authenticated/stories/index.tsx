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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Delta, DemoBadge, EmptyState, StatusBadge } from "@/components/common/ui-bits";
import { PRIORITIES, STORY_STATUSES, STORY_TYPES } from "@/lib/domain";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/stories/")({
  head: () => ({
    meta: [
      { title: "Story Queue — Stock Research Studio" },
      {
        name: "description",
        content:
          "Manual story queue for US and Indian equity research: filter by market, type, sector, priority and verification status.",
      },
      { property: "og:title", content: "Story Queue" },
      {
        property: "og:description",
        content: "Filter and rank US and Indian equity research stories.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StoryQueue,
});

const SORTS = {
  score: "Content Opportunity Score",
  latest: "Latest",
  movement: "Daily Movement",
  verification: "Verification Score",
  volume: "Volume Ratio",
} as const;

function StoryQueue() {
  const { market } = useMarket();
  const qc = useQueryClient();
  const [type, setType] = useState("All");
  const [sector, setSector] = useState("All");
  const [priority, setPriority] = useState("All");
  const [status, setStatus] = useState("All");
  const [since, setSince] = useState("");
  const [minScore, setMinScore] = useState("");
  const [sort, setSort] = useState<keyof typeof SORTS>("score");
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["stories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stories")
        .select("*, companies(id,name,ticker,exchange,country,sector,market_cap,currency)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

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

  const sectors = useMemo(
    () => Array.from(new Set((data ?? []).map((s) => s.companies?.sector).filter(Boolean))),
    [data],
  );

  const rows = useMemo(() => {
    let out = (data ?? []).filter((s) => {
      if (market !== "All" && s.companies?.country !== market) return false;
      if (type !== "All" && s.story_type !== type) return false;
      if (sector !== "All" && s.companies?.sector !== sector) return false;
      if (priority !== "All" && s.priority !== priority) return false;
      if (status !== "All" && s.status !== status) return false;
      if (since && new Date(s.created_at) < new Date(since)) return false;
      if (minScore && (s.content_opportunity_score ?? 0) < Number(minScore)) return false;
      return true;
    });
    const num = (v: number | null) => (typeof v === "number" ? v : -Infinity);
    out = [...out].sort((a, b) => {
      if (sort === "latest")
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sort === "movement")
        return Math.abs(num(b.daily_change_pct)) - Math.abs(num(a.daily_change_pct));
      if (sort === "verification") return num(b.verification_score) - num(a.verification_score);
      if (sort === "volume") return num(b.volume_ratio) - num(a.volume_ratio);
      return num(b.content_opportunity_score) - num(a.content_opportunity_score);
    });
    return out;
  }, [data, market, type, sector, priority, status, since, minScore, sort]);

  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const companyId = String(form.get("company_id") ?? "");
      if (!companyId) throw new Error("Select a company");
      const numOrNull = (k: string) => {
        const v = form.get(k);
        return v === null || v === "" ? null : Number(v);
      };
      const { data, error } = await supabase
        .from("stories")
        .insert({
          company_id: companyId,
          title: String(form.get("title") ?? ""),
          description: String(form.get("description") ?? ""),
          story_type: String(form.get("story_type") ?? "Custom"),
          priority: String(form.get("priority") ?? "Medium"),
          status: String(form.get("status") ?? "New"),
          primary_catalyst: String(form.get("primary_catalyst") ?? ""),
          event_at: form.get("event_at")
            ? new Date(String(form.get("event_at"))).toISOString()
            : null,
          price: numOrNull("price"),
          price_at: form.get("price_at")
            ? new Date(String(form.get("price_at"))).toISOString()
            : null,
          daily_change_pct: numOrNull("daily_change_pct"),
          volume_ratio: numOrNull("volume_ratio"),
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Story created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["stories"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
      qc.invalidateQueries({ queryKey: ["dashboard-stories"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Story Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} stor{rows.length === 1 ? "y" : "ies"} · market {market}
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1.5 h-4 w-4" />
              New story
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>New story</DialogTitle>
            </DialogHeader>
            <form
              id="story-form"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(new FormData(e.currentTarget));
              }}
              className="space-y-3"
            >
              <div className="space-y-1.5">
                <Label>Company</Label>
                <select
                  name="company_id"
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select a company…</option>
                  {(companies ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.ticker} — {c.name} ({c.exchange})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="title">Story title</Label>
                <Input id="title" name="title" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Story description</Label>
                <Textarea id="description" name="description" rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Story type</Label>
                  <select
                    name="story_type"
                    defaultValue="Earnings Reaction"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {STORY_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <select
                    name="priority"
                    defaultValue="Medium"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="event_at">Event timestamp</Label>
                  <Input id="event_at" name="event_at" type="datetime-local" />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <select
                    name="status"
                    defaultValue="New"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {STORY_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="price">Price</Label>
                  <Input id="price" name="price" type="number" step="any" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="price_at">Price timestamp</Label>
                  <Input id="price_at" name="price_at" type="datetime-local" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="daily_change_pct">Daily movement %</Label>
                  <Input id="daily_change_pct" name="daily_change_pct" type="number" step="any" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="volume_ratio">Volume ratio</Label>
                  <Input id="volume_ratio" name="volume_ratio" type="number" step="any" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="primary_catalyst">Primary catalyst</Label>
                <Input id="primary_catalyst" name="primary_catalyst" />
              </div>
            </form>
            <DialogFooter>
              <Button type="submit" form="story-form" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create story"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card p-3 md:grid-cols-4 xl:grid-cols-7">
        <FilterSelect label="Type" value={type} onChange={setType} options={[...STORY_TYPES]} />
        <FilterSelect
          label="Sector"
          value={sector}
          onChange={setSector}
          options={sectors as string[]}
        />
        <FilterSelect
          label="Priority"
          value={priority}
          onChange={setPriority}
          options={[...PRIORITIES]}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={[...STORY_STATUSES]}
        />
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">From date</Label>
          <Input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Min score</Label>
          <Input
            type="number"
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
            className="h-8"
            placeholder="0"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Sort by</Label>
          <Select value={sort} onValueChange={(v) => setSort(v as keyof typeof SORTS)}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SORTS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No stories match these filters"
          description="Adjust the filters or create a new story."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Story</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Move</th>
                <th className="px-3 py-2 text-right font-medium">Vol ×</th>
                <th className="px-3 py-2 text-right font-medium">Opp.</th>
                <th className="px-3 py-2 text-right font-medium">Verif.</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold">{s.companies?.ticker}</span>
                      {s.is_demo ? <DemoBadge /> : null}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {s.companies?.exchange} · {s.companies?.country} ·{" "}
                      {s.companies?.sector ?? "—"}
                    </p>
                  </td>
                  <td className="max-w-72 px-3 py-2">
                    <Link
                      to="/stories/$id"
                      params={{ id: s.id }}
                      className="font-medium hover:underline"
                    >
                      {s.title}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">
                      {fmtDateTime(s.event_at ?? s.created_at)}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-xs">{s.story_type}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtMoney(s.price, s.companies?.currency ?? "USD")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Delta value={s.daily_change_pct} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(s.volume_ratio, 2)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {s.content_opportunity_score ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.verification_score ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge value={s.priority} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge value={s.status} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/stories/$id" params={{ id: s.id }}>
                        Open
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
      >
        <option value="All">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
