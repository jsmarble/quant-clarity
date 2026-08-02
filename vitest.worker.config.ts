import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          RATE_LIMIT_HMAC_KEY: "test-only-hmac-key-with-at-least-32-characters",
        },
      },
      wrangler: { configPath: "./apps/api/wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["apps/api/src/**/*.worker.test.ts"],
  },
});
