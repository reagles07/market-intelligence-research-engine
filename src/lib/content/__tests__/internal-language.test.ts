import { describe, expect, it } from "vitest";

import {
  NO_INTERNAL_LANGUAGE_RULE,
  internalLanguageRepairNote,
  scanInternalLanguage,
} from "@/lib/content/internal-language";
import { LAYMAN_VOICE_CONTRACT } from "@/lib/content/layman-voice";

describe("internal-language detector", () => {
  it("catches research packet talk", () => {
    const scan = scanInternalLanguage(
      "Indha company pathi research packet-la enough data illa, so namma continue pannuvom.",
    );
    expect(scan.clean).toBe(false);
    expect(scan.hits.map((h) => h.phrase)).toContain("research packet");
  });

  it("catches ids, readiness and orchestration terms", () => {
    expect(scanInternalLanguage("source id 12ab is attached").clean).toBe(false);
    expect(scanInternalLanguage("the claim id could not be matched").clean).toBe(false);
    expect(scanInternalLanguage("verification score konjam low").clean).toBe(false);
    expect(scanInternalLanguage("our orchestration run finished").clean).toBe(false);
  });

  it("catches spoken insufficient-data and PDF-failure narration", () => {
    expect(scanInternalLanguage("Insufficient data for this chapter").clean).toBe(false);
    expect(scanInternalLanguage("We could not fetch the PDF from the company site").clean).toBe(
      false,
    );
    expect(scanInternalLanguage("the packet does not contain the margin figure").clean).toBe(false);
  });

  it("passes a normal layman script with a disclaimer", () => {
    const scan = scanInternalLanguage(
      [
        "Apollo Hospitals-oda revenue 5,000 crore. Simple-aa sonna, hospital service-la varura total money idhu.",
        "Idhu shareholder-ku mukkiyam, because revenue grow aanaa dhaan profit grow aaga chance irukku.",
        "Indha video educational purpose mattum; investment advice illa.",
      ].join(" "),
    );
    expect(scan.clean).toBe(true);
    expect(scan.hits).toEqual([]);
  });

  it("writes a repair note that names the offending phrases and forbids new facts", () => {
    const note = internalLanguageRepairNote(
      scanInternalLanguage("the research packet is thin").hits,
    );
    expect(note).toContain("research packet");
    expect(note).toContain("Do not add any new fact");
  });
});

describe("layman prompt contract", () => {
  it("requires jargon explanation on first use", () => {
    expect(LAYMAN_VOICE_CONTRACT).toMatch(/FIRST time an important finance term\s+appears/i);
  });

  it("requires NUMBER → SIMPLE MEANING → WHY IT MATTERS", () => {
    expect(LAYMAN_VOICE_CONTRACT).toContain("NUMBER → SIMPLE MEANING → WHY IT MATTERS");
    expect(LAYMAN_VOICE_CONTRACT).toMatch(/why should a normal shareholder care/i);
  });

  it("keeps one idea per sentence and bans unexplained jargon clusters", () => {
    expect(LAYMAN_VOICE_CONTRACT).toMatch(/One idea per sentence/i);
    expect(LAYMAN_VOICE_CONTRACT).toMatch(/EBITDA, ROCE, FCF, PEG, RSI/);
  });

  it("bans internal tooling language in the shared rule block", () => {
    expect(NO_INTERNAL_LANGUAGE_RULE).toMatch(/research packet/i);
    expect(NO_INTERNAL_LANGUAGE_RULE).toMatch(/insufficient data/i);
  });
});
