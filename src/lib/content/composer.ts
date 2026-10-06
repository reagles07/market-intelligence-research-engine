/**
 * Content Composer domain (client-safe, pure).
 *
 * Research stays stock-by-stock; only CONTENT composition becomes flexible.
 * Nothing here researches, generates or relaxes a gate: it decides which
 * selected companies are content-eligible, how many scripts a configuration
 * will produce, and how Shorts are allocated across stocks.
 */
import { CONTENT_ELIGIBLE_READINESS } from "@/lib/content/orchestration";

export const COMPOSER_MODES = [
  {
    key: "SINGLE",
    label: "Single Stock Deep Dive",
    hint: "The existing 6 Shorts + 1 long-form pack for one company.",
    minCompanies: 1,
    maxCompanies: 1,
  },
  {
    key: "MULTI_STOCK",
    label: "Multi-Stock Video / Roundup",
    hint: "One combined long-form episode connecting several companies through a shared theme.",
    minCompanies: 2,
    maxCompanies: 8,
  },
  {
    key: "COMPARISON",
    label: "Stock Comparison",
    hint: "One episode that contrasts the selected companies side by side.",
    minCompanies: 2,
    maxCompanies: 4,
  },
  {
    key: "CUSTOM",
    label: "Custom Content Pack",
    hint: "You choose the long-form and the exact number of Shorts per stock.",
    minCompanies: 1,
    maxCompanies: 8,
  },
] as const;

export type ComposerMode = (typeof COMPOSER_MODES)[number]["key"];
export const DEFAULT_COMPOSER_MODE: ComposerMode = "MULTI_STOCK";

export function modeSpec(mode: ComposerMode) {
  return COMPOSER_MODES.find((m) => m.key === mode) ?? COMPOSER_MODES[1];
}

/** Long-form narrative shapes for a multi-stock episode. */
export const LONGFORM_MODES = [
  { key: "roundup", label: "Roundup" },
  { key: "comparison", label: "Comparison" },
  { key: "theme", label: "Theme-based" },
  { key: "custom", label: "Custom" },
] as const;
export type LongformMode = (typeof LONGFORM_MODES)[number]["key"];

/** A 60-second combined Short cannot carry more than three companies coherently. */
export const COMBINED_SHORT_MAX_COMPANIES = 3;
/** Hard ceilings so one creator action can never fan out unbounded. */
export const COMPOSER_MAX_COMPANIES = 8;
export const COMPOSER_MAX_SHORTS_PER_STOCK = 6;
export const COMPOSER_MAX_TOTAL_SHORTS = 18;
export const SINGLE_STOCK_DEFAULT_SHORTS = 6;

// -------------------------------------------------------------- eligibility

export type ComposerCandidate = {
  companyId: string;
  ticker: string;
  name: string;
  market: string;
  storyId: string | null;
  packetId: string | null;
  packetVersion: number | null;
  packetDate: string | null;
  completionPct: number | null;
  verificationScore: number | null;
  readiness: string | null;
  /** Rough content strength used only by auto-allocation, never by a gate. */
  strength?: number;
};

export type Eligibility = {
  eligible: boolean;
  badge: string;
  reason: string | null;
};

/**
 * Content eligibility is read from canonical research readiness only. A
 * company that was merely *selected* never becomes eligible.
 */
export function evaluateEligibility(c: ComposerCandidate): Eligibility {
  if (!c.packetId) {
    return {
      eligible: false,
      badge: "No research yet",
      reason: "This company has no research packet. Run research before composing content.",
    };
  }
  if (!c.readiness) {
    return {
      eligible: false,
      badge: "Readiness unknown",
      reason: "No research readiness verdict is on file yet. Run or refresh research.",
    };
  }
  if (!(CONTENT_ELIGIBLE_READINESS as readonly string[]).includes(c.readiness)) {
    return {
      eligible: false,
      badge: c.readiness.replaceAll("_", " ").toLowerCase(),
      reason: `Research readiness is ${c.readiness.replaceAll("_", " ").toLowerCase()} — refresh research before using this stock in a script.`,
    };
  }
  return {
    eligible: true,
    badge: c.readiness === "READY_FOR_CONTENT" ? "Ready" : "Ready (needs review)",
    reason: null,
  };
}

export function splitEligibility(list: ComposerCandidate[]) {
  const ready: ComposerCandidate[] = [];
  const blocked: Array<ComposerCandidate & { reason: string }> = [];
  for (const c of list) {
    const e = evaluateEligibility(c);
    if (e.eligible) ready.push(c);
    else blocked.push({ ...c, reason: e.reason ?? "Not content-eligible." });
  }
  return { ready, blocked };
}

// -------------------------------------------------------------- allocation

export type ShortAllocation = Record<string, number>;

/**
 * Spread a requested number of Shorts across companies by verified content
 * strength. Deterministic: strongest first, then largest remainder, then
 * stable ticker order.
 */
export function autoAllocateShorts(
  candidates: ComposerCandidate[],
  totalShorts: number,
): ShortAllocation {
  const out: ShortAllocation = {};
  if (!candidates.length || totalShorts <= 0) return out;

  const ordered = [...candidates].sort(
    (a, b) => (b.strength ?? 0) - (a.strength ?? 0) || a.ticker.localeCompare(b.ticker),
  );
  for (const c of ordered) out[c.companyId] = 0;

  let remaining = Math.min(totalShorts, ordered.length * COMPOSER_MAX_SHORTS_PER_STOCK);
  while (remaining > 0) {
    let placed = false;
    for (const c of ordered) {
      if (remaining <= 0) break;
      if ((out[c.companyId] ?? 0) >= COMPOSER_MAX_SHORTS_PER_STOCK) continue;
      out[c.companyId] = (out[c.companyId] ?? 0) + 1;
      remaining -= 1;
      placed = true;
    }
    if (!placed) break;
  }
  return out;
}

export type AllocationCheck = {
  ok: boolean;
  allocation: ShortAllocation;
  totalShorts: number;
  errors: string[];
};

/** Per-stock Short counts must be whole, in range, and only for ready stocks. */
export function validateAllocation(
  readyCandidates: ComposerCandidate[],
  requested: ShortAllocation,
): AllocationCheck {
  const errors: string[] = [];
  const allowed = new Set(readyCandidates.map((c) => c.companyId));
  const allocation: ShortAllocation = {};

  for (const [companyId, raw] of Object.entries(requested)) {
    if (!allowed.has(companyId)) {
      errors.push("A Short was requested for a stock that is not content-ready.");
      continue;
    }
    if (!Number.isInteger(raw) || raw < 0) {
      errors.push("Short counts must be whole numbers of zero or more.");
      continue;
    }
    if (raw > COMPOSER_MAX_SHORTS_PER_STOCK) {
      errors.push(`At most ${COMPOSER_MAX_SHORTS_PER_STOCK} Shorts per stock in one pack.`);
      continue;
    }
    allocation[companyId] = raw;
  }

  const totalShorts = Object.values(allocation).reduce((a, b) => a + b, 0);
  if (totalShorts > COMPOSER_MAX_TOTAL_SHORTS) {
    errors.push(`At most ${COMPOSER_MAX_TOTAL_SHORTS} Shorts in one composition.`);
  }
  return { ok: errors.length === 0, allocation, totalShorts, errors };
}

// -------------------------------------------------------------- composition

export type ComposerConfig = {
  mode: ComposerMode;
  longEnabled: boolean;
  longformMode: LongformMode;
  shortsEnabled: boolean;
  allocation: ShortAllocation;
  combinedShorts: number;
  combinedShortCompanyIds: string[];
};

export type CompositionPlan = {
  ok: boolean;
  longScripts: number;
  singleStockShorts: number;
  combinedShorts: number;
  totalScripts: number;
  summary: string;
  errors: string[];
  warnings: string[];
};

/** What WILL be generated, shown to the creator before anything is spent. */
export function planComposition(
  readyCandidates: ComposerCandidate[],
  config: ComposerConfig,
): CompositionPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const spec = modeSpec(config.mode);

  if (readyCandidates.length < spec.minCompanies) {
    errors.push(
      `${spec.label} needs at least ${spec.minCompanies} content-ready stock${spec.minCompanies === 1 ? "" : "s"}.`,
    );
  }
  if (readyCandidates.length > spec.maxCompanies) {
    errors.push(`${spec.label} supports at most ${spec.maxCompanies} stocks.`);
  }

  const alloc = validateAllocation(readyCandidates, config.allocation);
  errors.push(...alloc.errors);

  const combinedShorts = config.shortsEnabled ? Math.max(0, config.combinedShorts) : 0;
  if (combinedShorts > 0) {
    if (config.combinedShortCompanyIds.length < 2) {
      errors.push("A combined Short needs at least two content-ready stocks.");
    }
    if (config.combinedShortCompanyIds.length > COMBINED_SHORT_MAX_COMPANIES) {
      errors.push(
        `A 60-second combined Short cannot cover more than ${COMBINED_SHORT_MAX_COMPANIES} companies — narrow the selection instead.`,
      );
    }
    if (config.combinedShortCompanyIds.length === COMBINED_SHORT_MAX_COMPANIES) {
      warnings.push(
        "Three companies in one 60-second Short is the practical maximum — keep each point to one line.",
      );
    }
  }

  const longScripts = config.longEnabled ? 1 : 0;
  if (config.longEnabled && config.mode !== "SINGLE" && readyCandidates.length < 2) {
    errors.push("A combined long-form video needs at least two content-ready stocks.");
  }
  if (config.longEnabled && config.mode !== "SINGLE" && readyCandidates.length > 5) {
    warnings.push(
      "More than five companies in one episode usually means each story gets too little time.",
    );
  }

  const singleStockShorts = config.shortsEnabled ? alloc.totalShorts : 0;
  const totalScripts = longScripts + singleStockShorts + combinedShorts;
  if (totalScripts === 0) errors.push("Nothing to generate — enable the long-form or some Shorts.");

  const bits: string[] = [];
  if (longScripts) bits.push(`${longScripts} long video`);
  if (singleStockShorts)
    bits.push(`${singleStockShorts} Short${singleStockShorts === 1 ? "" : "s"}`);
  if (combinedShorts)
    bits.push(`${combinedShorts} combined Short${combinedShorts === 1 ? "" : "s"}`);

  return {
    ok: errors.length === 0,
    longScripts,
    singleStockShorts,
    combinedShorts,
    totalScripts,
    summary: bits.length ? bits.join(" + ") : "Nothing selected",
    errors,
    warnings,
  };
}

/** Default allocation for a mode, before the creator edits the counts. */
export function defaultAllocation(
  mode: ComposerMode,
  readyCandidates: ComposerCandidate[],
): ShortAllocation {
  const out: ShortAllocation = {};
  if (mode === "SINGLE") {
    const first = readyCandidates[0];
    if (first) out[first.companyId] = SINGLE_STOCK_DEFAULT_SHORTS;
    return out;
  }
  for (const c of readyCandidates) out[c.companyId] = 1;
  return out;
}
