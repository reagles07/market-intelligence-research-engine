import { reportAsyncError } from "@/lib/async-errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionTitle } from "@/components/common/ui-bits";
import { secStatus, secTestConnection } from "@/lib/sec.functions";
import { fmtDateTime } from "@/lib/finance";

const STATUS_TONE: Record<string, string> = {
  Connected: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "Not Configured": "bg-secondary text-foreground",
  Error: "bg-destructive/15 text-destructive",
  "Rate Limited": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  Disabled: "bg-destructive text-destructive-foreground",
};

export function SecEdgarPanel() {
  const qc = useQueryClient();
  const status = useServerFn(secStatus);
  const test = useServerFn(secTestConnection);

  const { data, isLoading } = useQuery({
    queryKey: ["provider-status", "sec-edgar"],
    queryFn: () => status(),
  });

  const run = useMutation({
    mutationFn: () => test(),
    onSuccess: (res) => {
      if (res.ok) toast.success(`SEC EDGAR connected · ${res.latencyMs} ms`);
      else toast.error(res.error ?? `SEC returned HTTP ${res.status}`);
      qc.invalidateQueries({ queryKey: ["provider-status", "sec-edgar"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) return <Skeleton className="h-56 rounded-xl" />;

  const rows: Array<[string, string]> = [
    ["Connection status", data.status],
    ["Application name", data.userAgentAppName ?? "Not set"],
    ["Contact e-mail", data.userAgentContactMasked ?? "Not set"],
    ["Internal rate limit", "5 requests / second"],
    ["Requests today", String(data.requestsToday)],
    ["Last successful request", data.lastSuccessAt ? fmtDateTime(data.lastSuccessAt) : "—"],
    ["Last failure", data.lastFailureAt ? fmtDateTime(data.lastFailureAt) : "—"],
    ["Last error", data.lastError ? data.lastError.slice(0, 120) : "—"],
    ["Average latency", data.avgLatencyMs === null ? "—" : `${data.avgLatencyMs} ms`],
    ["Most recent company sync", data.lastSyncAt ? fmtDateTime(data.lastSyncAt) : "—"],
  ];

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle
          title="SEC EDGAR"
          description="Official US filings and XBRL company facts. No API key is required; SEC requires an identifying application name and contact e-mail on every request. Requests happen only when you press a button — pages always read the database."
        />
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[data.status] ?? "bg-secondary"}`}
        >
          {data.status}
        </span>
      </div>

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5"
          >
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-right text-xs font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending || !data.configured}>
          {run.isPending ? "Testing…" : "Test connection"}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Test reads one submissions document and never writes into financial records.
        </span>
      </div>

      {!data.configured ? (
        <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          SEC requires an identifying application name and contact e-mail. Both are stored securely
          on the server and are never sent to the browser.
        </p>
      ) : null}
    </section>
  );
}
