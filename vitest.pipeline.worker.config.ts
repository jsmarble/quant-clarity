import path from "node:path";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "migrations/serving"),
          ),
        },
        d1Databases: ["SERVING_DB"],
      },
      wrangler: { configPath: "./apps/pipeline/wrangler.jsonc" },
    })),
  ],
  test: {
    include: ["apps/pipeline/src/**/*.worker.test.ts"],
  },
});
