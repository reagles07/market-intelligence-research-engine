/**
 * IndianAPI response-mapping layer.
 *
 * Written AFTER inspecting a real /stock?name=Tata Steel response.
 * Only fields observed in the live payload are mapped. Everything else is
 * preserved untouched as raw provider metadata.
 */

export const INDIANAPI_PROVIDER = "IndianAPI";

export type MappedStock = {
  companyName: string | null;
  industry: string | null;
  description: string | null;
  nseCode: string | null;
  bseCode: string | null;
  price: number | null;
  priceNse: number | null;
  priceBse: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  percentChange: number | null;
  marketCap: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  peTtm: number | null;
  dividendYield: number | null;
  sectorPe: number | null;
  promoterHolding: number | null;
  mutualFundHolding: number | null;
  providerDate: string | null;
  providerTime: string | null;
  currency: string;
  peers: string[];
};

/** Keys of the /stock payload we deliberately do NOT map into columns yet. */
export const STOCK_UNMAPPED_KEYS = [
  "financials",
  "stockFinancialData",
  "initialStockFinancialData",
  "keyMetrics",
  "analystView",
  "recosBar",
  "riskMeter",
  "shareholding",
  "stockCorporateActionData",
  "recentNews",
  "stockTechnicalData",
  "futureExpiryDates",
  "futureOverviewData",
] as const;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() && v.trim() !== "-" ? v.trim() : null;

type AnyRec = Record<string, unknown>;
const rec = (v: unknown): AnyRec => (v && typeof v === "object" ? (v as AnyRec) : {});

export function mapStockResponse(raw: unknown): {
  mapped: MappedStock;
  unmapped: Record<string, boolean>;
} {
  const d = rec(raw);
  const profile = rec(d["companyProfile"]);
  const cp = rec(d["currentPrice"]);
  const r = rec(d["stockDetailsReusableData"]);

  const peers = Array.isArray(profile["peerCompanyList"])
    ? (profile["peerCompanyList"] as AnyRec[])
        .map((p) => str(p["companyName"]))
        .filter((x): x is string => Boolean(x))
    : [];

  const mapped: MappedStock = {
    companyName: str(d["companyName"]),
    industry: str(d["industry"]),
    description: str(profile["companyDescription"]),
    nseCode: str(profile["exchangeCodeNse"]),
    bseCode: str(profile["exchangeCodeBse"]),
    price: num(r["price"]) ?? num(cp["NSE"]) ?? num(cp["BSE"]),
    priceNse: num(cp["NSE"]),
    priceBse: num(cp["BSE"]),
    previousClose: num(r["close"]),
    open: null, // not returned by this endpoint
    high: num(r["high"]),
    low: num(r["low"]),
    percentChange: num(d["percentChange"]) ?? num(r["percentChange"]),
    marketCap: num(r["marketCap"]),
    yearHigh: num(d["yearHigh"]) ?? num(r["yhigh"]),
    yearLow: num(d["yearLow"]) ?? num(r["ylow"]),
    peTtm: num(r["pPerEBasicExcludingExtraordinaryItemsTTM"]),
    dividendYield: num(r["currentDividendYieldCommonStockPrimaryIssueLTM"]),
    sectorPe: num(r["sectorPriceToEarningsValueRatio"]),
    promoterHolding: num(r["promoterShareHolding"]),
    mutualFundHolding: num(r["mutualFundShareHolding"]),
    providerDate: str(r["date"]),
    providerTime: str(r["time"]),
    currency: "INR",
    peers,
  };

  const unmapped: Record<string, boolean> = {};
  for (const key of Object.keys(d)) {
    if ((STOCK_UNMAPPED_KEYS as readonly string[]).includes(key)) unmapped[key] = true;
  }

  return { mapped, unmapped };
}

/** Provider timestamp for /stock, e.g. "07 Aug 2026" + "10:28:56" (IST). */
export function stockProviderTimestamp(m: MappedStock): string | null {
  if (!m.providerDate) return null;
  const parsed = Date.parse(`${m.providerDate} ${m.providerTime ?? "00:00:00"} GMT+0530`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export type DiscoveryRow = {
  companyName: string | null;
  ticker: string | null;
  price: number | null;
  movement: number | null;
  volume: number | null;
  category: string | null;
  providerTimestamp: string | null;
};

/**
 * Discovery endpoints (/trending, /NSE_most_active, ...) return different
 * shapes. This walks the payload generically and extracts whatever exists —
 * no field name is assumed to be present.
 */
export function mapDiscoveryRows(raw: unknown, category: string): DiscoveryRow[] {
  const buckets: Array<{ label: string; rows: AnyRec[] }> = [];

  const collect = (value: unknown, label: string, depth = 0) => {
    if (depth > 3 || !value) return;
    if (Array.isArray(value)) {
      const objs = value.filter((v): v is AnyRec => Boolean(v) && typeof v === "object");
      if (objs.length) buckets.push({ label, rows: objs });
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as AnyRec))
        collect(v, `${label} · ${k}`, depth + 1);
    }
  };
  collect(raw, category);

  const pick = (o: AnyRec, keys: string[]) => {
    for (const k of Object.keys(o)) {
      if (keys.some((c) => k.toLowerCase() === c.toLowerCase())) return o[k];
    }
    for (const k of Object.keys(o)) {
      if (keys.some((c) => k.toLowerCase().includes(c.toLowerCase()))) return o[k];
    }
    return undefined;
  };

  const rows: DiscoveryRow[] = [];
  for (const bucket of buckets) {
    for (const o of bucket.rows) {
      const name = str(pick(o, ["companyName", "company", "name", "headline", "title"]));
      const ticker = str(pick(o, ["ticker", "symbol", "nseCode", "bseCode", "tickerId"]));
      if (!name && !ticker) continue;
      rows.push({
        companyName: name,
        ticker,
        price: num(pick(o, ["price", "ltp", "close", "currentPrice"])),
        movement: num(pick(o, ["percentChange", "percent_change", "change", "netChange"])),
        volume: num(pick(o, ["volume", "totalTradedVolume"])),
        category: bucket.label,
        providerTimestamp: str(pick(o, ["date", "time", "lastPublishedDate", "updatedAt"])),
      });
    }
  }
  return rows.slice(0, 60);
}
