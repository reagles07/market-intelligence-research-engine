import { reportAsyncError } from "@/lib/async-errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionTitle } from "@/components/common/ui-bits";
import { providerStatus, testConnection } from "@/lib/indianapi.functions";
import { fmtDateTime } from "@/lib/finance";

const LEVEL_TONE: Record<string, string> = {
  Normal: "bg-secondary text-foreground",
  Warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  Critical: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  "Emergency Reserve": "bg-destructive/15 text-destructive",
  Blocked: "bg-destructive text-destructive-foreground",
};

export function IndianApiPanel() {
  const qc = useQueryClient();
  const status = useServerFn(providerStatus);
  const test = useServerFn(testConnection);
  const [override, setOverride] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["provider-status", "indianapi"],
    queryFn: () => status(),
  });

  const run = useMutation({
    mutationFn: () => test({ data: { override } }),
    onSuccess: (res) => {
      if (res.connected) toast.success(`Connected · ${res.latencyMs} ms`);
      else toast.error(res.error ?? `Provider returned HTTP ${res.status}`);
      qc.invalidateQueries({ queryKey: ["provider-status", "indianapi"] }).catch((error: unknown) =>
        reportAsyncError(error, "refresh"),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) return <Skeleton className="h-56 rounded-xl" />;

  const rows: Array<[string, string]> = [
    [
      "Connection status",
      data.connected ? "Connected" : data.keyConfigured ? "Not verified" : "No API key",
    ],
    ["Monthly plan limit", String(data.monthlyLimit)],
    ["Requests used", String(data.used)],
    ["Requests remaining", String(data.remaining)],
    ["Last successful request", data.lastSuccessAt ? fmtDateTime(data.lastSuccessAt) : "—"],
    ["Last error", data.lastError ? `${data.lastError.slice(0, 120)}` : "—"],
    ["Average latency", data.avgLatencyMs === null ? "—" : `${data.avgLatencyMs} ms`],
  ];

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle
          title="IndianAPI"
          description="Provider data for Indian listings. Requests are made only when you press a button — pages always read the database."
        />
        <span
          className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${LEVEL_TONE[data.level] ?? "bg-secondary"}`}
        >
          {data.level}
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
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? "Testing…" : "Test connection"}
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={override} onCheckedChange={(v) => setOverride(Boolean(v))} />
          Administrator override
        </label>
        <span className="text-[11px] text-muted-foreground">
          Test calls /trending and never writes into stock records.
        </span>
      </div>

      {override ? (
        <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Warning: override ignores the monthly block at {data.monthlyLimit} requests. Each extra
          call may be billed or rejected by the provider.
        </p>
      ) : null}
    </section>
  );
}
