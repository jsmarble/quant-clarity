import path from "node:path";

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          RATE_LIMIT_HMAC_KEY: "test-only-hmac-key-with-at-least-32-characters",
        },
        workers: [
          {
            name: "quant-clarity-query-local",
            compatibilityDate: "2026-08-01",
            scriptPath: path.join(
              import.meta.dirname,
              "apps/query/dist-worker/test-query-worker/index.js",
            ),
            modules: true,
            bindings: { DEPLOYMENT_ENVIRONMENT: "local" },
            d1Databases: ["SERVING_DB"],
          },
        ],
      },
      wrangler: { configPath: "./apps/api/wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["apps/api/src/**/*.worker.test.ts"],
  },
});
