import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  parsePublicationPin,
  publicationCacheKey,
  publicationVectorId,
  reconcilePublicationPin,
} from "./publication-consistency.js";

const PUBLICATION = "pub_00000000-0000-4000-8000-000000000001";
const PREVIOUS_PUBLICATION = "pub_00000000-0000-4000-8000-000000000002";
const MODEL = "mdl_00000000-0000-4000-8000-000000000003";

describe("publication pin validation (API-003, API-012, API-024A)", () => {
  it("accepts only exact lowercase prefixed UUIDv4 publication IDs", () => {
    expect(parsePublicationPin(null)).toBeNull();
    expect(parsePublicationPin(PUBLICATION)).toBe(PUBLICATION);
    for (const invalid of [
      "",
      PUBLICATION.toUpperCase(),
      "pub_00000000-0000-1000-8000-000000000001",
      `${PUBLICATION}, ${PREVIOUS_PUBLICATION}`,
      ` ${PUBLICATION}`,
    ])
      expect(() => parsePublicationPin(invalid)).toThrow(RangeError);
  });

  it("requires a header pin to agree with an authenticated cursor pin", () => {
    expect(reconcilePublicationPin(PUBLICATION, null)).toBe(PUBLICATION);
    expect(reconcilePublicationPin(null, PUBLICATION)).toBe(PUBLICATION);
    expect(reconcilePublicationPin(PUBLICATION, PUBLICATION)).toBe(PUBLICATION);
    expect(() =>
      reconcilePublicationPin(PUBLICATION, PREVIOUS_PUBLICATION),
    ).toThrow(/different publications/u);
  });
});

describe("publication-qualified cache identities (API-024A, PRIV-006)", () => {
  it("uses a same-origin reserved path containing only canonical identities", () => {
    expect(
      publicationCacheKey("https://api.quantclarity.example", {
        publicationId: PUBLICATION,
        representation: "json",
        resourceId: MODEL,
        resourceType: "model",
      }),
    ).toBe(
      `https://api.quantclarity.example/.well-known/quantclarity-cache/v1/${PUBLICATION}/model/${MODEL}/json`,
    );
  });

  it("rejects slugs, mismatched ID types, and non-origin cache bases", () => {
    expect(() =>
      publicationCacheKey("https://api.quantclarity.example/path", {
        publicationId: PUBLICATION,
        representation: "json",
        resourceId: MODEL,
        resourceType: "model",
      }),
    ).toThrow(/exact origin/u);
    expect(() =>
      publicationCacheKey("https://api.quantclarity.example", {
        publicationId: PUBLICATION,
        representation: "json",
        resourceId: "model-slug",
        resourceType: "model",
      }),
    ).toThrow(/stable UUIDv4/u);
    expect(() =>
      publicationCacheKey("https://api.quantclarity.example", {
        publicationId: PUBLICATION,
        representation: "json",
        resourceId: MODEL,
        resourceType: "provider",
      }),
    ).toThrow(/stable UUIDv4/u);
    expect(() =>
      publicationCacheKey("https://api.quantclarity.example", {
        publicationId: PUBLICATION,
        representation: "json/path" as "json",
        resourceId: MODEL,
        resourceType: "model",
      }),
    ).toThrow(/Representation/u);
  });
});

describe("publication-qualified Vectorize identity (SRCH-007, CF-022)", () => {
  it("produces the full deterministic SHA-256 within Vectorize's 64-byte ID limit", async () => {
    const vectorId = await publicationVectorId(PUBLICATION, "model", MODEL);
    const expected = createHash("sha256")
      .update(`quantclarity-vector-v1\0${PUBLICATION}\0model\0${MODEL}`)
      .digest("hex");
    expect(vectorId).toBe(expected);
    expect(vectorId).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("changes across publication namespaces and rejects mismatched resource IDs", async () => {
    await expect(
      publicationVectorId(PREVIOUS_PUBLICATION, "model", MODEL),
    ).resolves.not.toBe(await publicationVectorId(PUBLICATION, "model", MODEL));
    await expect(
      publicationVectorId(PUBLICATION, "variant", MODEL),
    ).rejects.toThrow(/stable UUIDv4/u);
  });
});
