/**
 * Phase 2B — semantic material-change detection for research packets.
 *
 * Packet versioning must follow SEMANTIC research change, never row
 * housekeeping. Every entity that can justify a new packet version is reduced
 * to a deterministic fingerprint built exclusively from meaning-bearing
 * fields; volatile timestamps (created_at, updated_at, retrieved_at,
 * last_checked_at, run/audit timestamps) and row ordering are excluded by
 * construction.
 */

import type { Db } from "@/lib/ai/context.server";

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Small, stable, dependency-free string hash (FNV-1a, hex). */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const fp = (parts: unknown[]) => hash(parts.map(norm).join("\u0001"));

/** Confidence only matters when it crosses an interpretation band. */
const confidenceBand = (v: unknown) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n === 0) return "none";
  const scaled = n > 1 ? n / 100 : n;
  if (scaled >= 0.8) return "high";
  if (scaled >= 0.5) return "medium";
  return "low";
};

export type EvidenceSnapshot = {
  hash: string;
  claims: Record<string, string>;
  sources: Record<string, string>;
  conflicts: Record<string, string>;
  sections: Record<string, string>;
  gaps: Record<string, string>;
};

const EMPTY: EvidenceSnapshot = {
  hash: "",
  claims: {},
  sources: {},
  conflicts: {},
  sections: {},
  gaps: {},
};

/** Rows are read with their volatile columns so "timestamp-only" churn can be reported. */
export async function buildEvidenceSnapshot(
  db: Db,
  args: { storyId: string; companyId: string; packetId?: string | null },
): Promise<{ snapshot: EvidenceSnapshot; touchedAt: Record<string, string> }> {
  const [claims, sources, conflicts, sections, gaps] = await Promise.all([
    db
      .from("claims")
      .select(
        "id,claim_text,claim_category,verification_status,value,unit,reporting_period,confidence,is_critical,source_id,updated_at",
      )
      .eq("story_id", args.storyId),
    db
      .from("sources")
      .select("id,title,url,canonical_url,publisher,source_type,source_tier,story_id,updated_at")
      .eq("company_id", args.companyId),
    db
      .from("provider_data_conflicts")
      .select("id,field,entity,existing_value,incoming_value,resolution,updated_at")
      .eq("company_id", args.companyId),
    args.packetId
      ? db
          .from("research_sections")
          .select("id,section_key,content,updated_at")
          .eq("packet_id", args.packetId)
      : Promise.resolve({ data: [] }),
    db
      .from("research_gaps")
      .select("id,gap_key,status,classification,resolution_type,updated_at")
      .eq("story_id", args.storyId),
  ]);

  const snapshot: EvidenceSnapshot = {
    hash: "",
    claims: {},
    sources: {},
    conflicts: {},
    sections: {},
    gaps: {},
  };
  const touchedAt: Record<string, string> = {};

  for (const c of claims.data ?? []) {
    snapshot.claims[String(c["id"])] = fp([
      c["claim_text"],
      c["claim_category"],
      c["verification_status"],
      c["value"],
      c["unit"],
      c["reporting_period"],
      confidenceBand(c["confidence"]),
      c["is_critical"] ? "critical" : "normal",
      c["source_id"],
    ]);
    touchedAt[`claim:${c["id"]}`] = String(c["updated_at"] ?? "");
  }
  for (const s of sources.data ?? []) {
    snapshot.sources[String(s["id"])] = fp([
      s["canonical_url"] ?? s["url"],
      s["source_tier"],
      s["source_type"],
      s["publisher"],
      s["story_id"],
      s["title"],
    ]);
    touchedAt[`source:${s["id"]}`] = String(s["updated_at"] ?? "");
  }
  for (const k of conflicts.data ?? []) {
    snapshot.conflicts[String(k["id"])] = fp([
      k["field"],
      k["entity"],
      k["existing_value"],
      k["incoming_value"],
      k["resolution"] ? "resolved" : "open",
      k["resolution"],
    ]);
    touchedAt[`conflict:${k["id"]}`] = String(k["updated_at"] ?? "");
  }
  for (const r of sections.data ?? []) {
    snapshot.sections[String(r["section_key"] ?? r["id"])] = fp([r["content"]]);
    touchedAt[`section:${r["id"]}`] = String(r["updated_at"] ?? "");
  }
  for (const g of gaps.data ?? []) {
    snapshot.gaps[String(g["id"])] = fp([
      g["gap_key"],
      g["status"],
      g["classification"],
      g["resolution_type"],
    ]);
    touchedAt[`gap:${g["id"]}`] = String(g["updated_at"] ?? "");
  }

  const flat = (o: Record<string, string>) =>
    Object.keys(o)
      .sort()
      .map((k) => `${k}=${o[k]}`)
      .join("|");
  snapshot.hash = hash(
    [
      flat(snapshot.claims),
      flat(snapshot.sources),
      flat(snapshot.conflicts),
      flat(snapshot.sections),
      flat(snapshot.gaps),
    ].join("\u0002"),
  );

  return { snapshot, touchedAt };
}

export type PacketDelta = {
  material: boolean;
  reasons: string[];
  counts: {
    newClaims: number;
    changedClaims: number;
    removedClaims: number;
    newSources: number;
    changedSources: number;
    removedSources: number;
    conflictDelta: number;
    sectionDelta: number;
    resolvedGapDelta: number;
    timestampOnlyIgnored: number;
  };
  detail: string;
  snapshot: EvidenceSnapshot;
};

function diff(prev: Record<string, string>, next: Record<string, string>) {
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [k, v] of Object.entries(next)) {
    if (!(k in prev)) added.push(k);
    else if (prev[k] !== v) changed.push(k);
  }
  for (const k of Object.keys(prev)) if (!(k in next)) removed.push(k);
  return { added, changed, removed };
}

/**
 * Compare the current evidence with the snapshot stored on the reference
 * packet. `since` is used only for the "timestamp-only changes ignored"
 * explanation, never to decide materiality.
 */
export function computePacketDelta(args: {
  previous: EvidenceSnapshot | null;
  current: EvidenceSnapshot;
  touchedAt: Record<string, string>;
  since: string | null;
}): PacketDelta {
  const prev = args.previous ?? EMPTY;
  const hasBaseline = Boolean(args.previous && args.previous.hash);

  const c = diff(prev.claims, args.current.claims);
  const s = diff(prev.sources, args.current.sources);
  const k = diff(prev.conflicts, args.current.conflicts);
  const sec = diff(prev.sections, args.current.sections);
  const g = diff(prev.gaps, args.current.gaps);

  const changedIds = new Set<string>([
    ...c.added.map((i) => `claim:${i}`),
    ...c.changed.map((i) => `claim:${i}`),
    ...s.added.map((i) => `source:${i}`),
    ...s.changed.map((i) => `source:${i}`),
    ...k.added.map((i) => `conflict:${i}`),
    ...k.changed.map((i) => `conflict:${i}`),
    ...g.added.map((i) => `gap:${i}`),
    ...g.changed.map((i) => `gap:${i}`),
  ]);

  let timestampOnlyIgnored = 0;
  if (args.since) {
    for (const [key, ts] of Object.entries(args.touchedAt)) {
      if (!ts) continue;
      if (changedIds.has(key)) continue;
      if (key.startsWith("section:")) continue;
      if (ts > args.since) timestampOnlyIgnored += 1;
    }
  }

  const counts = {
    newClaims: c.added.length,
    changedClaims: c.changed.length,
    removedClaims: c.removed.length,
    newSources: s.added.length,
    changedSources: s.changed.length,
    removedSources: s.removed.length,
    conflictDelta: k.added.length + k.changed.length + k.removed.length,
    sectionDelta: sec.added.length + sec.changed.length + sec.removed.length,
    resolvedGapDelta: g.added.length + g.changed.length,
    timestampOnlyIgnored,
  };

  const reasons: string[] = [];
  if (!hasBaseline) reasons.push("no evidence snapshot on the reference packet");
  if (counts.newClaims) reasons.push(`${counts.newClaims} new claim(s)`);
  if (counts.changedClaims) reasons.push(`${counts.changedClaims} semantically changed claim(s)`);
  if (counts.removedClaims) reasons.push(`${counts.removedClaims} removed claim(s)`);
  if (counts.newSources) reasons.push(`${counts.newSources} new source(s)`);
  if (counts.changedSources) reasons.push(`${counts.changedSources} materially changed source(s)`);
  if (counts.removedSources) reasons.push(`${counts.removedSources} removed source(s)`);
  if (counts.conflictDelta) reasons.push(`${counts.conflictDelta} conflict change(s)`);
  if (counts.resolvedGapDelta) reasons.push(`${counts.resolvedGapDelta} research-gap change(s)`);
  // Section content is written BY the packet build, so it never justifies one.

  const material = reasons.length > 0;
  const detail = material
    ? reasons.join(", ") +
      (timestampOnlyIgnored ? ` (${timestampOnlyIgnored} timestamp-only change(s) ignored)` : "")
    : `no semantic change${timestampOnlyIgnored ? ` — ${timestampOnlyIgnored} timestamp-only change(s) ignored` : ""}`;

  return { material, reasons, counts, detail, snapshot: args.current };
}

/** Read the stored snapshot of a packet (null for legacy packets). */
export async function readPacketSnapshot(
  db: Db,
  packetId: string,
): Promise<EvidenceSnapshot | null> {
  const { data } = await db
    .from("research_packets")
    .select("evidence_snapshot")
    .eq("id", packetId)
    .maybeSingle();
  const raw = data?.["evidence_snapshot"];
  return raw && typeof raw === "object" ? { ...EMPTY, ...(raw as EvidenceSnapshot) } : null;
}

export async function writePacketSnapshot(db: Db, packetId: string, snapshot: EvidenceSnapshot) {
  await db
    .from("research_packets")
    .update({ evidence_snapshot: snapshot as never })
    .eq("id", packetId);
}
