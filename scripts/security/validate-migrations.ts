import { readdir } from "node:fs/promises";
import { migratedDatabase, migrationsDirectory } from "./database.ts";

const db = await migratedDatabase();
try {
  const tables = await db.query<{ tables: number }>(
    "SELECT count(*)::int AS tables FROM pg_tables WHERE schemaname='public'",
  );
  const unsafe = await db.query(
    "SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' AND (qual IN ('true','(true)') OR with_check IN ('true','(true)'))",
  );
  const unprotected = await db.query(
    "SELECT relname FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='public' AND relkind='r' AND (NOT relrowsecurity OR NOT relforcerowsecurity)",
  );
  if (tables.rows[0]?.tables !== 64 || unsafe.rows.length || unprotected.rows.length)
    throw new Error("Migration authorization validation failed");
  const migrations = (await readdir(migrationsDirectory)).filter((file) =>
    file.endsWith(".sql"),
  ).length;
  console.log(
    JSON.stringify({
      migrations,
      tables: 64,
      unsafePolicies: 0,
      unprotectedTables: 0,
      ownerProvisioned: false,
      result: "PASS",
    }),
  );
} finally {
  await db.close();
}
