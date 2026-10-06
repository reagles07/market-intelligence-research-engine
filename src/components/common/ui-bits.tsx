import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { DISCLAIMER } from "@/lib/domain";
import { AlertTriangle, Info } from "lucide-react";

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800",
        className,
      )}
    >
      <AlertTriangle className="h-3 w-3" />
      Demo data — not live
    </span>
  );
}

export function FreshnessBadge({ freshness }: { freshness: string | null | undefined }) {
  const f = freshness ?? "Unknown";
  const tone =
    f === "Fresh"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : f === "Delayed"
        ? "border-sky-300 bg-sky-50 text-sky-700"
        : f === "Stale"
          ? "border-orange-300 bg-orange-50 text-orange-700"
          : "border-border bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        tone,
      )}
    >
      {f}
    </span>
  );
}

const STATUS_TONES: Record<string, string> = {
  New: "border-slate-300 bg-slate-50 text-slate-700",
  Researching: "border-sky-300 bg-sky-50 text-sky-700",
  "Verification Needed": "border-amber-300 bg-amber-50 text-amber-800",
  "Research Complete": "border-emerald-300 bg-emerald-50 text-emerald-700",
  "Script Ready": "border-violet-300 bg-violet-50 text-violet-700",
  Approved: "border-emerald-400 bg-emerald-100 text-emerald-800",
  Rejected: "border-rose-300 bg-rose-50 text-rose-700",
  Archived: "border-border bg-muted text-muted-foreground",
  Verified: "border-emerald-300 bg-emerald-50 text-emerald-700",
  "Needs Cross-Check": "border-amber-300 bg-amber-50 text-amber-800",
  Conflicting: "border-orange-300 bg-orange-50 text-orange-800",
  Unsupported: "border-rose-300 bg-rose-50 text-rose-700",
  Draft: "border-slate-300 bg-slate-50 text-slate-700",
  "Needs Fact Check": "border-amber-300 bg-amber-50 text-amber-800",
  "Ready for Review": "border-sky-300 bg-sky-50 text-sky-700",
  Published: "border-violet-300 bg-violet-50 text-violet-700",
  Critical: "border-rose-300 bg-rose-50 text-rose-700",
  "Automation ON": "border-emerald-300 bg-emerald-50 text-emerald-700",
  "Automation OFF": "border-slate-300 bg-slate-50 text-slate-700",
  "Dry run ON": "border-sky-300 bg-sky-50 text-sky-700",
  "Dry run OFF": "border-border bg-muted text-muted-foreground",
  High: "border-orange-300 bg-orange-50 text-orange-800",
  Medium: "border-slate-300 bg-slate-50 text-slate-700",
  Low: "border-border bg-muted text-muted-foreground",
};

export function StatusBadge({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium",
        STATUS_TONES[value] ?? "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      {value}
    </span>
  );
}

export function Delta({ value }: { value: number | null | undefined }) {
  if (typeof value !== "number" || !Number.isFinite(value))
    return <span className="text-muted-foreground">N/A</span>;
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        value > 0 ? "text-emerald-600" : value < 0 ? "text-rose-600" : "text-muted-foreground",
      )}
    >
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

export function Disclaimer({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>{DISCLAIMER}</p>
    </div>
  );
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "warn" | "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold tabular-nums tracking-tight",
          tone === "warn" && "text-amber-600",
          tone === "good" && "text-emerald-600",
          tone === "bad" && "text-rose-600",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function CategoryBadge({ value }: { value: string }) {
  return (
    <Badge variant="outline" className="font-mono text-[10px] uppercase">
      {value}
    </Badge>
  );
}
