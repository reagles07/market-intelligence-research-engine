import { describe, expect, it } from "vitest";

import {
  FACT_GAP_CATEGORIES,
  buildFactGapPlan,
  evidenceStatusForSupports,
  fallbackQueriesForInaccessible,
  inaccessibleSourceNote,
  isInaccessiblePrimary,
  missingFactCategories,
  shouldRunAnotherPass,
  sourceLadderQueries,
  summarizeFactSprint,
} from "@/lib/research/fact-sprint";

const company = {
  name: "Apollo Hospitals",
  ticker: "APOLLOHOSP",
  market: "India",
  domain: "apollohospitals.com",
};

describe("fact sprint planning", () => {
  it("maps failed readiness checks onto targetable gap categories", () => {
    const cats = missingFactCategories(["business", "quantitative"]);
    expect(cats.map((c) => c.key)).toEqual(["business_model", "financials"]);
  });

  it("drops unknown readiness checks instead of guessing", () => {
    expect(missingFactCategories(["something_else"])).toEqual([]);
  });

  it("puts required gaps before optional ones and stays bounded", () => {
    const plan = buildFactGapPlan({
      company,
      categories: [
        FACT_GAP_CATEGORIES.valuation,
        FACT_GAP_CATEGORIES.history,
        FACT_GAP_CATEGORIES.business_model,
        FACT_GAP_CATEGORIES.catalyst,
      ],
      maxGaps: 2,
    });
    expect(plan).toHaveLength(2);
    expect(plan.map((g) => g.key)).toEqual(["business_model", "catalyst"]);
    expect(plan[0]!.queries.length).toBeGreaterThanOrEqual(3);
  });

  it("builds a primary → secondary → industry ladder without hard-coding a news site", () => {
    const queries = sourceLadderQueries(company, FACT_GAP_CATEGORIES.financials);
    expect(queries[0]).toContain("quarterly results");
    expect(queries[0]).toContain("NSE BSE exchange filing");
    expect(queries.join(" ")).not.toMatch(/moneycontrol|economictimes|reuters/i);
  });
});

describe("inaccessible primary fallback", () => {
  const pdf = {
    url: "https://apollohospitals.com/ir/q1-results.pdf",
    title: "Q1 FY26 Results.pdf",
    summary: "The file is too large and could not be opened by the tool.",
    contentAccessible: true,
  };

  it("detects an unreadable document from the retrieval note", () => {
    expect(isInaccessiblePrimary(pdf)).toBe(true);
  });

  it("detects an unreadable document from the accessibility flag", () => {
    expect(
      isInaccessiblePrimary({ ...pdf, summary: "Results release.", contentAccessible: false }),
    ).toBe(true);
  });

  it("produces alternative official/secondary queries instead of stopping", () => {
    const fallbacks = fallbackQueriesForInaccessible(pdf, company);
    expect(fallbacks).toHaveLength(3);
    expect(fallbacks[0]).toContain("press release HTML");
    expect(fallbacks.some((q) => q.includes("NSE BSE exchange filing"))).toBe(true);
  });

  it("never claims the unread document's contents were read", () => {
    const note = inaccessibleSourceNote(pdf);
    expect(note).toContain("NOT READ");
    expect(note).toContain(pdf.url);
    expect(note).toContain("No number, date or statement may be taken");
  });

  it("cannot verify a finding whose only supports were unreadable", () => {
    const status = evidenceStatusForSupports({
      supportCount: 2,
      allSupportsInaccessible: true,
      hasPrimary: true,
      corroborations: 2,
    });
    expect(status.status).toBe("Unsupported");
    expect(status.critical).toBe(false);
  });

  it("verifies on a readable primary and cross-checks a lone secondary", () => {
    expect(
      evidenceStatusForSupports({
        supportCount: 1,
        allSupportsInaccessible: false,
        hasPrimary: true,
        corroborations: 1,
      }).status,
    ).toBe("Verified");
    expect(
      evidenceStatusForSupports({
        supportCount: 1,
        allSupportsInaccessible: false,
        hasPrimary: false,
        corroborations: 1,
      }).status,
    ).toBe("Needs Cross-Check");
    expect(
      evidenceStatusForSupports({
        supportCount: 2,
        allSupportsInaccessible: false,
        hasPrimary: false,
        corroborations: 2,
      }).status,
    ).toBe("Verified");
  });
});

describe("sprint bounds and summary", () => {
  it("stops as soon as the critical gaps are filled", () => {
    expect(shouldRunAnotherPass({ pass: 1, remainingCriticalGaps: 0 })).toBe(false);
    expect(shouldRunAnotherPass({ pass: 1, remainingCriticalGaps: 2 })).toBe(true);
    expect(shouldRunAnotherPass({ pass: 3, remainingCriticalGaps: 2 })).toBe(false);
  });

  it("summarises filled, unresolved, sources, conflicts and freshness", () => {
    const summary = summarizeFactSprint(
      [
        {
          gapKey: "business_model",
          filled: true,
          sourcesAdded: 3,
          conflicts: 0,
          searches: 3,
          costUsd: 0.02,
          inaccessiblePrimaries: 1,
          latestSourceAt: "2026-08-20T00:00:00.000Z",
          note: "",
        },
        {
          gapKey: "financials",
          filled: false,
          sourcesAdded: 1,
          conflicts: 1,
          searches: 3,
          costUsd: 0.01,
          inaccessiblePrimaries: 0,
          latestSourceAt: "2026-08-25T00:00:00.000Z",
          note: "",
        },
      ],
      2,
    );
    expect(summary.gapsTargeted).toBe(2);
    expect(summary.gapsFilled).toBe(1);
    expect(summary.unresolvedGaps).toEqual(["financials"]);
    expect(summary.sourcesAdded).toBe(4);
    expect(summary.conflicts).toBe(1);
    expect(summary.latestSourceAt).toBe("2026-08-25T00:00:00.000Z");
    expect(summary.inaccessiblePrimaries).toBe(1);
  });
});
