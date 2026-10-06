/**
 * Regression net for the fixes that came before the final Golden Path pass:
 * temporal token classification, word budgets (45/60/90), the interior aim used
 * by the expansion/compression passes, and body-hash invalidation.
 */
import { describe, expect, it } from "vitest";
import { extractTemporalTokens, extractNonNumericSpans } from "@/lib/content/temporal";
import { extractNumericMentions } from "@/lib/content/numeric";
import { FALLBACK_WORD_BUDGETS, shortWordBudget } from "@/lib/content/style";
import { interiorTarget } from "@/lib/ai/style.server";
import { contentHash } from "@/lib/content/hash";

const typesOf = (text: string) => extractTemporalTokens(text).map((t) => t.type);

describe("temporal classification", () => {
  it("classifies full dates", () => {
    expect(typesOf("July 22, 2026 anru filing vandhadhu")).toContain("DATE");
  });

  it("classifies partial dates", () => {
    expect(typesOf("July 23 anru next filing")).toContain("PARTIAL_DATE");
  });

  it("classifies fiscal periods and quarters", () => {
    const t = typesOf("Q2 FY2026 numbers");
    expect(t.some((x) => x === "FISCAL_PERIOD" || x === "QUARTER")).toBe(true);
  });

  it("classifies SEC item headings", () => {
    expect(typesOf("Item 2.02 disclosure")).toContain("SEC_ITEM");
  });

  it("treats 8-K and 10-Q form names as non-numeric spans", () => {
    const spans = extractNonNumericSpans("8-K filing, then the 10-Q");
    expect(spans.map((s) => s.raw)).toEqual(expect.arrayContaining(["8-K", "10-Q"]));
  });

  it("keeps form names out of the financial number matcher", () => {
    const spans = extractNonNumericSpans("8-K filing la operating income 40.770 billion");
    const nums = extractNumericMentions(
      "8-K filing la operating income 40.770 billion",
      null,
      0,
      spans,
    );
    expect(nums.map((n) => n.raw).join(" ")).not.toContain("8-K");
    expect(nums.some((n) => n.value === 40.77e9 || n.value === 40.77)).toBe(true);
  });
});

describe("word budgets", () => {
  it("keeps the canonical 45 / 60 / 90 second bands", () => {
    expect(shortWordBudget({}, "short_45")).toMatchObject({ low: 105, high: 130 });
    expect(shortWordBudget({}, "short_60")).toMatchObject({ low: 135, high: 165 });
    expect(shortWordBudget({}, "short_90")).toMatchObject({ low: 190, high: 230 });
    expect(FALLBACK_WORD_BUDGETS["short_60"]).toBeDefined();
  });

  it("aims at a safe interior target, never at the bound", () => {
    expect(interiorTarget({ low: 135, high: 165 })).toEqual({ low: 145, high: 155 });
    const aim = interiorTarget({ low: 105, high: 130 });
    expect(aim.low).toBeGreaterThan(105);
    expect(aim.high).toBeLessThan(130);
  });
});

describe("body hash invalidation", () => {
  it("changes when the body changes and is stable otherwise", () => {
    const a = contentHash("one two three");
    expect(contentHash("one two three")).toBe(a);
    expect(contentHash("one two four")).not.toBe(a);
  });
});
