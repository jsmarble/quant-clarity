import { afterEach, describe, expect, it, vi } from "vitest";

import { encodeModelDetailRepresentation } from "@quant-clarity/api-core";

import {
  modelDetailCacheRequest,
  readModelDetailThroughCache,
} from "./model-detail-cache.js";
import type { ModelDetailSelectedReadV2Outcome } from "./model-detail-query.js";

const ORIGIN = "https://cache-runtime.api.example.test";
const PUBLICATION = "pub_33333333-3333-4333-8333-333333333333";
const OTHER_PUBLICATION = "pub_44444444-4444-4444-8444-444444444444";
const MODEL_ID = "mdl_33333333-3333-4333-8333-333333333333";
const FAMILY_ID = "fam_33333333-3333-4333-8333-333333333333";
const EVIDENCE_ID = "evd_33333333-3333-4333-8333-333333333333";
const OBSERVED_AT = "2026-08-03T00:00:00.000Z";

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
  display_name: known("Runtime Cache Model"),
  family_id: FAMILY_ID,
  last_model_data_refresh: known(OBSERVED_AT),
  license: unknown(),
  maximum_output_tokens: unknown(),
  modalities: unknown(),
  model_id: MODEL_ID,
  publisher: known("Runtime Publisher"),
  release_date: unknown(),
  slug: known("runtime-cache-model"),
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

const outcome = (): Extract<
  ModelDetailSelectedReadV2Outcome,
  { success: true }
> => ({
  success: true,
  detail: representation.detail,
  lookup: { kind: "stable_id", value: MODEL_ID },
  lookupProvenance: {
    canonicalSlug: "runtime-cache-model",
    matchedBy: "stable_id",
    projectionVersion: "model-slug@1",
  },
  publicationId: PUBLICATION,
  representationBytes: new Uint8Array(representation.representationBytes),
});

const keys = [
  modelDetailCacheRequest(ORIGIN, PUBLICATION, MODEL_ID),
  modelDetailCacheRequest(ORIGIN, OTHER_PUBLICATION, MODEL_ID),
];

afterEach(async () => {
  await Promise.all(
    keys.map((key) =>
      key === null ? Promise.resolve(false) : caches.default.delete(key),
    ),
  );
});

const execute = async (
  publicationId: string,
  readCanonical: () => Promise<ModelDetailSelectedReadV2Outcome>,
) => {
  const scheduled: Promise<void>[] = [];
  const result = await readModelDetailThroughCache({
    cache: caches.default,
    modelId: MODEL_ID,
    protectedOrigin: ORIGIN,
    publicationId,
    readCanonical,
    schedule: (promise) => scheduled.push(promise),
    subtle: crypto.subtle,
  });
  await Promise.all(scheduled);
  return result;
};

describe("Model detail Cache API in workerd (API-024, CF-020, PRIV-006)", () => {
  it("fills on a cold read and serves the validated warm entry", async () => {
    const firstRead = vi.fn(() => Promise.resolve(outcome()));
    await expect(execute(PUBLICATION, firstRead)).resolves.toEqual(outcome());
    expect(firstRead).toHaveBeenCalledOnce();

    const warmRead = vi.fn(() =>
      Promise.reject(new Error("canonical reader must not run on a warm hit")),
    );
    await expect(execute(PUBLICATION, warmRead)).resolves.toEqual(outcome());
    expect(warmRead).not.toHaveBeenCalled();
  });

  it("treats an actually cached corrupt object as a canonical miss", async () => {
    const key = modelDetailCacheRequest(ORIGIN, PUBLICATION, MODEL_ID);
    if (key === null) throw new Error("runtime cache key fixture is invalid");
    await caches.default.put(
      key,
      new Response("visitor-canary", {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=300, must-revalidate",
          "Content-Length": "14",
          "Content-Type": "application/json; charset=utf-8",
          ETag: '"wrong"',
          "X-QuantClarity-Publication": PUBLICATION,
        },
      }),
    );
    const readCanonical = vi.fn(() => Promise.resolve(outcome()));
    const result = await execute(PUBLICATION, readCanonical);
    expect(result).toEqual(outcome());
    expect(JSON.stringify(result)).not.toContain("visitor-canary");
    expect(readCanonical).toHaveBeenCalledOnce();
  });

  it("isolates cache objects by selected publication", async () => {
    await execute(PUBLICATION, () => Promise.resolve(outcome()));
    const otherRead = vi.fn(() =>
      Promise.resolve<ModelDetailSelectedReadV2Outcome>({
        code: "not_found",
        publicationId: OTHER_PUBLICATION,
        success: false,
      }),
    );
    await expect(execute(OTHER_PUBLICATION, otherRead)).resolves.toEqual({
      code: "not_found",
      publicationId: OTHER_PUBLICATION,
      success: false,
    });
    expect(otherRead).toHaveBeenCalledOnce();
  });
});
