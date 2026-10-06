/**
 * Discovery server functions (Phase 2A).
 *
 * The browser never calls a market provider or the model directly. Promotion
 * to a Story is always an explicit human action — discovery never auto-creates
 * research work.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DISCOVERY_MARKETS } from "@/lib/discovery/domain";

export const listDiscoveryRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("discovery_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { market?: string; runId?: string; status?: string }) =>
    z
      .object({
        market: z.enum(DISCOVERY_MARKETS).optional(),
        runId: z.string().uuid().optional(),
        status: z.string().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("story_candidates")
      .select("*, candidate_score_components(*), candidate_sources(*)")
      .order("content_score", { ascending: false })
      .limit(200);
    if (data.market) query = query.eq("market", data.market);
    if (data.runId) query = query.eq("discovery_run_id", data.runId);
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const startDiscoveryRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { market: string; overrideQuota?: boolean }) =>
    z
      .object({
        market: z.enum(DISCOVERY_MARKETS),
        overrideQuota: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { runMarketDiscovery } = await import("@/lib/discovery/run.server");
    return runMarketDiscovery({
      db: context.supabase,
      userId: context.userId,
      market: data.market,
      ...(data.overrideQuota === undefined ? {} : { overrideQuota: data.overrideQuota }),
    });
  });

export const dismissCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { candidateId: string; reason?: string }) =>
    z
      .object({ candidateId: z.string().uuid(), reason: z.string().max(500).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("story_candidates")
      .update({ status: "DISMISSED", dismissed_reason: data.reason ?? null })
      .eq("id", data.candidateId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const restoreCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { candidateId: string }) =>
    z.object({ candidateId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("story_candidates")
      .update({ status: "SCORED", dismissed_reason: null })
      .eq("id", data.candidateId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Promote a candidate into a Phase 1 Story. Deliberately manual.
 *
 * The story is created with the candidate's discovery facts only — no
 * research is copied in, because none has been done yet.
 */
export const promoteCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { candidateId: string; storyType?: string; priority?: string }) =>
    z
      .object({
        candidateId: z.string().uuid(),
        storyType: z.string().optional(),
        priority: z.enum(["Critical", "High", "Medium", "Low"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { promoteCandidateToStory } = await import("@/lib/discovery/promote.server");
    const result = await promoteCandidateToStory(context.supabase, {
      candidateId: data.candidateId,
      userId: context.userId,
      storyType: data.storyType,
      priority: data.priority,
      promotionSource: "MANUAL",
    });
    return { storyId: result.storyId, created: result.created };
  });
