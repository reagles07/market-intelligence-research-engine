import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import { migratedDatabase } from "../../scripts/security/database";

let db: PGlite;
const owner = randomUUID();
beforeAll(async () => {
  db = await migratedDatabase();
}, 30000);
afterAll(async () => {
  if (db) await db.close();
});

it("fresh installation is closed before explicit owner provisioning", async () => {
  await db.query("INSERT INTO auth.users(id,email) VALUES ($1,'lifecycle@example.invalid')", [
    owner,
  ]);
  await db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner]);
    expect(
      (await tx.query<{ allowed: boolean }>("SELECT public.is_installation_owner() AS allowed"))
        .rows,
    ).toEqual([{ allowed: false }]);
    expect((await tx.query("SELECT * FROM public.universe_members")).rows).toEqual([]);
    expect((await tx.query("SELECT * FROM public.script_style_profiles")).rows).toEqual([]);
  });
  await expect(
    db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE service_role");
      return tx.query(
        "INSERT INTO public.companies(ticker,name,exchange) VALUES ('UNPROVISIONED','Synthetic','US')",
      );
    }),
  ).rejects.toMatchObject({ code: "42501" });
});
it("synthetic seed refuses an unprovisioned installation", async () => {
  const seed = await readFile(new URL("../../supabase/seed.sql", import.meta.url), "utf8");
  await expect(db.exec(seed)).rejects.toThrow("Provision a development installation owner");
  await db.exec("ROLLBACK");
});
it("explicit provisioning assigns only migration seed/configuration data to the owner", async () => {
  await db.query("SELECT private.provision_owner($1)", [owner]);
  const records = await db.query<{ user_id: string }>(
    "SELECT DISTINCT user_id FROM public.universe_members",
  );
  expect(records.rows).toEqual([{ user_id: owner }]);
  const profile = await db.query<{ id: string; user_id: string }>(
    "SELECT id,user_id FROM public.profiles",
  );
  expect(profile.rows).toEqual([{ id: owner, user_id: owner }]);
});
it("synthetic seed is repeatable and preserves owner attribution", async () => {
  const seed = await readFile(new URL("../../supabase/seed.sql", import.meta.url), "utf8");
  await db.exec(seed);
  await db.exec(seed);
  const companies = await db.query<{ user_id: string; created_by: string }>(
    "SELECT user_id,created_by FROM public.companies WHERE ticker='SYNTH-DEMO'",
  );
  expect(companies.rows).toEqual([{ user_id: owner, created_by: owner }]);
  const lists = await db.query(
    "SELECT * FROM public.watchlists WHERE name='Synthetic demo watchlist'",
  );
  expect(lists.rows).toHaveLength(1);
  const items = await db.query("SELECT * FROM public.watchlist_items");
  expect(items.rows).toHaveLength(1);
});
