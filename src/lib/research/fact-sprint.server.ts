/**
 * Fast fact sprint (server only).
 *
 * A bounded, gap-driven research burst. It starts from what the current packet
 * is MISSING, walks the primary → secondary → industry ladder for each gap
 * using the existing web-research infrastructure, tries alternatives when a
 * primary document will not open, and finishes by rebuilding the canonical
 * research packet so readiness is re-evaluated the normal way.
 *
 * It never invents a fact, never bypasses evidence rules, and never generates
 * a script. A gap that stays unresolved stays unresolved — visibly.
 */
import { runTargetedWebResearch } from "@/lib/ai/web.server";
import type { Db as AiDb } from "@/lib/ai/context.server";
import { runBuildResearchPacket } from "@/lib/ai/research.server";
import { domainOfWebsite } from "@/lib/ai/web-sources";
import { isSubstantive } from "@/lib/research/completion";
import {
  FACT_GAP_CATEGORIES,
  FACT_SPRINT_MAX_GAPS,
  FACT_SPRINT_MAX_PASSES,
  buildFactGapPlan,
  shouldRunAnotherPass,
  summarizeFactSprint,
  type CompanyRef,
  type FactGapCategory,
  type FactGapKey,
  type FactSprintPassResult,
  type PlannedFactGap,
} from "@/lib/research/fact-sprint";

type Db = AiDb;

/** Which gap categories the CURRENT packet still cannot answer. */
async function detectPacketGaps(
  db: Db,
  packetId: string,
): Promise<{
  categories: FactGapCategory[];
  packetVersion: number | null;
  storyId: string | null;
  companyId: string | null;
}> {
  const { data: packet } = await db
    .from("research_packets")
    .select("id,version_number,story_id,company_id")
    .eq("id", packetId)
    .maybeSingle();

  const { data: sections } = await db
    .from("research_sections")
    .select("section_key,content")
    .eq("packet_id", packetId);

  const byKey = new Map<string, string | null>(
    (sections ?? []).map((s) => [String(s.section_key), s.content as string | null]),
  );
  const thin = (key: string) => !isSubstantive(byKey.get(key) ?? null);

  const { count: periodCount } = packet?.company_id
    ? await db
        .from("financial_periods")
        .select("id", { count: "exact", head: true })
        .eq("company_id", packet.company_id)
    : { count: 0 };
  const { count: eventCount } = packet?.company_id
    ? await db
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("company_id", packet.company_id)
    : { count: 0 };

  const wanted: FactGapKey[] = [];
  if (thin("business")) wanted.push("business_model");
  if (thin("catalysts") && thin("what_happened") && !(eventCount ?? 0)) wanted.push("catalyst");
  if (thin("financials") && !(periodCount ?? 0)) wanted.push("financials");
  if (thin("moat")) wanted.push("moat");
  if (thin("story_summary") && thin("events")) wanted.push("history");
  if (thin("valuation")) wanted.push("valuation");

  return {
    categories: wanted.map((k) => FACT_GAP_CATEGORIES[k]),
    packetVersion: packet?.version_number ?? null,
    storyId: packet?.story_id ?? null,
    companyId: packet?.company_id ?? null,
  };
}

async function loadCompanyRef(db: Db, companyId: string): Promise<CompanyRef> {
  const { data } = await db
    .from("companies")
    .select("name,ticker,country,website")
    .eq("id", companyId)
    .maybeSingle();
  return {
    name: String(data?.name ?? ""),
    ticker: String(data?.ticker ?? ""),
    market: String(data?.country ?? "US"),
    domain: domainOfWebsite(data?.website ?? null),
  };
}

export async function runFactSprint(
  db: Db,
  args: {
    packetId?: string | null;
    storyId?: string | null;
    /** Restrict the sprint to these gap keys (e.g. from a blocked long-form precheck). */
    gapKeys?: readonly string[] | null;
    model?: string | null;
    rebuildPacket?: boolean;
    userId: string;
  },
) {
  let packetId = args.packetId ?? null;
  if (!packetId && args.storyId) {
    const { data } = await db
      .from("research_packets")
      .select("id")
      .eq("story_id", args.storyId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    packetId = data?.id ?? null;
  }
  if (!packetId) return { ok: false as const, error: "No research packet found for this story." };

  const detected = await detectPacketGaps(db, packetId);
  if (!detected.companyId) return { ok: false as const, error: "Packet has no linked company." };

  const requested = args.gapKeys?.length
    ? args.gapKeys
        .map((k) => FACT_GAP_CATEGORIES[k as FactGapKey])
        .filter((c): c is FactGapCategory => Boolean(c))
    : detected.categories;

  const company = await loadCompanyRef(db, detected.companyId);
  const plan: PlannedFactGap[] = buildFactGapPlan({
    company,
    categories: requested,
    maxGaps: FACT_SPRINT_MAX_GAPS,
  });

  const { data: runRow } = await db
    .from("fact_sprint_runs")
    .insert({
      company_id: detected.companyId,
      story_id: detected.storyId ?? args.storyId ?? null,
      packet_id: packetId,
      packet_version: detected.packetVersion,
      status: "RUNNING",
      current_step: "Planning missing facts",
      model: args.model ?? null,
      gaps: plan.map((g) => ({ key: g.key, label: g.label, question: g.question })) as never,
      created_by: args.userId,
    })
    .select("id")
    .single();
  const runId = runRow?.id ?? null;

  const step = async (label: string) => {
    if (runId) await db.from("fact_sprint_runs").update({ current_step: label }).eq("id", runId);
  };

  if (!plan.length) {
    if (runId) {
      await db
        .from("fact_sprint_runs")
        .update({
          status: "COMPLETED",
          current_step: null,
          completed_at: new Date().toISOString(),
          summary: { note: "No missing fact categories were detected for this packet." } as never,
        })
        .eq("id", runId);
    }
    return {
      ok: true as const,
      runId,
      packetId,
      nothingToDo: true,
      summary: summarizeFactSprint([], 0),
    };
  }

  const passes: FactSprintPassResult[] = [];
  const remaining = new Map(plan.map((g) => [g.key, g]));
  let passCount = 0;

  while (
    shouldRunAnotherPass({
      pass: passCount,
      remainingCriticalGaps: remaining.size,
      maxPasses: FACT_SPRINT_MAX_PASSES,
    })
  ) {
    passCount += 1;
    await step(passCount === 1 ? "Searching official sources" : "Checking recent news");

    for (const gap of [...remaining.values()]) {
      const run = await runTargetedWebResearch(db, {
        companyId: detected.companyId,
        storyId: detected.storyId ?? args.storyId ?? null,
        // Pass 1 walks the primary rung first; later passes widen to the
        // secondary/industry rungs of the same ladder.
        queries: passCount === 1 ? gap.queries.slice(0, 2) : gap.queries.slice(1),
        focus: gap.question,
        evidenceType: gap.evidenceType,
        model: args.model ?? null,
        userId: args.userId,
      });

      if (!run.ok) {
        passes.push({
          gapKey: gap.key,
          filled: false,
          sourcesAdded: 0,
          conflicts: 0,
          searches: 0,
          costUsd: 0,
          inaccessiblePrimaries: 0,
          latestSourceAt: null,
          note: run.error,
        });
        continue;
      }

      const dates = run.result.sources
        .map((s: { published_at: string | null }) => s.published_at)
        .filter((d: string | null): d is string => Boolean(d))
        .sort();
      const filled = run.claimsAdded > 0 && !run.noNewInformation;

      passes.push({
        gapKey: gap.key,
        filled,
        sourcesAdded: run.sourcesAdded,
        conflicts: run.conflicts,
        searches: run.usage.webSearchCalls,
        costUsd: run.usage.estimatedCostUsd,
        inaccessiblePrimaries: run.inaccessiblePrimaries,
        latestSourceAt: dates.length ? dates[dates.length - 1]! : null,
        note: run.fallbackUsed
          ? "A primary document could not be opened; an alternative source route was tried."
          : "",
      });

      if (filled) remaining.delete(gap.key);
    }
  }

  await step("Cross-checking numbers");
  const summary = summarizeFactSprint(passes, passCount);

  // The canonical packet/readiness path is never bypassed: it is rebuilt.
  await step("Rebuilding readiness");
  let packetVersion: number | null = null;
  let packetError: string | null = null;
  const storyId = detected.storyId ?? args.storyId ?? null;
  if ((args.rebuildPacket ?? true) && storyId && summary.sourcesAdded > 0) {
    const built = await runBuildResearchPacket(db, {
      storyId,
      model: args.model ?? null,
      userId: args.userId,
      updateReason: `Fact sprint — ${summary.gapsFilled}/${summary.gapsTargeted} gaps filled, ${summary.sourcesAdded} sources added`,
    });
    if (built.ok) {
      packetId = built.packetId;
      packetVersion = built.version;
    } else {
      packetError = built.error;
    }
  }

  if (runId) {
    await db
      .from("fact_sprint_runs")
      .update({
        status: "COMPLETED",
        current_step: null,
        completed_at: new Date().toISOString(),
        packet_id: packetId,
        packet_version: packetVersion ?? detected.packetVersion,
        gaps_targeted: summary.gapsTargeted,
        gaps_filled: summary.gapsFilled,
        gaps_unresolved: summary.gapsUnresolved,
        sources_added: summary.sourcesAdded,
        conflicts: summary.conflicts,
        searches: summary.searches,
        passes: summary.passes,
        inaccessible_primaries: summary.inaccessiblePrimaries,
        estimated_cost_usd: summary.costUsd,
        latest_source_at: summary.latestSourceAt,
        summary: { ...summary, packetError, passes: undefined } as never,
        error: packetError,
      })
      .eq("id", runId);
  }

  return {
    ok: true as const,
    runId,
    packetId,
    packetVersion,
    packetError,
    plan: plan.map((g) => ({ key: g.key, label: g.label })),
    summary,
    perGap: passes,
  };
}

export async function latestFactSprint(db: Db, args: { storyId: string }) {
  const { data } = await db
    .from("fact_sprint_runs")
    .select("*")
    .eq("story_id", args.storyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}
