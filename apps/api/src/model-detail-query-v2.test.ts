import { describe, expect, it, vi } from "vitest";

import type { ApiLimits, NormalizedRequest } from "@quant-clarity/api-core";

import {
  readModelDetailFromQueryV2,
  type ModelDetailApiV2Input,
  type ModelDetailApiV2Outcome,
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
  readModelDetailV2: vi.fn(() => Promise.resolve(readOutcome)),
  resolvePublicationV2: vi.fn((inputValue: unknown) => {
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
