/**
 * Research completion — honest display logic (pure, client-safe).
 *
 * The workspace used to call research "100% complete" as soon as every
 * section contained *text*, even when most of that text literally said
 * "Insufficient Data". Two different questions must be answered separately:
 *
 *   1. Sections written  — how much of the template the writer filled in.
 *   2. Research completeness — the canonical packet completion_pct /
 *      verification_score produced by the research engine.
 *
 * Only (2) may ever be described as "research complete".
 */

/** Phrases that mean "this section documents an evidence gap", not research. */
const INSUFFICIENT_MARKERS = [
  "insufficient data",
  "not available in the supplied context",
  "no data available",
  "no structured data",
];

export type SectionLike = { section_key: string; content: string | null };

/** A section counts as written when it holds any non-whitespace text. */
export function isWritten(content: string | null | undefined): boolean {
  return (content ?? "").trim().length > 0;
}

/**
 * A section is substantive when it actually carries research rather than an
 * evidence-gap note. A leading "Insufficient Data" marker is decisive.
 */
export function isSubstantive(content: string | null | undefined): boolean {
  const text = (content ?? "").trim();
  if (text.length === 0) return false;
  const lower = text.toLowerCase();
  if (INSUFFICIENT_MARKERS.some((m) => lower.startsWith(m))) return false;
  // A short body that is mostly an evidence-gap note is not research either.
  if (text.length < 120 && INSUFFICIENT_MARKERS.some((m) => lower.includes(m))) return false;
  return true;
}

export type SectionCoverage = {
  total: number;
  written: number;
  substantive: number;
  insufficient: number;
  writtenPct: number;
  substantivePct: number;
};

export function sectionCoverage(
  sections: readonly SectionLike[],
  allKeys: readonly string[],
): SectionCoverage {
  const byKey = new Map(sections.map((s) => [s.section_key, s.content] as const));
  const total = allKeys.length;
  let written = 0;
  let substantive = 0;
  for (const key of allKeys) {
    const content = byKey.get(key) ?? null;
    if (isWritten(content)) written += 1;
    if (isSubstantive(content)) substantive += 1;
  }
  return {
    total,
    written,
    substantive,
    insufficient: written - substantive,
    writtenPct: total ? Math.round((written / total) * 100) : 0,
    substantivePct: total ? Math.round((substantive / total) * 100) : 0,
  };
}

export type ResearchCompleteness = {
  /** Canonical packet completion — never derived from "sections written". */
  completionPct: number;
  verificationScore: number;
  readiness: string | null;
  label: string;
  tone: "default" | "warn" | "good" | "bad";
  /** Never true unless the canonical number really is 100. */
  isComplete: boolean;
  explanation: string;
};

export function researchCompleteness(input: {
  packetCompletionPct: number | null | undefined;
  verificationScore: number | null | undefined;
  readiness?: string | null;
  coverage?: SectionCoverage | null;
}): ResearchCompleteness {
  const completionPct = clampPct(input.packetCompletionPct);
  const verificationScore = clampPct(input.verificationScore);
  const isComplete = completionPct >= 100;
  const tone: ResearchCompleteness["tone"] = isComplete
    ? "good"
    : completionPct >= 70
      ? "default"
      : completionPct >= 40
        ? "warn"
        : "bad";

  const label = isComplete
    ? "Research complete"
    : completionPct >= 70
      ? "Mostly researched"
      : completionPct >= 40
        ? "Partially researched"
        : "Early research";

  const gap =
    input.coverage && input.coverage.insufficient > 0
      ? ` ${input.coverage.insufficient} of ${input.coverage.total} written sections record an evidence gap rather than research.`
      : "";

  return {
    completionPct,
    verificationScore,
    readiness: input.readiness ?? null,
    label,
    tone,
    isComplete,
    explanation:
      `Canonical packet completion ${completionPct}% · verification ${verificationScore}%.` + gap,
  };
}

function clampPct(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
