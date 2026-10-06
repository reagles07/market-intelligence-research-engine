import { useAiModel } from "./use-ai-model";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionTitle } from "@/components/common/ui-bits";
import { aiProviderStatus, testAiConnection } from "@/lib/openai.functions";
import { OPENAI_MODELS } from "@/lib/openai/models";
import { fmtDateTime } from "@/lib/finance";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const num = (n: number) => n.toLocaleString();

export function OpenAiPanel() {
  const qc = useQueryClient();
  const { model, setModel } = useAiModel();
  const status = useServerFn(aiProviderStatus);
  const test = useServerFn(testAiConnection);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-provider-status", model],
    queryFn: () => status({ data: { model } }),
  });

  const run = useMutation({
    mutationFn: () => test({ data: { model } }),
    onSuccess: (res) => {
      if (res.connected) toast.success(`OpenAI connected · ${res.latencyMs} ms`);
      else toast.error(res.error ?? "Connection failed");
      return qc.invalidateQueries({ queryKey: ["ai-provider-status"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <SectionTitle
        title="AI provider"
        description="OpenAI powers research analysis, claim verification and script drafting. The API key stays server-side and is never sent to the browser."
      />

      {isLoading || !data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium">
              Provider: OpenAI
            </span>
            <span
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                data.connected
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : data.keyConfigured
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    : "bg-destructive/15 text-destructive"
              }`}
            >
              {data.connected
                ? "Connected"
                : data.keyConfigured
                  ? "Key configured · not yet used"
                  : "API key missing"}
            </span>
          </div>

          <div className="mb-4 max-w-sm space-y-1.5">
            <Label htmlFor="ai-model">Model</Label>
            <select
              id="ai-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {OPENAI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.detail}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Every AI feature reads the model from here; changing it does not affect research
              logic.
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Stat label="Requests today" value={num(data.requestsToday)} />
            <Stat label="Input tokens today" value={num(data.inputTokensToday)} />
            <Stat label="Output tokens today" value={num(data.outputTokensToday)} />
            <Stat label="Estimated cost today" value={usd(data.costTodayUsd)} />
            <Stat label="Estimated cost this month" value={usd(data.costMonthUsd)} />
            <Stat
              label="Average latency"
              value={data.avgLatencyMs === null ? "—" : `${num(data.avgLatencyMs)} ms`}
            />
            <Stat
              label="Last successful request"
              value={data.lastSuccessAt ? fmtDateTime(data.lastSuccessAt) : "—"}
            />
            <Stat
              label="Last failure"
              value={data.lastFailureAt ? fmtDateTime(data.lastFailureAt) : "—"}
            />
            <Stat label="Last error" value={data.lastError ?? "—"} />
          </dl>

          <Button className="mt-4" size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? "Testing…" : "Test connection"}
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Cost figures are estimates from published per-token pricing, not billed amounts.
          </p>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  );
}
