/**
 * Candidate → Story promotion (server only).
 *
 * Shared by the manual promotion server function and the Phase 2D-2
 * autonomous pipeline, so both paths create exactly the same story shape and
 * neither can drift from the other. Promotion copies discovery facts only —
 * no research is invented here.
 */
import { CANDIDATE_TO_STORY_TYPE, type CandidateType } from "@/lib/discovery/domain";

import type { Db } from "@/lib/ai/context.server";

export type PromoteResult = { storyId: string; created: boolean; companyId: string };

export async function promoteCandidateToStory(
  db: Db,
  args: {
    candidateId: string;
    userId: string;
    storyType?: string | undefined;
    priority?: string | undefined;
    /** MANUAL for a human click, AUTOMATION for the autonomous pipeline. */
    promotionSource?: "MANUAL" | "AUTOMATION";
    pipelineRunId?: string | null | undefined;
  },
): Promise<PromoteResult> {
  const { data: candidate, error } = await db
    .from("story_candidates")
    .select("*")
    .eq("id", args.candidateId)
    .single();
  if (error || !candidate) throw new Error(error?.message ?? "Candidate not found");
  if (candidate.story_id) {
    return {
      storyId: String(candidate.story_id),
      created: false,
      companyId: String(candidate.company_id ?? ""),
    };
  }

  // A story needs a company. Unknown companies enter the universe as stubs so
  // nothing is invented beyond what discovery actually observed.
  let companyId = candidate.company_id as string | null;
  if (!companyId) {
    const { data: company, error: companyError } = await db
      .from("companies")
      .insert({
        name: candidate.company_name,
        ticker: candidate.ticker ?? String(candidate.company_name).slice(0, 12).toUpperCase(),
        exchange: candidate.exchange ?? (candidate.market === "India" ? "NSE" : "NASDAQ"),
        country: candidate.market === "India" ? "India" : "United States",
        currency: candidate.market === "India" ? "INR" : "USD",
        data_mode: "LIVE",
        created_by: args.userId,
      })
      .select("id")
      .single();
    if (companyError || !company)
      throw new Error(companyError?.message ?? "Could not create the company");
    companyId = String(company.id);
  }

  const storyType =
    args.storyType ?? CANDIDATE_TO_STORY_TYPE[candidate.primary_type as CandidateType] ?? "Custom";
  const priority =
    args.priority ??
    (candidate.priority_band === "IMMEDIATE"
      ? "Critical"
      : candidate.priority_band === "STRONG"
        ? "High"
        : candidate.priority_band === "WATCH"
          ? "Medium"
          : "Low");

  const { data: story, error: storyError } = await db
    .from("stories")
    .insert({
      company_id: companyId,
      title: candidate.title,
      description: [candidate.catalyst, candidate.suggested_angle, candidate.core_question]
        .filter(Boolean)
        .join("\n\n"),
      story_type: storyType,
      event_at: candidate.event_at,
      daily_change_pct: candidate.price_move_pct,
      volume_ratio: candidate.volume_ratio,
      primary_catalyst: candidate.catalyst,
      content_opportunity_score: candidate.content_score,
      priority,
      status: "New",
      is_demo: false,
      discovery_run_id: candidate.discovery_run_id,
      candidate_id: candidate.id,
      promotion_source: args.promotionSource ?? "MANUAL",
      pipeline_run_id: args.pipelineRunId ?? null,
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (storyError || !story) throw new Error(storyError?.message ?? "Could not create the story");

  await db
    .from("story_candidates")
    .update({
      status: "PROMOTED_TO_STORY",
      story_id: story.id,
      promoted_at: new Date().toISOString(),
      company_id: companyId,
    })
    .eq("id", candidate.id);

  return { storyId: String(story.id), created: true, companyId: String(companyId) };
}
