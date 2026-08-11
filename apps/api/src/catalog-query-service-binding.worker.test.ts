import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  FRONTEND_API_INTERNAL_ORIGIN,
  signFrontendApiRequest,
  type CatalogQueryRpcV6,
} from "@quant-clarity/api-core";

import {
  captureModelDetailRuntimeCapabilities,
  handleModelDetailRuntime,
} from "./model-detail-runtime.js";

const catalogQuery = env.CATALOG_QUERY as unknown as CatalogQueryRpcV6;
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const MODEL = "mdl_44444444-4444-4444-8444-444444444444";
const FAMILY = "fam_33333333-3333-4333-8333-333333333333";
const PROVIDER = "prv_22222222-2222-4222-8222-222222222222";

describe("local named catalog query service binding (API-003, API-010, CF-002, CF-005, CF-006)", () => {
  it("assembles the closed Model-detail runtime from actual local bindings", () => {
    const context = createExecutionContext();
    const capabilities = captureModelDetailRuntimeCapabilities(
      env as CloudflareEnv & { RATE_LIMIT_HMAC_KEY: string },
      {
        cache: caches.default,
        context,
        nowMs: Date.now,
        subtle: crypto.subtle,
      },
    );

    expect(capabilities.environment).toBe("local");
    expect(capabilities.protectedCacheOrigin).toBe("https://api.example.test");
    expect(capabilities.transportPolicy).toBe("local_test");
    expect(capabilities.cache).toBe(caches.default);
    expect(capabilities.context).toBe(context);
    expect(capabilities.queryService).toBe(env.CATALOG_QUERY);
    expect(capabilities.readLimiter).toBe(env.READ_LIMITER);
    expect(capabilities.rotationLimiter).toBe(env.ROTATION_LIMITER);
    expect(capabilities.rateLimitSecret).toBe(
      "test-only-hmac-key-with-at-least-32-characters",
    );
  });

  it("executes the unrouted composition through actual local Worker capabilities", async () => {
    const context = createExecutionContext();
    const response = await handleModelDetailRuntime(
      new Request(`https://visitor-controlled.example/v1/models/${MODEL}`, {
        headers: {
          "CF-Connecting-IP": "2001:db8:abcd:12::99",
          Host: "attacker.example",
          "X-Forwarded-Host": "attacker.example",
        },
      }),
      env as CloudflareEnv & { RATE_LIMIT_HMAC_KEY: string },
      context,
    );
    await waitOnExecutionContext(context);

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.has("Strict-Transport-Security")).toBe(false);
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(await response.text()).not.toContain("attacker.example");
  });

  it("calls the actual named WorkerEntrypoint over JSRPC", async () => {
    expect(env.DEPLOYMENT_ENV).toBe("local");

    await expect(
      catalogQuery.resolvePublicationV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "preview",
        requestedPublicationId: null,
        requiredAvailableUntilMs: 0,
      }),
    ).resolves.toEqual({ outcome: "integrity_failure" });

    await expect(
      catalogQuery.resolvePublicationV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        requestedPublicationId: null,
        requiredAvailableUntilMs: 0,
      }),
    ).resolves.toEqual({ outcome: "read_failure" });

    await expect(
      catalogQuery.readMergedExactSearchV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: "bookmark-test-only",
        requiredAvailableUntilMs: 0,
        envelope: {
          version: 1,
          audience: "quantclarity-catalog-query-v1",
          environment: "local",
          operation: { kind: "search" },
          publicationId: PUBLICATION,
          filters: {},
          sort: ["relevance", "stable_id"],
          limit: 20,
          continuation: null,
          searchPlan: {
            kind: "exact_structured",
            query: "Fixture",
            filters: {},
            limit: 20,
            semanticCandidates: 0,
            semanticCalls: 0,
            semanticDegraded: "disabled",
          },
        },
      }),
    ).resolves.toEqual({ outcome: "read_failure" });

    await expect(
      catalogQuery.readDatasetMetadataV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: "bookmark-test-only",
        requiredAvailableUntilMs: Date.now() + 5 * 60_000,
        envelope: {
          version: 1,
          audience: "quantclarity-catalog-query-v1",
          environment: "local",
          operation: { kind: "metadata" },
          publicationId: PUBLICATION,
          filters: {},
          sort: [],
          limit: 25,
          continuation: null,
          searchPlan: null,
        },
      }),
    ).resolves.toEqual({ outcome: "read_failure" });

    await expect(
      catalogQuery.readMethodologyContextV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: "bookmark-test-only",
        requiredAvailableUntilMs: Date.now() + 5 * 60_000,
        envelope: {
          version: 1,
          audience: "quantclarity-catalog-query-v1",
          environment: "local",
          operation: { kind: "methodology_detail", version: "1.0.0" },
          publicationId: PUBLICATION,
          filters: {},
          sort: ["version"],
          limit: 25,
          continuation: null,
          searchPlan: null,
        },
      }),
    ).resolves.toEqual({ outcome: "read_failure" });

    await expect(
      catalogQuery.readModelDetailV1({
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: "bookmark-test-only",
        requiredAvailableUntilMs: Date.now() + 5 * 60_000,
        envelope: {
          version: 1,
          audience: "quantclarity-catalog-query-v1",
          environment: "local",
          operation: {
            kind: "detail",
            resourceType: "model",
            identifier: MODEL,
          },
          publicationId: PUBLICATION,
          filters: {},
          sort: ["name", "stable_id"],
          limit: 25,
          continuation: null,
          searchPlan: null,
        },
      }),
    ).resolves.toEqual({ outcome: "read_failure" });

    await expect(
      catalogQuery.readModelDetailV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: "bookmark-test-only",
        requiredAvailableUntilMs: Date.now() + 5 * 60_000,
        lookup: { kind: "slug", value: "fixture-model" },
        envelope: {
          version: 1,
          audience: "quantclarity-catalog-query-v1",
          environment: "local",
          operation: {
            kind: "detail",
            resourceType: "model",
            identifier: "fixture-model",
          },
          publicationId: PUBLICATION,
          filters: {},
          sort: ["name", "stable_id"],
          limit: 25,
          continuation: null,
          searchPlan: null,
        },
      }),
    ).resolves.toEqual({ outcome: "read_failure" });

    await expect(
      catalogQuery.readMergedExactSearchV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: "bookmark-test-only",
        requiredAvailableUntilMs: 0,
        envelope: {
          version: 1,
          audience: "quantclarity-catalog-query-v1",
          environment: "local",
          operation: { kind: "search" },
          publicationId: PUBLICATION,
          filters: { provider: PROVIDER },
          sort: ["relevance", "stable_id"],
          limit: 20,
          continuation: null,
          searchPlan: {
            kind: "exact_structured",
            query: "Fixture",
            filters: { provider: PROVIDER },
            limit: 20,
            semanticCandidates: 0,
            semanticCalls: 0,
            semanticDegraded: "disabled",
          },
        },
      }),
    ).resolves.toEqual({ outcome: "read_failure" });

    await expect(
      catalogQuery.readMergedExactSearchV2({
        version: 2,
        audience: "quantclarity-catalog-query-v1",
        environment: "local",
        bookmark: "bookmark-test-only",
        requiredAvailableUntilMs: 0,
        envelope: {
          version: 1,
          audience: "quantclarity-catalog-query-v1",
          environment: "local",
          operation: { kind: "search" },
          publicationId: PUBLICATION,
          filters: {
            family: FAMILY,
            provider: PROVIDER,
            record_type: "model",
          },
          sort: ["relevance", "stable_id"],
          limit: 20,
          continuation: null,
          searchPlan: {
            kind: "exact_structured",
            query: "Fixture",
            filters: {
              family: FAMILY,
              provider: PROVIDER,
              record_type: "model",
            },
            limit: 20,
            semanticCandidates: 0,
            semanticCalls: 0,
            semanticDegraded: "disabled",
          },
        },
      }),
    ).resolves.toEqual({ outcome: "read_failure" });
  });

  it("does not expose the incomplete search seam through the public handler", async () => {
    const response = await exports.default.fetch(
      new Request("https://api.example.test/v1/search", {
        headers: { "CF-Connecting-IP": "192.0.2.30" },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.has("X-Request-ID")).toBe(false);
  });

  it("authenticates the identity-free frontend metadata read in actual workerd", async () => {
    const headers = await signFrontendApiRequest({
      environment: "local",
      method: "GET",
      nowMs: Date.now(),
      path: "/v1/metadata",
      secret: "frontend-worker-test-secret-with-at-least-32-characters",
      subtle: crypto.subtle,
    });
    if (headers === null) throw new Error("test signing failed");
    const response = await exports.default.fetch(
      new Request(`${FRONTEND_API_INTERNAL_ORIGIN}/v1/metadata`, { headers }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "The metadata is temporarily unavailable.",
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.has("X-Request-ID")).toBe(false);
  });

  it.each([`/v1/models/${MODEL}`, "/v1/models/fixture-model"])(
    "keeps the live Model route closed for %s",
    async (path) => {
      const response = await exports.default.fetch(
        new Request(`https://api.example.test${path}`, {
          headers: { "CF-Connecting-IP": "2001:db8:abcd:12::99" },
        }),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.has("Set-Cookie")).toBe(false);
      expect(response.headers.has("X-Request-ID")).toBe(false);
    },
  );
});
