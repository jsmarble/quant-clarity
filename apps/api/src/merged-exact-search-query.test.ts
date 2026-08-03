import { describe, expect, it, vi } from "vitest";

import {
  issueCursor,
  validateAndNormalizeRequest,
  verifyCursor,
  type ApiLimits,
  type CursorKeyring,
  type NormalizedRequest,
} from "@quant-clarity/api-core";

import {
  readMergedExactSearchFromQueryV1,
  type ExactTierMarker,
  type MergedExactSearchCatalogQueryRpcV2,
} from "./merged-exact-search-query.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const OTHER_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const MODEL_A = "mdl_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MODEL_B = "mdl_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VARIANT = "var_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROVIDER = "prv_dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_PROVIDER = "prv_ffffffff-ffff-4fff-8fff-ffffffffffff";
const EVIDENCE = "evd_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const NOW = 1_785_687_200;

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

const currentKey = {
  id: "current",
  secret: new Uint8Array(32).fill(0x11),
};
const oldKey = { id: "old", secret: new Uint8Array(32).fill(0x22) };
const keyring: CursorKeyring = { current: currentKey, next: oldKey };

const request = (
  rawQuery = "q=Model&limit=2",
  publicationHeader: string | null = null,
): NormalizedRequest => {
  const outcome = validateAndNormalizeRequest(
    {
      bodyBytes: 0,
      hasQueryString: true,
      method: "GET",
      pathname: "/v1/search",
      publicationHeader,
      rawQuery,
    },
    limits,
  );
  if (!outcome.success) throw new Error("request fixture must validate");
  return outcome.request;
};

type FixtureResourceType = "model" | "provider" | "variant";

const row = (
  tierMarker: ExactTierMarker,
  resourceType: FixtureResourceType,
  resourceId: string,
) => ({
  tierMarker,
  resourceType,
  resourceId,
  matchKind:
    tierMarker === "exact-v1:c"
      ? "canonical_name"
      : tierMarker === "exact-v1:p"
        ? "provider_name"
        : "provider_model_id",
  displayName: {
    state: "known",
    value:
      resourceType === "provider"
        ? "Example Provider"
        : resourceType === "variant"
          ? "Model Variant"
          : "Model",
    observed_at: "2026-08-01T00:00:00.000Z",
    evidence_ids: [EVIDENCE],
  },
});

const rpc = (
  page: unknown = {
    outcome: "page",
    page: {
      publicationId: PUBLICATION,
      results: [
        row("exact-v1:c", "model", MODEL_A),
        row("exact-v1:r", "variant", VARIANT),
      ],
      nextContinuation: {
        tierMarker: "exact-v1:r",
        resourceId: VARIANT,
      },
      semanticDegraded: "disabled",
    },
  },
  resolution?: unknown,
) => ({
  resolvePublicationV2: vi.fn((inputValue: unknown) => {
    const requested = inputValue as { requiredAvailableUntilMs: number };
    return Promise.resolve(
      resolution ?? {
        outcome: "selected",
        publicationId: PUBLICATION,
        bookmark: "bookmark-test-only",
        requiredAvailableUntilMs: requested.requiredAvailableUntilMs,
      },
    );
  }),
  readMergedExactSearchV2: vi.fn((inputValue: unknown) => {
    void inputValue;
    return Promise.resolve(page);
  }),
});

const execute = (
  service: MergedExactSearchCatalogQueryRpcV2,
  requestValue: NormalizedRequest = request(),
  overrides: Partial<{
    cursorKeyring: CursorKeyring;
    nowSeconds: number;
    maximumClockSkewSeconds: number;
    subtle: SubtleCrypto;
    limits: ApiLimits;
  }> = {},
) =>
  readMergedExactSearchFromQueryV1({
    service,
    request: requestValue,
    environment: "test",
    limits,
    cursorKeyring: keyring,
    nowSeconds: NOW,
    maximumClockSkewSeconds: 30,
    subtle: crypto.subtle,
    ...overrides,
  });

const cursor = async (
  overrides: Partial<{
    keyring: CursorKeyring;
    query: string;
    filters: Readonly<Record<string, string>>;
    sort: readonly string[];
    limit: number;
    publicationId: string;
    marker: ExactTierMarker;
    stableId: string;
    issuedAtSeconds: number;
    expiresAtSeconds: number;
  }> = {},
) => {
  const queryText = overrides.query ?? "Model";
  const queryHash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`quantclarity-query-v1\0${queryText}`),
  );
  const hash = [...new Uint8Array(queryHash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const stableId = overrides.stableId ?? VARIANT;
  return issueCursor(
    {
      version: 1,
      publicationId: overrides.publicationId ?? PUBLICATION,
      operation: "search",
      queryHash: hash,
      filters: overrides.filters ?? {},
      sort: overrides.sort ?? ["relevance", "stable_id"],
      limit: overrides.limit ?? 2,
      lastSortTuple: [overrides.marker ?? "exact-v1:r", stableId],
      stableId,
      issuedAtSeconds: overrides.issuedAtSeconds ?? NOW - 10,
      expiresAtSeconds: overrides.expiresAtSeconds ?? NOW + 890,
    },
    overrides.keyring ?? keyring,
    crypto.subtle,
  );
};

describe("merged exact search API seam (SRCH-001/002, API-003/007, PRIV-006)", () => {
  it("resolves once, reads once, emits SearchCollection shape, and strips internal state", async () => {
    const service = rpc();
    const outcome = await execute(service);
    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    expect(outcome.collection).toMatchObject({
      data: [
        {
          resource_type: "model",
          resource_id: MODEL_A,
          match_kind: "canonical_name",
          semantic_degraded: "disabled",
        },
        {
          resource_type: "variant",
          resource_id: VARIANT,
          match_kind: "provider_model_id",
          semantic_degraded: "disabled",
        },
      ],
      page: { limit: 2 },
      meta: {
        resource: "search",
        publication_id: PUBLICATION,
        schema_version: "1.0.0",
        sort: ["relevance", "stable_id"],
        filters: {},
        semantic_degraded: "disabled",
      },
    });
    expect(outcome.collection.page.next_cursor).toEqual(expect.any(String));
    expect(outcome.collection.page.next_cursor).not.toContain("Model");
    expect(outcome.collection.page.next_cursor).not.toContain(
      "Example Provider",
    );
    const encodedPayload = outcome.collection.page.next_cursor?.split(".")[0];
    expect(encodedPayload).toBeDefined();
    const payloadText = new TextDecoder().decode(
      Uint8Array.from(
        atob(
          (encodedPayload ?? "")
            .replaceAll("-", "+")
            .replaceAll("_", "/")
            .padEnd(Math.ceil((encodedPayload?.length ?? 0) / 4) * 4, "="),
        ),
        (character) => character.charCodeAt(0),
      ),
    );
    expect(payloadText).not.toContain("Model");
    expect(payloadText).not.toContain("Example Provider");
    expect(service.resolvePublicationV2).toHaveBeenCalledTimes(1);
    expect(service.readMergedExactSearchV2).toHaveBeenCalledTimes(1);
    expect(service.resolvePublicationV2).toHaveBeenCalledWith({
      version: 2,
      audience: "quantclarity-catalog-query-v1",
      environment: "test",
      requestedPublicationId: null,
      requiredAvailableUntilMs: (NOW + 900) * 1000,
    });
    expect(service.readMergedExactSearchV2.mock.calls[0]?.[0]).toMatchObject({
      version: 2,
      audience: "quantclarity-catalog-query-v1",
      environment: "test",
      bookmark: "bookmark-test-only",
      requiredAvailableUntilMs: (NOW + 900) * 1000,
      envelope: {
        publicationId: PUBLICATION,
        continuation: null,
        filters: {},
        sort: ["relevance", "stable_id"],
        limit: 2,
        searchPlan: {
          kind: "exact_structured",
          query: "Model",
          semanticCalls: 0,
          semanticCandidates: 0,
          semanticDegraded: "disabled",
        },
      },
    });
    const serialized = JSON.stringify(outcome);
    for (const privateField of [
      "bookmark-test-only",
      "tierMarker",
      "nextContinuation",
      "normalizedOrderingKey",
      "matchModes",
    ])
      expect(serialized).not.toContain(privateField);
  });

  it("consumes and reissues a bound cursor without extending its expiry", async () => {
    const firstCursor = await cursor({
      issuedAtSeconds: NOW - 100,
      expiresAtSeconds: NOW + 500,
    });
    const service = rpc({
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [
          row("exact-v1:n", "model", MODEL_B),
          row("exact-v1:p", "provider", PROVIDER),
        ],
        nextContinuation: {
          tierMarker: "exact-v1:p",
          resourceId: PROVIDER,
        },
        semanticDegraded: "disabled",
      },
    });
    const outcome = await execute(
      service,
      request(`q=Model&cursor=${encodeURIComponent(firstCursor)}`),
    );
    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    expect(service.resolvePublicationV2).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedPublicationId: PUBLICATION,
        requiredAvailableUntilMs: (NOW + 500) * 1000,
      }),
    );
    expect(service.readMergedExactSearchV2.mock.calls[0]?.[0]).toMatchObject({
      requiredAvailableUntilMs: (NOW + 500) * 1000,
      envelope: {
        limit: 2,
        publicationId: PUBLICATION,
        continuation: {
          lastSortTuple: ["exact-v1:r", VARIANT],
          stableId: VARIANT,
        },
      },
    });
    const next = outcome.collection.page.next_cursor;
    expect(next).not.toBeNull();
    const verified = await verifyCursor(
      next ?? "",
      keyring,
      NOW,
      30,
      crypto.subtle,
    );
    expect(verified).toMatchObject({ success: true });
    if (verified.success) {
      expect(verified.payload.issuedAtSeconds).toBe(NOW - 100);
      expect(verified.payload.expiresAtSeconds).toBe(NOW + 500);
      expect(verified.payload.lastSortTuple).toEqual(["exact-v1:p", PROVIDER]);
    }
  });

  it("accepts the next verification key and reissues with the current key", async () => {
    const oldOnly: CursorKeyring = { current: oldKey, next: null };
    const oldCursor = await cursor({ keyring: oldOnly });
    const service = rpc({
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [
          row("exact-v1:n", "model", MODEL_B),
          row("exact-v1:p", "provider", PROVIDER),
        ],
        nextContinuation: {
          tierMarker: "exact-v1:p",
          resourceId: PROVIDER,
        },
        semanticDegraded: "disabled",
      },
    });
    const outcome = await execute(
      service,
      request(`q=Model&cursor=${encodeURIComponent(oldCursor)}`),
    );
    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    const next = outcome.collection.page.next_cursor ?? "";
    await expect(
      verifyCursor(
        next,
        { current: currentKey, next: null },
        NOW,
        30,
        crypto.subtle,
      ),
    ).resolves.toMatchObject({ success: true });
    await expect(
      verifyCursor(next, oldOnly, NOW, 30, crypto.subtle),
    ).resolves.toEqual({ success: false, reason: "invalid" });
  });

  it("fails closed on tampered, expired, future, and structurally wrong cursors before RPC", async () => {
    const valid = await cursor();
    const tampered = `${valid.slice(0, -1)}${valid.endsWith("A") ? "B" : "A"}`;
    const expired = await cursor({
      issuedAtSeconds: NOW - 900,
      expiresAtSeconds: NOW - 1,
    });
    const future = await cursor({
      issuedAtSeconds: NOW + 31,
      expiresAtSeconds: NOW + 900,
    });
    const wrongTuple = await cursor({
      marker: "exact-v1:p",
      stableId: MODEL_A,
    });
    for (const token of [tampered, expired, future, wrongTuple]) {
      const service = rpc();
      await expect(
        execute(
          service,
          request(`q=Model&cursor=${encodeURIComponent(token)}`),
        ),
      ).resolves.toEqual({ success: false, code: "invalid_cursor" });
      expect(service.resolvePublicationV2).not.toHaveBeenCalled();
      expect(service.readMergedExactSearchV2).not.toHaveBeenCalled();
    }
  });

  it("binds query, filter, sort, limit, and publication resubmissions", async () => {
    const bound = await cursor({
      filters: { record_type: "model" },
      publicationId: PUBLICATION,
      marker: "exact-v1:c",
      stableId: MODEL_A,
    });
    const changedRequests = [
      request(`q=Other&cursor=${encodeURIComponent(bound)}`),
      request(
        `q=Model&record_type=variant&cursor=${encodeURIComponent(bound)}`,
      ),
      request(
        `q=Model&record_type=model&limit=3&cursor=${encodeURIComponent(bound)}`,
      ),
      request(
        `q=Model&record_type=model&cursor=${encodeURIComponent(bound)}`,
        OTHER_PUBLICATION,
      ),
    ];
    for (const candidate of changedRequests) {
      const service = rpc();
      await expect(execute(service, candidate)).resolves.toEqual({
        success: false,
        code: "invalid_cursor",
      });
      expect(service.resolvePublicationV2).not.toHaveBeenCalled();
    }

    const changedSort = rpc();
    await expect(
      execute(
        changedSort,
        request(
          `q=Model&record_type=model&sort=stable_id&cursor=${encodeURIComponent(bound)}`,
        ),
      ),
    ).resolves.toEqual({ success: false, code: "invalid_input" });
    expect(changedSort.resolvePublicationV2).not.toHaveBeenCalled();

    const inherited = rpc({
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [row("exact-v1:c", "model", MODEL_B)],
        nextContinuation: null,
        semanticDegraded: "disabled",
      },
    });
    await expect(
      execute(
        inherited,
        request(`q=Model&cursor=${encodeURIComponent(bound)}`),
      ),
    ).resolves.toMatchObject({ success: true });
    expect(inherited.readMergedExactSearchV2.mock.calls[0]?.[0]).toMatchObject({
      envelope: {
        filters: { record_type: "model" },
        limit: 2,
      },
    });
  });

  it("binds one stable provider eligibility filter without changing model facts or order", async () => {
    const service = rpc({
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [row("exact-v1:c", "model", MODEL_A)],
        nextContinuation: null,
        semanticDegraded: "disabled",
      },
    });
    const outcome = await execute(
      service,
      request(`q=Model&provider=${PROVIDER}&limit=2`),
    );
    expect(outcome).toMatchObject({
      success: true,
      collection: {
        data: [{ resource_type: "model", resource_id: MODEL_A }],
        meta: {
          filters: { provider: PROVIDER },
          semantic_degraded: "disabled",
        },
      },
    });
    expect(service.readMergedExactSearchV2.mock.calls[0]?.[0]).toMatchObject({
      envelope: {
        filters: { provider: PROVIDER },
        searchPlan: { filters: { provider: PROVIDER } },
      },
    });

    const bound = await cursor({
      filters: { provider: PROVIDER },
      marker: "exact-v1:c",
      stableId: MODEL_A,
    });
    const inherited = rpc({
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [],
        nextContinuation: null,
        semanticDegraded: "disabled",
      },
    });
    await expect(
      execute(
        inherited,
        request(`q=Model&cursor=${encodeURIComponent(bound)}`),
      ),
    ).resolves.toMatchObject({ success: true });
    expect(inherited.readMergedExactSearchV2.mock.calls[0]?.[0]).toMatchObject({
      envelope: { filters: { provider: PROVIDER } },
    });

    const changed = rpc();
    await expect(
      execute(
        changed,
        request(
          `q=Model&provider=${OTHER_PROVIDER}&cursor=${encodeURIComponent(bound)}`,
        ),
      ),
    ).resolves.toEqual({ success: false, code: "invalid_cursor" });
    expect(changed.resolvePublicationV2).not.toHaveBeenCalled();
  });

  it("rejects incompatible, malformed, unsupported, and provider-result filter shapes before effects", async () => {
    const malformed = [
      { ...request(), filters: { provider: "example-provider" } },
      {
        ...request(),
        filters: { provider: PROVIDER, record_type: "provider" },
      },
      { ...request(), filters: { status: "active" } },
      { ...request(), sort: ["stable_id"] },
      { ...request(), visitorPayload: "VISITOR_INPUT_CANARY" },
    ] as unknown as NormalizedRequest[];
    for (const candidate of malformed) {
      const service = rpc();
      await expect(execute(service, candidate)).resolves.toEqual({
        success: false,
        code: "invalid_input",
      });
      expect(service.resolvePublicationV2).not.toHaveBeenCalled();
      expect(service.readMergedExactSearchV2).not.toHaveBeenCalled();
    }

    const providerMarkerCursor = await cursor({
      filters: { provider: PROVIDER },
      marker: "exact-v1:p",
      stableId: PROVIDER,
    });
    const inheritedUnsupported = rpc();
    await expect(
      execute(
        inheritedUnsupported,
        request(`q=Model&cursor=${encodeURIComponent(providerMarkerCursor)}`),
      ),
    ).resolves.toEqual({ success: false, code: "invalid_cursor" });
    expect(inheritedUnsupported.resolvePublicationV2).not.toHaveBeenCalled();
    expect(inheritedUnsupported.readMergedExactSearchV2).not.toHaveBeenCalled();

    const providerResult = rpc({
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [row("exact-v1:p", "provider", PROVIDER)],
        nextContinuation: null,
        semanticDegraded: "disabled",
      },
    });
    await expect(
      execute(providerResult, request(`q=Model&provider=${PROVIDER}&limit=2`)),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });

  it("marks explicit provider-only search not applicable and mirrors it on every result", async () => {
    const service = rpc({
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [row("exact-v1:p", "provider", PROVIDER)],
        nextContinuation: null,
        semanticDegraded: "not_applicable",
      },
    });
    const outcome = await execute(
      service,
      request("q=Example&record_type=provider"),
    );
    expect(outcome).toEqual({
      success: true,
      collection: {
        data: [
          {
            resource_type: "provider",
            resource_id: PROVIDER,
            display_name: row("exact-v1:p", "provider", PROVIDER).displayName,
            match_kind: "provider_name",
            semantic_degraded: "not_applicable",
          },
        ],
        page: { next_cursor: null, limit: 20 },
        meta: {
          resource: "search",
          publication_id: PUBLICATION,
          schema_version: "1.0.0",
          sort: ["relevance", "stable_id"],
          filters: { record_type: "provider" },
          semantic_degraded: "not_applicable",
        },
      },
    });
  });

  it("rejects descending IDs even when display-name order is ascending", async () => {
    const alpha = row("exact-v1:c", "model", MODEL_B);
    const beta = row("exact-v1:c", "model", MODEL_A);
    const service = rpc({
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [
          { ...alpha, displayName: { ...alpha.displayName, value: "Alpha" } },
          { ...beta, displayName: { ...beta.displayName, value: "Beta" } },
        ],
        nextContinuation: null,
        semanticDegraded: "disabled",
      },
    });
    await expect(execute(service)).resolves.toEqual({
      success: false,
      code: "integrity_failure",
    });
  });

  it("rejects RPC pages that regress or replay the authenticated continuation", async () => {
    const rawCursor = await cursor({
      marker: "exact-v1:r",
      stableId: VARIANT,
    });
    const continuedRequest = request(
      `q=Model&cursor=${encodeURIComponent(rawCursor)}`,
    );
    const pages = [
      {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results: [row("exact-v1:c", "model", MODEL_A)],
          nextContinuation: null,
          semanticDegraded: "disabled",
        },
      },
      {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results: [row("exact-v1:r", "variant", VARIANT)],
          nextContinuation: null,
          semanticDegraded: "disabled",
        },
      },
    ];
    for (const page of pages) {
      await expect(execute(rpc(page), continuedRequest)).resolves.toEqual({
        success: false,
        code: "integrity_failure",
      });
    }
  });

  it("rejects malformed, duplicate, misordered, mismatched, oversized, and leaky pages", async () => {
    const pages: unknown[] = [
      {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results: [
            row("exact-v1:r", "model", MODEL_A),
            row("exact-v1:c", "model", MODEL_B),
          ],
          nextContinuation: null,
          semanticDegraded: "disabled",
        },
      },
      {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results: [
            row("exact-v1:c", "model", MODEL_A),
            row("exact-v1:r", "model", MODEL_A),
          ],
          nextContinuation: null,
          semanticDegraded: "disabled",
        },
      },
      {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results: [row("exact-v1:p", "model", MODEL_A)],
          nextContinuation: null,
          semanticDegraded: "disabled",
        },
      },
      {
        outcome: "page",
        page: {
          publicationId: OTHER_PUBLICATION,
          results: [],
          nextContinuation: null,
          semanticDegraded: "disabled",
        },
      },
      {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results: [
            row("exact-v1:c", "model", MODEL_A),
            row("exact-v1:r", "variant", VARIANT),
          ],
          nextContinuation: {
            tierMarker: "exact-v1:c",
            resourceId: MODEL_A,
          },
          semanticDegraded: "disabled",
        },
      },
      {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results: [],
          nextContinuation: null,
          semanticDegraded: "not_applicable",
        },
      },
      {
        outcome: "page",
        page: {
          publicationId: PUBLICATION,
          results: [],
          nextContinuation: null,
          semanticDegraded: "disabled",
          visitorCanary: "VISITOR_INPUT_CANARY",
        },
      },
    ];
    for (const page of pages) {
      await expect(execute(rpc(page))).resolves.toEqual({
        success: false,
        code: "integrity_failure",
      });
    }

    const tooMany = rpc({
      outcome: "page",
      page: {
        publicationId: PUBLICATION,
        results: [
          row("exact-v1:c", "model", MODEL_A),
          row("exact-v1:c", "model", MODEL_B),
          row("exact-v1:r", "variant", VARIANT),
        ],
        nextContinuation: null,
        semanticDegraded: "disabled",
      },
    });
    await expect(execute(tooMany)).resolves.toEqual({
      success: false,
      code: "integrity_failure",
    });
  });

  it("fails closed on accessor/proxy inputs and accessor/proxy results", async () => {
    const accessor = { ...request() } as Record<string, unknown>;
    Object.defineProperty(accessor, "query", {
      enumerable: true,
      get: () => "VISITOR_INPUT_CANARY",
    });
    const service = rpc();
    await expect(
      execute(service, accessor as unknown as NormalizedRequest),
    ).resolves.toEqual({ success: false, code: "invalid_input" });
    expect(service.resolvePublicationV2).not.toHaveBeenCalled();

    const hostileInput = new Proxy(request(), {
      ownKeys: () => {
        throw new Error("VISITOR_INPUT_CANARY");
      },
    });
    await expect(execute(rpc(), hostileInput)).resolves.toEqual({
      success: false,
      code: "invalid_input",
    });

    const hostilePage = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("VISITOR_INPUT_CANARY");
        },
      },
    );
    await expect(execute(rpc(hostilePage))).resolves.toEqual({
      success: false,
      code: "integrity_failure",
    });
  });

  it("returns bounded static resolver/read failures without echoing exceptions", async () => {
    const expired = rpc(undefined, {
      outcome: "publication_expired",
      currentPublicationId: OTHER_PUBLICATION,
    });
    await expect(execute(expired)).resolves.toEqual({
      success: false,
      code: "publication_expired",
      currentPublicationId: OTHER_PUBLICATION,
    });
    expect(expired.readMergedExactSearchV2).not.toHaveBeenCalled();

    for (const code of [
      "publication_not_ready",
      "integrity_failure",
      "read_failure",
    ] as const) {
      const service = rpc(undefined, { outcome: code });
      await expect(execute(service)).resolves.toEqual({
        success: false,
        code,
      });
      expect(service.readMergedExactSearchV2).not.toHaveBeenCalled();
    }

    const throwing: MergedExactSearchCatalogQueryRpcV2 = {
      resolvePublicationV2: vi.fn(() =>
        Promise.reject(new Error("VISITOR_INPUT_CANARY")),
      ),
      readMergedExactSearchV2: vi.fn(),
    };
    const failure = await execute(throwing);
    expect(failure).toEqual({ success: false, code: "read_failure" });
    expect(JSON.stringify(failure)).not.toContain("VISITOR_INPUT_CANARY");

    for (const code of ["integrity_failure", "read_failure"] as const)
      await expect(execute(rpc({ outcome: code }))).resolves.toEqual({
        success: false,
        code,
      });
  });

  it("rejects resolver horizon disagreement and fresh-horizon overflow before reading", async () => {
    const mismatched = rpc(undefined, {
      outcome: "selected",
      publicationId: PUBLICATION,
      bookmark: "bookmark-test-only",
      requiredAvailableUntilMs: (NOW + 900) * 1000 + 1,
    });
    await expect(execute(mismatched)).resolves.toEqual({
      success: false,
      code: "integrity_failure",
    });
    expect(mismatched.readMergedExactSearchV2).not.toHaveBeenCalled();

    const overflow = rpc();
    await expect(
      execute(overflow, request(), { nowSeconds: Number.MAX_SAFE_INTEGER }),
    ).resolves.toEqual({ success: false, code: "invalid_input" });
    expect(overflow.resolvePublicationV2).not.toHaveBeenCalled();
    expect(overflow.readMergedExactSearchV2).not.toHaveBeenCalled();
  });
});
