import { beforeAll, describe, expect, it } from "vitest";

import {
  MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES,
  MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
  checkModelSlugHistoryArtifactContract,
} from "@quant-clarity/contracts";

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
});
