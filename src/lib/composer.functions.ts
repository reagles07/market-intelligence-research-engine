/**
 * Content Composer server functions — thin RPC wrappers.
 *
 * They never research, never publish and never relax a gate: eligibility is
 * decided from canonical research readiness on the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LANGUAGES } from "@/lib/domain";
import { PLATFORMS, SCRIPT_TONES, TARGET_DURATIONS } from "@/lib/content/domain";
import {
  COMPOSER_MAX_COMPANIES,
  COMPOSER_MAX_TOTAL_SHORTS,
  COMPOSER_MODES,
  LONGFORM_MODES,
} from "@/lib/content/composer";

const modeKeys = COMPOSER_MODES.map((m) => m.key) as [string, ...string[]];
const longformKeys = LONGFORM_MODES.map((m) => m.key) as [string, ...string[]];
const durationKeys = TARGET_DURATIONS.map((d) => d.key) as [string, ...string[]];

const configShape = {
  companyIds: z.array(z.string().uuid()).min(1).max(COMPOSER_MAX_COMPANIES),
  mode: z.enum(modeKeys),
  longEnabled: z.boolean().default(true),
  longformMode: z.enum(longformKeys).default("roundup"),
  shortsEnabled: z.boolean().default(true),
  allocation: z.record(z.string().uuid(), z.number().int().min(0).max(6)).default({}),
  autoAllocate: z.boolean().default(false),
  autoAllocateTotal: z.number().int().min(0).max(COMPOSER_MAX_TOTAL_SHORTS).default(0),
  combinedShorts: z.number().int().min(0).max(3).default(0),
  combinedShortCompanyIds: z.array(z.string().uuid()).default([]),
  allowRanking: z.boolean().default(false),
  theme: z.string().max(300).nullable().default(null),
  title: z.string().max(300).nullable().default(null),
  creatorInstruction: z.string().max(2000).nullable().default(null),
  targetDuration: z.enum(durationKeys).nullable().default(null),
  customMinutes: z.number().int().min(3).max(40).nullable().default(null),
  platform: z.enum(PLATFORMS).nullable().default(null),
  language: z.enum(LANGUAGES).nullable().default(null),
  tone: z.enum(SCRIPT_TONES).nullable().default(null),
  model: z.string().nullable().default(null),
  styleProfileId: z.string().uuid().nullable().default(null),
  continueWithReadyOnly: z.boolean().default(false),
};

const configSchema = z.object(configShape);

/** Every researched company with its latest packet and readiness verdict. */
export const listComposerStocks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listComposerCandidates } = await import("@/lib/content/composer.server");
    return listComposerCandidates(context.supabase as never);
  });

/** What WOULD be generated — readiness split plus the script count. No cost. */
export const previewComposerPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => configSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { previewComposition } = await import("@/lib/content/composer.server");
    const res = await previewComposition(
      context.supabase as never,
      {
        ...data,
        userId: context.userId,
      } as never,
    );
    return { ready: res.ready, blocked: res.blocked, allocation: res.allocation, plan: res.plan };
  });

/** The single creator action that generates the composition's scripts. */
export const runComposerGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => configSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { runComposition } = await import("@/lib/content/composer.server");
    return runComposition(
      context.supabase as never,
      {
        ...data,
        userId: context.userId,
      } as never,
    );
  });

export const listComposerHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ limit: z.number().int().min(1).max(50).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { listCompositions } = await import("@/lib/content/composer.server");
    return listCompositions(context.supabase as never, data.limit ?? 20);
  });
