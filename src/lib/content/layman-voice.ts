/**
 * Audience contract for every spoken script (browser-safe constant).
 *
 * The viewer is an ordinary retail investor, not a finance professional. This
 * block sits between the safety rules and the brand voice: it changes HOW a
 * fact is explained, never WHICH facts may be stated.
 */

export const LAYMAN_VOICE_CONTRACT = `AUDIENCE — ORDINARY RETAIL INVESTOR (this governs how everything is explained):
- The viewer buys shares sometimes and knows basic investing, but does NOT understand dense
  finance jargon. Sound like a smart friend explaining a business clearly, never like a
  research analyst reading a report.
- One idea per sentence. Short spoken sentences.
- Jargon is allowed only when it is genuinely useful. The FIRST time an important finance term
  appears, explain it immediately in plain language, in the same breath.
- Every important number follows NUMBER → SIMPLE MEANING → WHY IT MATTERS: state the figure,
  say in plain words what it actually means, then answer "why should a normal shareholder care?"
  in one sentence.
- Never stack unexplained terms. Do not put EBITDA, ROCE, FCF, PEG, RSI and similar terms in
  one paragraph without explaining each one as it appears.
- Explain the business BEFORE the stock: what it sells, who pays, how the money arrives, why
  customers stay or leave.
- Analogies may be used to EXPLAIN something evidenced. An analogy may never introduce a fact,
  a number or an event that the research does not contain.
- Fact and interpretation stay audibly separate. No hype, no guaranteed returns, no buy or
  sell instruction.
STYLE EXAMPLES ONLY — never copy this wording, write your own each time:
- "EBITDA margin 18%. Simple-aa sonna, core business-la 100 rupees sales-ku around 18 rupees
  operating profit-type earning irukku, interest, tax, depreciation-ku munnadi."
- "Free cash flow-na, business expenses and required capex mudinju company kai-la actually
  cash-aa micham irukkuradhu."
- "P/E 35x-na, current annual earnings-oda roughly 35 times price-la stock trade aagudhu."`;

/**
 * Jargon contract — finance terms stay, but never unexplained.
 *
 * This is a STYLE rule: it changes how a term is introduced, never which facts
 * may be stated. Explanations must stay accurate; a simpler wording that is
 * wrong is worse than the jargon.
 */
export const JARGON_EXPLANATION_CONTRACT = `EXPLAIN JARGON AS YOU USE IT (hard style rule):
- Finance terms are allowed and often useful. What is banned is an UNEXPLAINED jargon dump.
- The FIRST time a technical term matters in the script, give a short plain-language meaning in
  the same breath — one clause, spoken register, no glossary tone.
- Always answer WHY the number matters, not only WHAT it is. A figure with no consequence for a
  normal shareholder should not be in the script.
- Prefer a concrete rupee/dollar example or a simple analogy when it is accurate. An analogy may
  never introduce a fact, number or event that the research does not contain.
- One concept per sentence. Short voiceover-friendly lines.
- Never oversimplify into a wrong definition. If a term cannot be explained correctly in one
  short clause, either explain it in two short sentences or do not use the term at all.
- Terms that ALWAYS need a first-use explanation when a normal viewer may not know them:
  EBITDA / EBITDA margin, operating margin, P/E, EV/EBITDA, free cash flow, ROCE, ROE, capex,
  working capital, order book, ARPU, same-store growth, dilution, deleveraging, guidance.
STYLE EXAMPLES ONLY — never reuse this wording verbatim:
- "EBITDA margin 18% — simple-aa sonna, interest, tax, depreciation-ku munnadi, every 100 rupees
  revenue-la roughly 18 rupees operating profit level-la remain aagudhu."
- "P/E 35x — market indha company-oda one rupee annual earnings-ku 35 rupees price pay panradhu."
- "Free cash flow-na, business expenses and required capex mudichitu company-kitta actually
  leftover-a irukkura cash."
- "ROCE — company use panra capital-la evlo efficiently operating profit generate panrathu."`;

/**
 * First-use glossary (deterministic, browser-safe).
 *
 * These are STYLE aids, not facts: they tell the model how to explain a term
 * the first time it matters. They never introduce a number or an event.
 */
export const FIRST_USE_GLOSSARY: Record<string, string> = {
  "ebitda margin":
    "interest, tax, depreciation-ku munnadi, 100 rupees sales-la evlo operating profit micham nu kaatra measure",
  "operating margin": "100 rupees sales panna operating level-la evlo rupees micham aagudhu",
  "free cash flow":
    "business expenses and capex mudinja piragu company kai-la actually meethi irukkura cash",
  "p/e": "market oru rupee annual earnings-ku evlo rupees price kudukuthu",
  "ev/ebitda": "whole business value, operating profit-oda ethana madangu nu compare panra measure",
  roce: "business-la potta capital evlo efficiently operating return generate pannudhu",
  roe: "shareholder money-la evlo return varuthu",
  capex: "factory, equipment, expansion maadhiri long-term assets-ku company panra spending",
  "working capital": "day-to-day operations nadatha thevaipadura short-term money",
  "order book": "already confirm aagi, innum execute panna vendiya work value",
  arpu: "oru customer kitta irundhu average-a varum revenue",
  dilution: "new shares varradhu naala existing shareholders-oda share percentage kammi aagardhu",
  guidance: "company thaane sollura future performance expectation",
  bps: "basis points — 100 bps-na 1 percentage point",
};

/** Terms present in the text that a normal viewer may need explained. */
export function termsNeedingExplanation(text: string): string[] {
  const lower = String(text ?? "").toLowerCase();
  return Object.keys(FIRST_USE_GLOSSARY).filter((term) => lower.includes(term));
}

/** Prompt fragment listing plain-language meanings for the terms in play. */
export function glossaryHint(terms: string[]): string {
  const rows = terms
    .map(
      (t) =>
        FIRST_USE_GLOSSARY[t.toLowerCase()] &&
        `- ${t.toUpperCase()}: ${FIRST_USE_GLOSSARY[t.toLowerCase()]}`,
    )
    .filter(Boolean);
  if (!rows.length) return "";
  return `FIRST-USE PLAIN MEANINGS (explain in your own spoken wording, never copy verbatim, never add numbers):\n${rows.join("\n")}`;
}
