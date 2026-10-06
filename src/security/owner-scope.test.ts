import { describe, expect, it, vi } from "vitest";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  withInstallationOwner,
  requireOwnerScope,
} from "@/integrations/supabase/owner-scope.server";
import { assertPublishableKey, assertPublicEnvironment } from "@/integrations/supabase/public-key";

function client(data: boolean | null, error: unknown = null): SupabaseClient<Database> {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) } as unknown as SupabaseClient<Database>;
}

describe("privileged owner request scope", () => {
  it("blocks service access outside a verified request", () => {
    expect(requireOwnerScope).toThrow("requires a verified owner request");
    expect(() => supabaseAdmin.from("companies")).toThrow("requires a verified owner request");
  });
  it("denies non-owner and failed policy lookup without executing a worker", async () => {
    for (const db of [client(false), client(null), client(null, new Error("offline"))]) {
      const worker = vi.fn(async () => "unexpected");
      await expect(withInstallationOwner(db, "synthetic-user", worker)).rejects.toThrow(
        "installation owner required",
      );
      expect(worker).not.toHaveBeenCalled();
    }
  });
  it("checks the database owner RPC and scopes the worker", async () => {
    const db = client(true);
    await withInstallationOwner(db, "synthetic-owner", async () => {
      await Promise.resolve();
      expect(requireOwnerScope()).toBe("synthetic-owner");
    });
    expect(db.rpc).toHaveBeenCalledWith("is_installation_owner");
    expect(requireOwnerScope).toThrow();
  });
  it("isolates concurrent authorized requests and clears scope after errors", async () => {
    await Promise.all(
      ["first-owner", "second-owner"].map((user) =>
        withInstallationOwner(client(true), user, async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 1));
          expect(requireOwnerScope()).toBe(user);
        }),
      ),
    );
    await expect(
      withInstallationOwner(client(true), "synthetic-owner", async () => {
        throw new Error("worker failed");
      }),
    ).rejects.toThrow("worker failed");
    expect(requireOwnerScope).toThrow();
  });
});

describe("public credentials", () => {
  const key = (role: string) => `header.${btoa(JSON.stringify({ role }))}.signature`;
  it("accepts only publishable and legacy anon credentials", () => {
    expect(() => assertPublishableKey("sb_publishable_synthetic_example")).not.toThrow();
    expect(() => assertPublishableKey(key("anon"))).not.toThrow();
  });
  it("rejects service-role, opaque secret, authenticated and malformed keys", () => {
    for (const value of [
      key("service_role"),
      key("authenticated"),
      "sb_secret_synthetic_example",
      "not-a-key",
      "a.b.c",
    ])
      expect(() => assertPublishableKey(value)).toThrow();
  });
});

it("build configuration refuses private values before they can enter public assets", () => {
  for (const env of [
    { VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_synthetic_example" },
    { VITE_SUPABASE_SERVICE_ROLE_KEY: "synthetic-private-value" },
    { VITE_PROVIDER_SECRET: "synthetic-private-value" },
    { VITE_OWNER_ACCESS_TOKEN: "synthetic-private-value" },
  ])
    expect(() => assertPublicEnvironment(env)).toThrow();
  expect(() =>
    assertPublicEnvironment({
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic_example",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_example",
    }),
  ).not.toThrow();
});
