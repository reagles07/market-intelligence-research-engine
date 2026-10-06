import { describe, expect, it } from "vitest";

import {
  PRIMARY_CLASSES,
  RAPID_STEPS,
  STORY_BASELINE_TOPICS,
  dedupeEvidence,
  dedupeQueries,
  evaluateSectionSufficiency,
  filingAnchor,
  insufficientDataIsHonest,
  normalizeQuery,
  planRapidQueries,
  reconcileMaterialClaim,
  summarizeRapidPass,
  topicQueries,
  type RapidQuery,
  type RetrievedEvidence,
} from "@/lib/research/rapid-fact-pass";

const apollo = {
  name: "Apollo Hospitals Enterprise",
  ticker: "APOLLOHOSP",
  market: "India",
  domain: "apollohospitals.com",
};

const ev = (over: Partial<RetrievedEvidence>): RetrievedEvidence => ({
  url: "https://example.com/a",
  domain: "example.com",
  sourceClass: "press",
  readable: true,
  ...over,
});

describe("rapid query planning", () => {
  it("issues several differently-formulated searches across source classes", () => {
    const qs = topicQueries(apollo, "financials");
    expect(qs.length).toBeGreaterThanOrEqual(3);
    expect(new Set(qs.map((q) => q.sourceClass)).size).toBeGreaterThanOrEqual(3);
    expect(qs.some((q) => PRIMARY_CLASSES.includes(q.sourceClass))).toBe(true);
  });

  it("anchors the filing rung to the right regulator per market", () => {
    expect(filingAnchor("India")).toMatch(/NSE/);
    expect(filingAnchor("US")).toMatch(/SEC/);
    expect(topicQueries(apollo, "catalyst").some((q) => /NSE/.test(q.query))).toBe(true);
  });

  it("puts the company domain on the official rung when known", () => {
    expect(topicQueries(apollo, "business_model")[0]!.query).toContain("site:apollohospitals.com");
  });

  it("de-duplicates formulations that are the same search", () => {
    const a: RapidQuery = {
      query: "Apollo results 2026",
      topic: "financials",
      sourceClass: "press",
      purpose: "x",
    };
    const b: RapidQuery = {
      query: "results Apollo  2026!",
      topic: "financials",
      sourceClass: "industry",
      purpose: "y",
    };
    expect(normalizeQuery(a.query)).toBe(normalizeQuery(b.query));
    expect(dedupeQueries([a, b])).toHaveLength(1);
  });

  it("keeps the plan bounded, primary-first and free of already-spent searches", () => {
    const plan = planRapidQueries({
      company: apollo,
      topics: [...STORY_BASELINE_TOPICS],
      maxQueries: 8,
      maxPerTopic: 2,
    });
    expect(plan.length).toBeLessThanOrEqual(8);
    expect(new Set(plan.map((q) => normalizeQuery(q.query))).size).toBe(plan.length);
    // Non-optional topics are planned before optional ones.
    expect(plan.some((q) => q.topic === "history")).toBe(false);

    const again = planRapidQueries({
      company: apollo,
      topics: [...STORY_BASELINE_TOPICS],
      maxQueries: 8,
      maxPerTopic: 2,
      alreadyRun: plan.map((q) => q.query),
    });
    expect(
      again.every((q) => !plan.some((p) => normalizeQuery(p.query) === normalizeQuery(q.query))),
    ).toBe(true);
  });

  it("exposes honest stage labels with no percentage or ETA", () => {
    const labels = RAPID_STEPS.map((s) => s.label).join(" ");
    expect(labels).toContain("Searching company filings");
    expect(labels).toContain("Checking recent news");
    expect(labels).toContain("Cross-checking numbers");
    expect(labels).not.toMatch(/%|ETA|minutes remaining/i);
  });
});

describe("source sufficiency", () => {
  it("stops on one readable primary document", () => {
    const res = evaluateSectionSufficiency([ev({ sourceClass: "filing" })]);
    expect(res.enough).toBe(true);
    expect(res.primarySources).toBe(1);
  });

  it("stops on two independent credible secondary sources", () => {
    const res = evaluateSectionSufficiency([
      ev({ url: "https://a.com/1", domain: "a.com" }),
      ev({ url: "https://b.com/1", domain: "b.com" }),
    ]);
    expect(res.enough).toBe(true);
    expect(res.independentDomains).toBe(2);
  });

  it("does not stop on two pages from the same domain", () => {
    const res = evaluateSectionSufficiency([
      ev({ url: "https://a.com/1", domain: "a.com" }),
      ev({ url: "https://a.com/2", domain: "a.com" }),
    ]);
    expect(res.enough).toBe(false);
  });

  it("never counts a document that could not be opened", () => {
    const res = evaluateSectionSufficiency([ev({ sourceClass: "filing", readable: false })]);
    expect(res.enough).toBe(false);
    expect(res.readableSources).toBe(0);
  });

  it("de-duplicates evidence by URL", () => {
    expect(dedupeEvidence([ev({}), ev({})])).toHaveLength(1);
  });
});

describe("reconciliation", () => {
  it("prefers a primary source", () => {
    expect(
      reconcileMaterialClaim({
        supports: [ev({ sourceClass: "official" })],
        conflictsWithRecorded: false,
      }).status,
    ).toBe("Verified");
  });

  it("requires two independent sources when there is no primary", () => {
    expect(
      reconcileMaterialClaim({ supports: [ev({})], conflictsWithRecorded: false }).status,
    ).toBe("Needs Cross-Check");
    expect(
      reconcileMaterialClaim({
        supports: [
          ev({ url: "https://a.com", domain: "a.com" }),
          ev({ url: "https://b.com", domain: "b.com" }),
        ],
        conflictsWithRecorded: false,
      }).status,
    ).toBe("Verified");
  });

  it("preserves a conflict instead of choosing or averaging", () => {
    const out = reconcileMaterialClaim({
      supports: [ev({ sourceClass: "filing" })],
      conflictsWithRecorded: true,
    });
    expect(out.status).toBe("Conflicting");
    expect(out.note).toMatch(/never chosen|neither is chosen/i);
  });

  it("treats unreadable-only support as unsupported", () => {
    expect(
      reconcileMaterialClaim({
        supports: [ev({ sourceClass: "filing", readable: false })],
        conflictsWithRecorded: false,
      }).status,
    ).toBe("Unsupported");
  });
});

describe("summary and honesty of 'insufficient data'", () => {
  it("counts only what was actually retrieved", () => {
    const s = summarizeRapidPass({
      evidence: [
        ev({ sourceClass: "filing" }),
        ev({ url: "https://b.com", domain: "b.com", readable: false }),
      ],
      confirmations: 1,
      conflicts: 0,
      searches: 5,
      unresolvedTopics: ["valuation"],
    });
    expect(s.sourcesChecked).toBe(2);
    expect(s.primarySources).toBe(1);
    expect(s.unreadableDocuments).toBe(1);
    expect(s.stillMissing).toEqual(["Valuation and market statistics"]);
  });

  it("only allows 'insufficient data' after real multi-class searching", () => {
    expect(
      insufficientDataIsHonest({ searchesRun: 0, readableSourcesFound: 0, sourceClassesTried: [] }),
    ).toBe(false);
    expect(
      insufficientDataIsHonest({
        searchesRun: 4,
        readableSourcesFound: 0,
        sourceClassesTried: ["official", "press"],
      }),
    ).toBe(true);
    expect(
      insufficientDataIsHonest({
        searchesRun: 4,
        readableSourcesFound: 2,
        sourceClassesTried: ["official", "press"],
      }),
    ).toBe(false);
  });
});
