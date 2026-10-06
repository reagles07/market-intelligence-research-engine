/**
 * IndianAPI /stock sync (server only).
 *
 * Extracted from the sync server function so the Phase 2B research
 * orchestrator reuses exactly one IndianAPI stock importer.
 */
import { mapStockResponse, stockProviderTimestamp } from "@/lib/indianapi/mapping";

export async function syncIndianStock(args: {
  companyId?: string | undefined;
  companyName: string;
  override?: boolean | undefined;
  userId: string;
}) {
  const { callIndianApi, storeRawResponse } = await import("@/lib/indianapi.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const ingestionRunId = crypto.randomUUID();
  const res = await callIndianApi({
    endpoint: "/stock",
    params: { name: args.companyName },
    override: args.override ?? false,
    ingestionRunId,
    userId: args.userId,
  });

  if (!res.ok) {
    return { ok: false as const, error: res.error, quota: res.quota, ingestionRunId };
  }

  const rawId = await storeRawResponse({
    endpoint: "/stock",
    query: `name=${args.companyName}`,
    payload: res.data,
    requestId: res.requestId,
    ingestionRunId,
    userId: args.userId,
  });

  const { mapped, unmapped } = mapStockResponse(res.data);
  const providerTs = stockProviderTimestamp(mapped);
  const retrievedAt = new Date().toISOString();

  await supabaseAdmin.from("provider_stock_data").insert({
    company_id: args.companyId ?? null,
    provider: "IndianAPI",
    endpoint: "/stock",
    company_searched: args.companyName,
    data_mode: "LIVE_PROVIDER",
    mapped: mapped as never,
    unmapped: unmapped as never,
    currency: mapped.currency,
    source_identifier: mapped.nseCode ?? mapped.bseCode,
    provider_timestamp: providerTs,
    retrieved_at: retrievedAt,
    ingestion_run_id: ingestionRunId,
    raw_response_id: rawId,
    created_by: args.userId,
  });

  const conflicts: Array<{ field: string; existing: string; incoming: string }> = [];

  if (args.companyId) {
    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("id,sector,industry,description,market_cap")
      .eq("id", args.companyId)
      .maybeSingle();

    if (company) {
      const patch: {
        data_mode: string;
        industry?: string;
        description?: string;
        market_cap?: number;
      } = { data_mode: "LIVE_PROVIDER" };
      const consider = (
        field: "industry" | "description" | "market_cap",
        existing: unknown,
        incoming: string | number | null,
      ) => {
        if (incoming === null) return;
        if (existing === null || existing === undefined || existing === "") {
          if (field === "market_cap") patch.market_cap = Number(incoming);
          else if (field === "industry") patch.industry = String(incoming);
          else patch.description = String(incoming);
          return;
        }
        if (String(existing) !== String(incoming)) {
          conflicts.push({
            field,
            existing: String(existing),
            incoming: String(incoming),
          });
        }
      };
      consider("industry", company.industry, mapped.industry);
      consider("description", company.description, mapped.description);
      consider("market_cap", company.market_cap, mapped.marketCap);

      await supabaseAdmin.from("companies").update(patch).eq("id", args.companyId);

      if (conflicts.length) {
        await supabaseAdmin.from("provider_data_conflicts").insert(
          conflicts.map((c) => ({
            provider: "IndianAPI",
            company_id: args.companyId!,
            entity: "companies",
            entity_id: args.companyId!,
            field: c.field,
            existing_value: c.existing,
            incoming_value: c.incoming,
            ingestion_run_id: ingestionRunId,
            created_by: args.userId,
          })),
        );
      }

      await supabaseAdmin.from("market_snapshots").insert({
        company_id: args.companyId,
        price: mapped.price,
        previous_close: mapped.previousClose,
        daily_change_pct: mapped.percentChange,
        as_of: providerTs ?? retrievedAt,
        freshness: "Provider Data",
        source: "IndianAPI /stock",
        provider: "IndianAPI",
        data_mode: "LIVE_PROVIDER",
        ingestion_run_id: ingestionRunId,
        is_demo: false,
        created_by: args.userId,
      });
    }
  }

  return {
    ok: true as const,
    quota: res.quota,
    ingestionRunId,
    rawResponseId: rawId,
    mapped,
    unmappedKeys: Object.keys(unmapped),
    conflicts,
    providerTimestamp: providerTs,
    retrievedAt,
  };
}
