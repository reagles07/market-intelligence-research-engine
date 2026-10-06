import { describe, expect, it } from "vitest";

import {
  COMBINED_SHORT_MAX_COMPANIES,
  autoAllocateShorts,
  defaultAllocation,
  evaluateEligibility,
  planComposition,
  splitEligibility,
  validateAllocation,
  type ComposerCandidate,
} from "@/lib/content/composer";

const candidate = (over: Partial<ComposerCandidate> = {}): ComposerCandidate => ({
  companyId: over.companyId ?? "c1",
  ticker: over.ticker ?? "AAA",
  name: "A Co",
  market: "India",
  storyId: "s1",
  packetId: "p1",
  packetVersion: 3,
  packetDate: "2026-08-01T00:00:00Z",
  completionPct: 80,
  verificationScore: 70,
  readiness: "READY_FOR_CONTENT",
  ...over,
});

describe("eligibility", () => {
  it("only canonical eligible readiness may be used", () => {
    expect(evaluateEligibility(candidate()).eligible).toBe(true);
    expect(evaluateEligibility(candidate({ readiness: "NEEDS_REVIEW" })).eligible).toBe(true);
    expect(evaluateEligibility(candidate({ readiness: "INSUFFICIENT_DATA" })).eligible).toBe(false);
    expect(evaluateEligibility(candidate({ readiness: "BLOCKED_BY_CONFLICT" })).eligible).toBe(
      false,
    );
  });

  it("selection alone never makes a stock eligible", () => {
    const noPacket = evaluateEligibility(candidate({ packetId: null }));
    expect(noPacket.eligible).toBe(false);
    expect(noPacket.reason).toMatch(/no research packet/i);
    expect(evaluateEligibility(candidate({ readiness: null })).eligible).toBe(false);
  });

  it("splits a mixed selection and explains each blocked stock", () => {
    const { ready, blocked } = splitEligibility([
      candidate(),
      candidate({ companyId: "c2", ticker: "BBB", readiness: "INSUFFICIENT_DATA" }),
    ]);
    expect(ready.map((r) => r.ticker)).toEqual(["AAA"]);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.reason.length).toBeGreaterThan(0);
  });
});

describe("short allocation", () => {
  const ready = [
    candidate({ companyId: "c1", ticker: "AAA", strength: 90 }),
    candidate({ companyId: "c2", ticker: "BBB", strength: 50 }),
  ];

  it("rejects fractional, negative and out-of-range counts", () => {
    expect(validateAllocation(ready, { c1: 1.5 }).ok).toBe(false);
    expect(validateAllocation(ready, { c1: -1 }).ok).toBe(false);
    expect(validateAllocation(ready, { c1: 99 }).ok).toBe(false);
  });

  it("rejects Shorts requested for a stock that is not ready", () => {
    const res = validateAllocation(ready, { unknown: 2 });
    expect(res.ok).toBe(false);
    expect(res.allocation["unknown"]).toBeUndefined();
  });

  it("accepts per-stock integer counts including zero", () => {
    const res = validateAllocation(ready, { c1: 3, c2: 0 });
    expect(res.ok).toBe(true);
    expect(res.totalShorts).toBe(3);
  });

  it("auto allocation distributes strongest first and stays bounded", () => {
    const alloc = autoAllocateShorts(ready, 5);
    expect(Object.values(alloc).reduce((a, b) => a + b, 0)).toBe(5);
    expect(alloc["c1"]).toBeGreaterThanOrEqual(alloc["c2"]!);
  });

  it("single-stock mode still defaults to six Shorts", () => {
    expect(defaultAllocation("SINGLE", ready)["c1"]).toBe(6);
  });
});

describe("composition plan", () => {
  const ready = [
    candidate({ companyId: "c1", ticker: "AAA" }),
    candidate({ companyId: "c2", ticker: "BBB" }),
    candidate({ companyId: "c3", ticker: "CCC" }),
    candidate({ companyId: "c4", ticker: "DDD" }),
  ];

  it("counts the scripts before generation", () => {
    const plan = planComposition(ready.slice(0, 2), {
      mode: "MULTI_STOCK",
      longEnabled: true,
      longformMode: "roundup",
      shortsEnabled: true,
      allocation: { c1: 4, c2: 2 },
      combinedShorts: 0,
      combinedShortCompanyIds: [],
    });
    expect(plan.ok).toBe(true);
    expect(plan.totalScripts).toBe(7);
    expect(plan.summary).toBe("1 long video + 6 Shorts");
  });

  it("blocks a combined long-form with fewer than two ready stocks", () => {
    const plan = planComposition([ready[0]!], {
      mode: "MULTI_STOCK",
      longEnabled: true,
      longformMode: "roundup",
      shortsEnabled: false,
      allocation: {},
      combinedShorts: 0,
      combinedShortCompanyIds: [],
    });
    expect(plan.ok).toBe(false);
  });

  it("refuses a combined Short with more than three companies", () => {
    const plan = planComposition(ready, {
      mode: "MULTI_STOCK",
      longEnabled: false,
      longformMode: "roundup",
      shortsEnabled: true,
      allocation: {},
      combinedShorts: 1,
      combinedShortCompanyIds: ["c1", "c2", "c3", "c4"],
    });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(" ")).toContain(String(COMBINED_SHORT_MAX_COMPANIES));
  });

  it("warns rather than blocks at exactly three companies in a combined Short", () => {
    const plan = planComposition(ready.slice(0, 3), {
      mode: "MULTI_STOCK",
      longEnabled: false,
      longformMode: "roundup",
      shortsEnabled: true,
      allocation: {},
      combinedShorts: 1,
      combinedShortCompanyIds: ["c1", "c2", "c3"],
    });
    expect(plan.ok).toBe(true);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it("refuses an empty composition", () => {
    const plan = planComposition(ready.slice(0, 2), {
      mode: "MULTI_STOCK",
      longEnabled: false,
      longformMode: "roundup",
      shortsEnabled: false,
      allocation: {},
      combinedShorts: 0,
      combinedShortCompanyIds: [],
    });
    expect(plan.ok).toBe(false);
  });
});
