import { describe, expect, it } from "vitest";

import { duplicateNote, findNearDuplicates, similarity, tokenize } from "@/lib/content/uniqueness";

describe("short uniqueness", () => {
  it("drops stop words when tokenizing", () => {
    expect(tokenize("The revenue vandhu grew a lot")).toEqual(["revenue", "grew", "lot"]);
  });

  it("scores identical text as 1 and disjoint text as 0", () => {
    expect(similarity("margin compression continues", "margin compression continues")).toBe(1);
    expect(similarity("margin compression", "distribution warehouse network")).toBe(0);
  });

  it("flags near-duplicate shorts and leaves distinct ones alone", () => {
    const texts = [
      "Cloud revenue grew twenty two percent and margins expanded this quarter",
      "Cloud revenue grew twenty two percent and margins expanded this quarter again",
      "Regulatory case in Europe could force a change to the advertising business",
    ];
    const { pairs, rewriteIndexes } = findNearDuplicates(texts);
    expect(pairs.map((p) => [p.a, p.b])).toEqual([[0, 1]]);
    expect(rewriteIndexes).toEqual([1]);
  });

  it("reports no duplicates for six genuinely different angles", () => {
    const texts = [
      "Search advertising funds everything else the company builds",
      "The failed social network attempt taught the company to buy distribution",
      "Nobody talks about the subscription line hidden inside other bets",
      "The antitrust ruling landed this month and changed the default deal",
      "Operating margin moved from twenty seven to thirty two percent",
      "Cloud backlog is the upside while capital spending is the risk",
    ];
    expect(findNearDuplicates(texts).pairs).toEqual([]);
    expect(duplicateNote([])).toBeNull();
  });

  it("formats a duplicate note", () => {
    expect(duplicateNote([{ a: 0, b: 2, score: 0.71 }])).toBe("Short 1 and Short 3 overlap 71%");
  });
});
