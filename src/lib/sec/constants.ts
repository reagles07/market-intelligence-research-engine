/**
 * SEC EDGAR constants — client-safe (no server-only imports).
 */

export const SEC_PROVIDER = "SEC EDGAR";
export const SEC_PROVIDER_ID = "sec_edgar";
export const SEC_DATA_BASE = "https://data.sec.gov";
export const SEC_WWW_BASE = "https://www.sec.gov";

/** Internal fair-access limit: max 5 requests / second. */
export const SEC_MAX_RPS = 5;
export const SEC_MIN_INTERVAL_MS = Math.ceil(1000 / SEC_MAX_RPS);
export const SEC_MAX_RETRIES = 2;

export const SEC_FORMS = ["10-K", "10-Q", "8-K"] as const;
export type SecForm = (typeof SEC_FORMS)[number];

export const SEC_FORM_EVENT_TYPE: Record<string, string> = {
  "10-K": "Annual Filing",
  "10-Q": "Quarterly Filing",
  "8-K": "Material Corporate Filing",
};

export type MappingConfidence = "Mapped" | "Needs Review" | "Unsupported";

export type MetricSpec = {
  key: string;
  label: string;
  /** Ordered preference — first present concept wins. */
  concepts: string[];
  taxonomy: "us-gaap" | "dei";
  units: string[];
  periodKind: "Duration" | "Instant";
  /** Column in financial_periods this metric maps to, when it maps. */
  periodColumn?: string;
};

export const SEC_METRICS: MetricSpec[] = [
  {
    key: "revenue",
    label: "Revenue",
    concepts: [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueNet",
    ],
    taxonomy: "us-gaap",
    units: ["USD"],
    periodKind: "Duration",
    periodColumn: "revenue",
  },
  {
    key: "operating_income",
    label: "Operating Income",
    concepts: ["OperatingIncomeLoss"],
    taxonomy: "us-gaap",
    units: ["USD"],
    periodKind: "Duration",
    periodColumn: "operating_income",
  },
  {
    key: "net_income",
    label: "Net Income",
    concepts: ["NetIncomeLoss", "ProfitLoss"],
    taxonomy: "us-gaap",
    units: ["USD"],
    periodKind: "Duration",
    periodColumn: "net_income",
  },
  {
    key: "eps_basic",
    label: "Basic EPS",
    concepts: ["EarningsPerShareBasic"],
    taxonomy: "us-gaap",
    units: ["USD/shares"],
    periodKind: "Duration",
    periodColumn: "eps_gaap",
  },
  {
    key: "eps_diluted",
    label: "Diluted EPS",
    concepts: ["EarningsPerShareDiluted"],
    taxonomy: "us-gaap",
    units: ["USD/shares"],
    periodKind: "Duration",
    periodColumn: "eps_adjusted",
  },
  {
    key: "cash",
    label: "Cash and Cash Equivalents",
    concepts: [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
    taxonomy: "us-gaap",
    units: ["USD"],
    periodKind: "Instant",
    periodColumn: "cash",
  },
  {
    key: "total_assets",
    label: "Total Assets",
    concepts: ["Assets"],
    taxonomy: "us-gaap",
    units: ["USD"],
    periodKind: "Instant",
    periodColumn: "total_assets",
  },
  {
    key: "total_liabilities",
    label: "Total Liabilities",
    concepts: ["Liabilities"],
    taxonomy: "us-gaap",
    units: ["USD"],
    periodKind: "Instant",
    periodColumn: "total_liabilities",
  },
  {
    key: "operating_cash_flow",
    label: "Operating Cash Flow",
    concepts: [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    taxonomy: "us-gaap",
    units: ["USD"],
    periodKind: "Duration",
    periodColumn: "operating_cash_flow",
  },
  {
    key: "shares_outstanding",
    label: "Shares Outstanding",
    concepts: ["CommonStockSharesOutstanding"],
    taxonomy: "us-gaap",
    units: ["shares"],
    periodKind: "Instant",
    periodColumn: "shares_outstanding",
  },
];

export function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

export function filingUrl(cik: string, accession: string, primaryDoc: string | null): string {
  const bare = String(Number(cik.replace(/\D/g, "")));
  const acc = accession.replace(/-/g, "");
  return primaryDoc
    ? `${SEC_WWW_BASE}/Archives/edgar/data/${bare}/${acc}/${primaryDoc}`
    : `${SEC_WWW_BASE}/Archives/edgar/data/${bare}/${acc}/${accession}-index.htm`;
}
