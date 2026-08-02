import { describe, expect, it, vi } from "vitest";

import {
  validateAndNormalizeRequest,
  type ApiLimits,
  type NormalizedRequest,
} from "@quant-clarity/api-core";

import {
  readProviderExactNameFromQueryV1,
  type CatalogQueryRpcV1,
} from "./provider-exact-name-query.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const CURRENT_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const PROVIDER_A = "prv_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROVIDER_B = "prv_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVIDENCE = "evd_cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const limits: ApiLimits = {
  defaultPageSize: 25,
  maxBodyBytes: 1024,
  maxCpuMilliseconds: 50,
  maxCursorCharacters: 4096,
  maxErrorDetails: 10,
  maxFilterValues: 10,
  maxPageSize: 100,
  maxPathBytes: 512,
  maxQueryBytes: 4096,
  maxQueryValueBytes: 512,
  maxResponseBytes: 1_048_576,
  maxSemanticCalls: 0,
  maxSemanticCandidates: 0,
  maxSearchQueryBytes: 200,
  maxSearchResults: 20,
  maxSubrequests: 16,
  maxUpstreamCalls: 12,
  maxUrlBytes: 8192,
};

const request = (
  publicationHeader: string | null = null,
): NormalizedRequest => {
  const result = validateAndNormalizeRequest(
    {
      bodyBytes: 0,
      hasQueryString: true,
      method: "GET",
      pathname: "/v1/search",
      publicationHeader,
      rawQuery: "q=Fixture%20Provider&record_type=provider&limit=2",
    },
    limits,
  );
  if (!result.success) throw new Error("fixture request must validate");
  return result.request;
};

const result = (resourceId: string) => ({
  tier: 3,
  resourceType: "provider",
  resourceId,
  matchKind: "provider_name",
  displayName: {
    state: "known",
    value: "Fixture Provider",
    observed_at: "2026-08-01T00:00:00.000Z",
    evidence_ids: [EVIDENCE],
  },
  semanticDegraded: "disabled",
  normalizedOrderingKey: "fixture provider",
});

const service = (
  resolveOutcome: unknown = {
    outcome: "selected",
    publicationId: PUBLICATION,
    bookmark: "bookmark-test-only",
  },
  tierOutcome: unknown = {
    outcome: "page",
    page: {
      publicationId: PUBLICATION,
      results: [result(PROVIDER_A), result(PROVIDER_B)],
      nextAfterProviderId: PROVIDER_B,
    },
  },
) => ({
  resolvePublicationV1: vi.fn(() => Promise.resolve(resolveOutcome)),
  readProviderExactNameTierV1: vi.fn(() => Promise.resolve(tierOutcome)),
});

describe("provider exact-name API adapter (API-003, API-010, PRIV-006)", () => {
  it("passes only the closed publication/bookmark envelope and validates the page", async () => {
    const rpc = service();
    const outcome = await readProviderExactNameFromQueryV1({
      service: rpc,
      request: request(PUBLICATION),
      environment: "test",
      limits,
    });

    expect(outcome).toEqual({
      success: true,
      publicationId: PUBLICATION,
      results: [result(PROVIDER_A), result(PROVIDER_B)],
    });
    expect(rpc.resolvePublicationV1).toHaveBeenCalledWith({
      version: 1,
      audience: "quantclarity-catalog-query-v1",
      environment: "test",
      requestedPublicationId: PUBLICATION,
    });
    expect(rpc.readProviderExactNameTierV1).toHaveBeenCalledWith({
      version: 1,
      audience: "quantclarity-catalog-query-v1",
      environment: "test",
      bookmark: "bookmark-test-only",
      envelope: {
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "test",
        operation: { kind: "search" },
        publicationId: PUBLICATION,
        filters: { record_type: "provider" },
        sort: ["relevance", "stable_id"],
        limit: 2,
        continuation: null,
        searchPlan: {
          kind: "exact_structured",
          query: "Fixture Provider",
          filters: { record_type: "provider" },
          limit: 2,
          semanticCalls: 0,
          semanticCandidates: 0,
          semanticDegraded: "disabled",
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("bookmark-test-only");
  });

  it("returns a closed expiry and never calls the tier after resolution fails", async () => {
    const rpc = service({
      outcome: "publication_expired",
      currentPublicationId: CURRENT_PUBLICATION,
    });
    await expect(
      readProviderExactNameFromQueryV1({
        service: rpc,
        request: request(PUBLICATION),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({
      success: false,
      code: "publication_expired",
      currentPublicationId: CURRENT_PUBLICATION,
    });
    expect(rpc.readProviderExactNameTierV1).not.toHaveBeenCalled();
  });

  it.each(["publication_not_ready", "integrity_failure", "read_failure"])(
    "preserves the static %s outcome without a tier call",
    async (outcome) => {
      const rpc = service({ outcome });
      await expect(
        readProviderExactNameFromQueryV1({
          service: rpc,
          request: request(),
          environment: "test",
          limits,
        }),
      ).resolves.toEqual({ success: false, code: outcome });
      expect(rpc.readProviderExactNameTierV1).not.toHaveBeenCalled();
    },
  );

  it("rejects non-canonical or NUL-bearing requests before RPC", async () => {
    for (const query of ["Fixture\u0000Provider", " Fixture Provider "]) {
      const rpc = service();
      const malformed = { ...request(), query } as NormalizedRequest;
      await expect(
        readProviderExactNameFromQueryV1({
          service: rpc,
          request: malformed,
          environment: "test",
          limits,
        }),
      ).resolves.toEqual({ success: false, code: "invalid_input" });
      expect(rpc.resolvePublicationV1).not.toHaveBeenCalled();
    }
  });

  it("fails closed when an RPC call throws", async () => {
    const rpc: CatalogQueryRpcV1 = {
      resolvePublicationV1: vi.fn(() =>
        Promise.reject(new Error("sensitive visitor input")),
      ),
      readProviderExactNameTierV1: vi.fn(),
    };
    await expect(
      readProviderExactNameFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "read_failure" });
  });

  it.each([
    {
      label: "wrong publication",
      page: {
        publicationId: CURRENT_PUBLICATION,
        results: [],
        nextAfterProviderId: null,
      },
    },
    {
      label: "descending results",
      page: {
        publicationId: PUBLICATION,
        results: [result(PROVIDER_B), result(PROVIDER_A)],
        nextAfterProviderId: null,
      },
    },
    {
      label: "forged lookahead",
      page: {
        publicationId: PUBLICATION,
        results: [result(PROVIDER_A)],
        nextAfterProviderId: PROVIDER_A,
      },
    },
  ])("rejects a tampered $label page", async ({ page }) => {
    const rpc = service(undefined, { outcome: "page", page });
    await expect(
      readProviderExactNameFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });

  it("rejects extra RPC result fields and a mismatched selected pin", async () => {
    const extra = service({
      outcome: "selected",
      publicationId: PUBLICATION,
      bookmark: "bookmark-test-only",
      visitorQuery: "must not cross",
    });
    await expect(
      readProviderExactNameFromQueryV1({
        service: extra,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });

    const mismatch = service({
      outcome: "selected",
      publicationId: CURRENT_PUBLICATION,
      bookmark: "bookmark-test-only",
    });
    await expect(
      readProviderExactNameFromQueryV1({
        service: mismatch,
        request: request(PUBLICATION),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
    expect(mismatch.readProviderExactNameTierV1).not.toHaveBeenCalled();
  });

  it("rejects resolver-only outcomes returned by the tier method", async () => {
    const rpc = service(undefined, { outcome: "publication_not_ready" });
    await expect(
      readProviderExactNameFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });

  it("rejects a tier response above the configured response ceiling", async () => {
    const rpc = service();
    await expect(
      readProviderExactNameFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits: { ...limits, maxResponseBytes: 1 },
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });

  it.each(["first-primary", "first-unconstrained"])(
    "rejects the reserved %s resolver bookmark before the tier call",
    async (bookmark) => {
      const rpc = service({
        outcome: "selected",
        publicationId: PUBLICATION,
        bookmark,
      });
      await expect(
        readProviderExactNameFromQueryV1({
          service: rpc,
          request: request(),
          environment: "test",
          limits,
        }),
      ).resolves.toEqual({ success: false, code: "integrity_failure" });
      expect(rpc.readProviderExactNameTierV1).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: "unrelated normalized key",
      candidate: {
        ...result(PROVIDER_A),
        normalizedOrderingKey: "unrelated provider",
      },
    },
    {
      label: "unrelated display name",
      candidate: {
        ...result(PROVIDER_A),
        displayName: {
          ...result(PROVIDER_A).displayName,
          value: "Unrelated Provider",
        },
      },
    },
  ])("rejects a tampered $label", async ({ candidate }) => {
    const rpc = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [candidate],
        nextAfterProviderId: null,
      },
    });
    await expect(
      readProviderExactNameFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });

  it.each([
    {
      label: "impossible timestamp",
      candidate: {
        ...result(PROVIDER_A),
        displayName: {
          ...result(PROVIDER_A).displayName,
          observed_at: "2026-02-31T00:00:00.000Z",
        },
      },
    },
    {
      label: "unpaired surrogate display name",
      candidate: {
        ...result(PROVIDER_A),
        displayName: {
          ...result(PROVIDER_A).displayName,
          value: "Fixture Provider\ud800",
        },
      },
    },
  ])("fails closed for a tampered $label", async ({ candidate }) => {
    const rpc = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [candidate],
        nextAfterProviderId: null,
      },
    });
    await expect(
      readProviderExactNameFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });
});
