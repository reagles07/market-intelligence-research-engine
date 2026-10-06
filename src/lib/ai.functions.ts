/**
 * AI operation placeholders (Phase 1).
 *
 * These are the backend entry points the future AI layer will implement:
 *   analyze-story, verify-claims, generate-research-summary, generate-scenarios,
 *   generate-long-script, generate-short-script, generate-content-package.
 *
 * No AI provider is connected in Phase 1. Every function returns clearly
 * labelled placeholder output. Nothing here simulates real research.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const AI_PLACEHOLDER_LABEL = "AI PLACEHOLDER OUTPUT";

const ctx = z.object({
  company: z.string(),
  ticker: z.string(),
  story: z.string().optional(),
  language: z.string().optional(),
  format: z.string().optional(),
});

type Ctx = z.infer<typeof ctx>;

function placeholder(operation: string, c: Ctx, sections: string[]): string {
  return [
    `[${AI_PLACEHOLDER_LABEL}]`,
    `Operation: ${operation}`,
    `Company: ${c.company} (${c.ticker})`,
    c.story ? `Story: ${c.story}` : null,
    c.language ? `Language: ${c.language}` : null,
    c.format ? `Format: ${c.format}` : null,
    "",
    "No AI provider is connected. The structure below is the contract this",
    "operation will fill once a provider is configured. Replace each section",
    "with your own verified research before requesting approval.",
    "",
    ...sections.map((s) => `## ${s}\n[${AI_PLACEHOLDER_LABEL} — write verified content here]\n`),
  ]
    .filter(Boolean)
    .join("\n");
}

const make = (operation: string, sections: string[]) =>
  createServerFn({ method: "POST" })
    .middleware([requireSupabaseAuth])
    .inputValidator((i: unknown) => ctx.parse(i))
    .handler(async ({ data }) => ({
      provider: null as string | null,
      isPlaceholder: true,
      operation,
      output: placeholder(operation, data, sections),
    }));

export const analyzeStory = make("analyze-story", [
  "What Happened",
  "Primary Catalyst",
  "Why It Matters",
  "Open Questions",
]);

export const verifyClaims = make("verify-claims", [
  "Claims Requiring Primary Sources",
  "Conflicting Claims",
  "Unsupported Claims",
  "Suggested Cross-Checks",
]);

export const generateResearchSummary = make("generate-research-summary", [
  "Story Summary",
  "Business & Moat",
  "Financial Health",
  "Valuation",
  "Technical & Sentiment",
  "Catalysts & Risks",
]);

export const generateScenarios = make("generate-scenarios", [
  "Bull Case",
  "Base Case",
  "Bear Case",
  "Invalidation Conditions",
]);

export const generateLongScript = make("generate-long-script", [
  "0:00–0:30 Hook + Promise",
  "0:30–1:00 Cheat-Sheet Overview",
  "1:00–3:00 Business + Moat",
  "3:00–6:00 Financial Health",
  "6:00–8:00 Valuation",
  "8:00–10:00 Technical + Sentiment",
  "10:00–12:00 Catalysts + Risks",
  "12:00+ Scenarios + Verdict + CTA",
]);

export const generateShortScript = make("generate-short-script", [
  "Character",
  "Conflict",
  "Clue",
  "Twist",
  "Choice",
]);

export const generateContentPackage = make("generate-content-package", [
  "YouTube Titles",
  "Thumbnail Text",
  "YouTube Description",
  "Instagram Caption",
  "Hashtags",
  "B-Roll Ideas",
  "Chart Ideas",
  "CTA",
  "Disclaimer",
]);
