/**
 * Claim evidence lineage — makes a metric-backed claim as inspectable as a
 * source-backed one. Renders the real stored chain; never invents a source.
 */
import { FileText, Link2, Sigma, TriangleAlert } from "lucide-react";

import { isClaimTraceable, type TraceableClaim } from "@/lib/research/traceability";

type ClaimRow = TraceableClaim & {
  sources?: { title?: string | null; source_tier?: string | null; url?: string | null } | null;
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-2">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words font-medium">{value}</span>
    </div>
  );
}

export function ClaimEvidenceLineage({ claim }: { claim: ClaimRow }) {
  const trace = isClaimTraceable(claim);
  const detail = (claim.evidence_detail ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v ? v : v == null ? null : String(v));

  const icon =
    trace.evidenceType === "SOURCE" ? (
      <Link2 className="h-3.5 w-3.5" />
    ) : trace.evidenceType === "NONE" ? (
      <TriangleAlert className="h-3.5 w-3.5" />
    ) : (
      <Sigma className="h-3.5 w-3.5" />
    );

  const label =
    trace.evidenceType === "SOURCE"
      ? "Source evidence"
      : trace.evidenceType === "METRIC"
        ? "Structured metric"
        : trace.evidenceType === "CALCULATION"
          ? "Calculation"
          : "No evidence";

  const inputs = Array.isArray(detail["inputs"])
    ? (detail["inputs"] as Array<Record<string, unknown>>)
    : [];

  return (
    <div className="mt-2 rounded-lg border border-border/70 bg-muted/30 p-2.5 text-[11px]">
      <div className="mb-1.5 flex items-center gap-1.5 font-medium">
        {icon}
        <span>{label}</span>
        <span
          className={
            trace.traceable
              ? "rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400"
              : "rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400"
          }
        >
          {trace.traceable ? "Traceable" : "Not traceable"}
        </span>
      </div>

      <div className="space-y-0.5">
        {trace.evidenceType === "SOURCE" || claim.sources ? (
          <>
            <Row label="Source" value={claim.sources?.title ?? s(claim.source_id)} />
            <Row label="Tier" value={claim.sources?.source_tier} />
            <Row
              label="URL"
              value={
                claim.sources?.url ? (
                  <a
                    className="underline underline-offset-2"
                    href={claim.sources.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {claim.sources.url}
                  </a>
                ) : null
              }
            />
          </>
        ) : null}

        {trace.evidenceType === "METRIC" || trace.evidenceType === "CALCULATION" ? (
          <>
            <Row label="Metric" value={s(detail["metric_label"]) ?? s(detail["metric_column"])} />
            <Row label="Period" value={claim.evidence_period} />
            <Row label="Provider" value={claim.evidence_provider} />
            <Row label="Filing" value={s(detail["form"])} />
            <Row label="Accession" value={claim.evidence_accession} />
            <Row label="XBRL concept" value={s(detail["concept"])} />
            <Row
              label="Filing doc"
              value={
                s(detail["filing_url"]) ? (
                  <a
                    className="inline-flex items-center gap-1 underline underline-offset-2"
                    href={String(detail["filing_url"])}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FileText className="h-3 w-3" /> Open SEC filing
                  </a>
                ) : null
              }
            />
            {inputs.length ? (
              <Row
                label="Inputs"
                value={inputs
                  .map((i) => s(i["label"]) ?? (i["evidence_metric_keys"] as string[])?.join(","))
                  .filter(Boolean)
                  .join(" · ")}
              />
            ) : null}
          </>
        ) : null}

        {claim.evidence_detail?.["filing_items"] ? (
          <Row label="Filing items" value={String(claim.evidence_detail["filing_items"])} />
        ) : null}
      </div>

      {!trace.traceable ? <p className="mt-1.5 text-muted-foreground">{trace.reason}</p> : null}
    </div>
  );
}
