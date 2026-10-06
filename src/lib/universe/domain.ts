/**
 * Company universe domain (Phase 3A, non-market-data slice).
 *
 * CORE_50   — a fixed, curated large-cap list per market. Rarely changes.
 * DYNAMIC_50 — a rotating list derived deterministically from discovery
 *              activity already stored in `story_candidates`. No external
 *              market-data provider is required.
 */
export const UNIVERSE_MARKETS = ["US", "India"] as const;
export type UniverseMarket = (typeof UNIVERSE_MARKETS)[number];

export const UNIVERSE_TIERS = ["CORE_50", "DYNAMIC_50"] as const;
export type UniverseTier = (typeof UNIVERSE_TIERS)[number];

export const DYNAMIC_LOOKBACK_DAYS = 21;
export const DYNAMIC_SIZE = 50;

/** Exchange suffixes that identify the same listed security. */
const EXCHANGE_SUFFIXES = [".NS", ".BO", ".NSE", ".BSE", ".US", ".O", ".N"];

/** Canonical form of a ticker for storage. */
export function normalizeTicker(raw: string): string {
  let t = (raw ?? "").trim().toUpperCase();
  for (const suffix of EXCHANGE_SUFFIXES) {
    if (t.endsWith(suffix)) t = t.slice(0, -suffix.length);
  }
  return t;
}

/**
 * All deterministic spellings of a ticker, so alias variants never create
 * duplicate canonical identities. Covers US class shares (BRK.B / BRK-B /
 * BRKB) and Indian symbols containing "-" or "&" (M&M / M&M / MM).
 */
export function tickerAliases(raw: string): string[] {
  const base = normalizeTicker(raw);
  const variants = new Set<string>([base]);
  variants.add(base.replace(/\./g, "-"));
  variants.add(base.replace(/-/g, "."));
  variants.add(base.replace(/[.\-\s]/g, ""));
  variants.add(base.replace(/&/g, "AND"));
  variants.add(base.replace(/\bAND\b/g, "&"));
  variants.add(base.replace(/[^A-Z0-9]/g, ""));
  return Array.from(variants).filter(Boolean);
}

export type DynamicInput = {
  ticker: string | null;
  company_name: string;
  exchange: string | null;
  company_id: string | null;
  content_score: number | null;
  pre_score: number | null;
  signal_count: number | null;
  discovered_at: string;
  primary_type: string | null;
};

export type DynamicRow = {
  ticker: string;
  name: string;
  exchange: string | null;
  company_id: string | null;
  score: number;
  rank: number;
  reason: string;
};

/**
 * Deterministic activity score: best observed candidate score, plus a small
 * breadth bonus for repeated independent activity, minus recency decay.
 */
export function scoreDynamicCandidates(rows: DynamicInput[], now = new Date()): DynamicRow[] {
  const byKey = new Map<
    string,
    {
      name: string;
      exchange: string | null;
      company_id: string | null;
      best: number;
      count: number;
      latest: number;
      types: Set<string>;
    }
  >();

  for (const r of rows) {
    const key = (r.ticker ?? r.company_name).trim().toUpperCase();
    if (!key) continue;
    const base = Math.max(Number(r.content_score ?? 0), Number(r.pre_score ?? 0));
    const at = new Date(r.discovered_at).getTime();
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        name: r.company_name,
        exchange: r.exchange,
        company_id: r.company_id,
        best: base,
        count: 1,
        latest: at,
        types: new Set(r.primary_type ? [r.primary_type] : []),
      });
      continue;
    }
    prev.best = Math.max(prev.best, base);
    prev.count += 1;
    prev.latest = Math.max(prev.latest, at);
    prev.company_id = prev.company_id ?? r.company_id;
    if (r.primary_type) prev.types.add(r.primary_type);
  }

  const scored = [...byKey.entries()].map(([ticker, v]) => {
    const days = Math.max(0, (now.getTime() - v.latest) / 86_400_000);
    const decay = Math.min(15, days * 0.75);
    const breadth = Math.min(10, (v.count - 1) * 2.5);
    const score = Math.max(0, Math.round((v.best + breadth - decay) * 10) / 10);
    return {
      ticker,
      name: v.name,
      exchange: v.exchange,
      company_id: v.company_id,
      score,
      reason: `${v.count} discovery signal${v.count === 1 ? "" : "s"} in the last ${DYNAMIC_LOOKBACK_DAYS} days (${[...v.types].join(", ") || "unclassified"})`,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));

  return scored.slice(0, DYNAMIC_SIZE).map((row, i) => ({ ...row, rank: i + 1 }));
}
