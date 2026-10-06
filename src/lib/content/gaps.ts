/**
 * Research-gap vocabulary shared by the server engine and the UI.
 *
 * Keep this file browser-safe: constants and pure helpers only.
 */

export const RESOLUTION_TYPES = [
  "FIX_FROM_EXISTING",
  "RESEARCH_REQUIRED",
  "HUMAN_REVIEW",
  "REMOVE",
] as const;
export type ResolutionType = (typeof RESOLUTION_TYPES)[number];

export const MISSING_EVIDENCE_TYPES = [
  "CURRENT_PRICE",
  "ANALYST_VIEW",
  "MANAGEMENT_GUIDANCE",
  "FINANCIAL_METRIC",
  "EVENT",
  "REGULATORY",
  "PEER_COMPARISON",
  "MARKET_REACTION",
  "OTHER",
] as const;
export type MissingEvidenceType = (typeof MISSING_EVIDENCE_TYPES)[number];

export const GAP_STATUSES = [
  "OPEN",
  "RESEARCHING",
  "RESOLVED",
  "NOT_FOUND",
  "CONFLICTING",
  "HUMAN_REVIEW",
] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

export const GAP_CLASSIFICATIONS = [
  "FOUND_VERIFIED",
  "FOUND_ATTRIBUTED",
  "FOUND_CONFLICTING",
  "FOUND_UNRELIABLE",
  "FOUND_STALE",
  "NOT_FOUND",
  "PROVIDER_REQUIRED",
] as const;
export type GapClassification = (typeof GAP_CLASSIFICATIONS)[number];

export const GAP_PRIORITIES = ["High", "Medium", "Low"] as const;

/** Evidence that goes out of date fast — anything older than this is stale. */
export const TIME_SENSITIVE_EVIDENCE: readonly MissingEvidenceType[] = [
  "CURRENT_PRICE",
  "ANALYST_VIEW",
  "MANAGEMENT_GUIDANCE",
  "MARKET_REACTION",
];
export const STALE_AFTER_DAYS = 120;

/** Maximum searches allowed for one gap, and gaps researched in one batch. */
export const MAX_QUERIES_PER_GAP = 3;
export const MAX_GAPS_PER_RUN = 6;

export const GAP_STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  RESEARCHING: "Researching",
  RESOLVED: "Resolved",
  NOT_FOUND: "Not found",
  CONFLICTING: "Conflicting evidence",
  HUMAN_REVIEW: "Needs a human",
};

export const CLASSIFICATION_LABEL: Record<string, string> = {
  FOUND_VERIFIED: "Verified by a primary source",
  FOUND_ATTRIBUTED: "Found — must be attributed",
  FOUND_CONFLICTING: "Sources disagree",
  FOUND_UNRELIABLE: "Only weak sources",
  FOUND_STALE: "Only stale evidence",
  NOT_FOUND: "No evidence found",
  PROVIDER_REQUIRED: "Needs a market-data sync",
};

/** A stable key so the same missing fact is not researched twice. */
export function gapKey(input: { companyId: string; evidenceType: string; claim: string }): string {
  const normalised = input.claim
    .toLowerCase()
    .replace(/[^a-z0-9%.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${input.companyId}:${input.evidenceType}:${normalised}`;
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}
