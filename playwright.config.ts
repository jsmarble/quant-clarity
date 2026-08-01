import { defineConfig } from "@playwright/test";

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  reporter: "list",
  retries: 0,
  testDir: "tests/web",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:8789",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "WRANGLER_SEND_METRICS=false npx wrangler dev --config apps/web/dist/server/wrangler.json --port 8789 --var DEPLOYMENT_ENV:preview --var RATE_LIMIT_HMAC_KEY:test-only-web-hmac-key-with-at-least-32-characters",
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 30_000,
    url: "http://127.0.0.1:8789/",
  },
});
