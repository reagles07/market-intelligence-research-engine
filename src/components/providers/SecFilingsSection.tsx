import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { SectionTitle } from "@/components/common/ui-bits";
import { SEC_METRICS } from "@/lib/sec/constants";
import { fmtDateTime, fmtNum } from "@/lib/finance";

const LABELS = new Map(SEC_METRICS.map((m) => [m.key, m.label]));

const CONFIDENCE_TONE: Record<string, string> = {
  Mapped: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "Needs Review": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  Unsupported: "bg-secondary text-muted-foreground",
};

export function SecFilingsSection({ companyId }: { companyId: string }) {
  const { data: filings } = useQuery({
    queryKey: ["sec-filings", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("sec_filings")
        .select("id,form,filing_date,report_date,accession_number,url")
        .eq("company_id", companyId)
        .order("filing_date", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const { data: facts } = useQuery({
    queryKey: ["sec-facts", companyId],
    queryFn: async () => {
      const { data } = await supabase
        .from("sec_facts")
        .select(
          "id,metric_key,concept,unit,value,fiscal_year,fiscal_period,form,mapping_confidence,end_date",
        )
        .eq("company_id", companyId)
        .order("fiscal_year", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });

  const latestByMetric = new Map<string, NonNullable<typeof facts>[number]>();
  for (const f of facts ?? []) {
    const current = latestByMetric.get(f.metric_key);
    if (!current || (f.end_date ?? "") > (current.end_date ?? ""))
      latestByMetric.set(f.metric_key, f);
  }

  if (!filings?.length && !facts?.length) {
    return (
      <section className="rounded-xl border border-border bg-card p-4">
        <SectionTitle
          title="SEC EDGAR"
          description="No SEC data imported yet. Use Sync SEC data to import filings and XBRL company facts."
        />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <SectionTitle
        title="SEC EDGAR"
        description="Filings and XBRL facts imported from EDGAR. Every value keeps its original concept, unit and period."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Recent filings</p>
          {filings?.length ? (
            <div className="space-y-1.5">
              {filings.map((f) => (
                <a
                  key={f.id}
                  href={f.url ?? "#"}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:border-primary/50"
                >
                  <span className="font-medium">{f.form}</span>
                  <span className="text-xs text-muted-foreground">
                    Filed {f.filing_date ?? "—"} · period {f.report_date ?? "—"}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No filings imported.</p>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            Latest mapped facts
          </p>
          {latestByMetric.size ? (
            <div className="space-y-1.5">
              {[...latestByMetric.values()].map((f) => (
                <div
                  key={f.id}
                  className="rounded-lg border border-border px-3 py-2"
                  title={`${f.concept} · ${f.unit}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">
                      {LABELS.get(f.metric_key) ?? f.metric_key}
                    </span>
                    <span className="text-sm tabular-nums">{fmtNum(f.value, 2)}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {f.fiscal_year ?? "—"} {f.fiscal_period ?? ""} · {f.form ?? "—"} · {f.unit}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium ${CONFIDENCE_TONE[f.mapping_confidence] ?? ""}`}
                    >
                      {f.mapping_confidence}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{f.concept}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No facts imported.</p>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Source: SEC EDGAR, retrieved {fmtDateTime(new Date().toISOString())}. Filing text is not
        interpreted automatically — significance still needs analyst review.
      </p>
    </section>
  );
}
