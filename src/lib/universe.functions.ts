/**
 * Universe server functions (Phase 3A).
 *
 * Read/refresh the Core 50 and Dynamic 50 lists. The Dynamic 50 is computed
 * from discovery activity already stored in the database — no external market
 * data provider is required, and nothing here promotes, researches, approves
 * or publishes anything.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DYNAMIC_LOOKBACK_DAYS,
  UNIVERSE_MARKETS,
  UNIVERSE_TIERS,
  normalizeTicker,
  scoreDynamicCandidates,
  tickerAliases,
} from "@/lib/universe/domain";

export const listUniverse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { market?: string; tier?: string }) =>
    z
      .object({
        market: z.enum(UNIVERSE_MARKETS).optional(),
        tier: z.enum(UNIVERSE_TIERS).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("universe_members")
      .select("*")
      .eq("is_active", true)
      .order("rank", { ascending: true, nullsFirst: false });
    if (data.market) query = query.eq("market", data.market);
    if (data.tier) query = query.eq("tier", data.tier);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const refreshDynamic50 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { market: string }) =>
    z.object({ market: z.enum(UNIVERSE_MARKETS) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - DYNAMIC_LOOKBACK_DAYS * 86_400_000).toISOString();

    const { data: candidates, error } = await context.supabase
      .from("story_candidates")
      .select(
        "ticker, company_name, exchange, company_id, content_score, pre_score, signal_count, discovered_at, primary_type",
      )
      .eq("market", data.market)
      .gte("discovered_at", since);
    if (error) throw new Error(error.message);

    const ranked = scoreDynamicCandidates(candidates ?? []);

    // Attach known company records by ticker where discovery did not.
    const tickers = ranked.map((r) => r.ticker);
    let byTicker = new Map<string, string>();
    if (tickers.length > 0) {
      const { data: companies } = await context.supabase
        .from("companies")
        .select("id, ticker")
        .in("ticker", tickers);
      byTicker = new Map((companies ?? []).map((c) => [c.ticker.toUpperCase(), c.id]));
    }

    const { error: delError } = await context.supabase
      .from("universe_members")
      .delete()
      .eq("market", data.market)
      .eq("tier", "DYNAMIC_50");
    if (delError) throw new Error(delError.message);

    if (ranked.length > 0) {
      const { error: insError } = await context.supabase.from("universe_members").insert(
        ranked.map((r) => ({
          market: data.market,
          tier: "DYNAMIC_50",
          ticker: r.ticker,
          name: r.name,
          exchange: r.exchange,
          company_id: r.company_id ?? byTicker.get(r.ticker) ?? null,
          rank: r.rank,
          score: r.score,
          reason: r.reason,
        })),
      );
      if (insError) throw new Error(insError.message);
    }

    return {
      market: data.market,
      considered: candidates?.length ?? 0,
      selected: ranked.length,
      lookbackDays: DYNAMIC_LOOKBACK_DAYS,
      computedAt: new Date().toISOString(),
    };
  });

/**
 * Deterministically link universe rows to canonical company identities.
 *
 * Matching is alias-aware (BRK.B / BRK-B, NSE suffixes, "&" spellings) and
 * scoped by market so US and India tickers can never collide. When a Core 50
 * identity genuinely does not exist yet we create a *minimal identity row
 * only* — ticker, seeded name, exchange, market, deterministic currency and
 * seeded sector. No price, valuation, fundamentals, analyst or provider data
 * is ever fabricated; those fields stay null until real research fills them.
 */
export const linkUniverseCompanies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { createMissing?: boolean } | undefined) =>
    z.object({ createMissing: z.boolean().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const createMissing = data.createMissing ?? true;

    const { data: rows, error } = await db
      .from("universe_members")
      .select("id, market, tier, ticker, name, sector, exchange, company_id")
      .eq("is_active", true);
    if (error) throw new Error(error.message);

    const all = rows ?? [];
    const before = {
      total: all.length,
      linked: all.filter((r) => r.company_id).length,
    };

    const unlinked = all.filter((r) => !r.company_id);
    if (unlinked.length === 0) {
      return { before, after: before, linked: 0, created: 0, unresolved: [] as string[] };
    }

    const { data: companies, error: cErr } = await db
      .from("companies")
      .select("id, ticker, country, exchange");
    if (cErr) throw new Error(cErr.message);

    // market -> normalized alias -> company id
    const index = new Map<string, string>();
    for (const c of companies ?? []) {
      for (const alias of tickerAliases(c.ticker)) {
        index.set(`${c.country}|${alias}`, c.id);
      }
    }

    let linked = 0;
    let created = 0;
    const unresolved: string[] = [];

    for (const row of unlinked) {
      let companyId: string | undefined;
      for (const alias of tickerAliases(row.ticker)) {
        companyId = index.get(`${row.market}|${alias}`);
        if (companyId) break;
      }

      if (!companyId && createMissing) {
        const { data: inserted, error: insErr } = await db
          .from("companies")
          .insert({
            ticker: normalizeTicker(row.ticker),
            name: (row.name ?? row.ticker).trim(),
            exchange: (row.exchange ?? (row.market === "India" ? "NSE" : "NASDAQ")).trim(),
            country: row.market,
            currency: row.market === "India" ? "INR" : "USD",
            sector: row.sector?.trim() || null,
            data_mode: "SEEDED_IDENTITY",
          })
          .select("id, ticker, country")
          .single();
        if (insErr) {
          unresolved.push(`${row.market}:${row.ticker} — ${insErr.message}`);
          continue;
        }
        companyId = inserted.id;
        created += 1;
        for (const alias of tickerAliases(inserted.ticker)) {
          index.set(`${inserted.country}|${alias}`, inserted.id);
        }
      }

      if (!companyId) {
        unresolved.push(`${row.market}:${row.ticker}`);
        continue;
      }

      const { error: upErr } = await db
        .from("universe_members")
        .update({ company_id: companyId })
        .eq("id", row.id);
      if (upErr) unresolved.push(`${row.market}:${row.ticker} — ${upErr.message}`);
      else linked += 1;
    }

    return {
      before,
      after: { total: before.total, linked: before.linked + linked },
      linked,
      created,
      unresolved,
    };
  });

/** Per-market/tier link coverage for reporting. */
export const universeLinkCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("universe_members")
      .select("market, tier, company_id")
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    const buckets = new Map<
      string,
      { market: string; tier: string; total: number; linked: number }
    >();
    for (const row of data ?? []) {
      const key = `${row.market}|${row.tier}`;
      const b = buckets.get(key) ?? { market: row.market, tier: row.tier, total: 0, linked: 0 };
      b.total += 1;
      if (row.company_id) b.linked += 1;
      buckets.set(key, b);
    }
    return Array.from(buckets.values()).sort((a, b) =>
      `${a.market}${a.tier}`.localeCompare(`${b.market}${b.tier}`),
    );
  });
