/**
 * Script writing-style profiles (server only).
 *
 * A style profile is stored configuration, not hardcoded prompt text scattered
 * across server functions. It is composed into script-generation requests ONLY.
 * Prompt precedence is enforced here:
 *   LEVEL 1 factual authority → LEVEL 2 safety/claim rules → LEVEL 3 brand
 *   voice → LEVEL 4 content format.
 */
import {
  DEFAULT_STYLE_PROFILE_SLUG,
  FALLBACK_WORD_BUDGETS,
  type WordBudgets,
} from "@/lib/content/style";
import { CONTENT_MODE_RULES, LANGUAGE_RULES, type Db } from "@/lib/ai/script-context.server";
import { NO_INTERNAL_LANGUAGE_RULE } from "@/lib/content/internal-language";
import { JARGON_EXPLANATION_CONTRACT, LAYMAN_VOICE_CONTRACT } from "@/lib/content/layman-voice";

export type StyleProfile = {
  id: string;
  slug: string;
  name: string;
  version: number;
  languageStyle: string;
  promptText: string;
  checklist: string | null;
  wordBudgets: WordBudgets;
};

function toProfile(row: Record<string, unknown>): StyleProfile {
  const budgets = (row["word_count_defaults"] ?? {}) as WordBudgets;
  return {
    id: String(row["id"]),
    slug: String(row["slug"]),
    name: String(row["name"]),
    version: Number(row["version"] ?? 1),
    languageStyle: String(row["language_style"] ?? ""),
    promptText: String(row["prompt_text"] ?? ""),
    checklist: (row["style_checklist"] as string | null) ?? null,
    wordBudgets: { ...FALLBACK_WORD_BUDGETS, ...budgets },
  };
}

/**
 * Load the style profile to write with. Falls back to the active default
 * profile so callers never have to pass anything.
 */
export async function loadStyleProfile(
  db: Db,
  profileId?: string | null,
): Promise<StyleProfile | null> {
  if (profileId) {
    const { data } = await db
      .from("script_style_profiles")
      .select("*")
      .eq("id", profileId)
      .maybeSingle();
    if (data) return toProfile(data as unknown as Record<string, unknown>);
  }

  const { data: def } = await db
    .from("script_style_profiles")
    .select("*")
    .eq("is_active", true)
    .eq("is_default", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (def) return toProfile(def as unknown as Record<string, unknown>);

  const { data: fallback } = await db
    .from("script_style_profiles")
    .select("*")
    .eq("slug", DEFAULT_STYLE_PROFILE_SLUG)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return fallback ? toProfile(fallback as unknown as Record<string, unknown>) : null;
}

const PRECEDENCE_HEADER = `PROMPT PRECEDENCE — read this before anything else.
LEVEL 1 FACTUAL AUTHORITY: the research packet, verified claims, sources, metrics and
scenarios decide WHAT may be said. Nothing below may override them.
LEVEL 2 SAFETY / CLAIM RULES: decide HOW certainty and attribution are expressed.
LEVEL 3 BRAND VOICE: decides only language, spoken style, personality and transitions.
LEVEL 4 CONTENT FORMAT: decides length, hook structure, section count and CTA.
A lower level may never add a fact, soften a required attribution, or drop a hedge to make
the writing flow better. Storytelling never outranks evidence.`;

/**
 * Compose the full system instruction for one script-generation call, in
 * precedence order. `formatBlock` is the LEVEL 4 task description.
 */
export function composeScriptInstructions(args: {
  language: string;
  profile: StyleProfile | null;
  formatBlock: string;
}): string {
  const languageRule = LANGUAGE_RULES[args.language] ?? LANGUAGE_RULES["English"];
  const parts = [
    PRECEDENCE_HEADER,
    "",
    "===== LEVEL 1 + LEVEL 2 — FACTUAL AUTHORITY AND SAFETY RULES =====",
    CONTENT_MODE_RULES,
    "",
    NO_INTERNAL_LANGUAGE_RULE,
    "",
    "===== LEVEL 2B — AUDIENCE COMPREHENSION =====",
    LAYMAN_VOICE_CONTRACT,
    "",
    JARGON_EXPLANATION_CONTRACT,
    "",
    "===== LEVEL 3 — BRAND VOICE =====",
    languageRule ?? "",
  ];

  if (args.profile) {
    parts.push(
      "",
      `STYLE PROFILE: ${args.profile.name} (${args.profile.slug} v${args.profile.version})`,
      `LANGUAGE STYLE: ${args.profile.languageStyle}`,
      "",
      args.profile.promptText,
    );
    if (args.profile.checklist) parts.push("", args.profile.checklist);
  }

  parts.push("", "===== LEVEL 4 — CONTENT FORMAT =====", args.formatBlock);
  return parts.join("\n");
}

/** The compression instruction used when a script overshoots its word budget. */
/**
 * Safe interior target inside a word band. Aiming at the bound itself makes the
 * model land just outside it; aiming ~10 words inside leaves tolerance for
 * tokenisation differences between the model's counting and ours.
 */
export function interiorTarget(target: { low: number; high: number }): {
  low: number;
  high: number;
} {
  const pad = Math.min(10, Math.max(0, Math.floor((target.high - target.low) / 3)));
  const low = target.low + pad;
  const high = target.high - pad;
  return low < high ? { low, high } : target;
}

export function compressionInstruction(target: { low: number; high: number }, actual: number) {
  return `COMPRESSION PASS. The previous draft is ${actual} words, over the target band of
${target.low}–${target.high} words. Rewrite it shorter using ONLY the evidence already used
in that draft. You may not introduce any new fact, number, source, claim or scenario, and
you may not drop a required attribution or hedge. Cut filler, repeated connectors and
redundant restatement first. Keep the same angle, structure, evidence ids and language.
The result must land INSIDE ${target.low}–${target.high} words — not below ${target.low}.
AIM for ${interiorTarget(target).low}–${interiorTarget(target).high} words, not for the bound itself.`;
}

/**
 * The expansion instruction used when a script undershoots its word budget.
 * The floor is a real constraint: a 60-second Short that runs 126 words is as
 * wrong as one that runs 303. Expansion may only elaborate evidence that is
 * already in the draft or in the packet — never new facts.
 */
export function expansionInstruction(target: { low: number; high: number }, actual: number) {
  return `EXPANSION PASS. The previous draft is ${actual} words, UNDER the target band of
${target.low}–${target.high} words, so the delivered video would be too short. Rewrite it
longer WITHOUT adding a single new fact, number, date, source, claim, scenario or opinion.
Permitted ways to add words:
- spell out an evidence-backed figure the draft already cites in compressed form,
- state the attribution or period that a cited figure already carries in the packet,
- add the qualification/hedge that an inference needs ("indha reaction-a paathaa … nu
  therigiradhu" style), which is required anyway,
- expand the hook or the CTA in spoken register without asserting anything new.
Prohibited: filler repetition, restating the same sentence twice, padding adjectives,
speculation, or any figure that is not already evidenced. Keep the same angle, structure,
evidence ids and language. The result must land INSIDE ${target.low}–${target.high} words, and you
should AIM for ${interiorTarget(target).low}–${interiorTarget(target).high} words so small counting
differences cannot push it back under the floor. Do NOT reach the target with generic filler
("so guys", "overall-a paatha", "important point ennana") or by repeating a point already made —
every added clause must carry supported information or a required attribution/hedge.`;
}
