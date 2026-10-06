import { describe, expect, it } from "vitest";

import {
  FIRST_USE_GLOSSARY,
  JARGON_EXPLANATION_CONTRACT,
  LAYMAN_VOICE_CONTRACT,
  glossaryHint,
  termsNeedingExplanation,
} from "@/lib/content/layman-voice";
import { composeScriptInstructions } from "@/lib/ai/style.server";

describe("layman glossary helper", () => {
  it("finds only the terms actually used", () => {
    const terms = termsNeedingExplanation("Operating margin 18% and free cash flow improved.");
    expect(terms).toContain("operating margin");
    expect(terms).toContain("free cash flow");
    expect(terms).not.toContain("arpu");
  });

  it("renders plain meanings without inventing numbers", () => {
    const hint = glossaryHint(["ROCE", "P/E"]);
    expect(hint).toContain("ROCE");
    expect(hint).toContain("P/E");
    expect(hint).not.toMatch(/\d+%/);
  });

  it("returns nothing when no jargon is in play", () => {
    expect(glossaryHint([])).toBe("");
  });

  it("keeps every glossary entry short and spoken", () => {
    for (const [term, meaning] of Object.entries(FIRST_USE_GLOSSARY)) {
      expect(meaning.length, term).toBeLessThan(140);
    }
  });
});

describe("production prompt composition", () => {
  const prompt = composeScriptInstructions({
    language: "Tanglish",
    profile: null,
    formatBlock: "LONG FORM",
  });

  it("carries the audience and jargon contracts into the real prompt", () => {
    expect(prompt).toContain(LAYMAN_VOICE_CONTRACT);
    expect(prompt).toContain(JARGON_EXPLANATION_CONTRACT);
  });

  it("states the retail-viewer audience and the one-idea-per-sentence rule", () => {
    expect(prompt).toMatch(/ordinary retail investor/i);
    expect(prompt).toMatch(/one idea per sentence/i);
  });

  it("never promises returns or gives buy/sell instructions", () => {
    expect(prompt).toMatch(/no buy or\s+sell instruction/i);
  });
});
