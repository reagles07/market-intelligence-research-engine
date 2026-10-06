/**
 * Deterministic evidence traceability (client-safe).
 *
 * A claim is traceable when at least one complete evidence path exists:
 *
 *   SOURCE      Claim → Source
 *   METRIC      Claim → Metric / SEC fact / financial period → provider,
 *               accession (where applicable), reporting period, filing/source chain
 *   CALCULATION Claim → derived value whose material inputs are themselves
 *               metric- or source-traceable
 *
 * Nothing here invents evidence: a claim without a stored path is simply not
 * traceable, and the readiness gate treats it accordingly.
 */

export type EvidenceType = "SOURCE" | "METRIC" | "CALCULATION" | "NONE";

export type TraceableClaim = {
  source_id?: string | null;
  evidence_type?: string | null;
  evidence_metric_keys?: string[] | null;
  financial_period_id?: string | null;
  sec_fact_id?: string | null;
  sec_filing_id?: string | null;
  evidence_provider?: string | null;
  evidence_accession?: string | null;
  evidence_period?: string | null;
  evidence_detail?: Record<string, unknown> | null;
};

export type TraceResult = {
  traceable: boolean;
  evidenceType: EvidenceType;
  reason: string;
  /** Human-readable lineage steps, outermost (claim) first. */
  path: string[];
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function metricProvenance(claim: TraceableClaim): {
  ok: boolean;
  missing: string[];
  path: string[];
} {
  const keys = (claim.evidence_metric_keys ?? []).filter(Boolean);
  const provider = str(claim.evidence_provider);
  const period = str(claim.evidence_period) ?? str(claim.financial_period_id);
  const anchor = claim.financial_period_id || claim.sec_fact_id;

  const missing: string[] = [];
  if (!keys.length) missing.push("metric key");
  if (!anchor) missing.push("metric row (financial period or SEC fact)");
  if (!provider) missing.push("provider");
  if (!period) missing.push("reporting period");
  // Filing/accession is required only where the provider files documents.
  const filingProvider = (provider ?? "").toUpperCase().includes("SEC");
  if (filingProvider && !str(claim.evidence_accession) && !claim.sec_filing_id) {
    missing.push("accession / filing");
  }

  const path = [
    `Metric ${keys.join(", ") || "—"}`,
    claim.sec_fact_id ? `SEC fact ${claim.sec_fact_id}` : null,
    claim.financial_period_id ? `Financial period ${claim.financial_period_id}` : null,
    period ? `Reporting period ${period}` : null,
    provider ? `Provider ${provider}` : null,
    claim.evidence_accession ? `Accession ${claim.evidence_accession}` : null,
    claim.sec_filing_id ? `Filing ${claim.sec_filing_id}` : null,
  ].filter(Boolean) as string[];

  return { ok: missing.length === 0, missing, path };
}

/**
 * Calculation inputs are stored on evidence_detail.inputs as an array of
 * already-resolved evidence descriptors. Every material input must itself be
 * traceable for the derived claim to count.
 */
function calculationInputs(claim: TraceableClaim): TraceableClaim[] {
  const raw = (claim.evidence_detail ?? {})["inputs"];
  return Array.isArray(raw) ? (raw as TraceableClaim[]) : [];
}

export function isClaimTraceable(claim: TraceableClaim): TraceResult {
  const declared = (str(claim.evidence_type) ?? "NONE").toUpperCase() as EvidenceType;

  if (claim.source_id) {
    return {
      traceable: true,
      evidenceType: "SOURCE",
      reason: "Direct source evidence.",
      path: ["Claim", `Source ${claim.source_id}`],
    };
  }

  if (declared === "CALCULATION") {
    const inputs = calculationInputs(claim);
    if (!inputs.length) {
      return {
        traceable: false,
        evidenceType: "CALCULATION",
        reason: "Calculation has no recorded inputs.",
        path: ["Claim"],
      };
    }
    const resolved = inputs.map((i) => isClaimTraceable(i));
    const bad = resolved.filter((r) => !r.traceable);
    return {
      traceable: bad.length === 0,
      evidenceType: "CALCULATION",
      reason: bad.length
        ? `${bad.length} of ${inputs.length} calculation input(s) not traceable: ${bad.map((b) => b.reason).join("; ")}`
        : `All ${inputs.length} calculation inputs are traceable.`,
      path: ["Claim (calculation)", ...resolved.flatMap((r) => r.path.slice(1))],
    };
  }

  if (declared === "METRIC" || (claim.evidence_metric_keys ?? []).length > 0) {
    const prov = metricProvenance(claim);
    return {
      traceable: prov.ok,
      evidenceType: "METRIC",
      reason: prov.ok
        ? "Structured metric evidence with complete provenance."
        : `Metric provenance incomplete — missing ${prov.missing.join(", ")}.`,
      path: ["Claim", ...prov.path],
    };
  }

  return {
    traceable: false,
    evidenceType: "NONE",
    reason: "No source and no structured metric evidence recorded.",
    path: ["Claim"],
  };
}

/** Statuses that make a claim load-bearing for readiness. */
export function isSupportedStatus(status: unknown): boolean {
  return status === "Verified" || status === "Attributed";
}
