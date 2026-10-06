import { reportAsyncError } from "@/lib/async-errors";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ElapsedIndicator } from "@/components/common/elapsed";
import { syncStock } from "@/lib/indianapi.functions";

const STEPS = ["Connecting", "Fetching", "Parsing", "Previewing", "Saving", "Complete"] as const;

export function SyncIndianApiButton({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const qc = useQueryClient();
  const sync = useServerFn(syncStock);
  const [step, setStep] = useState<number>(-1);

  const run = useMutation({
    mutationFn: async () => {
      setStep(0);
      const promise = sync({ data: { companyId, companyName } });
      setStep(1);
      const res = await promise;
      setStep(2);
      if (!res.ok) throw new Error(res.error ?? "Provider request failed");
      setStep(3);
      setStep(4);
      return res;
    },
    onSuccess: (res) => {
      setStep(5);
      toast.success(
        `Provider data saved · ${res.quota.used}/500 used${
          res.conflicts.length ? ` · ${res.conflicts.length} conflict(s) recorded` : ""
        }`,
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
        Sync IndianAPI
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
