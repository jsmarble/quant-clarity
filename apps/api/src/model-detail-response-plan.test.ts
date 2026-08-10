import { describe, expect, it } from "vitest";

import {
  encodeModelDetailRepresentation,
  type ApiLimits,
  type ModelDetailLookupProvenanceV2,
} from "@quant-clarity/api-core";

import type { ModelDetailApiV2Outcome } from "./model-detail-query.js";
import {
  planModelDetailResponse,
  type ModelDetailResponsePlanInput,
} from "./model-detail-response-plan.js";
import { planModelDetailRequest } from "./model-detail-request-plan.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const CURRENT_PUBLICATION = "pub_22222222-2222-4222-8222-222222222222";
const MODEL_ID = "mdl_11111111-1111-4111-8111-111111111111";
const OTHER_MODEL_ID = "mdl_22222222-2222-4222-8222-222222222222";
const FAMILY_ID = "fam_11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "evd_11111111-1111-4111-8111-111111111111";
const OBSERVED_AT = "2026-08-03T00:00:00.000Z";
const LIMITS: ApiLimits = {
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

const known = <T>(value: T) => ({
  evidence_ids: [EVIDENCE_ID],
  observed_at: OBSERVED_AT,
  state: "known" as const,
  value,
});

const unknown = () => ({
  evidence_ids: [],
  observed_at: null,
  state: "unknown" as const,
  value: null,
});

const model = (modelId = MODEL_ID, slug = "fixture-model") => ({
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
  slug: known(slug),
  source_quantization: unknown(),
  source_weight_format: unknown(),
  status: known("active"),
  total_parameters: unknown(),
});

const representation = encodeModelDetailRepresentation({
  model: model(),
  publicationId: PUBLICATION,
  schemaVersion: "1.13.0",
});
const otherRepresentation = encodeModelDetailRepresentation({
  model: model(OTHER_MODEL_ID, "other-model"),
  publicationId: PUBLICATION,
  schemaVersion: "1.13.0",
});

const provenance = (
  matchedBy: ModelDetailLookupProvenanceV2["matchedBy"],
  canonicalSlug = "fixture-model",
): ModelDetailLookupProvenanceV2 => ({
  canonicalSlug,
  matchedBy,
  projectionVersion: "model-slug@1",
});

const success = (
  matchedBy: ModelDetailLookupProvenanceV2["matchedBy"],
  overrides: Readonly<{
    canonicalSlug?: string;
    lookupValue?: string;
    selectedRepresentation?: typeof representation;
  }> = {},
): Extract<ModelDetailApiV2Outcome, { success: true }> => ({
  success: true,
  detail: (overrides.selectedRepresentation ?? representation).detail,
  lookup: {
    kind: matchedBy === "stable_id" ? "stable_id" : "slug",
    value:
      overrides.lookupValue ??
      (matchedBy === "stable_id"
        ? MODEL_ID
        : matchedBy === "current_slug"
          ? "fixture-model"
          : "former-fixture-model"),
  },
  lookupProvenance: provenance(matchedBy, overrides.canonicalSlug),
  publicationId: PUBLICATION,
  representationBytes: new Uint8Array(
    (overrides.selectedRepresentation ?? representation).representationBytes,
  ),
});

const input = (
  outcome: ModelDetailApiV2Outcome,
  overrides: Readonly<{
    identifier?: string;
    ifNoneMatch?: string | null;
    method?: "GET" | "HEAD";
    publicationHeader?: string | null;
  }> = {},
): ModelDetailResponsePlanInput => {
  const identifier = overrides.identifier ?? MODEL_ID;
  const requestPlan = planModelDetailRequest(
    {
      bodyBytes: 0,
      hasQueryString: false,
      ifNoneMatch: overrides.ifNoneMatch ?? null,
      method: overrides.method ?? "GET",
      pathname: `/v1/models/${identifier}`,
      publicationHeader: overrides.publicationHeader ?? null,
      rawQuery: "",
    },
    LIMITS,
  );
  if (requestPlan.kind !== "lookup")
    throw new Error("response-plan fixture must produce a lookup plan");
  return { outcome, requestPlan };
};

const decoded = (bytes: Uint8Array | null): unknown =>
  bytes === null ? null : JSON.parse(new TextDecoder().decode(bytes));

const expectFixedPublicHeaders = (
  headers: Readonly<Record<string, string>>,
) => {
  expect(headers).toMatchObject({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "ETag, X-QuantClarity-Publication",
    "Content-Security-Policy":
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "Permissions-Policy":
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  for (const forbidden of [
    "Access-Control-Allow-Credentials",
    "Server-Timing",
    "Set-Cookie",
    "X-Cache",
    "X-Request-ID",
  ])
    expect(headers).not.toHaveProperty(forbidden);
};

describe("Model detail pure response plan (API-002–API-004, API-011–API-013)", () => {
  it("plans stable-ID GET and HEAD from one exact representation identity", async () => {
    const get = await planModelDetailResponse(
      input(success("stable_id")),
      crypto.subtle,
    );
    const head = await planModelDetailResponse(
      input(success("stable_id"), { method: "HEAD" }),
      crypto.subtle,
    );

    expect(get.status).toBe(200);
    expect(get.method).toBe("GET");
    expect(get.bodyBytes).toEqual(representation.representationBytes);
    expect(get.headers).toMatchObject({
      "Cache-Control": "private, max-age=0, must-revalidate",
      "Content-Length": String(representation.representationBytes.byteLength),
      "Content-Type": "application/json; charset=utf-8",
      Vary: "X-QuantClarity-Publication",
      "X-QuantClarity-Publication": PUBLICATION,
    });
    expect(get.headers.ETag).toMatch(/^"[0-9a-f]{64}"$/u);
    expect(head).toMatchObject({
      bodyBytes: null,
      headers: get.headers,
      method: "HEAD",
      status: 200,
    });
    expectFixedPublicHeaders(get.headers);
  });

  it("keeps current and explicitly pinned historical slug bytes and ETags identical", async () => {
    const stable = await planModelDetailResponse(
      input(success("stable_id")),
      crypto.subtle,
    );
    for (const [matchedBy, publicationPinned] of [
      ["current_slug", false],
      ["historical_slug", true],
    ] as const) {
      const plan = await planModelDetailResponse(
        input(success(matchedBy), {
          identifier:
            matchedBy === "current_slug"
              ? "fixture-model"
              : "former-fixture-model",
          publicationHeader: publicationPinned ? PUBLICATION : null,
        }),
        crypto.subtle,
      );
      expect(plan).toMatchObject({
        bodyBytes: stable.bodyBytes,
        headers: {
          "Cache-Control": "private, no-store",
          ETag: stable.headers.ETag,
        },
        status: 200,
      });
    }
  });

  it.each(['W/"other", W/"match"', '"other", "match"', "*"])(
    "plans a bodyless 304 for conditional %s and retains identifier cache policy",
    async (candidate) => {
      const baseline = await planModelDetailResponse(
        input(success("current_slug"), { identifier: "fixture-model" }),
        crypto.subtle,
      );
      const etag = baseline.headers.ETag;
      const ifNoneMatch = candidate.replace('"match"', etag ?? '"missing"');
      const plan = await planModelDetailResponse(
        input(success("current_slug"), {
          identifier: "fixture-model",
          ifNoneMatch,
        }),
        crypto.subtle,
      );
      expect(plan).toMatchObject({
        bodyBytes: null,
        headers: {
          "Cache-Control": "private, no-store",
          ETag: etag,
          Vary: "X-QuantClarity-Publication",
          "X-QuantClarity-Publication": PUBLICATION,
        },
        status: 304,
      });
      expect(plan.headers).not.toHaveProperty("Content-Length");
      expect(plan.headers).not.toHaveProperty("Content-Type");
    },
  );

  it.each(["GET", "HEAD"] as const)(
    "plans an unpinned historical %s as a safe relative 308",
    async (method) => {
      const plan = await planModelDetailResponse(
        input(success("historical_slug"), {
          identifier: "former-fixture-model",
          ifNoneMatch: "*",
          method,
        }),
        crypto.subtle,
      );
      expect(plan).toMatchObject({
        bodyBytes: null,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Length": "0",
          Location: `/v1/models/${MODEL_ID}`,
          Vary: "X-QuantClarity-Publication",
          "X-QuantClarity-Publication": PUBLICATION,
        },
        status: 308,
      });
      expect(plan.headers).not.toHaveProperty("Content-Type");
      expect(plan.headers).not.toHaveProperty("ETag");
      expectFixedPublicHeaders(plan.headers);
      expect(JSON.stringify(plan)).not.toMatch(
        /former-fixture|visitor-canary|forwarded-host|example\.invalid/u,
      );
      expectFixedPublicHeaders(plan.headers);
    },
  );

  it.each(["GET", "HEAD"] as const)(
    "keeps a verified not-found bound to its selected publication on %s",
    async (method) => {
      const plan = await planModelDetailResponse(
        input(
          { code: "not_found", publicationId: PUBLICATION, success: false },
          { method },
        ),
        crypto.subtle,
      );
      expect(plan).toMatchObject({
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "X-QuantClarity-Publication",
          "X-QuantClarity-Publication": PUBLICATION,
        },
        status: 404,
      });
      expect(plan.bodyBytes === null).toBe(method === "HEAD");
      if (method === "GET")
        expect(plan.bodyBytes?.byteLength).toBeGreaterThan(0);
      expect(decoded(plan.bodyBytes)).toEqual(
        method === "HEAD"
          ? null
          : {
              error: {
                code: "resource_not_found",
                message: "The requested resource does not exist.",
              },
            },
      );
      expect(plan.headers).not.toHaveProperty("ETag");
    },
  );

  it("maps expired and not-ready publication outcomes without reflecting the requested pin", async () => {
    const expired = await planModelDetailResponse(
      input(
        {
          code: "publication_expired",
          currentPublicationId: CURRENT_PUBLICATION,
          success: false,
        },
        { publicationHeader: PUBLICATION },
      ),
      crypto.subtle,
    );
    expect(expired).toMatchObject({
      headers: {
        Vary: "X-QuantClarity-Publication",
        "X-QuantClarity-Publication": CURRENT_PUBLICATION,
      },
      status: 409,
    });
    expect(decoded(expired.bodyBytes)).toEqual({
      error: {
        code: "publication_expired",
        message: "The requested publication is no longer available.",
      },
    });
    expectFixedPublicHeaders(expired.headers);

    const notReady = await planModelDetailResponse(
      input({ code: "publication_not_ready", success: false }),
      crypto.subtle,
    );
    expect(notReady.status).toBe(503);
    expect(notReady.headers).not.toHaveProperty("X-QuantClarity-Publication");
    expect(notReady.headers).not.toHaveProperty("Vary");
    expect(decoded(notReady.bodyBytes)).toEqual({
      error: {
        code: "publication_not_ready",
        message: "No public dataset has been published yet.",
      },
    });
    expectFixedPublicHeaders(notReady.headers);
  });

  it.each(["integrity_failure", "invalid_input", "read_failure"] as const)(
    "maps %s to one non-reflective generic 503",
    async (code) => {
      const plan = await planModelDetailResponse(
        input({ code, success: false }),
        crypto.subtle,
      );
      expect(plan.status).toBe(503);
      expect(plan.headers).not.toHaveProperty("X-QuantClarity-Publication");
      expect(plan.headers).not.toHaveProperty("Vary");
      expect(decoded(plan.bodyBytes)).toEqual({
        error: {
          code: "temporarily_unavailable",
          message: "The Model detail is temporarily unavailable.",
        },
      });
      expectFixedPublicHeaders(plan.headers);
    },
  );

  it.each([
    [
      "stable request with current-slug provenance",
      "stable_id",
      "current_slug",
    ],
    ["slug request with stable provenance", "slug", "stable_id"],
  ] as const)(
    "fails closed for %s",
    async (_label, identifierKind, matchedBy) => {
      const plan = await planModelDetailResponse(
        input(success(matchedBy), {
          identifier:
            identifierKind === "stable_id" ? MODEL_ID : "fixture-model",
        }),
        crypto.subtle,
      );
      expect(plan.status).toBe(503);
      expect(plan.headers).not.toHaveProperty("X-QuantClarity-Publication");
    },
  );

  it("rejects crossed identifier and exact-publication plan/outcome pairs", async () => {
    const wrongStableModel = await planModelDetailResponse(
      input(
        success("stable_id", {
          lookupValue: OTHER_MODEL_ID,
          selectedRepresentation: otherRepresentation,
        }),
      ),
      crypto.subtle,
    );
    expect(wrongStableModel.status).toBe(503);

    const wrongCurrentSlug = await planModelDetailResponse(
      input(
        success("current_slug", {
          canonicalSlug: "other-model",
          lookupValue: "other-model",
          selectedRepresentation: otherRepresentation,
        }),
        { identifier: "fixture-model" },
      ),
      crypto.subtle,
    );
    expect(wrongCurrentSlug.status).toBe(503);

    const falseHistorical = await planModelDetailResponse(
      input(success("historical_slug"), { identifier: "fixture-model" }),
      crypto.subtle,
    );
    expect(falseHistorical.status).toBe(503);

    const crossedHistorical = await planModelDetailResponse(
      input(success("historical_slug"), {
        identifier: "another-former-model",
      }),
      crypto.subtle,
    );
    expect(crossedHistorical.status).toBe(503);

    const crossedSuccessPin = await planModelDetailResponse(
      input(success("stable_id"), { publicationHeader: CURRENT_PUBLICATION }),
      crypto.subtle,
    );
    expect(crossedSuccessPin.status).toBe(503);

    const crossedNotFoundPin = await planModelDetailResponse(
      input(
        { code: "not_found", publicationId: PUBLICATION, success: false },
        { publicationHeader: CURRENT_PUBLICATION },
      ),
      crypto.subtle,
    );
    expect(crossedNotFoundPin.status).toBe(503);

    const unpinnedExpired = await planModelDetailResponse(
      input({
        code: "publication_expired",
        currentPublicationId: CURRENT_PUBLICATION,
        success: false,
      }),
      crypto.subtle,
    );
    expect(unpinnedExpired.status).toBe(503);
  });

  it("fails closed on oversized bytes, representation identity drift, and digest failure", async () => {
    const oversized = {
      ...success("stable_id"),
      representationBytes: new Uint8Array(65_537),
    };
    await expect(
      planModelDetailResponse(input(oversized), crypto.subtle),
    ).resolves.toMatchObject({ status: 503 });

    const original = success("stable_id");
    const drifted = {
      ...original,
      representationBytes: new TextEncoder().encode(
        new TextDecoder()
          .decode(original.representationBytes)
          .replace(PUBLICATION, CURRENT_PUBLICATION),
      ),
    };
    await expect(
      planModelDetailResponse(input(drifted), crypto.subtle),
    ).resolves.toMatchObject({ status: 503 });

    const rejectedSubtle = {
      digest: () => Promise.reject(new Error("visitor-canary stack")),
    } as unknown as SubtleCrypto;
    const digestFailure = await planModelDetailResponse(
      input(success("stable_id")),
      rejectedSubtle,
    );
    expect(digestFailure.status).toBe(503);
    expect(JSON.stringify(digestFailure)).not.toContain("visitor-canary");
    expect(digestFailure.headers).not.toHaveProperty(
      "X-QuantClarity-Publication",
    );
  });

  it("detaches returned bytes and rejects hostile top-level DTO accessors", async () => {
    const outcome = success("stable_id");
    const plan = await planModelDetailResponse(input(outcome), crypto.subtle);
    const before = plan.bodyBytes?.[0];
    outcome.representationBytes[0] = before === 123 ? 124 : 123;
    expect(plan.bodyBytes?.[0]).toBe(before);

    let calls = 0;
    const hostile = input(success("stable_id")) as Record<string, unknown>;
    Object.defineProperty(hostile, "outcome", {
      enumerable: true,
      get: () => {
        calls += 1;
        return success("stable_id");
      },
    });
    await expect(
      planModelDetailResponse(
        hostile as unknown as ModelDetailResponsePlanInput,
        crypto.subtle,
      ),
    ).resolves.toMatchObject({ status: 503 });
    expect(calls).toBe(0);
  });

  it("keeps defensive HEAD failures bodyless and snapshots nested outcomes", async () => {
    const validHead = input(success("stable_id"), { method: "HEAD" });
    const malformedConditional = {
      ...validHead,
      requestPlan: { ...validHead.requestPlan, ifNoneMatch: "invalid" },
    } as ModelDetailResponsePlanInput;
    const conditionalFailure = await planModelDetailResponse(
      malformedConditional,
      crypto.subtle,
    );
    expect(conditionalFailure).toMatchObject({ bodyBytes: null, status: 503 });
    expectFixedPublicHeaders(conditionalFailure.headers);

    let calls = 0;
    const hostileOutcome: Record<string, unknown> = {
      detail: representation.detail,
      lookupProvenance: provenance("stable_id"),
      publicationId: PUBLICATION,
      representationBytes: representation.representationBytes,
    };
    Object.defineProperty(hostileOutcome, "success", {
      enumerable: true,
      get: () => {
        calls += 1;
        return true;
      },
    });
    const hostileFailure = await planModelDetailResponse(
      input(hostileOutcome as unknown as ModelDetailApiV2Outcome, {
        method: "HEAD",
      }),
      crypto.subtle,
    );
    expect(hostileFailure).toMatchObject({ bodyBytes: null, status: 503 });
    expect(calls).toBe(0);
  });
});
