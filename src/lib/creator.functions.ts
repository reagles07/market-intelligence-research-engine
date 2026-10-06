/**
 * Creator-workflow server functions (UX cleanup phase).
 *
 * Thin RPC wrappers. They expose a "today" overview, per-run candidate
 * boards, and a first-class "Research any stock" entry point. Manual
 * research bypasses discovery selection thresholds only — every evidence,
 * readiness and audit gate still applies unchanged.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ELIGIBLE_RUN_STATUSES, TEST_RUN_TYPES, isEligibleRun } from "@/lib/creator/domain";
import { MARKETS } from "@/lib/domain";

const CANDIDATE_OPEN_STATUSES = ["SCORED", "SHORTLISTED", "NEW"];

export const getTodayOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase;

    const [
      { data: settings },
      { data: runs },
      { count: scriptsNeedingReview },
      { count: scriptsReady },
      { count: claimsAttention },
      { data: openRuns },
    ] = await Promise.all([
      db.from("automation_settings").select("*").limit(1).maybeSingle(),
      db
        .from("discovery_runs")
        .select(
          "id, market, status, started_at, completed_at, candidates_created, raw_signals, estimated_cost_usd, run_type",
        )
        // Only settled, non-acceptance runs may represent "current intelligence".
        .in("status", ELIGIBLE_RUN_STATUSES as unknown as string[])
        .not("run_type", "in", `(${TEST_RUN_TYPES.join(",")})`)
        .order("started_at", { ascending: false })
        .limit(40),
      db
        .from("scripts")
        .select("id", { count: "exact", head: true })
        .in("status", ["Needs Fact Check", "Draft"]),
      db
        .from("scripts")
        .select("id", { count: "exact", head: true })
        .eq("status", "Ready for Review"),
      db
        .from("claims")
        .select("id", { count: "exact", head: true })
        .in("verification_status", ["Conflicting", "Unsupported"]),
      db
        .from("research_orchestration_runs")
        .select("id, story_id, status, current_step, started_at, readiness")
        .in("status", ["QUEUED", "RUNNING", "NEEDS_REVIEW", "INSUFFICIENT_DATA"])
        .order("started_at", { ascending: false })
        .limit(30),
    ]);

    type RunSummary = NonNullable<typeof runs>[number];
    const latestRunByMarket: Record<string, RunSummary | null> = { US: null, India: null };
    for (const run of runs ?? []) {
      if (run.market in latestRunByMarket && !latestRunByMarket[run.market]) {
        latestRunByMarket[run.market] = run;
      }
    }

    const runIds = Object.values(latestRunByMarket)
      .filter(Boolean)
      .map((r) => r!.id);
    const { data: candidates } = runIds.length
      ? await db
          .from("story_candidates")
          .select(
            "id, discovery_run_id, market, ticker, company_name, title, primary_type, content_score, status, discovered_at, signal_count, story_id",
          )
          .in("discovery_run_id", runIds)
          .in("status", CANDIDATE_OPEN_STATUSES)
          .order("content_score", { ascending: false })
          .limit(12)
      : { data: [] };

    return {
      automation: settings
        ? {
            automationEnabled: Boolean(settings.automation_enabled),
            dryRun: Boolean(settings.dry_run),
            indiaEnabled: Boolean(settings.india_enabled),
            usEnabled: Boolean(settings.us_enabled),
          }
        : null,
      latestRuns: latestRunByMarket,
      topCandidates: candidates ?? [],
      attention: {
        scriptsNeedingReview: scriptsNeedingReview ?? 0,
        scriptsReady: scriptsReady ?? 0,
        claimsAttention: claimsAttention ?? 0,
        openResearchRuns: openRuns ?? [],
      },
      generatedAt: new Date().toISOString(),
    };
  });

/**
 * Lazy detail for one "Needs attention" card. Only fetched when the creator
 * expands a card, and always capped — the dashboard never loads huge lists.
 */
export const getAttentionDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: z.enum(["research", "scripts_review", "scripts_ready", "claims"]),
        limit: z.number().int().min(1).max(10).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const limit = data.limit ?? 5;

    if (data.kind === "research") {
      const { data: runs } = await db
        .from("research_orchestration_runs")
        .select("id, story_id, status, current_step, started_at, updated_at, readiness")
        .in("status", ["QUEUED", "RUNNING", "NEEDS_REVIEW", "INSUFFICIENT_DATA"])
        .order("started_at", { ascending: false })
        .limit(limit);
      const storyIds = (runs ?? []).map((r) => r.story_id);
      const { data: stories } = storyIds.length
        ? await db.from("stories").select("id, title, companies(ticker, name)").in("id", storyIds)
        : { data: [] };
      const byStory = new Map((stories ?? []).map((s) => [s.id, s] as const));
      return {
        kind: data.kind,
        items: (runs ?? []).map((r) => {
          const s = byStory.get(r.story_id);
          return {
            id: r.id,
            storyId: r.story_id,
            ticker: s?.companies?.ticker ?? null,
            companyName: s?.companies?.name ?? null,
            title: s?.title ?? null,
            status: r.status,
            currentStep: r.current_step,
            readiness: r.readiness,
            startedAt: r.started_at,
            updatedAt: r.updated_at ?? r.started_at,
          };
        }),
      };
    }

    if (data.kind === "scripts_review" || data.kind === "scripts_ready") {
      const statuses =
        data.kind === "scripts_ready" ? ["Ready for Review"] : ["Needs Fact Check", "Draft"];
      const { data: scripts } = await db
        .from("scripts")
        .select(
          "id, story_id, title, status, audit_status, format, series_key, series_part, updated_at, companies(ticker)",
        )
        .in("status", statuses)
        .order("updated_at", { ascending: false })
        .limit(limit);
      return {
        kind: data.kind,
        items: (scripts ?? []).map((s) => ({
          id: s.id,
          storyId: s.story_id,
          ticker: s.companies?.ticker ?? null,
          title: s.title,
          status: s.status,
          auditStatus: s.audit_status,
          packRole:
            s.series_key == null
              ? null
              : s.series_part === 0
                ? "Long-form"
                : `Short ${s.series_part}`,
          format: s.format,
          updatedAt: s.updated_at,
        })),
      };
    }

    const { data: claims } = await db
      .from("claims")
      .select("id, story_id, claim_text, verification_status, claim_category, companies(ticker)")
      .in("verification_status", ["Conflicting", "Unsupported"])
      .order("created_at", { ascending: false })
      .limit(limit);
    return {
      kind: data.kind,
      items: (claims ?? []).map((c) => ({
        id: c.id,
        storyId: c.story_id,
        ticker: c.companies?.ticker ?? null,
        claimText: (c.claim_text ?? "").slice(0, 160),
        verificationStatus: c.verification_status,
        category: c.claim_category,
      })),
    };
  });

/** Candidates for one run, defaulting to the latest run for the market. */

export const listRunBoard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { market: string; runId?: string }) =>
    z.object({ market: z.enum(MARKETS), runId: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;

    const { data: runs, error: runErr } = await db
      .from("discovery_runs")
      .select(
        "id, market, status, started_at, completed_at, candidates_created, raw_signals, estimated_cost_usd, run_type, notes",
      )
      .eq("market", data.market)
      .order("started_at", { ascending: false })
      .limit(20);
    if (runErr) throw new Error(runErr.message);

    // Default = latest *eligible* run (settled, non-acceptance). A failed,
    // in-progress or acceptance run never becomes "latest intelligence",
    // but every run stays available in history.
    const latestEligible = (runs ?? []).find((r) => isEligibleRun(r)) ?? null;
    const selected =
      (data.runId ? (runs ?? []).find((r) => r.id === data.runId) : null) ??
      latestEligible ??
      runs?.[0] ??
      null;

    if (!selected) return { run: null, candidates: [], runs: runs ?? [] };

    const { data: candidates, error } = await db
      .from("story_candidates")
      .select("*, candidate_score_components(*), candidate_sources(*)")
      .eq("discovery_run_id", selected.id)
      .order("content_score", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    return { run: selected, candidates: candidates ?? [], runs: runs ?? [] };
  });

const manualResearchInput = z.object({
  companyId: z.string().uuid().optional(),
  newCompany: z
    .object({
      ticker: z.string().min(1).max(20),
      name: z.string().min(1).max(200),
      exchange: z.string().min(1).max(40),
      country: z.enum(MARKETS),
      sector: z.string().max(120).optional(),
    })
    .optional(),
  title: z.string().max(300).optional(),
  autostart: z.boolean().optional(),
});

/**
 * Research any stock: resolve (or conservatively create) the canonical
 * company, open a manual research story for it, and optionally start the
 * standard research orchestration. Discovery thresholds do not apply;
 * every downstream evidence/readiness gate does.
 */
export const startManualResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => manualResearchInput.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    if (!data.companyId && !data.newCompany) {
      throw new Error("Select a company or provide a ticker to research.");
    }

    // --- resolve canonical company -------------------------------------
    let companyId = data.companyId ?? null;
    let createdCompany = false;
    let company: { id: string; ticker: string; name: string; country: string } | null = null;

    if (companyId) {
      const { data: row, error } = await db
        .from("companies")
        .select("id, ticker, name, country")
        .eq("id", companyId)
        .single();
      if (error) throw new Error(error.message);
      company = row;
    } else if (data.newCompany) {
      const ticker = data.newCompany.ticker.trim().toUpperCase();
      const { data: existing } = await db
        .from("companies")
        .select("id, ticker, name, country")
        .ilike("ticker", ticker)
        .eq("country", data.newCompany.country)
        .limit(1)
        .maybeSingle();
      if (existing) {
        company = existing;
      } else {
        // Conservative create: identity fields only, fundamentals stay null
        // until real research/providers populate them.
        const { data: inserted, error } = await db
          .from("companies")
          .insert({
            ticker,
            name: data.newCompany.name.trim(),
            exchange: data.newCompany.exchange.trim(),
            country: data.newCompany.country,
            currency: data.newCompany.country === "India" ? "INR" : "USD",
            sector: data.newCompany.sector?.trim() || null,
          })
          .select("id, ticker, name, country")
          .single();
        if (error) throw new Error(error.message);
        company = inserted;
        createdCompany = true;
      }
      // Attach the canonical company to any unlinked universe row.
      if (company) {
        await db
          .from("universe_members")
          .update({ company_id: company.id })
          .is("company_id", null)
          .ilike("ticker", company.ticker);
      }
    }
    if (!company) throw new Error("Could not resolve the company.");
    companyId = company.id;

    // --- open a manual research story -----------------------------------
    const title =
      data.title?.trim() ||
      `Manual research — ${company.ticker} — ${new Date().toISOString().slice(0, 10)}`;
    const { data: story, error: storyErr } = await db
      .from("stories")
      .insert({
        company_id: companyId,
        title,
        description:
          "Manually started research. Discovery selection thresholds do not apply; all evidence and readiness gates still do.",
        story_type: "Custom",
        priority: "Medium",
        status: "New",
        primary_catalyst: "Manual research request",
      })
      .select("id")
      .single();
    if (storyErr) throw new Error(storyErr.message);

    // --- optionally start the standard orchestration --------------------
    let run: { status: string } | null = null;
    if (data.autostart !== false) {
      const { runResearchOrchestration } = await import("@/lib/research/orchestrator.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      run = await runResearchOrchestration(supabaseAdmin as never, {
        storyId: story.id,
        userId: context.userId,
        triggerSource: "MANUAL",
      });
    }

    return {
      storyId: story.id,
      companyId,
      createdCompany,
      runStatus: run?.status ?? null,
    };
  });
