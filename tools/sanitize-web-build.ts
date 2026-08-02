import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolsRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(toolsRoot, "..");
const buildRoot = resolve(repositoryRoot, "apps/web/dist/server");
const uploadRoot = resolve(repositoryRoot, "apps/web/dist-worker");
const replacementRoot = "/workspace/quant-clarity";
const textExtensions = new Set([".js", ".json", ".mjs"]);
const consoleSink =
  /\bconsole\s*\.\s*(?:assert|clear|count|countReset|debug|dir|dirxml|error|group|groupCollapsed|groupEnd|info|log|table|time|timeEnd|timeLog|trace|warn)\b/gu;
const cookieHeaderLiteral = /set-cookie/giu;

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? files(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat();
}

let changed = 0;
for (const path of await files(buildRoot)) {
  if (!textExtensions.has(extname(path))) continue;
  const original = await readFile(path, "utf8");
  const sanitized = original
    .replaceAll(repositoryRoot, replacementRoot)
    .replace(consoleSink, "(() => {})")
    .replace(cookieHeaderLiteral, "x-quantclarity-blocked-cookie");
  if (sanitized === original) continue;
  await writeFile(path, sanitized);
  changed += 1;
}

if (changed === 0)
  throw new Error(
    `${relative(process.cwd(), buildRoot)} contained no paths or console sinks to sanitize`,
  );

await rm(uploadRoot, { force: true, recursive: true });
