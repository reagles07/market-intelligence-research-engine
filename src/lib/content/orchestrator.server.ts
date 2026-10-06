import type { Row, JsonObject } from "@/lib/data-types";
/**
 * Phase 2C — Content Orchestrator (server only).
 *
 * This runner ORCHESTRATES the content pipeline that already exists. It does
 * not write prompts, does not research, does not schedule and never publishes.
 *
 * Fixed order for one research-ready story:
 *   validate story → select latest eligible packet → apply style profile →
 *   duplicate-request check → generate script(s) → word budget →
 *   numeric pre-check → fact audit → evidence-locked repair →
 *   research gap escalation → content readiness verdict.
 *
 * Everything is recorded in content_orchestration_runs / _steps so the UI can
 * show the timeline, cost and verdict.
 */
import {
  CONTENT_ELIGIBLE_READINESS,
  CONTENT_STEPS,
  type ContentReadiness,
  type ContentStepKey,
  type ContentStepStatus,
} from "@/lib/content/orchestration";
import {
  DEFAULT_TARGET_DURATION,
  type ShortDurationKey,
  type TargetDurationKey,
} from "@/lib/content/domain";
import { contentHash } from "@/lib/content/hash";

import type { Db } from "@/lib/ai/context.server";

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

export type ContentFormatRequest = {
  short?: ShortDurationKey | null;
  long?: TargetDurationKey | null;
  angle?: string | null;
};

// ------------------------------------------------------------------ step log

class StepLog {
  constructor(
    private db: Db,
    private runId: string,
  ) {}

  async seed() {
    await this.db.from("content_orchestration_steps").insert(
      CONTENT_STEPS.map((s, i) => ({
        run_id: this.runId,
        step_key: s.key,
        order_index: i,
        label: s.label,
        status: "PENDING",
      })),
    );
  }

  async start(key: ContentStepKey) {
    await this.db
      .from("content_orchestration_runs")
      .update({ current_step: key, status: "RUNNING" })
      .eq("id", this.runId);
    await this.db
      .from("content_orchestration_steps")
      .update({ status: "RUNNING", started_at: new Date().toISOString() })
      .eq("run_id", this.runId)
      .eq("step_key", key);
  }

  async finish(
    key: ContentStepKey,
    status: ContentStepStatus,
    summary: string,
    detail: JsonObject = {},
    error: string | null = null,
  ) {
    await this.db
      .from("content_orchestration_steps")
      .update({
        status,
        detail: { summary, ...detail } as never,
        error,
        completed_at: new Date().toISOString(),
      })
      .eq("run_id", this.runId)
      .eq("step_key", key);
  }
}

// ------------------------------------------------------------------ helpers

/**
 * The newest packet that content may be written from.
 * A packet that is still In Progress is usable only when nothing newer exists,
 * and it is reported as a warning.
 */
async function selectPacket(db: Db, storyId: string) {
  const { data } = await db
    .from("research_packets")
    .select("id,version_number,status,completion_pct,verification_score,created_at")
    .eq("story_id", storyId)
    .order("version_number", { ascending: false })
    .limit(5);
  const rows = data ?? [];
  if (!rows.length) return null;
  const complete = rows.find((r) => String(r["status"]) === "Complete");
  return complete ?? rows[0];
}

/** Latest research readiness verdict recorded for this story, if any. */
async function latestResearchVerdict(db: Db, storyId: string) {
  const { data } = await db
    .from("research_orchestration_runs")
    .select("id,readiness,readiness_reason,completed_at")
    .eq("story_id", storyId)
    .not("readiness", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as { readiness: string; readiness_reason: string | null } | null;
}

/**
 * Fingerprint of everything that determines the output. An identical repeat
 * request reuses the previous run instead of spending a single AI call.
 */
function requestKey(a: {
  storyId: string;
  packetId: string;
  packetVersion: number;
  formats: ContentFormatRequest;
  language: string;
  tone: string;
  styleProfileId: string | null;
  styleProfileVersion: number | null;
  model: string | null;
}) {
  return contentHash(
    JSON.stringify([
      a.storyId,
      a.packetId,
      a.packetVersion,
      a.formats.short ?? null,
      a.formats.long ?? null,
      a.formats.angle ?? null,
      a.language,
      a.tone,
      a.styleProfileId,
      a.styleProfileVersion,
      a.model,
    ]),
  );
}

// ------------------------------------------------------------------- runner

export async function runContentOrchestration(
  db: Db,
  args: {
    storyId: string;
    userId: string;
    formats?: ContentFormatRequest;
    language?: string | null;
    tone?: string | null;
    styleProfileId?: string | null;
    model?: string | null;
    allowRepair?: boolean;
    resolveGaps?: boolean;
    /** Skip the duplicate-request cache and force a fresh generation. */
    force?: boolean;
    /** Manual escape hatch: produce a draft even when research is not ready. */
    overrideReadiness?: boolean;

    triggerSource?: string;
  },
) {
  const startedAt = new Date().toISOString();
  // Only default to a Short when the caller named no format at all.
  const asked = Boolean(args.formats?.short || args.formats?.long);
  const formats: ContentFormatRequest = {
    short: args.formats?.short ?? (asked ? null : "short_60"),
    long: args.formats?.long ?? null,
    angle: args.formats?.angle ?? null,
  };
  const language = args.language ?? "Tanglish";
  const tone = args.tone ?? "Analytical";

  const { data: story } = await db
    .from("stories")
    .select("id,company_id,title,status,companies(id,name,ticker,country)")
    .eq("id", args.storyId)
    .maybeSingle();
  if (!story) throw new Error("Story not found");
  const company = story.companies;
  const market = String(company?.["country"] ?? "");

  const { data: runRow } = await db
    .from("content_orchestration_runs")
    .insert({
      story_id: args.storyId,
      company_id: story.company_id,
      market,
      trigger_source: args.triggerSource ?? "MANUAL",
      status: "RUNNING",
      formats: formats as never,
      started_at: startedAt,
      created_by: args.userId,
    })
    .select("id")
    .single();

  if (!runRow) throw new Error("Failed to create orchestration run");
  const runId = runRow.id;
  const log = new StepLog(db, runId);
  await log.seed();

  const warnings: string[] = [];
  const errors: string[] = [];
  const shortScriptIds: string[] = [];
  let longScriptId: string | null = null;
  const wordCounts: JsonObject = {};
  const auditSummary: JsonObject = {};
  let repairsRun = 0;

  await db.from("stories").update({ content_status: "IN_PRODUCTION" }).eq("id", args.storyId);

  const finalize = async (
    status: string,
    readiness: ContentReadiness,
    reason: string,
    extra: JsonObject = {},
  ) => {
    // Cost is measured from what the AI layer actually logged for this story.
    const { data: aiRows } = await db
      .from("ai_requests")
      .select("input_tokens,output_tokens,estimated_cost_usd")
      .eq("story_id", args.storyId)
      .gte("created_at", startedAt);
    const ai = aiRows ?? [];

    const payload = {
      status,
      current_step: null,
      completed_at: new Date().toISOString(),
      readiness,
      readiness_reason: reason,
      long_script_id: longScriptId,
      short_script_ids: shortScriptIds as never,
      scripts_generated: shortScriptIds.length + (longScriptId ? 1 : 0),
      word_counts: wordCounts as never,
      audit_summary: auditSummary as never,
      repairs_run: repairsRun,
      ai_calls: ai.length,
      input_tokens: ai.reduce((a, r) => a + num(r["input_tokens"]), 0),
      output_tokens: ai.reduce((a, r) => a + num(r["output_tokens"]), 0),
      estimated_cost_usd: ai.reduce((a, r) => a + num(r["estimated_cost_usd"]), 0),
      warnings: warnings as never,
      errors: errors as never,
      ...extra,
    };
    await db.from("content_orchestration_runs").update(payload).eq("id", runId);

    const storyContentStatus =
      readiness === "READY_FOR_REVIEW"
        ? "READY_FOR_REVIEW"
        : readiness === "RESEARCH_REQUIRED"
          ? "RESEARCH_REQUIRED"
          : readiness === "NEEDS_FACT_CHECK"
            ? "NEEDS_FACT_CHECK"
            : "FAILED";
    await db.from("stories").update({ content_status: storyContentStatus }).eq("id", args.storyId);

    return {
      ok: status === "COMPLETE",
      runId,
      status,
      readiness,
      reason,
      longScriptId,
      shortScriptIds,
      wordCounts,
      auditSummary,
      aiCalls: payload.ai_calls,
      estimatedCostUsd: payload.estimated_cost_usd,
      cacheHit: Boolean(extra["cache_hit"]),
      warnings,
      errors,
    };
  };

  const skipRest = async (from: ContentStepKey, note: string) => {
    const idx = CONTENT_STEPS.findIndex((s) => s.key === from);
    for (const s of CONTENT_STEPS.slice(idx)) {
      await log.finish(s.key, "SKIPPED", note);
    }
  };

  try {
    // 1 — validate story ------------------------------------------------------
    await log.start("validate_story");
    if (!company) {
      await log.finish("validate_story", "FAILED", "Story has no linked company.");
      errors.push("Story has no linked company.");
      await skipRest("select_packet", "Story validation failed.");
      return await finalize("FAILED", "BLOCKED", "Story has no linked company.");
    }
    const verdict = await latestResearchVerdict(db, args.storyId);
    const ineligible =
      Boolean(verdict) && !CONTENT_ELIGIBLE_READINESS.includes(verdict!.readiness as never);
    if (ineligible && !args.overrideReadiness) {
      const reason =
        `Research readiness is ${verdict!.readiness}. ${verdict!.readiness_reason ?? ""}`.trim();
      await log.finish("validate_story", "FAILED", reason, { readiness: verdict!.readiness });
      errors.push(reason);
      await skipRest("select_packet", "Story is not research-ready.");
      return await finalize("BLOCKED", "BLOCKED", reason);
    }
    if (ineligible) {
      warnings.push(
        `Research readiness is ${verdict!.readiness} and the gate was overridden manually. Treat the output as a draft: the fact audit still decides what is sayable.`,
      );
    }
    if (verdict?.readiness === "NEEDS_REVIEW") {
      warnings.push(
        "Research readiness is NEEDS_REVIEW — content is generated, but a human must review the evidence before approval.",
      );
    }

    await log.finish(
      "validate_story",
      verdict?.readiness === "NEEDS_REVIEW" ? "WARNING" : "COMPLETE",
      `${company["ticker"]} — ${company["name"]}${verdict ? ` · research ${verdict.readiness}` : " · no orchestrated research run on record"}.`,
      { readiness: verdict?.readiness ?? null, market },
    );

    // 2 — select packet -------------------------------------------------------
    await log.start("select_packet");
    const packet = await selectPacket(db, args.storyId);
    if (!packet) {
      await log.finish("select_packet", "FAILED", "This story has no research packet yet.");
      errors.push("This story has no research packet yet.");
      await skipRest("select_style", "No research packet.");
      return await finalize("BLOCKED", "RESEARCH_REQUIRED", "Run research orchestration first.");
    }
    const packetVersion = num(packet["version_number"]);
    if (String(packet["status"]) !== "Complete") {
      warnings.push(`Research packet v${packetVersion} is still "${packet["status"]}".`);
    }
    await db
      .from("content_orchestration_runs")
      .update({ packet_id: packet["id"], packet_version: packetVersion })
      .eq("id", runId);
    await log.finish(
      "select_packet",
      String(packet["status"]) === "Complete" ? "COMPLETE" : "WARNING",
      `Packet v${packetVersion} · ${packet["status"]} · ${num(packet["completion_pct"])}% complete · verification ${num(packet["verification_score"])}.`,
      { packetId: packet["id"], packetVersion },
    );

    // 3 — style profile -------------------------------------------------------
    await log.start("select_style");
    const { loadStyleProfile } = await import("@/lib/ai/style.server");
    const style = await loadStyleProfile(db as never, args.styleProfileId ?? null);
    if (!style) {
      warnings.push(
        "No script style profile is active — the generator falls back to its base voice.",
      );
    }
    await db
      .from("content_orchestration_runs")
      .update({
        style_profile_id: style?.id ?? null,
        style_profile_version: style?.version ?? null,
      })
      .eq("id", runId);
    await log.finish(
      "select_style",
      style ? "COMPLETE" : "WARNING",
      style
        ? `${style.name} (v${style.version}) applied to writing only.`
        : "No style profile found.",
      { styleProfileId: style?.id ?? null, styleProfileVersion: style?.version ?? null },
    );

    // 4 — duplicate request check --------------------------------------------
    await log.start("cache_check");
    const key = requestKey({
      storyId: args.storyId,
      packetId: String(packet["id"]),
      packetVersion,
      formats,
      language,
      tone,
      styleProfileId: style?.id ?? null,
      styleProfileVersion: style?.version ?? null,
      model: args.model ?? null,
    });
    await db.from("content_orchestration_runs").update({ request_key: key }).eq("id", runId);

    if (!args.force) {
      const { data: prior } = await db
        .from("content_orchestration_runs")
        .select(
          "id,long_script_id,short_script_ids,readiness,readiness_reason,word_counts,audit_summary",
        )
        .eq("request_key", key)
        .eq("status", "COMPLETE")
        .neq("id", runId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prior) {
        longScriptId = prior.long_script_id ?? null;
        for (const id of (prior.short_script_ids ?? []) as string[]) shortScriptIds.push(id);
        Object.assign(wordCounts, prior.word_counts ?? {});
        Object.assign(auditSummary, prior.audit_summary ?? {});
        await log.finish(
          "cache_check",
          "COMPLETE",
          "Identical request already produced content from this packet, style and format — reusing it. No AI calls made.",
          { reusedRunId: prior.id },
        );
        await skipRest("generate_scripts", "Reused an identical earlier run.");
        return await finalize(
          "COMPLETE",
          (prior.readiness as ContentReadiness) ?? "NEEDS_FACT_CHECK",
          prior.readiness_reason ?? "Reused an identical earlier content run.",
          { cache_hit: true, reused_run_id: prior.id },
        );
      }
    }
    await log.finish(
      "cache_check",
      "COMPLETE",
      args.force
        ? "Forced regeneration — the duplicate-request cache was bypassed."
        : "No identical earlier run for this packet, style and format.",
      { requestKey: key },
    );

    // 5 — generate ------------------------------------------------------------
    await log.start("generate_scripts");
    const { runGenerateShortScript, runGenerateLongScript } =
      await import("@/lib/ai/script.server");
    const generated: Array<{ kind: string; scriptId: string; words: number; label: string }> = [];

    if (formats.short) {
      const res = await runGenerateShortScript(db as never, {
        packetId: String(packet["id"]),
        storyId: args.storyId,
        duration: formats.short,
        angle: formats.angle ?? null,
        language: language as never,
        tone,
        model: args.model ?? null,
        styleProfileId: style?.id ?? null,
        userId: args.userId,
      });
      if (!res["ok"]) {
        const msg = String(res["error"] ?? "Short generation failed");
        await log.finish("generate_scripts", "FAILED", msg, {}, msg);
        errors.push(msg);
        await skipRest("word_budget", "Generation failed.");
        return await finalize(
          "FAILED",
          res["researchUpdateRequired"] ? "RESEARCH_REQUIRED" : "FAILED",
          msg,
        );
      }
      shortScriptIds.push(String(res["scriptId"]));
      wordCounts["short"] = {
        words: num(res["spokenWords"] ?? res["words"]),
        low: num(res["targetWordLow"]),
        high: num(res["targetWordHigh"]),
        withinBudget: Boolean(res["withinWordBudget"]),
        compressionPass: Boolean(res["compressionPass"]),
      };
      generated.push({
        kind: "short",
        scriptId: String(res["scriptId"]),
        words: num(res["spokenWords"] ?? res["words"]),
        label: String(formats.short),
      });
    }

    if (formats.long) {
      const res = await runGenerateLongScript(db as never, {
        packetId: String(packet["id"]),
        storyId: args.storyId,
        targetDuration: formats.long ?? DEFAULT_TARGET_DURATION,
        language: language as never,
        tone,
        model: args.model ?? null,
        styleProfileId: style?.id ?? null,
        userId: args.userId,
      });
      if (!res["ok"]) {
        const msg = String(res["error"] ?? "Long-form generation failed");
        await log.finish("generate_scripts", "FAILED", msg, { generated }, msg);
        errors.push(msg);
        await skipRest("word_budget", "Generation failed.");
        return await finalize(
          "FAILED",
          res["researchUpdateRequired"] ? "RESEARCH_REQUIRED" : "FAILED",
          msg,
        );
      }
      longScriptId = String(res["scriptId"]);
      wordCounts["long"] = {
        words: num(res["words"]),
        estimatedSeconds: num(res["estimatedSeconds"]),
        sections: num(res["sections"]),
      };
      generated.push({
        kind: "long",
        scriptId: longScriptId,
        words: num(res["words"]),
        label: String(formats.long),
      });
    }

    if (!generated.length) {
      await log.finish("generate_scripts", "FAILED", "No output format was requested.");
      errors.push("No output format was requested.");
      await skipRest("word_budget", "Nothing to produce.");
      return await finalize("FAILED", "FAILED", "No output format was requested.");
    }

    await db
      .from("content_orchestration_runs")
      .update({
        long_script_id: longScriptId,
        short_script_ids: shortScriptIds as never,
        scripts_generated: generated.length,
      })
      .eq("id", runId);
    await log.finish(
      "generate_scripts",
      "COMPLETE",
      generated.map((g) => `${g.kind} (${g.label}) — ${g.words} words`).join(" · "),
      { generated },
    );

    // 6 — word budget ---------------------------------------------------------
    await log.start("word_budget");
    const shortBudget = wordCounts["short"] as
      { withinBudget?: boolean; words?: number; low?: number; high?: number } | undefined;
    if (shortBudget && shortBudget.withinBudget === false) {
      warnings.push(
        `The Short is ${shortBudget.words} words against a ${shortBudget.low}–${shortBudget.high} budget even after the compression pass.`,
      );
    }
    await log.finish(
      "word_budget",
      shortBudget && shortBudget.withinBudget === false ? "WARNING" : "COMPLETE",
      shortBudget
        ? `Short: ${shortBudget.words} words (target ${shortBudget.low}–${shortBudget.high})${shortBudget.withinBudget ? " — within budget." : " — outside budget."}`
        : "No Short requested; long-form length is checked against its chapter plan.",
      { wordCounts },
    );

    // 7/8/9 — pre-check + audit + repair, per script --------------------------
    await log.start("numeric_precheck");
    await log.start("fact_audit");
    const { runAuditRepairCycle } = await import("@/lib/ai/repair.server");

    const audits: JsonObject[] = [];
    for (const g of generated) {
      const cycle = (await runAuditRepairCycle(db as never, {
        scriptId: g.scriptId,
        model: args.model ?? null,
        userId: args.userId,
        allowRepair: args.allowRepair !== false,
      })) as JsonObject;
      if (!cycle["ok"]) {
        errors.push(`${g.kind}: ${String(cycle["error"] ?? "audit failed")}`);
        audits.push({ kind: g.kind, scriptId: g.scriptId, ok: false, error: cycle["error"] });
        continue;
      }
      if (cycle["repaired"]) repairsRun += 1;
      audits.push({
        kind: g.kind,
        scriptId: g.scriptId,
        ok: true,
        status: cycle["status"],
        readyForReview: cycle["readyForReview"],
        blocking: num(cycle["blocking"]),
        warnings: num(cycle["warnings"]),
        numericFailures: num(cycle["numericFailures"]),
        precheckBlocking: num((cycle["precheck"] as Record<string, unknown>)?.["blocking"]),
        precheckTotal: num((cycle["precheck"] as Record<string, unknown>)?.["total"]),
        repaired: Boolean(cycle["repaired"]),
        gapsDetected: num((cycle["gaps"] as Record<string, unknown>)?.["created"] ?? 0),
        readinessGate: cycle["readinessGate"] ?? null,
      });
    }
    auditSummary["scripts"] = audits;

    const precheckBlocking = audits.reduce((a, r) => a + num(r["precheckBlocking"]), 0);
    const precheckTotal = audits.reduce((a, r) => a + num(r["precheckTotal"]), 0);
    await log.finish(
      "numeric_precheck",
      precheckBlocking > 0 ? "WARNING" : "COMPLETE",
      `${precheckTotal} numbers checked deterministically against the packet · ${precheckBlocking} blocking mismatch(es).`,
      { precheckBlocking, precheckTotal },
    );

    const failedAudits = audits.filter((a) => a["ok"] === false);
    const allReady = audits.length > 0 && audits.every((a) => a["ok"] && a["readyForReview"]);
    await log.finish(
      "fact_audit",
      failedAudits.length ? "FAILED" : allReady ? "COMPLETE" : "WARNING",
      audits
        .map((a) =>
          a["ok"]
            ? `${a["kind"]}: ${a["status"]} · ${a["blocking"]} blocking · ${a["warnings"]} warning(s)`
            : `${a["kind"]}: audit failed`,
        )
        .join(" · "),
      { audits },
    );

    await log.start("repair");
    await log.finish(
      "repair",
      repairsRun ? (allReady ? "COMPLETE" : "WARNING") : "SKIPPED",
      repairsRun
        ? `${repairsRun} evidence-locked repair pass(es) run — repairs may only reword, never add facts.`
        : "No repair needed — the first audit left no blocking issue.",
      { repairsRun },
    );

    // 10 — gap escalation -----------------------------------------------------
    await log.start("gap_escalation");
    let gapResult: JsonObject | null = null;
    const gapsDetected = audits.reduce((a, r) => a + num(r["gapsDetected"]), 0);
    if (!allReady && args.resolveGaps !== false && gapsDetected > 0) {
      const { runResolveScriptGaps } = await import("@/lib/ai/gaps.server");
      const target = (audits.find((a) => a["ok"] && !a["readyForReview"]) ??
        audits[0]) as JsonObject;
      gapResult = (await runResolveScriptGaps(db as never, {
        scriptId: String(target["scriptId"]),
        model: args.model ?? null,
        rebuildPacket: true,
        userId: args.userId,
      })) as JsonObject;
      await db
        .from("content_orchestration_runs")
        .update({
          gaps: (gapResult["gapIds"] ?? []) as never,
          gaps_resolved: num(gapResult["resolved"]),
          gaps_unresolved: num(gapResult["notFound"]) + num(gapResult["conflicting"]),
        })
        .eq("id", runId);
      await log.finish(
        "gap_escalation",
        num(gapResult["resolved"]) > 0 ? "COMPLETE" : "WARNING",
        `${num(gapResult["resolved"])} gap(s) closed with new evidence · ${num(gapResult["notFound"])} not found · ${num(gapResult["conflicting"])} conflicting.${
          gapResult["packet"]
            ? ` New research packet v${(gapResult["packet"] as Record<string, unknown>)["version"]} created — regenerate to use it.`
            : ""
        }`,
        { gapResult },
      );
    } else {
      await log.finish(
        "gap_escalation",
        "SKIPPED",
        allReady
          ? "No blocking issues remained, so no research escalation was needed."
          : gapsDetected === 0
            ? "The audit found no research-required gap; remaining issues are wording, not missing evidence."
            : "Gap escalation was disabled for this run.",
      );
    }

    // 11 — readiness ----------------------------------------------------------
    await log.start("readiness");
    let readiness: ContentReadiness;
    let reason: string;
    if (failedAudits.length) {
      readiness = "FAILED";
      reason = "One or more scripts could not be audited.";
    } else if (allReady) {
      readiness = "READY_FOR_REVIEW";
      reason =
        "Every generated script passed the readiness gate with zero blocking issues. A human still approves and publishes.";
    } else if (gapResult && num(gapResult["resolved"]) > 0) {
      readiness = "RESEARCH_REQUIRED";
      reason =
        "New evidence was found and a new research packet version was created. Regenerate the script from it.";
    } else if (gapsDetected > 0) {
      readiness = "RESEARCH_REQUIRED";
      reason = "Blocking statements depend on evidence the research packet does not hold.";
    } else {
      readiness = "NEEDS_FACT_CHECK";
      reason = "Blocking fact-check issues remain after the permitted repair pass.";
    }
    await log.finish(
      "readiness",
      readiness === "READY_FOR_REVIEW" ? "COMPLETE" : "WARNING",
      reason,
      { readiness },
    );

    return await finalize(
      failedAudits.length ? "FAILED" : "COMPLETE",
      readiness,
      reason,
      gapResult ? { gaps_resolved: num(gapResult["resolved"]) } : {},
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(msg);
    await db
      .from("content_orchestration_steps")
      .update({ status: "FAILED", error: msg, completed_at: new Date().toISOString() })
      .eq("run_id", runId)
      .in("status", ["RUNNING", "PENDING"]);
    return await finalize("FAILED", "FAILED", msg);
  }
}

// -------------------------------------------------------------------- reads

export async function listContentRuns(db: Db, storyId: string, limit = 5) {
  const { data: runs } = await db
    .from("content_orchestration_runs")
    .select("*")
    .eq("story_id", storyId)
    .order("started_at", { ascending: false })
    .limit(limit);
  const list = runs ?? [];
  if (!list.length)
    return { runs: [], steps: {} as Record<string, Row<"content_orchestration_steps">[]> };

  const { data: steps } = await db
    .from("content_orchestration_steps")
    .select("*")
    .in(
      "run_id",
      list.map((r) => r["id"]),
    )
    .order("order_index", { ascending: true });

  const grouped: Record<string, Row<"content_orchestration_steps">[]> = {};
  for (const s of steps ?? []) {
    (grouped[String(s["run_id"])] ??= []).push(s);
  }
  return { runs: list, steps: grouped };
}
