import { describe, expect, it, vi } from "vitest";

import {
  validateAndNormalizeRequest,
  type ApiLimits,
  type NormalizedRequest,
} from "@quant-clarity/api-core";

import {
  readModelVariantExactNameFromQueryV1,
  type ModelVariantCatalogQueryRpcV1,
} from "./model-variant-exact-name-query.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const CURRENT_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const MODEL = "mdl_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VARIANT = "var_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
  query = "Fixture Model",
): NormalizedRequest => {
  const result = validateAndNormalizeRequest(
    {
      bodyBytes: 0,
      hasQueryString: true,
      method: "GET",
      pathname: "/v1/search",
      publicationHeader,
      rawQuery: `q=${encodeURIComponent(query)}&limit=2`,
    },
    limits,
  );
  if (!result.success) throw new Error("fixture request must validate");
  return result.request;
};

const result = (
  resourceType: "model" | "variant",
  resourceId: string,
  query = "Fixture Model",
) => ({
  tier: 1,
  resourceType,
  resourceId,
  matchKind: "canonical_name",
  displayName: {
    state: "known",
    value: query,
    observed_at: "2026-08-01T00:00:00.000Z",
    evidence_ids: [EVIDENCE],
  },
  semanticDegraded: "disabled",
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
      results: [result("model", MODEL), result("variant", VARIANT)],
      nextAfterResourceId: VARIANT,
    },
  },
) => ({
  resolvePublicationV1: vi.fn((inputValue: unknown) => {
    void inputValue;
    return Promise.resolve(resolveOutcome);
  }),
  readModelVariantExactNameTierV1: vi.fn((inputValue: unknown) => {
    void inputValue;
    return Promise.resolve(tierOutcome);
  }),
});

describe("model/variant exact-name API adapter (API-003, SRCH-002, PRIV-006)", () => {
  it("passes only the closed publication/bookmark envelope and validates the tier-1 page", async () => {
    const rpc = service();
    const outcome = await readModelVariantExactNameFromQueryV1({
      service: rpc,
      request: request(PUBLICATION),
      environment: "test",
      limits,
    });

    expect(outcome).toEqual({
      success: true,
      publicationId: PUBLICATION,
      results: [result("model", MODEL), result("variant", VARIANT)],
    });
    expect(rpc.resolvePublicationV1).toHaveBeenCalledWith({
      version: 1,
      audience: "quantclarity-catalog-query-v1",
      environment: "test",
      requestedPublicationId: PUBLICATION,
    });
    expect(rpc.readModelVariantExactNameTierV1).toHaveBeenCalledWith({
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
        filters: {},
        sort: ["relevance", "stable_id"],
        limit: 2,
        continuation: null,
        searchPlan: {
          kind: "exact_structured",
          query: "Fixture Model",
          filters: {},
          limit: 2,
          semanticCandidates: 0,
          semanticCalls: 0,
          semanticDegraded: "disabled",
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("bookmark-test-only");
  });

  it("preserves embedded NUL through the live envelope and result without serializing the bookmark", async () => {
    const query = "Fixture\u0000Model";
    const rpc = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [result("model", MODEL, query)],
        nextAfterResourceId: null,
      },
    });
    const outcome = await readModelVariantExactNameFromQueryV1({
      service: rpc,
      request: request(null, query),
      environment: "test",
      limits,
    });
    expect(outcome).toEqual({
      success: true,
      publicationId: PUBLICATION,
      results: [result("model", MODEL, query)],
    });
    expect(
      rpc.readModelVariantExactNameTierV1.mock.calls[0]?.[0],
    ).toMatchObject({
      envelope: { searchPlan: { query } },
    });
    expect(JSON.stringify(outcome)).not.toContain("bookmark-test-only");
  });

  it("preserves repeated separators for exact-search normalization", async () => {
    const rpc = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [result("model", MODEL, "Fixture Model")],
        nextAfterResourceId: null,
      },
    });
    await expect(
      readModelVariantExactNameFromQueryV1({
        service: rpc,
        request: request(null, "Fixture  Model"),
        environment: "test",
        limits,
      }),
    ).resolves.toMatchObject({ success: true });
    expect(
      rpc.readModelVariantExactNameTierV1.mock.calls[0]?.[0],
    ).toMatchObject({
      envelope: { searchPlan: { query: "Fixture  Model" } },
    });
  });

  it("passes the optional model/variant selector and rejects a mismatched result type", async () => {
    const selectedRequest = {
      ...request(),
      filters: { record_type: "model" },
    } as NormalizedRequest;
    const rpc = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [result("model", MODEL)],
        nextAfterResourceId: null,
      },
    });
    await expect(
      readModelVariantExactNameFromQueryV1({
        service: rpc,
        request: selectedRequest,
        environment: "test",
        limits,
      }),
    ).resolves.toMatchObject({ success: true });
    expect(
      rpc.readModelVariantExactNameTierV1.mock.calls[0]?.[0],
    ).toMatchObject({
      envelope: {
        filters: { record_type: "model" },
        searchPlan: { filters: { record_type: "model" } },
      },
    });

    const mismatch = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [result("variant", VARIANT)],
        nextAfterResourceId: null,
      },
    });
    await expect(
      readModelVariantExactNameFromQueryV1({
        service: mismatch,
        request: selectedRequest,
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });

  it("returns closed resolver failures and never calls the tier", async () => {
    const expired = service({
      outcome: "publication_expired",
      currentPublicationId: CURRENT_PUBLICATION,
    });
    await expect(
      readModelVariantExactNameFromQueryV1({
        service: expired,
        request: request(PUBLICATION),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({
      success: false,
      code: "publication_expired",
      currentPublicationId: CURRENT_PUBLICATION,
    });
    expect(expired.readModelVariantExactNameTierV1).not.toHaveBeenCalled();

    for (const outcome of [
      "publication_not_ready",
      "integrity_failure",
      "read_failure",
    ]) {
      const rpc = service({ outcome });
      await expect(
        readModelVariantExactNameFromQueryV1({
          service: rpc,
          request: request(),
          environment: "test",
          limits,
        }),
      ).resolves.toEqual({ success: false, code: outcome });
      expect(rpc.readModelVariantExactNameTierV1).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed requests and limits before publication resolution", async () => {
    const malformed = [
      { ...request(), cursor: "not-an-internal-cursor" },
      { ...request(), filters: { record_type: "provider" } },
      { ...request(), query: " Fixture Model " },
      { ...request(), query: "Fixture * Model" },
      { ...request(), query: "x".repeat(401) },
      { ...request(), visitorPayload: "must not cross" },
    ] as unknown as NormalizedRequest[];
    for (const candidate of malformed) {
      const rpc = service();
      await expect(
        readModelVariantExactNameFromQueryV1({
          service: rpc,
          request: candidate,
          environment: "test",
          limits,
        }),
      ).resolves.toEqual({ success: false, code: "invalid_input" });
      expect(rpc.resolvePublicationV1).not.toHaveBeenCalled();
    }

    const rpc = service();
    await expect(
      readModelVariantExactNameFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits: { ...limits, maxResponseBytes: 0 },
      }),
    ).resolves.toEqual({ success: false, code: "invalid_input" });
    expect(rpc.resolvePublicationV1).not.toHaveBeenCalled();

    const oversizedQueryRpc = service();
    await expect(
      readModelVariantExactNameFromQueryV1({
        service: oversizedQueryRpc,
        request: {
          ...request(),
          query: "é".repeat(101),
        },
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "invalid_input" });
    expect(oversizedQueryRpc.resolvePublicationV1).not.toHaveBeenCalled();

    const loweredResultLimitRpc = service();
    await expect(
      readModelVariantExactNameFromQueryV1({
        service: loweredResultLimitRpc,
        request: request(),
        environment: "test",
        limits: { ...limits, maxSearchResults: 1 },
      }),
    ).resolves.toEqual({ success: false, code: "invalid_input" });
    expect(loweredResultLimitRpc.resolvePublicationV1).not.toHaveBeenCalled();
  });

  it("maps thrown calls to a static failure", async () => {
    const rpc: ModelVariantCatalogQueryRpcV1 = {
      resolvePublicationV1: vi.fn(() => Promise.reject(new Error("private"))),
      readModelVariantExactNameTierV1: vi.fn(),
    };
    await expect(
      readModelVariantExactNameFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "read_failure" });
  });

  it("snapshots hostile input, outcome, result accessors, and array lengths once", async () => {
    let requestReads = 0;
    let publicationReads = 0;
    let resourceReads = 0;
    let lengthReads = 0;
    const resolved = {
      outcome: "selected",
      bookmark: "bookmark-test-only",
    } as Record<string, unknown>;
    Object.defineProperty(resolved, "publicationId", {
      enumerable: true,
      get: () => {
        publicationReads += 1;
        return publicationReads === 1 ? PUBLICATION : CURRENT_PUBLICATION;
      },
    });
    const candidate = {
      ...result("model", MODEL),
    } as Record<string, unknown>;
    Object.defineProperty(candidate, "resourceId", {
      enumerable: true,
      get: () => {
        resourceReads += 1;
        return resourceReads === 1 ? MODEL : "mdl_invalid";
      },
    });
    const results = new Proxy([candidate], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 1 : 999;
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const rpc = {
      resolvePublicationV1: vi.fn((inputValue: unknown) => {
        void inputValue;
        return Promise.resolve(resolved);
      }),
      readModelVariantExactNameTierV1: vi.fn((inputValue: unknown) => {
        void inputValue;
        return Promise.resolve({
          outcome: "page",
          page: {
            publicationId: PUBLICATION,
            results,
            nextAfterResourceId: null,
          },
        });
      }),
    };
    const outer = {
      service: rpc,
      environment: "test",
      limits,
    } as Record<string, unknown>;
    Object.defineProperty(outer, "request", {
      enumerable: true,
      get: () => {
        requestReads += 1;
        return requestReads === 1
          ? request()
          : { ...request(), visitorPayload: true };
      },
    });

    await expect(
      readModelVariantExactNameFromQueryV1(
        outer as unknown as Parameters<
          typeof readModelVariantExactNameFromQueryV1
        >[0],
      ),
    ).resolves.toMatchObject({ success: true });
    expect(requestReads).toBe(1);
    expect(publicationReads).toBe(1);
    expect(resourceReads).toBe(1);
    expect(lengthReads).toBe(1);
  });

  it("rejects negative/fractional result lengths and evidence over budget before copying", async () => {
    for (const hostileLength of [-1, 0.5]) {
      const results = new Proxy([result("model", MODEL)], {
        get(target, property, receiver) {
          return property === "length"
            ? hostileLength
            : (Reflect.get(target, property, receiver) as unknown);
        },
      });
      const rpc = service(undefined, {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results,
          nextAfterResourceId: null,
        },
      });
      await expect(
        readModelVariantExactNameFromQueryV1({
          service: rpc,
          request: request(),
          environment: "test",
          limits,
        }),
      ).resolves.toEqual({ success: false, code: "integrity_failure" });
    }

    const maximumEvidenceItems = Math.floor(1_000_000 / 42);
    let lengthReads = 0;
    let itemReads = 0;
    const evidence = new Proxy([EVIDENCE], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return maximumEvidenceItems + 1;
        }
        if (typeof property === "string" && /^[0-9]+$/u.test(property))
          itemReads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const rpc = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [
          {
            ...result("model", MODEL),
            displayName: {
              ...result("model", MODEL).displayName,
              evidence_ids: evidence,
            },
          },
        ],
        nextAfterResourceId: null,
      },
    });
    await expect(
      readModelVariantExactNameFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
    expect({ itemReads, lengthReads }).toEqual({
      itemReads: 0,
      lengthReads: 1,
    });
  });

  it.each([
    {
      label: "wrong publication",
      page: {
        publicationId: CURRENT_PUBLICATION,
        results: [],
        nextAfterResourceId: null,
      },
    },
    {
      label: "descending stable IDs",
      page: {
        publicationId: PUBLICATION,
        results: [result("variant", VARIANT), result("model", MODEL)],
        nextAfterResourceId: null,
      },
    },
    {
      label: "forged lookahead",
      page: {
        publicationId: PUBLICATION,
        results: [result("model", MODEL)],
        nextAfterResourceId: MODEL,
      },
    },
    {
      label: "resource/match mismatch",
      page: {
        publicationId: PUBLICATION,
        results: [{ ...result("model", MODEL), matchKind: "provider_name" }],
        nextAfterResourceId: null,
      },
    },
  ])("rejects a tampered $label page", async ({ page }) => {
    const rpc = service(undefined, { outcome: "page", page });
    await expect(
      readModelVariantExactNameFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });

  it("rejects wrong ordering bytes, extra fields, impossible facts, reserved bookmarks, and oversized results", async () => {
    const cases: unknown[] = [
      {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results: [
            {
              ...result("model", MODEL),
              displayName: {
                ...result("model", MODEL).displayName,
                value: "Unrelated Model",
              },
            },
          ],
          nextAfterResourceId: null,
        },
      },
      {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results: [
            {
              ...result("model", MODEL),
              displayName: {
                ...result("model", MODEL).displayName,
                value: "x".repeat(401),
              },
            },
          ],
          nextAfterResourceId: null,
        },
      },
      {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results: [
            {
              ...result("model", MODEL),
              displayName: {
                ...result("model", MODEL).displayName,
                observed_at: "2026-02-31T00:00:00.000Z",
              },
            },
          ],
          nextAfterResourceId: null,
        },
      },
      {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results: [{ ...result("model", MODEL), extra: true }],
          nextAfterResourceId: null,
        },
      },
      { outcome: "publication_not_ready" },
    ];
    for (const tier of cases) {
      const rpc = service(undefined, tier);
      await expect(
        readModelVariantExactNameFromQueryV1({
          service: rpc,
          request: request(),
          environment: "test",
          limits,
        }),
      ).resolves.toEqual({ success: false, code: "integrity_failure" });
    }

    for (const bookmark of ["first-primary", "first-unconstrained"]) {
      const rpc = service({
        outcome: "selected",
        publicationId: PUBLICATION,
        bookmark,
      });
      await expect(
        readModelVariantExactNameFromQueryV1({
          service: rpc,
          request: request(),
          environment: "test",
          limits,
        }),
      ).resolves.toEqual({ success: false, code: "integrity_failure" });
      expect(rpc.readModelVariantExactNameTierV1).not.toHaveBeenCalled();
    }

    const oversized = service();
    await expect(
      readModelVariantExactNameFromQueryV1({
        service: oversized,
        request: request(),
        environment: "test",
        limits: { ...limits, maxResponseBytes: 1 },
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });
});
