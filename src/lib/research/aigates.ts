/**
 * Phase 2B — deterministic gates for the model-based orchestration stages.
 *
 * Principle: never spend AI tokens when the deterministic freshness /
 * material-change system already proves the inputs are unchanged. These are
 * pure functions so the acceptance suite can assert them directly.
 */

export type GateDecision = { run: boolean; reason: string };

/**
 * Database analysis (analyze-story) reads structured provider/company data and
 * emits claims. It only needs to run when that input set changed, or when the
 * story has no claims yet.
 */
export function decideAnalyze(args: {
  lastRunAt: string | null;
  newInputRows: number;
  claimCount: number;
  forceRefresh?: boolean;
}): GateDecision {
  if (args.forceRefresh) return { run: true, reason: "forced refresh" };
  if (!args.lastRunAt) return { run: true, reason: "no prior database analysis for this story" };
  if (args.claimCount === 0) return { run: true, reason: "no claims on file yet" };
  if (args.newInputRows > 0)
    return {
      run: true,
      reason: `${args.newInputRows} new structured input row(s) since the last analysis`,
    };
  return { run: false, reason: "structured inputs unchanged since the last analysis" };
}

/**
 * Claim verification only has work to do when a claim is awaiting a verdict, a
 * claim appeared, or new evidence (sources) arrived that could change a verdict.
 */
export function decideVerify(args: {
  lastRunAt: string | null;
  pendingClaims: number;
  newClaims: number;
  newSources: number;
  forceRefresh?: boolean;
}): GateDecision {
  if (args.forceRefresh) return { run: true, reason: "forced refresh" };
  if (!args.lastRunAt) return { run: true, reason: "claims have never been verified" };
  if (args.pendingClaims > 0)
    return { run: true, reason: `${args.pendingClaims} claim(s) awaiting a verification verdict` };
  if (args.newClaims > 0)
    return { run: true, reason: `${args.newClaims} new claim(s) since the last pass` };
  if (args.newSources > 0)
    return { run: true, reason: `${args.newSources} new source(s) could change existing verdicts` };
  return {
    run: false,
    reason: "every claim already carries a verdict and no new evidence arrived",
  };
}

/**
 * The closing verification pass is only meaningful when something happened
 * after the earlier verification: new web evidence, a rebuilt packet, or
 * claims still lacking a verdict.
 */
export function decideFinalVerify(args: {
  verifyRan: boolean;
  webResearchRan: boolean;
  packetRebuilt: boolean;
  pendingClaims: number;
  forceRefresh?: boolean;
}): GateDecision {
  if (args.forceRefresh) return { run: true, reason: "forced refresh" };
  if (args.pendingClaims > 0)
    return { run: true, reason: `${args.pendingClaims} claim(s) still awaiting a verdict` };
  if (args.webResearchRan) return { run: true, reason: "new web evidence was reconciled this run" };
  if (args.packetRebuilt) return { run: true, reason: "the packet was rebuilt this run" };
  if (args.verifyRan)
    return {
      run: false,
      reason: "verification already ran this run with no new evidence after it",
    };
  return { run: false, reason: "no new evidence entered the story this run" };
}
