/**
 * Content engine domain constants (client-safe).
 *
 * Phase 1.3D. Everything here describes CONTENT shapes only — the content
 * engine never performs research, it only re-expresses a completed research
 * packet.
 */

export const TARGET_DURATIONS = [
  { key: "quick", label: "Quick Video", minutes: "5–7 minutes", lowSec: 300, highSec: 420 },
  { key: "standard", label: "Standard Video", minutes: "8–10 minutes", lowSec: 480, highSec: 600 },
  { key: "deep_dive", label: "Deep Dive", minutes: "10–13 minutes", lowSec: 600, highSec: 780 },
] as const;
export type TargetDurationKey = (typeof TARGET_DURATIONS)[number]["key"];
export const DEFAULT_TARGET_DURATION: TargetDurationKey = "deep_dive";

export const SHORT_DURATIONS = [
  { key: "short_30", label: "Reel — 30–45 seconds", seconds: 40 },
  { key: "short_45", label: "45-second Reel", seconds: 45 },
  { key: "short_60", label: "60-second Short", seconds: 60 },
  { key: "short_90", label: "90-second Short", seconds: 90 },
] as const;
export type ShortDurationKey = (typeof SHORT_DURATIONS)[number]["key"];
export const DEFAULT_SHORT_DURATION: ShortDurationKey = "short_60";

export const SCRIPT_TONES = ["Analytical", "Conversational", "Curious", "Cautious"] as const;
export type ScriptTone = (typeof SCRIPT_TONES)[number];
export const DEFAULT_TONE: ScriptTone = "Analytical";

/**
 * Long-form chapter plan — STORY-FIRST.
 *
 * The order is deliberate: a verified cold-open story opens a curiosity gap,
 * the host introduces themselves only after the hook has landed, the company
 * is revealed when it becomes natural, and the ending returns to the opening
 * story before the balanced conclusion and the platform-aware CTA.
 * Time ranges are the default Deep Dive plan.
 */
export const LONG_SECTIONS = [
  { key: "cold_open", label: "Cold Open — Verified Story + Curiosity Gap", range: "0:00–0:30" },
  { key: "intro_promise", label: "Self Intro + Retention Promise", range: "0:30–1:00" },
  { key: "layman_story", label: "Layman Story + Obstacle", range: "1:00–2:15" },
  { key: "turning_point", label: "Turning Point + Company Reveal", range: "2:15–3:15" },
  {
    key: "why_it_matters_today",
    label: "Bridge — Why This History Matters Today",
    range: "3:15–4:00",
  },
  { key: "business_model", label: "Business Model", range: "4:00–5:00" },
  { key: "why_now", label: "Why Now — Current Catalyst", range: "5:00–6:00" },
  { key: "numbers", label: "The Numbers", range: "6:00–7:30" },
  { key: "growth_potential", label: "Growth Potential + Runway", range: "7:30–8:30" },
  { key: "competitive_advantage", label: "Competitive Advantage", range: "8:30–9:15" },
  { key: "counterargument_risk", label: "Strongest Counterargument + Risk", range: "9:15–10:15" },
  { key: "valuation", label: "Valuation (if relevant)", range: "10:15–11:00" },
  { key: "market_missing", label: "What The Market May Be Missing", range: "11:00–11:45" },
  { key: "what_to_watch", label: "What To Watch Next", range: "11:45–12:15" },
  { key: "full_circle", label: "Return To The Opening Story", range: "12:15–12:40" },
  { key: "conclusion_cta", label: "Balanced Conclusion + CTA + Disclaimer", range: "12:40–13:00" },
] as const;

export const LONG_SECTION_KEYS = LONG_SECTIONS.map((s) => s.key) as readonly string[];

/**
 * Retention-loop vocabulary. The writer picks the wording that the evidence
 * actually supports — never a hard-coded "5 secrets".
 */
export const RETENTION_DEVICE_LABELS = [
  "clues",
  "signals",
  "turning points",
  "things most people miss",
  "lessons",
  "reasons",
  "growth drivers",
  "decisions",
  "numbers to watch",
  "red flags",
  "hidden strengths",
  "challenges",
  "catalysts",
] as const;

export const SHORT_BEAT_KEYS = [
  "HOOK",
  "CONFLICT",
  "INTRO",
  "TURN",
  "WHY_NOW",
  "OPPORTUNITY_RISK",
] as const;

/**
 * The six distinct Short angles a content pack must cover. They are genuinely
 * different lenses on the same packet — not paraphrases of one another.
 */
export const SHORT_ANGLE_PLAN = [
  {
    key: "unknown_business_story",
    label: "A — Unknown story",
    brief:
      "A surprising but verified piece of company history or business reality, told as story → reveal → why it still matters today.",
  },
  {
    key: "failure_comeback_pivot",
    label: "B — Failure or comeback",
    brief:
      "A documented mistake, crisis, near-failure, pivot or recovery the packet evidences. If no such history is evidenced, substitute another verified distinct angle.",
  },
  {
    key: "underappreciated_fact",
    label: "C — Nobody notices this",
    brief:
      "One genuinely overlooked verified business fact the market conversation is currently ignoring.",
  },
  {
    key: "current_catalyst",
    label: "D — Current catalyst",
    brief: "Why this company is relevant right now, driven by the recent event in the packet.",
  },
  {
    key: "numbers_story",
    label: "E — Numbers story",
    brief:
      "One or two striking verified numbers explained for a layman — what drove them and what they mean.",
  },
  {
    key: "potential_vs_risk",
    label: "F — Potential versus risk",
    brief:
      "The strongest evidenced opportunity set directly against the strongest evidenced counterargument.",
  },
] as const;

export type ShortAngleKey = (typeof SHORT_ANGLE_PLAN)[number]["key"];

/** Legacy free-text angle options kept for the single-Short generator. */
export const SHORT_ANGLES = [
  ...SHORT_ANGLE_PLAN.map((a) => a.label),
  "Why the stock moved",
  "Biggest earnings surprise",
  "Valuation question",
  "Biggest risk",
  "What happens next",
] as const;

/** Distribution platform — decides the CTA vocabulary, nothing else. */
export const PLATFORMS = ["YouTube", "Instagram"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const DEFAULT_PLATFORM: Platform = "YouTube";

/** A content pack is 6+ distinct Shorts plus one long-form script. */
export const CONTENT_PACK_MIN_SHORTS = 6;

export const TITLE_STYLES = [
  "Contrarian",
  "Curiosity",
  "Risk",
  "Expectation Gap",
  "Straight Analysis",
] as const;

/** Hype vocabulary that may never be used as an endorsement in generated copy. */
export const BANNED_HYPE_PHRASES = [
  "guaranteed",
  "must buy",
  "100% return",
  "sure shot",
  "sureshot",
  "next multibagger",
  "multibagger stock",
  "can't lose",
  "risk free",
  "risk-free",
] as const;

// ---------------------------------------------------------------- audit

export const STATEMENT_TYPES = [
  "NUMBER",
  "DATE",
  "PERCENTAGE",
  "PRICE",
  "FINANCIAL METRIC",
  "EVENT",
  "MANAGEMENT STATEMENT",
  "ANALYST OPINION",
  "HISTORICAL ASSERTION",
  "BUSINESS ASSERTION",
  "MARKET REACTION",
  "FORECAST / SCENARIO",
] as const;
export type StatementType = (typeof STATEMENT_TYPES)[number];

export const AUDIT_STATUSES = [
  "SUPPORTED",
  "SUPPORTED_WITH_ATTRIBUTION",
  "NEEDS_QUALIFICATION",
  "CONFLICTING",
  "UNSUPPORTED",
] as const;
export type AuditStatementStatus = (typeof AUDIT_STATUSES)[number];

export const AUDIT_SEVERITIES = ["Blocking", "Warning", "Info"] as const;

export const SCRIPT_AUDIT_STATUSES = ["Not Audited", "PASS", "WARN", "FAIL"] as const;

export const NUMERIC_STATEMENT_TYPES: readonly StatementType[] = [
  "NUMBER",
  "PERCENTAGE",
  "PRICE",
  "FINANCIAL METRIC",
];

/** Words per minute used to estimate spoken duration. */
export const WORDS_PER_MINUTE = 150;

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function estimateSeconds(words: number): number {
  return Math.round((words / WORDS_PER_MINUTE) * 60);
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const RESEARCH_UPDATE_REQUIRED = "Research Update Required";

export const CONTENT_ASSET_KEYS = [
  "long_titles",
  "short_titles",
  "thumbnail_text",
  "yt_description",
  "ig_caption",
  "hashtags",
  "cta",
  "broll_plan",
  "chart_plan",
  "on_screen_text",
  "source_screenshots",
  "short_ideas",
] as const;
