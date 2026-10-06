import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import matrix from "../../supabase/authorization-matrix.json";
import { migratedDatabase, migrationsDirectory } from "../../scripts/security/database";

let db: PGlite;
const owner = randomUUID();
const other = randomUUID();
let company: string;
let watchlist: string;

async function asUser<T>(
  role: "anon" | "authenticated" | "service_role",
  user: string | null,
  action: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${role}`);
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user ?? ""]);
    return action(tx);
  });
}

beforeAll(async () => {
  db = await migratedDatabase();
  await db.query(
    "INSERT INTO auth.users(id,email) VALUES ($1,'owner@example.invalid'),($2,'other@example.invalid')",
    [owner, other],
  );
  await db.query("SELECT private.provision_owner($1)", [owner]);
  const result = await asUser("authenticated", owner, (tx) =>
    tx.query<{ id: string }>(
      "INSERT INTO public.companies(ticker,name,exchange) VALUES ('SYNTH','Synthetic Research Company','US') RETURNING id",
    ),
  );
  company = result.rows[0]!.id;
  const lists = await asUser("authenticated", owner, (tx) =>
    tx.query<{ id: string }>(
      "INSERT INTO public.watchlists(name) VALUES ('Synthetic private watchlist') RETURNING id",
    ),
  );
  watchlist = lists.rows[0]!.id;
  await asUser("service_role", null, (tx) =>
    tx.query("INSERT INTO public.audit_logs(action,entity_id) VALUES ('synthetic-test',$1)", [
      company,
    ]),
  );
}, 30000);
afterAll(async () => {
  if (db) await db.close();
});

describe("all 64 table boundaries (actual PostgreSQL roles and RLS)", () => {
  for (const entry of matrix) {
    const table = entry.table; // Checked-in identifiers, never request input.
    it(`${table}: anonymous access denied`, async () => {
      await expect(
        asUser("anon", null, (tx) => tx.query(`SELECT * FROM public.${table}`)),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it(`${table}: second account cannot read, update or delete`, async () => {
      const rows = await asUser("authenticated", other, (tx) =>
        tx.query(`SELECT * FROM public.${table}`),
      );
      expect(rows.rows).toEqual([]);
      if (entry.browser_write) {
        const update = await asUser("authenticated", other, (tx) =>
          tx.query(`UPDATE public.${table} SET user_id=user_id RETURNING user_id`),
        );
        const deletion = await asUser("authenticated", other, (tx) =>
          tx.query(`DELETE FROM public.${table} RETURNING user_id`),
        );
        expect(update.rows).toEqual([]);
        expect(deletion.rows).toEqual([]);
      }
    });
    it(`${table}: catalog policies and grants match the matrix`, async () => {
      const policies = await db.query<{
        qual: string | null;
        with_check: string | null;
        cmd: string;
        roles: string[];
      }>(
        "SELECT qual,with_check,cmd,roles FROM pg_policies WHERE schemaname='public' AND tablename=$1",
        [table],
      );
      expect(policies.rows).toHaveLength(entry.browser_write ? 4 : 1);
      for (const policy of policies.rows) {
        expect(policy.roles).toEqual(["authenticated"]);
        const expressions = [policy.qual, policy.with_check].filter(
          (value): value is string => value !== null,
        );
        for (const expression of expressions) {
          expect(expression).toContain("is_installation_owner()");
          expect(expression).not.toMatch(/^\(?true\)?$/i);
          if (entry.category !== "shared read-only reference data")
            expect(expression).toContain("user_id = auth.uid()");
        }
      }
      const privilege = await db.query<{ rls: boolean; forced: boolean; can_write: boolean }>(
        "SELECT relrowsecurity AS rls,relforcerowsecurity AS forced,has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE') AS can_write FROM pg_class WHERE oid=$1::regclass",
        [`public.${table}`],
      );
      expect(privilege.rows[0]).toEqual({
        rls: true,
        forced: true,
        can_write: entry.browser_write,
      });
      const reads = await asUser("authenticated", owner, (tx) =>
        tx.query(`SELECT * FROM public.${table}`),
      );
      expect(reads.rows).toBeDefined();
    });
    if (!entry.browser_write) {
      it(`${table}: even the owner browser cannot insert, update or delete`, async () => {
        const columns = await db.query<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position LIMIT 1",
          [table],
        );
        const column = columns.rows[0]!.column_name;
        for (const statement of [
          `INSERT INTO public.${table} DEFAULT VALUES`,
          `UPDATE public.${table} SET ${column}=${column} WHERE false`,
          `DELETE FROM public.${table} WHERE false`,
        ]) {
          await expect(
            asUser("authenticated", owner, (tx) => tx.query(statement)),
          ).rejects.toMatchObject({ code: "42501" });
        }
      });
    }
  }
});

it("owner private data is visible to owner, never to another account", async () => {
  const own = await asUser("authenticated", owner, (tx) =>
    tx.query<{ user_id: string }>("SELECT user_id FROM public.watchlists WHERE id=$1", [watchlist]),
  );
  expect(own.rows).toEqual([{ user_id: owner }]);
  const hidden = await asUser("authenticated", other, (tx) =>
    tx.query("SELECT * FROM public.watchlists WHERE id=$1", [watchlist]),
  );
  expect(hidden.rows).toEqual([]);
});
it("second user cannot create business records or impersonate the owner", async () => {
  for (const userId of [owner, other]) {
    await expect(
      asUser("authenticated", other, (tx) =>
        tx.query(
          "INSERT INTO public.companies(ticker,name,exchange,user_id) VALUES ('ATTACK','Unauthorized','US',$1)",
          [userId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  }
});
it("owner can perform intended business CRUD", async () => {
  const insert = await asUser("authenticated", owner, (tx) =>
    tx.query<{ id: string }>(
      "INSERT INTO public.watchlists(name) VALUES ('CRUD synthetic fixture') RETURNING id",
    ),
  );
  const id = insert.rows[0]!.id;
  const updated = await asUser("authenticated", owner, (tx) =>
    tx.query<{ name: string }>(
      "UPDATE public.watchlists SET name='Updated synthetic fixture' WHERE id=$1 RETURNING name",
      [id],
    ),
  );
  expect(updated.rows).toEqual([{ name: "Updated synthetic fixture" }]);
  const deleted = await asUser("authenticated", owner, (tx) =>
    tx.query("DELETE FROM public.watchlists WHERE id=$1 RETURNING id", [id]),
  );
  expect(deleted.rows).toHaveLength(1);
});
it("owner cannot change record ownership", async () => {
  await expect(
    asUser("authenticated", owner, (tx) =>
      tx.query("UPDATE public.companies SET user_id=$1 WHERE id=$2", [other, company]),
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("service worker cannot write another user's private record", async () => {
  await expect(
    asUser("service_role", null, (tx) =>
      tx.query(
        "INSERT INTO public.companies(ticker,name,exchange,user_id) VALUES ('FOREIGN','Synthetic other user','US',$1)",
        [other],
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("service worker cannot clear or transfer ownership", async () => {
  for (const value of [null, other])
    await expect(
      asUser("service_role", null, (tx) =>
        tx.query("UPDATE public.companies SET user_id=$1 WHERE id=$2", [value, company]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
});
it("owner can reference own parent records", async () => {
  const result = await asUser("authenticated", owner, (tx) =>
    tx.query(
      "INSERT INTO public.watchlist_items(watchlist_id,company_id) VALUES ($1,$2) RETURNING user_id",
      [watchlist, company],
    ),
  );
  expect(result.rows).toEqual([{ user_id: owner }]);
});
it("browser and service role cannot self-provision or replace the installation owner", async () => {
  for (const role of ["authenticated", "service_role"] as const) {
    await expect(
      asUser(role, role === "authenticated" ? other : null, (tx) =>
        tx.query("SELECT private.provision_owner($1)", [other]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asUser(role, null, (tx) =>
        tx.query("UPDATE private.installation_owner SET user_id=$1", [other]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  }
  await expect(db.query("SELECT private.provision_owner($1)", [other])).rejects.toMatchObject({
    code: "23505",
  });
});
it("owner RPC rejects another identity and missing JWT subject", async () => {
  for (const identity of [other, null]) {
    const result = await asUser("authenticated", identity, (tx) =>
      tx.query<{ allowed: boolean }>("SELECT public.is_installation_owner() AS allowed"),
    );
    expect(result.rows).toEqual([{ allowed: false }]);
  }
});
it("system audit writes work only through the trusted service role", async () => {
  const rows = await asUser("authenticated", owner, (tx) =>
    tx.query<{ user_id: string }>(
      "SELECT user_id FROM public.audit_logs WHERE action='synthetic-test'",
    ),
  );
  expect(rows.rows).toEqual([{ user_id: owner }]);
});
it("provisioning makes all 62 ownership columns NOT NULL", async () => {
  const result = await db.query(
    "SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='user_id' AND is_nullable='NO'",
  );
  expect(result.rows).toHaveLength(62);
});
it("a populated installation cannot replay the authorization migration", async () => {
  const migration = await readFile(
    `${migrationsDirectory}/20261006000000_secure_single_owner.sql`,
    "utf8",
  );
  await expect(db.exec(migration)).rejects.toThrow("requires a fresh Auth project");
  await db.exec("ROLLBACK");
});

it("RLS also hides a deliberately injected foreign-owner row from the installation owner", async () => {
  // Defense-in-depth fixture: a superuser bypasses the one-owner FK/trigger inside a rollback.
  // Ordinary authenticated and service-role writes cannot create such a row (tested above).
  await db.exec(
    "BEGIN; ALTER TABLE public.companies DISABLE TRIGGER enforce_installation_owner; ALTER TABLE public.companies DROP CONSTRAINT installation_owner_fk;",
  );
  try {
    const fixture = await db.query<{ id: string }>(
      "INSERT INTO public.companies(ticker,name,exchange,user_id) VALUES ('FOREIGN_FIXTURE','Synthetic foreign owner','US',$1) RETURNING id",
      [other],
    );
    const id = fixture.rows[0]!.id;
    await db.exec("SET LOCAL ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner]);
    const read = await db.query("SELECT * FROM public.companies WHERE id=$1", [id]);
    const update = await db.query(
      "UPDATE public.companies SET name='Unauthorized update' WHERE id=$1 RETURNING id",
      [id],
    );
    const deletion = await db.query("DELETE FROM public.companies WHERE id=$1 RETURNING id", [id]);
    expect(read.rows).toEqual([]);
    expect(update.rows).toEqual([]);
    expect(deletion.rows).toEqual([]);
  } finally {
    await db.exec("ROLLBACK");
  }
});
it("ownership cannot be forged through created_by attribution", async () => {
  await expect(
    asUser("authenticated", owner, (tx) =>
      tx.query("UPDATE public.companies SET created_by=$1 WHERE id=$2", [other, company]),
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
