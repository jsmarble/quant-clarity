import type {
  PublicationRecoveryBaseEnvironment,
  PublicationRecoveryBaseLocator,
  PublicationRecoveryBaseSource,
} from "../src/publication-recovery-base.js";

import type { MaximumObjectPublicationRecoveryFixture } from "./publication-recovery-accepted-bound-fixture.js";

const utf8 = new TextEncoder();
const ARCHIVE_FORMAT = "publication-recovery-base@1" as const;
const CODEC_VERSION = "1.0.0" as const;
const ROOT_CONTENT_TYPE =
  "application/vnd.quantclarity.publication-recovery-base+json" as const;
const CHUNK_CONTENT_TYPE =
  "application/vnd.quantclarity.publication-recovery-chunk" as const;
const RETENTION_CLASS = "publication-rebuild-input-lifetime" as const;
const OBJECT_KEY_PREFIX = "private/publication-recovery-base/v1" as const;

const objectKey = (address: {
  environment: PublicationRecoveryBaseEnvironment;
  publicationId: string;
  relation: PublicationRecoveryBaseSource | "manifest";
  ordinal: number;
  digest: `sha256:${string}`;
}): string => {
  const extension = address.relation === "manifest" ? "json" : "bin";
  return `${OBJECT_KEY_PREFIX}/${address.environment}/${address.publicationId}/${address.relation}/${address.ordinal.toString().padStart(6, "0")}/${address.digest.slice("sha256:".length)}.${extension}`;
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const encodeChunk = (rows: readonly unknown[]): Uint8Array => {
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

const hash = async (
  domain: string,
  bytes: Uint8Array,
): Promise<
  Readonly<{
    artifactDigest: `sha256:${string}`;
    bodyHash: `sha256:${string}`;
    bodyRaw: ArrayBuffer;
  }>
> => {
  const domainBytes = utf8.encode(domain);
  const combined = new Uint8Array(domainBytes.byteLength + bytes.byteLength);
  combined.set(domainBytes);
  combined.set(bytes, domainBytes.byteLength);
  const [artifactRaw, bodyRaw] = await Promise.all([
    crypto.subtle.digest("SHA-256", combined),
    crypto.subtle.digest("SHA-256", bytes),
  ]);
  const encode = (raw: ArrayBuffer): `sha256:${string}` =>
    `sha256:${[...new Uint8Array(raw)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")}`;
  return Object.freeze({
    artifactDigest: encode(artifactRaw),
    bodyHash: encode(bodyRaw),
    bodyRaw,
  });
};

const rowKey = (
  source: PublicationRecoveryBaseSource,
  row: Readonly<Record<string, unknown>>,
): string => {
  switch (source) {
    case "publication":
      return String(row.publication_id);
    case "publication_provider_slice":
    case "publication_provider_slice_metadata":
      return String(row.provider_id);
    case "publication_provider_attribution":
    case "publication_resource":
    case "publication_search_document":
    case "publication_vector_inventory":
      return `${String(row.resource_type)}:${String(row.resource_id)}`;
    case "publication_inventory_chunk":
      return `${String(row.kind)}:${Number(row.ordinal)
        .toString()
        .padStart(10, "0")}`;
  }
};

const sourceRows = (
  fixture: MaximumObjectPublicationRecoveryFixture,
): ReadonlyMap<
  PublicationRecoveryBaseSource,
  readonly Record<string, unknown>[]
> => {
  const rows = fixture.rows;
  const entries: readonly (readonly [
    PublicationRecoveryBaseSource,
    readonly Record<string, unknown>[],
  ])[] = [
    ["publication", [{ ...rows.publication }]],
    [
      "publication_provider_slice",
      rows.providerSlices.map((row) => ({
        provider_id: row.provider_id,
        provider_slice_id: row.provider_slice_id,
        provider_run_id: row.provider_run_id,
        carried_forward: row.carried_forward,
        freshness_state: row.freshness_state,
      })),
    ],
    [
      "publication_provider_slice_metadata",
      rows.providerSlices.map((row) => ({
        provider_id: row.provider_id,
        adapter_version: row.adapter_version,
        roster_version: row.roster_version,
        source_register_version: row.source_register_version,
      })),
    ],
    [
      "publication_provider_attribution",
      rows.providerAttributions.map((row) => ({ ...row })),
    ],
    ["publication_resource", rows.resources.map((row) => ({ ...row }))],
    [
      "publication_search_document",
      rows.searchDocuments.map((row) => ({ ...row })),
    ],
    ["publication_vector_inventory", rows.vectors.map((row) => ({ ...row }))],
    ["publication_inventory_chunk", rows.chunks.map((row) => ({ ...row }))],
  ];
  return new Map(
    entries.map(([source, values]) => [
      source,
      [...values].sort((left, right) => {
        const leftKey = rowKey(source, left);
        const rightKey = rowKey(source, right);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      }),
    ]),
  );
};

const writeObject = async (
  bucket: Pick<R2Bucket, "put">,
  locator: Pick<
    PublicationRecoveryBaseLocator,
    "environment" | "publicationId"
  >,
  relation: PublicationRecoveryBaseSource | "manifest",
  ordinal: number,
  kind: "source_chunk" | "root_manifest",
  bytes: Uint8Array,
  domain: string,
): Promise<Readonly<{ key: string; artifactDigest: `sha256:${string}` }>> => {
  const hashed = await hash(domain, bytes);
  const key = objectKey({
    environment: locator.environment,
    publicationId: locator.publicationId,
    relation,
    ordinal,
    digest: hashed.artifactDigest,
  });
  await bucket.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    sha256: hashed.bodyRaw,
    httpMetadata: {
      contentType:
        kind === "root_manifest" ? ROOT_CONTENT_TYPE : CHUNK_CONTENT_TYPE,
      cacheControl: "private, no-store",
    },
    customMetadata: {
      "artifact-format": ARCHIVE_FORMAT,
      "artifact-digest": hashed.artifactDigest,
      "body-sha256": hashed.bodyHash,
      "byte-count": String(bytes.byteLength),
      environment: locator.environment,
      "object-kind": kind,
      ordinal: String(ordinal),
      "publication-id": locator.publicationId,
      relation,
      "retention-class": RETENTION_CLASS,
    },
  });
  return Object.freeze({ key, artifactDigest: hashed.artifactDigest });
};

/**
 * Independently encodes a semantically valid publication into an exact source
 * object count. This is intentionally a test-only hostile-but-canonical
 * packer: production controls chunk sizes, while verifier admission controls
 * the defensive total-object ceiling.
 */
export const writeMaximumObjectPublicationRecoveryArchive = async (
  bucket: Pick<R2Bucket, "put">,
  environment: PublicationRecoveryBaseEnvironment,
  fixture: MaximumObjectPublicationRecoveryFixture,
  requestedSourceObjectCount: number,
): Promise<PublicationRecoveryBaseLocator> => {
  const bySource = sourceRows(fixture);
  const totalRows = [...bySource.values()].reduce(
    (sum, rows) => sum + rows.length,
    0,
  );
  let mergesRemaining = totalRows - requestedSourceObjectCount;
  if (mergesRemaining < 0)
    throw new Error("maximum-object fixture does not contain enough rows");
  const identity = {
    environment,
    publicationId: fixture.manifest.publicationId,
  } as const;
  const sources = [];
  let totalBytes = 0;
  for (const [source, rows] of bySource) {
    const groups: Record<string, unknown>[][] = [];
    for (let index = 0; index < rows.length;) {
      const first = rows[index];
      if (first === undefined)
        throw new Error("maximum-object fixture row is missing");
      if (mergesRemaining > 0 && index + 1 < rows.length) {
        const second = rows[index + 1];
        if (second === undefined)
          throw new Error("maximum-object fixture merge row is missing");
        groups.push([first, second]);
        index += 2;
        mergesRemaining -= 1;
      } else {
        groups.push([first]);
        index += 1;
      }
    }
    const chunks = [];
    let sourceBytes = 0;
    for (const [ordinal, group] of groups.entries()) {
      const bytes = encodeChunk(group);
      const stored = await writeObject(
        bucket,
        identity,
        source,
        ordinal,
        "source_chunk",
        bytes,
        "quantclarity:publication-recovery-chunk:v1\0",
      );
      sourceBytes += bytes.byteLength;
      const first = group[0];
      const last = group.at(-1);
      if (first === undefined || last === undefined)
        throw new Error("maximum-object fixture emitted an empty chunk");
      chunks.push({
        ordinal,
        first_key: rowKey(source, first),
        last_key: rowKey(source, last),
        row_count: group.length,
        byte_count: bytes.byteLength,
        artifact_digest: stored.artifactDigest,
        object_key: stored.key,
      });
    }
    sources.push({
      source,
      row_count: rows.length,
      chunk_count: chunks.length,
      byte_count: sourceBytes,
      chunks,
    });
    totalBytes += sourceBytes;
  }
  if (mergesRemaining !== 0)
    throw new Error("maximum-object fixture could not place requested merges");
  const root = {
    artifact_format: ARCHIVE_FORMAT,
    codec_version: CODEC_VERSION,
    object_kind: "root_manifest",
    environment,
    publication_id: fixture.manifest.publicationId,
    closure_hash: fixture.manifest.closureHash,
    base_bundle_hash: fixture.manifest.bundleHash,
    manifest_contract_version: fixture.rows.manifestContractVersion,
    enabled_provider_scope_version: fixture.rows.enabledProviderScopeVersion,
    serving_schema_version: fixture.rows.publication.schema_version,
    sources,
    total_row_count: totalRows,
    total_byte_count: totalBytes,
  };
  const rootBytes = utf8.encode(canonicalJson(root));
  const storedRoot = await writeObject(
    bucket,
    identity,
    "manifest",
    0,
    "root_manifest",
    rootBytes,
    "quantclarity:publication-recovery-manifest:v1\0",
  );
  return Object.freeze({
    format: ARCHIVE_FORMAT,
    environment,
    publicationId: fixture.manifest.publicationId,
    closureHash: fixture.manifest.closureHash,
    bundleHash: fixture.manifest.bundleHash,
    rootDigest: storedRoot.artifactDigest,
    rootByteCount: rootBytes.byteLength,
  });
};
