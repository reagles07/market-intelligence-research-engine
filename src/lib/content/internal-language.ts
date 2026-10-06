/**
 * Internal-tooling language detector for spoken script text (browser-safe).
 *
 * The voiceover speaks to a retail viewer. It must NEVER narrate how this
 * studio works: research packets, source ids, readiness gates, PDFs that would
 * not open, or a chapter that repeats "insufficient data". Those belong in the
 * creator UI and in blocked reasons, never in an audio track.
 *
 * Deterministic and free — no model call. Used as a post-generation scan.
 */

export type InternalLanguageHit = {
  phrase: string;
  excerpt: string;
};

export type InternalLanguageScan = {
  clean: boolean;
  hits: InternalLanguageHit[];
};

/** Phrases that are always internal tooling language when spoken. */
const BANNED_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "research packet", re: /\bresearch\s+packets?\b/i },
  { label: "packet version", re: /\bpackets?\s*(v\d+|version)\b/i },
  { label: "packet", re: /\bthe\s+packet\b/i },
  { label: "source id", re: /\bsource[_\s-]?ids?\b/i },
  { label: "claim id", re: /\bclaim[_\s-]?ids?\b/i },
  { label: "evidence id", re: /\bevidence[_\s-]?ids?\b/i },
  { label: "metric key", re: /\bmetric[_\s-]?keys?\b/i },
  { label: "orchestration", re: /\borchestrat(ion|or)\b/i },
  { label: "readiness gate", re: /\breadiness\s+(gate|score|status)\b/i },
  { label: "verification score", re: /\bverification\s+score\b/i },
  { label: "our research system", re: /\bour\s+research\s+(system|engine|tool|database)\b/i },
  {
    label: "could not fetch the PDF",
    re: /\b(could|couldn'?t|can'?t|unable to)\s+\w*\s*(fetch|open|read|download)\b[^.]{0,40}\b(pdf|file|document|filing)\b/i,
  },
  {
    label: "the research does not contain",
    re: /\b(packet|research|data(set)?|records?)\b[^.]{0,30}\b(does not|doesn'?t|do not|don'?t)\s+(contain|include|have|cover)\b/i,
  },
  { label: "insufficient data", re: /\binsufficient\s+data\b/i },
  {
    label: "not available in our data",
    re: /\bnot\s+available\s+in\s+(our|the)\s+(data|research|records|database)\b/i,
  },
  { label: "research update required", re: /\bresearch\s+update\s+required\b/i },
  {
    label: "fact check / audit tooling",
    re: /\b(fact[-\s]?check\s+(run|pass|audit)|script\s+audit|audit\s+status)\b/i,
  },
  { label: "extracted data", re: /\b(missing|no)\s+extracted\s+data\b/i },
];

const excerptAround = (text: string, index: number, length: number): string => {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
};

/** Scan spoken text for internal tooling language. */
export function scanInternalLanguage(text: string): InternalLanguageScan {
  const hits: InternalLanguageHit[] = [];
  const seen = new Set<string>();
  for (const { label, re } of BANNED_PATTERNS) {
    const m = re.exec(text);
    if (!m || seen.has(label)) continue;
    seen.add(label);
    hits.push({ phrase: label, excerpt: excerptAround(text, m.index, m[0].length) });
  }
  return { clean: hits.length === 0, hits };
}

/** Repair instruction naming exactly what must go, without loosening evidence rules. */
export function internalLanguageRepairNote(hits: readonly InternalLanguageHit[]): string {
  return [
    "INTERNAL-LANGUAGE REPAIR PASS (one pass only).",
    "The previous draft spoke about this studio's internal tooling. A viewer must never hear it.",
    "Remove or rewrite every one of these, keeping every fact, attribution, hedge and evidence id unchanged:",
    ...hits.map((h) => `- "${h.phrase}" → ${h.excerpt}`),
    "",
    "Rules for the rewrite:",
    "- Never mention research packets, packet versions, source/claim/evidence ids, readiness,",
    "  verification scores, orchestration, audits, or any document this studio could not open.",
    "- If a fact is genuinely not available, simply DO NOT discuss that angle. Do not narrate the",
    '  absence, and never speak the words "insufficient data".',
    "- Do not add any new fact, number, date, source or opinion to fill the removed text.",
    "- A short educational disclaimer at the end stays; internal tooling language does not.",
  ].join("\n");
}

/** The prompt clause that bans this language up front, used by every script prompt. */
export const NO_INTERNAL_LANGUAGE_RULE = `NEVER SPEAK INTERNAL TOOLING LANGUAGE (hard rule):
- The voiceover must never mention a research packet, packet version, source id, claim id,
  evidence id, metric key, orchestration, a readiness gate, a verification score, an audit,
  "our research system", or a document/PDF that could not be fetched or opened.
- Never narrate a research failure and never speak the phrase "insufficient data". If an angle
  is not supported by the evidence you have, silently drop that angle and write the chapters
  the evidence does support; if too little is supported for an honest script, set
  research_update_required instead of talking about what is missing.
- A short educational disclaimer at the end is fine. Internal workflow language is not.`;

// -------------------------------------------------- missing-data dominance

/**
 * Phrases that narrate an absence of information rather than the company.
 * A script may hedge once; a script that keeps returning to "we could not
 * verify" has turned an evidence gap into its storyline, which is exactly the
 * failure mode the APOLLOHOSP draft showed.
 */
const MISSING_DATA_PATTERNS: RegExp[] = [
  /\bnot\s+available\b/gi,
  /\bunavailable\b/gi,
  /\b(could|couldn'?t|can'?t|cannot|unable to)\s+\w{0,12}\s*verif\w*/gi,
  /\bnot\s+verified\b/gi,
  /\bunverified\b/gi,
  /\binsufficient\s+data\b/gi,
  /\bno\s+(reliable|confirmed|current)\s+(data|numbers?|figures?)\b/gi,
  /\bdata\s+(is\s+)?missing\b/gi,
  /\bmissing\s+(data|numbers?|figures?|information)\b/gi,
  /\bkidaikkala\b/gi,
  /\bdetriyala\b/gi,
];

export type MissingDataDominance = {
  /** Number of missing-data mentions in the spoken text. */
  mentions: number;
  /** Mentions per 100 spoken words. */
  density: number;
  words: number;
  /** True when absence-of-data has become the storyline. */
  dominated: boolean;
  examples: string[];
};

/** Allowed: one honest hedge. Not allowed: a script built out of hedges. */
export const MISSING_DATA_MAX_MENTIONS = 3;
export const MISSING_DATA_MAX_DENSITY = 0.6; // per 100 words

export function detectMissingDataDominance(text: string): MissingDataDominance {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const examples: string[] = [];
  let mentions = 0;
  for (const re of MISSING_DATA_PATTERNS) {
    const found = text.match(re);
    if (!found) continue;
    mentions += found.length;
    if (examples.length < 6) examples.push(found[0]!.trim());
  }
  const density = words ? (mentions / words) * 100 : 0;
  return {
    mentions,
    density: Number(density.toFixed(2)),
    words,
    dominated: mentions > MISSING_DATA_MAX_MENTIONS && density > MISSING_DATA_MAX_DENSITY,
    examples,
  };
}

export type ScriptLanguageQuality = {
  ok: boolean;
  internal: InternalLanguageScan;
  missingData: MissingDataDominance;
  /** What the caller should do next. */
  action: "accept" | "repair" | "research_update_required";
  reason: string;
};

/**
 * The deterministic language quality gate that runs before a script is saved.
 * It never repairs facts: it either accepts, asks for ONE wording-only repair
 * pass, or hands the script back as research_update_required.
 */
export function evaluateScriptLanguageQuality(
  text: string,
  opts?: { repairAlreadyAttempted?: boolean },
): ScriptLanguageQuality {
  const internal = scanInternalLanguage(text);
  const missingData = detectMissingDataDominance(text);
  const ok = internal.clean && !missingData.dominated;
  if (ok) {
    return { ok: true, internal, missingData, action: "accept", reason: "" };
  }
  const reasons = [
    internal.clean
      ? ""
      : `spoken text uses internal tooling language (${internal.hits.map((h) => h.phrase).join(", ")})`,
    missingData.dominated
      ? `spoken text is dominated by missing-data commentary (${missingData.mentions} mentions, ${missingData.density} per 100 words)`
      : "",
  ].filter(Boolean);
  // Missing-data dominance after a repair attempt is a research problem, not a
  // wording problem: there is genuinely not enough material for this script.
  const action: ScriptLanguageQuality["action"] =
    opts?.repairAlreadyAttempted && missingData.dominated ? "research_update_required" : "repair";
  return { ok: false, internal, missingData, action, reason: reasons.join("; ") };
}

/** Repair instruction for a draft whose storyline became the missing evidence. */
export function missingDataRepairNote(d: MissingDataDominance): string {
  return [
    "MISSING-DATA FRAMING REPAIR PASS (one pass only).",
    `The previous draft mentions absent information ${d.mentions} times. A viewer came for the`,
    "company, not for a tour of what we could not confirm.",
    "Rewrite so that at most ONE brief, natural hedge remains, and only where it is genuinely",
    "needed. Everywhere else: simply drop the unsupported angle and spend those seconds on",
    "business, history, numbers, drivers or risk that the evidence DOES support.",
    "You may not add a single new fact, number, date, source or opinion to fill the space.",
    "Keep every evidence id, attribution and required hedge on the facts that remain.",
  ].join("\n");
}
