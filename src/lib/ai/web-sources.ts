/**
 * URL canonicalisation and source-tier rules for web research.
 *
 * The model proposes a tier; this module decides it. Tiering is a trust
 * decision, so it lives in code where it can be audited, not in a prompt.
 */
import { SOURCE_TIERS } from "@/lib/domain";

export const TIER_1 = SOURCE_TIERS[0];
export const TIER_2 = SOURCE_TIERS[1];
export const TIER_3 = SOURCE_TIERS[2];
export const TIER_4 = SOURCE_TIERS[3];

const TRACKING_PREFIXES = ["utm_", "ref_"];
const TRACKING_PARAMS = new Set([
  "ref",
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "spm",
  "cmpid",
  "smid",
  "s_cid",
  "__source",
]);

/** Stable identity for a page: no tracking params, no fragment, no www. */
export function canonicalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.protocol = "https:";
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p))) {
        u.searchParams.delete(key);
      }
    }
    u.search = u.searchParams.toString() ? `?${u.searchParams.toString()}` : "";
    if (u.pathname !== "/" && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const TIER1_HOSTS = [
  "sec.gov",
  "nseindia.com",
  "bseindia.com",
  "sebi.gov.in",
  "rbi.org.in",
  "federalreserve.gov",
  "bls.gov",
  "irs.gov",
  "europa.eu",
  "mca.gov.in",
  "pib.gov.in",
  "annualreports.com",
];

const TIER2_HOSTS = [
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "cnbc.com",
  "cnbctv18.com",
  "apnews.com",
  "economictimes.indiatimes.com",
  "indiatimes.com",
  "livemint.com",
  "business-standard.com",
  "thehindubusinessline.com",
  "moneycontrol.com",
  "businesstoday.in",
  "financialexpress.com",
  "barrons.com",
  "nytimes.com",
  "theguardian.com",
  "forbes.com",
];

const TIER3_HOSTS = [
  "finance.yahoo.com",
  "yahoo.com",
  "marketwatch.com",
  "investing.com",
  "tradingview.com",
  "stockanalysis.com",
  "screener.in",
  "tickertape.in",
  "morningstar.com",
  "macrotrends.net",
  "wisesheets.io",
  "simplywall.st",
  "gurufocus.com",
  "statista.com",
];

const TIER4_HOSTS = [
  "reddit.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "quora.com",
  "seekingalpha.com",
  "stocktwits.com",
  "medium.com",
  "substack.com",
  "telegram.me",
  "t.me",
  "tradingqna.com",
];

const matches = (host: string, list: string[]) =>
  list.some((d) => host === d || host.endsWith(`.${d}`));

/** Document types that only a primary publisher produces. */
const PRIMARY_TYPES = [
  "SEC Filing",
  "NSE / BSE Filing",
  "Company IR",
  "Earnings Call",
  "Press Release",
  "Government Data",
];

/**
 * Decide the tier from the host. Known hosts always win. For a host we do not
 * recognise we fall back conservatively: a primary-document type the model
 * called Tier 1 is accepted as primary (this is how company IR domains are
 * caught), reputable-press claims land at Tier 2, and everything else sits at
 * Tier 3 or below so it can never masquerade as evidence.
 */
export function tierForUrl(
  url: string,
  companyDomain?: string | null,
  hint?: { modelTier?: string | null; sourceType?: string | null },
): string {
  const host = hostOf(url);
  if (!host) return TIER_4;
  if (matches(host, TIER1_HOSTS)) return TIER_1;
  if (companyDomain) {
    const cd = companyDomain.toLowerCase().replace(/^www\./, "");
    if (cd && (host === cd || host.endsWith(`.${cd}`))) return TIER_1;
  }
  if (matches(host, TIER2_HOSTS)) return TIER_2;
  if (matches(host, TIER3_HOSTS)) return TIER_3;
  if (matches(host, TIER4_HOSTS)) return TIER_4;

  const modelTier = hint?.modelTier ?? null;
  const sourceType = hint?.sourceType ?? null;
  if (modelTier === TIER_1 && sourceType && PRIMARY_TYPES.includes(sourceType)) return TIER_1;
  if (modelTier === TIER_2) return TIER_2;
  if (modelTier === TIER_4) return TIER_4;
  return TIER_3;
}

export function domainOfWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(website.startsWith("http") ? website : `https://${website}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}
