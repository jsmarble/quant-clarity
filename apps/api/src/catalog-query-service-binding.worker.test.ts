import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { CatalogQueryRpcV3 } from "@quant-clarity/api-core";

const catalogQuery = env.CATALOG_QUERY as unknown as CatalogQueryRpcV3;
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const FAMILY = "fam_33333333-3333-4333-8333-333333333333";
const PROVIDER = "prv_22222222-2222-4222-8222-222222222222";

describe("local named catalog query service binding (API-003, API-010, CF-002)", () => {
  it("calls the actual named WorkerEntrypoint over JSRPC", async () => {
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
});
