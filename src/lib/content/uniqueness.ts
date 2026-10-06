/**
 * Lightweight near-duplicate detection for a Shorts pack (client-safe, pure).
 *
 * Six Shorts written from one research packet can quietly collapse into six
 * paraphrases of the same sentence. This module gives the generator a cheap,
 * deterministic way to notice that and ask for one targeted rewrite — it never
 * changes any content itself and never touches evidence.
 */

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "were",
  "it",
  "this",
  "that",
  "with",
  "as",
  "at",
  "by",
  "from",
  "be",
  "oru",
  "adhu",
  "idhu",
  "aana",
  "nu",
  "na",
  "than",
  "thaan",
  "vandhu",
  "irukku",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/** Jaccard similarity of the two token sets. 0 = disjoint, 1 = identical. */
export function similarity(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared += 1;
  return shared / (sa.size + sb.size - shared);
}

/** Above this, two Shorts are treated as near-duplicates of one another. */
export const NEAR_DUPLICATE_THRESHOLD = 0.55;

export type DuplicatePair = { a: number; b: number; score: number };

/**
 * Every pair of Shorts whose text overlaps beyond the threshold, plus the
 * indexes that should be rewritten (the later member of each pair).
 */
export function findNearDuplicates(
  texts: string[],
  threshold = NEAR_DUPLICATE_THRESHOLD,
): { pairs: DuplicatePair[]; rewriteIndexes: number[] } {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const score = similarity(texts[i] ?? "", texts[j] ?? "");
      if (score >= threshold) pairs.push({ a: i, b: j, score: Number(score.toFixed(3)) });
    }
  }
  const rewriteIndexes = [...new Set(pairs.map((p) => p.b))].sort((x, y) => x - y);
  return { pairs, rewriteIndexes };
}

/** Human-readable note stored in generation_meta and shown to the creator. */
export function duplicateNote(pairs: DuplicatePair[]): string | null {
  if (!pairs.length) return null;
  return pairs
    .map((p) => `Short ${p.a + 1} and Short ${p.b + 1} overlap ${Math.round(p.score * 100)}%`)
    .join("; ");
}
