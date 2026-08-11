import { describe, expect, it, vi } from "vitest";

import type { Model } from "@quant-clarity/contracts";

import {
  assertApiLimits,
  assertRuntimeBudgetUsage,
  bodyForMethod,
  boundedError,
  buildExactStructuredSearchPlan,
  buildQueryServiceEnvelope,
  cacheDecision,
  canonicalExactModelSearchQuery,
  classifyModelDetailIdentifier,
  classifyCost,
  corsHeaders,
  encodeExactModelCardCollectionRepresentation,
  encodeMethodologyDetailRepresentation,
  encodeExactModelSearchRepresentation,
  encodeModelDetailRepresentation,
  executeReadBoundary,
  EXACT_MODEL_SEARCH_API_PATH,
  EXACT_MODEL_SEARCH_LIMIT,
  hashNormalizedQuery,
  ifNoneMatchMatches,
  issueCursor,
  matchRoute,
  methodologyRegistryEntry,
  modelDetailApiPath,
  modelDetailFrontendPath,
  MODEL_DETAIL_API_PATH_PREFIX,
  MODEL_DETAIL_IDENTIFIER_MAX_CHARACTERS,
  MODEL_DETAIL_PUBLIC_MAX_BYTES,
  operationName,
  parseModelDetailApiPath,
  parseModelDetailFrontendPath,
  parseCanonicalExactModelSearchQuery,
  reconcileRequestCursor,
  representationEtag,
  snapshotModelDetailModel,
  validateAndNormalizeRequest,
  verifyCursor,
  type ApiLimits,
  type CatalogQueryRpcV2,
  type CatalogQueryRpcV3,
  type CatalogQueryRpcV4,
  type CatalogQueryRpcV5,
  type CatalogQueryRpcV6,
  type CursorKeyring,
  type CursorPayload,
  type NormalizedRequest,
} from "./index.js";

const catalogQueryRpcV2Surface = {
  resolvePublicationV2: (input: unknown): Promise<unknown> =>
    Promise.resolve(input),
  readMergedExactSearchV2: (input: unknown): Promise<unknown> =>
    Promise.resolve(input),
} satisfies CatalogQueryRpcV2;

const catalogQueryRpcV3Surface = {
  ...catalogQueryRpcV2Surface,
  readDatasetMetadataV1: (input: unknown): Promise<unknown> =>
    Promise.resolve(input),
} satisfies CatalogQueryRpcV3;

const catalogQueryRpcV4Surface = {
  ...catalogQueryRpcV3Surface,
  readModelDetailV1: (input: unknown): Promise<unknown> =>
    Promise.resolve(input),
} satisfies CatalogQueryRpcV4;

const catalogQueryRpcV5Surface = {
  ...catalogQueryRpcV4Surface,
  readModelDetailV2: (input: unknown): Promise<unknown> =>
    Promise.resolve(input),
} satisfies CatalogQueryRpcV5;

const catalogQueryRpcV6Surface = {
  ...catalogQueryRpcV5Surface,
  readMethodologyContextV1: (input: unknown): Promise<unknown> =>
    Promise.resolve(input),
} satisfies CatalogQueryRpcV6;

const PUBLICATION = "pub_00000000-0000-4000-8000-000000000001";
const MODEL = "mdl_00000000-0000-4000-8000-000000000002";
const PROVIDER = "prv_00000000-0000-4000-8000-000000000003";
const FAMILY = "fam_00000000-0000-4000-8000-000000000004";
const EVIDENCE = "evd_00000000-0000-4000-8000-000000000005";
const OBSERVED_AT = "2026-08-03T00:00:00.000Z";

describe("shared canonical exact-Model search query (FE-010, API-010, SEC-007, PRIV-006)", () => {
  it("builds and parses the sole first-page and continuation representations", () => {
    expect(EXACT_MODEL_SEARCH_API_PATH).toBe("/v1/search");
    expect(EXACT_MODEL_SEARCH_LIMIT).toBe(20);
    const first = canonicalExactModelSearchQuery("  Cafe\u0301 Model  ");
    expect(first).toBe("q=Caf%C3%A9+Model&record_type=model&limit=20");
    const parsedFirst = parseCanonicalExactModelSearchQuery(first);
    expect(parsedFirst).toEqual({ cursor: null, query: "Café Model" });
    expect(Object.isFrozen(parsedFirst)).toBe(true);

    const continuation = canonicalExactModelSearchQuery(
      "Café Model",
      "payload.signature",
    );
    expect(continuation).toBe(
      "q=Caf%C3%A9+Model&record_type=model&limit=20&cursor=payload.signature",
    );
    expect(parseCanonicalExactModelSearchQuery(continuation)).toEqual({
      cursor: "payload.signature",
      query: "Café Model",
    });
  });

  it.each([
    "record_type=model&q=Model&limit=20",
    "q=Model&limit=20&record_type=model",
    "q=Model&record_type=model",
    "q=Model&record_type=model&limit=020",
    "q=Model&record_type=variant&limit=20",
    "q=Model&record_type=model&limit=20&sort=relevance",
    "q=Model&q=Model&record_type=model&limit=20",
    "q=%4dodel&record_type=model&limit=20",
    "q=Model%20Name&record_type=model&limit=20",
    "q=+Model+&record_type=model&limit=20",
    "q=Model&record_type=model&limit=20&cursor=",
    "q=Model&record_type=model&limit=20&cursor=a&cursor=b",
    "",
  ])("rejects noncanonical raw query %j", (rawQuery) => {
    expect(parseCanonicalExactModelSearchQuery(rawQuery)).toBeNull();
  });

  it.each([
    ["", null],
    ["   ", null],
    ["x".repeat(201), null],
    ["\ud800", null],
    ["Model", ""],
    ["Model", "x".repeat(4097)],
    ["Model", "\udfff"],
    [null, null],
  ])("does not build an invalid query/cursor tuple", (query, cursor) => {
    expect(canonicalExactModelSearchQuery(query, cursor)).toBeNull();
  });
});

describe("exact-Model SearchCollection representation (API-004, API-010, SEC-007)", () => {
  const collection = () => ({
    data: [
      {
        display_name: {
          evidence_ids: [EVIDENCE],
          observed_at: OBSERVED_AT,
          state: "known",
          value: "Fixture Model",
        },
        match_kind: "canonical_name",
        resource_id: MODEL,
        resource_type: "model",
        semantic_degraded: "disabled",
      },
    ],
    meta: {
      filters: { record_type: "model" },
      publication_id: PUBLICATION,
      resource: "search",
      schema_version: "1.0.0",
      semantic_degraded: "disabled",
      sort: ["relevance", "stable_id"],
    },
    page: { limit: 20, next_cursor: "payload.signature" },
  });

  it("detaches and emits one fixed byte representation", () => {
    const source = collection();
    const encoded = encodeExactModelSearchRepresentation(source);
    expect(encoded).not.toBeNull();
    source.data[0]!.display_name.value = "mutated";
    expect(encoded?.collection.data[0]?.display_name.value).toBe(
      "Fixture Model",
    );
    expect(new TextDecoder().decode(encoded?.representationBytes)).toBe(
      `{"data":[{"resource_type":"model","resource_id":"${MODEL}","display_name":{"state":"known","value":"Fixture Model","observed_at":"${OBSERVED_AT}","evidence_ids":["${EVIDENCE}"]},"match_kind":"canonical_name","semantic_degraded":"disabled"}],"page":{"next_cursor":"payload.signature","limit":20},"meta":{"resource":"search","publication_id":"${PUBLICATION}","schema_version":"1.0.0","sort":["relevance","stable_id"],"filters":{"record_type":"model"},"semantic_degraded":"disabled"}}`,
    );
  });

  it.each([
    [
      "wrong record type",
      (value: ReturnType<typeof collection>) => {
        value.data[0]!.resource_type = "provider";
      },
    ],
    [
      "wrong limit",
      (value: ReturnType<typeof collection>) => {
        value.page.limit = 19;
      },
    ],
    [
      "wrong filter",
      (value: ReturnType<typeof collection>) => {
        value.meta.filters.record_type = "variant";
      },
    ],
    [
      "semantic result",
      (value: ReturnType<typeof collection>) => {
        value.data[0]!.match_kind = "semantic";
      },
    ],
    [
      "additive field",
      (value: ReturnType<typeof collection>) => {
        Object.assign(value.meta, { visitor: "leak" });
      },
    ],
  ])("rejects %s", (_label, mutate) => {
    const value = collection();
    mutate(value);
    expect(encodeExactModelSearchRepresentation(value)).toBeNull();
  });

  it("rejects accessors without invoking them", () => {
    const value = collection();
    let reads = 0;
    Object.defineProperty(value.meta, "publication_id", {
      enumerable: true,
      get() {
        reads += 1;
        return PUBLICATION;
      },
    });
    expect(encodeExactModelSearchRepresentation(value)).toBeNull();
    expect(reads).toBe(0);
  });
});

describe("shared Model-detail identity boundary (API-002, API-004, SEC-007)", () => {
  it.each([
    [MODEL, "stable_id"],
    ["a", "slug"],
    ["fixture-model-2", "slug"],
    ["a".repeat(MODEL_DETAIL_IDENTIFIER_MAX_CHARACTERS), "slug"],
  ] as const)("classifies %s as %s", (value, kind) => {
    const classified = classifyModelDetailIdentifier(value);
    expect(classified).toEqual({ kind, value });
    expect(Object.isFrozen(classified)).toBe(true);
    expect(modelDetailApiPath(value)).toBe(
      `${MODEL_DETAIL_API_PATH_PREFIX}${value}`,
    );
    expect(parseModelDetailApiPath(modelDetailApiPath(value))).toEqual({
      kind,
      value,
    });
  });

  it.each([
    null,
    undefined,
    1,
    "",
    "Uppercase",
    "has_underscore",
    "has.dot",
    "-leading",
    "trailing-",
    "double--hyphen",
    "mødel",
    "a".repeat(MODEL_DETAIL_IDENTIFIER_MAX_CHARACTERS + 1),
    "mdl_00000000-0000-3000-8000-000000000001",
    "mdl_00000000-0000-4000-7000-000000000001",
    "mdl_00000000-0000-4000-8000-00000000000A",
    "%61",
    "%2f",
    "bad/extra",
    "prv_00000000-0000-4000-8000-000000000001",
  ])("rejects noncanonical identifier %j", (value) => {
    expect(classifyModelDetailIdentifier(value)).toBeNull();
    expect(modelDetailApiPath(value)).toBeNull();
  });

  it.each([
    null,
    undefined,
    "/v1/models",
    "/v1/models/",
    `/v1/models/${MODEL}/`,
    `/v1/models/${MODEL}/extra`,
    `/v1/models/${MODEL}?query=visitor`,
    `/models/${MODEL}`,
    `/v1/providers/${MODEL}`,
  ])("rejects noncanonical API path %j", (value) => {
    expect(parseModelDetailApiPath(value)).toBeNull();
  });
});

describe("shared frontend Model-detail path boundary (FE-030, SEC-007)", () => {
  it.each([
    [MODEL, "stable_id"],
    ["fixture-model-2", "slug"],
  ] as const)("round-trips canonical %s paths", (value, kind) => {
    const path = modelDetailFrontendPath(value);
    expect(path).toBe(`/models/${value}`);
    expect(parseModelDetailFrontendPath(path)).toEqual({ kind, value });
  });

  it.each([
    null,
    undefined,
    "/models",
    "/models/",
    `/models/${MODEL}/`,
    `/models/${MODEL}/extra`,
    `/models/${MODEL}?visitor=query`,
    `/models/%66ixture-model`,
    "/models/fixture\\model",
    "/v1/models/fixture-model",
  ])("rejects noncanonical frontend path %j", (value) => {
    expect(parseModelDetailFrontendPath(value)).toBeNull();
  });

  it.each(["", "Uppercase", "bad/extra", "%61", null, undefined])(
    "does not build a path from invalid identifier %j",
    (value) => {
      expect(modelDetailFrontendPath(value)).toBeNull();
    },
  );
});

const modelDetailModel = (): Model => ({
  active_parameters: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  architecture: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  authoritative_checkpoint_ids: [],
  cataloged_provider_count: {
    derivation_version: "cataloged-provider-count@1",
    observed_at: OBSERVED_AT,
    value: 0,
  },
  checkpoints: [],
  context_window_tokens: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  display_name: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "Fixture Mödel",
  },
  family_id: FAMILY,
  last_model_data_refresh: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: OBSERVED_AT,
  },
  license: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  maximum_output_tokens: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  modalities: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  model_id: MODEL,
  publisher: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "Fixture Publisher",
  },
  release_date: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  slug: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "fixture-model",
  },
  source_quantization: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  source_weight_format: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
  status: {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "active",
  },
  total_parameters: {
    evidence_ids: [],
    observed_at: null,
    state: "unknown",
    value: null,
  },
});

const exactModelCardCollection = () => {
  const model = modelDetailModel();
  model.total_parameters = {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: {
      approximation: "exact",
      normalized_decimal: "1000000000",
      raw_value: "1B",
    },
  };
  model.active_parameters = {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: {
      approximation: "approximate",
      normalized_decimal: "250000000",
      raw_value: "about 250M",
    },
  };
  model.source_weight_format = {
    evidence_ids: [EVIDENCE],
    observed_at: OBSERVED_AT,
    state: "known",
    value: "BF16",
  };
  model.source_quantization = {
    evidence_ids: [],
    observed_at: OBSERVED_AT,
    state: "unknown",
    value: null,
  };
  model.cataloged_provider_count.value = 2;
  return {
    data: [
      {
        match_kind: "canonical_name",
        model: {
          model_id: model.model_id,
          display_name: model.display_name,
          publisher: model.publisher,
          total_parameters: model.total_parameters,
          active_parameters: model.active_parameters,
          source_weight_format: model.source_weight_format,
          source_quantization: model.source_quantization,
          cataloged_provider_count: model.cataloged_provider_count,
          last_model_data_refresh: model.last_model_data_refresh,
        },
      },
    ],
    page: { next_cursor: "payload.signature", limit: 20 },
    meta: {
      resource: "exact_model_cards",
      publication_id: PUBLICATION,
      schema_version: "1.0.0",
      sort: ["relevance", "stable_id"],
      filters: { record_type: "model" },
    },
  };
};

describe("exact Model-card collection representation (FE-020, FE-021, FE-023, BE-007)", () => {
  it("detaches every canonical card Fact and emits one fixed representation", () => {
    const source = exactModelCardCollection();
    const encoded = encodeExactModelCardCollectionRepresentation(source);
    expect(encoded).not.toBeNull();
    source.data[0]!.model.display_name.value = "mutated";
    source.data[0]!.model.total_parameters.value.raw_value = "mutated";
    expect(encoded?.collection.data[0]?.model.display_name.value).toBe(
      "Fixture Mödel",
    );
    expect(
      encoded?.collection.data[0]?.model.total_parameters.value,
    ).toMatchObject({ raw_value: "1B", normalized_decimal: "1000000000" });
    expect(
      JSON.parse(new TextDecoder().decode(encoded?.representationBytes)),
    ).toEqual(encoded?.collection);
    expect(encoded?.representationBytes.byteLength).toBeLessThanOrEqual(65_536);
  });

  it.each([
    [
      "provider field",
      (value: ReturnType<typeof exactModelCardCollection>) => {
        Object.assign(value.data[0]!.model, { provider_name: "Paid Provider" });
      },
    ],
    [
      "serving precision",
      (value: ReturnType<typeof exactModelCardCollection>) => {
        Object.assign(value.data[0]!.model, { serving_precision: "FP8" });
      },
    ],
    [
      "wrong resource",
      (value: ReturnType<typeof exactModelCardCollection>) => {
        value.meta.resource = "search";
      },
    ],
    [
      "unknown display name",
      (value: ReturnType<typeof exactModelCardCollection>) => {
        Object.assign(value.data[0]!.model.display_name, {
          evidence_ids: [],
          observed_at: null,
          state: "unknown",
          value: null,
        });
      },
    ],
    [
      "duplicate Model",
      (value: ReturnType<typeof exactModelCardCollection>) => {
        value.data.push(structuredClone(value.data[0]!));
      },
    ],
  ])("rejects %s", (_label, mutate) => {
    const value = exactModelCardCollection();
    mutate(value);
    expect(encodeExactModelCardCollectionRepresentation(value)).toBeNull();
  });

  it("rejects hostile accessors without invoking them", () => {
    const value = exactModelCardCollection();
    let reads = 0;
    Object.defineProperty(value.data[0]!.model, "publisher", {
      enumerable: true,
      get() {
        reads += 1;
        return modelDetailModel().publisher;
      },
    });
    expect(encodeExactModelCardCollectionRepresentation(value)).toBeNull();
    expect(reads).toBe(0);
  });

  it("accepts exactly 65,536 bytes and rejects 65,537", () => {
    const value = exactModelCardCollection();
    let admitted = encodeExactModelCardCollectionRepresentation(value);
    for (let count = 1_250; count <= 1_500; count += 25) {
      value.data[0]!.model.publisher.evidence_ids = Array.from(
        { length: count },
        (_, index) =>
          `evd_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      );
      admitted = encodeExactModelCardCollectionRepresentation(value);
      if (
        admitted !== null &&
        admitted.representationBytes.byteLength >= 65_536 - 4_000
      )
        break;
    }
    if (admitted === null)
      throw new Error("Unable to construct the exact-byte boundary vector.");
    const remaining = 65_536 - admitted.representationBytes.byteLength;
    const currentCursor = value.page.next_cursor;
    if (remaining < 0 || currentCursor.length + remaining + 1 > 4_096)
      throw new Error("Exact-byte boundary cursor budget drifted.");
    value.page.next_cursor = currentCursor + "x".repeat(remaining);
    const exact = encodeExactModelCardCollectionRepresentation(value);
    expect(exact?.representationBytes.byteLength).toBe(65_536);
    value.page.next_cursor += "x";
    expect(encodeExactModelCardCollectionRepresentation(value)).toBeNull();
  });
});

const rawModelDetailByteLength = (model: Model): number =>
  new TextEncoder().encode(
    JSON.stringify({
      data: model,
      meta: {
        resource: "models",
        publication_id: PUBLICATION,
        schema_version: "1.13.0",
        sort: ["name", "stable_id"],
        filters: {},
      },
    }),
  ).byteLength;

const modelDetailAtByteLength = (targetBytes: number): Model => {
  const candidate = modelDetailModel();
  candidate.publisher.value = "x";
  const evidenceId = (index: number) =>
    `evd_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  candidate.display_name.evidence_ids = [evidenceId(0)];
  const oneIdBytes = rawModelDetailByteLength(candidate);
  candidate.display_name.evidence_ids = [evidenceId(0), evidenceId(1)];
  const perAdditionalIdBytes = rawModelDetailByteLength(candidate) - oneIdBytes;
  const evidenceCount =
    1 + Math.floor((targetBytes - oneIdBytes) / perAdditionalIdBytes);
  candidate.display_name.evidence_ids = Array.from(
    { length: evidenceCount },
    (_, index) => evidenceId(index),
  );
  const padding = targetBytes - rawModelDetailByteLength(candidate);
  if (padding < 0 || padding > 199)
    throw new RangeError("Unable to build exact ModelDetail test vector.");
  candidate.publisher.value = "x".repeat(1 + padding);
  if (rawModelDetailByteLength(candidate) !== targetBytes)
    throw new RangeError("Exact ModelDetail test vector drifted.");
  return candidate;
};

describe("shared catalog query RPC contract", () => {
  it("contains only the accepted hostile-boundary V2 methods", () => {
    expect(Object.keys(catalogQueryRpcV2Surface).sort()).toEqual([
      "readMergedExactSearchV2",
      "resolvePublicationV2",
    ]);
    expect(Object.keys(catalogQueryRpcV3Surface).sort()).toEqual([
      "readDatasetMetadataV1",
      "readMergedExactSearchV2",
      "resolvePublicationV2",
    ]);
    expect(Object.keys(catalogQueryRpcV4Surface).sort()).toEqual([
      "readDatasetMetadataV1",
      "readMergedExactSearchV2",
      "readModelDetailV1",
      "resolvePublicationV2",
    ]);
    expect(Object.keys(catalogQueryRpcV5Surface).sort()).toEqual([
      "readDatasetMetadataV1",
      "readMergedExactSearchV2",
      "readModelDetailV1",
      "readModelDetailV2",
      "resolvePublicationV2",
    ]);
    expect(Object.keys(catalogQueryRpcV6Surface).sort()).toEqual([
      "readDatasetMetadataV1",
      "readMergedExactSearchV2",
      "readMethodologyContextV1",
      "readModelDetailV1",
      "readModelDetailV2",
      "resolvePublicationV2",
    ]);
  });
});

describe("shared exact MethodologyDetail representation", () => {
  it("uses one immutable validated registry entry and exact detail envelope", () => {
    const entry = methodologyRegistryEntry("1.0.0");
    expect(entry).toEqual({
      effectiveAt: "2026-08-01T00:00:00.000Z",
      path: "/v1/methodologies/1.0.0",
      version: "1.0.0",
    });
    expect(Object.isFrozen(entry)).toBe(true);
    const representation = encodeMethodologyDetailRepresentation({
      publicApiOrigin: "https://api.example.test",
      publicationId: PUBLICATION,
      schemaVersion: "1.13.0",
      version: "1.0.0",
    });
    expect(representation.detail).toEqual({
      data: {
        methodology_version: "1.0.0",
        methodology_effective_at: "2026-08-01T00:00:00.000Z",
        methodology_url: "https://api.example.test/v1/methodologies/1.0.0",
      },
      meta: {
        resource: "methodologies",
        publication_id: PUBLICATION,
        schema_version: "1.13.0",
        sort: ["version"],
        filters: {},
      },
    });
    expect(new TextDecoder().decode(representation.representationBytes)).toBe(
      JSON.stringify(representation.detail),
    );
  });

  it.each(["", "2.0.0", "invalid version", "__proto__", "v".repeat(65)])(
    "fails closed for unregistered or malformed version %j",
    (version) => {
      expect(methodologyRegistryEntry(version)).toBeNull();
      expect(() =>
        encodeMethodologyDetailRepresentation({
          publicApiOrigin: "https://api.example.test",
          publicationId: PUBLICATION,
          schemaVersion: "1.13.0",
          version,
        }),
      ).toThrow();
    },
  );

  it.each([
    "http://api.example.test",
    "https://user@api.example.test",
    "https://api.example.test/",
    "https://api.example.test/path",
    "https://api.example.test?query=1",
  ])("rejects non-exact protected origin %j", (publicApiOrigin) => {
    expect(() =>
      encodeMethodologyDetailRepresentation({
        publicApiOrigin,
        publicationId: PUBLICATION,
        schemaVersion: "1.13.0",
        version: "1.0.0",
      }),
    ).toThrow(/origin/u);
  });

  it("rejects accessor-backed input without invoking it", () => {
    let reads = 0;
    const input = {
      get publicApiOrigin() {
        reads += 1;
        return "https://api.example.test";
      },
      publicationId: PUBLICATION,
      schemaVersion: "1.13.0",
      version: "1.0.0",
    };
    expect(() => encodeMethodologyDetailRepresentation(input)).toThrow(
      /input/u,
    );
    expect(reads).toBe(0);
  });

  it("rejects an origin whose composed methodology URL exceeds the contract", () => {
    const publicApiOrigin = `https://${"a".repeat(2020)}.test`;
    expect(new TextEncoder().encode(publicApiOrigin).byteLength).toBeLessThan(
      2048,
    );
    expect(() =>
      encodeMethodologyDetailRepresentation({
        publicApiOrigin,
        publicationId: PUBLICATION,
        schemaVersion: "1.13.0",
        version: "1.0.0",
      }),
    ).toThrow(/URL exceeds/u);
  });
});

describe("shared exact ModelDetail representation", () => {
  it("snapshots one contract-valid canonical Model with stable key order and no live references", () => {
    const source = modelDetailModel();
    const snapshot = snapshotModelDetailModel({
      expectedModelId: MODEL,
      maxRepresentationBytes: MODEL_DETAIL_PUBLIC_MAX_BYTES,
      model: source,
    });
    expect(snapshot).not.toBeNull();
    if (snapshot === null) return;

    expect(snapshot).not.toBe(source);
    expect(Object.keys(snapshot)).toEqual(Object.keys(source).sort());
    expect(snapshot.display_name).not.toBe(source.display_name);
    source.display_name.value = "Changed after snapshot";
    expect(snapshot.display_name.value).toBe("Fixture Mödel");
  });

  it("rejects identity drift and hostile Model accessors without invoking them", () => {
    const getter = vi.fn(() => modelDetailModel().display_name);
    const hostile = modelDetailModel() as unknown as Record<string, unknown>;
    Object.defineProperty(hostile, "display_name", {
      enumerable: true,
      get: getter,
    });

    expect(
      snapshotModelDetailModel({
        expectedModelId: MODEL,
        maxRepresentationBytes: MODEL_DETAIL_PUBLIC_MAX_BYTES,
        model: hostile,
      }),
    ).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(
      snapshotModelDetailModel({
        expectedModelId: "mdl_99999999-9999-4999-8999-999999999999",
        maxRepresentationBytes: MODEL_DETAIL_PUBLIC_MAX_BYTES,
        model: modelDetailModel(),
      }),
    ).toBeNull();
  });

  it("closes invalid snapshot budgets and composes with the exact byte admission boundary", () => {
    for (const maxRepresentationBytes of [-1, 0.5, Number.MAX_SAFE_INTEGER])
      expect(
        snapshotModelDetailModel({
          expectedModelId: MODEL,
          maxRepresentationBytes,
          model: modelDetailModel(),
        }),
      ).toBeNull();

    const snapshot = snapshotModelDetailModel({
      expectedModelId: MODEL,
      maxRepresentationBytes: MODEL_DETAIL_PUBLIC_MAX_BYTES,
      model: modelDetailAtByteLength(MODEL_DETAIL_PUBLIC_MAX_BYTES),
    });
    expect(snapshot).not.toBeNull();
    if (snapshot === null) return;
    expect(
      encodeModelDetailRepresentation({
        model: snapshot,
        publicationId: PUBLICATION,
        schemaVersion: "1.13.0",
      }).representationBytes.byteLength,
    ).toBe(MODEL_DETAIL_PUBLIC_MAX_BYTES);
  });

  it("fixes the public byte ceiling and exact envelope/key order", () => {
    const model = modelDetailModel();
    const representation = encodeModelDetailRepresentation({
      model,
      publicationId: PUBLICATION,
      schemaVersion: "1.13.0",
    });
    const expected = `{"data":${JSON.stringify(model)},"meta":{"resource":"models","publication_id":"${PUBLICATION}","schema_version":"1.13.0","sort":["name","stable_id"],"filters":{}}}`;

    expect(MODEL_DETAIL_PUBLIC_MAX_BYTES).toBe(65_536);
    expect(new TextDecoder().decode(representation.representationBytes)).toBe(
      expected,
    );
    expect(representation.representationBytes.byteLength).toBe(
      new TextEncoder().encode(expected).byteLength,
    );
    expect(representation.detail).toEqual({
      data: model,
      meta: {
        resource: "models",
        publication_id: PUBLICATION,
        schema_version: "1.13.0",
        sort: ["name", "stable_id"],
        filters: {},
      },
    });
  });

  it("encodes detached UTF-8 bytes exactly once per representation", () => {
    const model = modelDetailModel();
    const first = encodeModelDetailRepresentation({
      model,
      publicationId: PUBLICATION,
      schemaVersion: "1.13.0",
    });
    const originalBytes = first.representationBytes.slice();
    const second = encodeModelDetailRepresentation({
      model,
      publicationId: PUBLICATION,
      schemaVersion: "1.13.0",
    });

    model.display_name.value = "Changed after encoding";

    expect(first.representationBytes).toEqual(originalBytes);
    expect(new TextDecoder().decode(first.representationBytes)).toContain(
      "Fixture Mödel",
    );
    expect(first.representationBytes).not.toBe(second.representationBytes);
  });

  it("rejects invalid publication and schema identities before encoding", () => {
    const model = modelDetailModel();
    expect(() =>
      encodeModelDetailRepresentation({
        model,
        publicationId: "not-a-publication",
        schemaVersion: "1.13.0",
      }),
    ).toThrow(RangeError);
    expect(() =>
      encodeModelDetailRepresentation({
        model,
        publicationId: PUBLICATION,
        schemaVersion: "latest",
      }),
    ).toThrow(RangeError);
  });

  it("accepts exactly 65,536 bytes and rejects 65,537 without truncation", () => {
    const accepted = encodeModelDetailRepresentation({
      model: modelDetailAtByteLength(MODEL_DETAIL_PUBLIC_MAX_BYTES),
      publicationId: PUBLICATION,
      schemaVersion: "1.13.0",
    });
    expect(accepted.representationBytes.byteLength).toBe(
      MODEL_DETAIL_PUBLIC_MAX_BYTES,
    );
    expect(
      JSON.parse(new TextDecoder().decode(accepted.representationBytes)),
    ).toEqual(accepted.detail);

    expect(() =>
      encodeModelDetailRepresentation({
        model: modelDetailAtByteLength(MODEL_DETAIL_PUBLIC_MAX_BYTES + 1),
        publicationId: PUBLICATION,
        schemaVersion: "1.13.0",
      }),
    ).toThrow("Model detail representation exceeds public limit.");
  });
});

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

const currentSecret = new TextEncoder().encode(
  "current-test-only-cursor-key-material-0000000000000000",
);
const nextSecret = new TextEncoder().encode(
  "next-test-only-cursor-key-material-000000000000000000",
);
const keys: CursorKeyring = {
  current: { id: "current", secret: currentSecret },
  next: { id: "next", secret: nextSecret },
};

function request(
  pathname: string,
  rawQuery = "",
  method = "GET",
  publicationHeader: string | null = null,
  hasQueryString = rawQuery !== "",
) {
  return validateAndNormalizeRequest(
    {
      bodyBytes: 0,
      hasQueryString,
      method,
      pathname,
      publicationHeader,
      rawQuery,
    },
    limits,
  );
}

function successful(
  pathname: string,
  rawQuery = "",
  method = "GET",
  publicationHeader: string | null = null,
): NormalizedRequest {
  const result = request(pathname, rawQuery, method, publicationHeader);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error("test request did not validate");
  return result.request;
}

function cursorPayload(
  normalized: NormalizedRequest,
  overrides: Partial<CursorPayload> = {},
): CursorPayload {
  return {
    expiresAtSeconds: 1_100,
    filters: normalized.filters,
    issuedAtSeconds: 1_000,
    lastSortTuple: ["Example", MODEL],
    limit: normalized.limit,
    operation: operationName(normalized.operation),
    publicationId: PUBLICATION,
    queryHash: null,
    sort: normalized.sort,
    stableId: MODEL,
    version: 1,
    ...overrides,
  };
}

describe("closed routes and operations", () => {
  it.each([
    ["ACT-API-001 metadata", "/v1/metadata", "metadata"],
    ["ACT-API-002 models", "/v1/models", "collection"],
    ["ACT-API-002 model detail", `/v1/models/${MODEL}`, "detail"],
    [
      "ACT-API-002 related offerings",
      `/v1/providers/${PROVIDER}/offerings`,
      "related_collection",
    ],
    ["ACT-API-010 search", "/v1/search", "search"],
    ["ACT-API-014 JSON contract", "/v1/openapi.json", "openapi"],
    ["ACT-API-014 YAML contract", "/v1/openapi.yaml", "openapi"],
    [
      "ACT-API-015 methodology",
      "/v1/methodologies/1.0.0",
      "methodology_detail",
    ],
  ])("matches %s", (_trace, path, kind) => {
    expect(matchRoute(path)?.operation.kind).toBe(kind);
  });

  it.each([
    "/v1/methodologies/invalid version",
    `/v1/methodologies/${"v".repeat(65)}`,
    "/v1/models/",
    "/v1//models",
    "/v1/models/%2e%2e",
    "/v1/models/not_allowed!",
    `/v1/models/${PROVIDER}`,
    "/v1/offerings/human-readable-slug",
    `/v1/models/${PROVIDER}/offerings`,
  ])("ACT-API-002 rejects route-contract drift and hostile path %s", (path) => {
    expect(matchRoute(path)).toBeNull();
  });

  it("ACT-API-021 classifies only search as the high-cost route", () => {
    expect(classifyCost("/v1/search")).toBe("search");
    expect(classifyCost("/v1/search/unknown")).toBe("read");
    expect(classifyCost("/v1/models")).toBe("read");
  });
});

describe("bounded validation and normalization", () => {
  it("ACT-API-007 normalizes NFC, comma sets, defaults, and stable sorts", () => {
    const result = request(
      "/v1/models",
      "publisher=Cafe%CC%81,Alpha&status=active&limit=50&sort=release_date",
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.request.filters).toEqual({
      publisher: "Alpha,Café",
      status: "active",
    });
    expect(result.request.limit).toBe(50);
    expect(result.request.sort).toEqual(["release_date", "stable_id"]);
  });

  it("ACT-API-010 measures normalized search by UTF-8 bytes", () => {
    const accepted = request("/v1/search", `q=${"é".repeat(100)}`);
    expect(accepted.success).toBe(true);
    const rejected = request("/v1/search", `q=${"é".repeat(101)}`);
    expect(rejected.success).toBe(false);
  });

  it.each(["*", "model\\d+", "model[0-9]", "model{2}", "model|variant"])(
    "ACT-API-010 treats wildcard or regex-looking construct %s as literal text",
    (syntax) => {
      const result = request("/v1/search", `q=${encodeURIComponent(syntax)}`);
      expect(result.success).toBe(true);
      if (result.success) expect(result.request.query).toBe(syntax);
    },
  );

  it.each([
    "Llama 3.1 (8B)",
    "What is GPT-4?",
    "Mixtral: instruct, v0.1",
    "Qwen + coder",
  ])(
    "ACT-API-010 preserves ordinary natural-language punctuation in %s",
    (query) => {
      const result = request("/v1/search", `q=${encodeURIComponent(query)}`);
      expect(result.success).toBe(true);
    },
  );

  it("ACT-API-011 permits a queryless search preflight", () => {
    const result = request("/v1/search", "", "OPTIONS");
    expect(result.success).toBe(true);
  });

  it("PVT-PRIV-006 preserves a bare query-string marker", () => {
    const result = request("/v1/models", "", "GET", null, true);
    expect(result.success).toBe(true);
    if (result.success) expect(result.request.hasQueryString).toBe(true);
  });

  it("SST-SEC-007 counts a bare query marker against the URL ceiling", () => {
    const pathname = "/v1/models";
    const exactLimits = {
      ...limits,
      maxUrlBytes: new TextEncoder().encode(pathname).byteLength,
    };
    expect(
      validateAndNormalizeRequest(
        {
          bodyBytes: 0,
          hasQueryString: false,
          method: "GET",
          pathname,
          publicationHeader: null,
          rawQuery: "",
        },
        exactLimits,
      ).success,
    ).toBe(true);
    const bareQuery = validateAndNormalizeRequest(
      {
        bodyBytes: 0,
        hasQueryString: true,
        method: "GET",
        pathname,
        publicationHeader: null,
        rawQuery: "",
      },
      exactLimits,
    );
    expect(bareQuery.success).toBe(false);
    if (!bareQuery.success) expect(bareQuery.error.status).toBe(413);
  });

  it("SST-SEC-007 rejects an inconsistent raw query marker", () => {
    const result = request("/v1/models", "provider=alpha", "GET", null, false);
    expect(result.success).toBe(false);
  });

  it.each([
    ["duplicate", "provider=a&provider=b", "invalid_parameter"],
    ["unknown", "winner=true", "unsupported_filter"],
    ["zero limit", "limit=0", "invalid_parameter"],
    ["leading-zero limit", "limit=025", "invalid_parameter"],
    ["bad sort", "sort=best", "invalid_parameter"],
    ["bad boolean", "stale_offering=yes", "invalid_parameter"],
    ["bad timestamp", "updated_since=tomorrow", "invalid_parameter"],
    ["bad percent", "provider=%ZZ", "invalid_parameter"],
    ["empty comma value", "provider=a,,b", "invalid_parameter"],
    ["duplicate comma value", "provider=a,a", "invalid_parameter"],
  ])("SST-SEC-007 rejects %s", (_trace, query, code) => {
    const result = request("/v1/models", query);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(code);
  });

  it("SST-SEC-007 rejects aggregate filter cardinality above the injected bound", () => {
    const result = request(
      "/v1/models",
      "provider=a,b,c,d,e,f&publisher=g,h,i,j,k",
    );
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.details?.[0]?.reason).toBe("maximum is 10");
  });

  it("SST-SEC-007 rejects raw target bytes before parsing", () => {
    const result = request("/v1/models", `provider=${"a".repeat(4090)}`);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.status).toBe(413);
  });

  it.each([
    [1, 400],
    [1025, 413],
  ])(
    "SST-SEC-007 rejects a public read body of %i bytes",
    (bodyBytes, status) => {
      const result = validateAndNormalizeRequest(
        {
          bodyBytes,
          hasQueryString: false,
          method: "GET",
          pathname: "/v1/models",
          publicationHeader: null,
          rawQuery: "",
        },
        limits,
      );
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.status).toBe(status);
    },
  );

  it("ACT-API-011 maps all mutation methods to 405", () => {
    const result = request("/v1/not-present", "", "DELETE");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("method_not_allowed");
  });

  it("ACT-API-003 validates publication pins without accepting a duplicate header value", () => {
    expect(request("/v1/models", "", "GET", PUBLICATION).success).toBe(true);
    const invalid = request(
      "/v1/models",
      "",
      "GET",
      `${PUBLICATION},${PUBLICATION}`,
    );
    expect(invalid.success).toBe(false);
  });

  it("ACT-API-025 has no implicit ceiling defaults", () => {
    expect(() => {
      assertApiLimits({ ...limits, maxResponseBytes: 0 });
    }).toThrow(/explicitly injected/u);
    expect(() => {
      assertApiLimits(limits);
    }).not.toThrow();
    for (const invalid of [
      { ...limits, maxCursorCharacters: 4097 },
      { ...limits, defaultPageSize: 26 },
      { ...limits, maxFilterValues: 11 },
      { ...limits, maxPageSize: 1000 },
      { ...limits, maxSearchQueryBytes: 201 },
      { ...limits, maxSearchResults: 21 },
      { ...limits, maxSemanticCalls: 1 },
      { ...limits, maxSemanticCandidates: 1 },
    ])
      expect(() => {
        assertApiLimits(invalid);
      }).toThrow();
  });
});

describe("effect-ordered read boundary", () => {
  function effects(events: string[], allowed: boolean, cached: string | null) {
    return {
      async cache() {
        events.push("cache");
        return Promise.resolve(cached);
      },
      async limit() {
        events.push("limit");
        return Promise.resolve(allowed);
      },
      async query() {
        events.push("query");
        return Promise.resolve("query-result");
      },
      async resolveHead() {
        events.push("head");
        return Promise.resolve("head");
      },
    };
  }

  it("ACT-API-024 withholds validation errors until after the limiter", async () => {
    const events: string[] = [];
    const outcome = await executeReadBoundary(
      () => {
        events.push("validate");
        return request("/v1/models", "winner=true");
      },
      effects(events, true, null),
    );
    expect(outcome.kind).toBe("validation_error");
    expect(events).toEqual(["validate", "limit"]);
  });

  it("ACT-API-024 denies downstream work when the limiter rejects", async () => {
    const events: string[] = [];
    const outcome = await executeReadBoundary(
      () => {
        events.push("validate");
        return request("/v1/models");
      },
      effects(events, false, null),
    );
    expect(outcome).toEqual({ kind: "rate_limited" });
    expect(events).toEqual(["validate", "limit"]);
  });

  it("ACT-API-011 returns a limited preflight without head, cache, or query effects", async () => {
    const events: string[] = [];
    const outcome = await executeReadBoundary(
      () => {
        events.push("validate");
        return request("/v1/models", "", "OPTIONS");
      },
      effects(events, true, "must-not-be-read"),
    );
    expect(outcome).toEqual({ kind: "preflight" });
    expect(events).toEqual(["validate", "limit"]);
  });

  it.each([
    ["cache", "cached-result", ["validate", "limit", "head", "cache"]],
    ["query", null, ["validate", "limit", "head", "cache", "query"]],
  ])(
    "ACT-API-024 resolves head then serves %s",
    async (source, cached, expected) => {
      const events: string[] = [];
      const outcome = await executeReadBoundary(
        () => {
          events.push("validate");
          return request(`/v1/models/${MODEL}`);
        },
        effects(events, true, cached),
      );
      expect(outcome.kind).toBe("success");
      if (outcome.kind === "success") expect(outcome.source).toBe(source);
      expect(events).toEqual(expected);
    },
  );

  it.each([
    ["collection", "/v1/models", ""],
    ["search", "/v1/search", "q=llama"],
    ["query-string collection", "/v1/models", "provider=alpha"],
  ])(
    "PVT-PRIV-006 bypasses Cache API for %s",
    async (_trace, pathname, rawQuery) => {
      const events: string[] = [];
      const outcome = await executeReadBoundary(
        () => {
          events.push("validate");
          return request(pathname, rawQuery);
        },
        effects(events, true, "must-not-be-read"),
      );
      expect(outcome).toEqual({
        kind: "success",
        result: "query-result",
        source: "query",
      });
      expect(events).toEqual(["validate", "limit", "head", "query"]);
    },
  );

  it("SST-SEC-007 derives limiter cost from the validated route", async () => {
    const costs: string[] = [];
    const base = effects([], true, null);
    await executeReadBoundary(() => request("/v1/search", "q=llama"), {
      ...base,
      async limit(cost) {
        costs.push(cost);
        return Promise.resolve(true);
      },
    });
    await executeReadBoundary(() => request("/v1/models"), {
      ...base,
      async limit(cost) {
        costs.push(cost);
        return Promise.resolve(true);
      },
    });
    await executeReadBoundary(() => request("/v1/search", "winner=true"), {
      ...base,
      async limit(cost) {
        costs.push(cost);
        return Promise.resolve(true);
      },
    });
    await executeReadBoundary(() => request("/v1/not-present"), {
      ...base,
      async limit(cost) {
        costs.push(cost);
        return Promise.resolve(true);
      },
    });
    expect(costs).toEqual(["search", "read", "search", "read"]);
  });

  it("SST-SEC-007 ignores a structurally forged cost on a successful search", async () => {
    const costs: string[] = [];
    const validated = request("/v1/search", "q=llama");
    const outcome = await executeReadBoundary(
      () => ({ ...validated, cost: "read" }),
      {
        ...effects([], true, null),
        async limit(cost) {
          costs.push(cost);
          return Promise.resolve(true);
        },
      },
    );
    expect(outcome.kind).toBe("success");
    expect(costs).toEqual(["search"]);
  });

  it("PVT-PRIV-006 bypasses cache for a forged resource-type/ID pair", async () => {
    const events: string[] = [];
    const valid = successful(`/v1/models/${MODEL}`);
    const forged = {
      ...valid,
      operation: {
        identifier: MODEL,
        kind: "detail",
        resourceType: "provider",
      },
    } as NormalizedRequest;
    const outcome = await executeReadBoundary(
      () => ({ cost: "read", request: forged, success: true }),
      effects(events, true, "must-not-be-read"),
    );
    expect(outcome).toEqual({
      kind: "success",
      result: "query-result",
      source: "query",
    });
    expect(events).toEqual(["limit", "head", "query"]);
  });
});

describe("authenticated storage-free cursors", () => {
  it("ACT-API-007 signs and verifies with the current key", async () => {
    const normalized = successful("/v1/models", "provider=alpha&sort=name");
    const token = await issueCursor(
      cursorPayload(normalized),
      keys,
      crypto.subtle,
    );
    expect(token.split(".")).toHaveLength(2);
    const verified = await verifyCursor(token, keys, 1_050, 5, crypto.subtle);
    expect(verified.success).toBe(true);
    if (verified.success)
      expect(verified.payload.publicationId).toBe(PUBLICATION);
  });

  it("ACT-API-007 accepts the staged next key during rotation", async () => {
    const normalized = successful("/v1/models");
    const token = await issueCursor(
      cursorPayload(normalized),
      { current: keys.next!, next: null },
      crypto.subtle,
    );
    expect(
      (await verifyCursor(token, keys, 1_050, 0, crypto.subtle)).success,
    ).toBe(true);
  });

  it.each(["payload", "signature"])(
    "ACT-API-007 rejects cursor tampering in %s",
    async (part) => {
      const normalized = successful("/v1/models");
      const token = await issueCursor(
        cursorPayload(normalized),
        keys,
        crypto.subtle,
      );
      const pieces = token.split(".");
      const indexes: Readonly<Record<string, number>> = {
        payload: 0,
        signature: 1,
      };
      const index = indexes[part];
      if (index === undefined) throw new Error("unknown test mutation");
      pieces[index] = `${pieces[index] ?? ""}x`;
      expect(
        await verifyCursor(pieces.join("."), keys, 1_050, 0, crypto.subtle),
      ).toEqual({ reason: "invalid", success: false });
    },
  );

  it("ACT-API-007 rejects an unknown embedded key ID", async () => {
    const normalized = successful("/v1/models");
    const outsider: CursorKeyring = {
      current: {
        id: "outsider",
        secret: new TextEncoder().encode(
          "outsider-test-only-cursor-key-material-00000000000000",
        ),
      },
      next: null,
    };
    const token = await issueCursor(
      cursorPayload(normalized),
      outsider,
      crypto.subtle,
    );
    expect(await verifyCursor(token, keys, 1_050, 0, crypto.subtle)).toEqual({
      reason: "invalid",
      success: false,
    });
  });

  it("ACT-API-007 rejects arbitrary cursor operations", async () => {
    const normalized = successful("/v1/models");
    await expect(
      issueCursor(
        cursorPayload(normalized, { operation: "run:arbitrary-sql" }),
        keys,
        crypto.subtle,
      ),
    ).rejects.toThrow(/payload is invalid/u);
  });

  it.each(["metadata", "openapi:json", "get:model", "get:methodology:1.0.0"])(
    "ACT-API-007 rejects non-pageable cursor operation %s",
    async (operation) => {
      const normalized = successful("/v1/models");
      await expect(
        issueCursor(
          cursorPayload(normalized, { operation }),
          keys,
          crypto.subtle,
        ),
      ).rejects.toThrow(/payload is invalid/u);
    },
  );

  it.each([
    ["wrong stable prefix", { stableId: PROVIDER }],
    ["empty tuple", { lastSortTuple: [] }],
    ["incomplete tuple", { lastSortTuple: [MODEL] }],
    ["unsupported filter", { filters: { winner: true } }],
    ["unsupported sort", { sort: ["best", "stable_id"] }],
    [
      "multiple primary sorts",
      {
        lastSortTuple: ["Example", "2026-01-01", MODEL],
        sort: ["name", "release_date", "stable_id"],
      },
    ],
    ["unexpected query hash", { queryHash: "a".repeat(64) }],
    ["non-canonical filter", { filters: { provider: "beta,alpha" } }],
  ])(
    "ACT-API-007 rejects operation-incompatible %s",
    async (_trace, overrides) => {
      const normalized = successful("/v1/models");
      await expect(
        issueCursor(cursorPayload(normalized, overrides), keys, crypto.subtle),
      ).rejects.toThrow(/payload is invalid/u);
    },
  );

  it("ACT-API-007 enforces expiry and future issue time with bounded skew", async () => {
    const normalized = successful("/v1/models");
    const token = await issueCursor(
      cursorPayload(normalized),
      keys,
      crypto.subtle,
    );
    expect(await verifyCursor(token, keys, 1_106, 5, crypto.subtle)).toEqual({
      reason: "expired",
      success: false,
    });
    expect(await verifyCursor(token, keys, 990, 5, crypto.subtle)).toEqual({
      reason: "not_yet_valid",
      success: false,
    });
    expect(await verifyCursor(token, keys, 1_100, 0, crypto.subtle)).toEqual({
      reason: "expired",
      success: false,
    });
    await expect(
      verifyCursor(token, keys, 1_050, 31, crypto.subtle),
    ).rejects.toThrow(/zero and 30 seconds/u);
  });

  it("ACT-API-007 rejects non-canonical base64url cursor segments", async () => {
    const normalized = successful("/v1/models");
    const token = await issueCursor(
      cursorPayload(normalized),
      keys,
      crypto.subtle,
    );
    const [payload, signature] = token.split(".");
    if (payload === undefined || signature === undefined)
      throw new Error("cursor segments absent");
    expect(
      await verifyCursor(
        `${payload}=.${signature}`,
        keys,
        1_050,
        0,
        crypto.subtle,
      ),
    ).toEqual({ reason: "invalid", success: false });
  });

  it("PVT-PRIV-006 stores only a q hash, not the normalized search text", async () => {
    const normalized = successful("/v1/search", "q=Cafe%CC%81");
    const queryHash = await hashNormalizedQuery(
      normalized.query,
      crypto.subtle,
    );
    const token = await issueCursor(
      cursorPayload(normalized, { queryHash }),
      keys,
      crypto.subtle,
    );
    const encodedPayload = token.split(".")[0];
    if (encodedPayload === undefined) throw new Error("cursor payload absent");
    const payloadText = atob(
      encodedPayload.replaceAll("-", "+").replaceAll("_", "/") +
        "=".repeat((4 - (encodedPayload.length % 4)) % 4),
    );
    expect(payloadText).toContain("quantclarity-cursor-v1");
    expect(payloadText).toContain('"current"');
    expect(payloadText).not.toContain("Caf");
    const wire = JSON.parse(payloadText) as unknown;
    expect(Array.isArray(wire) && wire[7]).toBe(20);
    const verified = await verifyCursor(token, keys, 1_050, 0, crypto.subtle);
    expect(verified.success && verified.payload.queryHash).toBe(queryHash);
    const reconciled = await reconcileRequestCursor(
      normalized,
      verified,
      limits,
      crypto.subtle,
    );
    expect(reconciled.publicationId).toBe(PUBLICATION);
    expect(reconciled.request.limit).toBe(20);
  });

  it.each([
    ["filters", "provider=beta"],
    ["sort", "sort=release_date"],
    ["query", "q=different"],
    ["limit", "provider=alpha&sort=name&limit=50"],
  ])("ACT-API-007 rejects cursor/request %s mismatch", async (kind, query) => {
    const original =
      kind === "query"
        ? successful("/v1/search", "q=original")
        : successful("/v1/models", "provider=alpha&sort=name");
    const payload = cursorPayload(original, {
      queryHash: await hashNormalizedQuery(original.query, crypto.subtle),
    });
    const token = await issueCursor(payload, keys, crypto.subtle);
    const verified = await verifyCursor(token, keys, 1_050, 0, crypto.subtle);
    const changed =
      kind === "query"
        ? successful("/v1/search", query)
        : successful("/v1/models", query);
    await expect(
      reconcileRequestCursor(changed, verified, limits, crypto.subtle),
    ).rejects.toThrow(/do not match/u);
  });

  it("ACT-API-007 binds an omitted continuation limit to the original page size", async () => {
    const original = successful("/v1/models", "limit=50");
    const token = await issueCursor(
      cursorPayload(original),
      keys,
      crypto.subtle,
    );
    const verified = await verifyCursor(token, keys, 1_050, 0, crypto.subtle);
    const reconciled = await reconcileRequestCursor(
      successful("/v1/models"),
      verified,
      limits,
      crypto.subtle,
    );
    expect(reconciled.publicationId).toBe(PUBLICATION);
    expect(reconciled.request.limit).toBe(50);
  });

  it("ACT-API-007 restores omitted filters and sort from the authenticated cursor", async () => {
    const original = successful(
      "/v1/models",
      "provider=alpha&sort=release_date&limit=50",
    );
    const token = await issueCursor(
      cursorPayload(original),
      keys,
      crypto.subtle,
    );
    const verified = await verifyCursor(token, keys, 1_050, 0, crypto.subtle);
    const continuation = successful("/v1/models", `cursor=${token}`);
    const reconciled = await reconcileRequestCursor(
      continuation,
      verified,
      limits,
      crypto.subtle,
    );
    expect(reconciled.request.filters).toEqual({ provider: "alpha" });
    expect(reconciled.request.sort).toEqual(["release_date", "stable_id"]);
    expect(reconciled.request.limit).toBe(50);
  });

  it.each([
    ["collection", successful("/v1/models"), 101, null],
    ["search", successful("/v1/search", "q=llama"), 21, "a".repeat(64)],
  ])(
    "ACT-API-007 refuses to sign a %s cursor above its approved route ceiling",
    async (_trace, request, limit, queryHash) => {
      await expect(
        issueCursor(
          cursorPayload(request, { limit, queryHash }),
          keys,
          crypto.subtle,
        ),
      ).rejects.toThrow(/payload is invalid/u);
    },
  );

  it("ACT-API-007 rejects an older cursor above a stricter current route ceiling", async () => {
    const request = successful("/v1/models");
    const token = await issueCursor(
      cursorPayload(request, { limit: 100 }),
      keys,
      crypto.subtle,
    );
    const verified = await verifyCursor(token, keys, 1_050, 0, crypto.subtle);
    await expect(
      reconcileRequestCursor(
        request,
        verified,
        { ...limits, maxPageSize: 50 },
        crypto.subtle,
      ),
    ).rejects.toThrow(/do not match/u);
  });

  it("ACT-API-003 rejects publication header/cursor disagreement", async () => {
    const otherPublication = "pub_00000000-0000-4000-8000-000000000099";
    const normalized = successful("/v1/models", "", "GET", otherPublication);
    const token = await issueCursor(
      cursorPayload(normalized),
      keys,
      crypto.subtle,
    );
    const verified = await verifyCursor(token, keys, 1_050, 0, crypto.subtle);
    await expect(
      reconcileRequestCursor(normalized, verified, limits, crypto.subtle),
    ).rejects.toThrow(/different publications/u);
  });
});

describe("cache, representation, and privacy helpers", () => {
  it("ACT-API-010 builds an exact/structured search plan with semantic processing disabled", () => {
    const request = successful(
      "/v1/search",
      "q=Llama%203.1&provider=alpha&limit=10",
    );
    expect(buildExactStructuredSearchPlan(request, limits)).toEqual({
      filters: { provider: "alpha" },
      kind: "exact_structured",
      limit: 10,
      query: "Llama 3.1",
      semanticCandidates: 0,
      semanticCalls: 0,
      semanticDegraded: "disabled",
    });
  });

  it("SST-SEC-007 rejects forged exact-search plan fields", () => {
    const base = successful("/v1/search", "q=llama&provider=alpha");
    for (const forged of [
      { ...base, filters: { provider: "beta,alpha" } },
      { ...base, filters: { winner: true } },
      { ...base, limit: 21 },
      { ...base, query: "x".repeat(201) },
      { ...base, sort: ["relevance", "name", "stable_id"] },
    ] as NormalizedRequest[])
      expect(() => buildExactStructuredSearchPlan(forged, limits)).toThrow();
  });

  it("ACT-API-003 builds only the closed normalized live query envelope", () => {
    const request = successful(
      "/v1/search",
      "q=Llama%203.1&provider=alpha&limit=10",
    );
    const envelope = buildQueryServiceEnvelope(
      request,
      PUBLICATION,
      "preview",
      { lastSortTuple: ["score", MODEL], stableId: MODEL },
      limits,
    );
    expect(envelope).toEqual({
      audience: "quantclarity-catalog-query-v1",
      continuation: { lastSortTuple: ["score", MODEL], stableId: MODEL },
      environment: "preview",
      filters: { provider: "alpha" },
      limit: 10,
      operation: { kind: "search" },
      publicationId: PUBLICATION,
      searchPlan: {
        filters: { provider: "alpha" },
        kind: "exact_structured",
        limit: 10,
        query: "Llama 3.1",
        semanticCandidates: 0,
        semanticCalls: 0,
        semanticDegraded: "disabled",
      },
      sort: ["relevance", "stable_id"],
      version: 1,
    });
    const serialized = JSON.stringify(envelope);
    for (const forbidden of [
      "rawUrl",
      "rawQuery",
      "headers",
      "sourceAddress",
      "actorKey",
      "correlationId",
      "requestId",
      "authorization",
      "cookie",
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it("PVT-PRIV-006 reconstructs operations without forged visitor fields", () => {
    const visitorCanary = "VISITOR_OPERATION_CANARY";
    const request = successful("/v1/search", "q=llama");
    const forged = {
      ...request,
      operation: { kind: "search", rawUrl: visitorCanary },
    } as unknown as NormalizedRequest;
    const envelope = buildQueryServiceEnvelope(
      forged,
      PUBLICATION,
      "test",
      null,
      limits,
    );
    expect(envelope.operation).toEqual({ kind: "search" });
    expect(JSON.stringify(envelope)).not.toContain(visitorCanary);
  });

  it("PVT-PRIV-006 rejects forged filters, sorts, queries, and continuations", () => {
    const base = successful("/v1/models");
    for (const forged of [
      { ...base, filters: { rawUrl: "VISITOR_CANARY" } },
      { ...base, sort: ["best", "stable_id"] },
      { ...base, sort: ["name", "release_date", "stable_id"] },
      { ...base, query: "VISITOR_CANARY" },
    ] as NormalizedRequest[])
      expect(() =>
        buildQueryServiceEnvelope(forged, PUBLICATION, "test", null, limits),
      ).toThrow();
    for (const continuation of [
      { lastSortTuple: ["Example", PROVIDER], stableId: PROVIDER },
      { lastSortTuple: [MODEL], stableId: MODEL },
    ])
      expect(() =>
        buildQueryServiceEnvelope(
          base,
          PUBLICATION,
          "test",
          continuation,
          limits,
        ),
      ).toThrow(/continuation is invalid/u);
  });

  it("PVT-PRIV-006 caches only a path-only canonical-ID detail by trusted identity", () => {
    const normalized = successful(`/v1/models/${MODEL}`);
    const decision = cacheDecision(
      normalized,
      PUBLICATION,
      "https://api.example.test",
    );
    expect(decision).toEqual({
      cacheable: true,
      internalKey: `https://api.example.test/.well-known/quantclarity-cache/v1/${PUBLICATION}/model/${MODEL}/json`,
      policy: "max-age=0, must-revalidate",
    });
  });

  it("PVT-PRIV-006 rejects a mismatched detail resource type and stable ID", () => {
    const valid = successful(`/v1/models/${MODEL}`);
    const forged = {
      ...valid,
      operation: {
        identifier: MODEL,
        kind: "detail",
        resourceType: "provider",
      },
    } as NormalizedRequest;
    expect(
      cacheDecision(forged, PUBLICATION, "https://api.example.test"),
    ).toEqual({ cacheable: false, policy: "private, no-store" });
  });

  it("PVT-PRIV-006 rejects a cache operation that disagrees with its route", () => {
    const modelDetail = successful(`/v1/models/${MODEL}`);
    const forged = {
      ...modelDetail,
      operation: {
        identifier: PROVIDER,
        kind: "detail",
        resourceType: "provider",
      },
    } as NormalizedRequest;
    expect(
      cacheDecision(forged, PUBLICATION, "https://api.example.test"),
    ).toEqual({ cacheable: false, policy: "private, no-store" });
  });

  it.each([
    "http://api.example.test",
    "https://user@api.example.test",
    "https://api.example.test/path",
    "https://api.example.test?visitor=1",
  ])("PVT-PRIV-006 rejects non-fixed cache origin %s", (origin) => {
    expect(() => {
      cacheDecision(successful(`/v1/models/${MODEL}`), PUBLICATION, origin);
    }).toThrow(/fixed exact HTTPS origin/u);
  });

  it.each([
    ["slug detail", "/v1/models/example-model", ""],
    ["collection", "/v1/models", ""],
    ["query detail", `/v1/models/${MODEL}`, "unexpected=1"],
    ["search", "/v1/search", "q=example"],
  ])("PVT-PRIV-006 marks %s no-store", (_trace, path, query) => {
    const normalized =
      path.includes(`/${MODEL}`) && query !== ""
        ? ({
            ...successful(path),
            hasQueryString: true,
          } satisfies NormalizedRequest)
        : successful(path, query);
    expect(
      cacheDecision(normalized, PUBLICATION, "https://api.example.test"),
    ).toEqual({ cacheable: false, policy: "private, no-store" });
  });

  it("PVT-PRIV-006 marks a bare question mark and forged cursor/query state no-store", () => {
    const bare = successful(`/v1/models/${MODEL}`, "", "GET", null);
    const visitorState = {
      ...bare,
      cursor: "opaque-cursor",
      hasQueryString: true,
      query: "visitor query",
    } satisfies NormalizedRequest;
    expect(
      cacheDecision(visitorState, PUBLICATION, "https://api.example.test"),
    ).toEqual({ cacheable: false, policy: "private, no-store" });
  });

  it("ACT-API-012 creates a strong publication-qualified representation ETag", async () => {
    const bytes = new TextEncoder().encode('{"data":[]}');
    const first = await representationEtag(
      PUBLICATION,
      "json",
      bytes,
      crypto.subtle,
    );
    const second = await representationEtag(
      PUBLICATION,
      "json",
      bytes,
      crypto.subtle,
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^"[0-9a-f]{64}"$/u);
    expect(ifNoneMatchMatches(`"other", ${first}`, first)).toBe(true);
    expect(ifNoneMatchMatches(`W/${first}`, first)).toBe(true);
    expect(ifNoneMatchMatches("*", first)).toBe(true);
    expect(ifNoneMatchMatches("x".repeat(257), first)).toBe(false);
  });

  it("ACT-API-011 exposes only fixed noncredentialed CORS capabilities", () => {
    expect(corsHeaders()).toEqual({
      "Access-Control-Allow-Headers":
        "If-None-Match, X-QuantClarity-Publication",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "ETag, X-QuantClarity-Publication",
      "Access-Control-Max-Age": "600",
    });
    expect("Access-Control-Allow-Credentials" in corsHeaders()).toBe(false);
  });

  it("ACT-API-011 strips only HEAD bodies", () => {
    expect(bodyForMethod("HEAD", { secret: "not-returned" })).toBeNull();
    expect(bodyForMethod("GET", { data: [] })).toEqual({ data: [] });
  });

  it("ACT-API-013 bounds error details without adding a correlation ID", () => {
    const body = boundedError(
      {
        code: "invalid_parameter",
        details: Array.from({ length: 20 }, (_, index) => ({
          parameter: index % 2 === 0 ? "q" : "limit",
          reason: "invalid",
        })),
        message: "The request is invalid.",
        status: 400,
      },
      limits,
    );
    expect(body.error.details).toHaveLength(10);
    expect(JSON.stringify(body)).not.toContain("request_id");
  });

  it("ACT-API-013 removes unrecognized error detail and caller-controlled messages", () => {
    const visitorCanary = "VISITOR_INPUT_CANARY\nset-cookie";
    const body = boundedError(
      {
        code: "invalid_parameter",
        details: [
          { parameter: visitorCanary, reason: visitorCanary },
          { parameter: "q", reason: visitorCanary },
        ],
        message: visitorCanary,
        status: 400,
      },
      limits,
    );
    expect(body).toEqual({
      error: {
        code: "invalid_parameter",
        message: "The request contains an invalid parameter.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("VISITOR_INPUT_CANARY");
  });

  it.each([
    [
      "CPU",
      {
        cpuMilliseconds: 51,
        responseBytes: 0,
        semanticCalls: 0,
        semanticCandidates: 0,
        subrequests: 0,
        upstreamCalls: 0,
      },
    ],
    [
      "response",
      {
        cpuMilliseconds: 0,
        responseBytes: 1_048_577,
        semanticCalls: 0,
        semanticCandidates: 0,
        subrequests: 0,
        upstreamCalls: 0,
      },
    ],
    [
      "semantic calls",
      {
        cpuMilliseconds: 0,
        responseBytes: 0,
        semanticCalls: 1,
        semanticCandidates: 0,
        subrequests: 16,
        upstreamCalls: 12,
      },
    ],
    [
      "semantic candidates",
      {
        cpuMilliseconds: 0,
        responseBytes: 0,
        semanticCalls: 0,
        semanticCandidates: 1,
        subrequests: 0,
        upstreamCalls: 0,
      },
    ],
    [
      "upstream",
      {
        cpuMilliseconds: 0,
        responseBytes: 0,
        semanticCalls: 0,
        semanticCandidates: 0,
        subrequests: 13,
        upstreamCalls: 13,
      },
    ],
    [
      "subrequest",
      {
        cpuMilliseconds: 0,
        responseBytes: 0,
        semanticCalls: 0,
        semanticCandidates: 0,
        subrequests: 17,
        upstreamCalls: 0,
      },
    ],
  ])(
    "ACT-API-025 fails closed when the injected %s budget is exceeded",
    (_trace, usage) => {
      expect(() => {
        assertRuntimeBudgetUsage(limits, usage);
      }).toThrow(/exceeded/u);
    },
  );
});
