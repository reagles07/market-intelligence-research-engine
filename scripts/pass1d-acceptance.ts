import { runOwnerAcceptance } from "./security/owner-cli";
import type { Database } from "../src/integrations/supabase/types";
/**
 * Pass 1D acceptance harness (not application code).
 *
 * Generates a Short from an existing research packet, then runs the final
 * fact check over it and prints the audit ledger.
 */
import { createClient } from "@supabase/supabase-js";

import { runGenerateShortScript } from "../src/lib/ai/script.server";
import { runAuditScript } from "../src/lib/ai/audit.server";

const admin = createClient<Database>(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);
const db = admin;
const log = (...a: unknown[]) => console.log(...a);

async function main() {
  const { data: profile } = await admin.from("profiles").select("id").limit(1).single();
  const userId = profile!.id as string;

  const { data: packet } = await admin
    .from("research_packets")
    .select("id,story_id,version_number,companies(ticker)")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!packet) throw new Error("no research packet to write from");
  log("packet", packet.id, "v" + packet.version_number);

  const gen = (await runGenerateShortScript(db, {
    storyId: null,
    packetId: packet.id,
    duration: "short_60",
    angle: "Why the stock moved",
    language: "Tanglish",
    tone: null,
    model: null,
    regenerateFromScriptId: null,
    userId,
  })) as Record<string, unknown>;
  log("generate:", JSON.stringify(gen).slice(0, 900));
  if (!gen["ok"]) return;

  const audit = (await runAuditScript(db, {
    scriptId: String(gen["scriptId"]),
    model: null,
    userId,
  })) as Record<string, unknown>;
  log("audit:", JSON.stringify(audit).slice(0, 2500));
}

runOwnerAcceptance(main).catch((e) => {
  console.error(e);
  process.exit(1);
});
