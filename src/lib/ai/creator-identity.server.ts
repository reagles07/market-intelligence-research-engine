/**
 * Creator/channel identity used by the self-intro line in every script.
 *
 * The rule this file exists to enforce: a name is spoken ONLY when the creator
 * has configured one. Nothing here ever invents a host name, a channel name or
 * a credential.
 */
import { DEFAULT_PLATFORM, PLATFORMS, type Platform } from "@/lib/content/domain";
import type { Db } from "@/lib/ai/script-context.server";

export type CreatorIdentity = {
  channelName: string | null;
  hostName: string | null;
  defaultPlatform: Platform;
};

export const EMPTY_CREATOR_IDENTITY: CreatorIdentity = {
  channelName: null,
  hostName: null,
  defaultPlatform: DEFAULT_PLATFORM,
};

const clean = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
};

export async function loadCreatorIdentity(db: Db, userId: string): Promise<CreatorIdentity> {
  const { data } = await db
    .from("profiles")
    .select("channel_name,host_name,default_platform,display_name")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return EMPTY_CREATOR_IDENTITY;
  const row = data as unknown as Record<string, unknown>;
  const platform = clean(row["default_platform"]);
  return {
    channelName: clean(row["channel_name"]),
    hostName: clean(row["host_name"]),
    defaultPlatform: (PLATFORMS as readonly string[]).includes(platform ?? "")
      ? (platform as Platform)
      : DEFAULT_PLATFORM,
  };
}

/**
 * LEVEL 4 block: how the host introduces themselves, right after the hook.
 * `surface` decides the length — a long-form intro is ~8–15 seconds, a Short's
 * intro is a single clause.
 */
export function selfIntroBlock(
  identity: CreatorIdentity,
  surface: "long" | "short" = "long",
): string {
  const length =
    surface === "long"
      ? `LENGTH: roughly 8–15 seconds of speech (about 20–40 words). Say who you are and what
this channel does with a stock — business, history, numbers, opportunity and risk in simple
Tanglish — then move straight into the retention promise.
EXAMPLE STYLE ONLY (never copy this wording verbatim, vary it every time):
"Vanakkam, naan [NAME]. [CHANNEL]-la stocks-a just price-aa paakama, company-oda business,
history, numbers, opportunity, risks ellathayum simple Tanglish-la analyse panrom."`
      : `LENGTH: one short clause, about 3–5 seconds. Never more.
EXAMPLE STYLE ONLY (never copy this wording verbatim, vary it every time):
"Naan [NAME] - [CHANNEL]. Stocks-kku pinnadi irukkura real business story-a simple-aa paakalam."`;

  const placement = `SELF INTRO (mandatory). PLACEMENT: after the hook has landed — NEVER the first thing
spoken. The video always opens with the story, never with a greeting or an introduction.`;

  const named: string[] = [];
  if (identity.hostName) named.push(`[NAME] = ${identity.hostName}`);
  if (identity.channelName) named.push(`[CHANNEL] = ${identity.channelName}`);

  if (!named.length) {
    return `${placement}
No creator name or channel name is configured, so speak a name-free intro: drop the [NAME]
and [CHANNEL] slots entirely and introduce the work, not the person, e.g. "Indha channel-la
stocks-a business, numbers, opportunity, risk-nu simple Tanglish-la paakalam." You must NOT
invent, guess or imply a host name, a channel name, a firm, a credential or a track record.
${length}`;
  }

  return `${placement}
Use ONLY this configured identity — ${named.join(", ")}. Substitute those values into the
intro naturally. Do not add any other name, credential, qualification, experience claim,
subscriber count or track record.
${length}`;
}

/** LEVEL 4 block: platform-aware CTA vocabulary. */
export function ctaBlock(platform: Platform, surface: "long" | "short" = "long"): string {
  const primary = platform === "Instagram" ? "follow the account" : "subscribe to the channel";
  const secondary =
    platform === "Instagram"
      ? "save or share the post"
      : surface === "long"
        ? "share the video"
        : null;
  return `CTA (platform: ${platform}, format: ${surface === "long" ? "long-form" : "Short"}):
- Exactly ONE primary CTA: ask the viewer to ${primary}.
${
  secondary
    ? `- At most ONE secondary CTA: ${secondary}. It is optional — leave it out when the ending
  already feels complete.`
    : `- No secondary CTA on a YouTube Short: the single subscribe ask is the whole CTA.`
}
- Never use the other platform's vocabulary (no "subscribe" on Instagram, no "follow" on
  YouTube), and never stack like + comment + share + subscribe + save commands.
- Vary the wording naturally every time; never reuse a canned CTA sentence.
- The CTA is never a buy/sell instruction and never promises returns.`;
}
