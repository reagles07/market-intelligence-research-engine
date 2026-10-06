import { AI_PLACEHOLDER_LABEL } from "./ai.functions";
import type { Language, ScriptFormatKey } from "./domain";
import { DISCLAIMER } from "./domain";

/**
 * Deterministic script scaffolds. These are STRUCTURE ONLY, never research.
 * Every block is marked as placeholder so it can't be mistaken for verified content.
 */

const P = `[${AI_PLACEHOLDER_LABEL}]`;

const LONG_BEATS = [
  [
    "0:00–0:30",
    "HOOK + PROMISE",
    "Open with a contradiction, a surprising number, a hidden risk, or an unexpected market reaction. Do not state the conclusion yet.",
  ],
  [
    "0:30–1:00",
    "CHEAT-SHEET OVERVIEW",
    "Give a partial conclusion. Tell the viewer what the video answers without revealing the verdict.",
  ],
  [
    "1:00–3:00",
    "BUSINESS + MOAT",
    "What the company does, how it makes money, its competitive advantage, the KPIs that matter. End with a micro-hook.",
  ],
  [
    "3:00–6:00",
    "FINANCIAL HEALTH",
    "SHOW the number → EXPLAIN what it is → INTERPRET the trend. Trends over standalone figures.",
  ],
  [
    "6:00–8:00",
    "VALUATION",
    "Cheap, fair or expensive versus its own history, its peers, and its growth?",
  ],
  [
    "8:00–10:00",
    "TECHNICAL + SENTIMENT",
    "Trend, support and resistance, volume, relative strength, market sentiment. Conditional language only.",
  ],
  [
    "10:00–12:00",
    "CATALYSTS + RISKS",
    "IF / THEN reasoning. What has to happen, and what breaks the thesis.",
  ],
  [
    "12:00–13:00+",
    "SCENARIOS + VERDICT + CTA",
    "Bull / Base / Bear, a balanced research conclusion, then the call to action.",
  ],
] as const;

const SHORT_BEATS = [
  ["CHARACTER", "Introduce the company and the story in one line."],
  ["CONFLICT", "Show something unexpected."],
  ["CLUE", "Give one important, verified data point."],
  ["TWIST", "Explain why the obvious conclusion may be wrong."],
  ["CHOICE", "Name the metric or event the viewer should watch next. No buy/sell instruction."],
] as const;

const TANGLISH_NOTE = `Language note — TANGLISH: write natural spoken Tamil in English script. Keep financial
terms in English: Revenue, Profit, Cash Flow, EPS, Valuation, P/E, Guidance, Support,
Resistance, Bull Case, Bear Case, Market, Stock, Capex, Margin. Conversational, made to be
spoken aloud. Example tone: "Revenue vandhu grow aagudhu. Nalla thaan irukku. Aana oru problem
irukku..."`;

const TAMIL_NOTE = `Language note — TAMIL: write in Tamil script. Keep widely used English financial terms
where a Tamil translation would confuse a retail investor.`;

function langNote(language: Language): string {
  if (language === "Tanglish") return TANGLISH_NOTE;
  if (language === "Tamil") return TAMIL_NOTE;
  return "Language note — ENGLISH: plain, conversational, spoken-word English.";
}

export function buildScriptScaffold(args: {
  format: ScriptFormatKey;
  formatLabel: string;
  language: Language;
  company: string;
  ticker: string;
  storyTitle: string;
}): string {
  const { format, formatLabel, language, company, ticker, storyTitle } = args;
  const header = [
    `${P} — structure only, no research content.`,
    `${company} (${ticker}) · ${storyTitle}`,
    `Format: ${formatLabel} · Language: ${language}`,
    "",
    langNote(language),
    "",
    "STORYTELLING RULES: no textbook tone. Use contradictions, questions, plain-language",
    "examples, pattern interrupts and a micro-hook every 30–60 seconds. Vary the wording.",
    "",
    "---",
    "",
  ].join("\n");

  const isLong = format.startsWith("yt_");

  if (format === "short_series") {
    const ideas = [
      "How the company actually makes money",
      "The biggest earnings surprise",
      "The biggest financial red flag",
      "Is it cheap or expensive?",
      "What has to happen next",
    ];
    const parts = ideas
      .map((idea, i) =>
        [
          `### PART ${i + 1} — ${idea}`,
          ...SHORT_BEATS.map(([beat, guide]) => `**${beat}**\n${P} ${guide}`),
          `**ON-SCREEN TEXT:** ${P}`,
          `**SUGGESTED VISUAL:** ${P}`,
          `**CTA:** ${P}`,
          "",
        ].join("\n"),
      )
      .join("\n");
    return `${header}${parts}\n---\n${DISCLAIMER}`;
  }

  if (isLong) {
    const body = LONG_BEATS.map(
      ([time, title, guide]) => `### ${time} — ${title}\n${P} ${guide}\n`,
    ).join("\n");
    return `${header}${body}\n---\n${DISCLAIMER}`;
  }

  const body = SHORT_BEATS.map(([beat, guide]) => `### ${beat}\n${P} ${guide}\n`).join("\n");
  return `${header}${body}\n**ON-SCREEN TEXT:** ${P}\n**SUGGESTED VISUAL:** ${P}\n**CTA:** ${P}\n\n---\n${DISCLAIMER}`;
}

/** Clip-first: standalone Short ideas every research packet should produce. */
export const CLIP_IDEAS = [
  "How the company makes money",
  "Biggest earnings surprise",
  "Biggest financial red flag",
  "Valuation",
  "Key technical level",
  "Major catalyst",
  "Biggest risk",
  "What happens next",
] as const;

export function buildSupportingAsset(assetKey: string, company: string, ticker: string): string {
  if (assetKey === "disclaimer") return DISCLAIMER;
  if (assetKey === "source_list")
    return `${P} List every Tier 1 / Tier 2 source used, with publication dates.`;
  return `${P} ${assetKey} for ${company} (${ticker}) — write verified content here.`;
}
