import { describe, expect, it } from "vitest";

import { extractNumericMentions } from "@/lib/content/numeric";
import { extractNonNumericSpans, extractTemporalTokens } from "@/lib/content/temporal";

function mentions(text: string) {
  const spans = [
    ...extractTemporalTokens(text).map((t) => ({ start: t.start, end: t.end })),
    ...extractNonNumericSpans(text),
  ];
  return extractNumericMentions(text, null, 0, spans);
}

describe("metric binding inside multi-metric sentences", () => {
  // Regression: the final Golden Path numeric blocker. "40.770 billion" was bound
  // to eps_gaap because keyword priority beat proximity across a clause break.
  it("binds each number to the metric in its own clause", () => {
    const got = mentions(
      "Supplied database-padi, Q2 FY2026 operating income USD 40.770 billion; GAAP EPS USD 9.23 per share.",
    );
    expect(got.map((m) => [m.raw.trim(), m.metric, m.value])).toEqual([
      ["USD 40.770 billion", "operating_income", 40.77e9],
      ["USD 9.23", "eps_gaap", 9.23],
    ]);
  });

  it("handles the comma-separated variant", () => {
    const got = mentions(
      "Q2 FY2026 operating income USD 40.77 billion, GAAP EPS 9.23-nu kaamikudhu.",
    );
    expect(got.map((m) => m.metric)).toEqual(["operating_income", "eps_gaap"]);
  });

  it("keeps adjusted vs GAAP EPS distinct", () => {
    const got = mentions("Adjusted EPS 2.10, GAAP EPS 1.80.");
    expect(got.map((m) => m.metric)).toEqual(["eps_adjusted", "eps_gaap"]);
  });

  it("still reads a trailing metric word when the clause has no leading metric", () => {
    const got = mentions("Andha quarter-la 12.5 billion revenue vandhuchu.");
    expect(got[0]?.metric).toBe("revenue");
  });
});

describe("temporal and form tokens stay out of the figure matcher", () => {
  it("ignores dates, fiscal periods, SEC items and form names", () => {
    const text =
      "July 22, 2026 anniku GOOGL oru 8-K file panniruchu. Item 2.02 la Q1 FY2026 revenue 3.2% up.";
    expect(mentions(text).map((m) => m.raw.trim())).toEqual(["3.2%"]);
    const kinds = extractTemporalTokens(text).map((t) => t.type);
    expect(kinds).toContain("DATE");
    expect(kinds).toContain("SEC_ITEM");
    expect(kinds).toContain("FISCAL_PERIOD");
  });
});
