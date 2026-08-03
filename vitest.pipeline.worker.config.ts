import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const splitCanonicalMigrationStatements = (sql: string): string[] => {
  const statements: string[] = [];
  let current = "";
  let trigger = false;
  let inSingleQuotedLiteral = false;
  for (const line of sql.split("\n")) {
    current += `${line}\n`;
    let structuralLine = "";
    for (let index = 0; index < line.length; index += 1) {
      const character = line.charAt(index);
      if (
        !inSingleQuotedLiteral &&
        character === "-" &&
        line[index + 1] === "-"
      )
        break;
      if (character === "'") {
        if (inSingleQuotedLiteral && line[index + 1] === "'") index += 1;
        else inSingleQuotedLiteral = !inSingleQuotedLiteral;
        structuralLine += " ";
      } else {
        structuralLine += inSingleQuotedLiteral ? " " : character;
      }
    }
    const startsTrigger = /^CREATE TRIGGER\b/u.test(structuralLine);
    if (startsTrigger) trigger = true;
    const completesOneLineTrigger =
      trigger && /\bBEGIN\b.*\bEND;\s*$/u.test(structuralLine);
    if (
      !inSingleQuotedLiteral &&
      ((trigger &&
        (completesOneLineTrigger || /^END;\s*$/u.test(structuralLine))) ||
        (!trigger && /;\s*$/u.test(structuralLine)))
    ) {
      statements.push(current);
      current = "";
      trigger = false;
    }
  }
  if (current.trim() !== "")
    throw new Error("canonical migration contains an incomplete statement");
  return statements;
};

const readCanonicalD1Migrations = async (directory: string) => {
  const migrations = await readD1Migrations(directory);
  return Promise.all(
    migrations.map(async (migration) => {
      // Wrangler 4.118's unstable splitter leaves the rest of canonical 0003
      // in one query after CASE expressions ending in `END,`. Detect that
      // multi-trigger output and structurally split the source for workerd.
      if (
        !migration.queries.some(
          (query) => (query.match(/\bCREATE TRIGGER\b/gu)?.length ?? 0) > 1,
        )
      )
        return migration;
      return {
        name: migration.name,
        queries: splitCanonicalMigrationStatements(
          await readFile(path.join(directory, migration.name), "utf8"),
        ),
      };
    }),
  );
};

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        bindings: {
          CANONICAL_MIGRATIONS: await readCanonicalD1Migrations(
            path.join(import.meta.dirname, "migrations/canonical"),
          ),
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "migrations/serving"),
          ),
        },
        d1Databases: ["CANONICAL_DB", "SERVING_DB"],
        r2Buckets: ["MODEL_SLUG_ARCHIVE_BUCKET"],
      },
      wrangler: { configPath: "./apps/pipeline/wrangler.jsonc" },
    })),
  ],
  test: {
    include: ["apps/pipeline/src/**/*.worker.test.ts"],
  },
});
