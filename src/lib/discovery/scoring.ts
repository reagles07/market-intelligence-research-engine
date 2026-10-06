/**
 * Content Opportunity Score — Stage 1 (deterministic, browser-safe).
 *
 * This score measures how good a STORY this is for the editorial workspace content.
 * It is not a buy score, an investment score, a quality score or a return
 * forecast, and it must never be presented as one.
 *
 * Rule that outranks every other rule here: a missing input stays missing.
 * We never manufacture a price move or a volume ratio to fill a component —
 * the component is marked unavailable, the reason is recorded, and score
 * coverage falls accordingly.
 */
import { SOURCE_TIERS } from "@/lib/domain";
import {
  CATALYST_STRENGTH,
  DISCOVERY_SCORE_COMPONENTS,
  bandForScore,
  type CandidateType,
} from "@/lib/discovery/domain";
import type { CandidateDraft } from "@/lib/discovery/cluster";

export type ScoreComponentResult = {
  key: string;
  label: string;
  max: number;
  points: number;
  available: boolean;
  reason: string;
  valueText: string | null;
  stage: "DETERMINISTIC" | "AI";
};

export type ScoredCandidate = {
  components: ScoreComponentResult[];
  total: number;
  coveragePct: number;
  band: string;
};

export type ScoringContext = {
  /** Company row facts, when the company is already in our universe. */
  knownCompany: boolean;
  marketCap: number | null;
  primaryIndex: string | null;
  onWatchlist: boolean;
  existingStoryCount: number;
  /** Stories on the same company inside the novelty window. */
  recentStories: Array<{ title: string; story_type: string | null; created_at: string }>;
  /** Scripts written for this company recently — already-covered ground. */
  recentScriptCount: number;
};

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n * 10) / 10));
const maxOf = (key: string) => DISCOVERY_SCORE_COMPONENTS.find((c) => c.key === key)!.max;
const labelOf = (key: string) => DISCOVERY_SCORE_COMPONENTS.find((c) => c.key === key)!.label;

const tierRank = (tier: string | null): number => {
  const index = SOURCE_TIERS.indexOf(tier as (typeof SOURCE_TIERS)[number]);
  return index === -1 ? 3 : index;
};

export function bestTier(candidate: CandidateDraft): string | null {
  const tiers = candidate.signals.map((s) => s.sourceTier).filter(Boolean);
  if (!tiers.length) return null;
  return tiers.sort((a, b) => tierRank(a) - tierRank(b))[0]!;
}

// ---------------------------------------------------------------- components

function catalystComponent(candidate: CandidateDraft): ScoreComponentResult {
  const strengths = candidate.candidateTypes.map((t) => CATALYST_STRENGTH[t] ?? 4);
  const best = Math.max(...strengths, 0);
  // A second, independent catalyst type adds a little materiality.
  const extra = Math.min(2, Math.max(0, candidate.candidateTypes.length - 1));
  return {
    key: "catalyst_importance",
    label: labelOf("catalyst_importance"),
    max: maxOf("catalyst_importance"),
    points: clamp(best + extra, maxOf("catalyst_importance")),
    available: true,
    reason: `Strongest catalyst: ${candidate.primaryType}.`,
    valueText: candidate.candidateTypes.join(", "),
    stage: "DETERMINISTIC",
  };
}

function priceMoveComponent(candidate: CandidateDraft): ScoreComponentResult {
  const max = maxOf("price_movement");
  const move = candidate.priceMovePct;
  if (typeof move !== "number" || !Number.isFinite(move)) {
    return {
      key: "price_movement",
      label: labelOf("price_movement"),
      max,
      points: 0,
      available: false,
      reason:
        candidate.reportedPriceMovePct !== null
          ? `No market-data provider covers this market yet. A source reported ${candidate.reportedPriceMovePct}% but a reported figure is not measured market data, so it is recorded and not scored.`
          : "No provider price move was returned for this candidate.",
      valueText: null,
      stage: "DETERMINISTIC",
    };
  }
  const abs = Math.abs(move);
  const points = abs >= 10 ? 15 : abs >= 7 ? 13 : abs >= 5 ? 11 : abs >= 3 ? 8 : abs >= 1.5 ? 5 : 2;
  return {
    key: "price_movement",
    label: labelOf("price_movement"),
    max,
    points: clamp(points, max),
    available: true,
    reason: `Provider-measured daily move of ${move}%${candidate.priceMoveSource ? ` (${candidate.priceMoveSource})` : ""}.`,
    valueText: `${move}%`,
    stage: "DETERMINISTIC",
  };
}

function volumeComponent(candidate: CandidateDraft): ScoreComponentResult {
  const max = maxOf("unusual_volume");
  const ratio = candidate.volumeRatio;
  if (typeof ratio === "number" && Number.isFinite(ratio)) {
    const points = ratio >= 3 ? 15 : ratio >= 2 ? 13 : ratio >= 1.5 ? 10 : ratio >= 1.2 ? 7 : 3;
    return {
      key: "unusual_volume",
      label: labelOf("unusual_volume"),
      max,
      points: clamp(points, max),
      available: true,
      reason: `Volume ratio ${ratio.toFixed(2)}x versus its average.`,
      valueText: `${ratio.toFixed(2)}x`,
      stage: "DETERMINISTIC",
    };
  }

  const activeSignals = candidate.signals.filter(
    (s) => s.signalType === "UNUSUAL_VOLUME" || /most_active/i.test(s.endpoint ?? ""),
  );
  if (activeSignals.length) {
    // A "Most Active" listing is evidence of activity but not a measurement.
    const points = Math.min(6, 3 + activeSignals.length);
    return {
      key: "unusual_volume",
      label: labelOf("unusual_volume"),
      max,
      points: clamp(points, max),
      available: true,
      reason:
        "Appeared in a most-active listing. No volume ratio was returned, so this is limited evidence and is capped well below the full weight.",
      valueText: candidate.volume ? `volume ${candidate.volume}` : "most-active listing",
      stage: "DETERMINISTIC",
    };
  }

  return {
    key: "unusual_volume",
    label: labelOf("unusual_volume"),
    max,
    points: 0,
    available: false,
    reason: "No volume ratio and no activity listing available for this candidate.",
    valueText: null,
    stage: "DETERMINISTIC",
  };
}

function audienceComponent(candidate: CandidateDraft, ctx: ScoringContext): ScoreComponentResult {
  const max = maxOf("audience_interest");
  const trending = candidate.signals.some((s) => s.signalType === "TRENDING");
  const extraSignals = Math.max(0, candidate.signalCount - 1);
  const notes: string[] = [];
  let points = 3;
  if (trending) {
    points += 3;
    notes.push("appears in the trending feed");
  }
  if (ctx.onWatchlist) {
    points += 3;
    notes.push("on a watchlist");
  }
  if (extraSignals) {
    points += Math.min(6, extraSignals * 2);
    notes.push(`${candidate.signalCount} independent discovery signals`);
  }
  if (candidate.headline) {
    points += 2;
    notes.push("carries a news headline");
  }
  return {
    key: "audience_interest",
    label: labelOf("audience_interest"),
    max,
    points: clamp(points, max),
    available: true,
    reason: notes.length
      ? `Interest signals: ${notes.join(", ")}.`
      : "Single discovery signal, no watchlist or trending presence.",
    valueText: `${candidate.signalCount} signal(s)`,
    stage: "DETERMINISTIC",
  };
}

function reliabilityComponent(candidate: CandidateDraft): ScoreComponentResult {
  const max = maxOf("source_reliability");
  const tier = bestTier(candidate);
  if (!tier) {
    return {
      key: "source_reliability",
      label: labelOf("source_reliability"),
      max,
      points: 0,
      available: false,
      reason: "No source tier could be established for this candidate.",
      valueText: null,
      stage: "DETERMINISTIC",
    };
  }
  const rank = tierRank(tier);
  const points = [15, 11, 7, 3][rank] ?? 3;
  const tier2Count = candidate.signals.filter((s) => tierRank(s.sourceTier) === 1).length;
  return {
    key: "source_reliability",
    label: labelOf("source_reliability"),
    max,
    points: clamp(points, max),
    available: true,
    // Volume of secondary reporting never promotes evidence to primary.
    reason: `Best available source: ${tier}.${rank > 0 && tier2Count > 1 ? ` ${tier2Count} secondary reports do not substitute for a primary source.` : ""}`,
    valueText: tier,
    stage: "DETERMINISTIC",
  };
}

function popularityComponent(ctx: ScoringContext): ScoreComponentResult {
  const max = maxOf("company_popularity");
  const hasAnything =
    ctx.knownCompany &&
    (ctx.marketCap !== null ||
      ctx.primaryIndex !== null ||
      ctx.onWatchlist ||
      ctx.existingStoryCount > 0);
  if (!hasAnything) {
    return {
      key: "company_popularity",
      label: labelOf("company_popularity"),
      max,
      points: 0,
      available: false,
      reason:
        "The company is not in our universe yet, so index membership, size and coverage history are unknown. This is audience relevance only — it says nothing about the company's financial quality.",
      valueText: null,
      stage: "DETERMINISTIC",
    };
  }
  let points = 2;
  const notes: string[] = [];
  if (ctx.primaryIndex) {
    points += 3;
    notes.push(`index member (${ctx.primaryIndex})`);
  }
  if (ctx.marketCap !== null) {
    const cap = ctx.marketCap;
    const capPoints = cap >= 5_000_000 ? 3 : cap >= 500_000 ? 2 : 1;
    points += capPoints;
    notes.push("size known");
  }
  if (ctx.onWatchlist) {
    points += 2;
    notes.push("watchlist member");
  }
  if (ctx.existingStoryCount > 0) {
    points += 1;
    notes.push(`${ctx.existingStoryCount} existing stories`);
  }
  return {
    key: "company_popularity",
    label: labelOf("company_popularity"),
    max,
    points: clamp(points, max),
    available: true,
    reason: `Audience relevance only, not financial quality: ${notes.join(", ")}.`,
    valueText: notes.join(", "),
    stage: "DETERMINISTIC",
  };
}

function noveltyComponent(candidate: CandidateDraft, ctx: ScoringContext): ScoreComponentResult {
  const max = maxOf("story_novelty");
  const now = Date.now();
  const days = (iso: string) => (now - new Date(iso).getTime()) / 86_400_000;
  const recent = ctx.recentStories.filter((s) => days(s.created_at) <= 14);
  if (!recent.length) {
    return {
      key: "story_novelty",
      label: labelOf("story_novelty"),
      max,
      points: max,
      available: true,
      reason: "No story on this company in the last 14 days.",
      valueText: "new ground",
      stage: "DETERMINISTIC",
    };
  }
  const sameFamily = recent.filter((s) =>
    (s.story_type ?? "").toLowerCase().includes(candidate.primaryType.split("_")[0]!.toLowerCase()),
  );
  const veryRecent = recent.filter((s) => days(s.created_at) <= 3);
  let points = 3;
  if (sameFamily.length && veryRecent.length) points = 1;
  else if (sameFamily.length || veryRecent.length) points = 2;
  if (ctx.recentScriptCount > 0 && veryRecent.length) points = Math.min(points, 1);
  return {
    key: "story_novelty",
    label: labelOf("story_novelty"),
    max,
    points: clamp(points, max),
    available: true,
    reason: `${recent.length} story/stories on this company in the last 14 days${ctx.recentScriptCount ? `, ${ctx.recentScriptCount} recent script(s)` : ""}. Semantic closeness is refined in the AI pass.`,
    valueText: `${recent.length} recent`,
    stage: "DETERMINISTIC",
  };
}

/** Storytelling needs judgement, so Stage 1 leaves it unscored and unavailable. */
function storytellingPlaceholder(): ScoreComponentResult {
  return {
    key: "storytelling_potential",
    label: labelOf("storytelling_potential"),
    max: maxOf("storytelling_potential"),
    points: 0,
    available: false,
    reason: "Awaiting the lightweight AI evaluation, which only runs for top candidates.",
    valueText: null,
    stage: "AI",
  };
}

// ---------------------------------------------------------------- assembly

export function preScore(candidate: CandidateDraft, ctx: ScoringContext): ScoredCandidate {
  const components = [
    catalystComponent(candidate),
    priceMoveComponent(candidate),
    volumeComponent(candidate),
    audienceComponent(candidate, ctx),
    reliabilityComponent(candidate),
    popularityComponent(ctx),
    noveltyComponent(candidate, ctx),
    storytellingPlaceholder(),
  ];
  return summarise(components);
}

export function summarise(components: ScoreComponentResult[]): ScoredCandidate {
  const total = components.reduce((sum, c) => sum + (c.available ? c.points : 0), 0);
  const availableWeight = components.reduce((sum, c) => sum + (c.available ? c.max : 0), 0);
  const totalWeight = components.reduce((sum, c) => sum + c.max, 0);
  const rounded = Math.round(total * 10) / 10;
  return {
    components,
    total: rounded,
    coveragePct: Math.round((availableWeight / totalWeight) * 100),
    band: bandForScore(rounded),
  };
}

/** Applied after the Stage 2 AI pass. Adjustments are bounded on purpose. */
export function applyEvaluation(
  components: ScoreComponentResult[],
  evaluation: {
    storytelling: number;
    storytellingReason: string;
    noveltyAdjust: number;
    audienceAdjust: number;
    catalystAdjust: number;
    notes: string;
  },
): ScoredCandidate {
  const next = components.map((c) => ({ ...c }));
  const find = (key: string) => next.find((c) => c.key === key)!;

  const story = find("storytelling_potential");
  story.points = clamp(evaluation.storytelling, story.max);
  story.available = true;
  story.reason = evaluation.storytellingReason;
  story.stage = "AI";

  const adjust = (key: string, delta: number, limit: number) => {
    const c = find(key);
    if (!c.available || !delta) return;
    const bounded = Math.max(-limit, Math.min(limit, delta));
    c.points = clamp(c.points + bounded, c.max);
    c.reason = `${c.reason} AI adjustment ${bounded > 0 ? "+" : ""}${bounded}: ${evaluation.notes}`;
    c.stage = "AI";
  };
  adjust("story_novelty", evaluation.noveltyAdjust, 2);
  adjust("audience_interest", evaluation.audienceAdjust, 2);
  adjust("catalyst_importance", evaluation.catalystAdjust, 3);

  return summarise(next);
}

export type { CandidateType };
