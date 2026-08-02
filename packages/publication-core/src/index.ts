/**
 * Runtime-neutral publication decisions for QuantClarity.
 *
 * This package performs no I/O. Receipts are adapter-supplied evidence: the
 * kernel checks that they bind to one immutable closure, but cannot prove that
 * D1, R2, FTS, Vectorize, caches, backups, or deployments actually performed
 * the represented work.
 */

export type Sha256 = `sha256:${string}`;
export type PublicationId = `pub_${string}`;

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const PREFIXED_ID = new RegExp(
  `^(?:fam|mdl|var|prv|off|pcs|prc|evd|run|pvr|prn)_${UUID_V4}$`,
  "u",
);
const HASH = /^sha256:[0-9a-f]{64}$/u;
const VECTOR_ID = /^[0-9a-f]{64}$/u;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const PROVIDER_FRESHNESS_STATES = new Set<string>([
  "fresh",
  "stale",
  "unavailable",
]);
const SWITCH_AUTHORIZATION_KINDS = new Set<string>(["pipeline", "operator"]);
const SWITCH_AUTHORIZATION_ID = /^[a-z0-9][a-z0-9._:@/-]{0,127}$/u;
const PUBLICATION_ENVIRONMENTS = new Set<string>([
  "local",
  "test",
  "preview",
  "production",
]);
const SERVING_PUBLICATION_ENVIRONMENTS = new Set<string>([
  "local",
  "preview",
  "production",
]);
const CHUNK_KINDS = new Set<string>(["resources", "exact_search", "vectors"]);

export const RESOURCE_TYPES = [
  "model_family",
  "model",
  "variant",
  "provider",
  "offering",
  "price",
  "precision_observation",
  "evidence_summary",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type SearchResourceType = "model" | "variant";
export type ProviderAttributableResourceType =
  "provider" | "offering" | "price" | "precision_observation";
const PROVIDER_ATTRIBUTABLE_TYPES = new Set<string>([
  "provider",
  "offering",
  "price",
  "precision_observation",
]);

const RESOURCE_PREFIX: Readonly<Record<ResourceType, string>> = {
  model_family: "fam_",
  model: "mdl_",
  variant: "var_",
  provider: "prv_",
  offering: "off_",
  price: "pcs_",
  precision_observation: "prc_",
  evidence_summary: "evd_",
};

export type PublicationEnvironment =
  "local" | "test" | "preview" | "production";

export interface PublicationVersions {
  readonly schema: string;
  readonly methodology: string;
  readonly precisionNormalization: string;
  readonly precisionDisplayOrder: string;
  readonly pricePolicy: string;
  readonly sourcePolicy: string;
  readonly embedding: string;
  readonly buildCommit: string;
}

export type ProviderSliceDescriptor = Readonly<{
  providerId: string;
  providerSliceId: string | null;
  providerRunId: string;
  adapterVersion: string;
  rosterVersion: string;
  sourceRegisterVersion: string;
  carriedForward: boolean;
  freshnessState: "fresh" | "stale" | "unavailable";
}>;

export type ResourceDescriptor = Readonly<{
  resourceType: ResourceType;
  resourceId: string;
  contentHash: Sha256;
}>;

export type SearchDocumentDescriptor = Readonly<{
  resourceType: SearchResourceType;
  resourceId: string;
  documentId: string;
  contentHash: Sha256;
}>;

export type PersistedResourceDescriptor = ResourceDescriptor &
  Readonly<{ resourceJson: string }>;

export type PersistedSearchDocumentDescriptor = SearchDocumentDescriptor &
  Readonly<{
    normalizedName: string;
    aliasesJson: string;
    publisherName: string;
    providerModelIdsJson: string;
    documentText: string;
  }>;

export type VectorDescriptor = Readonly<{
  resourceType: SearchResourceType;
  resourceId: string;
  vectorId: string;
  searchDocumentContentHash: Sha256;
  embeddingInputHash: Sha256;
}>;
export type ProviderAttributionDescriptor = Readonly<{
  resourceType: ProviderAttributableResourceType;
  resourceId: string;
  providerId: string;
}>;

export type ChunkKind = "resources" | "exact_search" | "vectors";
export type ChunkDescriptor = Readonly<{
  kind: ChunkKind;
  ordinal: number;
  firstKey: string;
  lastKey: string;
  itemCount: number;
  contentHash: Sha256;
}>;

export interface PublicationManifestInput {
  readonly contractVersion: string;
  readonly publicationId: PublicationId;
  readonly sourceRunId: string;
  readonly parentPublicationId: PublicationId | null;
  readonly generatedAt: string;
  readonly versions: PublicationVersions;
  readonly enabledProviderScopeVersion: string;
  readonly enabledProviderIds: readonly string[];
  readonly providerSlices: readonly ProviderSliceDescriptor[];
  readonly providerAttributions: readonly ProviderAttributionDescriptor[];
  readonly resources: readonly ResourceDescriptor[];
  readonly searchDocuments: readonly SearchDocumentDescriptor[];
  readonly vectors: readonly VectorDescriptor[];
  readonly chunks: readonly ChunkDescriptor[];
  readonly bundleHash: Sha256;
}

export interface ImmutablePublicationManifest extends PublicationManifestInput {
  readonly resourceInventoryHash: Sha256;
  readonly exactSearchInventoryHash: Sha256;
  readonly vectorInventoryHash: Sha256;
  readonly enabledProviderScopeHash: Sha256;
  readonly providerSliceHash: Sha256;
  readonly providerAttributionHash: Sha256;
  readonly chunkRootHash: Sha256;
  readonly closureHash: Sha256;
}

const utf8 = new TextEncoder();

const isAscii = (value: string): boolean => /^[\x20-\x7e]*$/u.test(value);

const assertAscii = (value: string, label: string): void => {
  if (!isAscii(value) || value.length === 0)
    throw new TypeError(`${label} must be nonempty printable ASCII`);
};

const assertTimestamp = (value: string, label: string): number => {
  const parsed = Date.parse(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value
  )
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  return parsed;
};

const assertSafeInteger = (
  value: number,
  minimum: number,
  label: string,
): void => {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new RangeError(
      `${label} must be a safe integer >= ${String(minimum)}`,
    );
};

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export type CanonicalFieldType =
  | "boolean"
  | "digest"
  | "identifier"
  | "integer"
  | "list"
  | "null"
  | "text"
  | "timestamp";
export type CanonicalField = Readonly<{
  name: string;
  type: CanonicalFieldType;
  value: string;
}>;

const field = (
  name: string,
  type: CanonicalFieldType,
  value: string,
): CanonicalField => ({ name, type, value });

const validateCanonicalField = (value: CanonicalField): void => {
  assertAscii(value.name, "canonical field name");
  switch (value.type) {
    case "boolean":
      if (value.value !== "true" && value.value !== "false")
        throw new TypeError("canonical Boolean is invalid");
      break;
    case "digest":
      if (!HASH.test(value.value))
        throw new TypeError("canonical digest is invalid");
      break;
    case "identifier":
      assertAscii(value.value, "canonical identifier");
      break;
    case "integer":
    case "list":
      if (!/^(?:0|[1-9][0-9]*)$/u.test(value.value))
        throw new TypeError("canonical integer is invalid");
      break;
    case "null":
      if (value.value !== "null")
        throw new TypeError("canonical null is invalid");
      break;
    case "text":
      break;
    case "timestamp":
      assertTimestamp(value.value, "canonical timestamp");
      break;
    default:
      throw new TypeError("canonical field type is invalid");
  }
};

const lengthPrefixed = (
  values: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> => {
  const size = values.reduce((total, value) => total + 8 + value.length, 0);
  if (!Number.isSafeInteger(size))
    throw new RangeError("canonical tuple is too large");
  const output = new Uint8Array(size);
  const view = new DataView(output.buffer);
  let offset = 0;
  for (const value of values) {
    view.setBigUint64(offset, BigInt(value.length), false);
    offset += 8;
    output.set(value, offset);
    offset += value.length;
  }
  return output;
};

const concatenate = (
  values: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> => {
  const size = values.reduce((total, value) => total + value.length, 0);
  if (!Number.isSafeInteger(size))
    throw new RangeError("canonical collection is too large");
  const output = new Uint8Array(size);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
};

/** Versioned, domain-separated encoding using uint64be UTF-8 byte lengths. */
const canonicalTuple = (
  domain: string,
  fields: readonly CanonicalField[],
): Uint8Array<ArrayBuffer> => {
  assertAscii(domain, "hash domain");
  const header = [
    field("hash_domain", "text", domain),
    field("encoding_version", "integer", "1"),
  ];
  const values = [...header, ...fields];
  for (const value of values) validateCanonicalField(value);
  return lengthPrefixed(
    values.flatMap((value) => [
      utf8.encode(value.name),
      utf8.encode(value.type),
      utf8.encode(value.value),
    ]),
  );
};

const digestBytes = async (bytes: Uint8Array<ArrayBuffer>): Promise<Sha256> => {
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(result)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
};

const digest = async (
  domain: string,
  fields: readonly CanonicalField[],
): Promise<Sha256> => digestBytes(canonicalTuple(domain, fields));

/** Exposes the closure encoding primitive for cross-runtime golden tests. */
export const hashCanonicalTuple = async (
  domain: string,
  fields: readonly CanonicalField[],
): Promise<Sha256> => {
  return digest(domain, fields);
};

const canonicalJsonValue = (value: unknown, depth = 0): string => {
  if (depth > 64) throw new RangeError("publication JSON is too deeply nested");
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new TypeError("publication JSON numbers must be safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value
      .map((item) => canonicalJsonValue(item, depth + 1))
      .join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.some((key) => !/^[\x20-\x7e]+$/u.test(key)))
      throw new TypeError("publication JSON keys must be printable ASCII");
    return `{${keys
      .sort(compareAscii)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJsonValue(record[key], depth + 1)}`,
      )
      .join(",")}}`;
  }
  throw new TypeError("publication JSON contains an unsupported value");
};

export const canonicalizePublicationJson = (
  text: string,
  expectedContainer?: "array" | "object",
): string => {
  if (utf8.encode(text).length > 1_000_000)
    throw new RangeError("publication JSON exceeds the byte limit");
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new TypeError("publication JSON is invalid");
  }
  if (
    (expectedContainer === "array" && !Array.isArray(value)) ||
    (expectedContainer === "object" &&
      (typeof value !== "object" || value === null || Array.isArray(value)))
  )
    throw new TypeError(`publication JSON must be an ${expectedContainer}`);
  const canonical = canonicalJsonValue(value);
  if (canonical !== text)
    throw new TypeError("persisted publication JSON must be canonical");
  return canonical;
};

export const hashPublicationResourceContent = async (
  resource: Pick<
    PersistedResourceDescriptor,
    "resourceType" | "resourceId" | "resourceJson"
  >,
): Promise<Sha256> => {
  const canonicalJson = canonicalizePublicationJson(
    resource.resourceJson,
    "object",
  );
  if (canonicalJson !== resource.resourceJson)
    throw new TypeError("persisted resource JSON must be canonical");
  return digest("publication-resource-content", [
    field("resource_type", "text", resource.resourceType),
    field("resource_id", "identifier", resource.resourceId),
    field("resource_json", "text", canonicalJson),
  ]);
};

export const hashPublicationSearchDocumentContent = async (
  document: Pick<
    PersistedSearchDocumentDescriptor,
    | "resourceType"
    | "resourceId"
    | "documentId"
    | "normalizedName"
    | "aliasesJson"
    | "publisherName"
    | "providerModelIdsJson"
    | "documentText"
  >,
): Promise<Sha256> => {
  const canonicalAliases = canonicalizePublicationJson(
    document.aliasesJson,
    "array",
  );
  const canonicalProviderModelIds = canonicalizePublicationJson(
    document.providerModelIdsJson,
    "array",
  );
  if (
    canonicalAliases !== document.aliasesJson ||
    canonicalProviderModelIds !== document.providerModelIdsJson
  )
    throw new TypeError("persisted search JSON must be canonical");
  return digest("publication-search-document-content", [
    field("resource_type", "text", document.resourceType),
    field("resource_id", "identifier", document.resourceId),
    field("document_id", "identifier", document.documentId),
    field("normalized_name", "text", document.normalizedName),
    field("aliases_json", "text", canonicalAliases),
    field("publisher_name", "text", document.publisherName),
    field("provider_model_ids_json", "text", canonicalProviderModelIds),
    field("document_text", "text", document.documentText),
  ]);
};

export const hashPublicationResourceChunk = async (
  resources: readonly ResourceDescriptor[],
): Promise<Sha256> =>
  hashRecords(
    "publication-resources-chunk",
    resources.map((resource) => [
      field("resource_type", "text", resource.resourceType),
      field("resource_id", "identifier", resource.resourceId),
      field("content_hash", "digest", resource.contentHash),
    ]),
  );

export const hashPublicationSearchChunk = async (
  documents: readonly SearchDocumentDescriptor[],
): Promise<Sha256> =>
  hashRecords(
    "publication-exact_search-chunk",
    documents.map((document) => [
      field("resource_type", "text", document.resourceType),
      field("resource_id", "identifier", document.resourceId),
      field("document_id", "identifier", document.documentId),
      field("content_hash", "digest", document.contentHash),
    ]),
  );

export const hashPublicationVectorChunk = async (
  publicationId: PublicationId,
  vectors: readonly VectorDescriptor[],
): Promise<Sha256> =>
  hashRecords(
    "publication-vectors-chunk",
    vectors.map((vector) => [
      field("vector_namespace", "identifier", publicationId),
      field("resource_type", "text", vector.resourceType),
      field("resource_id", "identifier", vector.resourceId),
      field("vector_id", "identifier", vector.vectorId),
      field(
        "search_document_content_hash",
        "digest",
        vector.searchDocumentContentHash,
      ),
      field("embedding_input_hash", "digest", vector.embeddingInputHash),
    ]),
  );

const hashRecords = async (
  domain: string,
  records: readonly (readonly CanonicalField[])[],
): Promise<Sha256> => {
  const header = canonicalTuple(`${domain}:root`, [
    field("items", "list", String(records.length)),
  ]);
  const nested = records.map((record) =>
    canonicalTuple(`${domain}:record`, record),
  );
  return digestBytes(
    concatenate([header, ...nested.map((record) => lengthPrefixed([record]))]),
  );
};

const unique = (
  values: readonly string[],
  label: string,
  errors: string[],
): void => {
  if (new Set(values).size !== values.length)
    errors.push(`${label} contains a duplicate`);
};

const validateChunkSequence = (
  chunks: readonly ChunkDescriptor[],
  expectedCounts: Readonly<Record<ChunkKind, number>>,
  errors: string[],
): void => {
  for (const kind of ["resources", "exact_search", "vectors"] as const) {
    const selected = chunks
      .filter((chunk) => chunk.kind === kind)
      .sort((left, right) => left.ordinal - right.ordinal);
    let count = 0;
    let previousLast: string | null = null;
    for (const [index, chunk] of selected.entries()) {
      if (chunk.ordinal !== index)
        errors.push(`${kind} chunk ordinals must be contiguous from zero`);
      if (!Number.isSafeInteger(chunk.itemCount) || chunk.itemCount < 1)
        errors.push(`${kind} chunk item count is invalid`);
      if (!HASH.test(chunk.contentHash))
        errors.push(`${kind} chunk hash is invalid`);
      if (
        !isAscii(chunk.firstKey) ||
        !isAscii(chunk.lastKey) ||
        chunk.firstKey.length === 0 ||
        chunk.lastKey.length === 0 ||
        compareAscii(chunk.firstKey, chunk.lastKey) > 0
      )
        errors.push(`${kind} chunk range is invalid`);
      if (
        previousLast !== null &&
        compareAscii(previousLast, chunk.firstKey) >= 0
      )
        errors.push(`${kind} chunk ranges overlap or are unordered`);
      previousLast = chunk.lastKey;
      count += chunk.itemCount;
      if (!Number.isSafeInteger(count))
        errors.push(`${kind} chunk count overflowed`);
    }
    if (count !== expectedCounts[kind])
      errors.push(`${kind} chunk count does not match its inventory`);
  }
};

export const validateManifestInput = (
  input: PublicationManifestInput,
): readonly string[] => {
  const errors: string[] = [];
  if (input.contractVersion !== "1.0.0")
    errors.push("manifest contract version is unsupported");
  if (!PUBLICATION_ID.test(input.publicationId))
    errors.push("publication ID is invalid");
  if (!new RegExp(`^run_${UUID_V4}$`, "u").test(input.sourceRunId))
    errors.push("source run ID is invalid");
  if (
    input.parentPublicationId !== null &&
    (!PUBLICATION_ID.test(input.parentPublicationId) ||
      input.parentPublicationId === input.publicationId)
  )
    errors.push("parent publication ID is invalid");
  try {
    assertTimestamp(input.generatedAt, "generatedAt");
  } catch {
    errors.push("generated timestamp is invalid");
  }
  if (!SEMVER.test(input.versions.schema))
    errors.push("schema version is invalid");
  for (const [label, value, maximum] of [
    ["schema", input.versions.schema, 64],
    ["methodology", input.versions.methodology, 64],
    ["precisionNormalization", input.versions.precisionNormalization, 64],
    ["precisionDisplayOrder", input.versions.precisionDisplayOrder, 64],
    ["pricePolicy", input.versions.pricePolicy, 64],
    ["sourcePolicy", input.versions.sourcePolicy, 64],
    ["embedding", input.versions.embedding, 128],
    ["buildCommit", input.versions.buildCommit, 128],
  ] as const) {
    if (!isAscii(value) || value.length === 0 || value.length > maximum)
      errors.push(`${label} version is invalid`);
  }
  if (!HASH.test(input.bundleHash)) errors.push("bundle hash is invalid");
  if (
    !isAscii(input.enabledProviderScopeVersion) ||
    input.enabledProviderScopeVersion.length === 0 ||
    input.enabledProviderScopeVersion.length > 128
  )
    errors.push("enabled provider scope version is invalid");
  if (
    input.enabledProviderIds.length === 0 ||
    input.enabledProviderIds.length > 1_000
  )
    errors.push("enabled provider scope is empty or too large");
  unique(input.enabledProviderIds, "enabled provider scope", errors);
  for (const providerId of input.enabledProviderIds)
    if (!new RegExp(`^prv_${UUID_V4}$`, "u").test(providerId))
      errors.push("enabled provider ID is invalid");
  if (input.providerSlices.length === 0)
    errors.push("provider slices are empty");
  unique(
    input.providerSlices.map((slice) => slice.providerId),
    "provider slice inventory",
    errors,
  );
  if (
    JSON.stringify([...input.enabledProviderIds].sort(compareAscii)) !==
    JSON.stringify(
      input.providerSlices.map((slice) => slice.providerId).sort(compareAscii),
    )
  )
    errors.push("provider slices do not exactly cover enabled provider scope");
  for (const slice of input.providerSlices) {
    if (!new RegExp(`^prv_${UUID_V4}$`, "u").test(slice.providerId))
      errors.push("provider slice provider ID is invalid");
    if (!new RegExp(`^pvr_${UUID_V4}$`, "u").test(slice.providerRunId))
      errors.push("provider slice run ID is invalid");
    if (!PROVIDER_FRESHNESS_STATES.has(slice.freshnessState))
      errors.push("provider freshness state is invalid");
    if (
      slice.freshnessState === "unavailable"
        ? slice.providerSliceId !== null
        : slice.providerSliceId === null ||
          !new RegExp(`^prn_${UUID_V4}$`, "u").test(slice.providerSliceId)
    )
      errors.push("provider selected-slice identity is inconsistent");
    for (const version of [
      slice.adapterVersion,
      slice.rosterVersion,
      slice.sourceRegisterVersion,
    ])
      if (!isAscii(version) || version.length === 0 || version.length > 128)
        errors.push("provider slice version is invalid");
    if (slice.freshnessState === "unavailable" && slice.carriedForward)
      errors.push("unavailable provider cannot carry selected content");
    if (slice.freshnessState === "stale" && !slice.carriedForward)
      errors.push("stale provider slice must be carried forward");
  }

  unique(
    input.resources.map(
      (resource) => `${resource.resourceType}:${resource.resourceId}`,
    ),
    "resource inventory",
    errors,
  );
  for (const resource of input.resources) {
    if (
      !RESOURCE_TYPES.includes(resource.resourceType) ||
      !PREFIXED_ID.test(resource.resourceId) ||
      !resource.resourceId.startsWith(RESOURCE_PREFIX[resource.resourceType])
    )
      errors.push("resource type and ID prefix disagree");
    if (!HASH.test(resource.contentHash))
      errors.push("resource content hash is invalid");
  }
  unique(
    input.providerAttributions.map(
      (attribution) => `${attribution.resourceType}:${attribution.resourceId}`,
    ),
    "provider attribution inventory",
    errors,
  );
  const attributableResources = input.resources
    .filter((resource) =>
      PROVIDER_ATTRIBUTABLE_TYPES.has(resource.resourceType),
    )
    .map((resource) => `${resource.resourceType}:${resource.resourceId}`)
    .sort(compareAscii);
  const attributedResources = input.providerAttributions
    .map(
      (attribution) => `${attribution.resourceType}:${attribution.resourceId}`,
    )
    .sort(compareAscii);
  if (
    JSON.stringify(attributableResources) !==
    JSON.stringify(attributedResources)
  )
    errors.push("provider attribution inventory does not close over resources");
  const unavailableProviders = new Set(
    input.providerSlices
      .filter((slice) => slice.freshnessState === "unavailable")
      .map((slice) => slice.providerId),
  );
  for (const attribution of input.providerAttributions) {
    if (!PROVIDER_ATTRIBUTABLE_TYPES.has(attribution.resourceType))
      errors.push("provider attribution resource type is invalid");
    if (!input.enabledProviderIds.includes(attribution.providerId))
      errors.push("provider attribution is outside enabled scope");
    if (unavailableProviders.has(attribution.providerId))
      errors.push("unavailable provider owns attributed public resources");
    if (
      attribution.resourceType === "provider" &&
      attribution.resourceId !== attribution.providerId
    )
      errors.push("provider resource attribution does not match its identity");
  }

  const searchable = input.resources
    .filter(
      (resource) =>
        resource.resourceType === "model" ||
        resource.resourceType === "variant",
    )
    .map((resource) => `${resource.resourceType}:${resource.resourceId}`)
    .sort(compareAscii);
  const documents = input.searchDocuments
    .map((document) => `${document.resourceType}:${document.resourceId}`)
    .sort(compareAscii);
  const vectors = input.vectors
    .map((vector) => `${vector.resourceType}:${vector.resourceId}`)
    .sort(compareAscii);
  if (JSON.stringify(documents) !== JSON.stringify(searchable))
    errors.push(
      "exact-search inventory does not close over models and variants",
    );
  if (JSON.stringify(vectors) !== JSON.stringify(searchable))
    errors.push("vector inventory does not close over models and variants");
  unique(
    input.searchDocuments.map((document) => document.documentId),
    "document IDs",
    errors,
  );
  unique(
    input.vectors.map((vector) => vector.vectorId),
    "vector IDs",
    errors,
  );
  for (const document of input.searchDocuments) {
    if (!VECTOR_ID.test(document.documentId))
      errors.push("search document ID is invalid");
    if (!HASH.test(document.contentHash))
      errors.push("search document hash is invalid");
    const vector = input.vectors.find(
      (candidate) =>
        candidate.resourceType === document.resourceType &&
        candidate.resourceId === document.resourceId,
    );
    if (vector?.vectorId !== document.documentId)
      errors.push("search document and vector IDs disagree");
  }
  for (const vector of input.vectors) {
    if (!VECTOR_ID.test(vector.vectorId)) errors.push("vector ID is invalid");
    if (
      !HASH.test(vector.searchDocumentContentHash) ||
      !HASH.test(vector.embeddingInputHash)
    )
      errors.push("vector search-document or embedding-input hash is invalid");
    const document = input.searchDocuments.find(
      (candidate) =>
        candidate.resourceType === vector.resourceType &&
        candidate.resourceId === vector.resourceId,
    );
    if (document?.contentHash !== vector.searchDocumentContentHash)
      errors.push("vector search-document hash does not match exact inventory");
  }
  unique(
    input.chunks.map((chunk) => `${chunk.kind}:${String(chunk.ordinal)}`),
    "chunk inventory",
    errors,
  );
  for (const chunk of input.chunks)
    if (!CHUNK_KINDS.has(chunk.kind)) errors.push("chunk kind is invalid");
  validateChunkSequence(
    input.chunks,
    {
      resources: input.resources.length,
      exact_search: input.searchDocuments.length,
      vectors: input.vectors.length,
    },
    errors,
  );
  return Object.freeze(errors);
};

const manifestRoots = async (input: PublicationManifestInput) => {
  const enabledProviderIds = [...input.enabledProviderIds].sort(compareAscii);
  const providerSlices = [...input.providerSlices].sort((left, right) =>
    compareAscii(left.providerId, right.providerId),
  );
  const providerAttributions = [...input.providerAttributions].sort(
    (left, right) =>
      compareAscii(
        `${left.resourceType}:${left.resourceId}`,
        `${right.resourceType}:${right.resourceId}`,
      ),
  );
  const resources = [...input.resources].sort((left, right) =>
    compareAscii(
      `${left.resourceType}:${left.resourceId}`,
      `${right.resourceType}:${right.resourceId}`,
    ),
  );
  const searchDocuments = [...input.searchDocuments].sort((left, right) =>
    compareAscii(
      `${left.resourceType}:${left.resourceId}`,
      `${right.resourceType}:${right.resourceId}`,
    ),
  );
  const vectors = [...input.vectors].sort((left, right) =>
    compareAscii(
      `${left.resourceType}:${left.resourceId}`,
      `${right.resourceType}:${right.resourceId}`,
    ),
  );
  const chunks = [...input.chunks].sort((left, right) =>
    compareAscii(
      `${left.kind}:${String(left.ordinal).padStart(12, "0")}`,
      `${right.kind}:${String(right.ordinal).padStart(12, "0")}`,
    ),
  );
  const [
    enabledProviderScopeHash,
    providerSliceHash,
    providerAttributionHash,
    resourceInventoryHash,
    exactSearchInventoryHash,
    vectorInventoryHash,
    chunkRootHash,
  ] = await Promise.all([
    hashRecords(
      "publication-enabled-provider-scope",
      enabledProviderIds.map((providerId) => [
        field("scope_version", "text", input.enabledProviderScopeVersion),
        field("provider_id", "identifier", providerId),
      ]),
    ),
    hashRecords(
      "publication-provider-slices",
      providerSlices.map((slice) => [
        field("provider_id", "identifier", slice.providerId),
        slice.providerSliceId === null
          ? field("provider_slice_id", "null", "null")
          : field("provider_slice_id", "identifier", slice.providerSliceId),
        field("provider_run_id", "identifier", slice.providerRunId),
        field("adapter_version", "text", slice.adapterVersion),
        field("roster_version", "text", slice.rosterVersion),
        field("source_register_version", "text", slice.sourceRegisterVersion),
        field("carried_forward", "boolean", String(slice.carriedForward)),
        field("freshness_state", "text", slice.freshnessState),
      ]),
    ),
    hashRecords(
      "publication-provider-attributions",
      providerAttributions.map((attribution) => [
        field("resource_type", "text", attribution.resourceType),
        field("resource_id", "identifier", attribution.resourceId),
        field("provider_id", "identifier", attribution.providerId),
      ]),
    ),
    hashRecords(
      "publication-resources",
      resources.map((resource) => [
        field("resource_type", "text", resource.resourceType),
        field("resource_id", "identifier", resource.resourceId),
        field("content_hash", "digest", resource.contentHash),
      ]),
    ),
    hashRecords(
      "publication-exact-search",
      searchDocuments.map((document) => [
        field("resource_type", "text", document.resourceType),
        field("resource_id", "identifier", document.resourceId),
        field("document_id", "identifier", document.documentId),
        field("content_hash", "digest", document.contentHash),
      ]),
    ),
    hashRecords(
      "publication-vectors",
      vectors.map((vector) => [
        field("vector_namespace", "identifier", input.publicationId),
        field("resource_type", "text", vector.resourceType),
        field("resource_id", "identifier", vector.resourceId),
        field("vector_id", "identifier", vector.vectorId),
        field(
          "search_document_content_hash",
          "digest",
          vector.searchDocumentContentHash,
        ),
        field("embedding_input_hash", "digest", vector.embeddingInputHash),
      ]),
    ),
    hashRecords(
      "publication-chunks",
      chunks.map((chunk) => [
        field("kind", "text", chunk.kind),
        field("ordinal", "integer", String(chunk.ordinal)),
        field("first_key", "text", chunk.firstKey),
        field("last_key", "text", chunk.lastKey),
        field("item_count", "integer", String(chunk.itemCount)),
        field("content_hash", "digest", chunk.contentHash),
      ]),
    ),
  ]);
  return {
    enabledProviderIds,
    providerSlices,
    providerAttributions,
    resources,
    searchDocuments,
    vectors,
    chunks,
    enabledProviderScopeHash,
    providerSliceHash,
    providerAttributionHash,
    resourceInventoryHash,
    exactSearchInventoryHash,
    vectorInventoryHash,
    chunkRootHash,
  };
};

/** ADR 0013 publication-qualified Vectorize object identity. */
export const derivePublicationVectorId = async (
  publicationId: PublicationId,
  resourceType: SearchResourceType,
  resourceId: string,
): Promise<string> => {
  if (!PUBLICATION_ID.test(publicationId))
    throw new TypeError("vector publication ID is invalid");
  const expectedPrefix = resourceType === "model" ? "mdl_" : "var_";
  if (!new RegExp(`^${expectedPrefix}${UUID_V4}$`, "u").test(resourceId))
    throw new TypeError("vector resource ID is invalid");
  const bytes = utf8.encode(
    `quantclarity-vector-v1\0${publicationId}\0${resourceType}\0${resourceId}`,
  );
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
};

const validateVectorIdentities = async (
  input: PublicationManifestInput,
): Promise<readonly string[]> => {
  const errors: string[] = [];
  for (const vector of input.vectors) {
    const expected = await derivePublicationVectorId(
      input.publicationId,
      vector.resourceType,
      vector.resourceId,
    );
    if (vector.vectorId !== expected)
      errors.push(
        "vector ID does not match its publication-qualified identity",
      );
  }
  return errors;
};

export const buildImmutableManifest = async (
  input: PublicationManifestInput,
): Promise<ImmutablePublicationManifest> => {
  const errors = [
    ...validateManifestInput(input),
    ...(await validateVectorIdentities(input)),
  ];
  if (errors.length > 0) throw new TypeError(errors.join("; "));
  const roots = await manifestRoots(input);
  const versions = Object.freeze({ ...input.versions });
  const closureHash = await digest("publication-closure", [
    field("contract_version", "text", input.contractVersion),
    field("publication_id", "identifier", input.publicationId),
    field("source_run_id", "identifier", input.sourceRunId),
    input.parentPublicationId === null
      ? field("parent_publication_id", "null", "null")
      : field("parent_publication_id", "identifier", input.parentPublicationId),
    field("generated_at", "timestamp", input.generatedAt),
    field("schema_version", "text", versions.schema),
    field("methodology_version", "text", versions.methodology),
    field(
      "precision_normalization_version",
      "text",
      versions.precisionNormalization,
    ),
    field(
      "precision_display_order_version",
      "text",
      versions.precisionDisplayOrder,
    ),
    field("price_policy_version", "text", versions.pricePolicy),
    field("source_policy_version", "text", versions.sourcePolicy),
    field("embedding_version", "text", versions.embedding),
    field("build_commit", "text", versions.buildCommit),
    field("bundle_hash", "digest", input.bundleHash),
    field(
      "enabled_provider_scope_hash",
      "digest",
      roots.enabledProviderScopeHash,
    ),
    field("provider_slice_hash", "digest", roots.providerSliceHash),
    field("provider_attribution_hash", "digest", roots.providerAttributionHash),
    field("resource_inventory_hash", "digest", roots.resourceInventoryHash),
    field(
      "exact_search_inventory_hash",
      "digest",
      roots.exactSearchInventoryHash,
    ),
    field("vector_inventory_hash", "digest", roots.vectorInventoryHash),
    field("chunk_root_hash", "digest", roots.chunkRootHash),
  ]);
  return Object.freeze({
    ...input,
    versions,
    enabledProviderIds: Object.freeze(roots.enabledProviderIds),
    providerSlices: Object.freeze(
      roots.providerSlices.map((value) => Object.freeze({ ...value })),
    ),
    providerAttributions: Object.freeze(
      roots.providerAttributions.map((value) => Object.freeze({ ...value })),
    ),
    resources: Object.freeze(
      roots.resources.map((value) => Object.freeze({ ...value })),
    ),
    searchDocuments: Object.freeze(
      roots.searchDocuments.map((value) => Object.freeze({ ...value })),
    ),
    vectors: Object.freeze(
      roots.vectors.map((value) => Object.freeze({ ...value })),
    ),
    chunks: Object.freeze(
      roots.chunks.map((value) => Object.freeze({ ...value })),
    ),
    enabledProviderScopeHash: roots.enabledProviderScopeHash,
    providerSliceHash: roots.providerSliceHash,
    providerAttributionHash: roots.providerAttributionHash,
    resourceInventoryHash: roots.resourceInventoryHash,
    exactSearchInventoryHash: roots.exactSearchInventoryHash,
    vectorInventoryHash: roots.vectorInventoryHash,
    chunkRootHash: roots.chunkRootHash,
    closureHash,
  });
};

export type PersistedPublicationManifestInput = Omit<
  PublicationManifestInput,
  "resources" | "searchDocuments"
> &
  Readonly<{
    resources: readonly PersistedResourceDescriptor[];
    searchDocuments: readonly PersistedSearchDocumentDescriptor[];
  }>;

export interface ServingPublicationClosureRow {
  readonly publication_id: string;
  readonly source_run_id: string;
  readonly parent_publication_id: string | null;
  readonly generated_at_ms: number;
  readonly schema_version: string;
  readonly methodology_version: string;
  readonly precision_normalization_version: string;
  readonly precision_display_order_version: string;
  readonly price_policy_version: string;
  readonly source_policy_version: string;
  readonly embedding_version: string;
  readonly build_commit: string;
  readonly closure_hash: string;
}

export interface ServingProviderSliceClosureRow {
  readonly provider_id: string;
  readonly provider_slice_id: string | null;
  readonly provider_run_id: string;
  readonly adapter_version: string;
  readonly roster_version: string;
  readonly source_register_version: string;
  readonly carried_forward: number;
  readonly freshness_state: string;
}

export interface ServingProviderAttributionClosureRow {
  readonly resource_type: string;
  readonly resource_id: string;
  readonly provider_id: string;
}

export interface ServingResourceClosureRow {
  readonly resource_type: string;
  readonly resource_id: string;
  readonly resource_json: string;
  readonly content_hash: string;
}

export interface ServingSearchDocumentClosureRow {
  readonly document_id: string;
  readonly resource_type: string;
  readonly resource_id: string;
  readonly normalized_name: string;
  readonly aliases_json: string;
  readonly publisher_name: string;
  readonly provider_model_ids_json: string;
  readonly document_text: string;
  readonly content_hash: string;
}

export interface ServingVectorClosureRow {
  readonly vector_namespace: string;
  readonly vector_id: string;
  readonly resource_type: string;
  readonly resource_id: string;
  readonly search_document_content_hash: string;
  readonly embedding_input_hash: string;
}

export interface ServingChunkClosureRow {
  readonly kind: string;
  readonly ordinal: number;
  readonly first_key: string;
  readonly last_key: string;
  readonly item_count: number;
  readonly content_hash: string;
}

export interface ServingClosureRows {
  readonly publication: ServingPublicationClosureRow;
  readonly providerSlices: readonly ServingProviderSliceClosureRow[];
  readonly providerAttributions: readonly ServingProviderAttributionClosureRow[];
  readonly resources: readonly ServingResourceClosureRow[];
  readonly searchDocuments: readonly ServingSearchDocumentClosureRow[];
  readonly vectors: readonly ServingVectorClosureRow[];
  readonly chunks: readonly ServingChunkClosureRow[];
  readonly manifestContractVersion: "1.0.0";
  readonly enabledProviderScopeVersion: string;
  readonly bundleHash: Sha256;
  readonly stagingRevision: number;
  readonly sealedAtMs: number;
}

export interface ServingClosureSealProjection {
  readonly publication_id: PublicationId;
  readonly staging_revision: number;
  readonly manifest_contract_version: "1.0.0";
  readonly hash_domain: "publication-closure";
  readonly hash_encoding_version: "1";
  readonly enabled_provider_scope_version: string;
  readonly enabled_provider_count: number;
  readonly provider_slice_count: number;
  readonly provider_attribution_count: number;
  readonly resource_count: number;
  readonly exact_document_count: number;
  readonly vector_document_count: number;
  readonly chunk_count: number;
  readonly bundle_hash: Sha256;
  readonly enabled_provider_scope_hash: Sha256;
  readonly provider_slice_hash: Sha256;
  readonly provider_attribution_hash: Sha256;
  readonly resource_inventory_hash: Sha256;
  readonly exact_search_inventory_hash: Sha256;
  readonly vector_inventory_hash: Sha256;
  readonly chunk_root_hash: Sha256;
  readonly closure_hash: Sha256;
  readonly sealed_at_ms: number;
}

/**
 * Controlled-writer boundary for a serving closure. Content digests are
 * recomputed from persisted bytes before they can participate in the seal.
 */
export const buildImmutableManifestFromPersistedContent = async (
  input: PersistedPublicationManifestInput,
): Promise<ImmutablePublicationManifest> => {
  const resources = await Promise.all(
    input.resources.map(async (resource): Promise<ResourceDescriptor> => {
      const contentHash = await hashPublicationResourceContent(resource);
      if (contentHash !== resource.contentHash)
        throw new TypeError("persisted resource content hash does not match");
      return {
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        contentHash,
      };
    }),
  );
  const searchDocuments = await Promise.all(
    input.searchDocuments.map(
      async (document): Promise<SearchDocumentDescriptor> => {
        const contentHash =
          await hashPublicationSearchDocumentContent(document);
        if (contentHash !== document.contentHash)
          throw new TypeError(
            "persisted search document content hash does not match",
          );
        return {
          resourceType: document.resourceType,
          resourceId: document.resourceId,
          documentId: document.documentId,
          contentHash,
        };
      },
    ),
  );
  return buildImmutableManifest({
    ...input,
    resources,
    searchDocuments,
  });
};

const closedString = <T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): T => {
  if (!allowed.includes(value as T)) throw new TypeError(`${label} is invalid`);
  return value as T;
};

const sha256 = (value: string, label: string): Sha256 => {
  if (!HASH.test(value)) throw new TypeError(`${label} is invalid`);
  return value as Sha256;
};

type ChunkSourceRecord = Readonly<{
  key: string;
  fields: readonly CanonicalField[];
}>;

const projectVerifiedChunks = async (
  rows: ServingClosureRows,
): Promise<readonly ChunkDescriptor[]> => {
  const sources: Readonly<Record<ChunkKind, readonly ChunkSourceRecord[]>> = {
    resources: rows.resources
      .map((row) => ({
        key: `${row.resource_type}:${row.resource_id}`,
        fields: [
          field("resource_type", "text", row.resource_type),
          field("resource_id", "identifier", row.resource_id),
          field("content_hash", "digest", row.content_hash),
        ],
      }))
      .sort((left, right) => compareAscii(left.key, right.key)),
    exact_search: rows.searchDocuments
      .map((row) => ({
        key: `${row.resource_type}:${row.resource_id}`,
        fields: [
          field("resource_type", "text", row.resource_type),
          field("resource_id", "identifier", row.resource_id),
          field("document_id", "identifier", row.document_id),
          field("content_hash", "digest", row.content_hash),
        ],
      }))
      .sort((left, right) => compareAscii(left.key, right.key)),
    vectors: rows.vectors
      .map((row) => ({
        key: `${row.resource_type}:${row.resource_id}`,
        fields: [
          field("vector_namespace", "identifier", row.vector_namespace),
          field("resource_type", "text", row.resource_type),
          field("resource_id", "identifier", row.resource_id),
          field("vector_id", "identifier", row.vector_id),
          field(
            "search_document_content_hash",
            "digest",
            row.search_document_content_hash,
          ),
          field("embedding_input_hash", "digest", row.embedding_input_hash),
        ],
      }))
      .sort((left, right) => compareAscii(left.key, right.key)),
  };
  const projected: ChunkDescriptor[] = [];
  for (const kind of ["resources", "exact_search", "vectors"] as const) {
    const chunks = rows.chunks
      .filter((row) => row.kind === kind)
      .sort((left, right) => left.ordinal - right.ordinal);
    let offset = 0;
    for (const [ordinal, chunk] of chunks.entries()) {
      if (chunk.ordinal !== ordinal)
        throw new TypeError("persisted chunk ordinals are not contiguous");
      assertSafeInteger(chunk.item_count, 1, "persisted chunk item count");
      const records = sources[kind].slice(offset, offset + chunk.item_count);
      if (
        records.length !== chunk.item_count ||
        records[0]?.key !== chunk.first_key ||
        records.at(-1)?.key !== chunk.last_key
      )
        throw new TypeError("persisted chunk range does not match inventory");
      const contentHash = await hashRecords(
        `publication-${kind}-chunk`,
        records.map((record) => record.fields),
      );
      if (contentHash !== chunk.content_hash)
        throw new TypeError("persisted chunk content hash does not match");
      projected.push({
        kind,
        ordinal,
        firstKey: chunk.first_key,
        lastKey: chunk.last_key,
        itemCount: chunk.item_count,
        contentHash,
      });
      offset += chunk.item_count;
    }
    if (offset !== sources[kind].length)
      throw new TypeError("persisted chunks do not cover inventory");
  }
  return Object.freeze(projected);
};

/** Exact Phase 4C serving-row projection used by the controlled seal writer. */
export const projectServingClosureSeal = async (
  rows: ServingClosureRows,
): Promise<
  Readonly<{
    manifest: ImmutablePublicationManifest;
    seal: ServingClosureSealProjection;
  }>
> => {
  const publication = rows.publication;
  assertSafeInteger(rows.stagingRevision, 0, "staging revision");
  assertSafeInteger(rows.sealedAtMs, 0, "seal time");
  assertSafeInteger(publication.generated_at_ms, 0, "generated time");
  if (rows.sealedAtMs < publication.generated_at_ms)
    throw new TypeError("seal time precedes publication generation");
  const publicationId = publication.publication_id as PublicationId;
  const chunks = await projectVerifiedChunks(rows);
  const manifest = await buildImmutableManifestFromPersistedContent({
    contractVersion: rows.manifestContractVersion,
    publicationId,
    sourceRunId: publication.source_run_id,
    parentPublicationId:
      publication.parent_publication_id as PublicationId | null,
    generatedAt: new Date(publication.generated_at_ms).toISOString(),
    versions: {
      schema: publication.schema_version,
      methodology: publication.methodology_version,
      precisionNormalization: publication.precision_normalization_version,
      precisionDisplayOrder: publication.precision_display_order_version,
      pricePolicy: publication.price_policy_version,
      sourcePolicy: publication.source_policy_version,
      embedding: publication.embedding_version,
      buildCommit: publication.build_commit,
    },
    enabledProviderScopeVersion: rows.enabledProviderScopeVersion,
    enabledProviderIds: rows.providerSlices.map((row) => row.provider_id),
    providerSlices: rows.providerSlices.map((row) => {
      if (row.carried_forward !== 0 && row.carried_forward !== 1)
        throw new TypeError("persisted carried-forward value is invalid");
      return {
        providerId: row.provider_id,
        providerSliceId: row.provider_slice_id,
        providerRunId: row.provider_run_id,
        adapterVersion: row.adapter_version,
        rosterVersion: row.roster_version,
        sourceRegisterVersion: row.source_register_version,
        carriedForward: row.carried_forward === 1,
        freshnessState: closedString(
          row.freshness_state,
          ["fresh", "stale", "unavailable"] as const,
          "persisted provider freshness",
        ),
      };
    }),
    providerAttributions: rows.providerAttributions.map((row) => ({
      resourceType: closedString(
        row.resource_type,
        ["provider", "offering", "price", "precision_observation"] as const,
        "persisted provider attribution type",
      ),
      resourceId: row.resource_id,
      providerId: row.provider_id,
    })),
    resources: rows.resources.map((row) => ({
      resourceType: closedString(
        row.resource_type,
        RESOURCE_TYPES,
        "persisted resource type",
      ),
      resourceId: row.resource_id,
      resourceJson: row.resource_json,
      contentHash: sha256(row.content_hash, "persisted resource hash"),
    })),
    searchDocuments: rows.searchDocuments.map((row) => ({
      resourceType: closedString(
        row.resource_type,
        ["model", "variant"] as const,
        "persisted search resource type",
      ),
      resourceId: row.resource_id,
      documentId: row.document_id,
      normalizedName: row.normalized_name,
      aliasesJson: row.aliases_json,
      publisherName: row.publisher_name,
      providerModelIdsJson: row.provider_model_ids_json,
      documentText: row.document_text,
      contentHash: sha256(row.content_hash, "persisted search hash"),
    })),
    vectors: rows.vectors.map((row) => {
      if (row.vector_namespace !== publication.publication_id)
        throw new TypeError("persisted vector namespace is invalid");
      return {
        resourceType: closedString(
          row.resource_type,
          ["model", "variant"] as const,
          "persisted vector resource type",
        ),
        resourceId: row.resource_id,
        vectorId: row.vector_id,
        searchDocumentContentHash: sha256(
          row.search_document_content_hash,
          "persisted vector search hash",
        ),
        embeddingInputHash: sha256(
          row.embedding_input_hash,
          "persisted embedding input hash",
        ),
      };
    }),
    chunks,
    bundleHash: rows.bundleHash,
  });
  if (manifest.closureHash !== publication.closure_hash)
    throw new TypeError("persisted publication closure hash does not match");
  const seal: ServingClosureSealProjection = Object.freeze({
    publication_id: manifest.publicationId,
    staging_revision: rows.stagingRevision,
    manifest_contract_version: rows.manifestContractVersion,
    hash_domain: "publication-closure",
    hash_encoding_version: "1",
    enabled_provider_scope_version: rows.enabledProviderScopeVersion,
    enabled_provider_count: manifest.enabledProviderIds.length,
    provider_slice_count: manifest.providerSlices.length,
    provider_attribution_count: manifest.providerAttributions.length,
    resource_count: manifest.resources.length,
    exact_document_count: manifest.searchDocuments.length,
    vector_document_count: manifest.vectors.length,
    chunk_count: manifest.chunks.length,
    bundle_hash: manifest.bundleHash,
    enabled_provider_scope_hash: manifest.enabledProviderScopeHash,
    provider_slice_hash: manifest.providerSliceHash,
    provider_attribution_hash: manifest.providerAttributionHash,
    resource_inventory_hash: manifest.resourceInventoryHash,
    exact_search_inventory_hash: manifest.exactSearchInventoryHash,
    vector_inventory_hash: manifest.vectorInventoryHash,
    chunk_root_hash: manifest.chunkRootHash,
    closure_hash: manifest.closureHash,
    sealed_at_ms: rows.sealedAtMs,
  });
  return Object.freeze({ manifest, seal });
};

export const verifyServingClosureSealProjection = async (
  rows: ServingClosureRows,
  candidate: ServingClosureSealProjection,
): Promise<readonly string[]> => {
  const expected = (await projectServingClosureSeal(rows)).seal;
  const errors: string[] = [];
  for (const key of Object.keys(
    expected,
  ) as (keyof ServingClosureSealProjection)[])
    if (candidate[key] !== expected[key])
      errors.push(`${key} does not match persisted closure`);
  if (Object.keys(candidate).length !== Object.keys(expected).length)
    errors.push("seal projection shape does not match persisted closure");
  return Object.freeze(errors);
};

export const verifyImmutableManifest = async (
  manifest: ImmutablePublicationManifest,
): Promise<readonly string[]> => {
  const errors = [...validateManifestInput(manifest)];
  errors.push(...(await validateVectorIdentities(manifest)));
  if (errors.length > 0) return Object.freeze(errors);
  const rebuilt = await buildImmutableManifest(manifest);
  for (const field of [
    "enabledProviderScopeHash",
    "providerSliceHash",
    "providerAttributionHash",
    "resourceInventoryHash",
    "exactSearchInventoryHash",
    "vectorInventoryHash",
    "chunkRootHash",
    "closureHash",
  ] as const)
    if (manifest[field] !== rebuilt[field])
      errors.push(`${field} does not match immutable content`);
  return Object.freeze(errors);
};

export interface ArtifactBinding {
  readonly environment: PublicationEnvironment;
  readonly publicationId: PublicationId;
  readonly closureHash: Sha256;
  readonly bundleHash: Sha256;
  readonly schemaVersion: string;
  readonly buildCommit: string;
}

export const READINESS_FTS_BUILD_VERSION = "fts5-unicode61@1" as const;
export const VECTOR_VISIBILITY_PROBE_VERSION = "vector-visibility@1" as const;
export const READINESS_PROBE_SET_VERSION = "search-gold@1" as const;

export type ArchiveReceipt = Readonly<{
  kind: "archive";
  binding: ArtifactBinding;
  observedAt: string;
  retainedBundleHash: Sha256;
  immutable: boolean;
}>;
export type ServingReceipt = Readonly<{
  kind: "serving";
  binding: ArtifactBinding;
  observedAt: string;
  enabledProviderCount: number;
  enabledProviderScopeHash: Sha256;
  providerSliceCount: number;
  providerSliceHash: Sha256;
  providerAttributionCount: number;
  providerAttributionHash: Sha256;
  resourceCount: number;
  exactDocumentCount: number;
  resourceInventoryHash: Sha256;
  exactSearchInventoryHash: Sha256;
  ftsBuildVersion: string;
  ftsDocumentCount: number;
  ftsQueryable: boolean;
  foreignKeysValid: boolean;
  contentHashesValid: boolean;
  unavailableProviderIsolationValid: boolean;
}>;
export type VectorReceipt = Readonly<{
  kind: "vectors";
  binding: ArtifactBinding;
  observedAt: string;
  namespace: PublicationId;
  documentCount: number;
  verifiedDocumentCount: number;
  vectorInventoryHash: Sha256;
  visibilityProbeVersion: string;
  mutationId: string;
  allIdsPresent: boolean;
  allNamespacesMatch: boolean;
  queryable: boolean;
}>;
export type ProbeReceipt = Readonly<{
  kind: "probes";
  binding: ArtifactBinding;
  observedAt: string;
  probeSetVersion: string;
  integrityPassed: boolean;
  evidenceCoveragePassed: boolean;
  exactSearchPassed: boolean;
  semanticSearchPassed: boolean;
  structuredFilterPassed: boolean;
  neutralityPassed: boolean;
  versionIsolationPassed: boolean;
}>;
export type ReadinessReceipt =
  ArchiveReceipt | ServingReceipt | VectorReceipt | ProbeReceipt;

export type ServingReadinessReceiptBindingRow = Readonly<{
  publication_id: string;
  kind: ReadinessReceipt["kind"];
  receipt_version: string;
  receipt_hash: string;
  environment: string;
  closure_hash: string;
  bundle_hash: string;
  schema_version: string;
  build_commit: string;
  observed_at_ms: number;
}>;

export type ServingArchiveReceiptRow = Readonly<{
  publication_id: string;
  kind: "archive";
  retained_bundle_hash: string;
  immutable: number;
}>;

export type ServingServingReceiptRow = Readonly<{
  publication_id: string;
  kind: "serving";
  enabled_provider_count: number;
  enabled_provider_scope_hash: string;
  provider_slice_count: number;
  provider_slice_hash: string;
  provider_attribution_count: number;
  provider_attribution_hash: string;
  resource_count: number;
  exact_document_count: number;
  resource_inventory_hash: string;
  exact_search_inventory_hash: string;
  fts_build_version: string;
  fts_document_count: number;
  fts_queryable: number;
  foreign_keys_valid: number;
  content_hashes_valid: number;
  unavailable_provider_isolation_valid: number;
}>;

export type ServingVectorReceiptRow = Readonly<{
  publication_id: string;
  kind: "vectors";
  vector_namespace: string;
  document_count: number;
  verified_document_count: number;
  vector_inventory_hash: string;
  visibility_probe_version: string;
  mutation_id: string;
  all_ids_present: number;
  all_namespaces_match: number;
  queryable: number;
}>;

export type ServingProbeReceiptRow = Readonly<{
  publication_id: string;
  kind: "probes";
  probe_set_version: string;
  integrity_passed: number;
  evidence_coverage_passed: number;
  exact_search_passed: number;
  semantic_search_passed: number;
  structured_filter_passed: number;
  neutrality_passed: number;
  version_isolation_passed: number;
}>;

export type ServingReadinessReceiptRows = Readonly<{
  bindings: readonly ServingReadinessReceiptBindingRow[];
  archives: readonly ServingArchiveReceiptRow[];
  servings: readonly ServingServingReceiptRow[];
  vectors: readonly ServingVectorReceiptRow[];
  probes: readonly ServingProbeReceiptRow[];
}>;

export type ServingReadinessAttestationProjection = Readonly<{
  publication_id: string;
  environment: string;
  closure_hash: string;
  bundle_hash: string;
  evaluator_version: "1.0.0";
  ready_at_ms: number;
  maximum_receipt_age_ms: number;
  effective_valid_until_ms: number;
  archive_observed_at_ms: number;
  serving_observed_at_ms: number;
  vector_observed_at_ms: number;
  probes_observed_at_ms: number;
  archive_receipt_hash: string;
  serving_receipt_hash: string;
  vector_receipt_hash: string;
  probes_receipt_hash: string;
  attestation_hash: string;
}>;

export const READINESS_FAILURE_CODES = [
  "manifest_invalid",
  "receipt_invalid",
  "receipt_missing",
  "receipt_duplicate",
  "receipt_binding_mismatch",
  "receipt_stale",
  "archive_invalid",
  "serving_invalid",
  "vectors_invalid",
  "probes_failed",
] as const;
export type ReadinessFailureCode = (typeof READINESS_FAILURE_CODES)[number];

export type ReadinessDecision =
  | Readonly<{ decision: "ready"; readyAt: string; closureHash: Sha256 }>
  | Readonly<{
      decision: "blocked";
      failureCodes: readonly ReadinessFailureCode[];
      missingReceipts: readonly ReadinessReceipt["kind"][];
    }>;

const bindingMatches = (
  manifest: ImmutablePublicationManifest,
  expectedEnvironment: PublicationEnvironment,
  binding: ArtifactBinding,
): boolean =>
  binding.environment === expectedEnvironment &&
  binding.publicationId === manifest.publicationId &&
  binding.closureHash === manifest.closureHash &&
  binding.bundleHash === manifest.bundleHash &&
  binding.schemaVersion === manifest.versions.schema &&
  binding.buildCommit === manifest.versions.buildCommit;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort(compareAscii);
  return (
    JSON.stringify(actual) === JSON.stringify([...keys].sort(compareAscii))
  );
};

const validReceiptBinding = (value: unknown): value is ArtifactBinding =>
  isRecord(value) &&
  hasExactKeys(value, [
    "environment",
    "publicationId",
    "closureHash",
    "bundleHash",
    "schemaVersion",
    "buildCommit",
  ]) &&
  typeof value.environment === "string" &&
  PUBLICATION_ENVIRONMENTS.has(value.environment) &&
  typeof value.publicationId === "string" &&
  PUBLICATION_ID.test(value.publicationId) &&
  typeof value.closureHash === "string" &&
  HASH.test(value.closureHash) &&
  typeof value.bundleHash === "string" &&
  HASH.test(value.bundleHash) &&
  typeof value.schemaVersion === "string" &&
  SEMVER.test(value.schemaVersion) &&
  typeof value.buildCommit === "string" &&
  isAscii(value.buildCommit) &&
  value.buildCommit.length > 0 &&
  value.buildCommit.length <= 128;

const isCanonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    assertTimestamp(value, "receipt timestamp");
    return true;
  } catch {
    return false;
  }
};

const isNonnegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const validateReceiptShape = (value: unknown): value is ReadinessReceipt => {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (
    !validReceiptBinding(value.binding) ||
    !isCanonicalTimestamp(value.observedAt)
  )
    return false;
  switch (value.kind) {
    case "archive":
      return (
        hasExactKeys(value, [
          "kind",
          "binding",
          "observedAt",
          "retainedBundleHash",
          "immutable",
        ]) &&
        typeof value.retainedBundleHash === "string" &&
        HASH.test(value.retainedBundleHash) &&
        typeof value.immutable === "boolean"
      );
    case "serving":
      return (
        hasExactKeys(value, [
          "kind",
          "binding",
          "observedAt",
          "enabledProviderCount",
          "enabledProviderScopeHash",
          "providerSliceCount",
          "providerSliceHash",
          "providerAttributionCount",
          "providerAttributionHash",
          "resourceCount",
          "exactDocumentCount",
          "resourceInventoryHash",
          "exactSearchInventoryHash",
          "ftsBuildVersion",
          "ftsDocumentCount",
          "ftsQueryable",
          "foreignKeysValid",
          "contentHashesValid",
          "unavailableProviderIsolationValid",
        ]) &&
        isNonnegativeSafeInteger(value.enabledProviderCount) &&
        typeof value.enabledProviderScopeHash === "string" &&
        HASH.test(value.enabledProviderScopeHash) &&
        isNonnegativeSafeInteger(value.providerSliceCount) &&
        typeof value.providerSliceHash === "string" &&
        HASH.test(value.providerSliceHash) &&
        isNonnegativeSafeInteger(value.providerAttributionCount) &&
        typeof value.providerAttributionHash === "string" &&
        HASH.test(value.providerAttributionHash) &&
        isNonnegativeSafeInteger(value.resourceCount) &&
        isNonnegativeSafeInteger(value.exactDocumentCount) &&
        typeof value.resourceInventoryHash === "string" &&
        HASH.test(value.resourceInventoryHash) &&
        typeof value.exactSearchInventoryHash === "string" &&
        HASH.test(value.exactSearchInventoryHash) &&
        typeof value.ftsBuildVersion === "string" &&
        isAscii(value.ftsBuildVersion) &&
        value.ftsBuildVersion.length > 0 &&
        value.ftsBuildVersion.length <= 128 &&
        isNonnegativeSafeInteger(value.ftsDocumentCount) &&
        typeof value.ftsQueryable === "boolean" &&
        typeof value.foreignKeysValid === "boolean" &&
        typeof value.contentHashesValid === "boolean" &&
        typeof value.unavailableProviderIsolationValid === "boolean"
      );
    case "vectors":
      return (
        hasExactKeys(value, [
          "kind",
          "binding",
          "observedAt",
          "namespace",
          "documentCount",
          "verifiedDocumentCount",
          "vectorInventoryHash",
          "visibilityProbeVersion",
          "mutationId",
          "allIdsPresent",
          "allNamespacesMatch",
          "queryable",
        ]) &&
        typeof value.namespace === "string" &&
        PUBLICATION_ID.test(value.namespace) &&
        isNonnegativeSafeInteger(value.documentCount) &&
        isNonnegativeSafeInteger(value.verifiedDocumentCount) &&
        typeof value.vectorInventoryHash === "string" &&
        HASH.test(value.vectorInventoryHash) &&
        typeof value.visibilityProbeVersion === "string" &&
        isAscii(value.visibilityProbeVersion) &&
        value.visibilityProbeVersion.length > 0 &&
        value.visibilityProbeVersion.length <= 128 &&
        typeof value.mutationId === "string" &&
        isAscii(value.mutationId) &&
        value.mutationId.length > 0 &&
        value.mutationId.length <= 128 &&
        typeof value.allIdsPresent === "boolean" &&
        typeof value.allNamespacesMatch === "boolean" &&
        typeof value.queryable === "boolean"
      );
    case "probes":
      return (
        hasExactKeys(value, [
          "kind",
          "binding",
          "observedAt",
          "probeSetVersion",
          "integrityPassed",
          "evidenceCoveragePassed",
          "exactSearchPassed",
          "semanticSearchPassed",
          "structuredFilterPassed",
          "neutralityPassed",
          "versionIsolationPassed",
        ]) &&
        typeof value.probeSetVersion === "string" &&
        isAscii(value.probeSetVersion) &&
        value.probeSetVersion.length > 0 &&
        value.probeSetVersion.length <= 128 &&
        [
          value.integrityPassed,
          value.evidenceCoveragePassed,
          value.exactSearchPassed,
          value.semanticSearchPassed,
          value.structuredFilterPassed,
          value.neutralityPassed,
          value.versionIsolationPassed,
        ].every((flag) => typeof flag === "boolean")
      );
    default:
      return false;
  }
};

const readinessReceiptHash = async (
  receipt: ReadinessReceipt,
): Promise<Sha256> => {
  const common: CanonicalField[] = [
    field("receipt_version", "text", "1.0.0"),
    field("kind", "text", receipt.kind),
    field("environment", "text", receipt.binding.environment),
    field("publication_id", "identifier", receipt.binding.publicationId),
    field("closure_hash", "digest", receipt.binding.closureHash),
    field("bundle_hash", "digest", receipt.binding.bundleHash),
    field("schema_version", "text", receipt.binding.schemaVersion),
    field("build_commit", "text", receipt.binding.buildCommit),
    field("observed_at", "timestamp", receipt.observedAt),
  ];
  const specific: CanonicalField[] = [];
  switch (receipt.kind) {
    case "archive":
      specific.push(
        field("retained_bundle_hash", "digest", receipt.retainedBundleHash),
        field("immutable", "boolean", String(receipt.immutable)),
      );
      break;
    case "serving":
      specific.push(
        field(
          "enabled_provider_count",
          "integer",
          String(receipt.enabledProviderCount),
        ),
        field(
          "enabled_provider_scope_hash",
          "digest",
          receipt.enabledProviderScopeHash,
        ),
        field(
          "provider_slice_count",
          "integer",
          String(receipt.providerSliceCount),
        ),
        field("provider_slice_hash", "digest", receipt.providerSliceHash),
        field(
          "provider_attribution_count",
          "integer",
          String(receipt.providerAttributionCount),
        ),
        field(
          "provider_attribution_hash",
          "digest",
          receipt.providerAttributionHash,
        ),
        field("resource_count", "integer", String(receipt.resourceCount)),
        field(
          "exact_document_count",
          "integer",
          String(receipt.exactDocumentCount),
        ),
        field(
          "resource_inventory_hash",
          "digest",
          receipt.resourceInventoryHash,
        ),
        field(
          "exact_search_inventory_hash",
          "digest",
          receipt.exactSearchInventoryHash,
        ),
        field("fts_build_version", "text", receipt.ftsBuildVersion),
        field(
          "fts_document_count",
          "integer",
          String(receipt.ftsDocumentCount),
        ),
        field("fts_queryable", "boolean", String(receipt.ftsQueryable)),
        field(
          "foreign_keys_valid",
          "boolean",
          String(receipt.foreignKeysValid),
        ),
        field(
          "content_hashes_valid",
          "boolean",
          String(receipt.contentHashesValid),
        ),
        field(
          "unavailable_provider_isolation_valid",
          "boolean",
          String(receipt.unavailableProviderIsolationValid),
        ),
      );
      break;
    case "vectors":
      specific.push(
        field("namespace", "identifier", receipt.namespace),
        field("document_count", "integer", String(receipt.documentCount)),
        field(
          "verified_document_count",
          "integer",
          String(receipt.verifiedDocumentCount),
        ),
        field("vector_inventory_hash", "digest", receipt.vectorInventoryHash),
        field(
          "visibility_probe_version",
          "text",
          receipt.visibilityProbeVersion,
        ),
        field("mutation_id", "text", receipt.mutationId),
        field("all_ids_present", "boolean", String(receipt.allIdsPresent)),
        field(
          "all_namespaces_match",
          "boolean",
          String(receipt.allNamespacesMatch),
        ),
        field("queryable", "boolean", String(receipt.queryable)),
      );
      break;
    case "probes":
      specific.push(
        field("probe_set_version", "text", receipt.probeSetVersion),
        field("integrity_passed", "boolean", String(receipt.integrityPassed)),
        field(
          "evidence_coverage_passed",
          "boolean",
          String(receipt.evidenceCoveragePassed),
        ),
        field(
          "exact_search_passed",
          "boolean",
          String(receipt.exactSearchPassed),
        ),
        field(
          "semantic_search_passed",
          "boolean",
          String(receipt.semanticSearchPassed),
        ),
        field(
          "structured_filter_passed",
          "boolean",
          String(receipt.structuredFilterPassed),
        ),
        field("neutrality_passed", "boolean", String(receipt.neutralityPassed)),
        field(
          "version_isolation_passed",
          "boolean",
          String(receipt.versionIsolationPassed),
        ),
      );
      break;
  }
  return digest("publication-readiness-receipt", [...common, ...specific]);
};

const receiptFlag = (value: number, label: string): boolean => {
  if (value !== 0 && value !== 1)
    throw new TypeError(`${label} must be a SQLite Boolean`);
  return value === 1;
};

const timestampFromMs = (value: number, label: string): string => {
  assertSafeInteger(value, 0, label);
  const timestamp = new Date(value).toISOString();
  assertTimestamp(timestamp, label);
  return timestamp;
};

const requireSingleRow = <T>(rows: readonly T[], label: string): T => {
  if (rows.length !== 1)
    throw new TypeError(`${label} must contain exactly one row`);
  const [row] = rows;
  if (row === undefined)
    throw new TypeError(`${label} must contain exactly one defined row`);
  return row;
};

export const projectServingReadinessReceiptRows = async (
  receipts: readonly ReadinessReceipt[],
): Promise<ServingReadinessReceiptRows> => {
  const expectedKinds = ["archive", "serving", "vectors", "probes"] as const;
  for (const receipt of receipts as readonly unknown[])
    if (!validateReceiptShape(receipt))
      throw new TypeError("readiness receipt shape is invalid");
  if (
    receipts.some(
      (receipt) =>
        !SERVING_PUBLICATION_ENVIRONMENTS.has(receipt.binding.environment),
    )
  )
    throw new TypeError(
      "serving readiness receipts cannot use the test-only environment",
    );
  for (const kind of expectedKinds)
    if (receipts.filter((receipt) => receipt.kind === kind).length !== 1)
      throw new TypeError(`readiness receipt ${kind} must occur exactly once`);
  if (receipts.length !== expectedKinds.length)
    throw new TypeError("readiness receipt set contains extra rows");

  const bindings: ServingReadinessReceiptBindingRow[] = [];
  const archives: ServingArchiveReceiptRow[] = [];
  const servings: ServingServingReceiptRow[] = [];
  const vectors: ServingVectorReceiptRow[] = [];
  const probes: ServingProbeReceiptRow[] = [];
  for (const receipt of receipts) {
    bindings.push(
      Object.freeze({
        publication_id: receipt.binding.publicationId,
        kind: receipt.kind,
        receipt_version: "1.0.0",
        receipt_hash: await readinessReceiptHash(receipt),
        environment: receipt.binding.environment,
        closure_hash: receipt.binding.closureHash,
        bundle_hash: receipt.binding.bundleHash,
        schema_version: receipt.binding.schemaVersion,
        build_commit: receipt.binding.buildCommit,
        observed_at_ms: assertTimestamp(
          receipt.observedAt,
          "receipt observation time",
        ),
      }),
    );
    switch (receipt.kind) {
      case "archive":
        archives.push(
          Object.freeze({
            publication_id: receipt.binding.publicationId,
            kind: "archive",
            retained_bundle_hash: receipt.retainedBundleHash,
            immutable: receipt.immutable ? 1 : 0,
          }),
        );
        break;
      case "serving":
        servings.push(
          Object.freeze({
            publication_id: receipt.binding.publicationId,
            kind: "serving",
            enabled_provider_count: receipt.enabledProviderCount,
            enabled_provider_scope_hash: receipt.enabledProviderScopeHash,
            provider_slice_count: receipt.providerSliceCount,
            provider_slice_hash: receipt.providerSliceHash,
            provider_attribution_count: receipt.providerAttributionCount,
            provider_attribution_hash: receipt.providerAttributionHash,
            resource_count: receipt.resourceCount,
            exact_document_count: receipt.exactDocumentCount,
            resource_inventory_hash: receipt.resourceInventoryHash,
            exact_search_inventory_hash: receipt.exactSearchInventoryHash,
            fts_build_version: receipt.ftsBuildVersion,
            fts_document_count: receipt.ftsDocumentCount,
            fts_queryable: receipt.ftsQueryable ? 1 : 0,
            foreign_keys_valid: receipt.foreignKeysValid ? 1 : 0,
            content_hashes_valid: receipt.contentHashesValid ? 1 : 0,
            unavailable_provider_isolation_valid:
              receipt.unavailableProviderIsolationValid ? 1 : 0,
          }),
        );
        break;
      case "vectors":
        vectors.push(
          Object.freeze({
            publication_id: receipt.binding.publicationId,
            kind: "vectors",
            vector_namespace: receipt.namespace,
            document_count: receipt.documentCount,
            verified_document_count: receipt.verifiedDocumentCount,
            vector_inventory_hash: receipt.vectorInventoryHash,
            visibility_probe_version: receipt.visibilityProbeVersion,
            mutation_id: receipt.mutationId,
            all_ids_present: receipt.allIdsPresent ? 1 : 0,
            all_namespaces_match: receipt.allNamespacesMatch ? 1 : 0,
            queryable: receipt.queryable ? 1 : 0,
          }),
        );
        break;
      case "probes":
        probes.push(
          Object.freeze({
            publication_id: receipt.binding.publicationId,
            kind: "probes",
            probe_set_version: receipt.probeSetVersion,
            integrity_passed: receipt.integrityPassed ? 1 : 0,
            evidence_coverage_passed: receipt.evidenceCoveragePassed ? 1 : 0,
            exact_search_passed: receipt.exactSearchPassed ? 1 : 0,
            semantic_search_passed: receipt.semanticSearchPassed ? 1 : 0,
            structured_filter_passed: receipt.structuredFilterPassed ? 1 : 0,
            neutrality_passed: receipt.neutralityPassed ? 1 : 0,
            version_isolation_passed: receipt.versionIsolationPassed ? 1 : 0,
          }),
        );
        break;
    }
  }
  return Object.freeze({
    bindings: Object.freeze(bindings),
    archives: Object.freeze(archives),
    servings: Object.freeze(servings),
    vectors: Object.freeze(vectors),
    probes: Object.freeze(probes),
  });
};

export const readServingReadinessReceipts = async (
  rows: ServingReadinessReceiptRows,
): Promise<readonly ReadinessReceipt[]> => {
  if (rows.bindings.length !== 4)
    throw new TypeError("persisted readiness bindings must contain four rows");
  const detailByKind = {
    archive: requireSingleRow(rows.archives, "archive receipt details"),
    serving: requireSingleRow(rows.servings, "serving receipt details"),
    vectors: requireSingleRow(rows.vectors, "vector receipt details"),
    probes: requireSingleRow(rows.probes, "probe receipt details"),
  } as const;
  const receipts: ReadinessReceipt[] = [];
  for (const bindingRow of rows.bindings) {
    if (
      bindingRow.receipt_version !== "1.0.0" ||
      !HASH.test(bindingRow.receipt_hash) ||
      !SERVING_PUBLICATION_ENVIRONMENTS.has(bindingRow.environment)
    )
      throw new TypeError("persisted readiness receipt identity is invalid");
    const detail = detailByKind[bindingRow.kind];
    if (detail.publication_id !== bindingRow.publication_id)
      throw new TypeError("persisted readiness receipt details do not bind");
    const binding: ArtifactBinding = Object.freeze({
      environment: bindingRow.environment as PublicationEnvironment,
      publicationId: bindingRow.publication_id as PublicationId,
      closureHash: bindingRow.closure_hash as Sha256,
      bundleHash: bindingRow.bundle_hash as Sha256,
      schemaVersion: bindingRow.schema_version,
      buildCommit: bindingRow.build_commit,
    });
    const observedAt = timestampFromMs(
      bindingRow.observed_at_ms,
      "persisted receipt observation time",
    );
    let candidate: unknown;
    switch (bindingRow.kind) {
      case "archive": {
        const archive = detailByKind.archive;
        candidate = {
          kind: "archive",
          binding,
          observedAt,
          retainedBundleHash: archive.retained_bundle_hash,
          immutable: receiptFlag(archive.immutable, "archive immutable"),
        };
        break;
      }
      case "serving": {
        const serving = detailByKind.serving;
        candidate = {
          kind: "serving",
          binding,
          observedAt,
          enabledProviderCount: serving.enabled_provider_count,
          enabledProviderScopeHash: serving.enabled_provider_scope_hash,
          providerSliceCount: serving.provider_slice_count,
          providerSliceHash: serving.provider_slice_hash,
          providerAttributionCount: serving.provider_attribution_count,
          providerAttributionHash: serving.provider_attribution_hash,
          resourceCount: serving.resource_count,
          exactDocumentCount: serving.exact_document_count,
          resourceInventoryHash: serving.resource_inventory_hash,
          exactSearchInventoryHash: serving.exact_search_inventory_hash,
          ftsBuildVersion: serving.fts_build_version,
          ftsDocumentCount: serving.fts_document_count,
          ftsQueryable: receiptFlag(
            serving.fts_queryable,
            "serving FTS queryability",
          ),
          foreignKeysValid: receiptFlag(
            serving.foreign_keys_valid,
            "serving foreign-key validity",
          ),
          contentHashesValid: receiptFlag(
            serving.content_hashes_valid,
            "serving content-hash validity",
          ),
          unavailableProviderIsolationValid: receiptFlag(
            serving.unavailable_provider_isolation_valid,
            "serving unavailable-provider isolation",
          ),
        };
        break;
      }
      case "vectors": {
        const vectors = detailByKind.vectors;
        candidate = {
          kind: "vectors",
          binding,
          observedAt,
          namespace: vectors.vector_namespace,
          documentCount: vectors.document_count,
          verifiedDocumentCount: vectors.verified_document_count,
          vectorInventoryHash: vectors.vector_inventory_hash,
          visibilityProbeVersion: vectors.visibility_probe_version,
          mutationId: vectors.mutation_id,
          allIdsPresent: receiptFlag(
            vectors.all_ids_present,
            "vector inventory presence",
          ),
          allNamespacesMatch: receiptFlag(
            vectors.all_namespaces_match,
            "vector namespace matching",
          ),
          queryable: receiptFlag(vectors.queryable, "vector queryability"),
        };
        break;
      }
      case "probes": {
        const probes = detailByKind.probes;
        candidate = {
          kind: "probes",
          binding,
          observedAt,
          probeSetVersion: probes.probe_set_version,
          integrityPassed: receiptFlag(
            probes.integrity_passed,
            "integrity probe",
          ),
          evidenceCoveragePassed: receiptFlag(
            probes.evidence_coverage_passed,
            "evidence coverage probe",
          ),
          exactSearchPassed: receiptFlag(
            probes.exact_search_passed,
            "exact-search probe",
          ),
          semanticSearchPassed: receiptFlag(
            probes.semantic_search_passed,
            "semantic-search probe",
          ),
          structuredFilterPassed: receiptFlag(
            probes.structured_filter_passed,
            "structured-filter probe",
          ),
          neutralityPassed: receiptFlag(
            probes.neutrality_passed,
            "neutrality probe",
          ),
          versionIsolationPassed: receiptFlag(
            probes.version_isolation_passed,
            "version-isolation probe",
          ),
        };
        break;
      }
    }
    if (!validateReceiptShape(candidate))
      throw new TypeError("persisted readiness receipt shape is invalid");
    if ((await readinessReceiptHash(candidate)) !== bindingRow.receipt_hash)
      throw new TypeError("persisted readiness receipt hash does not match");
    receipts.push(Object.freeze(candidate));
  }
  for (const kind of ["archive", "serving", "vectors", "probes"] as const)
    if (receipts.filter((receipt) => receipt.kind === kind).length !== 1)
      throw new TypeError(`persisted readiness receipt ${kind} is not unique`);
  return Object.freeze(receipts);
};

export const evaluateReadiness = async (input: {
  readonly manifest: ImmutablePublicationManifest;
  readonly receipts: readonly ReadinessReceipt[];
  readonly environment: PublicationEnvironment;
  readonly now: string;
  readonly maximumReceiptAgeMs: number;
}): Promise<ReadinessDecision> => {
  const now = assertTimestamp(input.now, "readiness time");
  assertSafeInteger(input.maximumReceiptAgeMs, 0, "maximum receipt age");
  if (!PUBLICATION_ENVIRONMENTS.has(input.environment))
    throw new TypeError("expected publication environment is invalid");
  const failures = new Set<ReadinessFailureCode>();
  if ((await verifyImmutableManifest(input.manifest)).length > 0)
    failures.add("manifest_invalid");
  const kinds = ["archive", "serving", "vectors", "probes"] as const;
  const missing: ReadinessReceipt["kind"][] = [];
  const selected = new Map<ReadinessReceipt["kind"], ReadinessReceipt>();
  const validReceipts: ReadinessReceipt[] = [];
  for (const receipt of input.receipts as readonly unknown[]) {
    if (validateReceiptShape(receipt)) validReceipts.push(receipt);
    else failures.add("receipt_invalid");
  }
  for (const kind of kinds) {
    const receipts = validReceipts.filter((receipt) => receipt.kind === kind);
    if (receipts.length === 0) {
      missing.push(kind);
      failures.add("receipt_missing");
    } else if (receipts.length > 1) failures.add("receipt_duplicate");
    if (receipts[0] !== undefined) selected.set(kind, receipts[0]);
  }
  for (const receipt of selected.values()) {
    if (!bindingMatches(input.manifest, input.environment, receipt.binding))
      failures.add("receipt_binding_mismatch");
    const observed = Date.parse(receipt.observedAt);
    if (observed > now || now - observed > input.maximumReceiptAgeMs)
      failures.add("receipt_stale");
  }
  const archive = selected.get("archive") as ArchiveReceipt | undefined;
  if (
    archive !== undefined &&
    (!archive.immutable ||
      archive.retainedBundleHash !== input.manifest.bundleHash)
  )
    failures.add("archive_invalid");
  const serving = selected.get("serving") as ServingReceipt | undefined;
  if (
    serving !== undefined &&
    (serving.enabledProviderCount !==
      input.manifest.enabledProviderIds.length ||
      serving.enabledProviderScopeHash !==
        input.manifest.enabledProviderScopeHash ||
      serving.providerSliceCount !== input.manifest.providerSlices.length ||
      serving.providerSliceHash !== input.manifest.providerSliceHash ||
      serving.providerAttributionCount !==
        input.manifest.providerAttributions.length ||
      serving.providerAttributionHash !==
        input.manifest.providerAttributionHash ||
      serving.resourceCount !== input.manifest.resources.length ||
      serving.exactDocumentCount !== input.manifest.searchDocuments.length ||
      serving.resourceInventoryHash !== input.manifest.resourceInventoryHash ||
      serving.exactSearchInventoryHash !==
        input.manifest.exactSearchInventoryHash ||
      serving.ftsBuildVersion !== READINESS_FTS_BUILD_VERSION ||
      serving.ftsDocumentCount !== input.manifest.searchDocuments.length ||
      !serving.ftsQueryable ||
      !serving.foreignKeysValid ||
      !serving.contentHashesValid ||
      !serving.unavailableProviderIsolationValid)
  )
    failures.add("serving_invalid");
  const vectors = selected.get("vectors") as VectorReceipt | undefined;
  if (
    vectors !== undefined &&
    (vectors.namespace !== input.manifest.publicationId ||
      vectors.documentCount !== input.manifest.vectors.length ||
      vectors.verifiedDocumentCount !== input.manifest.vectors.length ||
      vectors.vectorInventoryHash !== input.manifest.vectorInventoryHash ||
      vectors.visibilityProbeVersion !== VECTOR_VISIBILITY_PROBE_VERSION ||
      !vectors.allIdsPresent ||
      !vectors.allNamespacesMatch ||
      !vectors.queryable)
  )
    failures.add("vectors_invalid");
  const probes = selected.get("probes") as ProbeReceipt | undefined;
  if (
    probes !== undefined &&
    (probes.probeSetVersion !== READINESS_PROBE_SET_VERSION ||
      !probes.integrityPassed ||
      !probes.evidenceCoveragePassed ||
      !probes.exactSearchPassed ||
      !probes.semanticSearchPassed ||
      !probes.structuredFilterPassed ||
      !probes.neutralityPassed ||
      !probes.versionIsolationPassed)
  )
    failures.add("probes_failed");
  if (failures.size > 0)
    return Object.freeze({
      decision: "blocked",
      failureCodes: Object.freeze([...failures].sort()),
      missingReceipts: Object.freeze(missing),
    });
  return Object.freeze({
    decision: "ready",
    readyAt: new Date(now).toISOString(),
    closureHash: input.manifest.closureHash,
  });
};

export type ServingReadinessAttestationDecision =
  | Readonly<{
      decision: "ready";
      readyAt: string;
      closureHash: Sha256;
      attestation: ServingReadinessAttestationProjection;
    }>
  | Extract<ReadinessDecision, { decision: "blocked" }>;

export interface ServingReadinessAttestationInput {
  readonly closureRows: ServingClosureRows;
  readonly persistedSeal: ServingClosureSealProjection;
  readonly receiptRows: ServingReadinessReceiptRows;
  readonly environment: Exclude<PublicationEnvironment, "test">;
  readonly readyAtMs: number;
  readonly maximumReceiptAgeMs: number;
}

export const projectServingReadinessAttestation = async (
  input: ServingReadinessAttestationInput,
): Promise<ServingReadinessAttestationDecision> => {
  if (!SERVING_PUBLICATION_ENVIRONMENTS.has(input.environment))
    throw new TypeError("serving readiness environment is invalid");
  assertSafeInteger(input.readyAtMs, 0, "readiness time");
  assertSafeInteger(
    input.maximumReceiptAgeMs,
    0,
    "maximum readiness receipt age",
  );
  const readyAt = timestampFromMs(input.readyAtMs, "readiness time");
  const closure = await projectServingClosureSeal(input.closureRows);
  const sealErrors = await verifyServingClosureSealProjection(
    input.closureRows,
    input.persistedSeal,
  );
  const [firstSealError] = sealErrors;
  if (firstSealError !== undefined)
    throw new TypeError(`persisted closure seal is invalid: ${firstSealError}`);
  const receipts = await readServingReadinessReceipts(input.receiptRows);
  if (
    receipts.some(
      (receipt) =>
        assertTimestamp(receipt.observedAt, "receipt observation time") <
        input.closureRows.sealedAtMs,
    )
  )
    throw new TypeError("readiness receipt observation predates closure seal");
  const decision = await evaluateReadiness({
    manifest: closure.manifest,
    receipts,
    environment: input.environment,
    now: readyAt,
    maximumReceiptAgeMs: input.maximumReceiptAgeMs,
  });
  if (decision.decision === "blocked") return decision;

  const bindingByKind = new Map(
    input.receiptRows.bindings.map((row) => [row.kind, row] as const),
  );
  const requireBinding = (
    kind: ReadinessReceipt["kind"],
  ): ServingReadinessReceiptBindingRow => {
    const binding = bindingByKind.get(kind);
    if (binding === undefined)
      throw new TypeError(`persisted ${kind} receipt binding is missing`);
    return binding;
  };
  const archive = requireBinding("archive");
  const serving = requireBinding("serving");
  const vectors = requireBinding("vectors");
  const probes = requireBinding("probes");
  const effectiveValidUntilMs =
    Math.min(
      archive.observed_at_ms,
      serving.observed_at_ms,
      vectors.observed_at_ms,
      probes.observed_at_ms,
    ) + input.maximumReceiptAgeMs;
  assertSafeInteger(
    effectiveValidUntilMs,
    input.readyAtMs,
    "readiness effective validity deadline",
  );
  const effectiveValidUntil = timestampFromMs(
    effectiveValidUntilMs,
    "readiness effective validity deadline",
  );
  const attestationHash = await digest("publication-readiness-attestation", [
    field("evaluator_version", "text", "1.0.0"),
    field("environment", "text", input.environment),
    field("publication_id", "identifier", closure.manifest.publicationId),
    field("closure_hash", "digest", closure.manifest.closureHash),
    field("bundle_hash", "digest", closure.manifest.bundleHash),
    field("ready_at", "timestamp", readyAt),
    field(
      "maximum_receipt_age_ms",
      "integer",
      String(input.maximumReceiptAgeMs),
    ),
    field("effective_valid_until", "timestamp", effectiveValidUntil),
    field("archive_receipt_hash", "digest", archive.receipt_hash),
    field("serving_receipt_hash", "digest", serving.receipt_hash),
    field("vector_receipt_hash", "digest", vectors.receipt_hash),
    field("probes_receipt_hash", "digest", probes.receipt_hash),
  ]);
  const attestation: ServingReadinessAttestationProjection = Object.freeze({
    publication_id: closure.manifest.publicationId,
    environment: input.environment,
    closure_hash: closure.manifest.closureHash,
    bundle_hash: closure.manifest.bundleHash,
    evaluator_version: "1.0.0",
    ready_at_ms: input.readyAtMs,
    maximum_receipt_age_ms: input.maximumReceiptAgeMs,
    effective_valid_until_ms: effectiveValidUntilMs,
    archive_observed_at_ms: archive.observed_at_ms,
    serving_observed_at_ms: serving.observed_at_ms,
    vector_observed_at_ms: vectors.observed_at_ms,
    probes_observed_at_ms: probes.observed_at_ms,
    archive_receipt_hash: archive.receipt_hash,
    serving_receipt_hash: serving.receipt_hash,
    vector_receipt_hash: vectors.receipt_hash,
    probes_receipt_hash: probes.receipt_hash,
    attestation_hash: attestationHash,
  });
  return Object.freeze({
    decision: "ready",
    readyAt,
    closureHash: closure.manifest.closureHash,
    attestation,
  });
};

export const verifyServingReadinessAttestationProjection = async (
  input: ServingReadinessAttestationInput,
  candidate: ServingReadinessAttestationProjection,
): Promise<readonly string[]> => {
  const decision = await projectServingReadinessAttestation(input);
  if (decision.decision === "blocked")
    return Object.freeze([
      `readiness projection is blocked: ${decision.failureCodes.join(",")}`,
    ]);
  const expected = decision.attestation;
  const errors: string[] = [];
  for (const key of Object.keys(
    expected,
  ) as (keyof ServingReadinessAttestationProjection)[])
    if (candidate[key] !== expected[key])
      errors.push(`${key} does not match persisted readiness evidence`);
  if (Object.keys(candidate).length !== Object.keys(expected).length)
    errors.push(
      "readiness attestation shape does not match persisted evidence",
    );
  return Object.freeze(errors);
};

const servingReadinessCommitProjectionBrand: unique symbol = Symbol(
  "ServingReadinessCommitProjection",
);
const trustedServingReadinessCommitProjections = new WeakSet<object>();

export type ServingReadinessCommitProjection = Readonly<{
  receiptRows: ServingReadinessReceiptRows;
  attestation: ServingReadinessAttestationProjection;
  transition: Readonly<{
    publication_id: PublicationId;
    closure_hash: Sha256;
    expected_state: "building";
    next_state: "ready";
    ready_at_ms: number;
  }>;
  readonly [servingReadinessCommitProjectionBrand]: true;
}>;

export const assertServingReadinessCommitProjection: (
  value: unknown,
) => asserts value is ServingReadinessCommitProjection = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(servingReadinessCommitProjectionBrand in value) ||
    value[servingReadinessCommitProjectionBrand] !== true ||
    !trustedServingReadinessCommitProjections.has(value)
  )
    throw new TypeError("serving readiness commit projection is not trusted");
};

const freezeReadinessReceiptRows = (
  rows: ServingReadinessReceiptRows,
): ServingReadinessReceiptRows =>
  Object.freeze({
    bindings: Object.freeze(
      rows.bindings
        .map((row) => Object.freeze({ ...row }))
        .sort((left, right) => compareAscii(left.kind, right.kind)),
    ),
    archives: Object.freeze(
      rows.archives.map((row) => Object.freeze({ ...row })),
    ),
    servings: Object.freeze(
      rows.servings.map((row) => Object.freeze({ ...row })),
    ),
    vectors: Object.freeze(
      rows.vectors.map((row) => Object.freeze({ ...row })),
    ),
    probes: Object.freeze(rows.probes.map((row) => Object.freeze({ ...row }))),
  });

export type ServingReadinessCommitDecision =
  | Readonly<{
      decision: "ready";
      readyAt: string;
      closureHash: Sha256;
      projection: ServingReadinessCommitProjection;
    }>
  | Extract<ReadinessDecision, { decision: "blocked" }>;

export const projectServingReadinessCommit = async (
  callerInput: ServingReadinessAttestationInput,
): Promise<ServingReadinessCommitDecision> => {
  // Capture one detached view before the first digest yields. The trusted
  // projection must not retain caller-owned rows that can drift after hashing.
  const input = structuredClone(callerInput);
  const decision = await projectServingReadinessAttestation(input);
  if (decision.decision === "blocked") return decision;
  const receiptRows = freezeReadinessReceiptRows(input.receiptRows);
  const attestation = Object.freeze({ ...decision.attestation });
  const transition = Object.freeze({
    publication_id: attestation.publication_id as PublicationId,
    closure_hash: attestation.closure_hash as Sha256,
    expected_state: "building" as const,
    next_state: "ready" as const,
    ready_at_ms: attestation.ready_at_ms,
  });
  const projection = { receiptRows, attestation, transition };
  Object.defineProperty(projection, servingReadinessCommitProjectionBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedServingReadinessCommitProjections.add(projection);
  return Object.freeze({
    decision: "ready",
    readyAt: decision.readyAt,
    closureHash: decision.closureHash,
    projection: Object.freeze(projection) as ServingReadinessCommitProjection,
  });
};

export type ServingReadinessCommitRetryDecision = Readonly<{
  outcome:
    | "execute"
    | "idempotent_success"
    | "stale"
    | "conflict"
    | "integrity_failure";
}>;

const exactReadinessRows = (
  left: ServingReadinessReceiptRows,
  right: ServingReadinessReceiptRows,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const readinessRowsConflict = (
  actual: ServingReadinessReceiptRows,
  expected: ServingReadinessReceiptRows,
): boolean => {
  const groups = [
    [actual.bindings, expected.bindings],
    [actual.archives, expected.archives],
    [actual.servings, expected.servings],
    [actual.vectors, expected.vectors],
    [actual.probes, expected.probes],
  ] as const;
  return groups.some(([actualRows, expectedRows]) =>
    actualRows.some((actualRow) =>
      expectedRows.every(
        (expectedRow) =>
          JSON.stringify(actualRow) !== JSON.stringify(expectedRow),
      ),
    ),
  );
};

const readinessRowsEmpty = (rows: ServingReadinessReceiptRows): boolean =>
  rows.bindings.length === 0 &&
  rows.archives.length === 0 &&
  rows.servings.length === 0 &&
  rows.vectors.length === 0 &&
  rows.probes.length === 0;

export const classifyServingReadinessCommitRetry = (input: {
  readonly expected: ServingReadinessCommitProjection;
  readonly publicationState: PublicationState;
  readonly publicationReadyAtMs: number | null;
  readonly publicationClosureHash: string;
  readonly receiptRows: ServingReadinessReceiptRows;
  readonly attestation: ServingReadinessAttestationProjection | null;
}): ServingReadinessCommitRetryDecision => {
  assertServingReadinessCommitProjection(input.expected);
  const expected = input.expected;
  const hasRows = !readinessRowsEmpty(input.receiptRows);
  if (!hasRows && input.attestation === null) {
    if (
      input.publicationClosureHash !== expected.transition.closure_hash ||
      (input.publicationReadyAtMs !== null &&
        (!Number.isSafeInteger(input.publicationReadyAtMs) ||
          input.publicationReadyAtMs < 0))
    )
      return Object.freeze({ outcome: "integrity_failure" });
    if (
      input.publicationState === expected.transition.expected_state &&
      input.publicationReadyAtMs === null
    )
      return Object.freeze({ outcome: "execute" });
    if (
      input.publicationState === "failed" &&
      input.publicationReadyAtMs === null
    )
      return Object.freeze({ outcome: "stale" });
    return Object.freeze({ outcome: "integrity_failure" });
  }
  if (
    readinessRowsConflict(input.receiptRows, expected.receiptRows) ||
    (input.attestation !== null &&
      JSON.stringify(input.attestation) !==
        JSON.stringify(expected.attestation))
  )
    return Object.freeze({ outcome: "conflict" });
  if (
    !exactReadinessRows(input.receiptRows, expected.receiptRows) ||
    input.attestation === null
  )
    return Object.freeze({ outcome: "integrity_failure" });
  if (
    !(["ready", "active", "superseded", "rolled_back"] as const).includes(
      input.publicationState as
        "ready" | "active" | "superseded" | "rolled_back",
    ) ||
    input.publicationReadyAtMs !== expected.transition.ready_at_ms ||
    input.publicationClosureHash !== expected.transition.closure_hash
  )
    return Object.freeze({ outcome: "integrity_failure" });
  return Object.freeze({ outcome: "idempotent_success" });
};

export type PublicationState =
  "building" | "failed" | "ready" | "active" | "superseded" | "rolled_back";
export type PublicationRecord = Readonly<{
  publicationId: PublicationId;
  closureHash: Sha256;
  state: PublicationState;
  generatedAt: string;
  readyAt: string | null;
  firstActivatedAt: string | null;
  lastHeadReferencedAt: string | null;
}>;
export type StoredPublicationHead = Readonly<{
  activePublicationId: PublicationId;
  rollbackCandidatePublicationId: PublicationId | null;
  switchedAt: string;
  generation: number;
}>;
export type NormalizedPublicationHead = Readonly<{
  activePublicationId: PublicationId;
  vectorNamespace: PublicationId;
  manifestHash: Sha256;
  publishedAt: string;
  rollbackCandidatePublicationId: PublicationId | null;
  switchedAt: string;
  generation: number;
}>;
export type SwitchAuthorization = Readonly<{
  kind: "pipeline" | "operator";
  identityId: string;
}>;

export type HeadSwitchStep =
  | Readonly<{
      kind: "assert_candidate_ready";
      publicationId: PublicationId;
      closureHash: Sha256;
    }>
  | Readonly<{
      kind: "activate_candidate";
      publicationId: PublicationId;
      activatedAt: string;
    }>
  | Readonly<{
      kind: "assert_rollback_target";
      publicationId: PublicationId;
      closureHash: Sha256;
      expectedState: "superseded" | "rolled_back";
    }>
  | Readonly<{
      kind: "reactivate_rollback_target";
      publicationId: PublicationId;
      preserveFirstActivatedAt: string;
    }>
  | Readonly<{
      kind: "compare_and_swap_head";
      expected: StoredPublicationHead | null;
      next: StoredPublicationHead;
    }>
  | Readonly<{
      kind: "demote_previous";
      publicationId: PublicationId;
      toState: "superseded" | "rolled_back";
    }>
  | Readonly<{
      kind: "assert_head_postcondition";
      activePublicationId: PublicationId;
      rollbackCandidatePublicationId: PublicationId | null;
      generation: number;
      activeClosureHash: Sha256;
    }>
  | Readonly<{
      kind: "append_switch_history";
      switchId: string;
      action: "activate" | "rollback";
      expectedPriorGeneration: number;
      newGeneration: number;
      fromPublicationId: PublicationId | null;
      fromClosureHash: Sha256 | null;
      toPublicationId: PublicationId;
      toClosureHash: Sha256;
      resultingRollbackCandidatePublicationId: PublicationId | null;
      switchedAt: string;
      authorizedBy: SwitchAuthorization;
    }>;

export type HeadSwitchPlan = Readonly<{
  operation: "activate" | "rollback";
  effectKey: string;
  steps: readonly HeadSwitchStep[];
}>;

const validateHead = (head: StoredPublicationHead): void => {
  if (!PUBLICATION_ID.test(head.activePublicationId))
    throw new TypeError("head active publication is invalid");
  if (
    head.rollbackCandidatePublicationId !== null &&
    (!PUBLICATION_ID.test(head.rollbackCandidatePublicationId) ||
      head.rollbackCandidatePublicationId === head.activePublicationId)
  )
    throw new TypeError("head rollback candidate is invalid");
  assertTimestamp(head.switchedAt, "head switch time");
  assertSafeInteger(head.generation, 1, "head generation");
};

const validateAuthorization = (authorization: SwitchAuthorization): void => {
  if (
    !SWITCH_AUTHORIZATION_KINDS.has(authorization.kind) ||
    !SWITCH_AUTHORIZATION_ID.test(authorization.identityId)
  )
    throw new TypeError("switch authorization identity is invalid");
};

const validatePublicationRecord = (record: PublicationRecord): void => {
  if (!PUBLICATION_ID.test(record.publicationId))
    throw new TypeError("publication record ID is invalid");
  if (!HASH.test(record.closureHash))
    throw new TypeError("publication record closure hash is invalid");
  assertTimestamp(record.generatedAt, "publication generation time");
  if (record.readyAt !== null) {
    const ready = assertTimestamp(record.readyAt, "publication readiness time");
    if (ready < Date.parse(record.generatedAt))
      throw new TypeError("publication readiness precedes generation");
  }
  if (record.firstActivatedAt !== null) {
    const activated = assertTimestamp(
      record.firstActivatedAt,
      "publication first activation time",
    );
    if (record.readyAt === null || activated < Date.parse(record.readyAt))
      throw new TypeError("publication activation precedes readiness");
  }
  if (record.lastHeadReferencedAt !== null)
    assertTimestamp(
      record.lastHeadReferencedAt,
      "publication head reference time",
    );
  if (
    (record.state === "building" || record.state === "failed") &&
    (record.readyAt !== null || record.firstActivatedAt !== null)
  )
    throw new TypeError("non-ready publication retains readiness timestamps");
  if (
    record.state === "ready" &&
    (record.readyAt === null || record.firstActivatedAt !== null)
  )
    throw new TypeError("ready publication lifecycle timestamps are invalid");
  if (
    (record.state === "active" ||
      record.state === "superseded" ||
      record.state === "rolled_back") &&
    (record.readyAt === null || record.firstActivatedAt === null)
  )
    throw new TypeError("activated publication lacks lifecycle timestamps");
};

export const deriveNormalizedPublicationHead = (
  stored: StoredPublicationHead,
  active: PublicationRecord,
): NormalizedPublicationHead => {
  validateHead(stored);
  validatePublicationRecord(active);
  if (
    stored.activePublicationId !== active.publicationId ||
    active.state !== "active" ||
    active.firstActivatedAt === null
  )
    throw new TypeError("stored head cannot derive an active publication view");
  if (Date.parse(stored.switchedAt) < Date.parse(active.firstActivatedAt))
    throw new TypeError("stored head switch predates first activation");
  return Object.freeze({
    activePublicationId: active.publicationId,
    vectorNamespace: active.publicationId,
    manifestHash: active.closureHash,
    publishedAt: active.firstActivatedAt,
    rollbackCandidatePublicationId: stored.rollbackCandidatePublicationId,
    switchedAt: stored.switchedAt,
    generation: stored.generation,
  });
};

export const planActivation = (input: {
  readonly candidate: PublicationRecord;
  readonly currentHead: StoredPublicationHead | null;
  readonly currentActive: PublicationRecord | null;
  readonly switchedAt: string;
  readonly authorizedBy: SwitchAuthorization;
}): HeadSwitchPlan => {
  validatePublicationRecord(input.candidate);
  validateAuthorization(input.authorizedBy);
  if (input.candidate.state !== "ready" || input.candidate.readyAt === null)
    throw new TypeError("activation candidate is not ready");
  const switchedAt = new Date(
    assertTimestamp(input.switchedAt, "activation time"),
  ).toISOString();
  if (Date.parse(input.candidate.readyAt) > Date.parse(switchedAt))
    throw new TypeError("activation precedes readiness");
  if ((input.currentHead === null) !== (input.currentActive === null))
    throw new TypeError("head and current active record disagree");
  if (input.currentHead !== null && input.currentActive !== null) {
    validateHead(input.currentHead);
    validatePublicationRecord(input.currentActive);
    if (
      input.currentHead.activePublicationId !==
        input.currentActive.publicationId ||
      input.currentActive.state !== "active"
    )
      throw new TypeError("current head does not select the active record");
    deriveNormalizedPublicationHead(input.currentHead, input.currentActive);
    if (Date.parse(switchedAt) <= Date.parse(input.currentHead.switchedAt))
      throw new TypeError("activation time precedes the current head");
    if (input.candidate.publicationId === input.currentActive.publicationId)
      throw new TypeError("candidate publication is already active");
  }
  const generation = (input.currentHead?.generation ?? 0) + 1;
  if (!Number.isSafeInteger(generation))
    throw new RangeError("head generation overflowed");
  const next: StoredPublicationHead = Object.freeze({
    activePublicationId: input.candidate.publicationId,
    rollbackCandidatePublicationId: input.currentActive?.publicationId ?? null,
    switchedAt,
    generation,
  });
  validateHead(next);
  const steps: HeadSwitchStep[] = [
    Object.freeze({
      kind: "assert_candidate_ready",
      publicationId: input.candidate.publicationId,
      closureHash: input.candidate.closureHash,
    }),
    Object.freeze({
      kind: "activate_candidate",
      publicationId: input.candidate.publicationId,
      activatedAt: switchedAt,
    }),
    Object.freeze({
      kind: "compare_and_swap_head",
      expected:
        input.currentHead === null
          ? null
          : Object.freeze({ ...input.currentHead }),
      next,
    }),
  ];
  if (input.currentActive !== null)
    steps.push(
      Object.freeze({
        kind: "demote_previous",
        publicationId: input.currentActive.publicationId,
        toState: "superseded",
      }),
    );
  const effectKey = `publication-switch|activate|${String(generation)}|${input.candidate.publicationId}|${input.candidate.closureHash}`;
  steps.push(
    Object.freeze({
      kind: "append_switch_history",
      switchId: effectKey,
      action: "activate",
      expectedPriorGeneration: input.currentHead?.generation ?? 0,
      newGeneration: generation,
      fromPublicationId: input.currentActive?.publicationId ?? null,
      fromClosureHash: input.currentActive?.closureHash ?? null,
      toPublicationId: input.candidate.publicationId,
      toClosureHash: input.candidate.closureHash,
      resultingRollbackCandidatePublicationId:
        input.currentActive?.publicationId ?? null,
      switchedAt,
      authorizedBy: Object.freeze({ ...input.authorizedBy }),
    }),
  );
  steps.push(
    Object.freeze({
      kind: "assert_head_postcondition",
      activePublicationId: input.candidate.publicationId,
      rollbackCandidatePublicationId:
        input.currentActive?.publicationId ?? null,
      generation,
      activeClosureHash: input.candidate.closureHash,
    }),
  );
  return Object.freeze({
    operation: "activate",
    effectKey,
    steps: Object.freeze(steps),
  });
};

export const planRollback = (input: {
  readonly currentHead: StoredPublicationHead;
  readonly defective: PublicationRecord;
  readonly target: PublicationRecord;
  readonly switchedAt: string;
  readonly authorizedBy: SwitchAuthorization;
}): HeadSwitchPlan => {
  validateHead(input.currentHead);
  validateAuthorization(input.authorizedBy);
  validatePublicationRecord(input.defective);
  validatePublicationRecord(input.target);
  if (
    input.currentHead.activePublicationId !== input.defective.publicationId ||
    input.defective.state !== "active"
  )
    throw new TypeError("rollback defective publication is not active");
  deriveNormalizedPublicationHead(input.currentHead, input.defective);
  if (
    input.currentHead.rollbackCandidatePublicationId !==
      input.target.publicationId ||
    input.target.state !== "superseded" ||
    input.target.firstActivatedAt === null
  )
    throw new TypeError(
      "rollback target is not the retained immediate candidate",
    );
  const switchedAt = new Date(
    assertTimestamp(input.switchedAt, "rollback time"),
  ).toISOString();
  if (Date.parse(switchedAt) <= Date.parse(input.currentHead.switchedAt))
    throw new TypeError("rollback time precedes the current head");
  if (Date.parse(input.target.firstActivatedAt) > Date.parse(switchedAt))
    throw new TypeError("rollback target activation follows switch time");
  const generation = input.currentHead.generation + 1;
  if (!Number.isSafeInteger(generation))
    throw new RangeError("head generation overflowed");
  const next: StoredPublicationHead = Object.freeze({
    activePublicationId: input.target.publicationId,
    rollbackCandidatePublicationId: input.defective.publicationId,
    switchedAt,
    generation,
  });
  validateHead(next);
  const effectKey = `publication-switch|rollback|${String(generation)}|${input.target.publicationId}|${input.target.closureHash}`;
  const steps: readonly HeadSwitchStep[] = Object.freeze([
    Object.freeze({
      kind: "assert_rollback_target",
      publicationId: input.target.publicationId,
      closureHash: input.target.closureHash,
      expectedState: input.target.state,
    }),
    Object.freeze({
      kind: "reactivate_rollback_target",
      publicationId: input.target.publicationId,
      preserveFirstActivatedAt: input.target.firstActivatedAt,
    }),
    Object.freeze({
      kind: "compare_and_swap_head",
      expected: Object.freeze({ ...input.currentHead }),
      next,
    }),
    Object.freeze({
      kind: "demote_previous",
      publicationId: input.defective.publicationId,
      toState: "rolled_back",
    }),
    Object.freeze({
      kind: "append_switch_history",
      switchId: effectKey,
      action: "rollback",
      expectedPriorGeneration: input.currentHead.generation,
      newGeneration: generation,
      fromPublicationId: input.defective.publicationId,
      fromClosureHash: input.defective.closureHash,
      toPublicationId: input.target.publicationId,
      toClosureHash: input.target.closureHash,
      resultingRollbackCandidatePublicationId: input.defective.publicationId,
      switchedAt,
      authorizedBy: Object.freeze({ ...input.authorizedBy }),
    }),
    Object.freeze({
      kind: "assert_head_postcondition",
      activePublicationId: input.target.publicationId,
      rollbackCandidatePublicationId: input.defective.publicationId,
      generation,
      activeClosureHash: input.target.closureHash,
    }),
  ]);
  return Object.freeze({
    operation: "rollback",
    effectKey,
    steps,
  });
};

export const SERVING_SWITCH_PREFLIGHT_VERSION = "1.0.0";
export const SERVING_SWITCH_EVENT_VERSION = "1.0.0";

export type ServingSwitchArtifactProof = Readonly<{
  environment: Exclude<PublicationEnvironment, "test">;
  observedAtMs: number;
  maximumAgeMs: number;
  ftsBuildVersion: string;
  ftsSourceDocumentCount: number;
  ftsIndexDocumentCount: number;
  ftsSourceInventoryHash: Sha256;
  ftsExactParity: boolean;
  archiveBundleHash: Sha256;
  archiveImmutable: boolean;
  vectorNamespace: PublicationId;
  vectorDocumentCount: number;
  vectorVerifiedDocumentCount: number;
  vectorInventoryHash: Sha256;
  vectorVisibilityProbeVersion: string;
  vectorMutationId: string;
  vectorAllIdsPresent: boolean;
  vectorAllNamespacesMatch: boolean;
  vectorQueryable: boolean;
  probeSetVersion: string;
  integrityPassed: boolean;
  exactSearchPassed: boolean;
  semanticSearchPassed: boolean;
  structuredFilterPassed: boolean;
  neutralityPassed: boolean;
  versionIsolationPassed: boolean;
}>;

export type ServingSwitchPreflightRow = Readonly<{
  switch_id: string;
  preflight_version: "1.0.0";
  preflight_hash: Sha256;
  action: "activate" | "rollback";
  environment: Exclude<PublicationEnvironment, "test">;
  expected_prior_generation: number;
  expected_prior_rollback_candidate_publication_id: PublicationId | null;
  expected_prior_switched_at_ms: number | null;
  new_generation: number;
  from_publication_id: PublicationId | null;
  from_closure_hash: Sha256 | null;
  to_publication_id: PublicationId;
  to_closure_hash: Sha256;
  to_attestation_hash: Sha256 | null;
  switched_at_ms: number;
  observed_at_ms: number;
  maximum_age_ms: number;
  valid_until_ms: number;
  fts_build_version: string;
  fts_source_document_count: number;
  fts_index_document_count: number;
  fts_source_inventory_hash: Sha256;
  fts_exact_parity: 0 | 1;
  archive_bundle_hash: Sha256;
  archive_immutable: 0 | 1;
  vector_namespace: PublicationId;
  vector_document_count: number;
  vector_verified_document_count: number;
  vector_inventory_hash: Sha256;
  vector_visibility_probe_version: string;
  vector_mutation_id: string;
  vector_all_ids_present: 0 | 1;
  vector_all_namespaces_match: 0 | 1;
  vector_queryable: 0 | 1;
  probe_set_version: string;
  integrity_passed: 0 | 1;
  exact_search_passed: 0 | 1;
  semantic_search_passed: 0 | 1;
  structured_filter_passed: 0 | 1;
  neutrality_passed: 0 | 1;
  version_isolation_passed: 0 | 1;
}>;

export type ServingSwitchHistoryRow = Readonly<{
  switch_id: string;
  event_version: "1.0.0";
  event_hash: Sha256;
  preflight_hash: Sha256;
  action: "activate" | "rollback";
  expected_prior_generation: number;
  expected_prior_rollback_candidate_publication_id: PublicationId | null;
  expected_prior_switched_at_ms: number | null;
  new_generation: number;
  from_publication_id: PublicationId | null;
  from_closure_hash: Sha256 | null;
  to_publication_id: PublicationId;
  to_closure_hash: Sha256;
  to_attestation_hash: Sha256 | null;
  resulting_rollback_candidate_publication_id: PublicationId | null;
  switched_at_ms: number;
  authorized_by_kind: "pipeline" | "operator";
  authorized_identity_id: string;
}>;

const servingSwitchProjectionBrand: unique symbol = Symbol(
  "ServingSwitchProjection",
);
const trustedServingSwitchProjections = new WeakSet<object>();

export type ServingSwitchProjection = Readonly<{
  plan: HeadSwitchPlan;
  preflight: ServingSwitchPreflightRow;
  history: ServingSwitchHistoryRow;
  readonly [servingSwitchProjectionBrand]: true;
}>;

export const assertServingSwitchProjection = (
  value: unknown,
): asserts value is ServingSwitchProjection => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(servingSwitchProjectionBrand in value) ||
    value[servingSwitchProjectionBrand] !== true ||
    !trustedServingSwitchProjections.has(value)
  )
    throw new TypeError("serving switch projection is not trusted");
};

const nullableCanonical = (
  name: string,
  type: "digest" | "identifier",
  value: string | null,
): CanonicalField =>
  value === null ? field(name, "null", "null") : field(name, type, value);

const switchHistoryStep = (
  plan: HeadSwitchPlan,
): Extract<HeadSwitchStep, { kind: "append_switch_history" }> => {
  const step = plan.steps.find(
    (
      candidate,
    ): candidate is Extract<
      HeadSwitchStep,
      { kind: "append_switch_history" }
    > => candidate.kind === "append_switch_history",
  );
  if (step === undefined)
    throw new TypeError("switch plan lacks its history event");
  return step;
};

export type ServingSwitchProjectionInput = Readonly<{
  readonly action: "activate" | "rollback";
  readonly target: PublicationRecord;
  readonly currentHead: StoredPublicationHead | null;
  readonly currentActive: PublicationRecord | null;
  readonly switchedAt: string;
  readonly authorizedBy: SwitchAuthorization;
  readonly closureRows: ServingClosureRows;
  readonly persistedSeal: ServingClosureSealProjection;
  readonly receiptRows: ServingReadinessReceiptRows | null;
  readonly persistedAttestation: ServingReadinessAttestationProjection | null;
  readonly artifactProof: ServingSwitchArtifactProof;
}>;

export const projectServingSwitch = async (
  callerInput: ServingSwitchProjectionInput,
): Promise<ServingSwitchProjection> => {
  // Capture one synchronous, detached view before the first digest yields. This
  // prevents mutable caller objects from changing the values covered by hashes.
  const input = structuredClone(callerInput);
  if (!SERVING_PUBLICATION_ENVIRONMENTS.has(input.artifactProof.environment))
    throw new TypeError("serving switch environment is invalid");
  validateAuthorization(input.authorizedBy);
  const switchedAtMs = assertTimestamp(input.switchedAt, "switch time");
  assertSafeInteger(
    input.artifactProof.observedAtMs,
    0,
    "switch preflight observation time",
  );
  assertSafeInteger(
    input.artifactProof.maximumAgeMs,
    0,
    "maximum switch preflight age",
  );
  if (input.artifactProof.observedAtMs > switchedAtMs)
    throw new TypeError("switch preflight observation follows switch time");
  const validUntilMs =
    input.artifactProof.observedAtMs + input.artifactProof.maximumAgeMs;
  assertSafeInteger(
    validUntilMs,
    switchedAtMs,
    "switch preflight validity deadline",
  );

  const closure = await projectServingClosureSeal(input.closureRows);
  const sealErrors = await verifyServingClosureSealProjection(
    input.closureRows,
    input.persistedSeal,
  );
  const [sealError] = sealErrors;
  if (sealError !== undefined)
    throw new TypeError(`persisted closure seal is invalid: ${sealError}`);
  if (
    closure.manifest.publicationId !== input.target.publicationId ||
    closure.manifest.closureHash !== input.target.closureHash
  )
    throw new TypeError("switch target does not bind the sealed closure");
  if (input.artifactProof.observedAtMs < input.closureRows.sealedAtMs)
    throw new TypeError("switch preflight observation predates closure seal");

  const proof = input.artifactProof;
  if (
    proof.ftsBuildVersion !== READINESS_FTS_BUILD_VERSION ||
    proof.ftsSourceDocumentCount !== closure.manifest.searchDocuments.length ||
    proof.ftsIndexDocumentCount !== closure.manifest.searchDocuments.length ||
    proof.ftsSourceInventoryHash !==
      closure.manifest.exactSearchInventoryHash ||
    !proof.ftsExactParity ||
    proof.archiveBundleHash !== closure.manifest.bundleHash ||
    !proof.archiveImmutable ||
    proof.vectorNamespace !== closure.manifest.publicationId ||
    proof.vectorDocumentCount !== closure.manifest.vectors.length ||
    proof.vectorVerifiedDocumentCount !== closure.manifest.vectors.length ||
    proof.vectorInventoryHash !== closure.manifest.vectorInventoryHash ||
    proof.vectorVisibilityProbeVersion !== VECTOR_VISIBILITY_PROBE_VERSION ||
    !isAscii(proof.vectorMutationId) ||
    proof.vectorMutationId.length === 0 ||
    proof.vectorMutationId.length > 128 ||
    !proof.vectorAllIdsPresent ||
    !proof.vectorAllNamespacesMatch ||
    !proof.vectorQueryable ||
    proof.probeSetVersion !== READINESS_PROBE_SET_VERSION ||
    !proof.integrityPassed ||
    !proof.exactSearchPassed ||
    !proof.semanticSearchPassed ||
    !proof.structuredFilterPassed ||
    !proof.neutralityPassed ||
    !proof.versionIsolationPassed
  )
    throw new TypeError(
      "switch preflight does not prove the sealed serving artifacts",
    );

  let plan: HeadSwitchPlan;
  let attestationHash: Sha256 | null = null;
  if (input.action === "activate") {
    if (input.receiptRows === null || input.persistedAttestation === null)
      throw new TypeError("activation lacks persisted readiness evidence");
    const attestationInput: ServingReadinessAttestationInput = {
      closureRows: input.closureRows,
      persistedSeal: input.persistedSeal,
      receiptRows: input.receiptRows,
      environment: proof.environment,
      readyAtMs: input.persistedAttestation.ready_at_ms,
      maximumReceiptAgeMs: input.persistedAttestation.maximum_receipt_age_ms,
    };
    const attestationErrors = await verifyServingReadinessAttestationProjection(
      attestationInput,
      input.persistedAttestation,
    );
    const [attestationError] = attestationErrors;
    if (attestationError !== undefined)
      throw new TypeError(
        `persisted readiness attestation is invalid: ${attestationError}`,
      );
    if (
      input.persistedAttestation.publication_id !==
        input.target.publicationId ||
      input.persistedAttestation.closure_hash !== input.target.closureHash ||
      switchedAtMs > input.persistedAttestation.effective_valid_until_ms
    )
      throw new TypeError("activation attestation is expired or mismatched");
    attestationHash = input.persistedAttestation.attestation_hash as Sha256;
    plan = planActivation({
      candidate: input.target,
      currentHead: input.currentHead,
      currentActive: input.currentActive,
      switchedAt: input.switchedAt,
      authorizedBy: input.authorizedBy,
    });
  } else {
    if (
      input.currentHead === null ||
      input.currentActive === null ||
      input.receiptRows !== null ||
      input.persistedAttestation !== null
    )
      throw new TypeError("rollback evidence shape is invalid");
    plan = planRollback({
      currentHead: input.currentHead,
      defective: input.currentActive,
      target: input.target,
      switchedAt: input.switchedAt,
      authorizedBy: input.authorizedBy,
    });
  }

  const event = switchHistoryStep(plan);
  const preflightFields = [
    field("preflight_version", "text", SERVING_SWITCH_PREFLIGHT_VERSION),
    field("action", "text", input.action),
    field("environment", "text", proof.environment),
    field(
      "expected_prior_generation",
      "integer",
      String(event.expectedPriorGeneration),
    ),
    nullableCanonical(
      "expected_prior_rollback_candidate_publication_id",
      "identifier",
      input.currentHead?.rollbackCandidatePublicationId ?? null,
    ),
    input.currentHead === null
      ? field("expected_prior_switched_at", "null", "null")
      : field(
          "expected_prior_switched_at",
          "timestamp",
          input.currentHead.switchedAt,
        ),
    field("new_generation", "integer", String(event.newGeneration)),
    nullableCanonical(
      "from_publication_id",
      "identifier",
      event.fromPublicationId,
    ),
    nullableCanonical("from_closure_hash", "digest", event.fromClosureHash),
    field("to_publication_id", "identifier", event.toPublicationId),
    field("to_closure_hash", "digest", event.toClosureHash),
    nullableCanonical("to_attestation_hash", "digest", attestationHash),
    field("switched_at", "timestamp", input.switchedAt),
    field(
      "observed_at",
      "timestamp",
      timestampFromMs(proof.observedAtMs, "switch preflight observation time"),
    ),
    field("maximum_age_ms", "integer", String(proof.maximumAgeMs)),
    field(
      "valid_until",
      "timestamp",
      timestampFromMs(validUntilMs, "switch preflight validity deadline"),
    ),
    field("fts_build_version", "text", proof.ftsBuildVersion),
    field(
      "fts_source_document_count",
      "integer",
      String(proof.ftsSourceDocumentCount),
    ),
    field(
      "fts_index_document_count",
      "integer",
      String(proof.ftsIndexDocumentCount),
    ),
    field("fts_source_inventory_hash", "digest", proof.ftsSourceInventoryHash),
    field("fts_exact_parity", "boolean", String(proof.ftsExactParity)),
    field("archive_bundle_hash", "digest", proof.archiveBundleHash),
    field("archive_immutable", "boolean", String(proof.archiveImmutable)),
    field("vector_namespace", "identifier", proof.vectorNamespace),
    field(
      "vector_document_count",
      "integer",
      String(proof.vectorDocumentCount),
    ),
    field(
      "vector_verified_document_count",
      "integer",
      String(proof.vectorVerifiedDocumentCount),
    ),
    field("vector_inventory_hash", "digest", proof.vectorInventoryHash),
    field(
      "vector_visibility_probe_version",
      "text",
      proof.vectorVisibilityProbeVersion,
    ),
    field("vector_mutation_id", "text", proof.vectorMutationId),
    field(
      "vector_all_ids_present",
      "boolean",
      String(proof.vectorAllIdsPresent),
    ),
    field(
      "vector_all_namespaces_match",
      "boolean",
      String(proof.vectorAllNamespacesMatch),
    ),
    field("vector_queryable", "boolean", String(proof.vectorQueryable)),
    field("probe_set_version", "text", proof.probeSetVersion),
    field("integrity_passed", "boolean", String(proof.integrityPassed)),
    field("exact_search_passed", "boolean", String(proof.exactSearchPassed)),
    field(
      "semantic_search_passed",
      "boolean",
      String(proof.semanticSearchPassed),
    ),
    field(
      "structured_filter_passed",
      "boolean",
      String(proof.structuredFilterPassed),
    ),
    field("neutrality_passed", "boolean", String(proof.neutralityPassed)),
    field(
      "version_isolation_passed",
      "boolean",
      String(proof.versionIsolationPassed),
    ),
  ] as const;
  const preflightHash = await digest(
    "publication-switch-preflight",
    preflightFields,
  );
  const preflight: ServingSwitchPreflightRow = Object.freeze({
    switch_id: event.switchId,
    preflight_version: SERVING_SWITCH_PREFLIGHT_VERSION,
    preflight_hash: preflightHash,
    action: input.action,
    environment: proof.environment,
    expected_prior_generation: event.expectedPriorGeneration,
    expected_prior_rollback_candidate_publication_id:
      input.currentHead?.rollbackCandidatePublicationId ?? null,
    expected_prior_switched_at_ms:
      input.currentHead === null
        ? null
        : assertTimestamp(
            input.currentHead.switchedAt,
            "expected prior switch time",
          ),
    new_generation: event.newGeneration,
    from_publication_id: event.fromPublicationId,
    from_closure_hash: event.fromClosureHash,
    to_publication_id: event.toPublicationId,
    to_closure_hash: event.toClosureHash,
    to_attestation_hash: attestationHash,
    switched_at_ms: switchedAtMs,
    observed_at_ms: proof.observedAtMs,
    maximum_age_ms: proof.maximumAgeMs,
    valid_until_ms: validUntilMs,
    fts_build_version: proof.ftsBuildVersion,
    fts_source_document_count: proof.ftsSourceDocumentCount,
    fts_index_document_count: proof.ftsIndexDocumentCount,
    fts_source_inventory_hash: proof.ftsSourceInventoryHash,
    fts_exact_parity: 1,
    archive_bundle_hash: proof.archiveBundleHash,
    archive_immutable: 1,
    vector_namespace: proof.vectorNamespace,
    vector_document_count: proof.vectorDocumentCount,
    vector_verified_document_count: proof.vectorVerifiedDocumentCount,
    vector_inventory_hash: proof.vectorInventoryHash,
    vector_visibility_probe_version: proof.vectorVisibilityProbeVersion,
    vector_mutation_id: proof.vectorMutationId,
    vector_all_ids_present: 1,
    vector_all_namespaces_match: 1,
    vector_queryable: 1,
    probe_set_version: proof.probeSetVersion,
    integrity_passed: 1,
    exact_search_passed: 1,
    semantic_search_passed: 1,
    structured_filter_passed: 1,
    neutrality_passed: 1,
    version_isolation_passed: 1,
  });
  const eventHash = await digest("publication-switch-event", [
    field("event_version", "text", SERVING_SWITCH_EVENT_VERSION),
    field("switch_id", "text", event.switchId),
    field("preflight_hash", "digest", preflightHash),
    field("action", "text", event.action),
    field(
      "expected_prior_generation",
      "integer",
      String(event.expectedPriorGeneration),
    ),
    nullableCanonical(
      "expected_prior_rollback_candidate_publication_id",
      "identifier",
      input.currentHead?.rollbackCandidatePublicationId ?? null,
    ),
    input.currentHead === null
      ? field("expected_prior_switched_at", "null", "null")
      : field(
          "expected_prior_switched_at",
          "timestamp",
          input.currentHead.switchedAt,
        ),
    field("new_generation", "integer", String(event.newGeneration)),
    nullableCanonical(
      "from_publication_id",
      "identifier",
      event.fromPublicationId,
    ),
    nullableCanonical("from_closure_hash", "digest", event.fromClosureHash),
    field("to_publication_id", "identifier", event.toPublicationId),
    field("to_closure_hash", "digest", event.toClosureHash),
    nullableCanonical("to_attestation_hash", "digest", attestationHash),
    nullableCanonical(
      "resulting_rollback_candidate_publication_id",
      "identifier",
      event.resultingRollbackCandidatePublicationId,
    ),
    field("switched_at", "timestamp", event.switchedAt),
    field("authorized_by_kind", "text", event.authorizedBy.kind),
    field("authorized_identity_id", "text", event.authorizedBy.identityId),
  ]);
  const history: ServingSwitchHistoryRow = Object.freeze({
    switch_id: event.switchId,
    event_version: SERVING_SWITCH_EVENT_VERSION,
    event_hash: eventHash,
    preflight_hash: preflightHash,
    action: event.action,
    expected_prior_generation: event.expectedPriorGeneration,
    expected_prior_rollback_candidate_publication_id:
      input.currentHead?.rollbackCandidatePublicationId ?? null,
    expected_prior_switched_at_ms:
      input.currentHead === null
        ? null
        : assertTimestamp(
            input.currentHead.switchedAt,
            "expected prior switch time",
          ),
    new_generation: event.newGeneration,
    from_publication_id: event.fromPublicationId,
    from_closure_hash: event.fromClosureHash,
    to_publication_id: event.toPublicationId,
    to_closure_hash: event.toClosureHash,
    to_attestation_hash: attestationHash,
    resulting_rollback_candidate_publication_id:
      event.resultingRollbackCandidatePublicationId,
    switched_at_ms: switchedAtMs,
    authorized_by_kind: event.authorizedBy.kind,
    authorized_identity_id: event.authorizedBy.identityId,
  });
  const projection = { plan, preflight, history };
  Object.defineProperty(projection, servingSwitchProjectionBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedServingSwitchProjections.add(projection);
  return Object.freeze(projection) as ServingSwitchProjection;
};

export type ServingSwitchRetryDecision = Readonly<{
  outcome:
    | "execute"
    | "idempotent_success"
    | "stale"
    | "conflict"
    | "integrity_failure";
}>;

const headsEqual = (
  left: StoredPublicationHead | null,
  right: StoredPublicationHead | null,
): boolean =>
  left === null || right === null
    ? left === right
    : left.activePublicationId === right.activePublicationId &&
      left.rollbackCandidatePublicationId ===
        right.rollbackCandidatePublicationId &&
      left.switchedAt === right.switchedAt &&
      left.generation === right.generation;

const rowsExactlyEqual = <Row extends object>(
  left: Row,
  right: Row,
): boolean => {
  const rightKeys = Object.keys(right) as (keyof Row)[];
  return (
    Object.keys(left).length === rightKeys.length &&
    rightKeys.every((key) => left[key] === right[key])
  );
};

export const classifyServingSwitchRetry = (input: {
  readonly expected: ServingSwitchProjection;
  readonly currentHead: StoredPublicationHead | null;
  readonly preflightAtGeneration: ServingSwitchPreflightRow | null;
  readonly historyAtGeneration: ServingSwitchHistoryRow | null;
  readonly targetState: PublicationState;
  readonly formerState: PublicationState | null;
}): ServingSwitchRetryDecision => {
  if (input.currentHead !== null) validateHead(input.currentHead);
  const cas = input.expected.plan.steps.find(
    (
      step,
    ): step is Extract<HeadSwitchStep, { kind: "compare_and_swap_head" }> =>
      step.kind === "compare_and_swap_head",
  );
  if (cas === undefined) throw new TypeError("switch plan lacks its head CAS");
  if (input.historyAtGeneration === null) {
    if (input.preflightAtGeneration !== null)
      return Object.freeze({
        outcome: rowsExactlyEqual(
          input.preflightAtGeneration,
          input.expected.preflight,
        )
          ? "integrity_failure"
          : "conflict",
      });
    if (!headsEqual(input.currentHead, cas.expected))
      return Object.freeze({ outcome: "stale" });
    const expectedTargetState =
      input.expected.history.action === "activate" ? "ready" : "superseded";
    const expectedFormerState =
      input.expected.history.from_publication_id === null ? null : "active";
    if (
      input.targetState !== expectedTargetState ||
      input.formerState !== expectedFormerState
    )
      return Object.freeze({ outcome: "integrity_failure" });
    return Object.freeze({ outcome: "execute" });
  }

  if (!rowsExactlyEqual(input.historyAtGeneration, input.expected.history))
    return Object.freeze({ outcome: "conflict" });
  if (input.preflightAtGeneration === null)
    return Object.freeze({ outcome: "integrity_failure" });
  if (!rowsExactlyEqual(input.preflightAtGeneration, input.expected.preflight))
    return Object.freeze({ outcome: "conflict" });
  const expectedFormerState =
    input.expected.history.from_publication_id === null
      ? null
      : input.expected.history.action === "activate"
        ? "superseded"
        : "rolled_back";
  if (
    !headsEqual(input.currentHead, cas.next) ||
    input.targetState !== "active" ||
    input.formerState !== expectedFormerState
  )
    return Object.freeze({ outcome: "integrity_failure" });
  return Object.freeze({ outcome: "idempotent_success" });
};

export type PublicationSelection =
  | Readonly<{
      outcome: "selected";
      publicationId: PublicationId;
      source: "active" | "pin";
    }>
  | Readonly<{
      outcome: "publication_expired";
      currentPublicationId: PublicationId;
    }>;

export const selectPublication = (input: {
  readonly requestedPublicationId: PublicationId | null;
  readonly head: StoredPublicationHead;
  readonly hotPublications: readonly PublicationRecord[];
}): PublicationSelection => {
  validateHead(input.head);
  for (const publication of input.hotPublications)
    validatePublicationRecord(publication);
  const active = input.hotPublications.find(
    (publication) =>
      publication.publicationId === input.head.activePublicationId &&
      publication.state === "active",
  );
  if (active === undefined)
    throw new TypeError("hot publication inventory omits the active head");
  if (input.requestedPublicationId === null)
    return Object.freeze({
      outcome: "selected",
      publicationId: input.head.activePublicationId,
      source: "active",
    });
  if (!PUBLICATION_ID.test(input.requestedPublicationId))
    throw new TypeError("requested publication ID is invalid");
  const selected = input.hotPublications.find(
    (publication) => publication.publicationId === input.requestedPublicationId,
  );
  if (
    selected === undefined ||
    !(
      selected.state === "active" ||
      selected.state === "superseded" ||
      (selected.state === "rolled_back" &&
        selected.publicationId === input.head.rollbackCandidatePublicationId)
    )
  )
    return Object.freeze({
      outcome: "publication_expired",
      currentPublicationId: input.head.activePublicationId,
    });
  return Object.freeze({
    outcome: "selected",
    publicationId: selected.publicationId,
    source: "pin",
  });
};

export type HotRetentionDecision = Readonly<{
  publicationId: PublicationId;
  action: "retain_hot" | "archive_only_eligible";
  reason:
    | "active"
    | "rollback_candidate"
    | "building"
    | "safety_interval"
    | "expired";
}>;

export const decideHotRetention = (input: {
  readonly now: string;
  readonly head: StoredPublicationHead;
  readonly publications: readonly PublicationRecord[];
  readonly minimumHotMs: number;
  readonly cursorTtlMs: number;
  readonly maximumClockSkewMs: number;
}): readonly HotRetentionDecision[] => {
  const now = assertTimestamp(input.now, "retention time");
  validateHead(input.head);
  for (const [label, value] of [
    ["minimum hot interval", input.minimumHotMs],
    ["cursor TTL", input.cursorTtlMs],
    ["maximum clock skew", input.maximumClockSkewMs],
  ] as const)
    assertSafeInteger(value, 0, label);
  const required = Math.max(
    input.minimumHotMs,
    input.cursorTtlMs + input.maximumClockSkewMs,
  );
  return Object.freeze(
    [...input.publications]
      .sort((left, right) =>
        compareAscii(left.publicationId, right.publicationId),
      )
      .map((publication): HotRetentionDecision => {
        if (publication.publicationId === input.head.activePublicationId)
          return Object.freeze({
            publicationId: publication.publicationId,
            action: "retain_hot",
            reason: "active",
          });
        if (
          publication.publicationId ===
          input.head.rollbackCandidatePublicationId
        )
          return Object.freeze({
            publicationId: publication.publicationId,
            action: "retain_hot",
            reason: "rollback_candidate",
          });
        if (publication.state === "building" || publication.state === "ready")
          return Object.freeze({
            publicationId: publication.publicationId,
            action: "retain_hot",
            reason: "building",
          });
        const reference = publication.lastHeadReferencedAt;
        if (reference === null)
          return Object.freeze({
            publicationId: publication.publicationId,
            action: "retain_hot",
            reason: "safety_interval",
          });
        const age = now - assertTimestamp(reference, "head reference time");
        return age < required
          ? Object.freeze({
              publicationId: publication.publicationId,
              action: "retain_hot",
              reason: "safety_interval",
            })
          : Object.freeze({
              publicationId: publication.publicationId,
              action: "archive_only_eligible",
              reason: "expired",
            });
      }),
  );
};

export type BackupChunk = Readonly<{
  table: string;
  ordinal: number;
  firstKey: string;
  lastKey: string;
  rowCount: number;
  byteCount: number;
  contentHash: Sha256;
}>;
export const SERVING_BACKUP_TABLES = [
  "serving_schema_metadata",
  "publication",
  "publication_provider_slice",
  "publication_provider_slice_metadata",
  "publication_provider_attribution",
  "publication_resource",
  "publication_search_document",
  "publication_vector_inventory",
  "publication_inventory_chunk",
  "publication_closure_seal",
  "publication_readiness_receipt",
  "publication_archive_receipt",
  "publication_serving_receipt",
  "publication_vector_receipt",
  "publication_probe_receipt",
  "publication_readiness_attestation",
  "publication_switch_preflight",
  "publication_switch_history",
  "publication_head",
] as const;
export type ServingBackupTable = (typeof SERVING_BACKUP_TABLES)[number];
export type BackupTableSummary = Readonly<{
  table: string;
  chunkCount: number;
  rowCount: number;
  byteCount: number;
}>;
export type BackupManifest = Readonly<{
  formatVersion: string;
  publicationId: PublicationId;
  closureHash: Sha256;
  canonicalStartBoundary: string;
  canonicalEndBoundary: string;
  writerLeaseDrained: boolean;
  ordinaryTablesOnly: boolean;
  searchDocumentsIncluded: boolean;
  expectedProviderSliceCount: number;
  expectedResourceCount: number;
  expectedSearchDocumentCount: number;
  tables: readonly BackupTableSummary[];
  chunks: readonly BackupChunk[];
  rootHash: Sha256;
}>;

/** Trusted closure facts supplied independently of the backup artifact. */
export type BackupClosureExpectation = Readonly<{
  publicationId: PublicationId;
  closureHash: Sha256;
  providerSliceCount: number;
  resourceCount: number;
  searchDocumentCount: number;
}>;

export const buildBackupRootHash = async (
  manifest: Omit<BackupManifest, "rootHash">,
): Promise<Sha256> => {
  const chunks = [...manifest.chunks].sort((left, right) =>
    compareAscii(
      `${left.table}:${String(left.ordinal).padStart(12, "0")}`,
      `${right.table}:${String(right.ordinal).padStart(12, "0")}`,
    ),
  );
  const chunkRoot = await hashRecords(
    "backup-chunks",
    chunks.map((chunk) => [
      field("table", "text", chunk.table),
      field("ordinal", "integer", String(chunk.ordinal)),
      field("first_key", "text", chunk.firstKey),
      field("last_key", "text", chunk.lastKey),
      field("row_count", "integer", String(chunk.rowCount)),
      field("byte_count", "integer", String(chunk.byteCount)),
      field("content_hash", "digest", chunk.contentHash),
    ]),
  );
  const tableRoot = await hashRecords(
    "backup-tables",
    [...manifest.tables]
      .sort((left, right) => compareAscii(left.table, right.table))
      .map((table) => [
        field("table", "text", table.table),
        field("chunk_count", "integer", String(table.chunkCount)),
        field("row_count", "integer", String(table.rowCount)),
        field("byte_count", "integer", String(table.byteCount)),
      ]),
  );
  return digest("backup-manifest", [
    field("format_version", "text", manifest.formatVersion),
    field("publication_id", "identifier", manifest.publicationId),
    field("closure_hash", "digest", manifest.closureHash),
    field("canonical_start_boundary", "text", manifest.canonicalStartBoundary),
    field("canonical_end_boundary", "text", manifest.canonicalEndBoundary),
    field(
      "writer_lease_drained",
      "boolean",
      String(manifest.writerLeaseDrained),
    ),
    field(
      "ordinary_tables_only",
      "boolean",
      String(manifest.ordinaryTablesOnly),
    ),
    field(
      "search_documents_included",
      "boolean",
      String(manifest.searchDocumentsIncluded),
    ),
    field(
      "expected_provider_slice_count",
      "integer",
      String(manifest.expectedProviderSliceCount),
    ),
    field(
      "expected_resource_count",
      "integer",
      String(manifest.expectedResourceCount),
    ),
    field(
      "expected_search_document_count",
      "integer",
      String(manifest.expectedSearchDocumentCount),
    ),
    field("table_root", "digest", tableRoot),
    field("chunk_root", "digest", chunkRoot),
  ]);
};

export const validateBackupManifest = async (
  manifest: BackupManifest,
  expected: BackupClosureExpectation,
): Promise<readonly string[]> => {
  const errors: string[] = [];
  if (manifest.formatVersion !== "1.0.0")
    errors.push("backup format is unsupported");
  if (!PUBLICATION_ID.test(manifest.publicationId))
    errors.push("backup publication ID is invalid");
  if (!HASH.test(manifest.closureHash) || !HASH.test(manifest.rootHash))
    errors.push("backup root or closure hash is invalid");
  if (
    manifest.publicationId !== expected.publicationId ||
    manifest.closureHash !== expected.closureHash
  )
    errors.push("backup does not match the trusted publication closure");
  if (
    !isNonnegativeSafeInteger(expected.providerSliceCount) ||
    expected.providerSliceCount < 1 ||
    !isNonnegativeSafeInteger(expected.resourceCount) ||
    !isNonnegativeSafeInteger(expected.searchDocumentCount)
  )
    errors.push("trusted backup closure counts are invalid");
  if (
    manifest.expectedProviderSliceCount !== expected.providerSliceCount ||
    manifest.expectedResourceCount !== expected.resourceCount ||
    manifest.expectedSearchDocumentCount !== expected.searchDocumentCount
  )
    errors.push("backup declared counts do not match the trusted closure");
  if (
    typeof manifest.writerLeaseDrained !== "boolean" ||
    typeof manifest.ordinaryTablesOnly !== "boolean" ||
    typeof manifest.searchDocumentsIncluded !== "boolean"
  )
    errors.push("backup Boolean fields are invalid");
  if (
    !isAscii(manifest.canonicalStartBoundary) ||
    manifest.canonicalStartBoundary.length === 0 ||
    manifest.canonicalStartBoundary.length > 256 ||
    !isAscii(manifest.canonicalEndBoundary) ||
    manifest.canonicalEndBoundary.length === 0 ||
    manifest.canonicalEndBoundary.length > 256
  )
    errors.push("canonical backup boundary is invalid");
  if (!manifest.writerLeaseDrained)
    errors.push("canonical writer lease was not drained");
  if (manifest.canonicalStartBoundary !== manifest.canonicalEndBoundary)
    errors.push("canonical backup boundary drifted");
  if (!manifest.ordinaryTablesOnly)
    errors.push("backup includes a non-portable index table");
  if (!manifest.searchDocumentsIncluded)
    errors.push("backup omits search document sources");
  if (
    !isNonnegativeSafeInteger(manifest.expectedProviderSliceCount) ||
    manifest.expectedProviderSliceCount < 1 ||
    !isNonnegativeSafeInteger(manifest.expectedResourceCount) ||
    !isNonnegativeSafeInteger(manifest.expectedSearchDocumentCount)
  )
    errors.push("backup expected closure counts are invalid");
  const tableNames = manifest.tables.map((table) => table.table);
  const requiredTableNames = new Set<string>(SERVING_BACKUP_TABLES);
  if (new Set(tableNames).size !== tableNames.length)
    errors.push("backup table inventory contains a duplicate");
  for (const required of SERVING_BACKUP_TABLES)
    if (!tableNames.includes(required))
      errors.push(`backup table inventory is missing ${required}`);
  for (const table of tableNames)
    if (!requiredTableNames.has(table))
      errors.push(`backup table inventory contains unexpected table ${table}`);
  const byTable = new Map<string, BackupChunk[]>();
  for (const chunk of manifest.chunks) {
    assertAscii(chunk.table, "backup table");
    assertSafeInteger(chunk.ordinal, 0, "backup chunk ordinal");
    assertSafeInteger(chunk.rowCount, 0, "backup row count");
    assertSafeInteger(chunk.byteCount, 0, "backup byte count");
    if (!HASH.test(chunk.contentHash))
      errors.push("backup chunk hash is invalid");
    if (
      !requiredTableNames.has(chunk.table) ||
      !tableNames.includes(chunk.table)
    )
      errors.push(`backup chunk references unexpected table ${chunk.table}`);
    const values = byTable.get(chunk.table) ?? [];
    values.push(chunk);
    byTable.set(chunk.table, values);
  }
  for (const [table, chunks] of byTable) {
    chunks.sort((left, right) => left.ordinal - right.ordinal);
    let previous: string | null = null;
    for (const [index, chunk] of chunks.entries()) {
      if (chunk.ordinal !== index)
        errors.push(`${table} backup chunk ordinals are not contiguous`);
      if (
        !isAscii(chunk.firstKey) ||
        !isAscii(chunk.lastKey) ||
        chunk.firstKey.length === 0 ||
        chunk.lastKey.length === 0 ||
        compareAscii(chunk.firstKey, chunk.lastKey) > 0 ||
        (previous !== null && compareAscii(previous, chunk.firstKey) >= 0)
      )
        errors.push(`${table} backup chunk ranges overlap or are invalid`);
      previous = chunk.lastKey;
    }
  }
  for (const summary of manifest.tables) {
    assertSafeInteger(summary.chunkCount, 0, "backup table chunk count");
    assertSafeInteger(summary.rowCount, 0, "backup table row count");
    assertSafeInteger(summary.byteCount, 0, "backup table byte count");
    const chunks = byTable.get(summary.table) ?? [];
    const rowCount = chunks.reduce((total, chunk) => total + chunk.rowCount, 0);
    const byteCount = chunks.reduce(
      (total, chunk) => total + chunk.byteCount,
      0,
    );
    if (
      chunks.length !== summary.chunkCount ||
      rowCount !== summary.rowCount ||
      byteCount !== summary.byteCount
    )
      errors.push(`${summary.table} backup table totals do not match chunks`);
  }
  const summaries = new Map(
    manifest.tables.map((table) => [table.table, table]),
  );
  if (summaries.get("publication")?.rowCount !== 1)
    errors.push("backup must contain exactly one publication row");
  if (
    summaries.get("publication_provider_slice")?.rowCount !==
    manifest.expectedProviderSliceCount
  )
    errors.push("backup provider-slice count does not match closure");
  if (
    summaries.get("publication_resource")?.rowCount !==
    manifest.expectedResourceCount
  )
    errors.push("backup resource count does not match closure");
  if (
    summaries.get("publication_search_document")?.rowCount !==
    manifest.expectedSearchDocumentCount
  )
    errors.push("backup search-document count does not match closure");
  try {
    if ((await buildBackupRootHash(manifest)) !== manifest.rootHash)
      errors.push("backup root hash does not match immutable content");
  } catch {
    errors.push("backup root hash inputs are invalid");
  }
  return Object.freeze(errors);
};
