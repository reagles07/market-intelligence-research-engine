/**
 * Deterministic long-form storytelling readiness precheck (pure, no model call).
 *
 * A long-form script is a company STORY. Prompt obedience alone is not enough:
 * a packet whose business / financials / moat / valuation sections all say
 * "Insufficient Data" produced a 13-minute video about missing research.
 *
 * This gate runs BEFORE any paid generation and blocks that case with a clear
 * reason. It is deliberately narrow: it requires substantive business evidence,
 * a current catalyst, a usable story angle and enough quantitative material —
 * and it never requires optional valuation/technical/sentiment coverage.
 */
import { isSubstantive } from "@/lib/research/completion";

export type LongformReadinessInput = {
  sections: readonly { section_key: string; content: string | null }[];
  /** Company-level business description/model text, if recorded. */
  businessModelText?: string | null;
  /** Claims that passed verification and may be cited. */
  usableClaimCount: number;
  /** Numeric metric keys available from structured financial/market tables. */
  numericFactCount: number;
  /** Dated company events in the packet. */
  eventCount: number;
  /** Reported financial periods available. */
  financialPeriodCount: number;
  sourceCount: number;
};

export type LongformReadinessCheck = {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type LongformReadinessResult = {
  ok: boolean;
  checks: LongformReadinessCheck[];
  failed: string[];
  /** Creator-facing blocked reason; empty when ok. */
  reason: string;
};

/** Minimum structured numbers needed to support an analysis chapter. */
const MIN_NUMERIC_FACTS = 4;

export function evaluateLongformReadiness(input: LongformReadinessInput): LongformReadinessResult {
  const byKey = new Map(input.sections.map((s) => [s.section_key, s.content] as const));
  const sub = (key: string) => isSubstantive(byKey.get(key) ?? null);

  // 1. The business itself must be explained from evidence.
  const businessOk = sub("business") || isSubstantive(input.businessModelText ?? null);

  // 2. There must be a reason to publish now.
  const catalystOk = sub("catalysts") || sub("what_happened") || input.eventCount > 0;

  // 3. A story angle: an evidenced history/turning point, OR a strong
  //    present-day business mystery carried by several substantive sections.
  const angleSections = [
    "story_summary",
    "what_happened",
    "moat",
    "events",
    "earnings",
    "catalysts",
  ];
  const angleCount = angleSections.filter(sub).length;
  const angleOk = angleCount >= 2;

  // 4. Enough quantitative material for the numbers/analysis chapters.
  const quantOk =
    input.numericFactCount >= MIN_NUMERIC_FACTS ||
    input.financialPeriodCount > 0 ||
    sub("financials");

  // 5. Something verified to rest the script on.
  const evidenceOk = input.usableClaimCount > 0 || input.sourceCount >= 2;

  const checks: LongformReadinessCheck[] = [
    {
      key: "business",
      label: "Business evidence",
      passed: businessOk,
      detail: businessOk
        ? "Business section carries researched content."
        : "Business section is empty or records an evidence gap.",
    },
    {
      key: "catalyst",
      label: "Current catalyst",
      passed: catalystOk,
      detail: catalystOk
        ? "A current catalyst or dated event is evidenced."
        : "No evidenced current catalyst or dated event.",
    },
    {
      key: "story_angle",
      label: "Story angle",
      passed: angleOk,
      detail: angleOk
        ? `${angleCount} substantive narrative sections available.`
        : "No verified history/turning point and no strong present-day business mystery.",
    },
    {
      key: "quantitative",
      label: "Quantitative evidence",
      passed: quantOk,
      detail: quantOk
        ? "Structured financial figures are available."
        : `Fewer than ${MIN_NUMERIC_FACTS} structured numbers and no reported financial periods.`,
    },
    {
      key: "verified_evidence",
      label: "Verified evidence",
      passed: evidenceOk,
      detail: evidenceOk
        ? "Verified claims or multiple sources are attached."
        : "No usable verified claims and fewer than two sources.",
    },
  ];

  const failed = checks.filter((c) => !c.passed);
  return {
    ok: failed.length === 0,
    checks,
    failed: failed.map((c) => c.key),
    reason: failed.length
      ? `Long-form needs more research before it can be written. Missing: ${failed
          .map((c) => `${c.label.toLowerCase()} — ${c.detail}`)
          .join(" ")}`
      : "",
  };
}
