import { describe, expect, it } from "vitest";

import {
  MISSING_DATA_MAX_MENTIONS,
  detectMissingDataDominance,
  evaluateScriptLanguageQuality,
  missingDataRepairNote,
} from "@/lib/content/internal-language";
import { JARGON_EXPLANATION_CONTRACT, LAYMAN_VOICE_CONTRACT } from "@/lib/content/layman-voice";

const goodScript = `Apollo oru hospital chain. Patients treatment-ku pay panranga, adhu thaan main revenue.
EBITDA margin 18% — simple-aa sonna, interest, tax, depreciation-ku munnadi, 100 rupees revenue-la
around 18 rupees operating profit level-la remain aagudhu. Idhu important, because hospital business-la
bed occupancy konjam kuraiஞ்சaalum margin quickly fall aagum. Pharmacy segment fast-a grow aagudhu.`;

describe("internal jargon quality gate", () => {
  it("accepts a clean, company-focused script", () => {
    const res = evaluateScriptLanguageQuality(goodScript);
    expect(res.ok).toBe(true);
    expect(res.action).toBe("accept");
  });

  it("blocks internal tooling language and asks for a wording repair", () => {
    const res = evaluateScriptLanguageQuality(
      "Indha research packet-la valuation data illa, so source id attach panna mudiyala.",
    );
    expect(res.ok).toBe(false);
    expect(res.action).toBe("repair");
    expect(res.internal.hits.length).toBeGreaterThan(0);
    expect(res.reason).toMatch(/internal tooling language/);
  });
});

describe("missing-data dominance", () => {
  const dominated = [
    "Revenue number not available.",
    "Margin figure not available.",
    "We could not verify the latest quarter.",
    "Valuation data is missing.",
    "Growth numbers are unverified.",
  ].join(" ");

  it("detects a script whose storyline is the missing evidence", () => {
    const d = detectMissingDataDominance(dominated);
    expect(d.mentions).toBeGreaterThan(MISSING_DATA_MAX_MENTIONS);
    expect(d.dominated).toBe(true);
  });

  it("allows one honest hedge in an otherwise substantive script", () => {
    const d = detectMissingDataDominance(
      `${goodScript} Current valuation-ku reliable number kidaikkala, so adha naan guess panna maaten.`,
    );
    expect(d.dominated).toBe(false);
  });

  it("asks for one repair pass first, then hands back research_update_required", () => {
    expect(evaluateScriptLanguageQuality(dominated).action).toBe("repair");
    expect(evaluateScriptLanguageQuality(dominated, { repairAlreadyAttempted: true }).action).toBe(
      "research_update_required",
    );
  });

  it("never repairs facts by invention", () => {
    const note = missingDataRepairNote(detectMissingDataDominance(dominated));
    expect(note).toMatch(/may not add a single new fact/i);
    expect(note).toMatch(/ONE brief, natural hedge/);
  });
});

describe("prompt contracts", () => {
  it("requires jargon to be explained at first use, with the why", () => {
    expect(JARGON_EXPLANATION_CONTRACT).toMatch(/FIRST time a technical term/i);
    expect(JARGON_EXPLANATION_CONTRACT).toMatch(/WHY the number matters/);
    expect(JARGON_EXPLANATION_CONTRACT).toMatch(/EBITDA/);
    expect(JARGON_EXPLANATION_CONTRACT).toMatch(/free cash flow/i);
    expect(JARGON_EXPLANATION_CONTRACT).toMatch(/ROCE/);
    expect(JARGON_EXPLANATION_CONTRACT).toMatch(/never oversimplify into a wrong definition/i);
  });

  it("keeps the audience contract aimed at ordinary retail investors", () => {
    expect(LAYMAN_VOICE_CONTRACT).toMatch(/ORDINARY RETAIL INVESTOR/);
    expect(LAYMAN_VOICE_CONTRACT).toMatch(/One idea per sentence/i);
    expect(LAYMAN_VOICE_CONTRACT).toMatch(/NUMBER → SIMPLE MEANING → WHY IT MATTERS/);
  });
});
