import { describe, expect, it, vi } from "vitest";

import type { ApiLimits, NormalizedRequest } from "@quant-clarity/api-core";

import {
  executeAfterModelDetailPublicationResolutionV2,
  readModelDetailFromQueryV2,
  type ModelDetailApiV2Input,
  type ModelDetailApiV2Outcome,
  type ResolvedModelDetailReadV2,
} from "./model-detail-query.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const MODEL_ID = "mdl_11111111-1111-4111-8111-111111111111";
const FAMILY_ID = "fam_11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "evd_11111111-1111-4111-8111-111111111111";
const CURRENT_SLUG = "fixture-model";
const HISTORICAL_SLUG = "former-fixture-model";
const OBSERVED_AT = "2026-08-03T00:00:00.000Z";
const NOW_MS = 1_785_774_000_000;
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

const model = () => ({
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
  model_id: MODEL_ID,
  publisher: known("Fixture Publisher"),
  release_date: unknown(),
  slug: known(CURRENT_SLUG),
  source_quantization: unknown(),
  source_weight_format: unknown(),
  status: known("active"),
  total_parameters: unknown(),
});

const request = (identifier: string): NormalizedRequest => ({
  cursor: null,
  filters: {},
  hasQueryString: false,
  limit: 25,
  limitProvided: false,
  method: "GET",
  operation: { identifier, kind: "detail", resourceType: "model" },
  publicationHeader: null,
  query: null,
  route: {
    operation: { identifier, kind: "detail", resourceType: "model" },
    policy: "models",
  },
  sort: ["name", "stable_id"],
  sortProvided: false,
});

type Provenance = Readonly<{
  matchedBy: "stable_id" | "current_slug" | "historical_slug";
  canonicalSlug: string;
  projectionVersion: string;
}>;

const provenance = (matchedBy: Provenance["matchedBy"]): Provenance => ({
  canonicalSlug: CURRENT_SLUG,
  matchedBy,
  projectionVersion: "model-slug@1",
});

const modelOutcome = (lookupProvenance: unknown) => ({
  lookupProvenance,
  model: model(),
  outcome: "model",
  publicationId: PUBLICATION,
  schemaVersion: "1.11.0",
});

const rpc = (readOutcome: unknown) => ({
  readModelDetailV1: vi.fn(),
  readModelDetailV2: vi.fn((): Promise<unknown> =>
    Promise.resolve(readOutcome),
  ),
  resolvePublicationV2: vi.fn((inputValue: unknown): Promise<unknown> => {
    const input = inputValue as { requiredAvailableUntilMs: number };
    return Promise.resolve({
      bookmark: "bookmark-model-detail-v2",
      outcome: "selected",
      publicationId: PUBLICATION,
      requiredAvailableUntilMs: input.requiredAvailableUntilMs,
    });
  }),
});

const execute = (
  identifier: string,
  service: ReturnType<typeof rpc>,
  overrides: Partial<ModelDetailApiV2Input> = {},
) =>
  readModelDetailFromQueryV2({
    environment: "test",
    limits,
    nowMs: NOW_MS,
    request: request(identifier),
    service,
    ...overrides,
  });

const resolveOnly = async (
  identifier: string,
  service: ReturnType<typeof rpc>,
  overrides: Partial<ModelDetailApiV2Input> = {},
) => {
  let resolved: ResolvedModelDetailReadV2 | null = null;
  const outcome = await executeAfterModelDetailPublicationResolutionV2(
    {
      environment: "test",
      limits,
      nowMs: NOW_MS,
      request: request(identifier),
      service,
      ...overrides,
    },
    (value) => {
      resolved = value;
      return Promise.resolve({
        success: false,
        code: "not_found",
        publicationId: value.publicationId,
      });
    },
  );
  return {
    outcome,
    resolved: resolved as ResolvedModelDetailReadV2 | null,
  };
};

describe("stable-ID and slug Model detail API/query V2 seam", () => {
  it.each([
    [MODEL_ID, "stable_id", "stable_id"],
    [CURRENT_SLUG, "slug", "current_slug"],
    [HISTORICAL_SLUG, "slug", "historical_slug"],
  ] as const)(
    "returns a verified %s lookup and passes its exact classification to V2",
    async (identifier, lookupKind, matchedBy) => {
      const service = rpc(modelOutcome(provenance(matchedBy)));
      const outcome = await execute(identifier, service);

      expect(outcome).toMatchObject({ success: true });
      if (!outcome.success) return;
      expect(outcome.publicationId).toBe(PUBLICATION);
      expect(outcome.lookup).toEqual({ kind: lookupKind, value: identifier });
      expect(outcome.lookupProvenance).toEqual(provenance(matchedBy));
      expect(outcome.detail.data).toEqual(model());
      expect(service.resolvePublicationV2).toHaveBeenCalledWith({
        audience: "quantclarity-catalog-query-v1",
        environment: "test",
        requestedPublicationId: null,
        requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
        version: 2,
      });
      expect(service.readModelDetailV2).toHaveBeenCalledWith({
        audience: "quantclarity-catalog-query-v1",
        bookmark: "bookmark-model-detail-v2",
        environment: "test",
        envelope: {
          audience: "quantclarity-catalog-query-v1",
          continuation: null,
          environment: "test",
          filters: {},
          limit: 25,
          operation: {
            identifier,
            kind: "detail",
            resourceType: "model",
          },
          publicationId: PUBLICATION,
          searchPlan: null,
          sort: ["name", "stable_id"],
          version: 1,
        },
        lookup: { kind: lookupKind, value: identifier },
        requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
        version: 2,
      });
      expect(service.readModelDetailV1).not.toHaveBeenCalled();
    },
  );

  it("binds an explicit publication pin during selection", async () => {
    const service = rpc(modelOutcome(provenance("stable_id")));
    const pinnedRequest = {
      ...request(MODEL_ID),
      publicationHeader: PUBLICATION,
    };
    const { resolved } = await resolveOnly(MODEL_ID, service, {
      request: pinnedRequest,
    });
    expect(resolved).toMatchObject({ publicationId: PUBLICATION });
    expect(service.resolvePublicationV2).toHaveBeenCalledWith(
      expect.objectContaining({ requestedPublicationId: PUBLICATION }),
    );
  });

  it("rejects a resolver-selected publication that crosses the explicit pin", async () => {
    const service = rpc(modelOutcome(provenance("stable_id")));
    service.resolvePublicationV2.mockImplementationOnce(
      (inputValue: unknown): Promise<unknown> => {
        const input = inputValue as { requiredAvailableUntilMs: number };
        return Promise.resolve({
          bookmark: "bookmark-model-detail-v2",
          outcome: "selected",
          publicationId: "pub_22222222-2222-4222-8222-222222222222",
          requiredAvailableUntilMs: input.requiredAvailableUntilMs,
        });
      },
    );
    const { outcome, resolved } = await resolveOnly(MODEL_ID, service, {
      request: { ...request(MODEL_ID), publicationHeader: PUBLICATION },
    });
    expect(outcome).toEqual({ code: "integrity_failure", success: false });
    expect(resolved).toBeNull();
    expect(service.readModelDetailV2).not.toHaveBeenCalled();
  });

  it("contains resolver exceptions and hostile values before selection", async () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    let getterCalls = 0;
    Object.defineProperty(hostile, "outcome", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "selected";
      },
    });
    for (const resolver of [
      () => Promise.reject(new Error("private resolver diagnostic")),
      () => Promise.resolve(hostile),
      () =>
        Promise.resolve({
          bookmark: "bookmark-model-detail-v2",
          extra: "visitor-canary",
          outcome: "selected",
          publicationId: PUBLICATION,
          requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
        }),
    ]) {
      const service = rpc(modelOutcome(provenance("stable_id")));
      service.resolvePublicationV2.mockImplementationOnce(resolver);
      const { outcome, resolved } = await resolveOnly(MODEL_ID, service);
      expect(outcome.success).toBe(false);
      if (outcome.success) continue;
      expect(["integrity_failure", "read_failure"]).toContain(outcome.code);
      expect(JSON.stringify(outcome)).not.toContain("visitor-canary");
      expect(resolved).toBeNull();
      expect(service.readModelDetailV2).not.toHaveBeenCalled();
    }
    expect(getterCalls).toBe(0);
  });

  it("emits byte-identical canonical detail for every lookup class without provenance or submitted-history leakage", async () => {
    const cases = [
      [MODEL_ID, "stable_id"],
      [CURRENT_SLUG, "current_slug"],
      [HISTORICAL_SLUG, "historical_slug"],
    ] as const;
    const outcomes = await Promise.all(
      cases.map(([identifier, matchedBy]) =>
        execute(identifier, rpc(modelOutcome(provenance(matchedBy)))),
      ),
    );
    expect(outcomes.every((outcome) => outcome.success)).toBe(true);
    const successes = outcomes.filter(
      (
        outcome,
      ): outcome is Extract<ModelDetailApiV2Outcome, { success: true }> =>
        outcome.success,
    );
    const representations = successes.map((outcome) =>
      [...outcome.representationBytes].join(","),
    );
    expect(new Set(representations).size).toBe(1);

    const text = new TextDecoder().decode(
      successes[0]?.representationBytes ?? new Uint8Array(),
    );
    const body = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["data", "meta"]);
    expect(text).not.toContain(HISTORICAL_SLUG);
    expect(text).not.toMatch(
      /lookupProvenance|matchedBy|canonicalSlug|projectionVersion/u,
    );
  });

  it("enforces the fixed public byte ceiling even when injected limits are wider", async () => {
    const oversizedModel = model();
    oversizedModel.display_name.evidence_ids = Array.from(
      { length: 1_600 },
      (_, index) =>
        `evd_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const service = rpc({
      ...modelOutcome(provenance("stable_id")),
      model: oversizedModel,
    });

    await expect(
      execute(MODEL_ID, service, {
        limits: { ...limits, maxResponseBytes: 1_000_000 },
      }),
    ).resolves.toEqual({ code: "integrity_failure", success: false });
  });

  it("accepts the exact 128-byte slug boundary", async () => {
    const identifier = "a".repeat(128);
    const boundaryModel = model();
    boundaryModel.slug = known(identifier);
    const outcome = await execute(
      identifier,
      rpc({
        ...modelOutcome({
          ...provenance("current_slug"),
          canonicalSlug: identifier,
        }),
        model: boundaryModel,
      }),
    );
    expect(outcome).toMatchObject({ success: true });
  });

  it.each([
    "",
    "A-model",
    "-model",
    "model-",
    "model--name",
    "model_name",
    "mødel",
    "a".repeat(129),
    "mdl_not-a-stable-id",
  ])(
    "rejects invalid identifier grammar before RPC: %s",
    async (identifier) => {
      const service = rpc(modelOutcome(provenance("current_slug")));
      await expect(execute(identifier, service)).resolves.toEqual({
        code: "invalid_input",
        success: false,
      });
      expect(service.resolvePublicationV2).not.toHaveBeenCalled();
      expect(service.readModelDetailV2).not.toHaveBeenCalled();
    },
  );

  it("rejects a stable-ID result with the wrong canonical Model identity", async () => {
    const wrongModel = model();
    wrongModel.model_id = "mdl_22222222-2222-4222-8222-222222222222";
    await expect(
      execute(
        MODEL_ID,
        rpc({
          ...modelOutcome(provenance("stable_id")),
          model: wrongModel,
        }),
      ),
    ).resolves.toEqual({ code: "integrity_failure", success: false });
  });

  it.each([
    ["stable ID classified as a slug", MODEL_ID, provenance("current_slug")],
    [
      "current slug classified as historical",
      CURRENT_SLUG,
      provenance("historical_slug"),
    ],
    [
      "historical slug classified as stable",
      HISTORICAL_SLUG,
      provenance("stable_id"),
    ],
    [
      "wrong canonical slug",
      CURRENT_SLUG,
      { ...provenance("current_slug"), canonicalSlug: "another-model" },
    ],
    [
      "wrong projection version",
      CURRENT_SLUG,
      { ...provenance("current_slug"), projectionVersion: "model-slug@2" },
    ],
    [
      "extra provenance member",
      CURRENT_SLUG,
      { ...provenance("current_slug"), submittedSlug: CURRENT_SLUG },
    ],
  ])(
    "rejects %s as an integrity failure",
    async (_label, identifier, value) => {
      const outcome = await execute(identifier, rpc(modelOutcome(value)));
      expect(outcome).toEqual({ code: "integrity_failure", success: false });
    },
  );

  it("rejects an extra top-level RPC member", async () => {
    const outcome = await execute(
      MODEL_ID,
      rpc({
        ...modelOutcome(provenance("stable_id")),
        submittedIdentifier: MODEL_ID,
      }),
    );
    expect(outcome).toEqual({ code: "integrity_failure", success: false });
  });

  it("rejects provenance accessors without invoking them", async () => {
    let getterCalls = 0;
    const hostile = {
      model: model(),
      outcome: "model",
      publicationId: PUBLICATION,
      schemaVersion: "1.11.0",
    };
    Object.defineProperty(hostile, "lookupProvenance", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return provenance("stable_id");
      },
    });
    const outcome = await execute(MODEL_ID, rpc(hostile));
    expect(outcome).toEqual({ code: "integrity_failure", success: false });
    expect(getterCalls).toBe(0);
  });

  it("returns a publication-bound not-found without inventing provenance", async () => {
    const service = rpc({
      outcome: "not_found",
      publicationId: PUBLICATION,
      schemaVersion: "1.11.0",
    });
    await expect(execute(HISTORICAL_SLUG, service)).resolves.toEqual({
      code: "not_found",
      publicationId: PUBLICATION,
      success: false,
    });
    expect(service.readModelDetailV2).toHaveBeenCalledOnce();
  });

  it("maps a V2 RPC exception to a closed read failure", async () => {
    const service = rpc(modelOutcome(provenance("stable_id")));
    service.readModelDetailV2.mockRejectedValueOnce(
      new Error("private upstream diagnostic"),
    );
    await expect(execute(MODEL_ID, service)).resolves.toEqual({
      code: "read_failure",
      success: false,
    });
  });
});

describe("resolver-minted Model detail V2 read continuation", () => {
  it.each([
    [MODEL_ID, "stable_id"],
    [CURRENT_SLUG, "slug"],
    [HISTORICAL_SLUG, "slug"],
  ] as const)(
    "exposes minimal frozen %s cache facts without reading",
    async (identifier, lookupKind) => {
      const service = rpc(modelOutcome(provenance("stable_id")));
      const { outcome, resolved } = await resolveOnly(identifier, service);

      expect(outcome).toEqual({
        code: "not_found",
        publicationId: PUBLICATION,
        success: false,
      });
      expect(resolved).not.toBeNull();
      if (resolved === null) return;
      expect(resolved).toMatchObject({
        lookup: { kind: lookupKind, value: identifier },
        publicationId: PUBLICATION,
      });
      expect(Object.keys(resolved).sort()).toEqual([
        "lookup",
        "publicationId",
        "readCanonical",
      ]);
      expect(Object.isFrozen(resolved)).toBe(true);
      expect(Object.isFrozen(resolved.lookup)).toBe(true);
      expect(Object.isFrozen(resolved.readCanonical)).toBe(true);
      expect(JSON.stringify(resolved)).not.toMatch(
        /request|method|header|conditional|host|source|address|actor|bookmark|cache|service|limit/iu,
      );
      expect(service.resolvePublicationV2).toHaveBeenCalledOnce();
      expect(service.readModelDetailV2).not.toHaveBeenCalled();
    },
  );

  it.each([
    [MODEL_ID, "stable_id", "stable_id"],
    [CURRENT_SLUG, "slug", "current_slug"],
    [HISTORICAL_SLUG, "slug", "historical_slug"],
  ] as const)(
    "reads the resolver-selected %s exactly once without re-resolving",
    async (identifier, lookupKind, matchedBy) => {
      const service = rpc(modelOutcome(provenance(matchedBy)));
      const outcome = await executeAfterModelDetailPublicationResolutionV2(
        {
          environment: "test",
          limits,
          nowMs: NOW_MS,
          request: request(identifier),
          service,
        },
        ({ readCanonical }) => readCanonical(),
      );

      expect(outcome).toMatchObject({ success: true });
      expect(service.resolvePublicationV2).toHaveBeenCalledOnce();
      expect(service.readModelDetailV2).toHaveBeenCalledOnce();
      expect(service.readModelDetailV2).toHaveBeenCalledWith({
        audience: "quantclarity-catalog-query-v1",
        bookmark: "bookmark-model-detail-v2",
        environment: "test",
        envelope: {
          audience: "quantclarity-catalog-query-v1",
          continuation: null,
          environment: "test",
          filters: {},
          limit: 25,
          operation: {
            identifier,
            kind: "detail",
            resourceType: "model",
          },
          publicationId: PUBLICATION,
          searchPlan: null,
          sort: ["name", "stable_id"],
          version: 1,
        },
        lookup: { kind: lookupKind, value: identifier },
        requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
        version: 2,
      });
    },
  );

  it("preserves resolve then read ordering in the compatibility wrapper", async () => {
    const events: string[] = [];
    const service = {
      readModelDetailV1: vi.fn(),
      resolvePublicationV2: vi.fn((inputValue: unknown) => {
        events.push("resolve");
        const input = inputValue as { requiredAvailableUntilMs: number };
        return Promise.resolve({
          bookmark: "bookmark-model-detail-v2",
          outcome: "selected",
          publicationId: PUBLICATION,
          requiredAvailableUntilMs: input.requiredAvailableUntilMs,
        });
      }),
      readModelDetailV2: vi.fn(() => {
        events.push("read");
        return Promise.resolve(modelOutcome(provenance("stable_id")));
      }),
    };

    await expect(execute(MODEL_ID, service)).resolves.toMatchObject({
      success: true,
    });
    expect(events).toEqual(["resolve", "read"]);
  });

  it("accepts the non-enumerable disposal hook added to JSRPC results", async () => {
    const resolution = {
      bookmark: "bookmark-model-detail-v2",
      outcome: "selected",
      publicationId: PUBLICATION,
      requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
    };
    const readOutcome = modelOutcome(provenance("stable_id"));
    for (const value of [resolution, readOutcome])
      Object.defineProperty(value, DISPOSE_SYMBOL, {
        configurable: true,
        enumerable: false,
        value: () => undefined,
        writable: true,
      });
    const service = rpc(readOutcome);
    service.resolvePublicationV2.mockResolvedValueOnce(resolution);

    await expect(execute(MODEL_ID, service)).resolves.toMatchObject({
      lookup: { kind: "stable_id", value: MODEL_ID },
      publicationId: PUBLICATION,
      success: true,
    });
    expect(service.readModelDetailV2).toHaveBeenCalledOnce();
  });

  it("rejects the JSRPC disposal hook on nested response records", async () => {
    const nestedProvenance = provenance("stable_id");
    Object.defineProperty(nestedProvenance, DISPOSE_SYMBOL, {
      configurable: true,
      enumerable: false,
      value: () => undefined,
      writable: true,
    });
    const service = rpc(modelOutcome(nestedProvenance));

    await expect(execute(MODEL_ID, service)).resolves.toEqual({
      code: "integrity_failure",
      success: false,
    });
    expect(service.readModelDetailV2).toHaveBeenCalledOnce();
  });

  it("rejects unknown symbolic properties on JSRPC results", async () => {
    const resolution = {
      bookmark: "bookmark-model-detail-v2",
      outcome: "selected",
      publicationId: PUBLICATION,
      requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
    };
    Object.defineProperty(resolution, Symbol("unexpected"), {
      enumerable: false,
      value: () => undefined,
    });
    const service = rpc(modelOutcome(provenance("stable_id")));
    service.resolvePublicationV2.mockResolvedValueOnce(resolution);

    await expect(execute(MODEL_ID, service)).resolves.toEqual({
      code: "integrity_failure",
      success: false,
    });
    expect(service.readModelDetailV2).not.toHaveBeenCalled();
  });

  it.each([
    [
      "expired pin",
      {
        currentPublicationId: PUBLICATION,
        outcome: "publication_expired",
      },
      { code: "publication_expired", currentPublicationId: PUBLICATION },
    ],
    [
      "not ready",
      { outcome: "publication_not_ready" },
      { code: "publication_not_ready" },
    ],
    [
      "resolver integrity failure",
      { outcome: "integrity_failure" },
      { code: "integrity_failure" },
    ],
    [
      "resolver read failure",
      { outcome: "read_failure" },
      { code: "read_failure" },
    ],
  ] as const)(
    "stops before the continuation for %s",
    async (_label, resolverOutcome, expected) => {
      const service = rpc(modelOutcome(provenance("stable_id")));
      service.resolvePublicationV2.mockResolvedValueOnce(resolverOutcome);
      const continuation = vi.fn(() =>
        Promise.resolve<ModelDetailApiV2Outcome>({
          code: "read_failure",
          success: false,
        }),
      );
      const outcome = await executeAfterModelDetailPublicationResolutionV2(
        {
          environment: "test",
          limits,
          nowMs: NOW_MS,
          request: request(MODEL_ID),
          service,
        },
        continuation,
      );
      expect(outcome).toEqual({ success: false, ...expected });
      expect(continuation).not.toHaveBeenCalled();
      expect(service.readModelDetailV2).not.toHaveBeenCalled();
    },
  );

  it("keeps the read bound to private selection facts when public cache facts are copied or replaced", async () => {
    const originalRequest = request(MODEL_ID);
    const resolverResult = {
      bookmark: "bookmark-model-detail-v2",
      outcome: "selected",
      publicationId: PUBLICATION,
      requiredAvailableUntilMs: REQUIRED_UNTIL_MS,
    };
    const service = rpc(modelOutcome(provenance("stable_id")));
    service.resolvePublicationV2.mockResolvedValueOnce(resolverResult);

    const outcome = await executeAfterModelDetailPublicationResolutionV2(
      {
        environment: "test",
        limits,
        nowMs: NOW_MS,
        request: originalRequest,
        service,
      },
      async (authority) => {
        const forged = {
          ...authority,
          lookup: { kind: "slug", value: CURRENT_SLUG } as const,
          publicationId: "pub_22222222-2222-4222-8222-222222222222",
        };
        (originalRequest.operation as { identifier: string }).identifier =
          CURRENT_SLUG;
        resolverResult.bookmark = "changed-bookmark";
        resolverResult.publicationId =
          "pub_22222222-2222-4222-8222-222222222222";
        return forged.readCanonical();
      },
    );

    expect(outcome).toMatchObject({
      lookup: { kind: "stable_id", value: MODEL_ID },
      publicationId: PUBLICATION,
      success: true,
    });
    expect(service.readModelDetailV2).toHaveBeenCalledWith(
      expect.objectContaining({
        bookmark: "bookmark-model-detail-v2",
        lookup: { kind: "stable_id", value: MODEL_ID },
      }),
    );
  });

  it("fails closed on a second use of the one-shot read continuation", async () => {
    const service = rpc(modelOutcome(provenance("stable_id")));
    let second: ModelDetailApiV2Outcome | undefined;
    const first = await executeAfterModelDetailPublicationResolutionV2(
      {
        environment: "test",
        limits,
        nowMs: NOW_MS,
        request: request(MODEL_ID),
        service,
      },
      async ({ readCanonical }) => {
        const firstRead = await readCanonical();
        second = await readCanonical();
        return firstRead;
      },
    );

    expect(first).toMatchObject({ success: true });
    expect(second).toEqual({ code: "integrity_failure", success: false });
    expect(service.readModelDetailV2).toHaveBeenCalledOnce();
  });

  it("expires a retained read continuation when orchestration returns", async () => {
    const service = rpc(modelOutcome(provenance("stable_id")));
    let retainedRead: ResolvedModelDetailReadV2["readCanonical"] | undefined;
    const outcome = await executeAfterModelDetailPublicationResolutionV2(
      {
        environment: "test",
        limits,
        nowMs: NOW_MS,
        request: request(MODEL_ID),
        service,
      },
      ({ publicationId, readCanonical }) => {
        retainedRead = readCanonical;
        return Promise.resolve({
          code: "not_found",
          publicationId,
          success: false,
        });
      },
    );

    expect(outcome).toEqual({
      code: "not_found",
      publicationId: PUBLICATION,
      success: false,
    });
    expect(retainedRead).toBeDefined();
    if (retainedRead === undefined) return;
    await expect(retainedRead()).resolves.toEqual({
      code: "integrity_failure",
      success: false,
    });
    expect(service.readModelDetailV2).not.toHaveBeenCalled();
  });

  it("snapshots hostile top-level members once before the first await", async () => {
    const service = rpc(modelOutcome(provenance("stable_id")));
    let serviceReads = 0;
    let limitsReads = 0;
    const hostileInput = {
      environment: "test",
      get limits() {
        limitsReads += 1;
        if (limitsReads > 1) return { ...limits, maxResponseBytes: 0 };
        return limits;
      },
      nowMs: NOW_MS,
      request: request(MODEL_ID),
      get service() {
        serviceReads += 1;
        if (serviceReads > 1) throw new Error("second service access");
        return service;
      },
    } as ModelDetailApiV2Input;

    await expect(
      readModelDetailFromQueryV2(hostileInput),
    ).resolves.toMatchObject({ success: true });
    expect(limitsReads).toBe(1);
    expect(serviceReads).toBe(1);
    expect(service.readModelDetailV2).toHaveBeenCalledOnce();
  });

  it("contains continuation exceptions without invoking the canonical reader", async () => {
    const service = rpc(modelOutcome(provenance("stable_id")));
    const outcome = await executeAfterModelDetailPublicationResolutionV2(
      {
        environment: "test",
        limits,
        nowMs: NOW_MS,
        request: request(MODEL_ID),
        service,
      },
      () => Promise.reject(new Error("private cache diagnostic")),
    );

    expect(outcome).toEqual({ code: "read_failure", success: false });
    expect(service.readModelDetailV2).not.toHaveBeenCalled();
  });
});
