import {
  assertImmutablePublicationManifest,
  buildImmutableManifestFromPersistedContent,
  projectServingClosureSeal,
  type ServingChunkClosureRow,
  type ServingClosureRows,
  type ServingProviderAttributionClosureRow,
  type ServingProviderSliceClosureRow,
  type ServingPublicationClosureRow,
  type ServingResourceClosureRow,
  type ServingSearchDocumentClosureRow,
  type ServingVectorClosureRow,
  type Sha256,
  type TrustedImmutablePublicationManifest,
} from "@quant-clarity/publication-core";

export const PUBLICATION_RECOVERY_BASE_FORMAT =
  "publication-recovery-base@1" as const;
export const PUBLICATION_RECOVERY_BASE_CODEC_VERSION = "1.0.0" as const;
export const PUBLICATION_RECOVERY_BASE_CONTENT_TYPE =
  "application/vnd.quantclarity.publication-recovery-base+json" as const;
export const PUBLICATION_RECOVERY_CHUNK_CONTENT_TYPE =
  "application/vnd.quantclarity.publication-recovery-chunk" as const;
export const PUBLICATION_RECOVERY_BASE_RETENTION_CLASS =
  "publication-rebuild-input-lifetime" as const;
export const PUBLICATION_RECOVERY_BASE_MAX_OBJECT_BYTES = 2 * 1_024 * 1_024;
export const PUBLICATION_RECOVERY_BASE_MAX_ROW_BYTES = 1 * 1_024 * 1_024;
export const PUBLICATION_RECOVERY_BASE_MAX_TOTAL_BYTES = 24 * 1_024 * 1_024;
export const PUBLICATION_RECOVERY_BASE_MAX_OBJECTS = 64;
export const PUBLICATION_RECOVERY_BASE_MAX_TOTAL_ROWS = 50_000;
export const PUBLICATION_RECOVERY_BASE_RETAINED_HEAP_BUDGET =
  96 * 1_024 * 1_024;

const RETAINED_HEAP_FIXED_RESERVE = 8 * 1_024 * 1_024;
const RETAINED_HEAP_BYTES_MULTIPLIER = 2;
const RETAINED_HEAP_ROW_OVERHEAD = 512;
const MAX_STREAM_CHUNKS_PER_OBJECT = 1_024;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const utf8 = new TextEncoder();
const CHUNK_HEADER = utf8.encode("publication-recovery-chunk@1\n");
const CHUNK_DIGEST_DOMAIN = utf8.encode(
  "quantclarity:publication-recovery-chunk:v1\0",
);
const MANIFEST_DIGEST_DOMAIN = utf8.encode(
  "quantclarity:publication-recovery-manifest:v1\0",
);
const KEY_PREFIX = "private/publication-recovery-base/v1";
const PUBLICATION_ID =
  /^pub_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const PUBLICATION_RECOVERY_BASE_SOURCES = Object.freeze([
  "publication",
  "publication_provider_slice",
  "publication_provider_slice_metadata",
  "publication_provider_attribution",
  "publication_resource",
  "publication_search_document",
  "publication_vector_inventory",
  "publication_inventory_chunk",
] as const);

export type PublicationRecoveryBaseSource =
  (typeof PUBLICATION_RECOVERY_BASE_SOURCES)[number];
export type PublicationRecoveryBaseEnvironment =
  "local" | "test" | "preview" | "production";

type ProviderSliceMetadataRow = Readonly<{
  provider_id: string;
  adapter_version: string;
  roster_version: string;
  source_register_version: string;
}>;

type ProviderSliceDispositionRow = Readonly<{
  provider_id: string;
  provider_slice_id: string | null;
  provider_run_id: string;
  carried_forward: number;
  freshness_state: string;
}>;

type SourceRow =
  | ServingPublicationClosureRow
  | ProviderSliceDispositionRow
  | ProviderSliceMetadataRow
  | ServingProviderAttributionClosureRow
  | ServingResourceClosureRow
  | ServingSearchDocumentClosureRow
  | ServingVectorClosureRow
  | ServingChunkClosureRow;

type SourceRows = Readonly<
  Record<PublicationRecoveryBaseSource, readonly SourceRow[]>
>;

export type PublicationRecoveryBaseLocator = Readonly<{
  format: typeof PUBLICATION_RECOVERY_BASE_FORMAT;
  environment: PublicationRecoveryBaseEnvironment;
  publicationId: string;
  closureHash: Sha256;
  bundleHash: Sha256;
  rootDigest: Sha256;
  rootByteCount: number;
}>;

type ChunkDescriptor = Readonly<{
  ordinal: number;
  first_key: string;
  last_key: string;
  row_count: number;
  byte_count: number;
  artifact_digest: Sha256;
  object_key: string;
}>;

type SourceDescriptor = Readonly<{
  source: PublicationRecoveryBaseSource;
  row_count: number;
  chunk_count: number;
  byte_count: number;
  chunks: readonly ChunkDescriptor[];
}>;

type RootManifest = Readonly<{
  artifact_format: typeof PUBLICATION_RECOVERY_BASE_FORMAT;
  codec_version: typeof PUBLICATION_RECOVERY_BASE_CODEC_VERSION;
  object_kind: "root_manifest";
  environment: PublicationRecoveryBaseEnvironment;
  publication_id: string;
  closure_hash: string;
  base_bundle_hash: string;
  manifest_contract_version: "1.0.0";
  enabled_provider_scope_version: string;
  serving_schema_version: string;
  sources: readonly SourceDescriptor[];
  total_row_count: number;
  total_byte_count: number;
}>;

export type PublicationRecoveryBaseWriteBucket = Pick<R2Bucket, "put">;
export type PublicationRecoveryBaseReadBucket = Pick<R2Bucket, "get">;

export type PublicationRecoveryBaseErrorCode =
  | "configuration_invalid"
  | "integrity_failure"
  | "conflict"
  | "not_applied"
  | "outcome_unknown";

export class PublicationRecoveryBaseError extends Error {
  readonly code: PublicationRecoveryBaseErrorCode;

  constructor(code: PublicationRecoveryBaseErrorCode) {
    super("Publication recovery base could not be processed safely.");
    this.name = "PublicationRecoveryBaseError";
    this.code = code;
  }
}

const trustedFailureCodes = new WeakMap<
  object,
  PublicationRecoveryBaseErrorCode
>();
const failure = (
  code: PublicationRecoveryBaseErrorCode,
): PublicationRecoveryBaseError => {
  const error = new PublicationRecoveryBaseError(code);
  trustedFailureCodes.set(error, code);
  return error;
};

const recoveryBaseBrand: unique symbol = Symbol(
  "VerifiedPublicationRecoveryBase",
);
const verifiedRecoveryBases = new WeakSet<object>();

export type VerifiedPublicationRecoveryBase = Readonly<{
  locator: PublicationRecoveryBaseLocator;
  closureRows: ServingClosureRows;
  manifest: TrustedImmutablePublicationManifest;
  closureHash: Sha256;
  bundleHash: Sha256;
  readonly [recoveryBaseBrand]: true;
}>;

export const assertVerifiedPublicationRecoveryBase: (
  value: unknown,
) => asserts value is VerifiedPublicationRecoveryBase = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(recoveryBaseBrand in value) ||
    value[recoveryBaseBrand] !== true ||
    !verifiedRecoveryBases.has(value)
  )
    throw new TypeError("verified publication recovery base is required");
};

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const hashBytes = async (
  bytes: Uint8Array,
): Promise<Readonly<{ digest: Sha256; raw: ArrayBuffer }>> => {
  const raw = await crypto.subtle.digest("SHA-256", bytes);
  const digest = `sha256:${[...new Uint8Array(raw)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
  if (!SHA256.test(digest)) throw failure("integrity_failure");
  return Object.freeze({ digest: digest as Sha256, raw });
};

const concatenate = (...parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (!Number.isSafeInteger(total)) throw failure("integrity_failure");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
};

const hashArtifact = async (
  domain: Uint8Array,
  body: Uint8Array,
): Promise<
  Readonly<{ digest: Sha256; bodyHash: Sha256; bodyRaw: ArrayBuffer }>
> => {
  const [artifact, bodyResult] = await Promise.all([
    hashBytes(concatenate(domain, body)),
    hashBytes(body),
  ]);
  return Object.freeze({
    digest: artifact.digest,
    bodyHash: bodyResult.digest,
    bodyRaw: bodyResult.raw,
  });
};

type ObjectAddress = Readonly<{
  environment: PublicationRecoveryBaseEnvironment;
  publicationId: string;
  relation: PublicationRecoveryBaseSource | "manifest";
  ordinal: number;
  digest: Sha256;
}>;

const isEnvironment = (
  value: unknown,
): value is PublicationRecoveryBaseEnvironment =>
  value === "local" ||
  value === "test" ||
  value === "preview" ||
  value === "production";

export const publicationRecoveryBaseObjectKey = (
  address: ObjectAddress,
): string => {
  if (
    !isEnvironment(address.environment) ||
    !PUBLICATION_ID.test(address.publicationId) ||
    (address.relation !== "manifest" &&
      !PUBLICATION_RECOVERY_BASE_SOURCES.includes(address.relation)) ||
    !Number.isSafeInteger(address.ordinal) ||
    address.ordinal < 0 ||
    address.ordinal > 999_999 ||
    !SHA256.test(address.digest)
  )
    throw failure("configuration_invalid");
  const extension = address.relation === "manifest" ? "json" : "bin";
  return `${KEY_PREFIX}/${address.environment}/${address.publicationId}/${address.relation}/${address.ordinal.toString().padStart(6, "0")}/${address.digest.slice("sha256:".length)}.${extension}`;
};

const exactKeys = (
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return false;
    const prototype: unknown = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) return false;
    const actual = (ownKeys as string[]).sort(compareAscii);
    const expected = [...keys].sort(compareAscii);
    if (
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])
    )
      return false;
    return actual.every((key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    });
  } catch {
    return false;
  }
};

const ownDataValue = (value: Record<string, unknown>, key: string): unknown => {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor))
    throw failure("configuration_invalid");
  return descriptor.value;
};

const scalar = (value: unknown): string | number | null => {
  if (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  )
    return value;
  throw failure("configuration_invalid");
};

const snapshotRow = <T extends Record<string, unknown>>(
  value: unknown,
  keys: readonly (keyof T & string)[],
): T => {
  try {
    if (!exactKeys(value, keys)) throw failure("configuration_invalid");
    return Object.freeze(
      Object.fromEntries(
        keys.map((key) => [key, scalar(ownDataValue(value, key))]),
      ),
    ) as T;
  } catch {
    throw failure("configuration_invalid");
  }
};

const snapshotArray = <T extends Record<string, unknown>>(
  value: unknown,
  keys: readonly (keyof T & string)[],
  keyOf: (row: T) => string,
): readonly T[] => {
  if (
    !Array.isArray(value) ||
    value.length > PUBLICATION_RECOVERY_BASE_MAX_TOTAL_ROWS
  )
    throw failure("configuration_invalid");
  try {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1 ||
      keys.some(
        (key) =>
          key !== "length" &&
          (typeof key !== "string" ||
            !/^(?:0|[1-9][0-9]*)$/u.test(key) ||
            Number(key) >= value.length),
      )
    )
      throw failure("configuration_invalid");
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (descriptor?.enumerable !== true || !("value" in descriptor))
        throw failure("configuration_invalid");
    }
  } catch {
    throw failure("configuration_invalid");
  }
  const rows = value.map((row) => snapshotRow<T>(row, keys));
  rows.sort((left, right) => compareAscii(keyOf(left), keyOf(right)));
  return Object.freeze(rows);
};

const sourceRowKey = (
  source: PublicationRecoveryBaseSource,
  row: SourceRow,
): string => {
  switch (source) {
    case "publication":
      return (row as ServingPublicationClosureRow).publication_id;
    case "publication_provider_slice":
    case "publication_provider_slice_metadata":
      return (row as ProviderSliceDispositionRow).provider_id;
    case "publication_provider_attribution": {
      const typed = row as ServingProviderAttributionClosureRow;
      return `${typed.resource_type}:${typed.resource_id}`;
    }
    case "publication_resource": {
      const typed = row as ServingResourceClosureRow;
      return `${typed.resource_type}:${typed.resource_id}`;
    }
    case "publication_search_document": {
      const typed = row as ServingSearchDocumentClosureRow;
      return `${typed.resource_type}:${typed.resource_id}`;
    }
    case "publication_vector_inventory": {
      const typed = row as ServingVectorClosureRow;
      return `${typed.resource_type}:${typed.resource_id}`;
    }
    case "publication_inventory_chunk": {
      const typed = row as ServingChunkClosureRow;
      return `${typed.kind}:${typed.ordinal.toString().padStart(10, "0")}`;
    }
  }
};

const snapshotClosure = (
  input: ServingClosureRows,
): Readonly<{
  sources: SourceRows;
  manifestContractVersion: "1.0.0";
  enabledProviderScopeVersion: string;
  bundleHash: Sha256;
}> => {
  try {
    const publication = snapshotArray<
      ServingPublicationClosureRow & Record<string, unknown>
    >(
      [input.publication],
      [
        "publication_id",
        "source_run_id",
        "parent_publication_id",
        "generated_at_ms",
        "schema_version",
        "methodology_version",
        "precision_normalization_version",
        "precision_display_order_version",
        "price_policy_version",
        "source_policy_version",
        "embedding_version",
        "build_commit",
        "closure_hash",
      ],
      (row) => row.publication_id,
    );
    const slices = snapshotArray<
      ServingProviderSliceClosureRow & Record<string, unknown>
    >(
      input.providerSlices,
      [
        "provider_id",
        "provider_slice_id",
        "provider_run_id",
        "adapter_version",
        "roster_version",
        "source_register_version",
        "carried_forward",
        "freshness_state",
      ],
      (row) => row.provider_id,
    );
    const dispositions = Object.freeze(
      slices.map((row) =>
        Object.freeze({
          provider_id: row.provider_id,
          provider_slice_id: row.provider_slice_id,
          provider_run_id: row.provider_run_id,
          carried_forward: row.carried_forward,
          freshness_state: row.freshness_state,
        }),
      ),
    );
    const metadata = Object.freeze(
      slices.map((row) =>
        Object.freeze({
          provider_id: row.provider_id,
          adapter_version: row.adapter_version,
          roster_version: row.roster_version,
          source_register_version: row.source_register_version,
        }),
      ),
    );
    const providerAttributions = snapshotArray<
      ServingProviderAttributionClosureRow & Record<string, unknown>
    >(
      input.providerAttributions,
      ["resource_type", "resource_id", "provider_id"],
      (row) => `${row.resource_type}:${row.resource_id}`,
    );
    const resources = snapshotArray<
      ServingResourceClosureRow & Record<string, unknown>
    >(
      input.resources,
      ["resource_type", "resource_id", "resource_json", "content_hash"],
      (row) => `${row.resource_type}:${row.resource_id}`,
    );
    const searchDocuments = snapshotArray<
      ServingSearchDocumentClosureRow & Record<string, unknown>
    >(
      input.searchDocuments,
      [
        "document_id",
        "resource_type",
        "resource_id",
        "normalized_name",
        "aliases_json",
        "publisher_name",
        "provider_model_ids_json",
        "document_text",
        "content_hash",
      ],
      (row) => `${row.resource_type}:${row.resource_id}`,
    );
    const vectors = snapshotArray<
      ServingVectorClosureRow & Record<string, unknown>
    >(
      input.vectors,
      [
        "vector_namespace",
        "vector_id",
        "resource_type",
        "resource_id",
        "search_document_content_hash",
        "embedding_input_hash",
      ],
      (row) => `${row.resource_type}:${row.resource_id}`,
    );
    const chunks = snapshotArray<
      ServingChunkClosureRow & Record<string, unknown>
    >(
      input.chunks,
      [
        "kind",
        "ordinal",
        "first_key",
        "last_key",
        "item_count",
        "content_hash",
      ],
      (row) => `${row.kind}:${row.ordinal.toString().padStart(10, "0")}`,
    );
    const manifestContractVersion: unknown = input.manifestContractVersion;
    const enabledProviderScopeVersion: unknown =
      input.enabledProviderScopeVersion;
    const bundleHash: unknown = input.bundleHash;
    if (
      manifestContractVersion !== "1.0.0" ||
      typeof enabledProviderScopeVersion !== "string" ||
      typeof bundleHash !== "string" ||
      !SHA256.test(bundleHash)
    )
      throw failure("configuration_invalid");
    return Object.freeze({
      sources: Object.freeze({
        publication,
        publication_provider_slice: dispositions,
        publication_provider_slice_metadata: metadata,
        publication_provider_attribution: providerAttributions,
        publication_resource: resources,
        publication_search_document: searchDocuments,
        publication_vector_inventory: vectors,
        publication_inventory_chunk: chunks,
      }),
      manifestContractVersion,
      enabledProviderScopeVersion,
      bundleHash: bundleHash as Sha256,
    });
  } catch {
    throw failure("configuration_invalid");
  }
};

const canonicalJson = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      !Object.is(value, -0))
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw failure("integrity_failure");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareAscii)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const encodeLengthPrefixedRows = (rows: readonly SourceRow[]): Uint8Array => {
  const encoded = rows.map((row) => utf8.encode(canonicalJson(row)));
  const total = encoded.reduce(
    (sum, row) => sum + 8 + row.byteLength,
    CHUNK_HEADER.byteLength,
  );
  if (!Number.isSafeInteger(total)) throw failure("configuration_invalid");
  const output = new Uint8Array(total);
  output.set(CHUNK_HEADER, 0);
  const view = new DataView(output.buffer);
  let offset = CHUNK_HEADER.byteLength;
  for (const row of encoded) {
    view.setBigUint64(offset, BigInt(row.byteLength), false);
    offset += 8;
    output.set(row, offset);
    offset += row.byteLength;
  }
  return output;
};

const canonicalRootText = (manifest: RootManifest): string =>
  canonicalJson({
    artifact_format: manifest.artifact_format,
    codec_version: manifest.codec_version,
    object_kind: manifest.object_kind,
    environment: manifest.environment,
    publication_id: manifest.publication_id,
    closure_hash: manifest.closure_hash,
    base_bundle_hash: manifest.base_bundle_hash,
    manifest_contract_version: manifest.manifest_contract_version,
    enabled_provider_scope_version: manifest.enabled_provider_scope_version,
    serving_schema_version: manifest.serving_schema_version,
    sources: manifest.sources.map((source) => ({
      source: source.source,
      row_count: source.row_count,
      chunk_count: source.chunk_count,
      byte_count: source.byte_count,
      chunks: source.chunks.map((chunk) => ({
        ordinal: chunk.ordinal,
        first_key: chunk.first_key,
        last_key: chunk.last_key,
        row_count: chunk.row_count,
        byte_count: chunk.byte_count,
        artifact_digest: chunk.artifact_digest,
        object_key: chunk.object_key,
      })),
    })),
    total_row_count: manifest.total_row_count,
    total_byte_count: manifest.total_byte_count,
  });

const exactHttpMetadata = (
  metadata: R2HTTPMetadata | undefined,
  kind: "root_manifest" | "source_chunk",
): boolean => {
  try {
    const candidate: unknown = metadata;
    if (typeof candidate !== "object" || candidate === null) return false;
    const allowed = new Set([
      "contentType",
      "cacheControl",
      "contentLanguage",
      "contentDisposition",
      "contentEncoding",
      "cacheExpiry",
    ]);
    const keys = Reflect.ownKeys(candidate);
    if (keys.some((key) => typeof key !== "string" || !allowed.has(key)))
      return false;
    const read = (key: string): unknown => {
      const descriptor = Reflect.getOwnPropertyDescriptor(candidate, key);
      if (descriptor === undefined) return undefined;
      if (!("value" in descriptor) || descriptor.enumerable !== true)
        throw failure("integrity_failure");
      return descriptor.value;
    };
    return (
      read("contentType") ===
        (kind === "root_manifest"
          ? PUBLICATION_RECOVERY_BASE_CONTENT_TYPE
          : PUBLICATION_RECOVERY_CHUNK_CONTENT_TYPE) &&
      read("cacheControl") === "private, no-store" &&
      read("contentLanguage") === undefined &&
      read("contentDisposition") === undefined &&
      read("contentEncoding") === undefined &&
      read("cacheExpiry") === undefined
    );
  } catch {
    return false;
  }
};

const exactCustomMetadata = (
  metadata: Readonly<Record<string, string>> | undefined,
  address: ObjectAddress,
  kind: "root_manifest" | "source_chunk",
  digest: Sha256,
  bodyHash: Sha256,
  byteCount: number,
): boolean => {
  if (metadata === undefined) return false;
  const expected = {
    "artifact-format": PUBLICATION_RECOVERY_BASE_FORMAT,
    "artifact-digest": digest,
    "body-sha256": bodyHash,
    "byte-count": String(byteCount),
    environment: address.environment,
    "object-kind": kind,
    ordinal: String(address.ordinal),
    "publication-id": address.publicationId,
    relation: address.relation,
    "retention-class": PUBLICATION_RECOVERY_BASE_RETENTION_CLASS,
  };
  if (!exactKeys(metadata, Object.keys(expected))) return false;
  return Object.entries(expected).every(
    ([key, value]) => ownDataValue(metadata, key) === value,
  );
};

const equalBytes = (left: ArrayBuffer, right: ArrayBuffer): boolean => {
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.byteLength; index += 1)
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
};

const writeObject = async (
  writer: PublicationRecoveryBaseWriteBucket,
  reader: PublicationRecoveryBaseReadBucket,
  bytes: Uint8Array,
  addressInput: Omit<ObjectAddress, "digest">,
  kind: "root_manifest" | "source_chunk",
): Promise<Readonly<{ digest: Sha256; byteCount: number }>> => {
  const domain =
    kind === "root_manifest" ? MANIFEST_DIGEST_DOMAIN : CHUNK_DIGEST_DOMAIN;
  const hashed = await hashArtifact(domain, bytes);
  const address = Object.freeze({ ...addressInput, digest: hashed.digest });
  const key = publicationRecoveryBaseObjectKey(address);
  try {
    await writer.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: hashed.bodyRaw,
      httpMetadata: {
        contentType:
          kind === "root_manifest"
            ? PUBLICATION_RECOVERY_BASE_CONTENT_TYPE
            : PUBLICATION_RECOVERY_CHUNK_CONTENT_TYPE,
        cacheControl: "private, no-store",
      },
      customMetadata: {
        "artifact-format": PUBLICATION_RECOVERY_BASE_FORMAT,
        "artifact-digest": hashed.digest,
        "body-sha256": hashed.bodyHash,
        "byte-count": String(bytes.byteLength),
        environment: address.environment,
        "object-kind": kind,
        ordinal: String(address.ordinal),
        "publication-id": address.publicationId,
        relation: address.relation,
        "retention-class": PUBLICATION_RECOVERY_BASE_RETENTION_CLASS,
      },
    });
  } catch {
    // Conditional conflicts and ambiguous writes are reconciled only by an
    // exact read through the same hostile byte-verification boundary.
  }
  await readObject(reader, address, bytes.byteLength, kind);
  return Object.freeze({ digest: hashed.digest, byteCount: bytes.byteLength });
};

const chunksForSource = async (
  writer: PublicationRecoveryBaseWriteBucket,
  reader: PublicationRecoveryBaseReadBucket,
  environment: PublicationRecoveryBaseEnvironment,
  publicationId: string,
  source: PublicationRecoveryBaseSource,
  rows: readonly SourceRow[],
  budget: Readonly<{ maximumObjects: number; maximumBytes: number }>,
): Promise<SourceDescriptor> => {
  const descriptors: ChunkDescriptor[] = [];
  let pending: SourceRow[] = [];
  let pendingBytes = 0;
  let firstKey = "";
  let lastKey = "";
  let byteCount = 0;

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    const ordinal = descriptors.length;
    const bytes = encodeLengthPrefixedRows(pending);
    if (
      bytes.byteLength > PUBLICATION_RECOVERY_BASE_MAX_OBJECT_BYTES ||
      descriptors.length >= budget.maximumObjects ||
      byteCount + bytes.byteLength > budget.maximumBytes
    )
      throw failure("configuration_invalid");
    const stored = await writeObject(
      writer,
      reader,
      bytes,
      { environment, publicationId, relation: source, ordinal },
      "source_chunk",
    );
    const objectKey = publicationRecoveryBaseObjectKey({
      environment,
      publicationId,
      relation: source,
      ordinal,
      digest: stored.digest,
    });
    descriptors.push(
      Object.freeze({
        ordinal,
        first_key: firstKey,
        last_key: lastKey,
        row_count: pending.length,
        byte_count: stored.byteCount,
        artifact_digest: stored.digest,
        object_key: objectKey,
      }),
    );
    byteCount += stored.byteCount;
    pending = [];
    pendingBytes = 0;
  };

  for (const row of rows) {
    const rowText = canonicalJson(row);
    const rowBytes = utf8.encode(rowText).byteLength;
    if (rowBytes > PUBLICATION_RECOVERY_BASE_MAX_ROW_BYTES)
      throw failure("configuration_invalid");
    const prospectiveBytes =
      CHUNK_HEADER.byteLength +
      pendingBytes +
      rowBytes +
      8 * (pending.length + 1);
    if (
      pending.length > 0 &&
      prospectiveBytes > PUBLICATION_RECOVERY_BASE_MAX_OBJECT_BYTES
    )
      await flush();
    if (pending.length === 0) firstKey = sourceRowKey(source, row);
    pending.push(row);
    pendingBytes += rowBytes;
    lastKey = sourceRowKey(source, row);
  }
  await flush();
  return Object.freeze({
    source,
    row_count: rows.length,
    chunk_count: descriptors.length,
    byte_count: byteCount,
    chunks: Object.freeze(descriptors),
  });
};

const sameManifestAuthority = (
  left: TrustedImmutablePublicationManifest,
  right: TrustedImmutablePublicationManifest,
): boolean =>
  left.contractVersion === right.contractVersion &&
  left.publicationId === right.publicationId &&
  left.sourceRunId === right.sourceRunId &&
  left.parentPublicationId === right.parentPublicationId &&
  left.generatedAt === right.generatedAt &&
  left.versions.schema === right.versions.schema &&
  left.versions.methodology === right.versions.methodology &&
  left.versions.precisionNormalization ===
    right.versions.precisionNormalization &&
  left.versions.precisionDisplayOrder ===
    right.versions.precisionDisplayOrder &&
  left.versions.pricePolicy === right.versions.pricePolicy &&
  left.versions.sourcePolicy === right.versions.sourcePolicy &&
  left.versions.embedding === right.versions.embedding &&
  left.versions.buildCommit === right.versions.buildCommit &&
  left.enabledProviderScopeVersion === right.enabledProviderScopeVersion &&
  left.bundleHash === right.bundleHash &&
  left.enabledProviderScopeHash === right.enabledProviderScopeHash &&
  left.providerSliceHash === right.providerSliceHash &&
  left.providerAttributionHash === right.providerAttributionHash &&
  left.resourceInventoryHash === right.resourceInventoryHash &&
  left.exactSearchInventoryHash === right.exactSearchInventoryHash &&
  left.vectorInventoryHash === right.vectorInventoryHash &&
  left.chunkRootHash === right.chunkRootHash &&
  left.closureHash === right.closureHash;

/**
 * Writes only the eight immutable canonical serving inputs. Every object is
 * content-addressed and create-only; this capability cannot read, list,
 * overwrite, or delete protected recovery data.
 */
export const archivePublicationRecoveryBase = async (
  writer: PublicationRecoveryBaseWriteBucket,
  reader: PublicationRecoveryBaseReadBucket,
  environment: PublicationRecoveryBaseEnvironment,
  manifest: TrustedImmutablePublicationManifest,
  input: ServingClosureRows,
): Promise<PublicationRecoveryBaseLocator> => {
  if (!isEnvironment(environment)) throw failure("configuration_invalid");
  try {
    assertImmutablePublicationManifest(manifest);
  } catch {
    throw failure("configuration_invalid");
  }
  const snapshot = snapshotClosure(input);
  const sourceRowCount = PUBLICATION_RECOVERY_BASE_SOURCES.reduce(
    (sum, source) => sum + snapshot.sources[source].length,
    0,
  );
  if (
    !Number.isSafeInteger(sourceRowCount) ||
    sourceRowCount > PUBLICATION_RECOVERY_BASE_MAX_TOTAL_ROWS
  )
    throw failure("configuration_invalid");
  const replayRows = combineSources(snapshot.sources, {
    manifestContractVersion: snapshot.manifestContractVersion,
    enabledProviderScopeVersion: snapshot.enabledProviderScopeVersion,
    bundleHash: snapshot.bundleHash,
  });
  let projected: Awaited<ReturnType<typeof projectServingClosureSeal>>;
  try {
    projected = await projectServingClosureSeal(replayRows);
  } catch {
    throw failure("configuration_invalid");
  }
  if (!sameManifestAuthority(projected.manifest, manifest))
    throw failure("configuration_invalid");
  const publicationId = projected.manifest.publicationId;
  const sources: SourceDescriptor[] = [];
  let totalRows = 0;
  let totalBytes = 0;
  let totalObjects = 0;
  for (const source of PUBLICATION_RECOVERY_BASE_SOURCES) {
    const descriptor = await chunksForSource(
      writer,
      reader,
      environment,
      publicationId,
      source,
      snapshot.sources[source],
      {
        maximumObjects:
          PUBLICATION_RECOVERY_BASE_MAX_OBJECTS - totalObjects - 1,
        maximumBytes: PUBLICATION_RECOVERY_BASE_MAX_TOTAL_BYTES - totalBytes,
      },
    );
    sources.push(descriptor);
    totalRows += descriptor.row_count;
    totalBytes += descriptor.byte_count;
    totalObjects += descriptor.chunk_count;
    if (
      totalRows > PUBLICATION_RECOVERY_BASE_MAX_TOTAL_ROWS ||
      totalBytes > PUBLICATION_RECOVERY_BASE_MAX_TOTAL_BYTES ||
      totalObjects >= PUBLICATION_RECOVERY_BASE_MAX_OBJECTS
    )
      throw failure("configuration_invalid");
  }
  const root: RootManifest = Object.freeze({
    artifact_format: PUBLICATION_RECOVERY_BASE_FORMAT,
    codec_version: PUBLICATION_RECOVERY_BASE_CODEC_VERSION,
    object_kind: "root_manifest",
    environment,
    publication_id: publicationId,
    closure_hash: projected.manifest.closureHash,
    base_bundle_hash: projected.manifest.bundleHash,
    manifest_contract_version: snapshot.manifestContractVersion,
    enabled_provider_scope_version: snapshot.enabledProviderScopeVersion,
    serving_schema_version: replayRows.publication.schema_version,
    sources: Object.freeze(sources),
    total_row_count: totalRows,
    total_byte_count: totalBytes,
  });
  const rootBytes = utf8.encode(canonicalRootText(root));
  if (
    rootBytes.byteLength > PUBLICATION_RECOVERY_BASE_MAX_OBJECT_BYTES ||
    totalBytes + rootBytes.byteLength >
      PUBLICATION_RECOVERY_BASE_MAX_TOTAL_BYTES
  )
    throw failure("configuration_invalid");
  const stored = await writeObject(
    writer,
    reader,
    rootBytes,
    { environment, publicationId, relation: "manifest", ordinal: 0 },
    "root_manifest",
  );
  return Object.freeze({
    format: PUBLICATION_RECOVERY_BASE_FORMAT,
    environment,
    publicationId,
    closureHash: projected.manifest.closureHash,
    bundleHash: projected.manifest.bundleHash,
    rootDigest: stored.digest,
    rootByteCount: stored.byteCount,
  });
};

const readObject = async (
  bucket: PublicationRecoveryBaseReadBucket,
  address: ObjectAddress,
  expectedByteCount: number,
  kind: "root_manifest" | "source_chunk",
): Promise<Uint8Array> => {
  if (
    !Number.isSafeInteger(expectedByteCount) ||
    expectedByteCount < 1 ||
    expectedByteCount > PUBLICATION_RECOVERY_BASE_MAX_OBJECT_BYTES
  )
    throw failure("integrity_failure");
  const key = publicationRecoveryBaseObjectKey(address);
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key);
  } catch {
    throw failure("outcome_unknown");
  }
  if (object === null) throw failure("not_applied");
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    if (
      object.key !== key ||
      object.size !== expectedByteCount ||
      !exactHttpMetadata(object.httpMetadata, kind)
    )
      throw failure("integrity_failure");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      trustedFailureCodes.get(error) === "integrity_failure"
    )
      throw error;
    throw failure("integrity_failure");
  }
  let body: ReadableStream<Uint8Array>;
  try {
    const candidate: unknown = object.body;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof Reflect.get(candidate, "getReader") !== "function"
    )
      throw failure("integrity_failure");
    body = candidate as ReadableStream<Uint8Array>;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      trustedFailureCodes.get(error) === "integrity_failure"
    )
      throw error;
    throw failure("outcome_unknown");
  }
  try {
    // R2ObjectBody's generated ambient type erases the body chunk generic;
    // each yielded value is still checked below before use.
    reader = body.getReader();
  } catch {
    throw failure("outcome_unknown");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let streamChunks = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      if (
        !(result.value instanceof Uint8Array) ||
        result.value.byteLength === 0
      )
        throw failure("integrity_failure");
      streamChunks += 1;
      total += result.value.byteLength;
      if (
        streamChunks > MAX_STREAM_CHUNKS_PER_OBJECT ||
        !Number.isSafeInteger(total) ||
        total > expectedByteCount
      )
        throw failure("integrity_failure");
      chunks.push(Uint8Array.from(result.value));
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the classified read failure.
    }
    if (
      typeof error === "object" &&
      error !== null &&
      trustedFailureCodes.get(error) === "integrity_failure"
    )
      throw error;
    throw failure("outcome_unknown");
  }
  if (total !== expectedByteCount) throw failure("integrity_failure");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  )
    throw failure("integrity_failure");
  const domain =
    kind === "root_manifest" ? MANIFEST_DIGEST_DOMAIN : CHUNK_DIGEST_DOMAIN;
  const hashed = await hashArtifact(domain, bytes);
  if (hashed.digest !== address.digest) throw failure("integrity_failure");
  try {
    if (
      !exactCustomMetadata(
        object.customMetadata,
        address,
        kind,
        address.digest,
        hashed.bodyHash,
        expectedByteCount,
      ) ||
      !(object.checksums.sha256 instanceof ArrayBuffer) ||
      !equalBytes(object.checksums.sha256, hashed.bodyRaw)
    )
      throw failure("integrity_failure");
  } catch {
    throw failure("integrity_failure");
  }
  return bytes;
};

const parseRoot = (text: string): RootManifest => {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw failure("integrity_failure");
  }
  if (
    !exactKeys(value, [
      "artifact_format",
      "codec_version",
      "object_kind",
      "environment",
      "publication_id",
      "closure_hash",
      "base_bundle_hash",
      "manifest_contract_version",
      "enabled_provider_scope_version",
      "serving_schema_version",
      "sources",
      "total_row_count",
      "total_byte_count",
    ]) ||
    value.artifact_format !== PUBLICATION_RECOVERY_BASE_FORMAT ||
    value.codec_version !== PUBLICATION_RECOVERY_BASE_CODEC_VERSION ||
    value.object_kind !== "root_manifest" ||
    !isEnvironment(value.environment) ||
    typeof value.publication_id !== "string" ||
    typeof value.closure_hash !== "string" ||
    !SHA256.test(value.closure_hash) ||
    typeof value.base_bundle_hash !== "string" ||
    !SHA256.test(value.base_bundle_hash) ||
    value.manifest_contract_version !== "1.0.0" ||
    typeof value.enabled_provider_scope_version !== "string" ||
    typeof value.serving_schema_version !== "string" ||
    !Array.isArray(value.sources) ||
    value.sources.length !== PUBLICATION_RECOVERY_BASE_SOURCES.length ||
    !Number.isSafeInteger(value.total_row_count) ||
    !Number.isSafeInteger(value.total_byte_count)
  )
    throw failure("integrity_failure");
  const sources = value.sources.map(
    (sourceValue, sourceIndex): SourceDescriptor => {
      if (
        !exactKeys(sourceValue, [
          "source",
          "row_count",
          "chunk_count",
          "byte_count",
          "chunks",
        ]) ||
        sourceValue.source !== PUBLICATION_RECOVERY_BASE_SOURCES[sourceIndex] ||
        !Number.isSafeInteger(sourceValue.row_count) ||
        (sourceValue.row_count as number) < 0 ||
        !Number.isSafeInteger(sourceValue.chunk_count) ||
        (sourceValue.chunk_count as number) < 0 ||
        !Number.isSafeInteger(sourceValue.byte_count) ||
        (sourceValue.byte_count as number) < 0 ||
        !Array.isArray(sourceValue.chunks) ||
        sourceValue.chunks.length !== sourceValue.chunk_count
      )
        throw failure("integrity_failure");
      const chunks = sourceValue.chunks.map(
        (chunkValue, ordinal): ChunkDescriptor => {
          if (
            !exactKeys(chunkValue, [
              "ordinal",
              "first_key",
              "last_key",
              "row_count",
              "byte_count",
              "artifact_digest",
              "object_key",
            ]) ||
            chunkValue.ordinal !== ordinal ||
            typeof chunkValue.first_key !== "string" ||
            typeof chunkValue.last_key !== "string" ||
            !Number.isSafeInteger(chunkValue.row_count) ||
            (chunkValue.row_count as number) < 1 ||
            !Number.isSafeInteger(chunkValue.byte_count) ||
            (chunkValue.byte_count as number) < 1 ||
            (chunkValue.byte_count as number) >
              PUBLICATION_RECOVERY_BASE_MAX_OBJECT_BYTES ||
            typeof chunkValue.artifact_digest !== "string" ||
            !SHA256.test(chunkValue.artifact_digest) ||
            typeof chunkValue.object_key !== "string"
          )
            throw failure("integrity_failure");
          return Object.freeze({
            ordinal,
            first_key: chunkValue.first_key,
            last_key: chunkValue.last_key,
            row_count: chunkValue.row_count as number,
            byte_count: chunkValue.byte_count as number,
            artifact_digest: chunkValue.artifact_digest as Sha256,
            object_key: chunkValue.object_key,
          });
        },
      );
      if (
        chunks.some(
          (chunk, index) =>
            compareAscii(chunk.first_key, chunk.last_key) > 0 ||
            (index > 0 &&
              compareAscii(
                chunks[index - 1]?.last_key ?? "",
                chunk.first_key,
              ) >= 0),
        ) ||
        chunks.reduce((sum, chunk) => sum + chunk.row_count, 0) !==
          sourceValue.row_count ||
        chunks.reduce((sum, chunk) => sum + chunk.byte_count, 0) !==
          sourceValue.byte_count
      )
        throw failure("integrity_failure");
      return Object.freeze({
        source: sourceValue.source as PublicationRecoveryBaseSource,
        row_count: sourceValue.row_count,
        chunk_count: sourceValue.chunk_count,
        byte_count: sourceValue.byte_count,
        chunks: Object.freeze(chunks),
      });
    },
  );
  const root = Object.freeze({
    artifact_format: PUBLICATION_RECOVERY_BASE_FORMAT,
    codec_version: PUBLICATION_RECOVERY_BASE_CODEC_VERSION,
    object_kind: "root_manifest" as const,
    environment: value.environment,
    publication_id: value.publication_id,
    closure_hash: value.closure_hash,
    base_bundle_hash: value.base_bundle_hash,
    manifest_contract_version: "1.0.0" as const,
    enabled_provider_scope_version: value.enabled_provider_scope_version,
    serving_schema_version: value.serving_schema_version,
    sources: Object.freeze(sources),
    total_row_count: value.total_row_count as number,
    total_byte_count: value.total_byte_count as number,
  });
  const totalRows = sources.reduce((sum, source) => sum + source.row_count, 0);
  const totalBytes = sources.reduce(
    (sum, source) => sum + source.byte_count,
    0,
  );
  const totalObjects = sources.reduce(
    (sum, source) => sum + source.chunk_count,
    0,
  );
  const heapEstimate =
    RETAINED_HEAP_FIXED_RESERVE +
    totalBytes * RETAINED_HEAP_BYTES_MULTIPLIER +
    totalRows * RETAINED_HEAP_ROW_OVERHEAD;
  if (
    totalRows !== root.total_row_count ||
    totalBytes !== root.total_byte_count ||
    totalRows > PUBLICATION_RECOVERY_BASE_MAX_TOTAL_ROWS ||
    totalBytes > PUBLICATION_RECOVERY_BASE_MAX_TOTAL_BYTES ||
    totalObjects >= PUBLICATION_RECOVERY_BASE_MAX_OBJECTS ||
    !Number.isSafeInteger(heapEstimate) ||
    heapEstimate > PUBLICATION_RECOVERY_BASE_RETAINED_HEAP_BUDGET ||
    canonicalRootText(root) !== text
  )
    throw failure("integrity_failure");
  return root;
};

const rowKeys: Readonly<
  Record<PublicationRecoveryBaseSource, readonly string[]>
> = Object.freeze({
  publication: [
    "publication_id",
    "source_run_id",
    "parent_publication_id",
    "generated_at_ms",
    "schema_version",
    "methodology_version",
    "precision_normalization_version",
    "precision_display_order_version",
    "price_policy_version",
    "source_policy_version",
    "embedding_version",
    "build_commit",
    "closure_hash",
  ],
  publication_provider_slice: [
    "provider_id",
    "provider_slice_id",
    "provider_run_id",
    "carried_forward",
    "freshness_state",
  ],
  publication_provider_slice_metadata: [
    "provider_id",
    "adapter_version",
    "roster_version",
    "source_register_version",
  ],
  publication_provider_attribution: [
    "resource_type",
    "resource_id",
    "provider_id",
  ],
  publication_resource: [
    "resource_type",
    "resource_id",
    "resource_json",
    "content_hash",
  ],
  publication_search_document: [
    "document_id",
    "resource_type",
    "resource_id",
    "normalized_name",
    "aliases_json",
    "publisher_name",
    "provider_model_ids_json",
    "document_text",
    "content_hash",
  ],
  publication_vector_inventory: [
    "vector_namespace",
    "vector_id",
    "resource_type",
    "resource_id",
    "search_document_content_hash",
    "embedding_input_hash",
  ],
  publication_inventory_chunk: [
    "kind",
    "ordinal",
    "first_key",
    "last_key",
    "item_count",
    "content_hash",
  ],
});

const parseChunk = (
  bytes: Uint8Array,
  descriptor: SourceDescriptor,
  chunk: ChunkDescriptor,
): readonly SourceRow[] => {
  if (
    bytes.byteLength < CHUNK_HEADER.byteLength ||
    CHUNK_HEADER.some((value, index) => bytes[index] !== value)
  )
    throw failure("integrity_failure");
  const rows: SourceRow[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = CHUNK_HEADER.byteLength;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 8) throw failure("integrity_failure");
    const length = view.getBigUint64(offset, false);
    offset += 8;
    if (length < 1n || length > BigInt(PUBLICATION_RECOVERY_BASE_MAX_ROW_BYTES))
      throw failure("integrity_failure");
    const count = Number(length);
    if (!Number.isSafeInteger(count) || offset + count > bytes.byteLength)
      throw failure("integrity_failure");
    const rowBytes = bytes.subarray(offset, offset + count);
    offset += count;
    if (
      rowBytes.byteLength >= 3 &&
      rowBytes[0] === 0xef &&
      rowBytes[1] === 0xbb &&
      rowBytes[2] === 0xbf
    )
      throw failure("integrity_failure");
    let text: string;
    let parsed: unknown;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        rowBytes,
      );
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw failure("integrity_failure");
    }
    let row: SourceRow;
    try {
      row = snapshotRow<Record<string, unknown>>(
        parsed,
        rowKeys[descriptor.source],
      ) as SourceRow;
    } catch {
      throw failure("integrity_failure");
    }
    if (canonicalJson(row) !== text) throw failure("integrity_failure");
    rows.push(row);
    if (rows.length > chunk.row_count) throw failure("integrity_failure");
  }
  if (offset !== bytes.byteLength || rows.length !== chunk.row_count)
    throw failure("integrity_failure");
  const keys = rows.map((row) => sourceRowKey(descriptor.source, row));
  if (
    keys[0] !== chunk.first_key ||
    keys.at(-1) !== chunk.last_key ||
    keys.some(
      (key, index) =>
        index > 0 && compareAscii(keys[index - 1] ?? "", key) >= 0,
    ) ||
    !equalUint8Arrays(encodeLengthPrefixedRows(rows), bytes)
  )
    throw failure("integrity_failure");
  return Object.freeze(rows.map((row) => Object.freeze(row)));
};

const equalUint8Arrays = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
};

const combineSources = (
  sources: SourceRows,
  context: Readonly<{
    manifestContractVersion: "1.0.0";
    enabledProviderScopeVersion: string;
    bundleHash: Sha256;
  }>,
): ServingClosureRows => {
  const publications =
    sources.publication as readonly ServingPublicationClosureRow[];
  if (publications.length !== 1) throw failure("integrity_failure");
  const publication = publications[0];
  if (publication === undefined) throw failure("integrity_failure");
  const metadataRows =
    sources.publication_provider_slice_metadata as readonly ProviderSliceMetadataRow[];
  const metadata = new Map(metadataRows.map((row) => [row.provider_id, row]));
  const dispositionRows =
    sources.publication_provider_slice as readonly ProviderSliceDispositionRow[];
  if (
    metadata.size !== metadataRows.length ||
    dispositionRows.length !== metadataRows.length
  )
    throw failure("integrity_failure");
  const providerSlices = dispositionRows.map(
    (row): ServingProviderSliceClosureRow => {
      const detail = metadata.get(row.provider_id);
      if (detail === undefined) throw failure("integrity_failure");
      return Object.freeze({ ...row, ...detail });
    },
  );
  const rows: ServingClosureRows = Object.freeze({
    publication,
    providerSlices: Object.freeze(providerSlices),
    providerAttributions:
      sources.publication_provider_attribution as readonly ServingProviderAttributionClosureRow[],
    resources:
      sources.publication_resource as readonly ServingResourceClosureRow[],
    searchDocuments:
      sources.publication_search_document as readonly ServingSearchDocumentClosureRow[],
    vectors:
      sources.publication_vector_inventory as readonly ServingVectorClosureRow[],
    chunks:
      sources.publication_inventory_chunk as readonly ServingChunkClosureRow[],
    manifestContractVersion: context.manifestContractVersion,
    enabledProviderScopeVersion: context.enabledProviderScopeVersion,
    bundleHash: context.bundleHash,
    // These operational seal fields are deliberately absent from the archive.
    // Fixed local values permit semantic replay without importing serving state.
    stagingRevision: 0,
    sealedAtMs: publication.generated_at_ms,
  });
  return rows;
};

const independentlyRebuildManifest = async (
  rows: ServingClosureRows,
  projected: TrustedImmutablePublicationManifest,
): Promise<TrustedImmutablePublicationManifest> =>
  buildImmutableManifestFromPersistedContent({
    contractVersion: projected.contractVersion,
    publicationId: projected.publicationId,
    sourceRunId: projected.sourceRunId,
    parentPublicationId: projected.parentPublicationId,
    generatedAt: projected.generatedAt,
    versions: projected.versions,
    enabledProviderScopeVersion: projected.enabledProviderScopeVersion,
    enabledProviderIds: projected.enabledProviderIds,
    providerSlices: projected.providerSlices,
    providerAttributions: projected.providerAttributions,
    resources: rows.resources.map((row) => ({
      resourceType:
        row.resource_type as (typeof projected.resources)[number]["resourceType"],
      resourceId: row.resource_id,
      resourceJson: row.resource_json,
      contentHash: row.content_hash as Sha256,
    })),
    searchDocuments: rows.searchDocuments.map((row) => ({
      resourceType: row.resource_type as "model" | "variant",
      resourceId: row.resource_id,
      documentId: row.document_id,
      normalizedName: row.normalized_name,
      aliasesJson: row.aliases_json,
      publisherName: row.publisher_name,
      providerModelIdsJson: row.provider_model_ids_json,
      documentText: row.document_text,
      contentHash: row.content_hash as Sha256,
    })),
    vectors: projected.vectors,
    chunks: projected.chunks,
    bundleHash: projected.bundleHash,
  });

/**
 * Reads only exact digest-derived keys, independently verifies every byte and
 * R2 checksum/metadata field, decodes the eight closed source sets, and mints
 * nominal byte-and-semantic verification only after two manifest replays agree.
 */
export const verifyPublicationRecoveryBase = async (
  bucket: PublicationRecoveryBaseReadBucket,
  locatorValue: unknown,
): Promise<VerifiedPublicationRecoveryBase> => {
  let locator: PublicationRecoveryBaseLocator;
  try {
    if (typeof locatorValue !== "object" || locatorValue === null)
      throw failure("configuration_invalid");
    if (
      !exactKeys(locatorValue, [
        "format",
        "environment",
        "publicationId",
        "closureHash",
        "bundleHash",
        "rootDigest",
        "rootByteCount",
      ]) ||
      ownDataValue(locatorValue, "format") !==
        PUBLICATION_RECOVERY_BASE_FORMAT ||
      !isEnvironment(ownDataValue(locatorValue, "environment")) ||
      typeof ownDataValue(locatorValue, "publicationId") !== "string" ||
      !PUBLICATION_ID.test(
        ownDataValue(locatorValue, "publicationId") as string,
      ) ||
      typeof ownDataValue(locatorValue, "closureHash") !== "string" ||
      !SHA256.test(ownDataValue(locatorValue, "closureHash") as string) ||
      typeof ownDataValue(locatorValue, "bundleHash") !== "string" ||
      !SHA256.test(ownDataValue(locatorValue, "bundleHash") as string) ||
      typeof ownDataValue(locatorValue, "rootDigest") !== "string" ||
      !SHA256.test(ownDataValue(locatorValue, "rootDigest") as string) ||
      !Number.isSafeInteger(ownDataValue(locatorValue, "rootByteCount")) ||
      (ownDataValue(locatorValue, "rootByteCount") as number) < 1 ||
      (ownDataValue(locatorValue, "rootByteCount") as number) >
        PUBLICATION_RECOVERY_BASE_MAX_OBJECT_BYTES
    )
      throw failure("configuration_invalid");
    locator = Object.freeze({
      format: PUBLICATION_RECOVERY_BASE_FORMAT,
      environment: ownDataValue(
        locatorValue,
        "environment",
      ) as PublicationRecoveryBaseEnvironment,
      publicationId: ownDataValue(locatorValue, "publicationId") as string,
      closureHash: ownDataValue(locatorValue, "closureHash") as Sha256,
      bundleHash: ownDataValue(locatorValue, "bundleHash") as Sha256,
      rootDigest: ownDataValue(locatorValue, "rootDigest") as Sha256,
      rootByteCount: ownDataValue(locatorValue, "rootByteCount") as number,
    });
  } catch {
    throw failure("configuration_invalid");
  }
  const rootBytes = await readObject(
    bucket,
    {
      environment: locator.environment,
      publicationId: locator.publicationId,
      relation: "manifest",
      ordinal: 0,
      digest: locator.rootDigest,
    },
    locator.rootByteCount,
    "root_manifest",
  );
  let rootText: string;
  try {
    rootText = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(rootBytes);
  } catch {
    throw failure("integrity_failure");
  }
  const root = parseRoot(rootText);
  if (
    root.total_byte_count + locator.rootByteCount >
      PUBLICATION_RECOVERY_BASE_MAX_TOTAL_BYTES ||
    root.environment !== locator.environment ||
    root.publication_id !== locator.publicationId ||
    root.closure_hash !== locator.closureHash ||
    root.base_bundle_hash !== locator.bundleHash
  )
    throw failure("integrity_failure");
  const mutable = Object.fromEntries(
    PUBLICATION_RECOVERY_BASE_SOURCES.map((source) => [source, []]),
  ) as unknown as Record<PublicationRecoveryBaseSource, SourceRow[]>;
  for (const source of root.sources) {
    for (const chunk of source.chunks) {
      const address: ObjectAddress = {
        environment: root.environment,
        publicationId: root.publication_id,
        relation: source.source,
        ordinal: chunk.ordinal,
        digest: chunk.artifact_digest,
      };
      if (publicationRecoveryBaseObjectKey(address) !== chunk.object_key)
        throw failure("integrity_failure");
      const bytes = await readObject(
        bucket,
        address,
        chunk.byte_count,
        "source_chunk",
      );
      mutable[source.source].push(...parseChunk(bytes, source, chunk));
    }
    if (mutable[source.source].length !== source.row_count)
      throw failure("integrity_failure");
  }
  const sources = Object.freeze(
    Object.fromEntries(
      PUBLICATION_RECOVERY_BASE_SOURCES.map((source) => [
        source,
        Object.freeze(mutable[source]),
      ]),
    ),
  ) as SourceRows;
  const rows = combineSources(sources, {
    manifestContractVersion: root.manifest_contract_version,
    enabledProviderScopeVersion: root.enabled_provider_scope_version,
    bundleHash: root.base_bundle_hash,
  });
  let projected: Awaited<ReturnType<typeof projectServingClosureSeal>>;
  let rebuilt: TrustedImmutablePublicationManifest;
  try {
    projected = await projectServingClosureSeal(rows);
    rebuilt = await independentlyRebuildManifest(rows, projected.manifest);
  } catch {
    throw failure("integrity_failure");
  }
  if (
    projected.manifest.publicationId !== root.publication_id ||
    projected.manifest.closureHash !== root.closure_hash ||
    projected.manifest.bundleHash !== root.base_bundle_hash ||
    projected.manifest.versions.schema !== root.serving_schema_version ||
    rebuilt.closureHash !== projected.manifest.closureHash ||
    rebuilt.resourceInventoryHash !==
      projected.manifest.resourceInventoryHash ||
    rebuilt.exactSearchInventoryHash !==
      projected.manifest.exactSearchInventoryHash ||
    rebuilt.vectorInventoryHash !== projected.manifest.vectorInventoryHash ||
    rebuilt.chunkRootHash !== projected.manifest.chunkRootHash
  )
    throw failure("integrity_failure");
  const authority = {
    locator,
    closureRows: rows,
    manifest: rebuilt,
    closureHash: rebuilt.closureHash,
    bundleHash: rebuilt.bundleHash,
  };
  Object.defineProperty(authority, recoveryBaseBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  verifiedRecoveryBases.add(authority);
  return Object.freeze(authority) as VerifiedPublicationRecoveryBase;
};
