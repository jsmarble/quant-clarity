import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  canonicalExactVariantSearchQuery,
  EXACT_VARIANT_SEARCH_API_PATH,
  FRONTEND_API_INTERNAL_ORIGIN,
  signFrontendApiRequest,
  type FrontendApiEnvironment,
} from "@quant-clarity/api-core";

const FRONTEND_SECRET =
  "frontend-worker-test-secret-with-at-least-32-characters";
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";

const signedRequest = async (
  rawQuery: string,
  environment: FrontendApiEnvironment = "local",
): Promise<Request> => {
  const headers = await signFrontendApiRequest({
    environment,
    method: "GET",
    nowMs: Date.now(),
    path: EXACT_VARIANT_SEARCH_API_PATH,
    publicationId: PUBLICATION,
    rawQuery,
    secret: FRONTEND_SECRET,
    subtle: crypto.subtle,
  });
  if (headers === null) throw new Error("test signing failed");
  headers.set("X-QuantClarity-Publication", PUBLICATION);
  return new Request(
    `${FRONTEND_API_INTERNAL_ORIGIN}${EXACT_VARIANT_SEARCH_API_PATH}?${rawQuery}`,
    { headers },
  );
};

describe("signed frontend exact-Variant ingress in workerd", () => {
  it("admits the exact purpose tuple into only the real named query binding", async () => {
    const rawQuery = canonicalExactVariantSearchQuery("Fixture Variant");
    if (rawQuery === null) throw new Error("test query failed");
    const response = await exports.default.fetch(await signedRequest(rawQuery));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "Exact Variant search is temporarily unavailable.",
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.has("ETag")).toBe(false);
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.has("X-Request-ID")).toBe(false);
  });

  it("rejects noncanonical query bytes before the query runtime", async () => {
    const response = await exports.default.fetch(
      await signedRequest("record_type=variant&q=Fixture+Variant&limit=20"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("X-QuantClarity-Publication")).toBeNull();
  });

  it("authenticates a bad continuation before the named binding", async () => {
    const rawQuery = canonicalExactVariantSearchQuery(
      "Fixture Variant",
      "tampered",
    );
    if (rawQuery === null) throw new Error("test query failed");
    const response = await exports.default.fetch(await signedRequest(rawQuery));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_cursor", message: "The cursor is invalid." },
    });
    expect(response.headers.has("ETag")).toBe(false);
  });

  it.each(["preview", "production"] as const)(
    "retains signed ingress closure in %s",
    async (environment) => {
      const rawQuery = canonicalExactVariantSearchQuery("Fixture Variant");
      if (rawQuery === null) throw new Error("test query failed");
      const response = await exports.default.fetch(
        await signedRequest(rawQuery, environment),
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.has("X-QuantClarity-Publication")).toBe(false);
    },
  );
});
