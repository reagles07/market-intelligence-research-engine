import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const omitted = new Set(["node_modules", ".git", ".output", "dist", ".vinxi"]);
const syntheticKeys = new Set([
  "sb_secret_synthetic_build_canary",
  "sb_secret_synthetic_example",
  "sb_publishable_synthetic_example",
]);
const findings: { file: string; category: string }[] = [];
async function files(directory: string, skip: Set<string>): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries
      .filter((entry) => !skip.has(entry.name))
      .map((entry) =>
        entry.isDirectory()
          ? files(`${directory}/${entry.name}`, skip)
          : Promise.resolve([`${directory}/${entry.name}`]),
      ),
  );
  return groups.flat();
}
const source = await files(root, omitted);
const platformTerms = [
  ["lov", "able"],
  ["base", "44"],
].map((pieces) => pieces.join(""));
const employerTerms = [
  ["WD", "NA"],
  ["Rog", "ers"],
  ["Fi", "do"],
  ["Cha", "tr"],
].map((pieces) => pieces.join(""));
const credentials =
  /(?:\bsb_secret_[A-Za-z0-9_-]{10,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g;
const databaseURLs = /https:\/\/[a-z0-9-]{10,}\.supabase\.(?:co|in)/gi;
let reviewed = 0;
for (const file of source) {
  if (/\.(png|jpg|ico|woff2?|zip)$/i.test(file)) continue;
  const text = await readFile(file, "utf8");
  reviewed++;
  if (file.split("/").at(-1)?.startsWith(".env") && !file.endsWith(".env.example"))
    findings.push({ file, category: "private environment file" });
  for (const match of text.matchAll(credentials))
    if (!syntheticKeys.has(match[0])) findings.push({ file, category: "credential candidate" });
  for (const match of text.matchAll(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi)) {
    if (!/^00000000-0000-0000-0000-00000000000[01]$/i.test(match[0]))
      findings.push({ file, category: "non-synthetic UUID candidate" });
  }
  for (const match of text.matchAll(databaseURLs))
    if (!match[0].includes("your-project-ref"))
      findings.push({ file, category: "production database identifier candidate" });
  if (new RegExp(`\\b(?:${platformTerms.join("|")})\\b`, "i").test(text))
    findings.push({ file, category: "removed platform reference" });
  if (new RegExp(`\\b(?:${employerTerms.join("|")})\\b`, "i").test(text))
    findings.push({ file, category: "employer/customer brand candidate" });
}
let assets = 0;
if (process.argv.includes("--built")) {
  const publicFiles = await files(resolve(root, ".output/public"), new Set());
  for (const file of publicFiles) {
    if (!/\.(js|mjs|json|html|map|css|txt)$/i.test(file)) continue;
    const text = await readFile(file, "utf8");
    assets++;
    if (
      text.includes("sb_secret_synthetic_build_canary") ||
      text.includes("SUPABASE_SERVICE_ROLE_KEY") ||
      text.includes("node:async_hooks")
    )
      findings.push({ file, category: "server credential/module reached browser output" });
    for (const match of text.matchAll(credentials))
      if (!syntheticKeys.has(match[0]))
        findings.push({ file, category: "built credential candidate" });
  }
}
if (findings.length) {
  console.error(JSON.stringify({ reviewed, assets, findings }, null, 2));
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      reviewed,
      assets,
      credentialCandidates: 0,
      productionDatabaseIdentifiers: 0,
      nonSyntheticUUIDs: 0,
      platformReferences: 0,
      employerCustomerBrandCandidates: 0,
      result: "PASS",
    }),
  );
}
