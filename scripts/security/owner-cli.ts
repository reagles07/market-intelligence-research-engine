import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/integrations/supabase/types";
import { assertPublishableKey } from "../../src/integrations/supabase/public-key";
import { withInstallationOwner } from "../../src/integrations/supabase/owner-scope.server";

/** Live acceptance jobs must authenticate as the provisioned development owner too. */
export async function runOwnerAcceptance(operation: () => Promise<void>): Promise<void> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const token = process.env["OWNER_ACCESS_TOKEN"];
  if (!url || !key || !token)
    throw new Error("Development owner URL, public key and OWNER_ACCESS_TOKEN are required");
  assertPublishableKey(key);
  const db = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getClaims(token);
  if (error || !data?.claims.sub) throw new Error("Invalid development owner token");
  await withInstallationOwner(db, data.claims.sub, operation);
}
