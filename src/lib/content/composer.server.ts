/**
 * Content Composer orchestration (server only).
 *
 * It sequences EXISTING generators — nothing here researches, approves or
 * publishes. Eligibility comes from canonical research readiness, and every
 * produced script lands as "Needs Fact Check / Not Audited" exactly as before.
 */
import type { Db } from "@/lib/ai/script-context.server";
import { SHORT_ANGLE_PLAN, type Platform, type TargetDurationKey } from "@/lib/content/domain";
import type { Language } from "@/lib/domain";
import {
  COMBINED_SHORT_MAX_COMPANIES,
  autoAllocateShorts,
  evaluateEligibility,
  planComposition,
  type ComposerCandidate,
  type ComposerConfig,
  type ComposerMode,
  type LongformMode,
  type ShortAllocation,
} from "@/lib/content/composer";
import { CONTENT_ELIGIBLE_READINESS } from "@/lib/content/orchestration";

/**
 * Every company that has research on file, with its latest packet and the
 * latest canonical readiness verdict for that packet's story.
 */
export async function listComposerCandidates(db: Db): Promise<ComposerCandidate[]> {
  const { data: packets } = await db
    .from("research_packets")
    .select("id,company_id,story_id,version_number,completion_pct,verification_score,updated_at")
    .order("updated_at", { ascending: false })
    .limit(400);

  const latest = new Map<string, NonNullable<typeof packets>[number]>();
  for (const p of packets ?? []) if (!latest.has(p.company_id)) latest.set(p.company_id, p);
  if (!latest.size) return [];

  const companyIds = [...latest.keys()];
  const storyIds = [...latest.values()].map((p) => p.story_id);

  const [{ data: companies }, { data: runs }] = await Promise.all([
    db.from("companies").select("id,ticker,name,country,exchange,is_demo").in("id", companyIds),
    db
      .from("research_orchestration_runs")
      .select("story_id,readiness,updated_at")
      .in("story_id", storyIds)
      .order("updated_at", { ascending: false })
      .limit(600),
  ]);

  const readinessByStory = new Map<string, string | null>();
  for (const r of runs ?? [])
    if (!readinessByStory.has(r.story_id)) readinessByStory.set(r.story_id, r.readiness);

  return (companies ?? [])
    .map((c) => {
      const p = latest.get(c.id)!;
      const readiness = readinessByStory.get(p.story_id) ?? null;
      return {
        companyId: c.id,
        ticker: c.ticker,
        name: c.name,
        market: c.country ?? "",
        storyId: p.story_id,
        packetId: p.id,
        packetVersion: p.version_number,
        packetDate: p.updated_at,
        completionPct: Number(p.completion_pct ?? 0),
        verificationScore: Number(p.verification_score ?? 0),
        readiness,
        // Strength drives auto-allocation only. It never relaxes a gate.
        strength: Number(p.verification_score ?? 0) + Number(p.completion_pct ?? 0) / 4,
      } satisfies ComposerCandidate;
    })
    .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
}

/** JSON-safe generator result, so server-function returns stay serializable. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
const asJson = (v: unknown): { [k: string]: JsonValue } =>
  JSON.parse(JSON.stringify(v ?? {})) as { [k: string]: JsonValue };

export type RunCompositionArgs = {
  companyIds: string[];
  mode: ComposerMode;
  longEnabled: boolean;
  longformMode: LongformMode;
  shortsEnabled: boolean;
  allocation: ShortAllocation;
  autoAllocate: boolean;
  autoAllocateTotal: number;
  combinedShorts: number;
  combinedShortCompanyIds: string[];
  allowRanking: boolean;
  theme: string | null;
  title: string | null;
  creatorInstruction: string | null;
  targetDuration: TargetDurationKey | null;
  customMinutes: number | null;
  platform: Platform | null;
  language: Language | null;
  tone: string | null;
  model: string | null;
  styleProfileId: string | null;
  continueWithReadyOnly: boolean;
  userId: string;
};

/** Resolve the selection into ready / blocked buckets plus the generation plan. */
export async function previewComposition(db: Db, args: RunCompositionArgs) {
  const all = await listComposerCandidates(db);
  const byId = new Map(all.map((c) => [c.companyId, c] as const));
  const selected = args.companyIds
    .map((id) => byId.get(id))
    .filter((c): c is ComposerCandidate => Boolean(c));

  const missing = args.companyIds.filter((id) => !byId.has(id));
  const ready: ComposerCandidate[] = [];
  const blocked: Array<{
    companyId: string;
    ticker: string;
    reason: string;
    storyId: string | null;
  }> = [];
  for (const c of selected) {
    const e = evaluateEligibility(c);
    if (e.eligible) ready.push(c);
    else
      blocked.push({
        companyId: c.companyId,
        ticker: c.ticker,
        reason: e.reason ?? "",
        storyId: c.storyId,
      });
  }
  for (const id of missing) {
    blocked.push({
      companyId: id,
      ticker: "",
      reason: "No research packet on file yet.",
      storyId: null,
    });
  }

  const allocation = args.autoAllocate
    ? autoAllocateShorts(ready, args.autoAllocateTotal)
    : Object.fromEntries(
        Object.entries(args.allocation).filter(([id]) => ready.some((r) => r.companyId === id)),
      );

  const combinedIds = args.combinedShortCompanyIds.filter((id) =>
    ready.some((r) => r.companyId === id),
  );
  const config: ComposerConfig = {
    mode: args.mode,
    longEnabled: args.longEnabled,
    longformMode: args.longformMode,
    shortsEnabled: args.shortsEnabled,
    allocation,
    combinedShorts: args.combinedShorts,
    combinedShortCompanyIds: combinedIds,
  };
  const plan = planComposition(ready, config);
  return { ready, blocked, allocation, combinedIds, plan };
}

/** The one creator action that produces a composition's scripts. */
export async function runComposition(db: Db, args: RunCompositionArgs) {
  const { ready, blocked, allocation, combinedIds, plan } = await previewComposition(db, args);

  if (blocked.length && !args.continueWithReadyOnly) {
    return {
      ok: false as const,
      error: "Some selected stocks are not content-ready.",
      blocked,
      plan,
    };
  }
  if (!plan.ok) return { ok: false as const, error: plan.errors.join(" "), blocked, plan };

  const packKey = `comp-${Date.now().toString(36)}`;
  const { data: composition, error: compErr } = await db
    .from("content_compositions")
    .insert({
      mode: args.mode,
      title: args.title,
      theme: args.theme,
      creator_instruction: args.creatorInstruction,
      platform: args.platform ?? "YouTube",
      language: args.language ?? "Tanglish",
      tone: args.tone ?? "Analytical",
      long_enabled: args.longEnabled,
      shorts_enabled: args.shortsEnabled,
      target_duration: args.targetDuration,
      custom_duration_minutes: args.customMinutes,
      short_allocation: allocation as never,
      combined_shorts: plan.combinedShorts,
      allow_ranking: args.allowRanking,
      auto_allocate: args.autoAllocate,
      estimated_scripts: plan.totalScripts,
      status: "RUNNING",
      pack_key: packKey,
      created_by: args.userId,
    } as never)
    .select("id")
    .single();
  if (compErr) throw new Error(compErr.message);
  const compositionId = composition.id as string;

  await db.from("content_composition_companies").insert([
    ...ready.map((c, i) => ({
      composition_id: compositionId,
      company_id: c.companyId,
      story_id: c.storyId,
      packet_id: c.packetId,
      packet_version: c.packetVersion,
      readiness: c.readiness,
      eligible: true,
      ineligible_reason: null,
      short_count: allocation[c.companyId] ?? 0,
      order_index: i,
    })),
    ...blocked
      .filter((b) => b.companyId)
      .map((b, i) => ({
        composition_id: compositionId,
        company_id: b.companyId,
        story_id: b.storyId,
        packet_id: null,
        packet_version: null,
        readiness: null,
        eligible: false,
        ineligible_reason: b.reason,
        short_count: 0,
        order_index: ready.length + i,
      })),
  ] as never);

  const results: {
    long: { [k: string]: JsonValue } | null;
    shorts: Array<{ [k: string]: JsonValue }>;
    combined: Array<{ [k: string]: JsonValue }>;
  } = { long: null, shorts: [], combined: [] };

  const shared = {
    language: args.language,
    tone: args.tone,
    model: args.model,
    styleProfileId: args.styleProfileId,
    platform: args.platform,
    userId: args.userId,
  };

  // --- per-stock Shorts, angle-rotated so multiple Shorts for one stock differ
  if (args.shortsEnabled) {
    const { runGenerateShortScript } = await import("@/lib/ai/script.server");
    let part = 1;
    for (const c of ready) {
      const count = allocation[c.companyId] ?? 0;
      for (let i = 0; i < count; i++) {
        const angle = SHORT_ANGLE_PLAN[i % SHORT_ANGLE_PLAN.length]!;
        const r = await runGenerateShortScript(db, {
          packetId: c.packetId,
          angle: `${angle.label}: ${angle.brief}`,
          angleKey: angle.key,
          packKey,
          packPart: part,
          ...shared,
        });
        results.shorts.push(
          asJson({ companyId: c.companyId, ticker: c.ticker, angleKey: angle.key, ...r }),
        );
        if (r.ok && r.scriptId) {
          await db
            .from("scripts")
            .update({ composition_id: compositionId, company_ids: [c.companyId] } as never)
            .eq("id", r.scriptId);
        }
        part += 1;
      }
    }

    // --- combined multi-stock Shorts
    if (
      plan.combinedShorts > 0 &&
      combinedIds.length >= 2 &&
      combinedIds.length <= COMBINED_SHORT_MAX_COMPANIES
    ) {
      const { runGenerateCombinedShort } = await import("@/lib/ai/multi-script.server");
      const packetIds = combinedIds
        .map((id) => ready.find((r) => r.companyId === id)?.packetId)
        .filter((p): p is string => Boolean(p));
      for (let i = 0; i < plan.combinedShorts; i++) {
        const r = await runGenerateCombinedShort(db, {
          packetIds,
          compositionId,
          packKey,
          seriesPart: 100 + i,
          theme: args.theme,
          creatorInstruction: args.creatorInstruction,
          ...shared,
        });
        results.combined.push(asJson(r));
        part += 1;
      }
    }
  }

  // --- long form
  if (args.longEnabled) {
    if (args.mode === "SINGLE" || ready.length === 1) {
      const { runGenerateLongScript } = await import("@/lib/ai/script.server");
      const only = ready[0];
      if (only?.packetId) {
        const r = await runGenerateLongScript(db, {
          packetId: only.packetId,
          targetDuration: args.targetDuration,
          packKey,
          ...shared,
        });
        results.long = asJson(r);
        if (r.ok && r.scriptId) {
          await db
            .from("scripts")
            .update({ composition_id: compositionId, company_ids: [only.companyId] } as never)
            .eq("id", r.scriptId);
        }
      }
    } else {
      const { runGenerateMultiStockLong } = await import("@/lib/ai/multi-script.server");
      results.long = asJson(
        await runGenerateMultiStockLong(db, {
          packetIds: ready.map((c) => c.packetId).filter((p): p is string => Boolean(p)),
          compositionId,
          packKey,
          longformMode: args.longformMode,
          allowRanking: args.allowRanking,
          theme: args.theme,
          creatorInstruction: args.creatorInstruction,
          targetDuration: args.targetDuration,
          customMinutes: args.customMinutes,
          ...shared,
        }),
      );
    }
  }

  const generated =
    results.shorts.filter((s) => s["ok"]).length +
    results.combined.filter((s) => s["ok"]).length +
    (results.long?.["ok"] ? 1 : 0);

  await db
    .from("content_compositions")
    .update({
      status: generated > 0 ? "COMPLETE" : "FAILED",
      result: { generated, planned: plan.totalScripts, ...results } as never,
    } as never)
    .eq("id", compositionId);

  return {
    ok: generated > 0,
    compositionId,
    packKey,
    plan,
    blocked,
    generated,
    ...results,
  };
}

/** Composition history for the Scripts page. */
export async function listCompositions(db: Db, limit = 20) {
  const { data } = await db
    .from("content_compositions")
    .select(
      "*, content_composition_companies(company_id,short_count,eligible,readiness,companies(ticker,name))",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export const COMPOSER_ELIGIBLE_READINESS = CONTENT_ELIGIBLE_READINESS;
