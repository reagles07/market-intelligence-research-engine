import { runOwnerAcceptance } from "./security/owner-cli";
import { jsonArray, jsonObject, requireValue } from "../src/lib/data-types";
import type { Database } from "../src/integrations/supabase/types";
/**
 * Evidence lineage maintenance (one-off, server-side).
 *
 *  A. Backfill evidence provenance for existing claims whose supporting metric
 *     keys were only recorded in their AI notes.
 *  B. Read the actual primary SEC document for a company's 8-K filings and
 *     store the official Item headings found in it.
 *  C. Adjudicate Item-number claims against that primary evidence only.
 *
 * Nothing is fabricated: claims are promoted only when the filing explicitly
 * contains the Item, and left untouched otherwise.
 *
 * Run: P2D_USER=<uuid> GP_STORY=<story uuid> bun scripts/evidence-backfill.ts
 */
import { createClient } from "@supabase/supabase-js";

import { buildClaimEvidence } from "../src/lib/research/evidence.server";
import { fetchFilingItems } from "../src/lib/sec/items.server";
import { isClaimTraceable } from "../src/lib/research/traceability";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const STORY_ID = process.env["GP_STORY"]!;
const USER = process.env["P2D_USER"]!;
const log = (...a: unknown[]) => console.log(...a);

const ITEM_RE = /item\s+(\d\.\d{2})/i;

async function main() {
  const { data: story } = await admin
    .from("stories")
    .select("id,company_id")
    .eq("id", STORY_ID)
    .maybeSingle();
  const companyId = String(requireValue(story, "story").company_id);

  // ---------------------------------------------------------------- A. backfill
  const { data: claimRows } = await admin
    .from("claims")
    .select(
      "id,claim_text,claim_category,verification_status,notes,source_id,evidence_type,evidence_metric_keys",
    )
    .eq("company_id", companyId);
  const claims = claimRows ?? [];

  let backfilled = 0;
  let metricTraceable = 0;
  for (const c of claims) {
    if (c.evidence_type && c.evidence_type !== "NONE") continue;
    const notes = String(c.notes ?? "");
    const line = notes.split("\n").find((l) => l.startsWith("Supporting metrics:"));
    const keys = (line ?? "")
      .replace("Supporting metrics:", "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "none");
    const srcLine = notes.split("\n").find((l) => l.startsWith("Supporting sources:"));
    const sourceIds = (srcLine ?? "")
      .replace("Supporting sources:", "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "none");
    if (!keys.length && !c.source_id && !sourceIds.length) continue;

    const evidence = await buildClaimEvidence(db, {
      companyId,
      sourceIds: c.source_id ? [String(c.source_id), ...sourceIds] : sourceIds,
      metricKeys: keys,
      claimCategory: c.claim_category,
    });
    await admin
      .from("claims")
      .update({ ...evidence, source_id: c.source_id ?? evidence.source_id } as never)
      .eq("id", c.id);
    backfilled += 1;
    if (isClaimTraceable({ ...c, ...evidence } as never).traceable && !c.source_id)
      metricTraceable += 1;
  }
  log(
    `A. Backfilled evidence provenance on ${backfilled} claim(s); ${metricTraceable} now metric-traceable.`,
  );

  // ------------------------------------------------- B. primary SEC item read
  const { data: filingRows } = await admin
    .from("sec_filings")
    .select("id,cik,form,filing_date,accession_number,primary_document,url,source_id,filing_items")
    .eq("company_id", companyId)
    .eq("form", "8-K")
    .order("filing_date", { ascending: false })
    .limit(3);
  const filings = filingRows ?? [];

  for (const f of filings) {
    if (Array.isArray(f.filing_items) && f.filing_items.length) {
      log(
        `B. ${f.filing_date} ${f.accession_number}: items already stored — ${f.filing_items.map((i) => jsonObject(i)["item"]).join(", ")}`,
      );
      continue;
    }
    const res = await fetchFilingItems({
      cik: f.cik,
      accessionNumber: f.accession_number,
      primaryDocument: f.primary_document,
      userId: USER,
    });
    log(
      `B. ${f.filing_date} ${f.accession_number}: ${res.ok ? `items ${res.items.map((i) => i["item"]).join(", ") || "none found"}` : `fetch failed — ${res.error}`}`,
    );
    if (res.ok) {
      await admin
        .from("sec_filings")
        .update({
          filing_items: res.items as never,
          items_extracted_at: new Date().toISOString(),
        } as never)
        .eq("id", f.id);
      f.filing_items = res.items;
    }
  }

  // ------------------------------------------------- C. adjudicate item claims
  const itemClaims = claims.filter(
    (c) => ITEM_RE.test(String(c.claim_text)) && String(c.claim_text).toLowerCase().includes("8-k"),
  );
  log(`C. ${itemClaims.length} Item-number claim(s) to adjudicate.`);

  for (const c of itemClaims) {
    const num = ITEM_RE.exec(String(c.claim_text))![1]!;
    const dateMatch = /(\w+ \d{1,2}, \d{4})/.exec(String(c.claim_text));
    const target = dateMatch ? new Date(dateMatch[1]!).toISOString().slice(0, 10) : null;
    const filing = filings.find((f) => target && String(f.filing_date) === target) ?? null;
    if (!filing) {
      log(
        `   · "${String(c.claim_text).slice(0, 70)}…" — no stored filing matches ${target}; left as ${c.verification_status}.`,
      );
      continue;
    }
    const items = jsonArray(filing.filing_items).map(jsonObject);
    const hit = items.find((i) => i["item"] === num);
    if (!hit) {
      log(
        `   · Item ${num} NOT present in ${filing.accession_number} (items: ${items.map((i) => i["item"]).join(", ") || "none"}) — kept ${c.verification_status}, not forced.`,
      );
      continue;
    }
    const evidence = await buildClaimEvidence(db, {
      companyId,
      sourceIds: filing.source_id ? [String(filing.source_id)] : [],
      metricKeys: [],
      claimCategory: "FACT",
    });
    await admin
      .from("claims")
      .update({
        verification_status: filing.source_id ? "Verified" : c.verification_status,
        claim_category: "FACT",
        source_id: filing.source_id ?? null,
        evidence_type: "SOURCE",
        sec_filing_id: filing.id,
        evidence_provider: "SEC EDGAR",
        evidence_accession: filing.accession_number,
        evidence_period: String(filing.filing_date),
        evidence_detail: {
          ...(evidence.evidence_detail ?? {}),
          form: filing.form,
          filing_url: filing.url,
          filing_items: items.map((i) => i["item"]).join(", "),
          item_matched: num,
          item_heading: hit["heading"],
          verification_basis: "Primary SEC filing document explicitly contains this Item heading.",
        } as never,
        notes: [
          "[SEC-ITEM-VERIFY] primary-document",
          `Item ${num} found in ${filing.accession_number} (${filing.url})`,
          `Heading: ${hit["heading"] || "(no inline heading text)"}`,
          `Filing items present: ${items.map((i) => i["item"]).join(", ")}`,
        ].join("\n"),
      } as never)
      .eq("id", c.id);
    log(
      `   · Item ${num} CONFIRMED in ${filing.accession_number} → claim verified against Tier-1 SEC source.`,
    );
  }

  // ---------------------------------------------------------------- summary
  const { data: after } = await admin
    .from("claims")
    .select(
      "verification_status,is_critical,source_id,evidence_type,evidence_metric_keys,financial_period_id,sec_fact_id,sec_filing_id,evidence_provider,evidence_accession,evidence_period,evidence_detail",
    )
    .eq("story_id", STORY_ID);
  const list = after ?? [];
  const supported = list.filter(
    (c) => c.verification_status === "Verified" || c.verification_status === "Attributed",
  );
  const bySource = supported.filter((c) => c.source_id).length;
  const byMetric = supported.filter(
    (c) =>
      !c.source_id &&
      isClaimTraceable({ ...c, evidence_detail: jsonObject(c.evidence_detail) }).traceable,
  ).length;
  const untraceable = supported.filter(
    (c) => !isClaimTraceable({ ...c, evidence_detail: jsonObject(c.evidence_detail) }).traceable,
  );
  log(
    `\nStory claims: supported ${supported.length} · source-backed ${bySource} · metric-backed ${byMetric} · untraceable ${untraceable.length}`,
  );
  for (const u of untraceable)
    log(
      `   untraceable: ${isClaimTraceable({ ...u, evidence_detail: jsonObject(u.evidence_detail) }).reason}`,
    );
}

runOwnerAcceptance(main).catch((e) => {
  console.error(e);
  process.exit(1);
});
