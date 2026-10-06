/**
 * Per-company evidence separation for multi-stock scripts (client-safe, pure).
 *
 * Every evidence id in the studio is globally unique, which makes cross-company
 * leakage detectable deterministically: an id cited inside company A's segment
 * that belongs to company B is dropped and reported, never silently accepted.
 */

export type CompanyEvidence = {
  companyId: string;
  claimIds: string[];
  sourceIds: string[];
  researchSectionIds: string[];
  metricKeys: string[];
};

export type EvidenceIndex = {
  /** evidence id → owning company id */
  owner: Map<string, string>;
  byCompany: Map<string, Set<string>>;
};

export function buildEvidenceIndex(companies: CompanyEvidence[]): EvidenceIndex {
  const owner = new Map<string, string>();
  const byCompany = new Map<string, Set<string>>();
  for (const c of companies) {
    const set = new Set<string>();
    for (const id of [...c.claimIds, ...c.sourceIds, ...c.researchSectionIds, ...c.metricKeys]) {
      set.add(id);
      // First writer wins: an id shared by two companies is a data problem, not
      // a licence to mix — it stays owned by the company that declared it first.
      if (!owner.has(id)) owner.set(id, c.companyId);
    }
    byCompany.set(c.companyId, set);
  }
  return { owner, byCompany };
}

export type Partitioned = { kept: string[]; foreign: string[]; unknown: string[] };

/** Keep only the ids that belong to `companyId`; report everything else. */
export function partitionEvidence(
  companyId: string,
  ids: string[],
  index: EvidenceIndex,
): Partitioned {
  const own = index.byCompany.get(companyId) ?? new Set<string>();
  const kept: string[] = [];
  const foreign: string[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    if (own.has(id)) kept.push(id);
    else if (index.owner.has(id)) foreign.push(id);
    else unknown.push(id);
  }
  return { kept, foreign, unknown };
}

export type LeakReport = {
  clean: boolean;
  /** Number of ids cited for the wrong company. */
  foreignCount: number;
  /** Number of ids that exist in no company context at all. */
  unknownCount: number;
  details: Array<{ companyId: string; sectionKey: string; foreign: string[]; unknown: string[] }>;
};

/** Audit a generated multi-stock script for cross-company evidence mixing. */
export function auditEvidenceSeparation(
  sections: Array<{ sectionKey: string; companyId: string | null; ids: string[] }>,
  index: EvidenceIndex,
): LeakReport {
  const details: LeakReport["details"] = [];
  let foreignCount = 0;
  let unknownCount = 0;
  for (const s of sections) {
    if (!s.companyId) continue;
    const p = partitionEvidence(s.companyId, s.ids, index);
    if (p.foreign.length || p.unknown.length) {
      details.push({
        companyId: s.companyId,
        sectionKey: s.sectionKey,
        foreign: p.foreign,
        unknown: p.unknown,
      });
      foreignCount += p.foreign.length;
      unknownCount += p.unknown.length;
    }
  }
  return { clean: details.length === 0, foreignCount, unknownCount, details };
}
