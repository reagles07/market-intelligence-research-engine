/**
 * Script writing-style profile constants (client-safe).
 *
 * The style layer controls HOW a script is said — never WHAT may be said.
 * It applies to content/script writing only: never to ingestion, claim
 * verification, SEC/IndianAPI processing, web research, research packet
 * building or scenario calculation.
 */

export const DEFAULT_STYLE_PROFILE_SLUG = "spoken_tamil_editorial";
export const DEFAULT_STYLE_PROFILE_ID = "spoken_tamil_editorial_v1";
export const DEFAULT_STYLE_PROFILE_NAME = "Spoken Tamil Editorial";

export type WordBudget = { label: string; low: number; high: number };
export type WordBudgets = Record<string, WordBudget>;

/** Fallback budgets used when the stored profile has none. */
export const FALLBACK_WORD_BUDGETS: WordBudgets = {
  short_30: { label: "30-second Reel", low: 75, high: 95 },
  short_45: { label: "45-second Reel", low: 105, high: 130 },
  short_60: { label: "60-second Reel", low: 135, high: 165 },
  short_90: { label: "90-second Video", low: 190, high: 230 },
};

/** Resolve the word budget for one of the app's Short duration keys. */
export function shortWordBudget(budgets: WordBudgets, key: string): WordBudget {
  const b = { ...FALLBACK_WORD_BUDGETS, ...budgets };
  if (key === "short_30") {
    // The app's "short_30" covers 30–45 seconds, so the band spans both entries.
    const lo = b["short_30"] ?? FALLBACK_WORD_BUDGETS["short_30"]!;
    const hi = b["short_45"] ?? FALLBACK_WORD_BUDGETS["short_45"]!;
    return { label: "30–45 second Reel", low: lo.low, high: hi.high };
  }
  return b[key] ?? FALLBACK_WORD_BUDGETS["short_60"]!;
}

export function formatWordRange(b: { low: number; high: number }): string {
  return `${b.low}–${b.high} words`;
}
