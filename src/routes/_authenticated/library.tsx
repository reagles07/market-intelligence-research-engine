import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { EmptyState, StatusBadge } from "@/components/common/ui-bits";
import { fmtDateTime } from "@/lib/finance";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({
    meta: [
      { title: "Content Library — Stock Research Studio" },
      {
        name: "description",
        content:
          "Approved scripts, supporting assets and publication records for the video content pipeline.",
      },
      { property: "og:title", content: "Content Library" },
      {
        property: "og:description",
        content: "Approved scripts, supporting assets and publication tracking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const qc = useQueryClient();

  const { data: assets } = useQuery({
    queryKey: ["content-assets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_assets")
        .select("*, companies(ticker), scripts(title,format,language)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: pubs } = useQuery({
    queryKey: ["content-publications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_publications")
        .select("*, scripts(title,companies(ticker))")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const advance = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("content_publications")
        .update({
          status,
          published_at: status === "Published" ? new Date().toISOString() : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["content-publications"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Content Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Phase 1 tracks publication status manually. Nothing is published automatically.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Supporting assets</h2>
        {(assets ?? []).length === 0 ? (
          <EmptyState
            title="No assets"
            description="Generate titles, descriptions, thumbnails text and disclaimers from Script Studio."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {(assets ?? []).map((a) => (
              <div key={a.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{a.asset_type}</span>
                  <span className="font-mono text-xs">{a.companies?.ticker}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                  {(a.content ?? "").slice(0, 400) || "—"}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Updated {fmtDateTime(a.updated_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Publication tracking</h2>
        {(pubs ?? []).length === 0 ? (
          <EmptyState
            title="No publication records"
            description="Add a publication record from Script Studio once a script is approved."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Script</th>
                  <th className="px-3 py-2 font-medium">Platform</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Published</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {(pubs ?? []).map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      {p.scripts?.title ?? "—"}{" "}
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.scripts?.companies?.ticker}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{p.platform}</td>
                    <td className="px-3 py-2">
                      <StatusBadge value={p.status} />
                    </td>
                    <td className="px-3 py-2 text-xs">{fmtDateTime(p.published_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <select
                        value={p.status}
                        onChange={(e) => advance.mutate({ id: p.id, status: e.target.value })}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                        aria-label="Update publication status"
                      >
                        {["Planned", "Recording", "Editing", "Scheduled", "Published"].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
