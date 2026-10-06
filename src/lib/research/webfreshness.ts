/**
 * Phase 2B — web-research freshness decision (pure, client-safe).
 *
 * Time is a freshness SIGNAL, not the only reason to spend search calls. A
 * recent run is reused unless something genuinely new needs checking, and an
 * expired timer alone does not justify searching when the deterministic data
 * plan does not ask for web evidence.
 */

export type WebFreshnessInput = {
  /** ISO timestamp of the last completed web-research run, or null. */
  lastRunAt: string | null;
  now: string;
  freshnessHours: number;
  /** Plan asks for `news` (web) evidence at all. */
  planWantsWeb: boolean;
  /** RESEARCH_REQUIRED / open gaps created after the last web run. */
  newResearchGaps: number;
  /** Filings, announcements, events or provider rows arriving after the last web run. */
  newMaterialEvents: number;
  /** Critical sources that went stale or became conflicting since the last run. */
  staleCriticalSources: number;
  forceRefresh?: boolean;
};

export type WebFreshnessDecision = { run: boolean; reason: string };

export function decideWebResearch(input: WebFreshnessInput): WebFreshnessDecision {
  if (input.forceRefresh) return { run: true, reason: "forced refresh requested" };

  const ageHours = input.lastRunAt
    ? (Date.parse(input.now) - Date.parse(input.lastRunAt)) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const withinWindow = ageHours < input.freshnessHours;

  const triggers: string[] = [];
  if (input.newResearchGaps > 0) triggers.push(`${input.newResearchGaps} new research gap(s)`);
  if (input.newMaterialEvents > 0)
    triggers.push(`${input.newMaterialEvents} new material event(s)`);
  if (input.staleCriticalSources > 0)
    triggers.push(`${input.staleCriticalSources} critical source(s) stale or conflicting`);

  if (withinWindow) {
    if (triggers.length)
      return {
        run: true,
        reason: `inside the ${input.freshnessHours}h window but ${triggers.join(", ")}`,
      };
    return {
      run: false,
      reason: `last web research ${ageHours.toFixed(1)}h ago and nothing new needs checking`,
    };
  }

  if (!input.planWantsWeb && !triggers.length)
    return {
      run: false,
      reason: "freshness window expired, but the data plan needs no web evidence for this story",
    };

  return {
    run: true,
    reason: input.lastRunAt
      ? `last web research ${ageHours.toFixed(1)}h ago${triggers.length ? ` · ${triggers.join(", ")}` : ""}`
      : "no web research on file for this story",
  };
}
