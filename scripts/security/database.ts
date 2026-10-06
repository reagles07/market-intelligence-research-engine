import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const migrationsDirectory = fileURLToPath(
  new URL("../../supabase/migrations/", import.meta.url),
);

/** Minimal local Supabase Auth contract. Policies run in real PostgreSQL, not a JS simulation. */
export async function migratedDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
  `);
  try {
    const files = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files) {
      try {
        await db.exec(await readFile(`${migrationsDirectory}/${file}`, "utf8"));
      } catch (error) {
        throw new Error(`Migration failed: ${file}`, { cause: error });
      }
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
