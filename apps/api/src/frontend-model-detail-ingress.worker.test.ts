import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  FRONTEND_API_INTERNAL_ORIGIN,
  signFrontendApiRequest,
} from "@quant-clarity/api-core";

const FRONTEND_SECRET =
  "frontend-worker-test-secret-with-at-least-32-characters";
const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const MODEL_ID = "mdl_44444444-4444-4444-8444-444444444444";
const MODEL_PATH = `/v1/models/${MODEL_ID}`;

const signedRequest = async (
  publicationId: string | null,
): Promise<Request> => {
  const headers = await signFrontendApiRequest({
    environment: "local",
    method: "GET",
    nowMs: Date.now(),
    path: MODEL_PATH,
    publicationId,
    secret: FRONTEND_SECRET,
    subtle: crypto.subtle,
  });
  if (headers === null) throw new Error("test signing failed");
  if (publicationId !== null)
    headers.set("X-QuantClarity-Publication", publicationId);
  return new Request(`${FRONTEND_API_INTERNAL_ORIGIN}${MODEL_PATH}`, {
    headers,
  });
};

describe("signed frontend Model-detail ingress in workerd", () => {
  it("admits the exact four-header pinned shape into the Model executor", async () => {
    const response = await exports.default.fetch(
      await signedRequest(PUBLICATION),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "The Model detail is temporarily unavailable.",
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.has("X-Request-ID")).toBe(false);
  });

  it("keeps the same signed internal Model tuple closed without a pin", async () => {
    const response = await exports.default.fetch(await signedRequest(null));

    expect(response.status).toBe(404);
    expect(response.headers.get("X-QuantClarity-Publication")).toBeNull();
    expect(response.headers.get("Vary")).toBeNull();
  });
});
