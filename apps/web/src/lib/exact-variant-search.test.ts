import { describe, expect, it, vi } from "vitest";

import {
  canonicalExactVariantSearchQuery,
  encodeExactVariantCardCollectionRepresentation,
  EXACT_VARIANT_SEARCH_API_PATH,
  FRONTEND_API_INTERNAL_ORIGIN,
  verifyFrontendApiRequest,
  type ExactVariantCardCollection,
} from "@quant-clarity/api-core";

import {
  readExactVariantSearchState,
  type ExactVariantSearchEnv,
} from "./exact-variant-search.js";

const SECRET = "exact-variant-test-secret-with-at-least-32-characters";
const NOW = 1_786_339_200_000;
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const RETAINED = "pub_22222222-2222-4222-8222-222222222222";
const VARIANT = "var_11111111-1111-4111-8111-111111111111";
const MODEL = "mdl_11111111-1111-4111-8111-111111111111";
const FAMILY = "fam_11111111-1111-4111-8111-111111111111";
const EVIDENCE = "evd_11111111-1111-4111-8111-111111111111";
const OBSERVED = "2026-08-01T00:00:00.000Z";
const UTF8 = new TextEncoder();
const QUERY = canonicalExactVariantSearchQuery("Fixture FP8 Variant");
if (QUERY === null) throw new Error("test query must be canonical");

const commonHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "X-QuantClarity-Publication",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Permissions-Policy":
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

const collection = (
  publicationId = PUBLICATION,
): ExactVariantCardCollection => {
  const encoded = encodeExactVariantCardCollectionRepresentation({
    data: [
      {
        match_kind: "canonical_name",
        variant: {
          variant_id: VARIANT,
          model_id: MODEL,
          family_id: FAMILY,
          variant_kind: {
            evidence_ids: [EVIDENCE],
            observed_at: OBSERVED,
            state: "known",
            value: "publisher_precision_variant",
          },
          display_name: {
            evidence_ids: [EVIDENCE],
            observed_at: OBSERVED,
            state: "known",
            value: "Fixture FP8 Variant",
          },
          publisher: {
            evidence_ids: [EVIDENCE],
            observed_at: OBSERVED,
            state: "known",
            value: "Fixture Publisher",
          },
          total_parameters: {
            evidence_ids: [EVIDENCE],
            observed_at: OBSERVED,
            state: "known",
            value: {
              approximation: "exact",
              normalized_decimal: "1000000000",
              raw_value: "1B",
            },
          },
          active_parameters: {
            evidence_ids: [],
            observed_at: null,
            state: "unknown",
            value: null,
          },
          source_weight_format: {
            evidence_ids: [],
            observed_at: null,
            state: "unavailable",
            value: null,
          },
          source_quantization: {
            evidence_ids: [EVIDENCE],
            observed_at: OBSERVED,
            state: "known",
            value: "FP8",
          },
          cataloged_provider_count: {
            derivation_version: "cataloged-provider-count@1",
            observed_at: OBSERVED,
            value: 1,
          },
          last_model_data_refresh: {
            evidence_ids: [EVIDENCE],
            observed_at: OBSERVED,
            state: "known",
            value: OBSERVED,
          },
        },
      },
    ],
    meta: {
      filters: { record_type: "variant" },
      publication_id: publicationId,
      resource: "exact_variant_cards",
      schema_version: "1.0.0",
      sort: ["relevance", "stable_id"],
    },
    page: { limit: 20, next_cursor: null },
  });
  if (encoded === null) throw new Error("test collection must encode");
  return encoded.collection;
};

const successResponse = (
  selected = collection(),
  bytesOverride?: Uint8Array,
  mutateHeaders?: (headers: Headers) => void,
): Response => {
  const encoded = encodeExactVariantCardCollectionRepresentation(selected);
  if (encoded === null) throw new Error("test collection must encode");
  const bytes = bytesOverride ?? encoded.representationBytes;
  const headers = new Headers({
    ...commonHeaders,
    "Cache-Control": "private, no-store",
    "Content-Length": String(bytes.byteLength),
    "Content-Type": "application/json; charset=utf-8",
    Vary: "X-QuantClarity-Publication",
    "X-QuantClarity-Publication": selected.meta.publication_id,
  });
  mutateHeaders?.(headers);
  return new Response(bytes, { headers, status: 200 });
};

const invalidCursorResponse = (): Response => {
  const bytes = UTF8.encode(
    JSON.stringify({
      error: { code: "invalid_cursor", message: "The cursor is invalid." },
    }),
  );
  return new Response(bytes, {
    headers: {
      ...commonHeaders,
      "Cache-Control": "private, no-store",
      "Content-Length": String(bytes.byteLength),
      "Content-Type": "application/json; charset=utf-8",
    },
    status: 400,
  });
};

const environment = (
  response: Response,
): ExactVariantSearchEnv & {
  fetch: ReturnType<typeof vi.fn<(input: Request) => Promise<Response>>>;
} => {
  const fetch = vi.fn<(input: Request) => Promise<Response>>(() =>
    Promise.resolve(response),
  );
  return {
    API: { fetch },
    DEPLOYMENT_ENV: "local",
    FRONTEND_API_HMAC_CURRENT: SECRET,
    fetch,
  };
};

describe("publication-pinned frontend exact Variant search client (FE-020–FE-027, API-003, PRIV-006)", () => {
  it("sends one fresh identity-free signed GET and admits exact canonical bytes", async () => {
    const env = environment(successResponse());
    await expect(
      readExactVariantSearchState(env, QUERY, PUBLICATION, NOW),
    ).resolves.toEqual({ collection: collection(), kind: "found" });
    expect(env.fetch).toHaveBeenCalledOnce();
    const request = env.fetch.mock.calls[0]?.[0];
    expect(request?.url).toBe(
      `${FRONTEND_API_INTERNAL_ORIGIN}${EXACT_VARIANT_SEARCH_API_PATH}?${QUERY}`,
    );
    expect([...request!.headers.keys()].sort()).toEqual([
      "x-quantclarity-internal-envelope",
      "x-quantclarity-internal-key-slot",
      "x-quantclarity-internal-signature",
      "x-quantclarity-publication",
    ]);
    await expect(
      verifyFrontendApiRequest({
        environment: "local",
        nowMs: NOW,
        request: request!,
        secrets: { current: SECRET },
        subtle: crypto.subtle,
      }),
    ).resolves.toMatchObject({
      envelope: {
        path: EXACT_VARIANT_SEARCH_API_PATH,
        publication_id: PUBLICATION,
      },
    });
  });

  it("retains an explicit publication pin and narrowly admits invalid cursors", async () => {
    const retained = collection(RETAINED);
    await expect(
      readExactVariantSearchState(
        environment(successResponse(retained)),
        QUERY,
        RETAINED,
        NOW,
      ),
    ).resolves.toEqual({ collection: retained, kind: "found" });
    await expect(
      readExactVariantSearchState(
        environment(invalidCursorResponse()),
        canonicalExactVariantSearchQuery("Fixture FP8 Variant", "opaque")!,
        PUBLICATION,
        NOW,
      ),
    ).resolves.toEqual({ kind: "invalid_cursor" });
    await expect(
      readExactVariantSearchState(
        environment(invalidCursorResponse()),
        QUERY,
        PUBLICATION,
        NOW,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("rejects noncanonical bytes and any expanded Variant-card shape", async () => {
    const expanded = {
      ...collection(),
      data: [
        {
          ...collection().data[0],
          variant: {
            ...collection().data[0]!.variant,
            provider_name: "Forbidden provider projection",
          },
        },
      ],
    };
    const expandedBytes = UTF8.encode(JSON.stringify(expanded));
    await expect(
      readExactVariantSearchState(
        environment(successResponse(collection(), expandedBytes)),
        QUERY,
        PUBLICATION,
        NOW,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    const reordered = {
      meta: collection().meta,
      page: collection().page,
      data: collection().data,
    };
    await expect(
      readExactVariantSearchState(
        environment(
          successResponse(collection(), UTF8.encode(JSON.stringify(reordered))),
        ),
        QUERY,
        PUBLICATION,
        NOW,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it("rejects a nonexact response profile", async () => {
    await expect(
      readExactVariantSearchState(
        environment(
          successResponse(collection(), undefined, (headers) => {
            headers.set("Cache-Control", "public");
            headers.set("X-Visitor", "forbidden");
          }),
        ),
        QUERY,
        PUBLICATION,
        NOW,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it.each(["test", "preview", "production"] as const)(
    "keeps %s closed before signing or calling the binding",
    async (deploymentEnvironment) => {
      const env = environment(successResponse());
      env.DEPLOYMENT_ENV = deploymentEnvironment;
      await expect(
        readExactVariantSearchState(env, QUERY, PUBLICATION, NOW),
      ).resolves.toEqual({ kind: "unavailable" });
      expect(env.fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid inputs before fetch and enforces one deadline", async () => {
    const env = environment(successResponse());
    await expect(
      readExactVariantSearchState(env, "q=not-canonical", PUBLICATION, NOW),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(env.fetch).not.toHaveBeenCalled();

    let request: Request | undefined;
    const fetch = vi.fn((input: Request) => {
      request = input;
      return new Promise<Response>(() => undefined);
    });
    await expect(
      readExactVariantSearchState(
        {
          API: { fetch },
          DEPLOYMENT_ENV: "local",
          FRONTEND_API_HMAC_CURRENT: SECRET,
        } satisfies ExactVariantSearchEnv,
        QUERY,
        PUBLICATION,
        NOW,
        crypto.subtle,
        5,
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(request?.signal.aborted).toBe(true);
  });
});
