/**
 * SEC filing Item extraction (server only).
 *
 * Minimal capability: fetch the primary document of a filing we already know
 * (cik + accession + primary document) through the existing throttled SEC
 * adapter, and deterministically parse the official Item headings out of the
 * document text. No AI, no guessing — only explicit "Item N.NN" headings.
 */
import { callSec } from "@/lib/sec.server";
import { SEC_WWW_BASE } from "@/lib/sec/constants";

export type FilingItem = { item: string; heading: string };

const ITEM_TITLES: Record<string, string> = {
  "2.02": "Results of Operations and Financial Condition",
};

/** Strip tags/entities so heading text is comparable. */
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractItemsFromText(text: string): FilingItem[] {
  const found = new Map<string, string>();
  // Explicit "Item 2.02 Results of Operations and Financial Condition"
  const re = /item\s+(\d\.\d{2})\s*[.:\u2014\u2013-]?\s*([A-Za-z][A-Za-z ,'/&()-]{0,90})?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const num = m[1]!;
    const heading = (m[2] ?? "")
      .trim()
      .replace(/\s+(On|The|Item)\b.*$/, "")
      .trim();
    const prev = found.get(num);
    if (!prev || (heading && heading.length > prev.length)) {
      found.set(num, heading || ITEM_TITLES[num] || "");
    }
  }
  return [...found.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([item, heading]) => ({ item, heading }));
}

export function documentUrl(cik: string, accession: string, primaryDoc: string | null): string {
  const bare = String(Number(String(cik).replace(/\D/g, "")));
  const acc = accession.replace(/-/g, "");
  return primaryDoc
    ? `/Archives/edgar/data/${bare}/${acc}/${primaryDoc}`
    : `/Archives/edgar/data/${bare}/${acc}/${accession}.txt`;
}

/**
 * Fetch and parse the Item headings of one known filing.
 * Returns null when the document could not be retrieved.
 */
export async function fetchFilingItems(args: {
  cik: string;
  accessionNumber: string;
  primaryDocument: string | null;
  userId?: string | null;
}): Promise<{ ok: boolean; items: FilingItem[]; url: string; error: string | null }> {
  const endpoint = documentUrl(args.cik, args.accessionNumber, args.primaryDocument);
  const url = `${SEC_WWW_BASE}${endpoint}`;
  const res = await callSec({ endpoint, host: "www", userId: args.userId ?? null });
  if (!res.ok || typeof res.data !== "string") {
    return {
      ok: false,
      items: [],
      url,
      error: res.error ?? "Filing document was not returned as text.",
    };
  }
  return { ok: true, items: extractItemsFromText(toText(res.data)), url, error: null };
}
