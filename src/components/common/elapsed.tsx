/**
 * Shared elapsed-time indicator for long-running creator actions.
 *
 * Research, generation, discovery and provider syncs can run for minutes.
 * The rule here is honesty: we show only real elapsed time (and the current
 * step when the backend reports one). We never invent a percentage or an ETA.
 */
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { useElapsedSeconds, elapsedMessage } from "./elapsed-utils";

export function ElapsedIndicator({
  active,
  step,
  className,
}: {
  active: boolean;
  /** Current backend step, when the run exposes one. */
  step?: string | null;
  className?: string;
}) {
  const seconds = useElapsedSeconds(active);
  if (!active) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-1.5 text-[11px] text-muted-foreground", className)}
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      <span className="tabular-nums">{elapsedMessage(seconds, step)}</span>
    </p>
  );
}
