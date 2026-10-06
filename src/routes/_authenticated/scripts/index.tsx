import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, StatusBadge } from "@/components/common/ui-bits";
import { fmtDateTime } from "@/lib/finance";
import { SCRIPT_FORMATS } from "@/lib/domain";
import { isTestArtifact } from "@/lib/creator/domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/scripts/")({
  head: () => ({
    meta: [
      { title: "Scripts — Stock Research Studio" },
      {
        name: "description",
        content:
          "Every YouTube script drafted from verified research packets, with format, audit status and review actions.",
      },
      { property: "og:title", content: "Scripts" },
      {
        property: "og:description",
        content: "Shorts and long-form scripts with audit status and review actions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ScriptsPage,
});

const formatLabel = (key: string) => SCRIPT_FORMATS.find((f) => f.key === key)?.label ?? key;

const AUDIT_TONE: Record<string, string> = {
  PASS: "border-emerald-300 bg-emerald-50 text-emerald-700",
  WARN: "border-amber-300 bg-amber-50 text-amber-800",
  FAIL: "border-rose-300 bg-rose-50 text-rose-700",
};

function auditHint(s: {
  status: string;
  audit_status: string;
  ready_for_review: boolean;
  is_ai_placeholder: boolean;
}): string | null {
  if (s.is_ai_placeholder) return "Contains placeholder blocks";
  if (s.audit_status === "FAIL") return "Audit found blocking issues";
  if (s.audit_status === "WARN") return "Audit passed with warnings — review before publishing";
  if (s.status === "Needs Fact Check") return "Awaiting fact check";
  return null;
}

function ScriptsPage() {
  const [q, setQ] = useState("");
  const [showTest, setShowTest] = useState(false);

  const { data } = useQuery({
    queryKey: ["scripts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scripts")
        .select("*, companies(ticker,name,country,is_demo), stories(id,title)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const rows = (data ?? []).filter((s) => {
    if (
      !showTest &&
      isTestArtifact({
        isDemo: s.companies?.is_demo,
        ticker: s.companies?.ticker,
        name: s.companies?.name,
      })
    )
      return false;
    if (!q.trim()) return true;
    const t = q.toLowerCase();
    return (
      (s.title ?? "").toLowerCase().includes(t) ||
      (s.companies?.ticker ?? "").toLowerCase().includes(t)
    );
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Scripts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every script is drafted from a verified research packet and audited before review.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowTest((v) => !v)}>
            {showTest ? "Hide test artifacts" : "Show test artifacts"}
          </Button>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter scripts"
            className="h-9 w-56"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Content Composer</h2>
          <p className="text-xs text-muted-foreground">
            Combine several content-ready stocks into one long-form episode plus exactly the Shorts
            you want. Single-stock deep dives still work exactly as before.
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/scripts/composer" search={{ company: undefined }}>
            Open Content Composer
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No scripts yet"
          description="Scripts are generated from a research workspace once research is ready."
          action={
            <Button asChild size="sm">
              <Link to="/research">Go to Research</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Script</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Format</th>
                <th className="px-3 py-2 font-medium">Research</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Audit</th>
                <th className="px-3 py-2 font-medium">Generated</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const hint = auditHint(s);
                return (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="max-w-64 px-3 py-2">
                      <span className="font-medium">{s.title ?? "Untitled script"}</span>
                      <p className="text-[11px] text-muted-foreground">
                        {s.word_count} words · {s.language}
                        {s.series_key ? (
                          <span className="ml-1 rounded bg-muted px-1 py-0.5 font-medium">
                            Pack {s.series_key.slice(-6)} ·{" "}
                            {s.series_part === 0 ? "Long" : `Short ${s.series_part}`}
                          </span>
                        ) : null}
                        {hint ? <span className="block text-amber-700">{hint}</span> : null}
                      </p>
                    </td>

                    <td className="px-3 py-2">
                      <span className="font-mono text-xs font-semibold">{s.companies?.ticker}</span>
                      <p className="max-w-40 truncate text-[11px] text-muted-foreground">
                        {s.companies?.name}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-xs">{formatLabel(s.format)}</td>
                    <td className="px-3 py-2 text-xs">
                      {s.packet_id ? (
                        <span>
                          Packet v{s.research_packet_version ?? "?"}
                          {s.stories?.title ? (
                            <span className="block max-w-44 truncate text-[11px] text-muted-foreground">
                              {s.stories.title}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Manual scaffold</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge value={s.status} />
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                          AUDIT_TONE[s.audit_status] ??
                            "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        {s.audit_status === "Not Audited" ? "Not audited" : s.audit_status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {s.generated_at ? fmtDateTime(s.generated_at) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.story_id ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/scripts/$id" params={{ id: s.story_id }}>
                            Review
                          </Link>
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
