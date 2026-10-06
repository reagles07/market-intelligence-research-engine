/**
 * Multi-stock episode architecture (client-safe, pure).
 *
 * A multi-stock video is NOT a concatenation of single-stock scripts: it is one
 * episode with a central thesis, one verified mini-story per company, and a
 * closing synthesis. Evidence stays strictly per company.
 */

export const MULTI_LONG_SECTIONS = [
  { key: "cold_open", label: "Cold Open — Shared Theme / Question", perCompany: false },
  { key: "intro_promise", label: "Self Intro + Retention Promise", perCompany: false },
  { key: "why_together", label: "Why These Companies Belong Together", perCompany: false },
  { key: "company_block", label: "Company Segment", perCompany: true },
  { key: "transition", label: "Transition / Contrast", perCompany: true },
  {
    key: "synthesis",
    label: "Synthesis — Differences, Common Driver, What To Watch",
    perCompany: false,
  },
  { key: "full_circle", label: "Return To The Opening Question", perCompany: false },
  { key: "conclusion_cta", label: "Balanced Conclusion + CTA + Disclaimer", perCompany: false },
] as const;

export const MULTI_LONG_SECTION_KEYS = MULTI_LONG_SECTIONS.map((s) => s.key) as readonly string[];

/** Sections that must appear exactly once in every multi-stock episode. */
export const MULTI_REQUIRED_SECTIONS = MULTI_LONG_SECTIONS.filter((s) => !s.perCompany).map(
  (s) => s.key,
) as readonly string[];

/** The beats every company segment must cover, in order. */
export const COMPANY_SEGMENT_BEATS = [
  "mini story or problem",
  "turning point or reveal",
  "what it does and how it makes money",
  "current catalyst",
  "key numbers explained for a layman",
  "the evidenced opportunity",
  "the strongest evidenced risk",
] as const;

/** Story angles preferred when picking one mini-story per company. */
export const MULTI_STORY_ANGLES = [
  "unknown business history",
  "failure, comeback or pivot",
  "competitive battle",
  "current catalyst",
  "business-model contrast",
  "growth-driver contrast",
  "risk contrast",
  "present-day business mystery or contradiction",
] as const;

/**
 * The evidence contract spoken to the writer. It is the multi-stock analogue of
 * the single-stock packet rule: each company's facts are sealed to that company.
 */
export const MULTI_EVIDENCE_CONTRACT = `MULTI-STOCK EVIDENCE CONTRACT (this outranks every storytelling instruction):
- Each company has its OWN research context block with its own claim ids, source ids,
  research section ids and metric keys. A fact may only be spoken about the company whose
  block it came from.
- NEVER use one company's evidence to fill another company's gap, and never move a metric,
  a date, a quote or a number from one block to another.
- When two companies report the same metric for different periods or in different
  currencies, say the period and the currency out loud for each. Never convert.
- If an apples-to-apples comparison is not possible from the evidence, say the comparison
  is not like-for-like in plain viewer language and compare only what the evidence supports.
  Never manufacture false equivalence.
- Every company_block section must carry the company_id it belongs to and only that
  company's evidence ids.
- Do not rank the companies unless the creator instruction explicitly asks for a ranking.
- No buy or sell calls, no price targets, no guaranteed returns.`;

/** The combined-Short contract: one shared hook, one clean point per company. */
export const COMBINED_SHORT_CONTRACT = `COMBINED SHORT STRUCTURE (about 60 seconds):
- HOOK: one shared hook that covers all the selected companies at once.
- CONFLICT: why these stocks are connected right now — the shared question or tension.
- INTRO: the mini self intro, kept to one short line.
- TURN: ONE clean comparison or contrast point per company, each with its own evidence.
- WHY_NOW: the strongest shared piece of current evidence.
- OPPORTUNITY_RISK: the single strongest caveat across the set.
Keep it simple enough for a 60-second viewer: one idea per sentence, no metric dumps, and
never move a number from one company to another.`;

/** Long-form narrative mode instruction, kept short and prompt-safe. */
export function longformModeInstruction(mode: string, allowRanking: boolean): string {
  const base: Record<string, string> = {
    roundup:
      "NARRATIVE MODE: ROUNDUP — one shared theme, each company a chapter inside that theme.",
    comparison:
      "NARRATIVE MODE: COMPARISON — the episode is built around how these companies differ on the same question.",
    theme:
      "NARRATIVE MODE: THEME — a single verified idea or force drives the episode and each company is evidence for it.",
    custom:
      "NARRATIVE MODE: CUSTOM — follow the creator instruction for structure, keeping the required sections.",
  };
  return `${base[mode] ?? base["roundup"]}\n${
    allowRanking
      ? "The creator explicitly asked for a ranking, so ranking is allowed and must be justified by evidence."
      : "Do NOT rank or score the companies against each other."
  }`;
}
