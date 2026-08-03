import { describe, expect, it } from "vitest";

import { createReadyPublicationFixture } from "../test/serving-switch-fixture.js";
import {
  PUBLICATION_RECOVERY_BASE_CONTENT_TYPE,
  PUBLICATION_RECOVERY_BASE_FORMAT,
  PUBLICATION_RECOVERY_BASE_MAX_ROW_BYTES,
  PUBLICATION_RECOVERY_CHUNK_CONTENT_TYPE,
  PublicationRecoveryBaseError,
  archivePublicationRecoveryBase,
  assertVerifiedPublicationRecoveryBase,
  publicationRecoveryBaseObjectKey,
  verifyPublicationRecoveryBase,
  type PublicationRecoveryBaseErrorCode,
  type PublicationRecoveryBaseLocator,
} from "./publication-recovery-base.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const PUBLICATION_ID = `pub_${UUID}` as const;
const GENERATED_AT_MS = Date.parse("2026-08-03T00:00:00.000Z");
const utf8 = new TextEncoder();

interface Stored {
  bytes: Uint8Array<ArrayBuffer>;
  bodySha256: ArrayBuffer;
  customMetadata: Record<string, string>;
  contentType: string;
  cacheControl: string;
}

class PrivateObjectStore {
  readonly objects = new Map<string, Stored>();
  putCalls = 0;
  getCalls = 0;
  throwAfterNextWrite = false;
  throwOnNextGet = false;
  readonly bodylessKeys = new Set<string>();
  readonly streamChunkCounts = new Map<string, number>();

  readonly writer = {
    put: (
      key: string,
      value:
        ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
      options?: R2PutOptions,
    ): Promise<R2Object | null> => {
      this.putCalls += 1;
      if (!ArrayBuffer.isView(value)) throw new Error("fixture requires bytes");
      const bytes = Uint8Array.from(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );
      if (this.objects.has(key)) return Promise.resolve(null);
      if (
        options?.onlyIf === undefined ||
        options.onlyIf instanceof Headers ||
        options.onlyIf.etagDoesNotMatch !== "*" ||
        options.sha256 === undefined ||
        typeof options.sha256 === "string" ||
        options.httpMetadata === undefined ||
        options.httpMetadata instanceof Headers
      )
        throw new Error("fixture requires conditional bytes and checksum");
      const sha = ArrayBuffer.isView(options.sha256)
        ? Uint8Array.from(
            new Uint8Array(
              options.sha256.buffer,
              options.sha256.byteOffset,
              options.sha256.byteLength,
            ),
          ).buffer
        : options.sha256.slice(0);
      this.objects.set(key, {
        bytes,
        bodySha256: sha,
        customMetadata: { ...options.customMetadata },
        contentType: options.httpMetadata.contentType ?? "",
        cacheControl: options.httpMetadata.cacheControl ?? "",
      });
      if (this.throwAfterNextWrite) {
        this.throwAfterNextWrite = false;
        throw new Error("simulated lost write response");
      }
      return Promise.resolve(this.metadata(key, this.objects.get(key)!));
    },
  } as unknown as Pick<R2Bucket, "put">;

  readonly reader = {
    get: (key: string): Promise<R2ObjectBody | null> => {
      this.getCalls += 1;
      if (this.throwOnNextGet) {
        this.throwOnNextGet = false;
        return Promise.reject(new Error("simulated read transport failure"));
      }
      const stored = this.objects.get(key);
      if (stored === undefined) return Promise.resolve(null);
      const bytes = Uint8Array.from(stored.bytes);
      if (this.bodylessKeys.has(key))
        return Promise.resolve(this.metadata(key, stored) as R2ObjectBody);
      const streamChunkCount = this.streamChunkCounts.get(key) ?? 1;
      const object = Object.assign(this.metadata(key, stored), {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            for (let index = 0; index < streamChunkCount; index += 1) {
              const start = Math.floor(
                (index * bytes.byteLength) / streamChunkCount,
              );
              const end = Math.floor(
                ((index + 1) * bytes.byteLength) / streamChunkCount,
              );
              controller.enqueue(bytes.slice(start, end));
            }
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
      });
      return Promise.resolve(object);
    },
  } as unknown as Pick<R2Bucket, "get">;

  private metadata(key: string, stored: Stored): R2Object {
    return {
      key,
      version: "fixture-version",
      size: stored.bytes.byteLength,
      etag: "fixture-etag",
      httpEtag: '"fixture-etag"',
      checksums: {
        sha256: stored.bodySha256,
        toJSON: () => ({ sha256: "unused" }),
      },
      uploaded: new Date(0),
      httpMetadata: {
        contentType: stored.contentType,
        cacheControl: stored.cacheControl,
      },
      customMetadata: stored.customMetadata,
      storageClass: "Standard",
      writeHttpMetadata(headers: Headers) {
        void headers;
      },
    };
  }
}

const fixture = () =>
  createReadyPublicationFixture(PUBLICATION_ID, GENERATED_AT_MS);

const errorCode = (code: PublicationRecoveryBaseErrorCode) =>
  new PublicationRecoveryBaseError(code);

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const independentChunk = (rows: readonly unknown[]): Uint8Array => {
  const header = utf8.encode("publication-recovery-chunk@1\n");
  const encoded = rows.map((row) => utf8.encode(canonicalJson(row)));
  const output = new Uint8Array(
    header.byteLength +
      encoded.reduce((sum, row) => sum + 8 + row.byteLength, 0),
  );
  output.set(header);
  const view = new DataView(output.buffer);
  let offset = header.byteLength;
  for (const row of encoded) {
    view.setBigUint64(offset, BigInt(row.byteLength), false);
    offset += 8;
    output.set(row, offset);
    offset += row.byteLength;
  }
  return output;
};

const digest = async (domain: string, body: Uint8Array): Promise<string> => {
  const domainBytes = utf8.encode(domain);
  const bytes = new Uint8Array(domainBytes.byteLength + body.byteLength);
  bytes.set(domainBytes);
  bytes.set(body, domainBytes.byteLength);
  const raw = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(raw)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
};

const rawDigest = async (body: Uint8Array): Promise<ArrayBuffer> =>
  crypto.subtle.digest("SHA-256", body);

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength &&
  left.every((value, index) => value === right[index]);

const resignRoot = async (
  store: PrivateObjectStore,
  locator: PublicationRecoveryBaseLocator,
  text: string,
): Promise<PublicationRecoveryBaseLocator> => {
  const current = [...store.objects.entries()].find(([key]) =>
    key.endsWith(".json"),
  );
  if (current === undefined) throw new Error("fixture root missing");
  const bytes = Uint8Array.from(utf8.encode(text));
  const artifactDigest = await digest(
    "quantclarity:publication-recovery-manifest:v1\0",
    bytes,
  );
  const bodyRaw = await rawDigest(bytes);
  const bodyHash = `sha256:${[...new Uint8Array(bodyRaw)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
  const key = publicationRecoveryBaseObjectKey({
    environment: locator.environment,
    publicationId: locator.publicationId,
    relation: "manifest",
    ordinal: 0,
    digest: artifactDigest as `sha256:${string}`,
  });
  const stored: Stored = {
    ...current[1],
    bytes,
    bodySha256: bodyRaw,
    customMetadata: {
      ...current[1].customMetadata,
      "artifact-digest": artifactDigest,
      "body-sha256": bodyHash,
      "byte-count": String(bytes.byteLength),
    },
  };
  store.objects.delete(current[0]);
  store.objects.set(key, stored);
  return Object.freeze({
    ...locator,
    rootDigest: artifactDigest as `sha256:${string}`,
    rootByteCount: bytes.byteLength,
  });
};

const replaceFirstChunk = async (
  store: PrivateObjectStore,
  locator: PublicationRecoveryBaseLocator,
  bytes: Uint8Array,
): Promise<PublicationRecoveryBaseLocator> => {
  const rootObject = [...store.objects.values()].find(
    (object) => object.contentType === PUBLICATION_RECOVERY_BASE_CONTENT_TYPE,
  );
  if (rootObject === undefined) throw new Error("fixture root missing");
  const root = JSON.parse(new TextDecoder().decode(rootObject.bytes)) as {
    total_byte_count: number;
    sources: {
      source: Parameters<
        typeof publicationRecoveryBaseObjectKey
      >[0]["relation"];
      byte_count: number;
      chunks: {
        ordinal: number;
        byte_count: number;
        artifact_digest: `sha256:${string}`;
        object_key: string;
      }[];
    }[];
  };
  const source = root.sources.find((candidate) => candidate.chunks.length > 0);
  const chunk = source?.chunks[0];
  if (source === undefined || chunk === undefined)
    throw new Error("fixture chunk missing");
  const previous = store.objects.get(chunk.object_key);
  if (previous === undefined) throw new Error("fixture chunk body missing");
  const artifactDigest = (await digest(
    "quantclarity:publication-recovery-chunk:v1\0",
    bytes,
  )) as `sha256:${string}`;
  const bodyRaw = await rawDigest(bytes);
  const bodyHash = `sha256:${[...new Uint8Array(bodyRaw)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
  const objectKey = publicationRecoveryBaseObjectKey({
    environment: locator.environment,
    publicationId: locator.publicationId,
    relation: source.source,
    ordinal: chunk.ordinal,
    digest: artifactDigest,
  });
  store.objects.delete(chunk.object_key);
  store.objects.set(objectKey, {
    ...previous,
    bytes: Uint8Array.from(bytes),
    bodySha256: bodyRaw,
    customMetadata: {
      ...previous.customMetadata,
      "artifact-digest": artifactDigest,
      "body-sha256": bodyHash,
      "byte-count": String(bytes.byteLength),
    },
  });
  const difference = bytes.byteLength - chunk.byte_count;
  chunk.byte_count = bytes.byteLength;
  chunk.artifact_digest = artifactDigest;
  chunk.object_key = objectKey;
  source.byte_count += difference;
  root.total_byte_count += difference;
  return resignRoot(store, locator, canonicalJson(root));
};

describe("publication-recovery-base@1", () => {
  it("round-trips the exact eight source relations and mints nominal verification", async () => {
    const source = await fixture();
    const store = new PrivateObjectStore();
    expect(Object.keys(store.writer)).toEqual(["put"]);
    expect(Object.keys(store.reader)).toEqual(["get"]);

    const locator = await archivePublicationRecoveryBase(
      store.writer,
      store.reader,
      "local",
      source.manifest,
      source.rows,
    );
    const authority = await verifyPublicationRecoveryBase(
      store.reader,
      locator,
    );
    expect(() => {
      assertVerifiedPublicationRecoveryBase(authority);
    }).not.toThrow();
    expect(authority.manifest).toEqual(source.manifest);
    expect(authority.closureHash).toBe(source.manifest.closureHash);
    expect(authority.bundleHash).toBe(source.manifest.bundleHash);
    expect(authority.closureRows.publication).toEqual(source.rows.publication);
    expect(authority.closureRows.providerSlices).toEqual(
      source.rows.providerSlices,
    );
    expect(authority.closureRows.resources).toEqual(source.rows.resources);
    expect(authority.closureRows.stagingRevision).toBe(0);
    expect(authority.closureRows.sealedAtMs).toBe(GENERATED_AT_MS);
    expect(store.getCalls).toBeGreaterThan(store.putCalls);

    const root = [...store.objects.entries()].find(([key]) =>
      key.endsWith(".json"),
    );
    expect(root).toBeDefined();
    const rootValue = JSON.parse(new TextDecoder().decode(root![1].bytes)) as {
      sources: readonly { source: string }[];
    };
    expect(rootValue.sources.map((value) => value.source)).toEqual([
      "publication",
      "publication_provider_slice",
      "publication_provider_slice_metadata",
      "publication_provider_attribution",
      "publication_resource",
      "publication_search_document",
      "publication_vector_inventory",
      "publication_inventory_chunk",
    ]);
    expect(new TextDecoder().decode(root![1].bytes)).not.toMatch(
      /(?:head|readiness|staging_revision|closure_seal|slug|mapping|fts|vectorize)/iu,
    );
  });

  it("requires matching nominal manifest authority before the first write", async () => {
    const source = await fixture();
    const store = new PrivateObjectStore();
    const reflected = { ...source.manifest } as typeof source.manifest;
    await expect(
      archivePublicationRecoveryBase(
        store.writer,
        store.reader,
        "local",
        reflected,
        source.rows,
      ),
    ).rejects.toEqual(errorCode("configuration_invalid"));
    expect(store.putCalls).toBe(0);

    const other = await createReadyPublicationFixture(
      "pub_44444444-4444-4444-8444-444444444444",
      GENERATED_AT_MS,
    );
    await expect(
      archivePublicationRecoveryBase(
        store.writer,
        store.reader,
        "local",
        other.manifest,
        source.rows,
      ),
    ).rejects.toEqual(errorCode("configuration_invalid"));
    expect(store.putCalls).toBe(0);
  });

  it("matches an independent fixed chunk framing and domain-hash oracle", async () => {
    const source = await fixture();
    const store = new PrivateObjectStore();
    await archivePublicationRecoveryBase(
      store.writer,
      store.reader,
      "test",
      source.manifest,
      source.rows,
    );
    const [key, stored] = [...store.objects.entries()].find(([candidate]) =>
      candidate.includes("/publication_provider_slice/000000/"),
    )!;
    const expectedRows = source.rows.providerSlices.map((row) => ({
      provider_id: row.provider_id,
      provider_slice_id: row.provider_slice_id,
      provider_run_id: row.provider_run_id,
      carried_forward: row.carried_forward,
      freshness_state: row.freshness_state,
    }));
    const expectedBytes = independentChunk(expectedRows);
    expect(equalBytes(stored.bytes, expectedBytes)).toBe(true);
    const expectedDigest = await digest(
      "quantclarity:publication-recovery-chunk:v1\0",
      expectedBytes,
    );
    expect(stored.customMetadata["artifact-digest"]).toBe(expectedDigest);
    expect(key).toContain(
      `/test/${PUBLICATION_ID}/publication_provider_slice/000000/${expectedDigest.slice(7)}.bin`,
    );
    expect(stored.contentType).toBe(PUBLICATION_RECOVERY_CHUNK_CONTENT_TYPE);
    const header = utf8.encode("publication-recovery-chunk@1\n");
    expect(stored.bytes.subarray(0, header.byteLength)).toEqual(header);
    expect(Object.keys(stored.customMetadata).sort()).toEqual([
      "artifact-digest",
      "artifact-format",
      "body-sha256",
      "byte-count",
      "environment",
      "object-kind",
      "ordinal",
      "publication-id",
      "relation",
      "retention-class",
    ]);
    expect(
      equalBytes(
        new Uint8Array(stored.bodySha256),
        new Uint8Array(await rawDigest(expectedBytes)),
      ),
    ).toBe(true);

    const [rootKey, root] = [...store.objects.entries()].find(([candidate]) =>
      candidate.endsWith(".json"),
    )!;
    const parsedRoot = JSON.parse(
      new TextDecoder().decode(root.bytes),
    ) as unknown;
    const independentRootBytes = utf8.encode(canonicalJson(parsedRoot));
    expect(equalBytes(root.bytes, independentRootBytes)).toBe(true);
    const rootDigest = await digest(
      "quantclarity:publication-recovery-manifest:v1\0",
      independentRootBytes,
    );
    expect(root.customMetadata["artifact-digest"]).toBe(rootDigest);
    expect(rootKey).toBe(
      publicationRecoveryBaseObjectKey({
        environment: "test",
        publicationId: PUBLICATION_ID,
        relation: "manifest",
        ordinal: 0,
        digest: rootDigest as `sha256:${string}`,
      }),
    );
    expect(root.contentType).toBe(PUBLICATION_RECOVERY_BASE_CONTENT_TYPE);
  });

  it("rereads successful, conflicting, and response-lost creates before success", async () => {
    const source = await fixture();
    const store = new PrivateObjectStore();
    store.throwAfterNextWrite = true;
    const first = await archivePublicationRecoveryBase(
      store.writer,
      store.reader,
      "preview",
      source.manifest,
      source.rows,
    );
    const count = store.objects.size;
    const second = await archivePublicationRecoveryBase(
      store.writer,
      store.reader,
      "preview",
      source.manifest,
      source.rows,
    );
    expect(second).toEqual(first);
    expect(store.objects.size).toBe(count);
  });

  it("rejects body corruption, metadata drift, protected-identity drift, and a wrong header", async () => {
    const source = await fixture();
    const store = new PrivateObjectStore();
    const locator = await archivePublicationRecoveryBase(
      store.writer,
      store.reader,
      "production",
      source.manifest,
      source.rows,
    );
    const chunk = [...store.objects.entries()].find(([key]) =>
      key.endsWith(".bin"),
    )!;
    chunk[1].bytes[0] = (chunk[1].bytes[0] ?? 0) ^ 1;
    await expect(
      verifyPublicationRecoveryBase(store.reader, locator),
    ).rejects.toEqual(errorCode("integrity_failure"));

    const clean = new PrivateObjectStore();
    const cleanLocator = await archivePublicationRecoveryBase(
      clean.writer,
      clean.reader,
      "production",
      source.manifest,
      source.rows,
    );
    const root = [...clean.objects.entries()].find(([key]) =>
      key.endsWith(".json"),
    )![1];
    root.contentType = "application/json";
    await expect(
      verifyPublicationRecoveryBase(clean.reader, cleanLocator),
    ).rejects.toEqual(errorCode("integrity_failure"));
    await expect(
      verifyPublicationRecoveryBase(clean.reader, {
        ...cleanLocator,
        closureHash: `sha256:${"f".repeat(64)}`,
      }),
    ).rejects.toEqual(errorCode("integrity_failure"));
  });

  it("rejects missing, bodyless, truncated, extended-metadata, and cross-environment objects", async () => {
    const source = await fixture();
    const setup = async () => {
      const store = new PrivateObjectStore();
      const locator = await archivePublicationRecoveryBase(
        store.writer,
        store.reader,
        "local",
        source.manifest,
        source.rows,
      );
      const chunkKey = [...store.objects.keys()].find((key) =>
        key.endsWith(".bin"),
      )!;
      return { store, locator, chunkKey };
    };

    const missing = await setup();
    missing.store.objects.delete(missing.chunkKey);
    await expect(
      verifyPublicationRecoveryBase(missing.store.reader, missing.locator),
    ).rejects.toEqual(errorCode("not_applied"));

    const bodyless = await setup();
    bodyless.store.bodylessKeys.add(bodyless.chunkKey);
    await expect(
      verifyPublicationRecoveryBase(bodyless.store.reader, bodyless.locator),
    ).rejects.toEqual(errorCode("integrity_failure"));

    const truncated = await setup();
    const truncatedObject = truncated.store.objects.get(truncated.chunkKey)!;
    truncatedObject.bytes = truncatedObject.bytes.slice(0, -1);
    await expect(
      verifyPublicationRecoveryBase(truncated.store.reader, truncated.locator),
    ).rejects.toEqual(errorCode("integrity_failure"));

    const metadata = await setup();
    metadata.store.objects.get(metadata.chunkKey)!.customMetadata.visitor =
      "forbidden";
    await expect(
      verifyPublicationRecoveryBase(metadata.store.reader, metadata.locator),
    ).rejects.toEqual(errorCode("integrity_failure"));

    const environment = await setup();
    await expect(
      verifyPublicationRecoveryBase(environment.store.reader, {
        ...environment.locator,
        environment: "preview",
      }),
    ).rejects.toEqual(errorCode("not_applied"));

    const transport = await setup();
    transport.store.throwOnNextGet = true;
    await expect(
      verifyPublicationRecoveryBase(transport.store.reader, transport.locator),
    ).rejects.toEqual(errorCode("outcome_unknown"));
  });

  it("rejects a rehashed chunk whose declared row exceeds the format limit", async () => {
    const source = await fixture();
    const store = new PrivateObjectStore();
    const locator = await archivePublicationRecoveryBase(
      store.writer,
      store.reader,
      "test",
      source.manifest,
      source.rows,
    );
    const header = utf8.encode("publication-recovery-chunk@1\n");
    const hostile = new Uint8Array(header.byteLength + 8);
    hostile.set(header);
    new DataView(hostile.buffer).setBigUint64(
      header.byteLength,
      BigInt(PUBLICATION_RECOVERY_BASE_MAX_ROW_BYTES + 1),
      false,
    );
    const resigned = await replaceFirstChunk(store, locator, hostile);
    await expect(
      verifyPublicationRecoveryBase(store.reader, resigned),
    ).rejects.toEqual(errorCode("integrity_failure"));
  });

  it("rejects noncanonical root bytes and manifest count/range drift even when rehashed", async () => {
    const source = await fixture();
    const setup = async () => {
      const store = new PrivateObjectStore();
      const locator = await archivePublicationRecoveryBase(
        store.writer,
        store.reader,
        "test",
        source.manifest,
        source.rows,
      );
      const root = [...store.objects.values()].find(
        (object) =>
          object.contentType === PUBLICATION_RECOVERY_BASE_CONTENT_TYPE,
      )!;
      return { store, locator, text: new TextDecoder().decode(root.bytes) };
    };

    const noncanonical = await setup();
    const noncanonicalLocator = await resignRoot(
      noncanonical.store,
      noncanonical.locator,
      `${noncanonical.text}\n`,
    );
    await expect(
      verifyPublicationRecoveryBase(
        noncanonical.store.reader,
        noncanonicalLocator,
      ),
    ).rejects.toEqual(errorCode("integrity_failure"));

    const count = await setup();
    const countRoot = JSON.parse(count.text) as {
      total_row_count: number;
      sources: { row_count: number }[];
    };
    countRoot.sources[0]!.row_count += 1;
    countRoot.total_row_count += 1;
    const countLocator = await resignRoot(
      count.store,
      count.locator,
      canonicalJson(countRoot),
    );
    await expect(
      verifyPublicationRecoveryBase(count.store.reader, countLocator),
    ).rejects.toEqual(errorCode("integrity_failure"));

    const range = await setup();
    const rangeRoot = JSON.parse(range.text) as {
      sources: { chunks: { first_key: string }[] }[];
    };
    rangeRoot.sources.find(
      (value) => value.chunks.length > 0,
    )!.chunks[0]!.first_key = "drifted:first-key";
    const rangeLocator = await resignRoot(
      range.store,
      range.locator,
      canonicalJson(rangeRoot),
    );
    await expect(
      verifyPublicationRecoveryBase(range.store.reader, rangeLocator),
    ).rejects.toEqual(errorCode("integrity_failure"));

    const adjacent = await setup();
    const adjacentRoot = JSON.parse(adjacent.text) as {
      total_row_count: number;
      total_byte_count: number;
      sources: {
        row_count: number;
        chunk_count: number;
        byte_count: number;
        chunks: {
          ordinal: number;
          first_key: string;
          last_key: string;
          row_count: number;
          byte_count: number;
          artifact_digest: `sha256:${string}`;
          object_key: string;
        }[];
      }[];
    };
    const adjacentSource = adjacentRoot.sources.find(
      (value) => value.chunks.length > 0,
    )!;
    const first = adjacentSource.chunks[0]!;
    adjacentSource.chunks.push({
      ...first,
      ordinal: 1,
      object_key: publicationRecoveryBaseObjectKey({
        environment: adjacent.locator.environment,
        publicationId: adjacent.locator.publicationId,
        relation: "publication",
        ordinal: 1,
        digest: first.artifact_digest,
      }),
    });
    adjacentSource.chunk_count += 1;
    adjacentSource.row_count += first.row_count;
    adjacentSource.byte_count += first.byte_count;
    adjacentRoot.total_row_count += first.row_count;
    adjacentRoot.total_byte_count += first.byte_count;
    const adjacentLocator = await resignRoot(
      adjacent.store,
      adjacent.locator,
      canonicalJson(adjacentRoot),
    );
    await expect(
      verifyPublicationRecoveryBase(adjacent.store.reader, adjacentLocator),
    ).rejects.toEqual(errorCode("integrity_failure"));
  });

  it("rejects inherited, accessor, symbol, proxy, and sparse hostile inputs", async () => {
    const store = new PrivateObjectStore();
    const base = {
      format: PUBLICATION_RECOVERY_BASE_FORMAT,
      environment: "local",
      publicationId: PUBLICATION_ID,
      closureHash: `sha256:${"a".repeat(64)}`,
      bundleHash: `sha256:${"b".repeat(64)}`,
      rootDigest: `sha256:${"c".repeat(64)}`,
      rootByteCount: 10,
    } as const satisfies PublicationRecoveryBaseLocator;
    const inherited = Object.create({ visitor: "forbidden" }) as Record<
      string,
      unknown
    >;
    Object.assign(inherited, base);
    let getterReads = 0;
    const accessor = { ...base } as Record<string, unknown>;
    Object.defineProperty(accessor, "rootDigest", {
      enumerable: true,
      get() {
        getterReads += 1;
        return base.rootDigest;
      },
    });
    const symbol = { ...base, [Symbol("visitor")]: true };
    const proxy = new Proxy(base, {
      ownKeys() {
        throw new Error("hostile trap");
      },
    });
    for (const candidate of [inherited, accessor, symbol, proxy])
      await expect(
        verifyPublicationRecoveryBase(store.reader, candidate),
      ).rejects.toEqual(errorCode("configuration_invalid"));
    expect(getterReads).toBe(0);

    const source = await fixture();
    const sparse = new Array(source.rows.resources.length + 1);
    sparse[0] = source.rows.resources[0];
    await expect(
      archivePublicationRecoveryBase(
        store.writer,
        store.reader,
        "local",
        source.manifest,
        {
          ...source.rows,
          resources: sparse,
        },
      ),
    ).rejects.toEqual(errorCode("configuration_invalid"));
  });

  it("keeps root and chunk media types private and enforces the accepted source bound", async () => {
    const source = await fixture();
    const store = new PrivateObjectStore();
    const locator = await archivePublicationRecoveryBase(
      store.writer,
      store.reader,
      "local",
      source.manifest,
      source.rows,
    );
    expect(locator.rootByteCount).toBeLessThan(2 * 1_024 * 1_024);
    for (const [key, object] of store.objects) {
      expect(object.cacheControl).toBe("private, no-store");
      expect(object.contentType).toBe(
        key.endsWith(".json")
          ? PUBLICATION_RECOVERY_BASE_CONTENT_TYPE
          : PUBLICATION_RECOVERY_CHUNK_CONTENT_TYPE,
      );
      expect(object.bytes.byteLength).toBeLessThanOrEqual(2 * 1_024 * 1_024);
    }
    const tooMany = Array.from(
      { length: 50_001 },
      () => source.rows.resources[0]!,
    );
    const writesBeforeRejectedCandidate = store.putCalls;
    await expect(
      archivePublicationRecoveryBase(
        store.writer,
        store.reader,
        "local",
        source.manifest,
        {
          ...source.rows,
          resources: tooMany,
        },
      ),
    ).rejects.toEqual(errorCode("configuration_invalid"));
    expect(store.putCalls).toBe(writesBeforeRejectedCandidate);

    const duplicateStore = new PrivateObjectStore();
    await expect(
      archivePublicationRecoveryBase(
        duplicateStore.writer,
        duplicateStore.reader,
        "local",
        source.manifest,
        {
          ...source.rows,
          resources: [...source.rows.resources, source.rows.resources[0]!],
        },
      ),
    ).rejects.toEqual(errorCode("configuration_invalid"));
    expect(duplicateStore.putCalls).toBe(0);
  });

  it("accepts exactly 1,024 nonempty body chunks and fails closed at 1,025", async () => {
    const source = await fixture();
    const setup = async () => {
      const store = new PrivateObjectStore();
      const locator = await archivePublicationRecoveryBase(
        store.writer,
        store.reader,
        "local",
        source.manifest,
        source.rows,
      );
      const chunkKey = [...store.objects.keys()].find(
        (key) =>
          key.endsWith(".bin") &&
          (store.objects.get(key)?.bytes.byteLength ?? 0) >= 1_025,
      );
      if (chunkKey === undefined)
        throw new Error("stream-bound fixture chunk is too small");
      return { chunkKey, locator, store };
    };

    const accepted = await setup();
    accepted.store.streamChunkCounts.set(accepted.chunkKey, 1_024);
    await expect(
      verifyPublicationRecoveryBase(accepted.store.reader, accepted.locator),
    ).resolves.toBeDefined();

    const rejected = await setup();
    rejected.store.streamChunkCounts.set(rejected.chunkKey, 1_025);
    await expect(
      verifyPublicationRecoveryBase(rejected.store.reader, rejected.locator),
    ).rejects.toEqual(errorCode("integrity_failure"));
  });
});
