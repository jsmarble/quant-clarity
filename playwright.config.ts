import { defineConfig } from "@playwright/test";

const supportedPublicationStates = new Set([
  "published",
  "published_zero",
  "not_published",
  "unavailable",
]);
const publicationState =
  process.env.QUANTCLARITY_MOCK_PUBLICATION_STATE ?? "published";
if (!supportedPublicationStates.has(publicationState))
  throw new Error("Unsupported synthetic publication state.");
const rateLimitTestNamespace =
  process.env.QUANTCLARITY_EXPECTED_SITE_ORIGIN === undefined
    ? publicationState
    : "production";
const runtimeEnvironment =
  process.env.QUANTCLARITY_MODEL_DETAIL_LOCAL === "1" ? "local" : "preview";

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
  webServer: [
    {
      command: `WRANGLER_SEND_METRICS=false npx wrangler dev tests/workers/mock-catalog-query.mjs --name quant-clarity-query-local --compatibility-date 2026-08-01 --port 8791 --var MOCK_PUBLICATION_STATE:${publicationState}`,
      reuseExistingServer: false,
      stderr: "pipe",
      stdout: "pipe",
      timeout: 30_000,
      url: "http://127.0.0.1:8791/",
    },
    {
      command: `WRANGLER_SEND_METRICS=false npx wrangler dev --config apps/api/wrangler.jsonc --port 8790 --var DEPLOYMENT_ENV:${runtimeEnvironment} --var FRONTEND_API_HMAC_CURRENT:frontend-browser-test-secret-with-at-least-32-characters --var RATE_LIMIT_HMAC_KEY:api-browser-test-secret-with-at-least-32-characters-${rateLimitTestNamespace}`,
      reuseExistingServer: false,
      stderr: "pipe",
      stdout: "pipe",
      timeout: 30_000,
      port: 8790,
    },
    {
      command: `WRANGLER_SEND_METRICS=false npx wrangler dev --config apps/web/dist/server/wrangler.json --port 8789 --var DEPLOYMENT_ENV:${runtimeEnvironment} --var FRONTEND_API_HMAC_CURRENT:frontend-browser-test-secret-with-at-least-32-characters --var RATE_LIMIT_HMAC_KEY:test-only-web-hmac-key-with-at-least-32-characters-${rateLimitTestNamespace}`,
      reuseExistingServer: false,
      stderr: "pipe",
      stdout: "pipe",
      timeout: 30_000,
      port: 8789,
    },
  ],
});
