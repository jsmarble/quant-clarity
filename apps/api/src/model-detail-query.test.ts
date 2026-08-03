import { describe, expect, it, vi } from "vitest";

import type { ApiLimits, NormalizedRequest } from "@quant-clarity/api-core";

import {
  readModelDetailFromQueryV1,
  type ModelDetailApiInput,
} from "./model-detail-query.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const OTHER_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const MODEL_ID = "mdl_11111111-1111-4111-8111-111111111111";
const OTHER_MODEL_ID = "mdl_22222222-2222-4222-8222-222222222222";
const FAMILY_ID = "fam_11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "evd_11111111-1111-4111-8111-111111111111";
const OBSERVED_AT = "2026-08-03T00:00:00.000Z";
const NOW_MS = 1_785_774_000_000;
const REQUIRED_UNTIL_MS = NOW_MS + 15 * 60 * 1000;

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

const known = (value: unknown) => ({
  evidence_ids: [EVIDENCE_ID],
  observed_at: OBSERVED_AT,
  state: "known",
  value,
});

const unknown = () => ({
  evidence_ids: [],
  observed_at: null,
  state: "unknown",
  value: null,
});

const model = (status = "active", modelId = MODEL_ID) => ({
  active_parameters: unknown(),
  architecture: unknown(),
  authoritative_checkpoint_ids: [],
  cataloged_provider_count: {
    derivation_version: "cataloged-provider-count@1",
    observed_at: OBSERVED_AT,
    value: 0,
  },
  checkpoints: [],
  context_window_tokens: unknown(),
  display_name: known("Fixture Model"),
  family_id: FAMILY_ID,
  last_model_data_refresh: known(OBSERVED_AT),
  license: unknown(),
  maximum_output_tokens: unknown(),
  modalities: unknown(),
  model_id: modelId,
  publisher: known("Fixture Publisher"),
  release_date: unknown(),
  slug: known("fixture-model"),
  source_quantization: unknown(),
  source_weight_format: unknown(),
  status: known(status),
  total_parameters: unknown(),
});

const detail = (status = "active", modelId = MODEL_ID) => ({
  data: model(status, modelId),
  meta: {
    filters: {},
    publication_id: PUBLICATION,
    resource: "models",
    schema_version: "1.11.0",
    sort: ["name", "stable_id"],
  },
});

const request = (
  publicationHeader: string | null = null,
  method: "GET" | "HEAD" = "GET",
): NormalizedRequest => ({
  cursor: null,
  filters: {},
  hasQueryString: false,
  limit: 25,
  limitProvided: false,
  method,
  operation: { identifier: MODEL_ID, kind: "detail", resourceType: "model" },
  publicationHeader,
  query: null,
  route: {
    operation: {
      identifier: MODEL_ID,
      kind: "detail",
      resourceType: "model",
    },
    policy: "models",
  },
  sort: ["name", "stable_id"],
  sortProvided: false,
});

const rpc = (
  readOutcome: unknown = {
    outcome: "model",
    model: model(),
    publicationId: PUBLICATION,
    schemaVersion: "1.11.0",
  },
  resolution?: unknown,
) => ({
  resolvePublicationV2: vi.fn((inputValue: unknown) => {
    const input = inputValue as { requiredAvailableUntilMs: number };
    return Promise.resolve(
      resolution ?? {
        bookmark: "bookmark-model-detail",
        outcome: "selected",
        publicationId: PUBLICATION,
        requiredAvailableUntilMs: input.requiredAvailableUntilMs,
      },
    );
  }),
  readModelDetailV1: vi.fn(() => Promise.resolve(readOutcome)),
});

const execute = (
  service: ReturnType<typeof rpc>,
  overrides: Partial<ModelDetailApiInput> = {},
) =>
  readModelDetailFromQueryV1({
    environment: "test",
    limits,
    nowMs: NOW_MS,
    request: request(),
    service,
    ...overrides,
  });

describe("stable-ID Model detail API/query seam", () => {
  it("pins the fresh horizon and bookmark through one closed detail read", async () => {
    const service = rpc();
    const outcome = await execute(service);
    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    expect(outcome.detail).toEqual(detail());
    expect(
      JSON.parse(new TextDecoder().decode(outcome.representationBytes)),
    ).toEqual(detail());
    expect(service.resolvePublicationV2).toHaveBeenCalledWith({
      audience: "quantclarity-catalog-query-v1",
      environment: "test",
      requestedPublicationId: null,
      requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
      version: 2,
    });
    expect(service.readModelDetailV1).toHaveBeenCalledWith({
      audience: "quantclarity-catalog-query-v1",
      bookmark: "bookmark-model-detail",
      environment: "test",
      requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
      version: 1,
      envelope: {
        audience: "quantclarity-catalog-query-v1",
        continuation: null,
        environment: "test",
        filters: {},
        limit: 25,
        operation: {
          identifier: MODEL_ID,
          kind: "detail",
          resourceType: "model",
        },
        publicationId: PUBLICATION,
        searchPlan: null,
        sort: ["name", "stable_id"],
        version: 1,
      },
    });
  });

  it.each(["inactive", "unavailable"])(
    "returns a contract-valid %s Model instead of treating status as absence",
    async (status) => {
      const outcome = await execute(
        rpc({
          outcome: "model",
          model: model(status),
          publicationId: PUBLICATION,
          schemaVersion: "1.11.0",
        }),
      );
      expect(outcome.success).toBe(true);
      if (!outcome.success) return;
      expect(outcome.detail.data.status).toEqual(known(status));
    },
  );

  it("accepts explicit unknown facts and HEAD as the same read seam", async () => {
    const source = { ...model(), status: unknown() };
    const outcome = await execute(
      rpc({
        outcome: "model",
        model: source,
        publicationId: PUBLICATION,
        schemaVersion: "1.11.0",
      }),
      {
        request: request(null, "HEAD"),
      },
    );
    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    expect(outcome.detail.data.status).toEqual(unknown());
  });

  it.each([
    ["integrity_failure", { outcome: "integrity_failure" }],
    [
      "not_found",
      {
        outcome: "not_found",
        publicationId: PUBLICATION,
        schemaVersion: "1.11.0",
      },
    ],
    ["read_failure", { outcome: "read_failure" }],
  ] as const)(
    "preserves the static reader %s outcome",
    async (code, readerOutcome) => {
      await expect(execute(rpc(readerOutcome))).resolves.toEqual({
        code,
        success: false,
      });
    },
  );

  it.each([
    ["integrity_failure", { outcome: "integrity_failure" }],
    ["publication_not_ready", { outcome: "publication_not_ready" }],
    ["read_failure", { outcome: "read_failure" }],
  ] as const)("preserves the resolver %s outcome", async (code, resolution) => {
    const service = rpc(undefined, resolution);
    await expect(execute(service)).resolves.toEqual({ code, success: false });
    expect(service.readModelDetailV1).not.toHaveBeenCalled();
  });

  it("preserves an expired publication and rejects a selected pin mismatch", async () => {
    await expect(
      execute(
        rpc(undefined, {
          currentPublicationId: OTHER_PUBLICATION,
          outcome: "publication_expired",
        }),
      ),
    ).resolves.toEqual({
      code: "publication_expired",
      currentPublicationId: OTHER_PUBLICATION,
      success: false,
    });

    const mismatch = rpc(undefined, {
      bookmark: "bookmark-model-detail",
      outcome: "selected",
      publicationId: PUBLICATION,
      requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
    });
    await expect(
      execute(mismatch, { request: request(OTHER_PUBLICATION) }),
    ).resolves.toEqual({ code: "integrity_failure", success: false });
    expect(mismatch.readModelDetailV1).not.toHaveBeenCalled();
  });

  it.each([
    [
      "model",
      {
        outcome: "model",
        model: model(),
        publicationId: OTHER_PUBLICATION,
        schemaVersion: "1.11.0",
      },
    ],
    [
      "not-found",
      {
        outcome: "not_found",
        publicationId: OTHER_PUBLICATION,
        schemaVersion: "1.11.0",
      },
    ],
  ])("rejects a cross-publication %s reader outcome", async (_label, value) => {
    await expect(execute(rpc(value))).resolves.toEqual({
      code: "integrity_failure",
      success: false,
    });
  });

  it("turns resolver and read exceptions into static read failures", async () => {
    const resolverFailure = rpc();
    resolverFailure.resolvePublicationV2.mockRejectedValueOnce(
      new Error("private resolver detail"),
    );
    await expect(execute(resolverFailure)).resolves.toEqual({
      code: "read_failure",
      success: false,
    });

    const readFailure = rpc();
    readFailure.readModelDetailV1.mockRejectedValueOnce(
      new Error("private reader detail"),
    );
    await expect(execute(readFailure)).resolves.toEqual({
      code: "read_failure",
      success: false,
    });
  });

  it.each([
    [
      "wrong Model ID",
      {
        outcome: "model",
        model: model("active", OTHER_MODEL_ID),
        publicationId: PUBLICATION,
        schemaVersion: "1.11.0",
      },
    ],
    [
      "unknown Model field",
      {
        outcome: "model",
        model: { ...model(), visitor_id: "bad" },
        publicationId: PUBLICATION,
        schemaVersion: "1.11.0",
      },
    ],
    [
      "malformed Fact",
      {
        outcome: "model",
        model: { ...model(), display_name: { state: "known" } },
        publicationId: PUBLICATION,
        schemaVersion: "1.11.0",
      },
    ],
    [
      "invalid schema version",
      {
        outcome: "model",
        model: model(),
        publicationId: PUBLICATION,
        schemaVersion: "latest",
      },
    ],
    [
      "missing schema version",
      { outcome: "model", model: model(), publicationId: PUBLICATION },
    ],
    [
      "extra reader field",
      {
        outcome: "model",
        model: model(),
        publicationId: PUBLICATION,
        schemaVersion: "1.11.0",
        visitor_id: "bad",
      },
    ],
    [
      "not-found missing schema version",
      { outcome: "not_found", publicationId: PUBLICATION },
    ],
    [
      "not-found invalid schema version",
      {
        outcome: "not_found",
        publicationId: PUBLICATION,
        schemaVersion: "latest",
      },
    ],
    [
      "not-found extra reader field",
      {
        outcome: "not_found",
        publicationId: PUBLICATION,
        schemaVersion: "1.11.0",
        visitor_id: "bad",
      },
    ],
    [
      "unknown outcome",
      {
        outcome: "partial",
        model: model(),
        publicationId: PUBLICATION,
        schemaVersion: "1.11.0",
      },
    ],
  ])("rejects hostile detail output: %s", async (_label, value) => {
    await expect(execute(rpc(value))).resolves.toEqual({
      code: "integrity_failure",
      success: false,
    });
  });

  it("rejects accessors and proxy traps without invoking an accessor", async () => {
    const getter = vi.fn(() => model());
    const response = {
      outcome: "model",
      publicationId: PUBLICATION,
      schemaVersion: "1.11.0",
    } as Record<string, unknown>;
    Object.defineProperty(response, "model", {
      enumerable: true,
      get: getter,
    });
    await expect(execute(rpc(response))).resolves.toEqual({
      code: "integrity_failure",
      success: false,
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
      code: "integrity_failure",
      success: false,
    });
  });

  it.each(["model", "not_found"] as const)(
    "rejects an oversized schema version on a %s outcome",
    async (outcome) => {
      const schemaVersion = `${"1".repeat(600)}.11.0`;
      const value =
        outcome === "model"
          ? {
              outcome,
              model: model(),
              publicationId: PUBLICATION,
              schemaVersion,
            }
          : { outcome, publicationId: PUBLICATION, schemaVersion };
      await expect(execute(rpc(value))).resolves.toEqual({
        code: "integrity_failure",
        success: false,
      });
    },
  );

  it.each(["1.11.0-rc.1", "1.11.0+build"])(
    "rejects non-canonical schema version %s for model and not-found outcomes",
    async (schemaVersion) => {
      for (const value of [
        {
          outcome: "model",
          model: model(),
          publicationId: PUBLICATION,
          schemaVersion,
        },
        { outcome: "not_found", publicationId: PUBLICATION, schemaVersion },
      ])
        await expect(execute(rpc(value))).resolves.toEqual({
          code: "integrity_failure",
          success: false,
        });
    },
  );

  it("rejects a many-key RPC result before inspecting property values", async () => {
    const getter = vi.fn(() => "must not be read");
    const response: Record<string, unknown> = {
      outcome: "model",
      model: model(),
      publicationId: PUBLICATION,
      schemaVersion: "1.11.0",
    };
    for (let index = 0; index < 10_000; index += 1)
      Object.defineProperty(response, `unexpected_${String(index)}`, {
        enumerable: true,
        get: getter,
      });

    await expect(execute(rpc(response))).resolves.toEqual({
      code: "integrity_failure",
      success: false,
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects a huge hostile key before sorting and a huge string before UTF-8 allocation", async () => {
    const hugeKeyResult: Record<string, unknown> = {
      model: model(),
      publicationId: PUBLICATION,
      schemaVersion: "1.11.0",
    };
    Object.defineProperty(hugeKeyResult, `outcome${"a".repeat(100_000)}`, {
      enumerable: true,
      value: "model",
    });
    await expect(execute(rpc(hugeKeyResult))).resolves.toEqual({
      code: "integrity_failure",
      success: false,
    });

    const hugeStringModel = model();
    hugeStringModel.display_name.value = "a".repeat(1_000_000);
    await expect(
      execute(
        rpc({
          outcome: "model",
          model: hugeStringModel,
          publicationId: PUBLICATION,
          schemaVersion: "1.11.0",
        }),
      ),
    ).resolves.toEqual({ code: "integrity_failure", success: false });
  });

  it("preserves and rejects own enumerable __proto__ data properties at top-level and nested boundaries", async () => {
    const topLevel: Record<string, unknown> = {
      outcome: "model",
      model: model(),
      publicationId: PUBLICATION,
      schemaVersion: "1.11.0",
    };
    Object.defineProperty(topLevel, "__proto__", {
      enumerable: true,
      value: { polluted: true },
    });
    await expect(execute(rpc(topLevel))).resolves.toEqual({
      code: "integrity_failure",
      success: false,
    });

    const nested = model() as Record<string, unknown>;
    Object.defineProperty(nested, "__proto__", {
      enumerable: true,
      value: { polluted: true },
    });
    await expect(
      execute(
        rpc({
          outcome: "model",
          model: nested,
          publicationId: PUBLICATION,
          schemaVersion: "1.11.0",
        }),
      ),
    ).resolves.toEqual({ code: "integrity_failure", success: false });
  });

  it("detaches accepted nested Model data from later upstream mutation", async () => {
    const source = model();
    const outcome = await execute(
      rpc({
        outcome: "model",
        model: source,
        publicationId: PUBLICATION,
        schemaVersion: "1.11.0",
      }),
    );
    expect(outcome.success).toBe(true);
    if (!outcome.success) return;
    source.display_name.value = "Mutated";
    expect(outcome.detail.data.display_name).toEqual(known("Fixture Model"));
    expect(outcome.detail.meta.sort).toEqual(["name", "stable_id"]);
  });

  it("accepts the exact representation-byte ceiling and rejects one byte less", async () => {
    const baseline = await execute(rpc());
    expect(baseline.success).toBe(true);
    if (!baseline.success) return;
    const exact = baseline.representationBytes.byteLength;
    await expect(
      execute(rpc(), { limits: { ...limits, maxResponseBytes: exact } }),
    ).resolves.toMatchObject({ success: true });
    await expect(
      execute(rpc(), { limits: { ...limits, maxResponseBytes: exact - 1 } }),
    ).resolves.toEqual({ code: "integrity_failure", success: false });
  });

  it.each([
    [
      "slug",
      {
        operation: {
          identifier: "fixture-model",
          kind: "detail",
          resourceType: "model",
        },
      },
    ],
    ["query string", { hasQueryString: true }],
    ["filter", { filters: { status: "active" } }],
    ["cursor", { cursor: "opaque" }],
    ["wrong sort", { sort: ["stable_id"] }],
    [
      "wrong route policy",
      { route: { ...request().route, policy: "variants" } },
    ],
  ])(
    "rejects a normalized-request %s violation before RPC",
    async (_label, change) => {
      const service = rpc();
      await expect(
        execute(service, {
          request: { ...request(), ...change } as NormalizedRequest,
        }),
      ).resolves.toEqual({ code: "invalid_input", success: false });
      expect(service.resolvePublicationV2).not.toHaveBeenCalled();
      expect(service.readModelDetailV1).not.toHaveBeenCalled();
    },
  );

  it("rejects request accessors before RPC without invoking them", async () => {
    const service = rpc();
    const hostile = { ...request() } as Record<string, unknown>;
    const getter = vi.fn(() => ({}));
    Object.defineProperty(hostile, "filters", {
      enumerable: true,
      get: getter,
    });
    await expect(
      execute(service, { request: hostile as unknown as NormalizedRequest }),
    ).resolves.toEqual({ code: "invalid_input", success: false });
    expect(getter).not.toHaveBeenCalled();
    expect(service.resolvePublicationV2).not.toHaveBeenCalled();
  });
});
