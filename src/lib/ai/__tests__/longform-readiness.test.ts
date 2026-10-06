import { describe, expect, it } from "vitest";

import { evaluateLongformReadiness } from "@/lib/ai/longform-readiness";
import { FACT_GAP_CATEGORIES, missingFactCategories } from "@/lib/research/fact-sprint";

/** The real APOLLOHOSP packet shape: text everywhere, evidence nowhere. */
const apolloSections = [
  {
    section_key: "business",
    content: "Insufficient Data: the supplied context identifies the company only.",
  },
  {
    section_key: "financials",
    content: "Insufficient Data: no extracted financial statements are present.",
  },
  {
    section_key: "moat",
    content: "Insufficient Data: no populated moat_categories and no verified metrics.",
  },
  {
    section_key: "valuation",
    content: "Insufficient Data: there are no valuation records or peer multiples.",
  },
  {
    section_key: "quantitative",
    content: "Insufficient Data: there are no quantitative_metrics records.",
  },
  {
    section_key: "technical",
    content: "Insufficient Data: there are no technical_metrics records.",
  },
];

describe("evaluateLongformReadiness", () => {
  it("blocks the APOLLOHOSP-style packet before any paid generation", () => {
    const res = evaluateLongformReadiness({
      sections: apolloSections,
      businessModelText: null,
      usableClaimCount: 0,
      numericFactCount: 0,
      eventCount: 0,
      financialPeriodCount: 0,
      sourceCount: 4,
    });
    expect(res.ok).toBe(false);
    expect(res.failed).toContain("business");
    expect(res.failed).toContain("quantitative");
    expect(res.reason).toMatch(/more research/i);
  });

  it("passes a genuinely researched packet", () => {
    const res = evaluateLongformReadiness({
      sections: [
        {
          section_key: "business",
          content:
            "The company runs 70 hospitals plus a diagnostics and pharmacy network; hospitals contribute most of revenue.",
        },
        {
          section_key: "catalysts",
          content:
            "Q1 FY27 results on 12 August 2026 showed margin expansion in the diagnostics arm.",
        },
        {
          section_key: "what_happened",
          content:
            "The stock moved after the company reported its strongest quarterly margin in three years.",
        },
        {
          section_key: "financials",
          content:
            "Revenue grew 15% year on year with operating margin at 13.4%, per the FY26 annual report.",
        },
      ],
      usableClaimCount: 9,
      numericFactCount: 24,
      eventCount: 3,
      financialPeriodCount: 6,
      sourceCount: 12,
    });
    expect(res.ok).toBe(true);
    expect(res.failed).toHaveLength(0);
    expect(res.reason).toBe("");
  });

  it("does not block only because optional valuation/technical data is missing", () => {
    const res = evaluateLongformReadiness({
      sections: [
        {
          section_key: "business",
          content:
            "A subscription software business selling to mid-market retailers across three regions.",
        },
        {
          section_key: "catalysts",
          content: "Management guided to accelerating renewals after the September pricing change.",
        },
        {
          section_key: "story_summary",
          content:
            "A slow-growth vendor rebuilt itself around retention after losing its largest customer.",
        },
        { section_key: "valuation", content: "Insufficient Data: no valuation records available." },
        { section_key: "technical", content: "Insufficient Data: no technical_metrics records." },
      ],
      usableClaimCount: 5,
      numericFactCount: 10,
      eventCount: 1,
      financialPeriodCount: 4,
      sourceCount: 8,
    });
    expect(res.ok).toBe(true);
  });
});

describe("blocked long-form exposes fact-sprint targets", () => {
  it("turns the failed checks of an evidence-starved packet into gap categories", () => {
    const res = evaluateLongformReadiness({
      sections: [
        { section_key: "business", content: "Insufficient Data: no business records." },
        { section_key: "financials", content: "Insufficient Data: no financial records." },
        { section_key: "catalysts", content: "Insufficient Data." },
      ],
      usableClaimCount: 0,
      numericFactCount: 0,
      eventCount: 0,
      financialPeriodCount: 0,
      sourceCount: 0,
    });
    expect(res.ok).toBe(false);
    const categories = missingFactCategories(res.failed);
    expect(categories.length).toBeGreaterThan(0);
    const keys = categories.map((c) => c.key);
    expect(keys).toContain("business_model");
    expect(keys).toContain("catalyst");
    expect(keys).toContain("financials");
    // Every targeted category must be researchable by the sprint.
    for (const c of categories) expect(FACT_GAP_CATEGORIES[c.key]).toBeTruthy();
  });
});
