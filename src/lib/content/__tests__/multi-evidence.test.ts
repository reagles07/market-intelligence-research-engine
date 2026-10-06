import { describe, expect, it } from "vitest";

import {
  auditEvidenceSeparation,
  buildEvidenceIndex,
  partitionEvidence,
} from "@/lib/content/multi-evidence";
import {
  COMBINED_SHORT_CONTRACT,
  MULTI_EVIDENCE_CONTRACT,
  MULTI_REQUIRED_SECTIONS,
  longformModeInstruction,
} from "@/lib/content/multi-story";

const index = buildEvidenceIndex([
  {
    companyId: "A",
    claimIds: ["claim-a1", "claim-a2"],
    sourceIds: ["src-a1"],
    researchSectionIds: ["sec-a1"],
    metricKeys: ["financial_periods:pa:revenue"],
  },
  {
    companyId: "B",
    claimIds: ["claim-b1"],
    sourceIds: ["src-b1"],
    researchSectionIds: ["sec-b1"],
    metricKeys: ["financial_periods:pb:revenue"],
  },
]);

describe("per-company evidence separation", () => {
  it("keeps a company's own ids", () => {
    const p = partitionEvidence("A", ["claim-a1", "src-a1"], index);
    expect(p.kept).toEqual(["claim-a1", "src-a1"]);
    expect(p.foreign).toEqual([]);
  });

  it("never lets one company's evidence fill another's gap", () => {
    const p = partitionEvidence("A", ["claim-b1", "financial_periods:pb:revenue"], index);
    expect(p.kept).toEqual([]);
    expect(p.foreign).toHaveLength(2);
  });

  it("drops invented ids that belong to nobody", () => {
    const p = partitionEvidence("B", ["claim-zz"], index);
    expect(p.unknown).toEqual(["claim-zz"]);
    expect(p.kept).toEqual([]);
  });

  it("audits a whole script and reports mixing per section", () => {
    const report = auditEvidenceSeparation(
      [
        { sectionKey: "company_block", companyId: "A", ids: ["claim-a1"] },
        { sectionKey: "company_block", companyId: "B", ids: ["claim-a2", "claim-b1"] },
        { sectionKey: "cold_open", companyId: null, ids: ["claim-a1", "claim-b1"] },
      ],
      index,
    );
    expect(report.clean).toBe(false);
    expect(report.foreignCount).toBe(1);
    expect(report.details[0]!.companyId).toBe("B");
  });

  it("is clean when every section cites only its own company", () => {
    const report = auditEvidenceSeparation(
      [
        { sectionKey: "company_block", companyId: "A", ids: ["claim-a1", "sec-a1"] },
        { sectionKey: "company_block", companyId: "B", ids: ["claim-b1"] },
      ],
      index,
    );
    expect(report.clean).toBe(true);
  });
});

describe("multi-stock prompt contract", () => {
  it("forbids cross-company mixing, currency conversion and false equivalence", () => {
    expect(MULTI_EVIDENCE_CONTRACT).toMatch(/never use one company's evidence to fill another/i);
    expect(MULTI_EVIDENCE_CONTRACT).toMatch(/currenc/i);
    expect(MULTI_EVIDENCE_CONTRACT).toMatch(/false equivalence/i);
    expect(MULTI_EVIDENCE_CONTRACT).toMatch(/do not rank/i);
  });

  it("only allows ranking when the creator asked for it", () => {
    expect(longformModeInstruction("roundup", false)).toMatch(/do not rank/i);
    expect(longformModeInstruction("roundup", true)).toMatch(/ranking is allowed/i);
  });

  it("requires the shared episode sections", () => {
    expect(MULTI_REQUIRED_SECTIONS).toContain("cold_open");
    expect(MULTI_REQUIRED_SECTIONS).toContain("why_together");
    expect(MULTI_REQUIRED_SECTIONS).toContain("synthesis");
    expect(MULTI_REQUIRED_SECTIONS).toContain("full_circle");
    expect(MULTI_REQUIRED_SECTIONS).toContain("conclusion_cta");
  });

  it("keeps a combined Short simple and per-company", () => {
    expect(COMBINED_SHORT_CONTRACT).toMatch(/one clean comparison|ONE clean comparison/i);
    expect(COMBINED_SHORT_CONTRACT).toMatch(/never move a number from one company/i);
  });
});
