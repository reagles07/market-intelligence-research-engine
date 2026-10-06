import { expect, it } from "vitest";
import ts from "typescript";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? sourceFiles(`${directory}/${entry.name}`)
        : Promise.resolve(
            entry.name.endsWith(".functions.ts") ? [`${directory}/${entry.name}`] : [],
          ),
    ),
  );
  return groups.flat();
}

it("every server function factory includes the owner authorization middleware", async () => {
  const files = await sourceFiles(fileURLToPath(new URL("../lib/", import.meta.url)));
  let checked = 0;
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function inspect(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "createServerFn"
      ) {
        let chain: ts.Node = node;
        while (
          chain.parent &&
          ((ts.isPropertyAccessExpression(chain.parent) && chain.parent.expression === chain) ||
            (ts.isCallExpression(chain.parent) && chain.parent.expression === chain))
        )
          chain = chain.parent;
        expect(chain.getText(source), file).toMatch(/\.middleware\(\[requireSupabaseAuth\]\)/);
        checked++;
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
  }
  expect(checked).toBeGreaterThan(50);
});
