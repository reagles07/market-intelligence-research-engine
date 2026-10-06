/**
 * Research Readiness gate (pure, client-safe).
 *
 * Readiness is decided by the story's CORE evidence, never by the research
 * completion percentage: a useful story may legitimately leave several of the
 * 18 sections marked Insufficient Data.
 */
import type { Readiness } from "@/lib/research/domain";

export type CatalystStatus = "VERIFIED" | "ATTRIBUTED" | "MISSING";

export type ReadinessInput = {
  catalyst: CatalystStatus;
  criticalClaimsTotal: number;
  criticalClaimsSupported: number;
  coreUnsupportedClaims: number;
  claims: {
    total: number;
    verified: number;
    attributed: number;
    crossCheck: number;
    unsupported: number;
    conflicting: number;
  };
  criticalConflicts: number;
  sources: { total: number; tier1: number; tier2: number; tier3: number; tier4: number };
  packetExists: boolean;
  scenarioExpected: boolean;
  scenarioComplete: boolean;
  completionPct: number;
  verificationScore: number;
  traceabilityIntact: boolean;
};

export type ReadinessResult = {
  readiness: Readiness;
  reason: string;
  summary: ReadinessInput & { scenarioStatus: "complete" | "incomplete" | "not required" };
};

export function evaluateReadiness(input: ReadinessInput): ReadinessResult {
  const scenarioStatus = !input.scenarioExpected
    ? ("not required" as const)
    : input.scenarioComplete
      ? ("complete" as const)
      : ("incomplete" as const);

  const summary = { ...input, scenarioStatus };
  const verdict = (readiness: Readiness, reason: string): ReadinessResult => ({
    readiness,
    reason,
    summary,
  });

  // 1. An unresolved material disagreement about the central story blocks everything.
  if (input.criticalConflicts > 0) {
    return verdict(
      "BLOCKED_BY_CONFLICT",
      `${input.criticalConflicts} unresolved conflict${input.criticalConflicts === 1 ? "" : "s"} affect the central story. Both accounts stay visible; a human must resolve them.`,
    );
  }

  // 2. The story itself must be establishable.
  if (!input.packetExists) {
    return verdict("INSUFFICIENT_DATA", "No research packet was produced for this story.");
  }
  if (input.catalyst === "MISSING") {
    return verdict(
      "INSUFFICIENT_DATA",
      "The primary catalyst could not be sourced. The story cannot be told from the evidence on record.",
    );
  }
  if (input.sources.tier1 + input.sources.tier2 === 0) {
    return verdict(
      "INSUFFICIENT_DATA",
      "No Tier 1 or Tier 2 source supports this story — only weaker discovery/social material is on file.",
    );
  }
  if (input.claims.total === 0) {
    return verdict("INSUFFICIENT_DATA", "No claims were extracted, so nothing can be verified.");
  }
  if (input.coreUnsupportedClaims > 0) {
    return verdict(
      "INSUFFICIENT_DATA",
      `${input.coreUnsupportedClaims} critical claim${input.coreUnsupportedClaims === 1 ? " is" : "s are"} unsupported and the story cannot be told without ${input.coreUnsupportedClaims === 1 ? "it" : "them"}.`,
    );
  }
  if (
    input.criticalClaimsTotal > 0 &&
    input.criticalClaimsSupported / input.criticalClaimsTotal < 0.6
  ) {
    return verdict(
      "INSUFFICIENT_DATA",
      `Only ${input.criticalClaimsSupported} of ${input.criticalClaimsTotal} critical numerical claims are supported.`,
    );
  }

  // 3. Usable, but human judgement is still required.
  const reviewReasons: string[] = [];
  if (input.claims.conflicting > 0)
    reviewReasons.push(`${input.claims.conflicting} claim(s) are marked Conflicting`);
  if (input.criticalClaimsTotal > 0 && input.criticalClaimsSupported < input.criticalClaimsTotal)
    reviewReasons.push(
      `${input.criticalClaimsTotal - input.criticalClaimsSupported} critical claim(s) still need support`,
    );
  if (input.catalyst === "ATTRIBUTED" && input.sources.tier1 === 0)
    reviewReasons.push("the catalyst rests on reporting rather than a primary source");
  if (input.claims.crossCheck > input.claims.verified + input.claims.attributed)
    reviewReasons.push("most claims are still Needs Cross-Check");
  if (input.scenarioExpected && !input.scenarioComplete)
    reviewReasons.push("scenario analysis is incomplete");
  if (!input.traceabilityIntact) reviewReasons.push("source traceability is incomplete");

  if (reviewReasons.length) {
    return verdict("NEEDS_REVIEW", `Research is broadly usable, but ${reviewReasons.join("; ")}.`);
  }

  return verdict(
    "READY_FOR_CONTENT",
    `Primary catalyst ${input.catalyst.toLowerCase()}, ${input.criticalClaimsSupported}/${input.criticalClaimsTotal} critical claims supported, ${input.sources.tier1} Tier 1 and ${input.sources.tier2} Tier 2 sources, no unresolved conflict${input.scenarioExpected ? ", scenarios complete" : ""}.`,
  );
}

// ------------------------------------------------- claim classification (pure)

/**
 * A claim row as read by the readiness gate. The category column is
 * `claim_category` — reading `category` was the Phase 2B bug that made valid
 * research look like INSUFFICIENT_DATA.
 */
export type ReadinessClaim = {
  claim_category?: string | null;
  verification_status?: string | null;
  is_critical?: boolean | null;
  source_id?: string | null;
};

/** Categories that stand on attribution rather than independent verification. */
export const ATTRIBUTABLE_CATEGORIES = ["COMPANY CLAIM", "ANALYST VIEW", "NEWS REPORT"] as const;

/**
 * Categories that can never establish a fact for readiness, whatever status a
 * model stamps on them: a rumour stays a rumour, an inference stays qualified,
 * a scenario is a forecast — never historical/current fact.
 */
export const NON_ESTABLISHING_CATEGORIES = [
  "RUMOUR",
  "SCENARIO",
  "INFERENCE",
  "UNSUPPORTED",
] as const;

const REJECTED = ["Unsupported", "Rejected"];

/**
 * A claim that can never establish a fact (rumour, scenario, inference) must
 * never be flagged critical: critical means "the story depends on this being
 * a supported fact", which such a category can never satisfy by definition.
 */
export function canBeCritical(claimCategory: unknown): boolean {
  return !(NON_ESTABLISHING_CATEGORIES as readonly string[]).includes(String(claimCategory ?? ""));
}

/** True when a claim may carry weight in the readiness verdict. */
export function isClaimSupported(c: ReadinessClaim): boolean {
  const category = String(c.claim_category ?? "");
  if ((NON_ESTABLISHING_CATEGORIES as readonly string[]).includes(category)) return false;
  const status = String(c.verification_status ?? "");
  if (status === "Verified") return true;
  return (
    Boolean(c.source_id) &&
    [...ATTRIBUTABLE_CATEGORIES, "CALCULATION"].includes(category) &&
    !REJECTED.includes(status)
  );
}

/** True when a claim is attributed evidence (never promoted to plain FACT). */
export function isClaimAttributed(c: ReadinessClaim): boolean {
  return (
    Boolean(c.source_id) &&
    (ATTRIBUTABLE_CATEGORIES as readonly string[]).includes(String(c.claim_category ?? "")) &&
    !REJECTED.includes(String(c.verification_status ?? ""))
  );
}

export function summarizeClaims(list: ReadinessClaim[]) {
  return {
    total: list.length,
    verified: list.filter((c) => c.verification_status === "Verified").length,
    attributed: list.filter(isClaimAttributed).length,
    crossCheck: list.filter((c) => c.verification_status === "Needs Cross-Check").length,
    unsupported: list.filter((c) => c.verification_status === "Unsupported").length,
    conflicting: list.filter((c) => c.verification_status === "Conflicting").length,
  };
}
