import { describe, expect, it, vi } from "vitest";

import type { ApiLimits, NormalizedRequest } from "@quant-clarity/api-core";
import type { DatasetMetadata } from "@quant-clarity/contracts";

import {
  readDatasetMetadataFromQueryV1,
  type DatasetMetadataApiInput,
} from "./dataset-metadata-query.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const OTHER_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const NOW_MS = 1_785_687_200_000;
const REQUIRED_UNTIL_MS = NOW_MS + 15 * 60 * 1000;
const DISPOSE_SYMBOL = (Symbol as unknown as { readonly dispose: symbol })
  .dispose;

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
  maxResponseBytes: 65_536,
  maxSearchQueryBytes: 200,
  maxSearchResults: 20,
  maxSemanticCalls: 0,
  maxSemanticCandidates: 0,
  maxSubrequests: 4,
  maxUpstreamCalls: 2,
  maxUrlBytes: 8192,
};

const request = (
  publicationHeader: string | null = null,
): NormalizedRequest => ({
  cursor: null,
  filters: {},
  hasQueryString: false,
  limit: 25,
  limitProvided: false,
  method: "GET",
  operation: { kind: "metadata" },
  publicationHeader,
  query: null,
  route: { operation: { kind: "metadata" }, policy: null },
  sort: [],
  sortProvided: false,
});

const metadata = (): DatasetMetadata => ({
  publication_id: PUBLICATION,
  schema_version: "1.0.0",
  api_version: "1",
  methodology_version: "1.0.0",
  methodology_effective_at: "2026-08-01T00:00:00.000Z",
  methodology_url: "https://api.example.test/v1/methodologies/1.0.0",
  precision_normalization_version: "precision-normalization@1",
  precision_display_order_version: "precision-display-order@1",
  price_policy_version: "price-policy@1",
  published_at: "2026-08-01T01:00:00.000Z",
  generated_at: "2026-08-01T00:30:00.000Z",
  next_refresh_window: {
    starts_at: "2026-08-02T00:00:00.000Z",
    ends_at: "2026-08-02T01:00:00.000Z",
  },
  counts: {
    active_models: 2,
    active_offerings: 3,
    active_providers: 1,
  },
  degradation_notices: ["One or more enabled provider slices are stale."],
});

const rpc = (
  readOutcome: unknown = { outcome: "metadata", metadata: metadata() },
  resolution?: unknown,
) => ({
  resolvePublicationV2: vi.fn((inputValue: unknown) => {
    const input = inputValue as { requiredAvailableUntilMs: number };
    return Promise.resolve(
      resolution ?? {
        outcome: "selected",
        publicationId: PUBLICATION,
        bookmark: "bookmark-test-only",
        requiredAvailableUntilMs: input.requiredAvailableUntilMs,
      },
    );
  }),
  readDatasetMetadataV1: vi.fn(() => Promise.resolve(readOutcome)),
});

const execute = (
  service: ReturnType<typeof rpc>,
  overrides: Partial<DatasetMetadataApiInput> = {},
) =>
  readDatasetMetadataFromQueryV1({
    environment: "test",
    limits,
    nowMs: NOW_MS,
    request: request(),
    service,
    ...overrides,
  });

describe("dataset metadata API/query seam (META-001–META-004, API-003, API-005)", () => {
  it("pins one publication horizon and bookmark across both RPC calls", async () => {
    const service = rpc();
    const outcome = await execute(service);
    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    expect(outcome.metadata).toEqual(metadata());
    expect(
      JSON.parse(new TextDecoder().decode(outcome.representationBytes)),
    ).toEqual(metadata());
    expect(service.resolvePublicationV2).toHaveBeenCalledWith({
      version: 2,
      audience: "quantclarity-catalog-query-v1",
      environment: "test",
      requestedPublicationId: null,
      requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
    });
    expect(service.readDatasetMetadataV1).toHaveBeenCalledWith({
      version: 1,
      audience: "quantclarity-catalog-query-v1",
      environment: "test",
      bookmark: "bookmark-test-only",
      requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
      envelope: {
        version: 1,
        audience: "quantclarity-catalog-query-v1",
        environment: "test",
        operation: { kind: "metadata" },
        publicationId: PUBLICATION,
        filters: {},
        sort: [],
        limit: 25,
        continuation: null,
        searchPlan: null,
      },
    });
  });

  it("accepts the non-enumerable disposal hook added to JSRPC results", async () => {
    const resolution = {
      outcome: "selected",
      publicationId: PUBLICATION,
      bookmark: "bookmark-test-only",
      requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
    };
    const readOutcome = { outcome: "metadata", metadata: metadata() };
    for (const value of [resolution, readOutcome])
      Object.defineProperty(value, DISPOSE_SYMBOL, {
        configurable: true,
        enumerable: false,
        value: () => undefined,
        writable: true,
      });

    await expect(execute(rpc(readOutcome, resolution))).resolves.toMatchObject({
      success: true,
      publicationId: PUBLICATION,
    });
  });

  it("rejects unknown symbolic properties on query results", async () => {
    const resolution = {
      outcome: "publication_not_ready",
    };
    Object.defineProperty(resolution, Symbol("unexpected"), {
      enumerable: false,
      value: () => undefined,
    });

    await expect(execute(rpc(undefined, resolution))).resolves.toEqual({
      success: false,
      code: "integrity_failure",
    });
  });

  it("propagates an exact pin and rejects resolver substitution", async () => {
    const pinned = rpc();
    const success = await execute(pinned, { request: request(PUBLICATION) });
    expect(success.success).toBe(true);
    expect(pinned.resolvePublicationV2).toHaveBeenCalledWith(
      expect.objectContaining({ requestedPublicationId: PUBLICATION }),
    );

    const substituted = rpc(undefined, {
      outcome: "selected",
      publicationId: OTHER_PUBLICATION,
      bookmark: "bookmark-test-only",
      requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
    });
    await expect(
      execute(substituted, { request: request(PUBLICATION) }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
    expect(substituted.readDatasetMetadataV1).not.toHaveBeenCalled();
  });

  it.each([
    ["publication_not_ready", { outcome: "publication_not_ready" }],
    ["integrity_failure", { outcome: "integrity_failure" }],
    ["read_failure", { outcome: "read_failure" }],
  ] as const)("preserves the resolver %s outcome", async (code, resolution) => {
    const service = rpc(undefined, resolution);
    await expect(execute(service)).resolves.toEqual({ success: false, code });
    expect(service.readDatasetMetadataV1).not.toHaveBeenCalled();
  });

  it("preserves an expired pin and its validated current publication", async () => {
    const service = rpc(undefined, {
      outcome: "publication_expired",
      currentPublicationId: OTHER_PUBLICATION,
    });
    await expect(execute(service)).resolves.toEqual({
      success: false,
      code: "publication_expired",
      currentPublicationId: OTHER_PUBLICATION,
    });
  });

  it.each(["integrity_failure", "read_failure"] as const)(
    "preserves the metadata reader %s outcome",
    async (code) => {
      await expect(execute(rpc({ outcome: code }))).resolves.toEqual({
        success: false,
        code,
      });
    },
  );

  it("turns RPC exceptions into static read failures", async () => {
    const resolverFailure = rpc();
    resolverFailure.resolvePublicationV2.mockRejectedValueOnce(
      new Error("private resolver detail"),
    );
    await expect(execute(resolverFailure)).resolves.toEqual({
      success: false,
      code: "read_failure",
    });

    const readFailure = rpc();
    readFailure.readDatasetMetadataV1.mockRejectedValueOnce(
      new Error("private read detail"),
    );
    await expect(execute(readFailure)).resolves.toEqual({
      success: false,
      code: "read_failure",
    });
  });

  it.each([
    [
      "publication mismatch",
      { ...metadata(), publication_id: OTHER_PUBLICATION },
    ],
    ["unknown field", { ...metadata(), visitor_id: "forbidden" }],
    ["invalid timestamp", { ...metadata(), published_at: "tomorrow" }],
    [
      "generated after publication",
      { ...metadata(), generated_at: "2026-08-01T01:00:00.001Z" },
    ],
    [
      "inverted refresh window",
      {
        ...metadata(),
        next_refresh_window: {
          starts_at: "2026-08-02T01:00:00.000Z",
          ends_at: "2026-08-02T00:00:00.000Z",
        },
      },
    ],
    [
      "non-HTTPS methodology",
      {
        ...metadata(),
        methodology_url: "http://api.example.test/v1/methodologies/1.0.0",
      },
    ],
    [
      "wrong methodology path",
      {
        ...metadata(),
        methodology_url: "https://api.example.test/v1/methodologies/2.0.0",
      },
    ],
    [
      "invalid count",
      {
        ...metadata(),
        counts: { ...metadata().counts, active_models: -1 },
      },
    ],
    [
      "unpaired Unicode surrogate",
      {
        ...metadata(),
        degradation_notices: ["invalid\ud800"],
      },
    ],
    [
      "dynamic notice",
      {
        ...metadata(),
        degradation_notices: ["Provider example is stale."],
      },
    ],
    [
      "duplicate notice",
      {
        ...metadata(),
        degradation_notices: [
          "One or more enabled provider slices are stale.",
          "One or more enabled provider slices are stale.",
        ],
      },
    ],
    [
      "unsorted notices",
      {
        ...metadata(),
        degradation_notices: [
          "One or more enabled provider slices are unavailable.",
          "One or more enabled provider slices are stale.",
        ],
      },
    ],
  ])("rejects hostile metadata: %s", async (_label, value) => {
    await expect(
      execute(rpc({ outcome: "metadata", metadata: value })),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });

  it("rejects accessors and proxy traps without invoking attacker code", async () => {
    const getter = vi.fn(() => metadata());
    const response = { outcome: "metadata" } as Record<string, unknown>;
    Object.defineProperty(response, "metadata", {
      enumerable: true,
      get: getter,
    });
    await expect(execute(rpc(response))).resolves.toEqual({
      success: false,
      code: "integrity_failure",
    });
    expect(getter).not.toHaveBeenCalled();

    const proxy = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("private proxy detail");
        },
      },
    );
    await expect(execute(rpc(proxy))).resolves.toEqual({
      success: false,
      code: "integrity_failure",
    });
  });

  it("detaches accepted metadata from later upstream mutation", async () => {
    const source = metadata();
    const outcome = await execute(
      rpc({ outcome: "metadata", metadata: source }),
    );
    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    source.counts.active_models = 999;
    source.degradation_notices.push("mutated");
    expect(outcome.metadata.counts.active_models).toBe(2);
    expect(outcome.metadata.degradation_notices).toEqual([
      "One or more enabled provider slices are stale.",
    ]);
  });

  it("enforces the injected representation byte ceiling", async () => {
    await expect(
      execute(rpc(), { limits: { ...limits, maxResponseBytes: 1 } }),
    ).resolves.toEqual({ success: false, code: "integrity_failure" });
  });

  it("rejects malformed internal requests before RPC", async () => {
    const service = rpc();
    await expect(
      execute(service, {
        request: { ...request(), hasQueryString: true },
      }),
    ).resolves.toEqual({ success: false, code: "invalid_input" });
    expect(service.resolvePublicationV2).not.toHaveBeenCalled();
  });
});
