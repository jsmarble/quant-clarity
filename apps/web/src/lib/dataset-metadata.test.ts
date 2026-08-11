import { describe, expect, it, vi } from "vitest";

import { verifyFrontendApiRequest } from "@quant-clarity/api-core";
import type { DatasetMetadata } from "@quant-clarity/contracts";

import {
  readPublicationState,
  type DatasetMetadataEnv,
} from "./dataset-metadata.js";

const SECRET = "frontend-test-secret-with-at-least-32-characters";
const NOW = 1_786_339_200_000;

const metadata = (): DatasetMetadata => ({
  publication_id: "pub_11111111-1111-4111-8111-111111111111",
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
  counts: { active_models: 2, active_offerings: 3, active_providers: 1 },
  degradation_notices: [],
});

function environment(
  response: Response,
): DatasetMetadataEnv & { fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn(() => Promise.resolve(response));
  return {
    API: { fetch },
    DEPLOYMENT_ENV: "test",
    FRONTEND_API_HMAC_CURRENT: SECRET,
    fetch,
  };
}

describe("SSR publication metadata (FE-009, API-003, API-015, PRIV-006, PRIV-011)", () => {
  it("returns validated canonical metadata over a signed identity-free request", async () => {
    const body = JSON.stringify(metadata());
    const env = environment(
      new Response(body, {
        headers: {
          "Content-Length": String(new TextEncoder().encode(body).byteLength),
          "Content-Type": "application/json; charset=utf-8",
        },
      }),
    );
    await expect(readPublicationState(env, NOW)).resolves.toEqual({
      kind: "published",
      metadata: metadata(),
    });
    const request = env.fetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://frontend-api.internal/v1/metadata");
    expect([...request.headers.keys()].sort()).toEqual([
      "x-quantclarity-internal-envelope",
      "x-quantclarity-internal-key-slot",
      "x-quantclarity-internal-signature",
    ]);
    expect(request.headers.has("cf-connecting-ip")).toBe(false);
    expect(request.headers.has("cookie")).toBe(false);
    expect(request.headers.has("referer")).toBe(false);
  });

  it("distinguishes an unpublished dataset from an unavailable dependency", async () => {
    const pending = environment(
      Response.json(
        {
          error: {
            code: "publication_not_ready",
            message: "No public dataset has been published yet.",
          },
        },
        { status: 503 },
      ),
    );
    await expect(readPublicationState(pending, NOW)).resolves.toEqual({
      kind: "not_published",
    });
    const failure = environment(
      Response.json(
        { error: { code: "temporarily_unavailable", message: "Unavailable." } },
        { status: 503 },
      ),
    );
    await expect(readPublicationState(failure, NOW)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it.each([
    new Response("not json", {
      headers: { "Content-Type": "application/json" },
    }),
    Response.json({ ...metadata(), unexpected: true }),
    new Response(JSON.stringify(metadata()), {
      headers: {
        "Content-Length": "65537",
        "Content-Type": "application/json",
      },
    }),
    new Response(JSON.stringify(metadata()), {
      headers: { "Content-Type": "application/jsonp" },
    }),
    new Response(null, { status: 204 }),
  ])(
    "fails closed on malformed, additive, oversized, or unexpected responses",
    async (response) => {
      await expect(
        readPublicationState(environment(response), NOW),
      ).resolves.toEqual({
        kind: "unavailable",
      });
    },
  );

  it("fails closed when the binding, signing key, or runtime rejects", async () => {
    const env = environment(Response.json(metadata()));
    env.API.fetch = vi.fn(() => Promise.reject(new Error("private detail")));
    await expect(readPublicationState(env, NOW)).resolves.toEqual({
      kind: "unavailable",
    });
    await expect(
      readPublicationState({ ...env, FRONTEND_API_HMAC_CURRENT: "weak" }, NOW),
    ).resolves.toEqual({ kind: "unavailable" });
  });

  it.each([
    new Response(
      JSON.stringify({
        error: {
          code: "publication_not_ready",
          message: "No public dataset has been published yet.",
        },
      }),
      { status: 503 },
    ),
    Response.json(
      {
        error: {
          code: "publication_not_ready",
          message: "No public dataset has been published yet.",
          extra: true,
        },
      },
      { status: 503 },
    ),
    Response.json(
      {
        error: { code: "publication_not_ready", message: "different" },
      },
      { status: 503 },
    ),
    new Response(
      JSON.stringify({
        error: {
          code: "publication_not_ready",
          message: "No public dataset has been published yet.",
        },
      }),
      {
        headers: { "Content-Type": "application/json-malformed" },
        status: 503,
      },
    ),
  ])(
    "does not turn a malformed 503 into a confident unpublished state",
    async (response) => {
      await expect(
        readPublicationState(environment(response), NOW),
      ).resolves.toEqual({ kind: "unavailable" });
    },
  );

  it("bounds a stalled service binding and aborts its identity-free request", async () => {
    let captured: Request | undefined;
    const env: DatasetMetadataEnv = {
      API: {
        fetch(request) {
          captured = request;
          return new Promise<Response>(() => undefined);
        },
      },
      DEPLOYMENT_ENV: "test",
      FRONTEND_API_HMAC_CURRENT: SECRET,
    };
    const started = performance.now();
    await expect(
      readPublicationState(env, NOW, crypto.subtle, 5),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(performance.now() - started).toBeLessThan(100);
    expect(captured?.signal.aborted).toBe(true);
  });

  it("bounds a response body that stalls after the binding resolves", async () => {
    const stalledBody = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
    });
    const env = environment(
      new Response(stalledBody, {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const started = performance.now();
    await expect(
      readPublicationState(env, NOW, crypto.subtle, 5),
    ).resolves.toEqual({ kind: "unavailable" });
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("uses the API overlap key during a staged current-key rotation", async () => {
    const oldKey = "old-frontend-key-with-at-least-32-characters";
    const newKey = "new-frontend-key-with-at-least-32-characters";
    for (const secrets of [
      { current: oldKey, next: newKey },
      { current: newKey, next: oldKey },
    ]) {
      const env: DatasetMetadataEnv = {
        API: {
          async fetch(request) {
            const verified = await verifyFrontendApiRequest({
              environment: "test",
              nowMs: NOW,
              request,
              secrets,
              subtle: crypto.subtle,
            });
            return verified === null
              ? Response.json({ error: { code: "forbidden" } }, { status: 404 })
              : Response.json(metadata());
          },
        },
        DEPLOYMENT_ENV: "test",
        FRONTEND_API_HMAC_CURRENT: newKey,
      };
      await expect(readPublicationState(env, NOW)).resolves.toMatchObject({
        kind: "published",
      });
    }
  });
});
