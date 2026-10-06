/**
 * Stable content hash for scripts (client-safe, synchronous).
 *
 * Used to detect human edits: when the current body hash differs from the
 * hash that was audited, the script must be re-audited before approval.
 */
export function contentHash(text: string): string {
  const norm = text.replace(/\s+/g, " ").trim();
  // 64-bit FNV-1a split across two 32-bit lanes — no crypto, no async.
  let h1 = 0x811c9dc5;
  let h2 = 0xc9dc5811;
  for (let i = 0; i < norm.length; i++) {
    const c = norm.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x01000195) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
