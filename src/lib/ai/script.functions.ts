/**
 * Content engine server functions — the browser's only entry point.
 *
 * These never perform research: they read one research packet version and
 * write scripts, evidence links, content assets and audits.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LANGUAGES } from "@/lib/domain";
import { PLATFORMS, SCRIPT_TONES, SHORT_DURATIONS, TARGET_DURATIONS } from "@/lib/content/domain";

const language = z.enum(LANGUAGES).optional();
const tone = z.enum(SCRIPT_TONES).optional();
const platform = z.enum(PLATFORMS).optional();
const targetDuration = z
  .enum(TARGET_DURATIONS.map((d) => d.key) as [string, ...string[]])
  .optional();
const shortDuration = z.enum(SHORT_DURATIONS.map((d) => d.key) as [string, ...string[]]).optional();

const baseShape = {
  storyId: z.string().uuid().optional(),
  packetId: z.string().uuid().optional(),
  model: z.string().optional(),
  styleProfileId: z.string().uuid().optional(),
};

const needsTarget = (v: { storyId?: string | undefined; packetId?: string | undefined }) =>
  Boolean(v.storyId || v.packetId);
const TARGET_MSG = "storyId or packetId is required";

export const generateLongScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        ...baseShape,
        targetDuration,
        language,
        tone,
        platform,
        regenerateFromScriptId: z.string().uuid().optional(),
      })
      .refine(needsTarget, TARGET_MSG)
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runGenerateLongScript } = await import("@/lib/ai/script.server");
    return runGenerateLongScript(context.supabase, {
      storyId: data.storyId ?? null,
      packetId: data.packetId ?? null,
      targetDuration: (data.targetDuration ?? null) as never,
      language: data.language ?? null,
      tone: data.tone ?? null,
      model: data.model ?? null,
      styleProfileId: data.styleProfileId ?? null,
      platform: data.platform ?? null,
      regenerateFromScriptId: data.regenerateFromScriptId ?? null,
      userId: context.userId,
    });
  });

export const generateShortScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        ...baseShape,
        duration: shortDuration,
        angle: z.string().optional(),
        angleKey: z.string().optional(),
        language,
        tone,
        platform,
        regenerateFromScriptId: z.string().uuid().optional(),
      })
      .refine(needsTarget, TARGET_MSG)
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runGenerateShortScript } = await import("@/lib/ai/script.server");
    return runGenerateShortScript(context.supabase, {
      storyId: data.storyId ?? null,
      packetId: data.packetId ?? null,
      duration: (data.duration ?? null) as never,
      angle: data.angle ?? null,
      angleKey: data.angleKey ?? null,
      language: data.language ?? null,
      tone: data.tone ?? null,
      model: data.model ?? null,
      styleProfileId: data.styleProfileId ?? null,
      platform: data.platform ?? null,
      regenerateFromScriptId: data.regenerateFromScriptId ?? null,
      userId: context.userId,
    });
  });

export const generateShortSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ ...baseShape, language, tone, platform })
      .refine(needsTarget, TARGET_MSG)
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runGenerateShortSeries } = await import("@/lib/ai/script.server");
    return runGenerateShortSeries(context.supabase, {
      storyId: data.storyId ?? null,
      packetId: data.packetId ?? null,
      language: data.language ?? null,
      tone: data.tone ?? null,
      model: data.model ?? null,
      styleProfileId: data.styleProfileId ?? null,
      platform: data.platform ?? null,
      userId: context.userId,
    });
  });

/** ONE action → a content pack: 6+ distinct Shorts plus one long-form script. */
export const generateContentPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ ...baseShape, targetDuration, language, tone, platform })
      .refine(needsTarget, TARGET_MSG)
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runGenerateContentPack } = await import("@/lib/ai/script.server");
    return runGenerateContentPack(context.supabase, {
      storyId: data.storyId ?? null,
      packetId: data.packetId ?? null,
      targetDuration: (data.targetDuration ?? null) as never,
      language: data.language ?? null,
      tone: data.tone ?? null,
      model: data.model ?? null,
      styleProfileId: data.styleProfileId ?? null,
      platform: data.platform ?? null,
      userId: context.userId,
    });
  });

/** The creator/channel identity spoken in the self-intro line. */
export const getCreatorIdentity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadCreatorIdentity } = await import("@/lib/ai/creator-identity.server");
    return loadCreatorIdentity(context.supabase, context.userId);
  });

export const updateCreatorIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        channelName: z.string().max(120).optional(),
        hostName: z.string().max(120).optional(),
        defaultPlatform: z.enum(PLATFORMS).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const trim = (v?: string) => {
      const s = (v ?? "").trim();
      return s.length ? s : null;
    };
    const { error } = await context.supabase
      .from("profiles")
      .update({
        channel_name: trim(data.channelName),
        host_name: trim(data.hostName),
        ...(data.defaultPlatform ? { default_platform: data.defaultPlatform } : {}),
      } as never)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    const { loadCreatorIdentity } = await import("@/lib/ai/creator-identity.server");
    return loadCreatorIdentity(context.supabase, context.userId);
  });

export const generateContentPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ ...baseShape, scriptId: z.string().uuid().optional(), language })
      .refine(needsTarget, TARGET_MSG)
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runGenerateContentPackage } = await import("@/lib/ai/script.server");
    return runGenerateContentPackage(context.supabase, {
      storyId: data.storyId ?? null,
      packetId: data.packetId ?? null,
      scriptId: data.scriptId ?? null,
      language: data.language ?? null,
      model: data.model ?? null,
      styleProfileId: data.styleProfileId ?? null,
      userId: context.userId,
    });
  });

export const extractScriptClaims = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ scriptId: z.string().uuid(), model: z.string().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runExtractScriptClaims } = await import("@/lib/ai/audit.server");
    return runExtractScriptClaims(context.supabase, {
      scriptId: data.scriptId,
      model: data.model ?? null,
      userId: context.userId,
    });
  });

export const auditScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ scriptId: z.string().uuid(), model: z.string().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runAuditScript } = await import("@/lib/ai/audit.server");
    return runAuditScript(context.supabase, {
      scriptId: data.scriptId,
      model: data.model ?? null,
      userId: context.userId,
    });
  });

export const scriptResearchFreshness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ scriptId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { checkResearchFreshness } = await import("@/lib/ai/script.server");
    return checkResearchFreshness(context.supabase, data.scriptId);
  });

/** The Writing Style options offered in the Script Studio. */
export const listStyleProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("script_style_profiles")
      .select("id,slug,name,version,language_style,is_default,word_count_defaults")
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("version", { ascending: false });
    return (data ?? []).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      version: p.version,
      languageStyle: p.language_style,
      isDefault: p.is_default,
      wordBudgets: (p.word_count_defaults ?? {}) as Record<
        string,
        { label: string; low: number; high: number }
      >,
    }));
  });

/** Evidence-constrained auto repair of a failed fact check. */
export const repairScript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        scriptId: z.string().uuid(),
        auditId: z.string().uuid().optional(),
        model: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runScriptRepair } = await import("@/lib/ai/repair.server");
    return runScriptRepair(context.supabase, {
      scriptId: data.scriptId,
      auditId: data.auditId ?? null,
      model: data.model ?? null,
      userId: context.userId,
    });
  });

/** Audit → one repair → re-audit → readiness gate, in one call. */
export const runScriptReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        scriptId: z.string().uuid(),
        model: z.string().optional(),
        allowRepair: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { runAuditRepairCycle } = await import("@/lib/ai/repair.server");
    return runAuditRepairCycle(context.supabase, {
      scriptId: data.scriptId,
      model: data.model ?? null,
      userId: context.userId,
      allowRepair: data.allowRepair ?? true,
    });
  });

/**
 * Current readiness of a script: whether a human edit invalidated the audit,
 * plus the latest audit, repair and advisory style check.
 */
export const scriptReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ scriptId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const { contentHash } = await import("@/lib/content/hash");
    const { data: script } = await db
      .from("scripts")
      .select(
        "id,body,status,audit_status,ready_for_review,style_quality_status,body_hash,audited_body_hash,last_audit_id,last_repair_id,word_count",
      )
      .eq("id", data.scriptId)
      .maybeSingle();
    if (!script) throw new Error("Script not found");

    const currentHash = contentHash(script.body ?? "");
    const needsReaudit = !script.audited_body_hash || script.audited_body_hash !== currentHash;

    const [audit, repair, style] = await Promise.all([
      db
        .from("script_audits")
        .select("*")
        .eq("script_id", script.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("script_repairs")
        .select("*")
        .eq("script_id", script.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("script_style_checks")
        .select("*")
        .eq("script_id", script.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    return {
      scriptId: script.id,
      status: script.status,
      auditStatus: script.audit_status,
      readyForReview: Boolean(script.ready_for_review) && !needsReaudit,
      needsReaudit,
      styleStatus: script.style_quality_status,
      audit: audit.data,
      repair: repair.data,
      styleCheck: style.data,
    };
  });
