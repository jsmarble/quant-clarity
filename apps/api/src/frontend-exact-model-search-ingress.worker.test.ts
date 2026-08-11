import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  canonicalExactModelSearchQuery,
  EXACT_MODEL_SEARCH_API_PATH,
  FRONTEND_API_INTERNAL_ORIGIN,
  signFrontendApiRequest,
} from "@quant-clarity/api-core";

const FRONTEND_SECRET =
  "frontend-worker-test-secret-with-at-least-32-characters";
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";

const signedRequest = async (rawQuery: string): Promise<Request> => {
  const headers = await signFrontendApiRequest({
    environment: "local",
    method: "GET",
    nowMs: Date.now(),
    path: EXACT_MODEL_SEARCH_API_PATH,
    publicationId: PUBLICATION,
    rawQuery,
    secret: FRONTEND_SECRET,
    subtle: crypto.subtle,
  });
  if (headers === null) throw new Error("test signing failed");
  headers.set("X-QuantClarity-Publication", PUBLICATION);
  return new Request(
    `${FRONTEND_API_INTERNAL_ORIGIN}${EXACT_MODEL_SEARCH_API_PATH}?${rawQuery}`,
    { headers },
  );
};

describe("signed frontend exact-Model search ingress in workerd", () => {
  it("admits the exact canonical tuple into the real named query binding", async () => {
    const rawQuery = canonicalExactModelSearchQuery("Fixture Model");
    if (rawQuery === null) throw new Error("test query failed");
    const response = await exports.default.fetch(await signedRequest(rawQuery));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "Exact Model search is temporarily unavailable.",
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.has("ETag")).toBe(false);
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.has("X-Request-ID")).toBe(false);
  });

  it("rejects signed noncanonical ordering before the query runtime", async () => {
    const response = await exports.default.fetch(
      await signedRequest("record_type=model&q=Fixture+Model&limit=20"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("X-QuantClarity-Publication")).toBeNull();
  });

  it("authenticates a bad continuation before the named query binding", async () => {
    const rawQuery = canonicalExactModelSearchQuery(
      "Fixture Model",
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
});
