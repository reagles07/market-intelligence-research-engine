import "@tanstack/react-start/server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const ownerScope = new AsyncLocalStorage<string>();

/** Only a validated user token and an affirmative database policy check open this scope. */
export async function withInstallationOwner<T>(
  authenticatedDb: SupabaseClient<Database>,
  userId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const { data, error } = await authenticatedDb.rpc("is_installation_owner");
  if (error || data !== true) throw new Error("Forbidden: installation owner required");
  return ownerScope.run(userId, operation);
}

export function requireOwnerScope(): string {
  const userId = ownerScope.getStore();
  if (!userId) throw new Error("Privileged database access requires a verified owner request");
  return userId;
}
