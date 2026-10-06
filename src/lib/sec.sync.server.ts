/**
 * SEC EDGAR company sync (server only).
 *
 * Extracted from the sync server function so the Phase 2B research
 * orchestrator reuses exactly one SEC importer implementation.
 */
import { padCik } from "@/lib/sec/constants";
import { bucketPeriods, mapCompanyFacts, parseSubmissions } from "@/lib/sec/mapping";

const TICKER_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function syncSecCompanyData(args: {
  companyId: string;
  ticker?: string | undefined;
  userId: string;
}) {
  const { callSec, storeSecRaw } = await import("@/lib/sec.server");
  const { resolveTickerToCik } = await import("@/lib/sec.server.resolve");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const ingestionRunId = crypto.randomUUID();
  const userId = args.userId;
  const report = {
    ingestionRunId,
    cik: null as string | null,
    cikSource: null as string | null,
    filingsRetrieved: 0,
    filingsCreated: 0,
    filingsUpdated: 0,
    sourcesCreated: 0,
    eventsCreated: 0,
    conceptsFound: 0,
    factsStored: 0,
    metricsMapped: [] as string[],
    needsReview: [] as string[],
    unsupported: [] as string[],
    periodsCreated: 0,
    periodsUpdated: 0,
    conflicts: 0,
    requests: 0,
    errors: [] as string[],
  };

  const { data: company } = await supabaseAdmin
    .from("companies")
    .select("id,name,ticker,country,currency,sec_cik")
    .eq("id", args.companyId)
    .maybeSingle();
  if (!company) throw new Error("Company not found.");

  // 1. Resolve CIK (cached).
  let cik = company.sec_cik ? padCik(company.sec_cik) : null;
  report.cikSource = cik ? "stored" : null;
  if (!cik) {
    const resolved = await resolveTickerToCik(args.ticker ?? company.ticker, {
      userId,
      maxAgeMs: TICKER_CACHE_MAX_AGE_MS,
    });
    report.requests += resolved.requests;
    if (!resolved.cik) {
      await supabaseAdmin
        .from("companies")
        .update({ sec_status: "CIK Not Found" })
        .eq("id", company.id);
      return {
        ok: false as const,
        error: `Could not resolve ${company.ticker} to a SEC CIK.`,
        report,
      };
    }
    cik = resolved.cik;
    report.cikSource = resolved.cached ? "cache" : "sec ticker file";
  }
  report.cik = cik;
  await supabaseAdmin.from("companies").update({ sec_cik: cik }).eq("id", company.id);

  // 2. Submissions.
  const subEndpoint = `/submissions/CIK${cik}.json`;
  const subRes = await callSec({ endpoint: subEndpoint, ingestionRunId, userId });
  report.requests += 1;
  if (!subRes.ok) {
    await supabaseAdmin.from("companies").update({ sec_status: "Error" }).eq("id", company.id);
    report.errors.push(subRes.error ?? "submissions request failed");
    return { ok: false as const, error: subRes.error, report };
  }

  const parsed = parseSubmissions(subRes.data, cik);
  report.filingsRetrieved = parsed.filings.length;
  await storeSecRaw({
    endpoint: subEndpoint,
    query: `cik=${cik}`,
    // Only the filing metadata we actually use is retained.
    payload: { name: parsed.name, tickers: parsed.tickers, filings: parsed.filings.slice(0, 60) },
    requestId: subRes.requestId,
    ingestionRunId,
    userId,
  });

  const filings = parsed.filings.slice(0, 60);
  const retrievedAt = new Date().toISOString();

  for (const f of filings) {
    // Source: never duplicated for the same accession number.
    const sourceTitle = `SEC EDGAR ${f.form} — ${company.name} (${f.accessionNumber})`;
    const { data: existingSource } = await supabaseAdmin
      .from("sources")
      .select("id")
      .eq("company_id", company.id)
      .eq("title", sourceTitle)
      .maybeSingle();

    let sourceId = existingSource?.id ?? null;
    const sourceRow = {
      company_id: company.id,
      title: sourceTitle,
      url: f.url,
      publisher: "SEC EDGAR",
      source_type: "SEC Filing",
      source_tier: "Tier 1 — Primary Source",
      published_at: f.acceptedAt ?? (f.filingDate ? `${f.filingDate}T00:00:00Z` : null),
      retrieved_at: retrievedAt,
      notes: `CIK ${cik} · form ${f.form} · accession ${f.accessionNumber} · filed ${f.filingDate ?? "—"} · report period ${f.reportDate ?? "—"}`,
      created_by: userId,
    };
    if (sourceId) {
      await supabaseAdmin.from("sources").update(sourceRow).eq("id", sourceId);
    } else {
      const { data: ins } = await supabaseAdmin
        .from("sources")
        .insert(sourceRow)
        .select("id")
        .single();
      sourceId = ins?.id ?? null;
      if (sourceId) report.sourcesCreated += 1;
    }

    const { data: existingFiling } = await supabaseAdmin
      .from("sec_filings")
      .select("id")
      .eq("cik", cik)
      .eq("accession_number", f.accessionNumber)
      .maybeSingle();

    const filingRow = {
      company_id: company.id,
      cik,
      form: f.form,
      filing_date: f.filingDate,
      report_date: f.reportDate,
      accepted_at: f.acceptedAt,
      accession_number: f.accessionNumber,
      primary_document: f.primaryDocument,
      url: f.url,
      source_id: sourceId,
      data_mode: "LIVE_PROVIDER",
      retrieved_at: retrievedAt,
      ingestion_run_id: ingestionRunId,
      created_by: userId,
    };

    if (existingFiling) {
      await supabaseAdmin.from("sec_filings").update(filingRow).eq("id", existingFiling.id);
      report.filingsUpdated += 1;
    } else {
      await supabaseAdmin.from("sec_filings").insert(filingRow);
      report.filingsCreated += 1;
    }
  }

  // 3. Events — the filing is recorded; importance is neutral by default.
  const { SEC_FORM_EVENT_TYPE } = await import("@/lib/sec/constants");
  for (const f of filings.slice(0, 20)) {
    const title = `${f.form} filed — ${company.name}`;
    const occurredAt = f.acceptedAt ?? (f.filingDate ? `${f.filingDate}T00:00:00Z` : retrievedAt);
    const { data: existingEvent } = await supabaseAdmin
      .from("events")
      .select("id")
      .eq("company_id", company.id)
      .eq("title", title)
      .eq("occurred_at", occurredAt)
      .maybeSingle();
    if (existingEvent) continue;
    const { data: ev } = await supabaseAdmin
      .from("events")
      .insert({
        company_id: company.id,
        title,
        event_type: SEC_FORM_EVENT_TYPE[f.form] ?? "Regulatory Filing",
        occurred_at: occurredAt,
        description: `SEC ${f.form}, accession ${f.accessionNumber}. Filing recorded from EDGAR; significance not yet assessed.`,
        importance: "Medium",
        created_by: userId,
      })
      .select("id")
      .single();
    if (ev?.id) {
      report.eventsCreated += 1;
      await supabaseAdmin
        .from("sec_filings")
        .update({ event_id: ev.id })
        .eq("cik", cik)
        .eq("accession_number", f.accessionNumber);
    }
  }

  // 4. Company facts.
  const factsEndpoint = `/api/xbrl/companyfacts/CIK${cik}.json`;
  const factsRes = await callSec({ endpoint: factsEndpoint, ingestionRunId, userId });
  report.requests += 1;
  if (!factsRes.ok) {
    report.errors.push(factsRes.error ?? "companyfacts request failed");
  } else {
    const summary = mapCompanyFacts(factsRes.data);
    report.conceptsFound = summary.conceptsFound;
    report.needsReview = summary.needsReview;
    report.unsupported = summary.unsupported;
    report.metricsMapped = [...new Set(summary.facts.map((f) => f.metricKey))];

    await storeSecRaw({
      endpoint: factsEndpoint,
      query: `cik=${cik}`,
      // The full companyfacts document is multi-megabyte; only the supported
      // concepts are retained so the raw store stays useful for debugging.
      payload: {
        note: "Trimmed to supported concepts.",
        conceptsFound: summary.conceptsFound,
        facts: summary.facts.slice(0, 200),
      },
      requestId: factsRes.requestId,
      ingestionRunId,
      userId,
    });

    const factRows = summary.facts.map((f) => ({
      company_id: company.id,
      cik,
      metric_key: f.metricKey,
      concept: f.concept,
      taxonomy: f.taxonomy,
      unit: f.unit,
      value: f.value,
      fiscal_year: f.fiscalYear,
      fiscal_period: f.fiscalPeriod,
      form: f.form,
      filed: f.filed,
      start_date: f.startDate,
      end_date: f.endDate,
      frame: f.frame,
      accession_number: f.accessionNumber,
      period_kind: f.periodKind,
      mapping_confidence: f.mappingConfidence,
      candidate_concepts: f.candidateConcepts as never,
      data_mode: "LIVE_PROVIDER",
      ingestion_run_id: ingestionRunId,
      retrieved_at: retrievedAt,
      created_by: userId,
    }));

    for (let i = 0; i < factRows.length; i += 200) {
      const chunk = factRows.slice(i, i + 200);
      const { error } = await supabaseAdmin.from("sec_facts").upsert(chunk, {
        onConflict:
          "cik,concept,unit,fiscal_year,fiscal_period,form,start_date,end_date,accession_number",
        ignoreDuplicates: true,
      });
      if (error) report.errors.push(error.message);
      else report.factsStored += chunk.length;
    }

    // 5. Financial periods — never silently overwrite an existing value.
    const buckets = bucketPeriods(summary.facts).slice(0, 24);
    for (const b of buckets) {
      // Annual buckets carry a NULL fiscal_quarter; `.eq(col, null)` never
      // matches in PostgREST, so an annual period must be matched with `.is()`
      // or every sync would create a duplicate row instead of merging.
      let periodQuery = supabaseAdmin
        .from("financial_periods")
        .select("*")
        .eq("company_id", company.id)
        .eq("period_type", b.periodType)
        .eq("fiscal_year", b.fiscalYear);
      periodQuery = b.fiscalQuarter
        ? periodQuery.eq("fiscal_quarter", b.fiscalQuarter)
        : periodQuery.is("fiscal_quarter", null);
      const { data: existing } = await periodQuery.maybeSingle();

      if (!existing) {
        await supabaseAdmin.from("financial_periods").insert({
          company_id: company.id,
          period_type: b.periodType,
          fiscal_year: b.fiscalYear,
          fiscal_quarter: b.fiscalQuarter,
          period_end: b.periodEnd,
          basis: "US GAAP",
          consolidation: "Consolidated",
          currency: "USD",
          units: "Absolute",
          is_demo: false,
          created_by: userId,
          ...b.values,
        });
        report.periodsCreated += 1;
        continue;
      }

      const patch: Record<string, number> = {};
      const conflicts: Array<{ field: string; existing: string; incoming: string }> = [];
      for (const [col, val] of Object.entries(b.values)) {
        const current = (existing as Record<string, unknown>)[col];
        if (current === null || current === undefined) {
          patch[col] = val;
        } else if (Math.abs(Number(current) - val) > Math.max(1e-6, Math.abs(val) * 0.001)) {
          conflicts.push({ field: col, existing: String(current), incoming: String(val) });
        }
      }
      if (Object.keys(patch).length) {
        await supabaseAdmin
          .from("financial_periods")
          .update(patch as never)
          .eq("id", existing.id);
        report.periodsUpdated += 1;
      }
      if (conflicts.length) {
        await supabaseAdmin.from("provider_data_conflicts").insert(
          conflicts.map((c) => ({
            provider: "SEC EDGAR",
            company_id: company.id,
            entity: "financial_periods",
            entity_id: existing.id,
            field: `${b.periodType} ${b.fiscalYear}${b.fiscalQuarter ? ` ${b.fiscalQuarter}` : ""} · ${c.field}`,
            existing_value: c.existing,
            incoming_value: c.incoming,
            ingestion_run_id: ingestionRunId,
            created_by: userId,
          })),
        );
        report.conflicts += conflicts.length;
      }
    }
  }

  await supabaseAdmin
    .from("companies")
    .update({
      sec_last_sync: retrievedAt,
      sec_status: report.errors.length ? "Partial" : "Synced",
      data_mode: "LIVE_PROVIDER",
    })
    .eq("id", company.id);

  return { ok: true as const, error: null as string | null, report };
}
