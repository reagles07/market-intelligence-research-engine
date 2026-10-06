import { runOwnerAcceptance } from "./security/owner-cli";
import type { Database } from "../src/integrations/supabase/types";
/**
 * Pass 1B acceptance harness (not application code).
 *
 * Ingests REAL provider data (SEC EDGAR for GOOGL, IndianAPI for Tata Steel),
 * then runs the four database-only research operations through the shipped
 * server logic with a user-scoped (RLS) Supabase client.
 */
import { createClient } from "@supabase/supabase-js";

import { parseSubmissions, mapCompanyFacts, bucketPeriods } from "../src/lib/sec/mapping";
import { mapStockResponse } from "../src/lib/indianapi/mapping";
import {
  runAnalyzeStory,
  runBuildResearchPacket,
  runGenerateScenarios,
  runVerifyClaims,
} from "../src/lib/ai/research.server";

const URL_ = process.env["SUPABASE_URL"]!;
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
const admin = createClient<Database>(URL_, SERVICE, { auth: { persistSession: false } });
const db = admin; // same shape the server functions receive

const UA = `${process.env["SEC_USER_AGENT_APP_NAME"]} ${process.env["SEC_USER_AGENT_CONTACT"]}`;
const log = (...a: unknown[]) => console.log(...a);

async function userId(): Promise<string> {
  const { data } = await admin.from("profiles").select("id").limit(1).single();
  return data!.id as string;
}

async function ensureCompany(row: Database["public"]["Tables"]["companies"]["Insert"]) {
  const { data: existing } = await admin
    .from("companies")
    .select("id")
    .eq("ticker", row["ticker"] as string)
    .maybeSingle();
  if (existing) return existing.id as string;
  const { data, error } = await admin.from("companies").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function ingestSec(companyId: string, uid: string, cik: string, name: string) {
  const sub = await (
    await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { "User-Agent": UA },
    })
  ).json();
  const parsed = parseSubmissions(sub, cik);
  const filings = parsed.filings.slice(0, 12);
  const now = new Date().toISOString();

  for (const f of filings) {
    const title = `SEC EDGAR ${f.form} — ${name} (${f.accessionNumber})`;
    const { data: exists } = await admin
      .from("sources")
      .select("id")
      .eq("company_id", companyId)
      .eq("title", title)
      .maybeSingle();
    if (exists) continue;
    await admin.from("sources").insert({
      company_id: companyId,
      title,
      url: f.url,
      publisher: "SEC EDGAR",
      source_type: "SEC Filing",
      source_tier: "Tier 1 — Primary Source",
      published_at: f.acceptedAt ?? (f.filingDate ? `${f.filingDate}T00:00:00Z` : null),
      retrieved_at: now,
      notes: `CIK ${cik} · ${f.form} · filed ${f.filingDate} · period ${f.reportDate ?? "—"}`,
      created_by: uid,
    });
  }

  await new Promise((r) => setTimeout(r, 400));
  const facts = await (
    await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": UA },
    })
  ).json();
  const mapped = mapCompanyFacts(facts, { maxPerMetric: 12 });
  const buckets = bucketPeriods(mapped.facts).slice(0, 8);

  for (const b of buckets) {
    const q = admin
      .from("financial_periods")
      .select("id")
      .eq("company_id", companyId)
      .eq("period_type", b.periodType)
      .eq("fiscal_year", b.fiscalYear);
    const { data: exists } = await (
      b.fiscalQuarter ? q.eq("fiscal_quarter", b.fiscalQuarter) : q.is("fiscal_quarter", null)
    ).maybeSingle();
    if (exists) continue;
    await admin.from("financial_periods").insert({
      company_id: companyId,
      period_type: b.periodType,
      fiscal_year: b.fiscalYear,
      fiscal_quarter: b.fiscalQuarter,
      period_end: b.periodEnd,
      basis: "GAAP",
      consolidation: "Consolidated",
      currency: "USD",
      units: "Absolute",
      ...b.values,
      created_by: uid,
    });
  }
  log(`  SEC: ${filings.length} filings, ${mapped.facts.length} facts, ${buckets.length} periods`);
}

async function ingestIndianApi(companyId: string, uid: string, name: string) {
  const res = await fetch(`https://stock.indianapi.in/stock?name=${encodeURIComponent(name)}`, {
    headers: { "x-api-key": process.env["INDIAN_API_KEY"]! },
  });
  const raw = await res.json();
  const { mapped } = mapStockResponse(raw);
  const now = new Date().toISOString();

  await admin.from("market_snapshots").insert({
    company_id: companyId,
    price: mapped.price,
    previous_close: mapped.previousClose ?? null,
    daily_change_pct: mapped.percentChange ?? null,
    volume: null,
    as_of: now,
    freshness: "Fresh",
    source: "IndianAPI",
    provider: "IndianAPI",
    data_mode: "LIVE_PROVIDER",
    created_by: uid,
  });

  const news = (raw as Record<string, unknown>)["recentNews"];
  const items = Array.isArray(news) ? news.slice(0, 6) : [];
  for (const n of items as Record<string, unknown>[]) {
    const title = String(n["headline"] ?? n["title"] ?? "").slice(0, 300);
    if (!title) continue;
    const { data: exists } = await admin
      .from("sources")
      .select("id")
      .eq("company_id", companyId)
      .eq("title", title)
      .maybeSingle();
    if (exists) continue;
    await admin.from("sources").insert({
      company_id: companyId,
      title,
      url: String(n["url"] ?? "") || null,
      publisher: "IndianAPI news feed",
      source_type: "News",
      source_tier: "Tier 2 — Reputable News",
      published_at: n["date"] ? String(n["date"]) : null,
      retrieved_at: now,
      created_by: uid,
    });
  }

  const fin = (raw as Record<string, unknown>)["financials"];
  if (Array.isArray(fin)) {
    for (const p of (fin as Record<string, unknown>[]).slice(0, 4)) {
      const st = (p["stockFinancialMap"] ?? {}) as Record<string, unknown>;
      const pick = (group: string, key: string) => {
        const rows = st[group];
        if (!Array.isArray(rows)) return null;
        const hit = (rows as Record<string, unknown>[]).find((r) => String(r["key"]) === key);
        const v = hit ? Number(hit["value"]) : NaN;
        return Number.isFinite(v) ? v : null;
      };
      const year = Number(String(p["EndDate"] ?? "").slice(0, 4));
      if (!Number.isFinite(year)) continue;
      const type = String(p["Type"] ?? "");
      const isAnnual = type.toLowerCase().includes("annual");
      const q = admin
        .from("financial_periods")
        .select("id")
        .eq("company_id", companyId)
        .eq("fiscal_year", year)
        .eq("period_type", isAnnual ? "Annual" : "Quarterly");
      const { data: exists } = await (
        isAnnual ? q.is("fiscal_quarter", null) : q.eq("fiscal_quarter", "Q?")
      ).maybeSingle();
      if (exists) continue;
      await admin.from("financial_periods").insert({
        company_id: companyId,
        period_type: isAnnual ? "Annual" : "Quarterly",
        fiscal_year: year,
        fiscal_quarter: isAnnual ? null : "Q?",
        period_end: String(p["EndDate"] ?? "").slice(0, 10) || null,
        basis: "IND-AS",
        consolidation: "Consolidated",
        currency: "INR",
        units: "Crore",
        revenue: pick("INC", "TotalRevenue") ?? pick("INC", "Revenue"),
        net_income: pick("INC", "NetIncome"),
        operating_income: pick("INC", "OperatingIncome"),
        total_assets: pick("BAL", "TotalAssets"),
        created_by: uid,
      });
    }
  }
  log(`  IndianAPI: price ${mapped.price}, ${items.length} news sources`);
}

async function ensureStory(companyId: string, uid: string, title: string, type: string) {
  const { data: exists } = await admin
    .from("stories")
    .select("id")
    .eq("company_id", companyId)
    .eq("title", title)
    .maybeSingle();
  if (exists) return exists.id as string;
  const { data, error } = await admin
    .from("stories")
    .insert({
      company_id: companyId,
      title,
      story_type: type,
      priority: "High",
      status: "Research",
      created_by: uid,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function runSuite(label: string, storyId: string, uid: string) {
  log(`\n=== ${label} ===`);
  const a = await runAnalyzeStory(db, { storyId, userId: uid });
  log("analyze-story:", JSON.stringify(a).slice(0, 900));
  if (!a.ok) return;

  const v = await runVerifyClaims(db, { storyId, userId: uid });
  log("verify-claims:", JSON.stringify(v).slice(0, 700));

  const p = await runBuildResearchPacket(db, { storyId, userId: uid });
  log("build-research-packet:", JSON.stringify(p).slice(0, 700));
  if (!p.ok) return;

  const s = await runGenerateScenarios(db, { packetId: p.packetId, userId: uid });
  log("generate-scenarios:", JSON.stringify(s).slice(0, 700));
}

async function main() {
  const uid = await userId();
  const only = process.argv[2] ?? "all";

  if (only === "all" || only === "us") {
    const googl = await ensureCompany({
      name: "Alphabet Inc.",
      ticker: "GOOGL",
      exchange: "NASDAQ",
      country: "US",
      currency: "USD",
      sector: "Communication Services",
      data_mode: "LIVE_PROVIDER",
      created_by: uid,
    });
    log("GOOGL company", googl);
    await ingestSec(googl, uid, "0001652044", "Alphabet Inc.");
    const story = await ensureStory(
      googl,
      uid,
      "Alphabet: latest reported quarter and filing cadence",
      "Earnings Report",
    );
    await runSuite("US · GOOGL", story, uid);
  }

  if (only === "all" || only === "india") {
    const tata = await ensureCompany({
      name: "Tata Steel Limited",
      ticker: "TATASTEEL",
      exchange: "NSE",
      country: "India",
      currency: "INR",
      sector: "Materials",
      data_mode: "LIVE_PROVIDER",
      created_by: uid,
    });
    log("Tata company", tata);
    await ingestIndianApi(tata, uid, "Tata Steel");
    const story = await ensureStory(
      tata,
      uid,
      "Tata Steel: current market move and latest reported financials",
      "Price Movement",
    );
    await runSuite("India · Tata Steel", story, uid);
  }
}

runOwnerAcceptance(main).catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
