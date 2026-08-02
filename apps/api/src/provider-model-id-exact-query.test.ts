import { describe, expect, it, vi } from "vitest";

import {
  validateAndNormalizeRequest,
  type ApiLimits,
  type NormalizedRequest,
} from "@quant-clarity/api-core";
import { normalizeExactSearchName } from "@quant-clarity/publication-core";

import {
  readProviderModelIdExactFromQueryV1,
  type ProviderModelIdCatalogQueryRpcV1,
} from "./provider-model-id-exact-query.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const CURRENT_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const PROVIDER = "prv_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MODEL_A = "mdl_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MODEL_B = "mdl_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VARIANT = "var_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVIDENCE = "evd_dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
  const validated = validateAndNormalizeRequest(
    {
      bodyBytes: 0,
      hasQueryString: true,
      method: "GET",
      pathname: "/v1/search",
      publicationHeader,
      rawQuery: `q=provider%2Fmodel&provider=${PROVIDER}&record_type=model&limit=2`,
    },
    limits,
  );
  if (!validated.success) throw new Error("fixture request must validate");
  return validated.request;
};

const result = (
  resourceType: "model" | "variant",
  resourceId: string,
  value: string,
) => ({
  tier: 2,
  resourceType,
  resourceId,
  matchKind: "provider_model_id",
  displayName: {
    state: "known",
    value,
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
      matchModes: ["normalized", "normalized"],
      results: [
        result("model", MODEL_A, "Alpha Model"),
        result("model", MODEL_B, "Beta Model"),
      ],
      nextContinuation: {
        matchMode: "normalized",
        normalizedTargetDisplayName: "beta model",
        resourceId: MODEL_B,
      },
    },
  },
) => ({
  resolvePublicationV1: vi.fn((inputValue: unknown) => {
    void inputValue;
    return Promise.resolve(resolveOutcome);
  }),
  readProviderModelIdExactTierV1: vi.fn((inputValue: unknown) => {
    void inputValue;
    return Promise.resolve(tierOutcome);
  }),
});

describe("provider-model-ID exact API adapter (SRCH-002, API-003, PRIV-006)", () => {
  it("builds only the closed bookmark-continuous envelope and strips the tier continuation", async () => {
    const rpc = service();
    const outcome = await readProviderModelIdExactFromQueryV1({
      service: rpc,
      request: request(PUBLICATION),
      environment: "test",
      limits,
    });

    expect(outcome).toEqual({
      success: true,
      publicationId: PUBLICATION,
      results: [
        result("model", MODEL_A, "Alpha Model"),
        result("model", MODEL_B, "Beta Model"),
      ],
    });
    expect(rpc.resolvePublicationV1).toHaveBeenCalledWith({
      version: 1,
      audience: "quantclarity-catalog-query-v1",
      environment: "test",
      requestedPublicationId: PUBLICATION,
    });
    expect(rpc.readProviderModelIdExactTierV1).toHaveBeenCalledWith({
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
        filters: { provider: PROVIDER, record_type: "model" },
        sort: ["relevance", "stable_id"],
        limit: 2,
        continuation: null,
        searchPlan: {
          kind: "exact_structured",
          query: "provider/model",
          filters: { provider: PROVIDER, record_type: "model" },
          limit: 2,
          semanticCandidates: 0,
          semanticCalls: 0,
          semanticDegraded: "disabled",
        },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("bookmark-test-only");
    expect(JSON.stringify(outcome)).not.toContain("nextContinuation");
    expect(JSON.stringify(outcome)).not.toContain("matchMode");
  });

  it("accepts literal reserved characters and embedded U+0000 within the byte ceiling", async () => {
    const query = "provider*[id]\\{x}|\u0000model";
    const rpc = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        matchModes: [],
        results: [],
        nextContinuation: null,
      },
    });
    const outcome = await readProviderModelIdExactFromQueryV1({
      service: rpc,
      request: { ...request(), query },
      environment: "test",
      limits,
    });
    expect(outcome).toEqual({
      success: true,
      publicationId: PUBLICATION,
      results: [],
    });
    expect(rpc.readProviderModelIdExactTierV1.mock.calls[0]?.[0]).toMatchObject(
      {
        envelope: { searchPlan: { query } },
      },
    );

    const rawOnly = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        matchModes: [],
        results: [],
        nextContinuation: null,
      },
    });
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: rawOnly,
        request: { ...request(), query: "*" },
        environment: "test",
        limits,
      }),
    ).resolves.toMatchObject({ success: true });
  });

  it("accepts exactly 200 UTF-8 bytes and rejects the next multibyte scalar", async () => {
    const boundary = "é".repeat(100);
    const accepted = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        matchModes: [],
        results: [],
        nextContinuation: null,
      },
    });
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: accepted,
        request: { ...request(), query: boundary },
        environment: "test",
        limits,
      }),
    ).resolves.toMatchObject({ success: true });

    const rejected = service();
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: rejected,
        request: { ...request(), query: `${boundary}é` },
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "invalid_input" });
    expect(rejected.resolvePublicationV1).not.toHaveBeenCalled();
  });

  it("supports empty, target-type, provider, and conjunctive filters only", async () => {
    for (const filters of [
      {},
      { record_type: "model" },
      { provider: PROVIDER },
      { provider: PROVIDER, record_type: "model" },
    ]) {
      const rpc = service(undefined, {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          matchModes: ["raw"],
          results: [result("model", MODEL_A, "Alpha Model")],
          nextContinuation: null,
        },
      });
      await expect(
        readProviderModelIdExactFromQueryV1({
          service: rpc,
          request: { ...request(), filters },
          environment: "test",
          limits,
        }),
      ).resolves.toMatchObject({ success: true });
      expect(
        rpc.readProviderModelIdExactTierV1.mock.calls[0]?.[0],
      ).toMatchObject({ envelope: { filters, searchPlan: { filters } } });
    }

    for (const filters of [
      { record_type: "provider" },
      { provider: MODEL_A },
      { status: "active" },
      { provider: PROVIDER, stale: false },
    ]) {
      const rpc = service();
      await expect(
        readProviderModelIdExactFromQueryV1({
          service: rpc,
          request: { ...request(), filters },
          environment: "test",
          limits,
        }),
      ).resolves.toEqual({ success: false, code: "invalid_input" });
      expect(rpc.resolvePublicationV1).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed requests and limits before resolving a publication", async () => {
    const malformed = [
      { ...request(), cursor: "public-cursor" },
      { ...request(), query: " provider/model" },
      { ...request(), query: "e\u0301" },
      { ...request(), query: "x".repeat(201) },
      { ...request(), query: "\ud800" },
      { ...request(), sort: ["stable_id"] },
      { ...request(), visitorPayload: "must not cross" },
    ] as unknown as NormalizedRequest[];
    for (const candidate of malformed) {
      const rpc = service();
      await expect(
        readProviderModelIdExactFromQueryV1({
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
      readProviderModelIdExactFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits: { ...limits, maxSearchResults: 1 },
      }),
    ).resolves.toEqual({ success: false, code: "invalid_input" });
    expect(rpc.resolvePublicationV1).not.toHaveBeenCalled();
  });

  it("returns only static resolver failures and does not call the tier", async () => {
    const expired = service({
      outcome: "publication_expired",
      currentPublicationId: CURRENT_PUBLICATION,
    });
    await expect(
      readProviderModelIdExactFromQueryV1({
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
    expect(expired.readProviderModelIdExactTierV1).not.toHaveBeenCalled();

    for (const code of [
      "publication_not_ready",
      "integrity_failure",
      "read_failure",
    ]) {
      const rpc = service({ outcome: code });
      await expect(
        readProviderModelIdExactFromQueryV1({
          service: rpc,
          request: request(),
          environment: "test",
          limits,
        }),
      ).resolves.toEqual({ success: false, code });
      expect(rpc.readProviderModelIdExactTierV1).not.toHaveBeenCalled();
    }
  });

  it.each([
    {
      label: "wrong publication",
      page: {
        publicationId: CURRENT_PUBLICATION,
        matchModes: [],
        results: [],
        nextContinuation: null,
      },
    },
    {
      label: "wrong result tier",
      page: {
        publicationId: PUBLICATION,
        matchModes: ["raw"],
        results: [{ ...result("model", MODEL_A, "Alpha Model"), tier: 3 }],
        nextContinuation: null,
      },
    },
    {
      label: "descending canonical order",
      page: {
        publicationId: PUBLICATION,
        matchModes: ["raw", "raw"],
        results: [
          result("model", MODEL_B, "Beta Model"),
          result("model", MODEL_A, "Alpha Model"),
        ],
        nextContinuation: null,
      },
    },
    {
      label: "duplicate target",
      page: {
        publicationId: PUBLICATION,
        matchModes: ["raw", "raw"],
        results: [
          result("model", MODEL_A, "Alpha Model"),
          result("model", MODEL_A, "Alpha Model"),
        ],
        nextContinuation: null,
      },
    },
    {
      label: "forged continuation",
      page: {
        publicationId: PUBLICATION,
        matchModes: ["normalized", "normalized"],
        results: [
          result("model", MODEL_A, "Alpha Model"),
          result("model", MODEL_B, "Beta Model"),
        ],
        nextContinuation: {
          matchMode: "raw",
          normalizedTargetDisplayName: "alpha model",
          resourceId: MODEL_A,
        },
      },
    },
  ])("rejects a tampered $label page", async ({ page }) => {
    const rpc = service(undefined, { outcome: "page", page });
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });

  it("accepts the raw-to-normalized boundary even when the display key decreases", async () => {
    const rpc = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        matchModes: ["raw", "normalized"],
        results: [
          result("model", MODEL_A, "Zulu Model"),
          result("model", MODEL_B, "Alpha Model"),
        ],
        nextContinuation: {
          matchMode: "normalized",
          normalizedTargetDisplayName: "alpha model",
          resourceId: MODEL_B,
        },
      },
    });

    await expect(
      readProviderModelIdExactFromQueryV1({
        service: rpc,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toMatchObject({ success: true });
  });

  it("rejects missing, misaligned, or descending internal match-mode metadata", async () => {
    const invalidPages = [
      {
        publicationId: PUBLICATION,
        results: [result("model", MODEL_A, "Alpha Model")],
        nextContinuation: null,
      },
      {
        publicationId: PUBLICATION,
        matchModes: [],
        results: [result("model", MODEL_A, "Alpha Model")],
        nextContinuation: null,
      },
      {
        publicationId: PUBLICATION,
        matchModes: ["normalized", "raw"],
        results: [
          result("model", MODEL_A, "Alpha Model"),
          result("model", MODEL_B, "Beta Model"),
        ],
        nextContinuation: null,
      },
    ];
    for (const page of invalidPages) {
      const rpc = service(undefined, { outcome: "page", page });
      await expect(
        readProviderModelIdExactFromQueryV1({
          service: rpc,
          request: request(),
          environment: "test",
          limits,
        }),
      ).resolves.toEqual({ success: false, code: "integrity_failure" });
    }
  });

  it("enforces the target-type filter and UTF-8 display ordering", async () => {
    const mismatch = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        matchModes: ["raw"],
        results: [result("variant", VARIANT, "Variant")],
        nextContinuation: null,
      },
    });
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: mismatch,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });

    const normalizedTie = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        matchModes: ["raw", "raw"],
        results: [
          result("model", MODEL_A, "ALPHA  MODEL"),
          result("model", MODEL_B, "alpha model"),
        ],
        nextContinuation: null,
      },
    });
    expect(normalizeExactSearchName("ALPHA  MODEL")).toBe("alpha model");
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: normalizedTie,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toMatchObject({ success: true });
  });

  it("orders normalized display names by unsigned UTF-8 bytes rather than UTF-16 code units", async () => {
    const privateUseBmp: string = String.fromCodePoint(0xe000);
    const supplementary: string = String.fromCodePoint(0x10000);
    expect(supplementary < privateUseBmp).toBe(true);
    expect(new TextEncoder().encode(privateUseBmp)[0]).toBeLessThan(
      new TextEncoder().encode(supplementary)[0] ?? 0,
    );

    const accepted = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        matchModes: ["raw", "raw"],
        results: [
          result("model", MODEL_A, privateUseBmp),
          result("model", MODEL_B, supplementary),
        ],
        nextContinuation: null,
      },
    });
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: accepted,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toMatchObject({ success: true });

    const reversed = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        matchModes: ["raw", "raw"],
        results: [
          result("model", MODEL_A, supplementary),
          result("model", MODEL_B, privateUseBmp),
        ],
        nextContinuation: null,
      },
    });
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: reversed,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });

  it("rejects accessor-bearing RPC snapshots, extra fields, and response overages", async () => {
    const accessorPage = Object.defineProperty(
      {
        publicationId: PUBLICATION,
        matchModes: [],
        results: [],
      },
      "nextContinuation",
      {
        enumerable: true,
        get: () => null,
      },
    );
    const accessor = service(undefined, {
      outcome: "page",
      page: accessorPage,
    });
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: accessor,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });

    const extra = service(undefined, {
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        matchModes: [],
        results: [],
        nextContinuation: null,
        visitorQuery: "must not cross",
      },
    });
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: extra,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });

    const oversized = service();
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: oversized,
        request: request(),
        environment: "test",
        limits: { ...limits, maxResponseBytes: 1 },
      }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });

  it("rejects non-enumerable RPC array elements at every nested boundary", async () => {
    const hidden = <T>(value: T): T[] => {
      const array = [value];
      Object.defineProperty(array, "0", {
        enumerable: false,
        value,
      });
      return array;
    };
    const base = result("model", MODEL_A, "Alpha Model");
    const pages = [
      {
        publicationId: PUBLICATION,
        matchModes: ["raw"],
        results: hidden(base),
        nextContinuation: null,
      },
      {
        publicationId: PUBLICATION,
        matchModes: hidden("raw"),
        results: [base],
        nextContinuation: null,
      },
      {
        publicationId: PUBLICATION,
        matchModes: ["raw"],
        results: [
          {
            ...base,
            displayName: {
              ...base.displayName,
              evidence_ids: hidden(EVIDENCE),
            },
          },
        ],
        nextContinuation: null,
      },
    ];
    for (const page of pages) {
      const rpc = service(undefined, { outcome: "page", page });
      await expect(
        readProviderModelIdExactFromQueryV1({
          service: rpc,
          request: request(),
          environment: "test",
          limits,
        }),
      ).resolves.toEqual({ success: false, code: "integrity_failure" });
    }
  });

  it("fails closed with a static read failure when either RPC throws", async () => {
    const resolutionFailure: ProviderModelIdCatalogQueryRpcV1 = {
      resolvePublicationV1: vi.fn(() =>
        Promise.reject(new Error("sensitive request material")),
      ),
      readProviderModelIdExactTierV1: vi.fn(),
    };
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: resolutionFailure,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "read_failure" });

    const tierFailure = service();
    tierFailure.readProviderModelIdExactTierV1.mockRejectedValueOnce(
      new Error("sensitive request material"),
    );
    await expect(
      readProviderModelIdExactFromQueryV1({
        service: tierFailure,
        request: request(),
        environment: "test",
        limits,
      }),
    ).resolves.toEqual({ success: false, code: "read_failure" });
  });
});
