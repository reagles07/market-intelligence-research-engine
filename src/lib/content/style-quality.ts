/**
 * Advisory style-quality check for the the editorial workspace voice (client-safe).
 *
 * Deterministic and free: no model call. It NEVER blocks a factually valid
 * script — the factual audit stays authoritative. Its only job is to tell the
 * writer where the spoken Tamil drifts from the profile.
 */

export const STYLE_CHECK_KEYS = [
  "natural_spoken_tamil",
  "english_mix",
  "formal_tamil",
  "repeated_connectors",
  "voiceover_readability",
  "sentence_length",
  "pump_tone",
  "coimbatore_consistency",
] as const;
export type StyleCheckKey = (typeof STYLE_CHECK_KEYS)[number];

export type StyleFinding = {
  key: StyleCheckKey;
  label: string;
  status: "PASS" | "WARNING";
  detail: string;
  examples: string[];
};

export type StyleQualityResult = {
  status: "PASS" | "WARNING";
  warningsTotal: number;
  findings: StyleFinding[];
  metrics: Record<string, number>;
  summary: string;
};

/** Written/literary Tamil the profile asks us to avoid in speech. */
const FORMAL_TAMIL = [
  "இன்றைய தினம்",
  "இன்று",
  "ஆகின்றது",
  "ஆகின்றனர்",
  "எனில்",
  "எனவே",
  "ஆதலால்",
  "இதன் காரணமாக",
  "மேற்கொள்ளப்படுகிறது",
  "குறிப்பிடத்தக்கது",
  "பெருமளவில்",
  "வீழ்ச்சியடைந்துள்ளது",
  "அதிகரித்துள்ளது",
];

/** Slang and stereotypes the profile bans outright. */
const BANNED_SLANG = ["machan", "mamey", "maamey", "vera level", "sambavam", "thala", "semma"];

const PUMP_PHRASES = [
  "guaranteed",
  "must buy",
  "sure shot",
  "sureshot",
  "multibagger",
  "100% return",
  "risk free",
  "risk-free",
  "can't lose",
  "rocket",
  "to the moon",
  "definitely go up",
  "நிச்சயம் ஏறும்",
];

/** Connectors that are welcome once or twice and tiring after that. */
const CONNECTORS = [
  "overall-aa paathaa",
  "simple-aa sollanum-na",
  "straight-aa sollanum-na",
  "practical-aa paathaa",
  "இதுல முக்கியமான விஷயம் என்னனா",
  "இங்கதான்",
  "twist",
  "so",
  "aana",
  "ஆனா",
  "ippo",
  "ippa",
  "seri",
  "konjam",
];

const CONNECTOR_LIMIT = 3;

/** Common English finance vocabulary that is expected in this voice. */
const ALLOWED_ENGLISH = new Set(
  [
    "market",
    "stock",
    "business",
    "revenue",
    "profit",
    "risk",
    "growth",
    "data",
    "trend",
    "investor",
    "company",
    "price",
    "target",
    "demand",
    "supply",
    "short",
    "long",
    "term",
    "eps",
    "margin",
    "cash",
    "flow",
    "free",
    "capex",
    "guidance",
    "valuation",
    "support",
    "resistance",
    "bull",
    "base",
    "bear",
    "case",
    "debt",
    "quarter",
    "fy",
    "q1",
    "q2",
    "q3",
    "q4",
    "ttm",
    "ebitda",
    "gaap",
    "fcf",
    "capital",
    "management",
    "analysts",
    "analyst",
    "guidance",
    "earnings",
    "report",
    "update",
    "level",
    "chart",
  ].map((w) => w),
);

const TAMIL_RE = /[\u0B80-\u0BFF]/;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?।])\s+|\n+/)
    .map((s) => s.replace(/[*_#>`]/g, "").trim())
    .filter((s) => s.length > 0);
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function countOccurrences(haystack: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|[^\\p{L}])${escaped}(?![\\p{L}])`, "giu");
  return (haystack.match(re) ?? []).length;
}

const finding = (
  key: StyleCheckKey,
  label: string,
  status: "PASS" | "WARNING",
  detail: string,
  examples: string[] = [],
): StyleFinding => ({ key, label, status, detail, examples });

/**
 * Run every advisory check over the spoken text of a script.
 * `language` decides whether the Tamil-specific checks apply at all.
 */
export function runStyleQuality(spokenText: string, language: string): StyleQualityResult {
  const text = spokenText.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const sents = sentences(spokenText);
  const allWords = words(text);
  const totalWords = allWords.length;
  const isTamilVoice = language === "Tanglish" || language === "Tamil";

  const tamilWords = allWords.filter((w) => TAMIL_RE.test(w)).length;
  const latinWords = allWords.filter((w) => /[A-Za-z]/.test(w) && !TAMIL_RE.test(w)).length;
  const englishShare = totalWords ? latinWords / totalWords : 0;
  const tamilShare = totalWords ? tamilWords / totalWords : 0;

  const findings: StyleFinding[] = [];

  // 1. Natural spoken Tamil presence
  if (isTamilVoice) {
    findings.push(
      tamilShare >= 0.35
        ? finding(
            "natural_spoken_tamil",
            "Natural spoken Tamil",
            "PASS",
            `${Math.round(tamilShare * 100)}% of words are Tamil.`,
          )
        : finding(
            "natural_spoken_tamil",
            "Natural spoken Tamil",
            "WARNING",
            `Only ${Math.round(tamilShare * 100)}% of words are Tamil — this reads as English with Tamil sprinkled in rather than spoken Tamil.`,
          ),
    );
  } else {
    findings.push(
      finding("natural_spoken_tamil", "Natural spoken Tamil", "PASS", "Not a Tamil-voice script."),
    );
  }

  // 2. English mix (profile target: roughly 20–30% English)
  if (isTamilVoice) {
    const unusualEnglish = allWords
      .filter(
        (w) =>
          /^[A-Za-z][A-Za-z'-]{3,}$/.test(w) &&
          !ALLOWED_ENGLISH.has(w.toLowerCase().replace(/[^a-z]/g, "")),
      )
      .slice(0, 8);
    findings.push(
      englishShare <= 0.45
        ? finding(
            "english_mix",
            "English mix",
            "PASS",
            `${Math.round(englishShare * 100)}% English words, within a natural spoken range.`,
          )
        : finding(
            "english_mix",
            "English mix",
            "WARNING",
            `${Math.round(englishShare * 100)}% of words are English — above the 20–30% the profile targets.`,
            unusualEnglish,
          ),
    );
  } else {
    findings.push(
      finding("english_mix", "English mix", "PASS", "Not applicable to this language."),
    );
  }

  // 3. Formal / literary Tamil
  const formalHits = FORMAL_TAMIL.filter((p) => text.includes(p));
  findings.push(
    formalHits.length === 0
      ? finding("formal_tamil", "Formal Tamil", "PASS", "No written-Tamil constructions found.")
      : finding(
          "formal_tamil",
          "Formal Tamil",
          "WARNING",
          `${formalHits.length} formal/literary Tamil expression(s) should be replaced with spoken alternatives.`,
          formalHits,
        ),
  );

  // 4. Repeated connectors
  const overused = CONNECTORS.map((c) => [c, countOccurrences(lower, c.toLowerCase())] as const)
    .filter(([, n]) => n > CONNECTOR_LIMIT)
    .sort((a, b) => b[1] - a[1]);
  findings.push(
    overused.length === 0
      ? finding("repeated_connectors", "Repeated connectors", "PASS", "No connector is overused.")
      : finding(
          "repeated_connectors",
          "Repeated connectors",
          "WARNING",
          `${overused.length} connector(s) repeat more than ${CONNECTOR_LIMIT} times. The phrases are fine — the repetition is not.`,
          overused.map(([c, n]) => `${c} ×${n}`),
        ),
  );

  // 5 + 6. Voiceover readability and sentence length
  const lengths = sents.map((s) => words(s).length);
  const avgLen = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const longOnes = sents.filter((s) => words(s).length > 32);
  findings.push(
    avgLen <= 22
      ? finding(
          "sentence_length",
          "Sentence length",
          "PASS",
          `Average ${avgLen.toFixed(1)} words per sentence.`,
        )
      : finding(
          "sentence_length",
          "Sentence length",
          "WARNING",
          `Average ${avgLen.toFixed(1)} words per sentence — long for a voiceover.`,
        ),
  );
  const brackets = (text.match(/\([^)]{25,}\)/g) ?? []).length;
  findings.push(
    longOnes.length === 0 && brackets === 0
      ? finding(
          "voiceover_readability",
          "Voiceover readability",
          "PASS",
          "Every sentence is comfortable to read aloud.",
        )
      : finding(
          "voiceover_readability",
          "Voiceover readability",
          "WARNING",
          `${longOnes.length} sentence(s) run past 32 words${brackets ? ` and ${brackets} long bracketed aside(s)` : ""} — hard to speak in one breath.`,
          longOnes.slice(0, 3).map((s) => s.slice(0, 120)),
        ),
  );

  // 7. Pump / sensational tone
  const pumpHits = PUMP_PHRASES.filter((p) => lower.includes(p.toLowerCase()));
  const exclamations = (text.match(/!/g) ?? []).length;
  findings.push(
    pumpHits.length === 0 && exclamations <= 3
      ? finding("pump_tone", "Pump / sensational tone", "PASS", "Calm and grounded throughout.")
      : finding(
          "pump_tone",
          "Pump / sensational tone",
          "WARNING",
          `${pumpHits.length} promotional phrase(s)${exclamations > 3 ? ` and ${exclamations} exclamation marks` : ""} detected.`,
          pumpHits,
        ),
  );

  // 8. Coimbatore consistency — subtle regional feel, no caricature
  const slangHits = BANNED_SLANG.filter((p) => countOccurrences(lower, p) > 0);
  const connectorPresence = CONNECTORS.reduce(
    (n, c) => n + countOccurrences(lower, c.toLowerCase()),
    0,
  );
  let coimbatore: StyleFinding;
  if (!isTamilVoice) {
    coimbatore = finding(
      "coimbatore_consistency",
      "Coimbatore style consistency",
      "PASS",
      "Not applicable.",
    );
  } else if (slangHits.length) {
    coimbatore = finding(
      "coimbatore_consistency",
      "Coimbatore style consistency",
      "WARNING",
      "Exaggerated slang detected — the regional influence must stay subtle and respectable.",
      slangHits,
    );
  } else if (totalWords > 120 && connectorPresence === 0) {
    coimbatore = finding(
      "coimbatore_consistency",
      "Coimbatore style consistency",
      "WARNING",
      "No natural spoken connectors at all — the delivery reads translated rather than spoken.",
    );
  } else {
    coimbatore = finding(
      "coimbatore_consistency",
      "Coimbatore style consistency",
      "PASS",
      "Regional feel is present without caricature.",
    );
  }
  findings.push(coimbatore);

  const warnings = findings.filter((f) => f.status === "WARNING");
  return {
    status: warnings.length ? "WARNING" : "PASS",
    warningsTotal: warnings.length,
    findings,
    metrics: {
      words: totalWords,
      sentences: sents.length,
      avgSentenceWords: Number(avgLen.toFixed(1)),
      englishSharePct: Math.round(englishShare * 100),
      tamilSharePct: Math.round(tamilShare * 100),
      longSentences: longOnes.length,
    },
    summary: warnings.length
      ? `Advisory: ${warnings.length} style warning(s) — ${warnings.map((w) => w.label).join(", ")}. These do not block the script.`
      : "Style reads natural, spoken and on-voice.",
  };
}
