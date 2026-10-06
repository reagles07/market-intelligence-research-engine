import { reportAsyncError } from "@/lib/async-errors";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState, StatusBadge } from "@/components/common/ui-bits";
import { DEFAULT_WATCHLISTS, PRIORITIES } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/watchlists")({
  head: () => ({
    meta: [
      { title: "Watchlists — Stock Research Studio" },
      {
        name: "description",
        content:
          "Organise tracked companies into research watchlists such as Long-Term Quality, Short-Term Momentum and Earnings This Week.",
      },
      { property: "og:title", content: "Watchlists" },
      {
        property: "og:description",
        content: "Organise tracked US and Indian companies into research watchlists.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WatchlistsPage,
});

function WatchlistsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [addTo, setAddTo] = useState<string | null>(null);

  const { data: lists } = useQuery({
    queryKey: ["watchlists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("watchlists")
        .select(
          "*, watchlist_items(id,priority,notes,tags,companies(id,ticker,name,country,sector))",
        )
        .order("created_at");
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

  const createList = useMutation({
    mutationFn: async (form: FormData) => {
      const { error } = await supabase.from("watchlists").insert({
        name: String(form.get("name") ?? "").trim(),
        description: String(form.get("description") ?? "").trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Watchlist created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["watchlists"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const seedDefaults = useMutation({
    mutationFn: async () => {
      const existing = new Set((lists ?? []).map((l) => l.name));
      const rows = DEFAULT_WATCHLISTS.filter((n) => !existing.has(n)).map((name) => ({
        name,
        is_default: true,
      }));
      if (rows.length === 0) return;
      const { error } = await supabase.from("watchlists").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Default watchlists ready");
      qc.invalidateQueries({ queryKey: ["watchlists"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addItem = useMutation({
    mutationFn: async ({ watchlistId, form }: { watchlistId: string; form: FormData }) => {
      const { error } = await supabase.from("watchlist_items").insert({
        watchlist_id: watchlistId,
        company_id: String(form.get("company_id") ?? ""),
        priority: String(form.get("priority") ?? "Medium"),
        notes: String(form.get("notes") ?? "").trim() || null,
        tags: String(form.get("tags") ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Added to watchlist");
      setAddTo(null);
      qc.invalidateQueries({ queryKey: ["watchlists"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("watchlist_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlists"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Watchlists</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Group companies by research intent. Watchlists organise work; they are not
            recommendations.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => seedDefaults.mutate()}>
            Create default lists
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 h-4 w-4" />
                New watchlist
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>New watchlist</DialogTitle>
              </DialogHeader>
              <form
                id="wl-form"
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  createList.mutate(new FormData(e.currentTarget));
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" name="description" />
                </div>
              </form>
              <DialogFooter>
                <Button type="submit" form="wl-form">
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {(lists ?? []).length === 0 ? (
        <EmptyState
          title="No watchlists"
          description="Create the default research watchlists to get started."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {(lists ?? []).map((l) => (
            <section key={l.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">{l.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {l.watchlist_items?.length ?? 0} companies
                    {l.description ? ` · ${l.description}` : ""}
                  </p>
                </div>
                <Dialog open={addTo === l.id} onOpenChange={(v) => setAddTo(v ? l.id : null)}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline">
                      Add
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Add to {l.name}</DialogTitle>
                    </DialogHeader>
                    <form
                      id={`wli-${l.id}`}
                      className="space-y-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        addItem.mutate({ watchlistId: l.id, form: new FormData(e.currentTarget) });
                      }}
                    >
                      <div className="space-y-1.5">
                        <Label>Company</Label>
                        <select
                          name="company_id"
                          required
                          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="">Select…</option>
                          {(companies ?? []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.ticker} — {c.name}
                            </option>
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
                        <Label htmlFor={`tags-${l.id}`}>Tags (comma separated)</Label>
                        <Input id={`tags-${l.id}`} name="tags" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`notes-${l.id}`}>Notes</Label>
                        <Input id={`notes-${l.id}`} name="notes" />
                      </div>
                    </form>
                    <DialogFooter>
                      <Button type="submit" form={`wli-${l.id}`}>
                        Add
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="mt-3 space-y-1.5">
                {(l.watchlist_items ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No companies yet.</p>
                ) : (
                  l.watchlist_items.map((it) => (
                    <div
                      key={it.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <Link
                          to="/stocks/$id"
                          params={{ id: it.companies?.id ?? "" }}
                          className="font-mono text-xs font-semibold hover:underline"
                        >
                          {it.companies?.ticker}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {it.companies?.name} · {it.companies?.sector ?? "—"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge value={it.priority} />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label="Remove from watchlist"
                          onClick={() => removeItem.mutate(it.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
