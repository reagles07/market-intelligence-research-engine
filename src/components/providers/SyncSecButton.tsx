import { reportAsyncError } from "@/lib/async-errors";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ElapsedIndicator } from "@/components/common/elapsed";
import { syncSecCompany } from "@/lib/sec.functions";

const STEPS = [
  "Resolving CIK",
  "Fetching filings",
  "Fetching company facts",
  "Mapping",
  "Saving",
  "Complete",
] as const;

export function SyncSecButton({ companyId, ticker }: { companyId: string; ticker: string }) {
  const qc = useQueryClient();
  const sync = useServerFn(syncSecCompany);
  const [step, setStep] = useState(-1);

  const run = useMutation({
    mutationFn: async () => {
      setStep(0);
      const promise = sync({ data: { companyId, ticker } });
      setStep(1);
      const res = await promise;
      setStep(3);
      if (!res.ok) throw new Error(res.error ?? "SEC request failed");
      setStep(4);
      return res;
    },
    onSuccess: (res) => {
      setStep(5);
      const r = res.report;
      toast.success(
        `SEC synced · ${r.filingsCreated + r.filingsUpdated} filings · ${r.factsStored} facts · ${r.periodsCreated + r.periodsUpdated} periods` +
          (r.conflicts ? ` · ${r.conflicts} conflict(s) recorded` : "") +
          (r.needsReview.length ? ` · ${r.needsReview.length} metric(s) need review` : ""),
      );
      qc.invalidateQueries().catch((error: unknown) => reportAsyncError(error, "refresh"));
    },
    onError: (e: Error) => {
      setStep(-1);
      toast.error(e.message);
    },
  });

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
        <RefreshCw className={`mr-1.5 h-4 w-4 ${run.isPending ? "animate-spin" : ""}`} />
        Sync SEC data
      </Button>
      <ElapsedIndicator active={run.isPending} />
      {step >= 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {STEPS.map((s, i) => (
            <span key={s} className={i === step ? "font-medium text-foreground" : "opacity-50"}>
              {s}
              {i < STEPS.length - 1 ? " › " : ""}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
