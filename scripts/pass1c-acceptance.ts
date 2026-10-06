import { runOwnerAcceptance } from "./security/owner-cli";
import type { Database } from "../src/integrations/supabase/types";
/**
 * Pass 1C acceptance harness (not application code).
 *
 * Runs the web research + reconciliation flow against the stories Pass 1B
 * created (GOOGL, Tata Steel), then re-runs it to prove URL de-duplication.
 */
import { createClient } from "@supabase/supabase-js";

import { runResearchLatestNews } from "../src/lib/ai/web.server";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const log = (...a: unknown[]) => console.log(...a);

async function storyFor(ticker: string) {
  const { data: company } = await admin
    .from("companies")
    .select("id")
    .eq("ticker", ticker)
    .maybeSingle();
  if (!company) throw new Error(`no company ${ticker}`);
  const { data: story } = await admin
    .from("stories")
    .select("id,title")
    .eq("company_id", company.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!story) throw new Error(`no story for ${ticker}`);
  return story;
}

async function uid() {
  const { data } = await admin.from("profiles").select("id").limit(1).single();
  return data!.id as string;
}

async function suite(label: string, ticker: string, user: string, rebuild: boolean) {
  const story = await storyFor(ticker);
  log(`\n=== ${label} · ${story.title} ===`);

  const first = await runResearchLatestNews(db, {
    storyId: story.id,
    userId: user,
    rebuildPacket: rebuild,
  });
  log("run 1:", JSON.stringify(first).slice(0, 1600));
  if (!first.ok) return;

  const second = await runResearchLatestNews(db, { storyId: story.id, userId: user });
  log(
    "run 2 (dedup check):",
    JSON.stringify({
      sourcesFound: second.ok ? second.sourcesFound : null,
      sourcesNew: second.ok ? second.sourcesNew : null,
      sourcesDuplicate: second.ok ? second.sourcesDuplicate : null,
      claimsAdded: second.ok ? second.claimsAdded : null,
      error: second.ok ? null : second.error,
    }),
  );

  const { count } = await admin
    .from("sources")
    .select("id", { count: "exact", head: true })
    .eq("story_id", story.id)
    .eq("discovered_via", "web-research");
  log("web sources stored for story:", count);
}

async function main() {
  const user = await uid();
  const only = process.argv[2] ?? "all";
  if (only === "all" || only === "us") await suite("US · GOOGL", "GOOGL", user, true);
  if (only === "all" || only === "india")
    await suite("India · TATASTEEL", "TATASTEEL", user, false);
}

runOwnerAcceptance(main).catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
