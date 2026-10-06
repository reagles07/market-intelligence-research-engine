import { describe, expect, it } from "vitest";

import { isSubstantive, researchCompleteness, sectionCoverage } from "@/lib/research/completion";

const KEYS = ["business", "financials", "moat", "valuation", "catalysts"];

describe("isSubstantive", () => {
  it("rejects empty and evidence-gap sections", () => {
    expect(isSubstantive("")).toBe(false);
    expect(isSubstantive("   ")).toBe(false);
    expect(
      isSubstantive("Insufficient Data: there are no valuation records in the supplied context."),
    ).toBe(false);
  });

  it("accepts real research text", () => {
    expect(
      isSubstantive(
        "Apollo Hospitals reported revenue growth driven by the diagnostics segment, per the FY26 annual report.",
      ),
    ).toBe(true);
  });
});

describe("sectionCoverage", () => {
  it("separates written from substantive", () => {
    const cov = sectionCoverage(
      [
        { section_key: "business", content: "Insufficient Data: nothing in the supplied context." },
        { section_key: "financials", content: "Insufficient Data: no statements extracted here." },
        { section_key: "moat", content: "Insufficient Data: no moat categories recorded at all." },
        { section_key: "valuation", content: "Insufficient Data: no valuation records available." },
        {
          section_key: "catalysts",
          content:
            "Board meeting outcome filings dated 12 August 2026 are the identifiable near-term catalysts.",
        },
      ],
      KEYS,
    );
    expect(cov.written).toBe(5);
    expect(cov.writtenPct).toBe(100);
    expect(cov.substantive).toBe(1);
    expect(cov.insufficient).toBe(4);
  });
});

describe("researchCompleteness", () => {
  it("never reports complete when the canonical packet is 50%", () => {
    const cov = sectionCoverage(
      KEYS.map((k) => ({ section_key: k, content: "Insufficient Data: nothing recorded here." })),
      KEYS,
    );
    const res = researchCompleteness({
      packetCompletionPct: 50,
      verificationScore: 50,
      coverage: cov,
    });
    expect(res.completionPct).toBe(50);
    expect(res.verificationScore).toBe(50);
    expect(res.isComplete).toBe(false);
    expect(res.label).not.toBe("Research complete");
    expect(res.explanation).toContain("50%");
  });

  it("reports complete only at canonical 100", () => {
    const res = researchCompleteness({ packetCompletionPct: 100, verificationScore: 90 });
    expect(res.isComplete).toBe(true);
    expect(res.label).toBe("Research complete");
  });

  it("clamps missing values to 0", () => {
    const res = researchCompleteness({ packetCompletionPct: null, verificationScore: undefined });
    expect(res.completionPct).toBe(0);
    expect(res.isComplete).toBe(false);
  });
});
