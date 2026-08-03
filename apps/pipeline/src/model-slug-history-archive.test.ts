import { beforeAll, describe, expect, it } from "vitest";

import {
  MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES,
  MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
  checkModelSlugHistoryArtifactContract,
} from "@quant-clarity/contracts";
import { projectModelSlugArchiveArtifactProofV5 } from "@quant-clarity/publication-core";

import { createModelSlugHistoryCandidateFixture } from "../test/model-slug-history-candidate-fixture.js";
import {
  MODEL_SLUG_HISTORY_ARCHIVE_CONTENT_TYPE,
  MODEL_SLUG_HISTORY_ARCHIVE_RETENTION_CLASS,
  ModelSlugHistoryArchiveError,
  archiveModelSlugHistoryCandidate,
  assertFreshModelSlugRollbackProof,
  assertModelSlugHistoryArchiveProof,
  modelSlugHistoryArchiveKey,
  readFreshModelSlugRollbackProof,
  verifyArchivedModelSlugHistoryForRollback,
} from "./model-slug-history-archive.js";
import type { TrustedModelSlugHistoryCandidateCapture } from "./model-slug-history-acquisition.js";

interface StoredObject {
  bytes: Uint8Array<ArrayBuffer>;
  checksum: ArrayBuffer;
  customMetadata: Record<string, string>;
  httpMetadata: Record<string, string | undefined>;
  declaredSize?: number;
  endlessEmptyStream?: boolean;
  oneByteChunks?: boolean;
  streamFailure?: boolean;
}

type BucketMode = "normal" | "throw-before" | "throw-after" | "throw-get";

const copyBytes = (
  value: ArrayBuffer | ArrayBufferView,
): Uint8Array<ArrayBuffer> => {
  const view = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  return Uint8Array.from(view);
};

class MemoryArchiveBucket {
  readonly objects = new Map<string, StoredObject>();
  readonly puts: {
    key: string;
    options: R2PutOptions | undefined;
  }[] = [];
  mode: BucketMode = "normal";

  readonly binding = {
    put: (
      key: string,
      value:
        ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
      options?: R2PutOptions,
    ): Promise<R2Object | null> => {
      this.puts.push({ key, options });
      if (this.mode === "throw-before")
        throw new Error("TOP-SECRET ambiguous put before application");
      if (
        options?.onlyIf instanceof Headers ||
        options?.onlyIf?.etagDoesNotMatch !== "*"
      )
        throw new Error("test expected create-only conditional");
      if (this.objects.has(key)) return Promise.resolve(null);
      if (!ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer))
        throw new Error("test expected byte body");
      if (options.sha256 === undefined || typeof options.sha256 === "string")
        throw new Error("test expected SHA-256 bytes");
      const bytes = copyBytes(value);
      const checksum = copyBytes(options.sha256).buffer;
      this.objects.set(key, {
        bytes,
        checksum,
        customMetadata: { ...options.customMetadata },
        httpMetadata:
          options.httpMetadata instanceof Headers
            ? {}
            : {
                contentType: options.httpMetadata?.contentType,
                contentLanguage: undefined,
                contentDisposition: undefined,
                contentEncoding: undefined,
                cacheControl: options.httpMetadata?.cacheControl,
                cacheExpiry: undefined,
              },
      });
      if (this.mode === "throw-after")
        throw new Error("TOP-SECRET ambiguous put after application");
      const stored = this.objects.get(key);
      if (stored === undefined) throw new Error("test object was not stored");
      return Promise.resolve(this.objectMetadata(key, stored));
    },
    get: (key: string): Promise<R2ObjectBody | null> => {
      if (this.mode === "throw-get")
        throw new Error("TOP-SECRET hostile read failure");
      const stored = this.objects.get(key);
      return Promise.resolve(
        stored === undefined ? null : this.objectBody(key, stored),
      );
    },
  } as unknown as R2Bucket;

  private objectMetadata(key: string, stored: StoredObject): R2Object {
    return {
      key,
      version: "vendor-version-must-not-be-authority",
      size: stored.declaredSize ?? stored.bytes.byteLength,
      etag: "vendor-etag-must-not-be-authority",
      httpEtag: '"vendor-etag-must-not-be-authority"',
      checksums: this.checksums(stored.checksum),
      uploaded: new Date(0),
      httpMetadata: stored.httpMetadata,
      customMetadata: stored.customMetadata,
      storageClass: "Standard",
      writeHttpMetadata(headers: Headers) {
        void headers;
      },
    };
  }

  private objectBody(key: string, stored: StoredObject): R2ObjectBody {
    const metadata = this.objectMetadata(key, stored);
    const bytes = Uint8Array.from(stored.bytes);
    return {
      key: metadata.key,
      version: metadata.version,
      size: metadata.size,
      etag: metadata.etag,
      httpEtag: metadata.httpEtag,
      checksums: metadata.checksums,
      uploaded: metadata.uploaded,
      httpMetadata: stored.httpMetadata,
      customMetadata: stored.customMetadata,
      storageClass: metadata.storageClass,
      writeHttpMetadata(headers: Headers) {
        metadata.writeHttpMetadata(headers);
      },
      body:
        stored.endlessEmptyStream === true
          ? new ReadableStream<Uint8Array<ArrayBuffer>>({
              pull(controller) {
                controller.enqueue(new Uint8Array(0));
              },
            })
          : stored.oneByteChunks === true
            ? new ReadableStream<Uint8Array<ArrayBuffer>>({
                start(controller) {
                  for (const byte of bytes)
                    controller.enqueue(Uint8Array.of(byte));
                  controller.close();
                },
              })
            : new ReadableStream<Uint8Array<ArrayBuffer>>({
                start(controller) {
                  if (stored.streamFailure === true) {
                    controller.error(new Error("TOP-SECRET hostile stream"));
                    return;
                  }
                  controller.enqueue(bytes);
                  controller.close();
                },
              }),
      bodyUsed: false,
      arrayBuffer: () => Promise.resolve(bytes.buffer),
      bytes: () => Promise.resolve(bytes),
      text: () => Promise.resolve(new TextDecoder().decode(bytes)),
      json: <T>() =>
        Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)) as T),
      blob: () => Promise.resolve(new Blob([bytes])),
    };
  }

  private checksums(sha256: ArrayBuffer): R2Checksums {
    return {
      sha256,
      toJSON: () => ({ sha256: "unused" }),
    };
  }
}

let candidate: TrustedModelSlugHistoryCandidateCapture;

beforeAll(async () => {
  candidate = await createModelSlugHistoryCandidateFixture();
});

const expectStaticError = async (
  operation: Promise<unknown>,
  code: ModelSlugHistoryArchiveError["code"],
): Promise<void> => {
  const error = await operation.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ModelSlugHistoryArchiveError);
  expect(error).toMatchObject({
    code,
    message: "Model slug history archive could not be persisted safely.",
  });
  expect(String(error)).not.toContain("TOP-SECRET");
  expect(String(error)).not.toContain(candidate.privateSessionBookmark);
};

const expectedRollbackProof = (
  archive: Awaited<ReturnType<typeof archiveModelSlugHistoryCandidate>>,
  artifactDigest = archive.artifactDigest,
) =>
  projectModelSlugArchiveArtifactProofV5({
    manifest: candidate.manifest,
    projection: archive.projection,
    observation: {
      publicationId: archive.publicationId,
      closureHash: archive.closureHash,
      baseBundleHash: archive.baseBundleHash,
      publicationBoundaryMs: archive.publicationBoundaryMs,
      artifactVersion: archive.artifactVersion,
      acquisitionVersion: archive.acquisitionVersion,
      artifactDigest,
      artifactByteCount: archive.artifactByteCount,
      readVerified: true,
      immutable: true,
    },
  });

const rollbackFreshness = Object.freeze({
  observedAtMs: Date.parse("2026-08-03T12:01:00.000Z"),
  maximumAgeMs: 60 * 60 * 1_000,
});

describe("private Model slug-history R2 archive", () => {
  it("writes canonical allowlisted bytes at a domain-separated content address and read-verifies them", async () => {
    const memory = new MemoryArchiveBucket();
    const proof = await archiveModelSlugHistoryCandidate(
      memory.binding,
      candidate,
    );

    assertModelSlugHistoryArchiveProof(proof);
    expect(proof).toMatchObject({
      artifactVersion: MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
      acquisitionVersion: candidate.acquisitionVersion,
      publicationId: candidate.publicationId,
      baseBundleHash: candidate.bundleHash,
      closureHash: candidate.closureHash,
      publicationBoundaryMs: candidate.publicationBoundaryMs,
      projection: candidate.projection,
    });
    expect(Object.isFrozen(proof)).toBe(true);
    expect(memory.puts).toHaveLength(1);
    const put = memory.puts[0]!;
    expect(put.key).toBe(modelSlugHistoryArchiveKey(proof.artifactDigest));
    expect(put.key).toMatch(
      /^private\/model-slug-history\/v1\/sha256\/[0-9a-f]{64}\.json$/u,
    );
    expect(put.options?.onlyIf).toEqual({ etagDoesNotMatch: "*" });
    expect(put.options?.httpMetadata).toEqual({
      contentType: MODEL_SLUG_HISTORY_ARCHIVE_CONTENT_TYPE,
      cacheControl: "private, no-store",
    });
    const stored = memory.objects.get(put.key)!;
    const rawBodyDigest = String(stored.customMetadata["body-sha256"]);
    expect(rawBodyDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(rawBodyDigest).not.toBe(proof.artifactDigest);
    expect(stored.customMetadata).toEqual({
      "artifact-format": MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
      "body-sha256": rawBodyDigest,
      "retention-class": MODEL_SLUG_HISTORY_ARCHIVE_RETENTION_CLASS,
    });
    expect(proof.artifactByteCount).toBe(stored.bytes.byteLength);

    const bodyText = new TextDecoder().decode(stored.bytes);
    const artifact = JSON.parse(bodyText) as Record<string, unknown>;
    expect(checkModelSlugHistoryArtifactContract(artifact)).toBe(true);
    expect(Object.keys(artifact)).toEqual([
      "artifact_version",
      "acquisition_version",
      "canonical_guard_version",
      "projection_version",
      "publication_id",
      "closure_hash",
      "base_bundle_hash",
      "publication_boundary_ms",
      "canonical_models",
      "history_rows",
      "model_count",
      "source_history_count",
      "source_history_hash",
      "mapping_count",
      "current_mapping_count",
      "historical_mapping_count",
      "mapping_inventory_hash",
    ]);
    for (const forbidden of [
      candidate.privateSessionBookmark,
      "privateSessionBookmark",
      "manifest",
      "resources",
      "mappings",
      "etag",
      "vendor-version-must-not-be-authority",
      "uploaded",
    ])
      expect(bodyText).not.toContain(forbidden);
    expect(Object.keys(proof)).not.toContain("key");
    expect(Object.keys(proof)).not.toContain("privateSessionBookmark");
  });

  it("pins the canonical body and versioned domain-separated digest with golden values", async () => {
    const memory = new MemoryArchiveBucket();
    const proof = await archiveModelSlugHistoryCandidate(
      memory.binding,
      candidate,
    );
    const stored = memory.objects.get(
      modelSlugHistoryArchiveKey(proof.artifactDigest),
    )!;
    expect(stored.customMetadata["body-sha256"]).toBe(
      "sha256:e3fcc852049c029d2d641fd7a0019e5018953a5bed9aa797fdc273f9dbc613cf",
    );
    expect(proof.artifactDigest).toBe(
      "sha256:2e298ca2419f8b57a47f51b4e9f8f00ae08b3123f943c9367ae750e127adcc79",
    );
  });

  it("treats an exact pre-existing object and an ambiguous applied write as idempotent success", async () => {
    const memory = new MemoryArchiveBucket();
    const first = await archiveModelSlugHistoryCandidate(
      memory.binding,
      candidate,
    );
    const second = await archiveModelSlugHistoryCandidate(
      memory.binding,
      candidate,
    );
    expect(second).toEqual(first);
    expect(memory.objects).toHaveLength(1);

    const ambiguous = new MemoryArchiveBucket();
    ambiguous.mode = "throw-after";
    const reconciled = await archiveModelSlugHistoryCandidate(
      ambiguous.binding,
      candidate,
    );
    assertModelSlugHistoryArchiveProof(reconciled);
  });

  it("distinguishes definitely absent, conditionally absent, and unreadable outcomes", async () => {
    const absent = new MemoryArchiveBucket();
    absent.mode = "throw-before";
    await expectStaticError(
      archiveModelSlugHistoryCandidate(absent.binding, candidate),
      "not_applied",
    );

    const unreadable = new MemoryArchiveBucket();
    unreadable.mode = "throw-get";
    await expectStaticError(
      archiveModelSlugHistoryCandidate(unreadable.binding, candidate),
      "outcome_unknown",
    );
  });

  it("rejects overwrite collisions, hostile metadata, checksum drift, and oversized declarations", async () => {
    const cases: ((stored: StoredObject) => void)[] = [
      (stored) => {
        const firstByte = stored.bytes[0];
        if (firstByte === undefined) throw new Error("test body is empty");
        stored.bytes[0] = firstByte ^ 1;
      },
      (stored) => {
        stored.customMetadata.unexpected = "TOP-SECRET";
      },
      (stored) => {
        (stored.httpMetadata as Record<string, unknown>).visitorCanary =
          "TOP-SECRET visitor-123";
      },
      (stored) => {
        const checksum = new Uint8Array(stored.checksum);
        const firstByte = checksum[0];
        if (firstByte === undefined) throw new Error("test checksum is empty");
        checksum[0] = firstByte ^ 1;
      },
      (stored) => {
        stored.declaredSize = MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES + 1;
      },
      (stored) => {
        stored.declaredSize = stored.bytes.byteLength + 1;
      },
      (stored) => {
        stored.streamFailure = true;
      },
      (stored) => {
        stored.endlessEmptyStream = true;
      },
      (stored) => {
        stored.oneByteChunks = true;
      },
    ];
    for (const mutate of cases) {
      const memory = new MemoryArchiveBucket();
      const proof = await archiveModelSlugHistoryCandidate(
        memory.binding,
        candidate,
      );
      mutate(
        memory.objects.get(modelSlugHistoryArchiveKey(proof.artifactDigest))!,
      );
      const error = await archiveModelSlugHistoryCandidate(
        memory.binding,
        candidate,
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ModelSlugHistoryArchiveError);
      expect(["conflict", "integrity_failure"]).toContain(
        (error as ModelSlugHistoryArchiveError).code,
      );
      expect(String(error)).not.toContain("TOP-SECRET");
    }
  });

  it("rejects metadata accessors and symbols without executing visitor-controlled getters", async () => {
    let getterCalls = 0;
    const mutations: ((stored: StoredObject) => void)[] = [
      (stored) => {
        Object.defineProperty(stored.customMetadata, "body-sha256", {
          enumerable: true,
          get() {
            getterCalls += 1;
            return "TOP-SECRET visitor-123";
          },
        });
      },
      (stored) => {
        Object.defineProperty(stored.httpMetadata, "contentType", {
          enumerable: true,
          get() {
            getterCalls += 1;
            return "TOP-SECRET visitor-123";
          },
        });
      },
      (stored) => {
        Object.defineProperty(stored.customMetadata, Symbol("visitor"), {
          enumerable: true,
          value: "TOP-SECRET visitor-123",
        });
      },
    ];
    for (const mutate of mutations) {
      const memory = new MemoryArchiveBucket();
      const proof = await archiveModelSlugHistoryCandidate(
        memory.binding,
        candidate,
      );
      mutate(
        memory.objects.get(modelSlugHistoryArchiveKey(proof.artifactDigest))!,
      );
      await expectStaticError(
        archiveModelSlugHistoryCandidate(memory.binding, candidate),
        "integrity_failure",
      );
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects malformed digests, forged candidates, and forged proofs", async () => {
    let coercionCalls = 0;
    for (const digest of [
      "",
      "sha256:ABC",
      "sha256:../" + "0".repeat(61),
      "sha256:" + "0".repeat(63),
      {
        toString() {
          coercionCalls += 1;
          return "TOP-SECRET";
        },
      },
    ])
      expect(() => modelSlugHistoryArchiveKey(digest)).toThrow(
        ModelSlugHistoryArchiveError,
      );
    expect(coercionCalls).toBe(0);
    await expectStaticError(
      archiveModelSlugHistoryCandidate(new MemoryArchiveBucket().binding, {
        ...candidate,
      }),
      "configuration_invalid",
    );
    const proof = await archiveModelSlugHistoryCandidate(
      new MemoryArchiveBucket().binding,
      candidate,
    );
    expect(() => {
      assertModelSlugHistoryArchiveProof({ ...proof });
    }).toThrow("not trusted");
  });

  it("rereads an expected sidecar for rollback through a get-only capability", async () => {
    const memory = new MemoryArchiveBucket();
    const archived = await archiveModelSlugHistoryCandidate(
      memory.binding,
      candidate,
    );
    const expected = expectedRollbackProof(archived);
    const putCount = memory.puts.length;
    let getCalls = 0;
    const verified = await verifyArchivedModelSlugHistoryForRollback(
      {
        get(key) {
          getCalls += 1;
          return memory.binding.get(key);
        },
      },
      { manifest: candidate.manifest, resources: candidate.resources },
      expected,
      rollbackFreshness,
    );

    expect(() => {
      assertFreshModelSlugRollbackProof(archived);
    }).toThrow("not trusted");
    assertFreshModelSlugRollbackProof(verified);
    const freshness = readFreshModelSlugRollbackProof(verified);
    assertModelSlugHistoryArchiveProof(freshness.archiveProof);
    expect(Object.keys(verified)).toEqual([
      "archiveProof",
      "observedAtMs",
      "maximumAgeMs",
    ]);
    expect(verified).toMatchObject(rollbackFreshness);
    expect(verified.archiveProof).toBe(freshness.archiveProof);
    expect(verified.archiveProof).toEqual(archived);
    expect(verified.archiveProof).not.toBe(archived);
    expect(verified.archiveProof.projection).not.toBe(archived.projection);
    expect(verified.archiveProof.artifactDigest).toBe(expected.artifact_digest);
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(freshness)).toBe(true);
    expect(() => {
      assertFreshModelSlugRollbackProof({ ...verified });
    }).toThrow("not trusted");
    expect(getCalls).toBe(1);
    expect(memory.puts).toHaveLength(putCount);
  });

  it("rejects hostile or unbounded rollback freshness before R2", async () => {
    const memory = new MemoryArchiveBucket();
    const archived = await archiveModelSlugHistoryCandidate(
      memory.binding,
      candidate,
    );
    const expected = expectedRollbackProof(archived);
    let getterCalls = 0;
    let getCalls = 0;
    const hostile: Record<string, unknown> = { maximumAgeMs: 1 };
    Object.defineProperty(hostile, "observedAtMs", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return rollbackFreshness.observedAtMs;
      },
    });
    const invalidFreshness: unknown[] = [
      hostile,
      { ...rollbackFreshness, extra: 1 },
      { ...rollbackFreshness, observedAtMs: -1 },
      { ...rollbackFreshness, observedAtMs: 0.5 },
      { ...rollbackFreshness, maximumAgeMs: -1 },
      { ...rollbackFreshness, maximumAgeMs: Number.MAX_SAFE_INTEGER + 1 },
      { observedAtMs: Number.MAX_SAFE_INTEGER, maximumAgeMs: 1 },
    ];
    for (const freshness of invalidFreshness)
      await expectStaticError(
        verifyArchivedModelSlugHistoryForRollback(
          {
            get(key) {
              getCalls += 1;
              return memory.binding.get(key);
            },
          },
          { manifest: candidate.manifest, resources: candidate.resources },
          expected,
          freshness as never,
        ),
        "configuration_invalid",
      );
    expect(getterCalls).toBe(0);
    expect(getCalls).toBe(0);
  });

  it("rejects absent, unreadable, corrupt, BOM-prefixed, and metadata-authored rollback objects", async () => {
    const mutations: ((stored: StoredObject) => void)[] = [
      (stored) => {
        const byte = stored.bytes[10];
        if (byte === undefined) throw new Error("test body is too short");
        stored.bytes[10] = byte ^ 1;
      },
      (stored) => {
        stored.bytes[0] = 0xef;
        stored.bytes[1] = 0xbb;
        stored.bytes[2] = 0xbf;
      },
      (stored) => {
        stored.customMetadata["body-sha256"] = "sha256:" + "0".repeat(64);
      },
      (stored) => {
        stored.customMetadata.unexpected = "TOP-SECRET visitor-123";
      },
      (stored) => {
        const checksum = new Uint8Array(stored.checksum);
        const byte = checksum[0];
        if (byte === undefined) throw new Error("test checksum is empty");
        checksum[0] = byte ^ 1;
      },
      (stored) => {
        stored.streamFailure = true;
      },
      (stored) => {
        stored.endlessEmptyStream = true;
      },
      (stored) => {
        stored.oneByteChunks = true;
      },
    ];
    for (const mutate of mutations) {
      const memory = new MemoryArchiveBucket();
      const archived = await archiveModelSlugHistoryCandidate(
        memory.binding,
        candidate,
      );
      mutate(
        memory.objects.get(
          modelSlugHistoryArchiveKey(archived.artifactDigest),
        )!,
      );
      await expectStaticError(
        verifyArchivedModelSlugHistoryForRollback(
          { get: (key) => memory.binding.get(key) },
          { manifest: candidate.manifest, resources: candidate.resources },
          expectedRollbackProof(archived),
          rollbackFreshness,
        ),
        "integrity_failure",
      );
      expect(memory.puts).toHaveLength(1);
    }

    const absent = new MemoryArchiveBucket();
    const source = new MemoryArchiveBucket();
    const archived = await archiveModelSlugHistoryCandidate(
      source.binding,
      candidate,
    );
    await expectStaticError(
      verifyArchivedModelSlugHistoryForRollback(
        { get: (key) => absent.binding.get(key) },
        { manifest: candidate.manifest, resources: candidate.resources },
        expectedRollbackProof(archived),
        rollbackFreshness,
      ),
      "integrity_failure",
    );
    absent.mode = "throw-get";
    await expectStaticError(
      verifyArchivedModelSlugHistoryForRollback(
        { get: (key) => absent.binding.get(key) },
        { manifest: candidate.manifest, resources: candidate.resources },
        expectedRollbackProof(archived),
        rollbackFreshness,
      ),
      "outcome_unknown",
    );
  });

  it("rejects forged authority and hostile base containers before R2 without invoking accessors", async () => {
    const memory = new MemoryArchiveBucket();
    const archived = await archiveModelSlugHistoryCandidate(
      memory.binding,
      candidate,
    );
    const expected = expectedRollbackProof(archived);
    let getterCalls = 0;
    let getCalls = 0;
    const getOnly = {
      get(key: string) {
        getCalls += 1;
        return memory.binding.get(key);
      },
    };
    const hostileBase: Record<string, unknown> = {
      manifest: candidate.manifest,
    };
    Object.defineProperty(hostileBase, "resources", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return candidate.resources;
      },
    });
    await expectStaticError(
      verifyArchivedModelSlugHistoryForRollback(
        getOnly,
        hostileBase as never,
        expected,
        rollbackFreshness,
      ),
      "configuration_invalid",
    );
    await expectStaticError(
      verifyArchivedModelSlugHistoryForRollback(
        getOnly,
        { manifest: candidate.manifest, resources: candidate.resources },
        { ...expected },
        rollbackFreshness,
      ),
      "configuration_invalid",
    );
    expect(getterCalls).toBe(0);
    expect(getCalls).toBe(0);
  });

  it("normalizes revoked, descriptor-trap, and sparse rollback inputs before R2", async () => {
    const memory = new MemoryArchiveBucket();
    const archived = await archiveModelSlugHistoryCandidate(
      memory.binding,
      candidate,
    );
    const expected = expectedRollbackProof(archived);
    let getCalls = 0;
    const getOnly = {
      get(key: string) {
        getCalls += 1;
        return memory.binding.get(key);
      },
    };
    const validBase = {
      manifest: candidate.manifest,
      resources: candidate.resources,
    };
    const revokedBase = Proxy.revocable(validBase, {});
    revokedBase.revoke();
    const revokedExpected = Proxy.revocable(expected, {});
    revokedExpected.revoke();
    const revokedFreshness = Proxy.revocable(rollbackFreshness, {});
    revokedFreshness.revoke();
    const descriptorTrap = new Proxy(validBase, {
      getOwnPropertyDescriptor() {
        throw new Error("TOP-SECRET descriptor trap");
      },
    });
    const sparseResources = new Array(candidate.resources.length);

    const cases: readonly (readonly [unknown, unknown, unknown])[] = [
      [revokedBase.proxy, expected, rollbackFreshness],
      [validBase, revokedExpected.proxy, rollbackFreshness],
      [validBase, expected, revokedFreshness.proxy],
      [descriptorTrap, expected, rollbackFreshness],
      [
        { manifest: candidate.manifest, resources: sparseResources },
        expected,
        rollbackFreshness,
      ],
    ];
    for (const [base, authority, freshness] of cases)
      await expectStaticError(
        verifyArchivedModelSlugHistoryForRollback(
          getOnly,
          base as never,
          authority as never,
          freshness as never,
        ),
        "configuration_invalid",
      );
    expect(getCalls).toBe(0);
  });

  it("derives the sole rollback key from the protected expected digest", async () => {
    const memory = new MemoryArchiveBucket();
    const archived = await archiveModelSlugHistoryCandidate(
      memory.binding,
      candidate,
    );
    const protectedDigest =
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
    const requestedKeys: string[] = [];
    await expectStaticError(
      verifyArchivedModelSlugHistoryForRollback(
        {
          get(key) {
            requestedKeys.push(key);
            return memory.binding.get(key);
          },
        },
        { manifest: candidate.manifest, resources: candidate.resources },
        expectedRollbackProof(archived, protectedDigest),
        rollbackFreshness,
      ),
      "integrity_failure",
    );
    expect(requestedKeys).toEqual([
      modelSlugHistoryArchiveKey(protectedDigest),
    ]);
    expect(requestedKeys).not.toContain(
      modelSlugHistoryArchiveKey(archived.artifactDigest),
    );
    expect(memory.puts).toHaveLength(1);
  });
});
