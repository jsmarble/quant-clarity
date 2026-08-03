import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { MODEL_SLUG_HISTORY_ARTIFACT_VERSION } from "@quant-clarity/contracts";

import { createModelSlugHistoryCandidateFixture } from "../test/model-slug-history-candidate-fixture.js";
import {
  MODEL_SLUG_HISTORY_ARCHIVE_CONTENT_TYPE,
  MODEL_SLUG_HISTORY_ARCHIVE_RETENTION_CLASS,
  ModelSlugHistoryArchiveError,
  archiveModelSlugHistoryCandidate,
  assertModelSlugHistoryArchiveProof,
  modelSlugHistoryArchiveKey,
} from "./model-slug-history-archive.js";
import type { TrustedModelSlugHistoryCandidateCapture } from "./model-slug-history-acquisition.js";

let candidate: TrustedModelSlugHistoryCandidateCapture;

beforeAll(async () => {
  candidate = await createModelSlugHistoryCandidateFixture();
});

describe("private Model slug-history archive on pinned workerd R2", () => {
  it("conditionally creates, fully reads, and idempotently verifies one exact object", async () => {
    const first = await archiveModelSlugHistoryCandidate(
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      candidate,
    );
    assertModelSlugHistoryArchiveProof(first);
    const key = modelSlugHistoryArchiveKey(first.artifactDigest);
    const object = await env.MODEL_SLUG_ARCHIVE_BUCKET.get(key);
    if (object === null) throw new Error("archive object is missing");
    expect(object.key).toBe(key);
    expect(object.size).toBe(first.artifactByteCount);
    expect(object.httpMetadata).toEqual({
      contentType: MODEL_SLUG_HISTORY_ARCHIVE_CONTENT_TYPE,
      contentLanguage: undefined,
      contentDisposition: undefined,
      contentEncoding: undefined,
      cacheControl: "private, no-store",
      cacheExpiry: undefined,
    });
    expect(object.customMetadata).toMatchObject({
      "artifact-format": MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
      "retention-class": MODEL_SLUG_HISTORY_ARCHIVE_RETENTION_CLASS,
    });
    const bodyDigest = object.customMetadata?.["body-sha256"];
    expect(typeof bodyDigest).toBe("string");
    expect(bodyDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(object.checksums.sha256).toBeInstanceOf(ArrayBuffer);
    const text = await object.text();
    expect(text).not.toContain(candidate.privateSessionBookmark);
    expect(text).not.toContain("privateSessionBookmark");
    expect(text).not.toContain("mappings");

    const second = await archiveModelSlugHistoryCandidate(
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      candidate,
    );
    assertModelSlugHistoryArchiveProof(second);
    expect(second).toEqual(first);
  });

  it("does not overwrite a conflicting object at the computed content address", async () => {
    const initial = await archiveModelSlugHistoryCandidate(
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      candidate,
    );
    const key = modelSlugHistoryArchiveKey(initial.artifactDigest);
    await env.MODEL_SLUG_ARCHIVE_BUCKET.put(key, "TOP-SECRET corrupt object");

    const error = await archiveModelSlugHistoryCandidate(
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      candidate,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelSlugHistoryArchiveError);
    expect(error).toMatchObject({
      code: "integrity_failure",
      message: "Model slug history archive could not be persisted safely.",
    });
    expect(String(error)).not.toContain("TOP-SECRET");
    const conflicting = await env.MODEL_SLUG_ARCHIVE_BUCKET.get(key);
    if (conflicting === null) throw new Error("conflicting object is missing");
    expect(await conflicting.text()).toBe("TOP-SECRET corrupt object");
  });

  it("round-trips a large admitted candidate within the retained-heap budget", async () => {
    const admittedCandidate =
      await createModelSlugHistoryCandidateFixture(5_000);
    const proof = await archiveModelSlugHistoryCandidate(
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      admittedCandidate,
    );
    assertModelSlugHistoryArchiveProof(proof);
    expect(proof.projection.sourceHistoryCount).toBe(5_001);
    expect(proof.projection.mappingCount).toBe(5_001);
    expect(proof.artifactByteCount).toBeGreaterThan(1_000_000);
  }, 30_000);

  it("rejects an over-budget valid candidate before retaining archive copies or calling R2", async () => {
    const largeCandidate = await createModelSlugHistoryCandidateFixture(10_000);
    expect(largeCandidate.historyRows).toHaveLength(10_001);
    expect(largeCandidate.projection.mappings).toHaveLength(10_001);
    let r2Calls = 0;
    const noMutationPort = {
      get(): Promise<R2ObjectBody> {
        r2Calls += 1;
        throw new Error("R2 must not be called for an over-budget candidate");
      },
      put(): Promise<R2Object> {
        r2Calls += 1;
        throw new Error("R2 must not be called for an over-budget candidate");
      },
    };
    const error = await archiveModelSlugHistoryCandidate(
      noMutationPort,
      largeCandidate,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelSlugHistoryArchiveError);
    expect(error).toMatchObject({
      code: "integrity_failure",
      message: "Model slug history archive could not be persisted safely.",
    });
    expect(r2Calls).toBe(0);
  }, 30_000);

  it("rejects a manifest-heavy small artifact before calling R2", async () => {
    const manifestHeavyCandidate = await createModelSlugHistoryCandidateFixture(
      0,
      100_000,
    );
    expect(manifestHeavyCandidate.historyRows).toHaveLength(1);
    expect(manifestHeavyCandidate.manifest.resources).toHaveLength(100_002);
    let r2Calls = 0;
    const noMutationPort = {
      get(): Promise<R2ObjectBody> {
        r2Calls += 1;
        throw new Error("R2 must not be called for an over-budget manifest");
      },
      put(): Promise<R2Object> {
        r2Calls += 1;
        throw new Error("R2 must not be called for an over-budget manifest");
      },
    };
    const error = await archiveModelSlugHistoryCandidate(
      noMutationPort,
      manifestHeavyCandidate,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelSlugHistoryArchiveError);
    expect(error).toMatchObject({
      code: "integrity_failure",
      message: "Model slug history archive could not be persisted safely.",
    });
    expect(r2Calls).toBe(0);
  }, 30_000);
});
