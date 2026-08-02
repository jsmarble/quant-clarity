import { FormatRegistry, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  PROVIDER_DISPLAY_NAME_MAX_UNICODE_SCALARS,
  ProviderSchema,
} from "@quant-clarity/contracts";

import {
  EXACT_SEARCH_NORMALIZATION_VERSION,
  EXACT_SEARCH_NORMALIZATION_MAX_UNICODE_SCALAR_EXPANSION,
  normalizeExactSearchName,
} from "./unicode/exact-search-normalization.js";

export {
  EXACT_SEARCH_NORMALIZATION_VERSION,
  EXACT_SEARCH_NORMALIZATION_MAX_UNICODE_SCALAR_EXPANSION,
  normalizeExactSearchName,
} from "./unicode/exact-search-normalization.js";

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

export const PROVIDER_SEARCH_PROJECTION_VERSION = "provider-name@1" as const;
export const PROVIDER_SEARCH_NORMALIZED_NAME_MAX_UNICODE_SCALARS =
  PROVIDER_DISPLAY_NAME_MAX_UNICODE_SCALARS *
  EXACT_SEARCH_NORMALIZATION_MAX_UNICODE_SCALAR_EXPANSION;

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

export type PersistedPublicationManifestInput = Omit<
  PublicationManifestInput,
  "resources" | "searchDocuments"
> &
  Readonly<{
    resources: readonly PersistedResourceDescriptor[];
    searchDocuments: readonly PersistedSearchDocumentDescriptor[];
  }>;

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

const immutablePublicationManifestBrand: unique symbol = Symbol(
  "ImmutablePublicationManifest",
);
const trustedImmutablePublicationManifests = new WeakSet<object>();

export type TrustedImmutablePublicationManifest = ImmutablePublicationManifest &
  Readonly<{ readonly [immutablePublicationManifestBrand]: true }>;

export const assertImmutablePublicationManifest: (
  value: unknown,
) => asserts value is TrustedImmutablePublicationManifest = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(immutablePublicationManifestBrand in value) ||
    value[immutablePublicationManifestBrand] !== true ||
    !trustedImmutablePublicationManifests.has(value)
  )
    throw new TypeError("immutable publication manifest is not trusted");
};

const utf8 = new TextEncoder();

const MAX_MANIFEST_COLLECTION_ITEMS = 500_000;
const MAX_MANIFEST_TOTAL_ITEMS = 1_500_000;
const MAX_MANIFEST_FIELD_UTF8_BYTES = 1_000_000;
const MAX_MANIFEST_TOTAL_UTF8_BYTES = 256 * 1_024 * 1_024;

interface InputBudget {
  bytes: number;
}

const inputRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
};

const boundedInputString = (
  value: unknown,
  label: string,
  budget: InputBudget,
): string => {
  if (typeof value !== "string")
    throw new TypeError(`${label} must be a string`);
  const bytes = utf8.encode(value).length;
  if (bytes > MAX_MANIFEST_FIELD_UTF8_BYTES)
    throw new RangeError(`${label} exceeds the manifest field byte limit`);
  budget.bytes += bytes;
  if (budget.bytes > MAX_MANIFEST_TOTAL_UTF8_BYTES)
    throw new RangeError("manifest input exceeds the aggregate byte limit");
  return value;
};

const manifestCollection = (
  value: unknown,
  label: string,
  itemBudget: { count: number },
): readonly unknown[] => {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length > MAX_MANIFEST_COLLECTION_ITEMS)
    throw new RangeError(`${label} exceeds the manifest item limit`);
  itemBudget.count += value.length;
  if (itemBudget.count > MAX_MANIFEST_TOTAL_ITEMS)
    throw new RangeError("manifest input exceeds the aggregate item limit");
  return value;
};

const snapshotPublicationManifestInput = (
  callerInput: PublicationManifestInput | PersistedPublicationManifestInput,
  persistedContent: boolean,
): PublicationManifestInput | PersistedPublicationManifestInput => {
  const input = inputRecord(callerInput, "manifest input");
  const itemBudget = { count: 0 };
  const bytes = { bytes: 0 };
  const enabledProviderIds = manifestCollection(
    input.enabledProviderIds,
    "enabled provider IDs",
    itemBudget,
  );
  const providerSlices = manifestCollection(
    input.providerSlices,
    "provider slices",
    itemBudget,
  );
  const providerAttributions = manifestCollection(
    input.providerAttributions,
    "provider attributions",
    itemBudget,
  );
  const resources = manifestCollection(
    input.resources,
    "resources",
    itemBudget,
  );
  const searchDocuments = manifestCollection(
    input.searchDocuments,
    "search documents",
    itemBudget,
  );
  const vectors = manifestCollection(input.vectors, "vectors", itemBudget);
  const chunks = manifestCollection(input.chunks, "chunks", itemBudget);
  const versions = inputRecord(input.versions, "manifest versions");

  const snapshot = {
    contractVersion: boundedInputString(
      input.contractVersion,
      "contract version",
      bytes,
    ),
    publicationId: boundedInputString(
      input.publicationId,
      "publication ID",
      bytes,
    ) as PublicationId,
    sourceRunId: boundedInputString(input.sourceRunId, "source run ID", bytes),
    parentPublicationId:
      input.parentPublicationId === null
        ? null
        : (boundedInputString(
            input.parentPublicationId,
            "parent publication ID",
            bytes,
          ) as PublicationId),
    generatedAt: boundedInputString(input.generatedAt, "generated at", bytes),
    versions: {
      schema: boundedInputString(versions.schema, "schema version", bytes),
      methodology: boundedInputString(
        versions.methodology,
        "methodology version",
        bytes,
      ),
      precisionNormalization: boundedInputString(
        versions.precisionNormalization,
        "precision normalization version",
        bytes,
      ),
      precisionDisplayOrder: boundedInputString(
        versions.precisionDisplayOrder,
        "precision display order version",
        bytes,
      ),
      pricePolicy: boundedInputString(
        versions.pricePolicy,
        "price policy version",
        bytes,
      ),
      sourcePolicy: boundedInputString(
        versions.sourcePolicy,
        "source policy version",
        bytes,
      ),
      embedding: boundedInputString(
        versions.embedding,
        "embedding version",
        bytes,
      ),
      buildCommit: boundedInputString(
        versions.buildCommit,
        "build commit",
        bytes,
      ),
    },
    enabledProviderScopeVersion: boundedInputString(
      input.enabledProviderScopeVersion,
      "enabled provider scope version",
      bytes,
    ),
    enabledProviderIds: enabledProviderIds.map((value) =>
      boundedInputString(value, "enabled provider ID", bytes),
    ),
    providerSlices: providerSlices.map((value) => {
      const row = inputRecord(value, "provider slice");
      return {
        providerId: boundedInputString(row.providerId, "provider ID", bytes),
        providerSliceId:
          row.providerSliceId === null
            ? null
            : boundedInputString(
                row.providerSliceId,
                "provider slice ID",
                bytes,
              ),
        providerRunId: boundedInputString(
          row.providerRunId,
          "provider run ID",
          bytes,
        ),
        adapterVersion: boundedInputString(
          row.adapterVersion,
          "adapter version",
          bytes,
        ),
        rosterVersion: boundedInputString(
          row.rosterVersion,
          "roster version",
          bytes,
        ),
        sourceRegisterVersion: boundedInputString(
          row.sourceRegisterVersion,
          "source register version",
          bytes,
        ),
        carriedForward: row.carriedForward as boolean,
        freshnessState: boundedInputString(
          row.freshnessState,
          "freshness state",
          bytes,
        ) as ProviderSliceDescriptor["freshnessState"],
      };
    }),
    providerAttributions: providerAttributions.map((value) => {
      const row = inputRecord(value, "provider attribution");
      return {
        resourceType: boundedInputString(
          row.resourceType,
          "attribution resource type",
          bytes,
        ) as ProviderAttributableResourceType,
        resourceId: boundedInputString(
          row.resourceId,
          "attribution resource ID",
          bytes,
        ),
        providerId: boundedInputString(
          row.providerId,
          "attribution provider ID",
          bytes,
        ),
      };
    }),
    resources: resources.map((value) => {
      const row = inputRecord(value, "resource");
      const descriptor = {
        resourceType: boundedInputString(
          row.resourceType,
          "resource type",
          bytes,
        ) as ResourceType,
        resourceId: boundedInputString(row.resourceId, "resource ID", bytes),
        contentHash: boundedInputString(
          row.contentHash,
          "resource content hash",
          bytes,
        ) as Sha256,
      };
      return persistedContent
        ? {
            ...descriptor,
            resourceJson: boundedInputString(
              row.resourceJson,
              "resource JSON",
              bytes,
            ),
          }
        : descriptor;
    }),
    searchDocuments: searchDocuments.map((value) => {
      const row = inputRecord(value, "search document");
      const descriptor = {
        resourceType: boundedInputString(
          row.resourceType,
          "search resource type",
          bytes,
        ) as SearchResourceType,
        resourceId: boundedInputString(
          row.resourceId,
          "search resource ID",
          bytes,
        ),
        documentId: boundedInputString(
          row.documentId,
          "search document ID",
          bytes,
        ),
        contentHash: boundedInputString(
          row.contentHash,
          "search document content hash",
          bytes,
        ) as Sha256,
      };
      return persistedContent
        ? {
            ...descriptor,
            normalizedName: boundedInputString(
              row.normalizedName,
              "normalized name",
              bytes,
            ),
            aliasesJson: boundedInputString(
              row.aliasesJson,
              "aliases JSON",
              bytes,
            ),
            publisherName: boundedInputString(
              row.publisherName,
              "publisher name",
              bytes,
            ),
            providerModelIdsJson: boundedInputString(
              row.providerModelIdsJson,
              "provider model IDs JSON",
              bytes,
            ),
            documentText: boundedInputString(
              row.documentText,
              "search document text",
              bytes,
            ),
          }
        : descriptor;
    }),
    vectors: vectors.map((value) => {
      const row = inputRecord(value, "vector");
      return {
        resourceType: boundedInputString(
          row.resourceType,
          "vector resource type",
          bytes,
        ) as SearchResourceType,
        resourceId: boundedInputString(
          row.resourceId,
          "vector resource ID",
          bytes,
        ),
        vectorId: boundedInputString(row.vectorId, "vector ID", bytes),
        searchDocumentContentHash: boundedInputString(
          row.searchDocumentContentHash,
          "vector search document content hash",
          bytes,
        ) as Sha256,
        embeddingInputHash: boundedInputString(
          row.embeddingInputHash,
          "embedding input hash",
          bytes,
        ) as Sha256,
      };
    }),
    chunks: chunks.map((value) => {
      const row = inputRecord(value, "chunk");
      return {
        kind: boundedInputString(row.kind, "chunk kind", bytes) as ChunkKind,
        ordinal: row.ordinal as number,
        firstKey: boundedInputString(row.firstKey, "chunk first key", bytes),
        lastKey: boundedInputString(row.lastKey, "chunk last key", bytes),
        itemCount: row.itemCount as number,
        contentHash: boundedInputString(
          row.contentHash,
          "chunk content hash",
          bytes,
        ) as Sha256,
      };
    }),
    bundleHash: boundedInputString(
      input.bundleHash,
      "bundle hash",
      bytes,
    ) as Sha256,
  };
  return snapshot;
};

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

const isContractTimestamp = (value: string): boolean => {
  try {
    assertTimestamp(value, "contract timestamp");
    return true;
  } catch {
    return false;
  }
};

type ProviderResource = Static<typeof ProviderSchema>;

const checkProviderContract = (value: unknown): value is ProviderResource => {
  let validationCandidate = value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const provider = value as Record<string, unknown>;
    const displayName = provider.display_name;
    if (
      typeof displayName === "object" &&
      displayName !== null &&
      !Array.isArray(displayName)
    ) {
      const displayFact = displayName as Record<string, unknown>;
      if (displayFact.state === "known") {
        if (typeof displayFact.value !== "string") return false;
        const scalarLength = Array.from(displayFact.value).length;
        if (scalarLength > PROVIDER_DISPLAY_NAME_MAX_UNICODE_SCALARS)
          return false;
        // TypeBox Value.Check currently applies JSON Schema maxLength with
        // JavaScript UTF-16 code units. Substitute only this already-bounded
        // unconstrained string value so TypeBox still validates the complete
        // ProviderSchema shape, all provenance, and every other field.
        if (
          displayFact.value.length > PROVIDER_DISPLAY_NAME_MAX_UNICODE_SCALARS
        )
          validationCandidate = {
            ...provider,
            display_name: {
              ...displayFact,
              value: "x".repeat(scalarLength),
            },
          };
      }
    }
  }
  const previousDateTime = FormatRegistry.Get("date-time");
  FormatRegistry.Set("date-time", isContractTimestamp);
  try {
    return Value.Check(ProviderSchema, validationCandidate);
  } finally {
    if (previousDateTime === undefined) FormatRegistry.Delete("date-time");
    else FormatRegistry.Set("date-time", previousDateTime);
  }
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

// ADR 0021 dormant v2 proof primitives. Existing schema-1.4 adapters accept
// neither nominal type; migration 0007 must add durable wiring atomically.
export const READINESS_RECEIPT_VERSION_V2 = "2.0.0" as const;
export const READINESS_EVALUATOR_VERSION_V2 = "2.0.0" as const;
export const READINESS_PROBE_SET_VERSION_V2 = "search-gold@2" as const;
export const PROVIDER_SEARCH_FTS_BUILD_VERSION =
  "provider-name-fts5-unicode61@1" as const;
export const SERVING_SWITCH_PREFLIGHT_VERSION_V2 = "2.0.0" as const;

export interface ProviderSearchFtsObservationV2 {
  readonly buildVersion: typeof PROVIDER_SEARCH_FTS_BUILD_VERSION;
  readonly documentCount: number;
  readonly queryable: boolean;
  readonly exactParity: boolean;
}

const providerSearchArtifactProofV2Brand: unique symbol = Symbol(
  "ProviderSearchArtifactProofV2",
);

export type ProviderSearchArtifactProofV2 = Readonly<{
  provider_search_projection_version: typeof PROVIDER_SEARCH_PROJECTION_VERSION;
  provider_search_document_count: number;
  provider_search_inventory_hash: Sha256;
  provider_search_fts_build_version: typeof PROVIDER_SEARCH_FTS_BUILD_VERSION;
  provider_search_fts_document_count: number;
  provider_search_fts_queryable: true;
  provider_search_exact_parity: true;
  readonly [providerSearchArtifactProofV2Brand]: true;
}>;

interface ProviderSearchArtifactProofBindingV2 {
  readonly manifest: TrustedImmutablePublicationManifest;
  readonly projection: TrustedProviderSearchProjection;
}

const trustedProviderSearchArtifactProofsV2 = new WeakMap<
  object,
  ProviderSearchArtifactProofBindingV2
>();

export const assertProviderSearchArtifactProofV2: (
  value: unknown,
) => asserts value is ProviderSearchArtifactProofV2 = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(providerSearchArtifactProofV2Brand in value) ||
    value[providerSearchArtifactProofV2Brand] !== true ||
    !trustedProviderSearchArtifactProofsV2.has(value)
  )
    throw new TypeError("provider search artifact proof v2 is not trusted");
};

export const projectProviderSearchArtifactProofV2 = (input: {
  readonly manifest: TrustedImmutablePublicationManifest;
  readonly projection: TrustedProviderSearchProjection;
  readonly fts: ProviderSearchFtsObservationV2;
}): ProviderSearchArtifactProofV2 => {
  assertImmutablePublicationManifest(input.manifest);
  assertProviderSearchProjection(input.projection);
  const ftsRecord = inputRecord(input.fts, "provider search FTS observation");
  if (
    !hasExactKeys(ftsRecord, [
      "buildVersion",
      "documentCount",
      "queryable",
      "exactParity",
    ])
  )
    throw new TypeError("provider search FTS observation shape is invalid");
  const fts = {
    buildVersion: ftsRecord.buildVersion,
    documentCount: ftsRecord.documentCount,
    queryable: ftsRecord.queryable,
    exactParity: ftsRecord.exactParity,
  };
  if (
    input.projection.publicationId !== input.manifest.publicationId ||
    input.projection.closureHash !== input.manifest.closureHash ||
    input.projection.documentCount !== input.projection.documents.length ||
    !HASH.test(input.projection.inventoryHash) ||
    fts.buildVersion !== PROVIDER_SEARCH_FTS_BUILD_VERSION ||
    !isNonnegativeSafeInteger(fts.documentCount) ||
    fts.documentCount !== input.projection.documentCount ||
    fts.queryable !== true ||
    fts.exactParity !== true
  )
    throw new TypeError(
      "provider search artifact proof does not match the trusted projection",
    );
  const proof = {
    provider_search_projection_version: input.projection.projectionVersion,
    provider_search_document_count: input.projection.documentCount,
    provider_search_inventory_hash: input.projection.inventoryHash,
    provider_search_fts_build_version: PROVIDER_SEARCH_FTS_BUILD_VERSION,
    provider_search_fts_document_count: input.projection.documentCount,
    provider_search_fts_queryable: true as const,
    provider_search_exact_parity: true as const,
  };
  Object.defineProperty(proof, providerSearchArtifactProofV2Brand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedProviderSearchArtifactProofsV2.set(
    proof,
    Object.freeze({
      manifest: input.manifest,
      projection: input.projection,
    }),
  );
  return Object.freeze(proof) as ProviderSearchArtifactProofV2;
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
  callerInput: PublicationManifestInput,
): Promise<TrustedImmutablePublicationManifest> => {
  const input = snapshotPublicationManifestInput(callerInput, false);
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
  const manifest = {
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
  };
  Object.defineProperty(manifest, immutablePublicationManifestBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedImmutablePublicationManifests.add(manifest);
  return Object.freeze(manifest) as TrustedImmutablePublicationManifest;
};

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

export type ProviderSearchDocumentProjection = Readonly<{
  projectionVersion: typeof PROVIDER_SEARCH_PROJECTION_VERSION;
  providerId: string;
  displayName: string;
  normalizedName: string;
  providerResourceContentHash: Sha256;
}>;

export type ProviderSearchProjectionInput = Readonly<{
  manifest: TrustedImmutablePublicationManifest;
  providerResources: readonly ServingResourceClosureRow[];
}>;

const providerSearchProjectionBrand: unique symbol = Symbol(
  "ProviderSearchProjection",
);
const trustedProviderSearchProjections = new WeakSet<object>();

export type TrustedProviderSearchProjection = Readonly<{
  publicationId: PublicationId;
  closureHash: Sha256;
  projectionVersion: typeof PROVIDER_SEARCH_PROJECTION_VERSION;
  normalizationVersion: typeof EXACT_SEARCH_NORMALIZATION_VERSION;
  documents: readonly ProviderSearchDocumentProjection[];
  documentCount: number;
  inventoryHash: Sha256;
  readonly [providerSearchProjectionBrand]: true;
}>;

export const assertProviderSearchProjection: (
  value: unknown,
) => asserts value is TrustedProviderSearchProjection = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(providerSearchProjectionBrand in value) ||
    value[providerSearchProjectionBrand] !== true ||
    !trustedProviderSearchProjections.has(value)
  )
    throw new TypeError("provider search projection is not trusted");
};

const providerSearchInventoryHash = async (
  documents: readonly ProviderSearchDocumentProjection[],
): Promise<Sha256> => {
  const root = canonicalTuple("publication-provider-search-inventory", [
    field("provider_search_documents", "list", String(documents.length)),
  ]);
  const rows = documents.map((document) =>
    canonicalTuple("publication-provider-search-document", [
      field("projection_version", "text", document.projectionVersion),
      field("provider_id", "identifier", document.providerId),
      field("display_name", "text", document.displayName),
      field("normalized_name", "text", document.normalizedName),
      field(
        "provider_resource_content_hash",
        "digest",
        document.providerResourceContentHash,
      ),
    ]),
  );
  return digestBytes(
    concatenate([root, ...rows.map((row) => lengthPrefixed([row]))]),
  );
};

/**
 * Recomputes the provider-name exact-search projection from persisted,
 * closure-shaped canonical rows. The nominal result is the only shape a D1
 * writer may accept; caller-supplied rows and hashes never cross that boundary.
 */
export const projectProviderSearchProjection = async (
  callerInput: ProviderSearchProjectionInput,
): Promise<TrustedProviderSearchProjection> => {
  assertImmutablePublicationManifest(callerInput.manifest);
  if (!Array.isArray(callerInput.providerResources))
    throw new TypeError("provider search resources must be an array");
  if (callerInput.providerResources.length > 1_000)
    throw new RangeError(
      "provider search resource input is invalid or too large",
    );
  const manifest = callerInput.manifest;
  let providerResourceBytes = 0;
  const providerResources = callerInput.providerResources.map((value) => {
    const resource = inputRecord(value, "provider search resource");
    const resourceType = resource.resource_type;
    const resourceId = resource.resource_id;
    const resourceJson = resource.resource_json;
    const contentHash = resource.content_hash;
    if (
      resourceType !== "provider" ||
      typeof resourceId !== "string" ||
      !new RegExp(`^prv_${UUID_V4}$`, "u").test(resourceId) ||
      typeof contentHash !== "string" ||
      !HASH.test(contentHash) ||
      typeof resourceJson !== "string"
    )
      throw new TypeError("provider search resource input is invalid");
    const resourceJsonBytes = utf8.encode(resourceJson).length;
    if (resourceJsonBytes > 1_000_000)
      throw new RangeError("provider search resource input is too large");
    providerResourceBytes += resourceJsonBytes;
    if (providerResourceBytes > 16 * 1_024 * 1_024)
      throw new RangeError("provider search resource input is too large");
    return {
      resource_type: resourceType,
      resource_id: resourceId,
      resource_json: resourceJson,
      content_hash: contentHash,
    } satisfies ServingResourceClosureRow;
  });
  if (manifest.providerSlices.length === 0)
    throw new RangeError("provider search slice inventory is empty");

  const slices = new Map<string, ServingProviderSliceClosureRow>();
  for (const descriptor of manifest.providerSlices) {
    if (slices.has(descriptor.providerId))
      throw new TypeError(
        "provider search slice inventory contains a duplicate",
      );
    const slice: ServingProviderSliceClosureRow = {
      provider_id: descriptor.providerId,
      provider_slice_id: descriptor.providerSliceId,
      provider_run_id: descriptor.providerRunId,
      adapter_version: descriptor.adapterVersion,
      roster_version: descriptor.rosterVersion,
      source_register_version: descriptor.sourceRegisterVersion,
      carried_forward: descriptor.carriedForward ? 1 : 0,
      freshness_state: descriptor.freshnessState,
    };
    const selected = descriptor.freshnessState !== "unavailable";
    if (
      selected !== (descriptor.providerSliceId !== null) ||
      (descriptor.freshnessState === "fresh" && descriptor.carriedForward) ||
      (descriptor.freshnessState === "stale" && !descriptor.carriedForward) ||
      (descriptor.freshnessState === "unavailable" && descriptor.carriedForward)
    )
      throw new TypeError("provider search slice disposition is invalid");
    slices.set(descriptor.providerId, slice);
  }

  const expectedProviderResources = manifest.resources.filter(
    (resource) => resource.resourceType === "provider",
  );
  if (
    new Set(providerResources.map((resource) => resource.resource_id)).size !==
    providerResources.length
  )
    throw new TypeError("provider search resources contain a duplicate");

  const providerAttributions = manifest.providerAttributions.filter(
    (attribution) => attribution.resourceType === "provider",
  );
  if (
    new Set(providerAttributions.map((attribution) => attribution.resourceId))
      .size !== providerAttributions.length
  )
    throw new TypeError("provider search attributions contain a duplicate");
  const attributions = new Map(
    providerAttributions.map((attribution) => [
      attribution.resourceId,
      attribution,
    ]),
  );

  const expectedResourceById = new Map(
    expectedProviderResources.map((resource) => [
      resource.resourceId,
      resource,
    ]),
  );
  if (providerResources.length !== expectedResourceById.size)
    throw new TypeError(
      "provider search resources do not exactly match the trusted manifest",
    );
  for (const resource of providerResources) {
    const expected = expectedResourceById.get(resource.resource_id);
    if (expected?.contentHash !== resource.content_hash)
      throw new TypeError(
        "provider search resource does not match the trusted manifest",
      );
  }

  const documents: ProviderSearchDocumentProjection[] = [];
  const resourceIds = new Set(providerResources.map((row) => row.resource_id));
  for (const slice of slices.values()) {
    const resource = providerResources.find(
      (candidate) => candidate.resource_id === slice.provider_id,
    );
    if (slice.freshness_state === "unavailable") {
      if (resource !== undefined || attributions.has(slice.provider_id))
        throw new TypeError(
          "unavailable provider has public provider search content",
        );
      continue;
    }
    if (resource === undefined)
      throw new TypeError("selected provider lacks its provider resource");
    const attribution = attributions.get(slice.provider_id);
    if (
      attribution?.providerId !== slice.provider_id ||
      attribution.resourceId !== slice.provider_id
    )
      throw new TypeError("provider search resource attribution is invalid");
    if (!HASH.test(resource.content_hash))
      throw new TypeError("provider search resource hash is invalid");
    const computedHash = await hashPublicationResourceContent({
      resourceType: "provider",
      resourceId: resource.resource_id,
      resourceJson: resource.resource_json,
    });
    if (computedHash !== resource.content_hash)
      throw new TypeError(
        "provider search resource content hash does not match",
      );
    const parsed: unknown = JSON.parse(resource.resource_json);
    if (!checkProviderContract(parsed))
      throw new TypeError("provider search resource is not contract-valid");
    if (parsed.provider_id !== slice.provider_id)
      throw new TypeError("provider search resource identity does not match");
    if (parsed.display_name.state !== "known") continue;
    const displayName = parsed.display_name.value;
    const normalizedName = normalizeExactSearchName(displayName);
    const normalizedNameCodePoints = Array.from(normalizedName).length;
    if (
      normalizedNameCodePoints >
      PROVIDER_SEARCH_NORMALIZED_NAME_MAX_UNICODE_SCALARS
    )
      throw new Error(
        "provider search normalization exceeds its pinned Unicode bound",
      );
    documents.push(
      Object.freeze({
        projectionVersion: PROVIDER_SEARCH_PROJECTION_VERSION,
        providerId: slice.provider_id,
        displayName,
        normalizedName,
        providerResourceContentHash: computedHash,
      }),
    );
  }

  for (const resourceId of resourceIds)
    if (!slices.has(resourceId))
      throw new TypeError("provider search resource is outside provider scope");
  for (const resourceId of attributions.keys())
    if (!resourceIds.has(resourceId))
      throw new TypeError("provider search attribution lacks its resource");

  documents.sort((left, right) =>
    compareAscii(left.providerId, right.providerId),
  );
  const inventoryHash = await providerSearchInventoryHash(documents);
  const projection = {
    publicationId: manifest.publicationId,
    closureHash: manifest.closureHash,
    projectionVersion: PROVIDER_SEARCH_PROJECTION_VERSION,
    normalizationVersion: EXACT_SEARCH_NORMALIZATION_VERSION,
    documents: Object.freeze(documents),
    documentCount: documents.length,
    inventoryHash,
  };
  Object.defineProperty(projection, providerSearchProjectionBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedProviderSearchProjections.add(projection);
  return Object.freeze(projection) as TrustedProviderSearchProjection;
};

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
  callerInput: PersistedPublicationManifestInput,
): Promise<TrustedImmutablePublicationManifest> => {
  const input = snapshotPublicationManifestInput(
    callerInput,
    true,
  ) as PersistedPublicationManifestInput;
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
    manifest: TrustedImmutablePublicationManifest;
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
  receiptVersion = "1.0.0",
  servingSuffix: readonly CanonicalField[] = [],
): Promise<Sha256> => {
  const common: CanonicalField[] = [
    field("receipt_version", "text", receiptVersion),
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
  return digest("publication-readiness-receipt", [
    ...common,
    ...specific,
    ...(receipt.kind === "serving" ? servingSuffix : []),
  ]);
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

const providerSearchProofFieldsV2 = (
  proof: ProviderSearchArtifactProofV2,
): readonly CanonicalField[] => [
  field(
    "provider_search_projection_version",
    "text",
    proof.provider_search_projection_version,
  ),
  field(
    "provider_search_document_count",
    "integer",
    String(proof.provider_search_document_count),
  ),
  field(
    "provider_search_inventory_hash",
    "digest",
    proof.provider_search_inventory_hash,
  ),
  field(
    "provider_search_fts_build_version",
    "text",
    proof.provider_search_fts_build_version,
  ),
  field(
    "provider_search_fts_document_count",
    "integer",
    String(proof.provider_search_fts_document_count),
  ),
  field(
    "provider_search_fts_queryable",
    "boolean",
    String(proof.provider_search_fts_queryable),
  ),
  field(
    "provider_search_exact_parity",
    "boolean",
    String(proof.provider_search_exact_parity),
  ),
];

const readinessReceiptProofV2Brand: unique symbol = Symbol(
  "ReadinessReceiptProofV2",
);

export type ReadinessReceiptProofV2 = Readonly<{
  kind: ReadinessReceipt["kind"];
  receipt_version: typeof READINESS_RECEIPT_VERSION_V2;
  receipt_hash: Sha256;
  publication_id: PublicationId;
  environment: Exclude<PublicationEnvironment, "test">;
  closure_hash: Sha256;
  bundle_hash: Sha256;
  observed_at_ms: number;
  readonly [readinessReceiptProofV2Brand]: true;
}>;

interface ReadinessReceiptProofV2Binding {
  readonly receipt: ReadinessReceipt;
  readonly providerProof: ProviderSearchArtifactProofV2 | null;
}

const trustedReadinessReceiptProofsV2 = new WeakMap<
  object,
  ReadinessReceiptProofV2Binding
>();

export const assertReadinessReceiptProofV2: (
  value: unknown,
) => asserts value is ReadinessReceiptProofV2 = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(readinessReceiptProofV2Brand in value) ||
    value[readinessReceiptProofV2Brand] !== true ||
    !trustedReadinessReceiptProofsV2.has(value)
  )
    throw new TypeError("readiness receipt proof v2 is not trusted");
};

const snapshotReadinessReceipt = (value: unknown): ReadinessReceipt => {
  const receipt = inputRecord(value, "readiness receipt v2");
  const kind = receipt.kind;
  if (
    kind !== "archive" &&
    kind !== "serving" &&
    kind !== "vectors" &&
    kind !== "probes"
  )
    throw new TypeError("readiness receipt v2 kind is invalid");
  const keysByKind = {
    archive: [
      "kind",
      "binding",
      "observedAt",
      "retainedBundleHash",
      "immutable",
    ],
    serving: [
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
    ],
    vectors: [
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
    ],
    probes: [
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
    ],
  } as const;
  if (!hasExactKeys(receipt, keysByKind[kind]))
    throw new TypeError("readiness receipt v2 shape is invalid");
  const rawBinding = inputRecord(
    receipt.binding,
    "readiness receipt v2 binding",
  );
  if (
    !hasExactKeys(rawBinding, [
      "environment",
      "publicationId",
      "closureHash",
      "bundleHash",
      "schemaVersion",
      "buildCommit",
    ])
  )
    throw new TypeError("readiness receipt v2 binding shape is invalid");
  const binding = Object.freeze({
    environment: rawBinding.environment,
    publicationId: rawBinding.publicationId,
    closureHash: rawBinding.closureHash,
    bundleHash: rawBinding.bundleHash,
    schemaVersion: rawBinding.schemaVersion,
    buildCommit: rawBinding.buildCommit,
  }) as ArtifactBinding;
  const common = {
    kind,
    binding,
    observedAt: receipt.observedAt,
  } as const;
  let snapshot: ReadinessReceipt;
  switch (kind) {
    case "archive":
      snapshot = Object.freeze({
        ...common,
        kind,
        retainedBundleHash: receipt.retainedBundleHash,
        immutable: receipt.immutable,
      }) as ArchiveReceipt;
      break;
    case "serving":
      snapshot = Object.freeze({
        ...common,
        kind,
        enabledProviderCount: receipt.enabledProviderCount,
        enabledProviderScopeHash: receipt.enabledProviderScopeHash,
        providerSliceCount: receipt.providerSliceCount,
        providerSliceHash: receipt.providerSliceHash,
        providerAttributionCount: receipt.providerAttributionCount,
        providerAttributionHash: receipt.providerAttributionHash,
        resourceCount: receipt.resourceCount,
        exactDocumentCount: receipt.exactDocumentCount,
        resourceInventoryHash: receipt.resourceInventoryHash,
        exactSearchInventoryHash: receipt.exactSearchInventoryHash,
        ftsBuildVersion: receipt.ftsBuildVersion,
        ftsDocumentCount: receipt.ftsDocumentCount,
        ftsQueryable: receipt.ftsQueryable,
        foreignKeysValid: receipt.foreignKeysValid,
        contentHashesValid: receipt.contentHashesValid,
        unavailableProviderIsolationValid:
          receipt.unavailableProviderIsolationValid,
      }) as ServingReceipt;
      break;
    case "vectors":
      snapshot = Object.freeze({
        ...common,
        kind,
        namespace: receipt.namespace,
        documentCount: receipt.documentCount,
        verifiedDocumentCount: receipt.verifiedDocumentCount,
        vectorInventoryHash: receipt.vectorInventoryHash,
        visibilityProbeVersion: receipt.visibilityProbeVersion,
        mutationId: receipt.mutationId,
        allIdsPresent: receipt.allIdsPresent,
        allNamespacesMatch: receipt.allNamespacesMatch,
        queryable: receipt.queryable,
      }) as VectorReceipt;
      break;
    case "probes":
      snapshot = Object.freeze({
        ...common,
        kind,
        probeSetVersion: receipt.probeSetVersion,
        integrityPassed: receipt.integrityPassed,
        evidenceCoveragePassed: receipt.evidenceCoveragePassed,
        exactSearchPassed: receipt.exactSearchPassed,
        semanticSearchPassed: receipt.semanticSearchPassed,
        structuredFilterPassed: receipt.structuredFilterPassed,
        neutralityPassed: receipt.neutralityPassed,
        versionIsolationPassed: receipt.versionIsolationPassed,
      }) as ProbeReceipt;
      break;
  }
  if (!validateReceiptShape(snapshot))
    throw new TypeError("readiness receipt v2 shape is invalid");
  return snapshot;
};

export const projectReadinessReceiptProofV2 = async (input: {
  readonly receipt: ReadinessReceipt;
  readonly providerProof: ProviderSearchArtifactProofV2 | null;
}): Promise<ReadinessReceiptProofV2> => {
  const providerProof = input.providerProof;
  const receipt = snapshotReadinessReceipt(input.receipt);
  if (!SERVING_PUBLICATION_ENVIRONMENTS.has(receipt.binding.environment))
    throw new TypeError("readiness receipt v2 environment is invalid");
  let providerFields: readonly CanonicalField[] = [];
  if (receipt.kind === "serving") {
    assertProviderSearchArtifactProofV2(providerProof);
    const providerBinding =
      trustedProviderSearchArtifactProofsV2.get(providerProof);
    if (providerBinding === undefined)
      throw new TypeError("provider search artifact proof v2 is not trusted");
    const manifest = providerBinding.manifest;
    if (
      receipt.binding.publicationId !== manifest.publicationId ||
      receipt.binding.closureHash !== manifest.closureHash ||
      receipt.enabledProviderCount !== manifest.enabledProviderIds.length ||
      receipt.providerSliceCount !== manifest.providerSlices.length ||
      receipt.providerAttributionCount !==
        manifest.providerAttributions.length ||
      receipt.resourceCount !== manifest.resources.length ||
      receipt.exactDocumentCount !== manifest.searchDocuments.length ||
      receipt.resourceInventoryHash !== manifest.resourceInventoryHash ||
      receipt.exactSearchInventoryHash !== manifest.exactSearchInventoryHash
    )
      throw new TypeError(
        "serving receipt v2 does not bind the trusted publication",
      );
    providerFields = providerSearchProofFieldsV2(providerProof);
  } else if (providerProof !== null) {
    throw new TypeError("non-serving receipt v2 carries provider proof");
  }
  if (
    receipt.kind === "probes" &&
    receipt.probeSetVersion !== READINESS_PROBE_SET_VERSION_V2
  )
    throw new TypeError("readiness receipt v2 probe set is invalid");
  const receiptHash = await readinessReceiptHash(
    receipt,
    READINESS_RECEIPT_VERSION_V2,
    providerFields,
  );
  const proof = {
    kind: receipt.kind,
    receipt_version: READINESS_RECEIPT_VERSION_V2,
    receipt_hash: receiptHash,
    publication_id: receipt.binding.publicationId,
    environment: receipt.binding.environment as Exclude<
      PublicationEnvironment,
      "test"
    >,
    closure_hash: receipt.binding.closureHash,
    bundle_hash: receipt.binding.bundleHash,
    observed_at_ms: assertTimestamp(
      receipt.observedAt,
      "readiness receipt v2 observation time",
    ),
  };
  Object.defineProperty(proof, readinessReceiptProofV2Brand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedReadinessReceiptProofsV2.set(
    proof,
    Object.freeze({
      receipt,
      providerProof,
    }),
  );
  return Object.freeze(proof) as ReadinessReceiptProofV2;
};

export type ServingReadinessAttestationProjectionV2 = Readonly<{
  publication_id: PublicationId;
  environment: Exclude<PublicationEnvironment, "test">;
  closure_hash: Sha256;
  bundle_hash: Sha256;
  evaluator_version: typeof READINESS_EVALUATOR_VERSION_V2;
  ready_at_ms: number;
  maximum_receipt_age_ms: number;
  effective_valid_until_ms: number;
  archive_observed_at_ms: number;
  serving_observed_at_ms: number;
  vector_observed_at_ms: number;
  probes_observed_at_ms: number;
  archive_receipt_hash: Sha256;
  serving_receipt_hash: Sha256;
  vector_receipt_hash: Sha256;
  probes_receipt_hash: Sha256;
  attestation_hash: Sha256;
}>;

const servingReadinessProofV2Brand: unique symbol = Symbol(
  "ServingReadinessProofV2",
);
const trustedServingReadinessProofsV2 = new WeakSet<object>();

export type ServingReadinessProofV2 = Readonly<{
  receipts: readonly ReadinessReceiptProofV2[];
  attestation: ServingReadinessAttestationProjectionV2;
  readonly [servingReadinessProofV2Brand]: true;
}>;

export const assertServingReadinessProofV2: (
  value: unknown,
) => asserts value is ServingReadinessProofV2 = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(servingReadinessProofV2Brand in value) ||
    value[servingReadinessProofV2Brand] !== true ||
    !trustedServingReadinessProofsV2.has(value)
  )
    throw new TypeError("serving readiness proof v2 is not trusted");
};

export const projectServingReadinessProofV2 = async (input: {
  readonly manifest: TrustedImmutablePublicationManifest;
  readonly receiptProofs: readonly ReadinessReceiptProofV2[];
  readonly environment: Exclude<PublicationEnvironment, "test">;
  readonly readyAtMs: number;
  readonly maximumReceiptAgeMs: number;
}): Promise<ServingReadinessProofV2> => {
  const manifest = input.manifest;
  const candidateReceiptProofs = input.receiptProofs;
  const environment = input.environment;
  const readyAtMs = input.readyAtMs;
  const maximumReceiptAgeMs = input.maximumReceiptAgeMs;
  assertImmutablePublicationManifest(manifest);
  if (
    !Array.isArray(candidateReceiptProofs) ||
    candidateReceiptProofs.length !== 4 ||
    !SERVING_PUBLICATION_ENVIRONMENTS.has(environment)
  )
    throw new TypeError("serving readiness proof v2 input is invalid");
  const receiptProofs: ReadinessReceiptProofV2[] = [];
  for (const candidate of candidateReceiptProofs as readonly unknown[]) {
    assertReadinessReceiptProofV2(candidate);
    receiptProofs.push(candidate);
  }
  const byKind = new Map(
    receiptProofs.map((proof) => [proof.kind, proof] as const),
  );
  if (byKind.size !== 4)
    throw new TypeError("serving readiness proof v2 receipt set is incomplete");
  const requireProof = (
    kind: ReadinessReceipt["kind"],
  ): ReadinessReceiptProofV2 => {
    const proof = byKind.get(kind);
    if (proof === undefined)
      throw new TypeError(`readiness receipt v2 ${kind} is missing`);
    return proof;
  };
  const archive = requireProof("archive");
  const serving = requireProof("serving");
  const vectors = requireProof("vectors");
  const probes = requireProof("probes");
  if (
    receiptProofs.some(
      (proof) =>
        proof.publication_id !== manifest.publicationId ||
        proof.closure_hash !== manifest.closureHash ||
        proof.bundle_hash !== manifest.bundleHash ||
        proof.environment !== environment,
    )
  )
    throw new TypeError("readiness receipt v2 bindings do not match");
  const servingBinding = trustedReadinessReceiptProofsV2.get(serving);
  if (servingBinding === undefined)
    throw new TypeError("serving readiness receipt proof v2 is not trusted");
  if (servingBinding.providerProof === null)
    throw new TypeError("serving readiness proof v2 lacks provider evidence");
  const providerManifest = trustedProviderSearchArtifactProofsV2.get(
    servingBinding.providerProof,
  )?.manifest;
  if (
    providerManifest?.publicationId !== manifest.publicationId ||
    providerManifest.closureHash !== manifest.closureHash
  )
    throw new TypeError("serving readiness proof v2 uses another manifest");
  const receipts = receiptProofs.map((proof) => {
    const binding = trustedReadinessReceiptProofsV2.get(proof);
    if (binding === undefined)
      throw new TypeError("readiness receipt proof v2 is not trusted");
    return binding.receipt;
  });
  const evaluationReceipts = receipts.map((receipt): ReadinessReceipt =>
    receipt.kind === "probes"
      ? { ...receipt, probeSetVersion: READINESS_PROBE_SET_VERSION }
      : receipt,
  );
  const readyAt = timestampFromMs(readyAtMs, "readiness v2 time");
  const decision = await evaluateReadiness({
    manifest,
    receipts: evaluationReceipts,
    environment,
    now: readyAt,
    maximumReceiptAgeMs,
  });
  if (decision.decision === "blocked")
    throw new TypeError(
      `serving readiness proof v2 is blocked: ${decision.failureCodes.join(",")}`,
    );
  const effectiveValidUntilMs =
    Math.min(
      archive.observed_at_ms,
      serving.observed_at_ms,
      vectors.observed_at_ms,
      probes.observed_at_ms,
    ) + maximumReceiptAgeMs;
  assertSafeInteger(
    effectiveValidUntilMs,
    readyAtMs,
    "readiness v2 effective validity deadline",
  );
  const effectiveValidUntil = timestampFromMs(
    effectiveValidUntilMs,
    "readiness v2 effective validity deadline",
  );
  const attestationHash = await digest("publication-readiness-attestation", [
    field("evaluator_version", "text", READINESS_EVALUATOR_VERSION_V2),
    field("environment", "text", environment),
    field("publication_id", "identifier", manifest.publicationId),
    field("closure_hash", "digest", manifest.closureHash),
    field("bundle_hash", "digest", manifest.bundleHash),
    field("ready_at", "timestamp", readyAt),
    field("maximum_receipt_age_ms", "integer", String(maximumReceiptAgeMs)),
    field("effective_valid_until", "timestamp", effectiveValidUntil),
    field("archive_receipt_hash", "digest", archive.receipt_hash),
    field("serving_receipt_hash", "digest", serving.receipt_hash),
    field("vector_receipt_hash", "digest", vectors.receipt_hash),
    field("probes_receipt_hash", "digest", probes.receipt_hash),
  ]);
  const attestation = Object.freeze({
    publication_id: manifest.publicationId,
    environment,
    closure_hash: manifest.closureHash,
    bundle_hash: manifest.bundleHash,
    evaluator_version: READINESS_EVALUATOR_VERSION_V2,
    ready_at_ms: readyAtMs,
    maximum_receipt_age_ms: maximumReceiptAgeMs,
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
  } satisfies ServingReadinessAttestationProjectionV2);
  const result = {
    receipts: Object.freeze(receiptProofs),
    attestation,
  };
  Object.defineProperty(result, servingReadinessProofV2Brand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedServingReadinessProofsV2.add(result);
  return Object.freeze(result) as ServingReadinessProofV2;
};

export type ServingSwitchArtifactProofV2 = Omit<
  ServingSwitchArtifactProof,
  "probeSetVersion"
> &
  Readonly<{ probeSetVersion: typeof READINESS_PROBE_SET_VERSION_V2 }>;

export interface ServingSwitchPreflightContextV2 {
  readonly switchId: string;
  readonly action: "activate" | "rollback";
  readonly expectedPriorGeneration: number;
  readonly expectedPriorRollbackCandidatePublicationId: PublicationId | null;
  readonly expectedPriorSwitchedAtMs: number | null;
  readonly newGeneration: number;
  readonly fromPublicationId: PublicationId | null;
  readonly fromClosureHash: Sha256 | null;
  readonly toPublicationId: PublicationId;
  readonly toClosureHash: Sha256;
  readonly switchedAtMs: number;
}

const servingSwitchPreflightProofV2Brand: unique symbol = Symbol(
  "ServingSwitchPreflightProofV2",
);
interface ServingSwitchPreflightProofBindingV2 {
  readonly manifest: TrustedImmutablePublicationManifest;
  readonly readinessProof: ServingReadinessProofV2 | null;
  readonly providerProof: ProviderSearchArtifactProofV2;
}
const trustedServingSwitchPreflightProofsV2 = new WeakMap<
  object,
  ServingSwitchPreflightProofBindingV2
>();

export type ServingSwitchPreflightProofV2 = Readonly<
  Omit<
    ServingSwitchPreflightRow,
    "preflight_version" | "preflight_hash" | "probe_set_version"
  > & {
    preflight_version: typeof SERVING_SWITCH_PREFLIGHT_VERSION_V2;
    preflight_hash: Sha256;
    probe_set_version: typeof READINESS_PROBE_SET_VERSION_V2;
    provider_search_projection_version: typeof PROVIDER_SEARCH_PROJECTION_VERSION;
    provider_search_document_count: number;
    provider_search_inventory_hash: Sha256;
    provider_search_fts_build_version: typeof PROVIDER_SEARCH_FTS_BUILD_VERSION;
    provider_search_fts_document_count: number;
    provider_search_fts_queryable: 1;
    provider_search_exact_parity: 1;
    readonly [servingSwitchPreflightProofV2Brand]: true;
  }
>;

export const assertServingSwitchPreflightProofV2: (
  value: unknown,
) => asserts value is ServingSwitchPreflightProofV2 = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(servingSwitchPreflightProofV2Brand in value) ||
    value[servingSwitchPreflightProofV2Brand] !== true ||
    !trustedServingSwitchPreflightProofsV2.has(value)
  )
    throw new TypeError("serving switch preflight proof v2 is not trusted");
};

const switchArtifactProofKeysV2 = [
  "environment",
  "observedAtMs",
  "maximumAgeMs",
  "ftsBuildVersion",
  "ftsSourceDocumentCount",
  "ftsIndexDocumentCount",
  "ftsSourceInventoryHash",
  "ftsExactParity",
  "archiveBundleHash",
  "archiveImmutable",
  "vectorNamespace",
  "vectorDocumentCount",
  "vectorVerifiedDocumentCount",
  "vectorInventoryHash",
  "vectorVisibilityProbeVersion",
  "vectorMutationId",
  "vectorAllIdsPresent",
  "vectorAllNamespacesMatch",
  "vectorQueryable",
  "probeSetVersion",
  "integrityPassed",
  "exactSearchPassed",
  "semanticSearchPassed",
  "structuredFilterPassed",
  "neutralityPassed",
  "versionIsolationPassed",
] as const;

export const projectServingSwitchPreflightProofV2 = async (input: {
  readonly manifest: TrustedImmutablePublicationManifest;
  readonly providerProof: ProviderSearchArtifactProofV2;
  readonly readinessProof: ServingReadinessProofV2 | null;
  readonly context: ServingSwitchPreflightContextV2;
  readonly artifactProof: ServingSwitchArtifactProofV2;
}): Promise<ServingSwitchPreflightProofV2> => {
  const manifest = input.manifest;
  const providerProof = input.providerProof;
  const readinessProof = input.readinessProof;
  const candidateContext = input.context;
  const candidateArtifactProof = input.artifactProof;
  assertImmutablePublicationManifest(manifest);
  assertProviderSearchArtifactProofV2(providerProof);
  const providerManifest =
    trustedProviderSearchArtifactProofsV2.get(providerProof)?.manifest;
  if (
    providerManifest?.publicationId !== manifest.publicationId ||
    providerManifest.closureHash !== manifest.closureHash
  )
    throw new TypeError("switch preflight v2 uses another provider manifest");
  const proofRecord = inputRecord(
    candidateArtifactProof,
    "switch artifact proof v2",
  );
  if (!hasExactKeys(proofRecord, switchArtifactProofKeysV2))
    throw new TypeError("switch artifact proof v2 shape is invalid");
  const proof = {
    environment: proofRecord.environment,
    observedAtMs: proofRecord.observedAtMs,
    maximumAgeMs: proofRecord.maximumAgeMs,
    ftsBuildVersion: proofRecord.ftsBuildVersion,
    ftsSourceDocumentCount: proofRecord.ftsSourceDocumentCount,
    ftsIndexDocumentCount: proofRecord.ftsIndexDocumentCount,
    ftsSourceInventoryHash: proofRecord.ftsSourceInventoryHash,
    ftsExactParity: proofRecord.ftsExactParity,
    archiveBundleHash: proofRecord.archiveBundleHash,
    archiveImmutable: proofRecord.archiveImmutable,
    vectorNamespace: proofRecord.vectorNamespace,
    vectorDocumentCount: proofRecord.vectorDocumentCount,
    vectorVerifiedDocumentCount: proofRecord.vectorVerifiedDocumentCount,
    vectorInventoryHash: proofRecord.vectorInventoryHash,
    vectorVisibilityProbeVersion: proofRecord.vectorVisibilityProbeVersion,
    vectorMutationId: proofRecord.vectorMutationId,
    vectorAllIdsPresent: proofRecord.vectorAllIdsPresent,
    vectorAllNamespacesMatch: proofRecord.vectorAllNamespacesMatch,
    vectorQueryable: proofRecord.vectorQueryable,
    probeSetVersion: proofRecord.probeSetVersion,
    integrityPassed: proofRecord.integrityPassed,
    exactSearchPassed: proofRecord.exactSearchPassed,
    semanticSearchPassed: proofRecord.semanticSearchPassed,
    structuredFilterPassed: proofRecord.structuredFilterPassed,
    neutralityPassed: proofRecord.neutralityPassed,
    versionIsolationPassed: proofRecord.versionIsolationPassed,
  };
  const contextRecord = inputRecord(candidateContext, "switch context v2");
  if (
    !hasExactKeys(contextRecord, [
      "switchId",
      "action",
      "expectedPriorGeneration",
      "expectedPriorRollbackCandidatePublicationId",
      "expectedPriorSwitchedAtMs",
      "newGeneration",
      "fromPublicationId",
      "fromClosureHash",
      "toPublicationId",
      "toClosureHash",
      "switchedAtMs",
    ])
  )
    throw new TypeError("switch context v2 shape is invalid");
  const context = {
    switchId: contextRecord.switchId,
    action: contextRecord.action,
    expectedPriorGeneration: contextRecord.expectedPriorGeneration,
    expectedPriorRollbackCandidatePublicationId:
      contextRecord.expectedPriorRollbackCandidatePublicationId,
    expectedPriorSwitchedAtMs: contextRecord.expectedPriorSwitchedAtMs,
    newGeneration: contextRecord.newGeneration,
    fromPublicationId: contextRecord.fromPublicationId,
    fromClosureHash: contextRecord.fromClosureHash,
    toPublicationId: contextRecord.toPublicationId,
    toClosureHash: contextRecord.toClosureHash,
    switchedAtMs: contextRecord.switchedAtMs,
  };
  if (
    typeof context.switchId !== "string" ||
    !isAscii(context.switchId) ||
    context.switchId.length === 0 ||
    context.switchId.length > 256 ||
    (context.action !== "activate" && context.action !== "rollback") ||
    !isNonnegativeSafeInteger(context.expectedPriorGeneration) ||
    !isNonnegativeSafeInteger(context.newGeneration) ||
    context.newGeneration !== context.expectedPriorGeneration + 1 ||
    context.toPublicationId !== manifest.publicationId ||
    context.toClosureHash !== manifest.closureHash ||
    (context.fromPublicationId === null) !==
      (context.fromClosureHash === null) ||
    (context.expectedPriorRollbackCandidatePublicationId !== null &&
      (typeof context.expectedPriorRollbackCandidatePublicationId !==
        "string" ||
        !PUBLICATION_ID.test(
          context.expectedPriorRollbackCandidatePublicationId,
        ))) ||
    (context.fromPublicationId !== null &&
      (typeof context.fromPublicationId !== "string" ||
        !PUBLICATION_ID.test(context.fromPublicationId))) ||
    (context.fromClosureHash !== null &&
      (typeof context.fromClosureHash !== "string" ||
        !HASH.test(context.fromClosureHash)))
  )
    throw new TypeError("switch context v2 is invalid");
  assertSafeInteger(context.switchedAtMs as number, 0, "switch v2 time");
  assertSafeInteger(proof.observedAtMs as number, 0, "switch v2 observation");
  assertSafeInteger(proof.maximumAgeMs as number, 0, "switch v2 maximum age");
  const switchedAtMs = context.switchedAtMs as number;
  const observedAtMs = proof.observedAtMs as number;
  const maximumAgeMs = proof.maximumAgeMs as number;
  if (observedAtMs > switchedAtMs)
    throw new TypeError("switch v2 observation follows switch time");
  const validUntilMs = observedAtMs + maximumAgeMs;
  assertSafeInteger(validUntilMs, switchedAtMs, "switch v2 validity deadline");
  if (
    typeof proof.environment !== "string" ||
    !SERVING_PUBLICATION_ENVIRONMENTS.has(proof.environment) ||
    proof.ftsBuildVersion !== READINESS_FTS_BUILD_VERSION ||
    proof.ftsSourceDocumentCount !== manifest.searchDocuments.length ||
    proof.ftsIndexDocumentCount !== manifest.searchDocuments.length ||
    proof.ftsSourceInventoryHash !== manifest.exactSearchInventoryHash ||
    proof.ftsExactParity !== true ||
    proof.archiveBundleHash !== manifest.bundleHash ||
    proof.archiveImmutable !== true ||
    proof.vectorNamespace !== manifest.publicationId ||
    proof.vectorDocumentCount !== manifest.vectors.length ||
    proof.vectorVerifiedDocumentCount !== manifest.vectors.length ||
    proof.vectorInventoryHash !== manifest.vectorInventoryHash ||
    proof.vectorVisibilityProbeVersion !== VECTOR_VISIBILITY_PROBE_VERSION ||
    typeof proof.vectorMutationId !== "string" ||
    !isAscii(proof.vectorMutationId) ||
    proof.vectorMutationId.length === 0 ||
    proof.vectorMutationId.length > 128 ||
    proof.vectorAllIdsPresent !== true ||
    proof.vectorAllNamespacesMatch !== true ||
    proof.vectorQueryable !== true ||
    proof.probeSetVersion !== READINESS_PROBE_SET_VERSION_V2 ||
    proof.integrityPassed !== true ||
    proof.exactSearchPassed !== true ||
    proof.semanticSearchPassed !== true ||
    proof.structuredFilterPassed !== true ||
    proof.neutralityPassed !== true ||
    proof.versionIsolationPassed !== true
  )
    throw new TypeError("switch preflight v2 does not prove serving artifacts");
  let attestationHash: Sha256 | null = null;
  if (context.action === "activate") {
    assertServingReadinessProofV2(readinessProof);
    const attestation = readinessProof.attestation;
    if (
      attestation.publication_id !== manifest.publicationId ||
      attestation.closure_hash !== manifest.closureHash ||
      attestation.environment !== proof.environment ||
      switchedAtMs < attestation.ready_at_ms ||
      switchedAtMs > attestation.effective_valid_until_ms
    )
      throw new TypeError("switch activation v2 attestation is invalid");
    attestationHash = attestation.attestation_hash;
  } else if (readinessProof !== null) {
    throw new TypeError("switch rollback v2 carries readiness attestation");
  }
  const expectedPriorSwitchedAt =
    context.expectedPriorSwitchedAtMs === null
      ? null
      : timestampFromMs(
          context.expectedPriorSwitchedAtMs as number,
          "expected prior switch v2 time",
        );
  const switchedAt = timestampFromMs(switchedAtMs, "switch v2 time");
  const observedAt = timestampFromMs(observedAtMs, "switch v2 observation");
  const validUntil = timestampFromMs(validUntilMs, "switch v2 validity");
  const preflightHash = await digest("publication-switch-preflight", [
    field("preflight_version", "text", SERVING_SWITCH_PREFLIGHT_VERSION_V2),
    field("action", "text", context.action),
    field("environment", "text", proof.environment),
    field(
      "expected_prior_generation",
      "integer",
      String(context.expectedPriorGeneration),
    ),
    nullableCanonical(
      "expected_prior_rollback_candidate_publication_id",
      "identifier",
      context.expectedPriorRollbackCandidatePublicationId,
    ),
    expectedPriorSwitchedAt === null
      ? field("expected_prior_switched_at", "null", "null")
      : field(
          "expected_prior_switched_at",
          "timestamp",
          expectedPriorSwitchedAt,
        ),
    field("new_generation", "integer", String(context.newGeneration)),
    nullableCanonical(
      "from_publication_id",
      "identifier",
      context.fromPublicationId,
    ),
    nullableCanonical("from_closure_hash", "digest", context.fromClosureHash),
    field("to_publication_id", "identifier", manifest.publicationId),
    field("to_closure_hash", "digest", manifest.closureHash),
    nullableCanonical("to_attestation_hash", "digest", attestationHash),
    field("switched_at", "timestamp", switchedAt),
    field("observed_at", "timestamp", observedAt),
    field("maximum_age_ms", "integer", String(maximumAgeMs)),
    field("valid_until", "timestamp", validUntil),
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
    field("fts_exact_parity", "boolean", "true"),
    field("archive_bundle_hash", "digest", proof.archiveBundleHash),
    field("archive_immutable", "boolean", "true"),
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
    field("vector_all_ids_present", "boolean", "true"),
    field("vector_all_namespaces_match", "boolean", "true"),
    field("vector_queryable", "boolean", "true"),
    field("probe_set_version", "text", READINESS_PROBE_SET_VERSION_V2),
    field("integrity_passed", "boolean", "true"),
    field("exact_search_passed", "boolean", "true"),
    field("semantic_search_passed", "boolean", "true"),
    field("structured_filter_passed", "boolean", "true"),
    field("neutrality_passed", "boolean", "true"),
    field("version_isolation_passed", "boolean", "true"),
    ...providerSearchProofFieldsV2(providerProof),
  ]);
  const result = {
    switch_id: context.switchId,
    preflight_version: SERVING_SWITCH_PREFLIGHT_VERSION_V2,
    preflight_hash: preflightHash,
    action: context.action,
    environment: proof.environment as Exclude<PublicationEnvironment, "test">,
    expected_prior_generation: context.expectedPriorGeneration,
    expected_prior_rollback_candidate_publication_id:
      context.expectedPriorRollbackCandidatePublicationId as PublicationId | null,
    expected_prior_switched_at_ms: context.expectedPriorSwitchedAtMs as
      number | null,
    new_generation: context.newGeneration,
    from_publication_id: context.fromPublicationId as PublicationId | null,
    from_closure_hash: context.fromClosureHash as Sha256 | null,
    to_publication_id: manifest.publicationId,
    to_closure_hash: manifest.closureHash,
    to_attestation_hash: attestationHash,
    switched_at_ms: switchedAtMs,
    observed_at_ms: observedAtMs,
    maximum_age_ms: maximumAgeMs,
    valid_until_ms: validUntilMs,
    fts_build_version: proof.ftsBuildVersion as string,
    fts_source_document_count: proof.ftsSourceDocumentCount,
    fts_index_document_count: proof.ftsIndexDocumentCount,
    fts_source_inventory_hash: proof.ftsSourceInventoryHash,
    fts_exact_parity: 1 as const,
    archive_bundle_hash: proof.archiveBundleHash,
    archive_immutable: 1 as const,
    vector_namespace: proof.vectorNamespace,
    vector_document_count: proof.vectorDocumentCount,
    vector_verified_document_count: proof.vectorVerifiedDocumentCount,
    vector_inventory_hash: proof.vectorInventoryHash,
    vector_visibility_probe_version:
      proof.vectorVisibilityProbeVersion as string,
    vector_mutation_id: proof.vectorMutationId,
    vector_all_ids_present: 1 as const,
    vector_all_namespaces_match: 1 as const,
    vector_queryable: 1 as const,
    probe_set_version: READINESS_PROBE_SET_VERSION_V2,
    integrity_passed: 1 as const,
    exact_search_passed: 1 as const,
    semantic_search_passed: 1 as const,
    structured_filter_passed: 1 as const,
    neutrality_passed: 1 as const,
    version_isolation_passed: 1 as const,
    provider_search_projection_version:
      providerProof.provider_search_projection_version,
    provider_search_document_count:
      providerProof.provider_search_document_count,
    provider_search_inventory_hash:
      providerProof.provider_search_inventory_hash,
    provider_search_fts_build_version:
      providerProof.provider_search_fts_build_version,
    provider_search_fts_document_count:
      providerProof.provider_search_fts_document_count,
    provider_search_fts_queryable: 1 as const,
    provider_search_exact_parity: 1 as const,
  };
  Object.defineProperty(result, servingSwitchPreflightProofV2Brand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedServingSwitchPreflightProofsV2.set(
    result,
    Object.freeze({ manifest, readinessProof, providerProof }),
  );
  return Object.freeze(result) as ServingSwitchPreflightProofV2;
};

// ADR 0021 complete writer boundaries. These opaque values deliberately keep
// their detached persistence payloads in module-private WeakMaps. A D1 adapter
// can read the payload only after the nominal value has passed its assertion;
// copied, serialized, or reflected objects therefore carry no write authority.
export type ProviderSearchDocumentRowV2 = Readonly<{
  publication_id: PublicationId;
  provider_id: string;
  projection_version: typeof PROVIDER_SEARCH_PROJECTION_VERSION;
  display_name: string;
  normalized_name: string;
  provider_resource_content_hash: Sha256;
}>;

export type ProviderSearchFtsRowV2 = Readonly<{
  publication_id: PublicationId;
  provider_id: string;
  display_name: string;
}>;

const providerSearchStagingProjectionV2Brand: unique symbol = Symbol(
  "ProviderSearchStagingProjectionV2",
);

export type ProviderSearchStagingPersistenceV2 = Readonly<{
  publicationId: PublicationId;
  closureHash: Sha256;
  stagingRevision: number;
  documents: readonly ProviderSearchDocumentRowV2[];
  ftsRows: readonly ProviderSearchFtsRowV2[];
}>;

export type ProviderSearchStagingProjectionV2 = Readonly<{
  readonly [providerSearchStagingProjectionV2Brand]: true;
}>;

const trustedProviderSearchStagingProjectionsV2 = new WeakMap<
  object,
  ProviderSearchStagingPersistenceV2
>();

export const assertProviderSearchStagingProjectionV2: (
  value: unknown,
) => asserts value is ProviderSearchStagingProjectionV2 = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(providerSearchStagingProjectionV2Brand in value) ||
    value[providerSearchStagingProjectionV2Brand] !== true ||
    !trustedProviderSearchStagingProjectionsV2.has(value)
  )
    throw new TypeError("provider search staging projection v2 is not trusted");
};

const providerSearchPersistenceV2 = (
  projection: TrustedProviderSearchProjection,
  stagingRevision = 0,
): ProviderSearchStagingPersistenceV2 => {
  assertProviderSearchProjection(projection);
  assertSafeInteger(stagingRevision, 0, "provider search staging revision");
  const documents = projection.documents.map((document) =>
    Object.freeze({
      publication_id: projection.publicationId,
      provider_id: document.providerId,
      projection_version: document.projectionVersion,
      display_name: document.displayName,
      normalized_name: document.normalizedName,
      provider_resource_content_hash: document.providerResourceContentHash,
    }),
  );
  const ftsRows = documents.map((document) =>
    Object.freeze({
      publication_id: document.publication_id,
      provider_id: document.provider_id,
      display_name: document.display_name,
    }),
  );
  return Object.freeze({
    publicationId: projection.publicationId,
    closureHash: projection.closureHash,
    stagingRevision,
    documents: Object.freeze(documents),
    ftsRows: Object.freeze(ftsRows),
  });
};

export const projectProviderSearchStagingV2 = async (input: {
  readonly projection: TrustedProviderSearchProjection;
  readonly closureRows: ServingClosureRows;
}): Promise<ProviderSearchStagingProjectionV2> => {
  assertProviderSearchProjection(input.projection);
  const rows = structuredClone(input.closureRows);
  const closure = await projectServingClosureSeal(rows);
  if (
    closure.manifest.publicationId !== input.projection.publicationId ||
    closure.manifest.closureHash !== input.projection.closureHash
  )
    throw new TypeError(
      "provider search staging closure does not match projection",
    );
  const persistence = providerSearchPersistenceV2(
    input.projection,
    rows.stagingRevision,
  );
  const result = {};
  Object.defineProperty(result, providerSearchStagingProjectionV2Brand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedProviderSearchStagingProjectionsV2.set(result, persistence);
  return Object.freeze(result) as ProviderSearchStagingProjectionV2;
};

export const readProviderSearchStagingPersistenceV2 = (
  value: ProviderSearchStagingProjectionV2,
): ProviderSearchStagingPersistenceV2 => {
  assertProviderSearchStagingProjectionV2(value);
  const persistence = trustedProviderSearchStagingProjectionsV2.get(value);
  if (persistence === undefined)
    throw new TypeError("provider search staging projection v2 is not trusted");
  return persistence;
};

export type ProviderSearchStagingRetryDecision = Readonly<{
  outcome:
    | "execute"
    | "idempotent_success"
    | "stale"
    | "conflict"
    | "integrity_failure";
}>;

export const classifyProviderSearchStagingRetryV2 = (input: {
  readonly expected: ProviderSearchStagingProjectionV2;
  readonly publicationState: PublicationState;
  readonly sealed: boolean;
  readonly stagingRevision: number;
  readonly documents: readonly ProviderSearchDocumentRowV2[];
  readonly ftsRows: readonly ProviderSearchFtsRowV2[];
}): ProviderSearchStagingRetryDecision => {
  const expected = readProviderSearchStagingPersistenceV2(input.expected);
  if (input.stagingRevision !== expected.stagingRevision)
    return Object.freeze({ outcome: "stale" });
  if (
    expected.documents.length === 0 &&
    input.documents.length === 0 &&
    input.ftsRows.length === 0
  ) {
    if (input.publicationState === "building" && !input.sealed)
      return Object.freeze({ outcome: "execute" });
    if (input.publicationState === "failed" && !input.sealed)
      return Object.freeze({ outcome: "stale" });
    return Object.freeze({ outcome: "integrity_failure" });
  }
  const documentsEqual =
    JSON.stringify(input.documents) === JSON.stringify(expected.documents);
  const ftsEqual =
    JSON.stringify(input.ftsRows) === JSON.stringify(expected.ftsRows);
  if (documentsEqual && ftsEqual)
    return Object.freeze({ outcome: "idempotent_success" });
  if (input.documents.length === 0 && input.ftsRows.length === 0) {
    if (input.publicationState === "building" && !input.sealed)
      return Object.freeze({ outcome: "execute" });
    if (input.publicationState === "failed" && !input.sealed)
      return Object.freeze({ outcome: "stale" });
    return Object.freeze({ outcome: "integrity_failure" });
  }
  const actualProviderIds = new Set(
    input.documents.map((row) => row.provider_id),
  );
  const expectedProviderIds = new Set(
    expected.documents.map((row) => row.provider_id),
  );
  const overlaps = [...actualProviderIds].some((id) =>
    expectedProviderIds.has(id),
  );
  return Object.freeze({
    outcome: overlaps ? "conflict" : "integrity_failure",
  });
};

export type ServingServingReceiptRowV2 = Readonly<
  ServingServingReceiptRow & {
    provider_search_projection_version: typeof PROVIDER_SEARCH_PROJECTION_VERSION;
    provider_search_document_count: number;
    provider_search_inventory_hash: Sha256;
    provider_search_fts_build_version: typeof PROVIDER_SEARCH_FTS_BUILD_VERSION;
    provider_search_fts_document_count: number;
    provider_search_fts_queryable: 1;
    provider_search_exact_parity: 1;
  }
>;

export type ServingReadinessReceiptRowsV2 = Readonly<{
  bindings: readonly ServingReadinessReceiptBindingRow[];
  archives: readonly ServingArchiveReceiptRow[];
  servings: readonly ServingServingReceiptRowV2[];
  vectors: readonly ServingVectorReceiptRow[];
  probes: readonly ServingProbeReceiptRow[];
}>;

export type ServingReadinessCommitPersistenceV2 = Readonly<{
  providerSearch: ProviderSearchStagingPersistenceV2;
  receiptRows: ServingReadinessReceiptRowsV2;
  attestation: ServingReadinessAttestationProjectionV2;
  transition: Readonly<{
    publication_id: PublicationId;
    closure_hash: Sha256;
    expected_state: "building";
    next_state: "ready";
    ready_at_ms: number;
  }>;
}>;

const servingReadinessCommitProjectionV2Brand: unique symbol = Symbol(
  "ServingReadinessCommitProjectionV2",
);
export type ServingReadinessCommitProjectionV2 = Readonly<{
  readonly [servingReadinessCommitProjectionV2Brand]: true;
}>;
const trustedServingReadinessCommitProjectionsV2 = new WeakMap<
  object,
  ServingReadinessCommitPersistenceV2
>();

export const assertServingReadinessCommitProjectionV2: (
  value: unknown,
) => asserts value is ServingReadinessCommitProjectionV2 = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(servingReadinessCommitProjectionV2Brand in value) ||
    value[servingReadinessCommitProjectionV2Brand] !== true ||
    !trustedServingReadinessCommitProjectionsV2.has(value)
  )
    throw new TypeError(
      "serving readiness commit projection v2 is not trusted",
    );
};

const receiptDetailRowsV2 = (
  proof: ServingReadinessProofV2,
): ServingReadinessReceiptRowsV2 => {
  const bindings: ServingReadinessReceiptBindingRow[] = [];
  const archives: ServingArchiveReceiptRow[] = [];
  const servings: ServingServingReceiptRowV2[] = [];
  const vectors: ServingVectorReceiptRow[] = [];
  const probes: ServingProbeReceiptRow[] = [];
  for (const receiptProof of proof.receipts) {
    const binding = trustedReadinessReceiptProofsV2.get(receiptProof);
    if (binding === undefined)
      throw new TypeError("readiness receipt proof v2 is not trusted");
    const receipt = binding.receipt;
    bindings.push(
      Object.freeze({
        publication_id: receiptProof.publication_id,
        kind: receipt.kind,
        receipt_version: receiptProof.receipt_version,
        receipt_hash: receiptProof.receipt_hash,
        environment: receiptProof.environment,
        closure_hash: receiptProof.closure_hash,
        bundle_hash: receiptProof.bundle_hash,
        schema_version: receipt.binding.schemaVersion,
        build_commit: receipt.binding.buildCommit,
        observed_at_ms: receiptProof.observed_at_ms,
      }),
    );
    switch (receipt.kind) {
      case "archive":
        archives.push(
          Object.freeze({
            publication_id: receiptProof.publication_id,
            kind: "archive",
            retained_bundle_hash: receipt.retainedBundleHash,
            immutable: receipt.immutable ? 1 : 0,
          }),
        );
        break;
      case "serving": {
        const providerProof = binding.providerProof;
        assertProviderSearchArtifactProofV2(providerProof);
        servings.push(
          Object.freeze({
            publication_id: receiptProof.publication_id,
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
            provider_search_projection_version:
              providerProof.provider_search_projection_version,
            provider_search_document_count:
              providerProof.provider_search_document_count,
            provider_search_inventory_hash:
              providerProof.provider_search_inventory_hash,
            provider_search_fts_build_version:
              providerProof.provider_search_fts_build_version,
            provider_search_fts_document_count:
              providerProof.provider_search_fts_document_count,
            provider_search_fts_queryable: 1,
            provider_search_exact_parity: 1,
          }),
        );
        break;
      }
      case "vectors":
        vectors.push(
          Object.freeze({
            publication_id: receiptProof.publication_id,
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
            publication_id: receiptProof.publication_id,
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
    bindings: Object.freeze(
      bindings.sort((a, b) => compareAscii(a.kind, b.kind)),
    ),
    archives: Object.freeze(archives),
    servings: Object.freeze(servings),
    vectors: Object.freeze(vectors),
    probes: Object.freeze(probes),
  });
};

/**
 * Rebuilds nominal readiness authority after a process restart from exact
 * schema-1.5 rows plus the independently reconstructed provider projection.
 * Persisted hashes are compared with newly projected hashes; they are never
 * treated as caller-supplied proof.
 */
export const reconstructServingReadinessProofV2FromPersistence = async (input: {
  readonly manifest: TrustedImmutablePublicationManifest;
  readonly providerProjection: TrustedProviderSearchProjection;
  readonly providerFts: ProviderSearchFtsObservationV2;
  readonly providerSearchDocuments: readonly ProviderSearchDocumentRowV2[];
  readonly providerSearchFtsRows: readonly ProviderSearchFtsRowV2[];
  readonly receiptRows: ServingReadinessReceiptRowsV2;
  readonly attestation: ServingReadinessAttestationProjectionV2;
}): Promise<ServingReadinessProofV2> => {
  assertImmutablePublicationManifest(input.manifest);
  assertProviderSearchProjection(input.providerProjection);
  const observed = structuredClone({
    providerFts: input.providerFts,
    providerSearchDocuments: input.providerSearchDocuments,
    providerSearchFtsRows: input.providerSearchFtsRows,
    receiptRows: input.receiptRows,
    attestation: input.attestation,
  });
  const providerPersistence = providerSearchPersistenceV2(
    input.providerProjection,
  );
  if (
    JSON.stringify(observed.providerSearchDocuments) !==
      JSON.stringify(providerPersistence.documents) ||
    JSON.stringify(observed.providerSearchFtsRows) !==
      JSON.stringify(providerPersistence.ftsRows)
  )
    throw new TypeError("persisted provider search projection v2 is invalid");
  const providerProof = projectProviderSearchArtifactProofV2({
    manifest: input.manifest,
    projection: input.providerProjection,
    fts: observed.providerFts,
  });
  if (
    observed.receiptRows.bindings.length !== 4 ||
    observed.receiptRows.archives.length !== 1 ||
    observed.receiptRows.servings.length !== 1 ||
    observed.receiptRows.vectors.length !== 1 ||
    observed.receiptRows.probes.length !== 1
  )
    throw new TypeError("persisted readiness receipt v2 set is incomplete");
  const detail = {
    archive: requireSingleRow(observed.receiptRows.archives, "archive v2"),
    serving: requireSingleRow(observed.receiptRows.servings, "serving v2"),
    vectors: requireSingleRow(observed.receiptRows.vectors, "vectors v2"),
    probes: requireSingleRow(observed.receiptRows.probes, "probes v2"),
  };
  const persistedServing = detail.serving as Readonly<Record<string, unknown>>;
  if (
    persistedServing.provider_search_projection_version !==
      providerProof.provider_search_projection_version ||
    persistedServing.provider_search_document_count !==
      providerProof.provider_search_document_count ||
    persistedServing.provider_search_inventory_hash !==
      providerProof.provider_search_inventory_hash ||
    persistedServing.provider_search_fts_build_version !==
      providerProof.provider_search_fts_build_version ||
    persistedServing.provider_search_fts_document_count !==
      providerProof.provider_search_fts_document_count ||
    persistedServing.provider_search_fts_queryable !== 1 ||
    persistedServing.provider_search_exact_parity !== 1
  )
    throw new TypeError("persisted provider serving receipt v2 is invalid");
  const receipts: ReadinessReceipt[] = [];
  const persistedProofByKind = new Map<
    ReadinessReceipt["kind"],
    ServingReadinessReceiptBindingRow
  >();
  for (const row of observed.receiptRows.bindings) {
    if (
      row.receipt_version !== READINESS_RECEIPT_VERSION_V2 ||
      persistedProofByKind.has(row.kind) ||
      detail[row.kind].publication_id !== row.publication_id
    )
      throw new TypeError("persisted readiness receipt v2 binding is invalid");
    persistedProofByKind.set(row.kind, row);
    const binding: ArtifactBinding = Object.freeze({
      environment: row.environment as PublicationEnvironment,
      publicationId: row.publication_id as PublicationId,
      closureHash: row.closure_hash as Sha256,
      bundleHash: row.bundle_hash as Sha256,
      schemaVersion: row.schema_version,
      buildCommit: row.build_commit,
    });
    const common = {
      binding,
      observedAt: timestampFromMs(
        row.observed_at_ms,
        "persisted readiness v2 observation",
      ),
    };
    switch (row.kind) {
      case "archive":
        receipts.push({
          ...common,
          kind: "archive",
          retainedBundleHash: detail.archive.retained_bundle_hash as Sha256,
          immutable: receiptFlag(detail.archive.immutable, "archive immutable"),
        });
        break;
      case "serving":
        receipts.push({
          ...common,
          kind: "serving",
          enabledProviderCount: detail.serving.enabled_provider_count,
          enabledProviderScopeHash: detail.serving
            .enabled_provider_scope_hash as Sha256,
          providerSliceCount: detail.serving.provider_slice_count,
          providerSliceHash: detail.serving.provider_slice_hash as Sha256,
          providerAttributionCount: detail.serving.provider_attribution_count,
          providerAttributionHash: detail.serving
            .provider_attribution_hash as Sha256,
          resourceCount: detail.serving.resource_count,
          exactDocumentCount: detail.serving.exact_document_count,
          resourceInventoryHash: detail.serving
            .resource_inventory_hash as Sha256,
          exactSearchInventoryHash: detail.serving
            .exact_search_inventory_hash as Sha256,
          ftsBuildVersion: detail.serving.fts_build_version,
          ftsDocumentCount: detail.serving.fts_document_count,
          ftsQueryable: receiptFlag(
            detail.serving.fts_queryable,
            "serving FTS queryable",
          ),
          foreignKeysValid: receiptFlag(
            detail.serving.foreign_keys_valid,
            "serving foreign keys",
          ),
          contentHashesValid: receiptFlag(
            detail.serving.content_hashes_valid,
            "serving content hashes",
          ),
          unavailableProviderIsolationValid: receiptFlag(
            detail.serving.unavailable_provider_isolation_valid,
            "serving unavailable provider isolation",
          ),
        });
        break;
      case "vectors":
        receipts.push({
          ...common,
          kind: "vectors",
          namespace: detail.vectors.vector_namespace as PublicationId,
          documentCount: detail.vectors.document_count,
          verifiedDocumentCount: detail.vectors.verified_document_count,
          vectorInventoryHash: detail.vectors.vector_inventory_hash as Sha256,
          visibilityProbeVersion: detail.vectors.visibility_probe_version,
          mutationId: detail.vectors.mutation_id,
          allIdsPresent: receiptFlag(
            detail.vectors.all_ids_present,
            "vector IDs present",
          ),
          allNamespacesMatch: receiptFlag(
            detail.vectors.all_namespaces_match,
            "vector namespaces",
          ),
          queryable: receiptFlag(detail.vectors.queryable, "vectors queryable"),
        });
        break;
      case "probes":
        receipts.push({
          ...common,
          kind: "probes",
          probeSetVersion: detail.probes.probe_set_version,
          integrityPassed: receiptFlag(
            detail.probes.integrity_passed,
            "probe integrity",
          ),
          evidenceCoveragePassed: receiptFlag(
            detail.probes.evidence_coverage_passed,
            "probe evidence coverage",
          ),
          exactSearchPassed: receiptFlag(
            detail.probes.exact_search_passed,
            "probe exact search",
          ),
          semanticSearchPassed: receiptFlag(
            detail.probes.semantic_search_passed,
            "probe semantic search",
          ),
          structuredFilterPassed: receiptFlag(
            detail.probes.structured_filter_passed,
            "probe structured filter",
          ),
          neutralityPassed: receiptFlag(
            detail.probes.neutrality_passed,
            "probe neutrality",
          ),
          versionIsolationPassed: receiptFlag(
            detail.probes.version_isolation_passed,
            "probe version isolation",
          ),
        });
        break;
    }
  }
  const receiptProofs = await Promise.all(
    receipts.map((receipt) =>
      projectReadinessReceiptProofV2({
        receipt,
        providerProof: receipt.kind === "serving" ? providerProof : null,
      }),
    ),
  );
  for (const proof of receiptProofs) {
    const persisted = persistedProofByKind.get(proof.kind);
    if (
      persisted?.receipt_hash !== proof.receipt_hash ||
      persisted.observed_at_ms !== proof.observed_at_ms
    )
      throw new TypeError("persisted readiness receipt v2 hash is invalid");
  }
  const reconstructed = await projectServingReadinessProofV2({
    manifest: input.manifest,
    receiptProofs,
    environment: observed.attestation.environment,
    readyAtMs: observed.attestation.ready_at_ms,
    maximumReceiptAgeMs: observed.attestation.maximum_receipt_age_ms,
  });
  if (
    JSON.stringify(reconstructed.attestation) !==
    JSON.stringify(observed.attestation)
  )
    throw new TypeError("persisted readiness attestation v2 is invalid");
  return reconstructed;
};

export const projectServingReadinessCommitV2 = async (input: {
  readonly proof: ServingReadinessProofV2;
  readonly closureRows: ServingClosureRows;
  readonly persistedSeal: ServingClosureSealProjection;
  readonly persistedProviderSearchDocuments: readonly ProviderSearchDocumentRowV2[];
  readonly persistedProviderSearchFtsRows: readonly ProviderSearchFtsRowV2[];
}): Promise<ServingReadinessCommitProjectionV2> => {
  const proof = input.proof;
  assertServingReadinessProofV2(proof);
  // Nominal proofs are retained by identity; all caller-owned persistence
  // observations are detached before the first digest yields.
  const observed = structuredClone({
    closureRows: input.closureRows,
    persistedSeal: input.persistedSeal,
    documents: input.persistedProviderSearchDocuments,
    ftsRows: input.persistedProviderSearchFtsRows,
  });
  const receiptRows = receiptDetailRowsV2(proof);
  const servingProof = proof.receipts.find(
    (receipt) => receipt.kind === "serving",
  );
  if (servingProof === undefined)
    throw new TypeError("serving readiness proof v2 lacks serving evidence");
  const receiptBinding = trustedReadinessReceiptProofsV2.get(servingProof);
  const providerProof = receiptBinding?.providerProof;
  assertProviderSearchArtifactProofV2(providerProof);
  const providerBinding =
    trustedProviderSearchArtifactProofsV2.get(providerProof);
  if (providerBinding === undefined)
    throw new TypeError("provider search artifact proof v2 is not trusted");
  const providerSearch = providerSearchPersistenceV2(
    providerBinding.projection,
  );
  const closure = await projectServingClosureSeal(observed.closureRows);
  const sealErrors = await verifyServingClosureSealProjection(
    observed.closureRows,
    observed.persistedSeal,
  );
  if (
    sealErrors.length > 0 ||
    closure.manifest.publicationId !== proof.attestation.publication_id ||
    closure.manifest.closureHash !== proof.attestation.closure_hash ||
    closure.manifest.bundleHash !== proof.attestation.bundle_hash ||
    providerBinding.manifest.publicationId !== closure.manifest.publicationId ||
    providerBinding.manifest.closureHash !== closure.manifest.closureHash ||
    proof.receipts.some(
      (receipt) => receipt.observed_at_ms < observed.closureRows.sealedAtMs,
    ) ||
    JSON.stringify(observed.documents) !==
      JSON.stringify(providerSearch.documents) ||
    JSON.stringify(observed.ftsRows) !== JSON.stringify(providerSearch.ftsRows)
  )
    throw new TypeError(
      "serving readiness commit v2 does not match persisted sealed evidence",
    );
  const persistence = Object.freeze({
    providerSearch,
    receiptRows,
    attestation: Object.freeze({ ...proof.attestation }),
    transition: Object.freeze({
      publication_id: proof.attestation.publication_id,
      closure_hash: proof.attestation.closure_hash,
      expected_state: "building" as const,
      next_state: "ready" as const,
      ready_at_ms: proof.attestation.ready_at_ms,
    }),
  });
  const result = {};
  Object.defineProperty(result, servingReadinessCommitProjectionV2Brand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedServingReadinessCommitProjectionsV2.set(result, persistence);
  return Object.freeze(result) as ServingReadinessCommitProjectionV2;
};

export const readServingReadinessCommitPersistenceV2 = (
  value: ServingReadinessCommitProjectionV2,
): ServingReadinessCommitPersistenceV2 => {
  assertServingReadinessCommitProjectionV2(value);
  const persistence = trustedServingReadinessCommitProjectionsV2.get(value);
  if (persistence === undefined)
    throw new TypeError(
      "serving readiness commit projection v2 is not trusted",
    );
  return persistence;
};

export const classifyServingReadinessCommitRetryV2 = (input: {
  readonly expected: ServingReadinessCommitProjectionV2;
  readonly publicationState: PublicationState;
  readonly publicationReadyAtMs: number | null;
  readonly publicationClosureHash: string;
  readonly receiptRows: ServingReadinessReceiptRowsV2;
  readonly attestation: ServingReadinessAttestationProjectionV2 | null;
}): ServingReadinessCommitRetryDecision => {
  const expected = readServingReadinessCommitPersistenceV2(input.expected);
  const hasRows = !readinessRowsEmpty(input.receiptRows);
  if (!hasRows && input.attestation === null) {
    if (input.publicationClosureHash !== expected.transition.closure_hash)
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

export type ServingSwitchPersistenceV2 = Readonly<{
  plan: HeadSwitchPlan;
  preflight: ServingSwitchPreflightProofV2;
  history: ServingSwitchHistoryRow;
}>;

const servingSwitchProjectionV2Brand: unique symbol = Symbol(
  "ServingSwitchProjectionV2",
);
export type ServingSwitchProjectionV2 = Readonly<{
  readonly [servingSwitchProjectionV2Brand]: true;
}>;
const trustedServingSwitchProjectionsV2 = new WeakMap<
  object,
  ServingSwitchPersistenceV2
>();

export const assertServingSwitchProjectionV2: (
  value: unknown,
) => asserts value is ServingSwitchProjectionV2 = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(servingSwitchProjectionV2Brand in value) ||
    value[servingSwitchProjectionV2Brand] !== true ||
    !trustedServingSwitchProjectionsV2.has(value)
  )
    throw new TypeError("serving switch projection v2 is not trusted");
};

export const projectServingSwitchV2 = async (input: {
  readonly preflight: ServingSwitchPreflightProofV2;
  readonly target: PublicationRecord;
  readonly currentHead: StoredPublicationHead | null;
  readonly currentActive: PublicationRecord | null;
  readonly authorizedBy: SwitchAuthorization;
  readonly closureRows: ServingClosureRows;
  readonly persistedSeal: ServingClosureSealProjection;
  readonly persistedProviderSearchDocuments: readonly ProviderSearchDocumentRowV2[];
  readonly persistedProviderSearchFtsRows: readonly ProviderSearchFtsRowV2[];
  readonly persistedReceiptRows: ServingReadinessReceiptRowsV2 | null;
  readonly persistedAttestation: ServingReadinessAttestationProjectionV2 | null;
}): Promise<ServingSwitchProjectionV2> => {
  assertServingSwitchPreflightProofV2(input.preflight);
  const proofBinding = trustedServingSwitchPreflightProofsV2.get(
    input.preflight,
  );
  if (proofBinding === undefined)
    throw new TypeError("serving switch preflight proof v2 is not trusted");
  const observed = structuredClone({
    target: input.target,
    currentHead: input.currentHead,
    currentActive: input.currentActive,
    authorizedBy: input.authorizedBy,
    closureRows: input.closureRows,
    persistedSeal: input.persistedSeal,
    providerDocuments: input.persistedProviderSearchDocuments,
    providerFtsRows: input.persistedProviderSearchFtsRows,
    receiptRows: input.persistedReceiptRows,
    attestation: input.persistedAttestation,
  });
  const closure = await projectServingClosureSeal(observed.closureRows);
  const sealErrors = await verifyServingClosureSealProjection(
    observed.closureRows,
    observed.persistedSeal,
  );
  const providerBinding = trustedProviderSearchArtifactProofsV2.get(
    proofBinding.providerProof,
  );
  if (providerBinding === undefined)
    throw new TypeError("serving switch v2 provider proof is not trusted");
  const providerSearch = providerSearchPersistenceV2(
    providerBinding.projection,
  );
  if (
    sealErrors.length > 0 ||
    closure.manifest.publicationId !== proofBinding.manifest.publicationId ||
    closure.manifest.closureHash !== proofBinding.manifest.closureHash ||
    JSON.stringify(observed.providerDocuments) !==
      JSON.stringify(providerSearch.documents) ||
    JSON.stringify(observed.providerFtsRows) !==
      JSON.stringify(providerSearch.ftsRows) ||
    input.preflight.observed_at_ms < observed.closureRows.sealedAtMs
  )
    throw new TypeError(
      "serving switch v2 does not match persisted sealed evidence",
    );
  if (input.preflight.action === "activate") {
    const readinessProof = proofBinding.readinessProof;
    assertServingReadinessProofV2(readinessProof);
    const expectedRows = receiptDetailRowsV2(readinessProof);
    if (
      observed.receiptRows === null ||
      observed.attestation === null ||
      JSON.stringify(observed.receiptRows) !== JSON.stringify(expectedRows) ||
      JSON.stringify(observed.attestation) !==
        JSON.stringify(readinessProof.attestation)
    )
      throw new TypeError(
        "serving switch activation v2 lacks persisted readiness",
      );
  } else if (observed.receiptRows !== null || observed.attestation !== null) {
    throw new TypeError(
      "serving switch rollback v2 carries readiness evidence",
    );
  }
  if (
    observed.target.publicationId !== proofBinding.manifest.publicationId ||
    observed.target.closureHash !== proofBinding.manifest.closureHash ||
    input.preflight.to_publication_id !== observed.target.publicationId ||
    input.preflight.to_closure_hash !== observed.target.closureHash
  )
    throw new TypeError("serving switch v2 target does not bind its manifest");
  const switchedAt = timestampFromMs(
    input.preflight.switched_at_ms,
    "switch v2 time",
  );
  const plan =
    input.preflight.action === "activate"
      ? planActivation({
          candidate: observed.target,
          currentHead: observed.currentHead,
          currentActive: observed.currentActive,
          switchedAt,
          authorizedBy: observed.authorizedBy,
        })
      : (() => {
          if (observed.currentHead === null || observed.currentActive === null)
            throw new TypeError("rollback v2 lacks current serving state");
          return planRollback({
            currentHead: observed.currentHead,
            defective: observed.currentActive,
            target: observed.target,
            switchedAt,
            authorizedBy: observed.authorizedBy,
          });
        })();
  const event = switchHistoryStep(plan);
  if (
    event.switchId !== input.preflight.switch_id ||
    event.action !== input.preflight.action ||
    event.expectedPriorGeneration !==
      input.preflight.expected_prior_generation ||
    event.newGeneration !== input.preflight.new_generation ||
    event.fromPublicationId !== input.preflight.from_publication_id ||
    event.fromClosureHash !== input.preflight.from_closure_hash ||
    event.toPublicationId !== input.preflight.to_publication_id ||
    event.toClosureHash !== input.preflight.to_closure_hash ||
    (observed.currentHead?.rollbackCandidatePublicationId ?? null) !==
      input.preflight.expected_prior_rollback_candidate_publication_id ||
    (observed.currentHead === null
      ? null
      : assertTimestamp(
          observed.currentHead.switchedAt,
          "prior switch v2 time",
        )) !== input.preflight.expected_prior_switched_at_ms
  )
    throw new TypeError(
      "serving switch v2 preflight does not bind its lifecycle plan",
    );
  const eventHash = await digest("publication-switch-event", [
    field("event_version", "text", SERVING_SWITCH_EVENT_VERSION),
    field("switch_id", "text", event.switchId),
    field("preflight_hash", "digest", input.preflight.preflight_hash),
    field("action", "text", event.action),
    field(
      "expected_prior_generation",
      "integer",
      String(event.expectedPriorGeneration),
    ),
    nullableCanonical(
      "expected_prior_rollback_candidate_publication_id",
      "identifier",
      observed.currentHead?.rollbackCandidatePublicationId ?? null,
    ),
    observed.currentHead === null
      ? field("expected_prior_switched_at", "null", "null")
      : field(
          "expected_prior_switched_at",
          "timestamp",
          observed.currentHead.switchedAt,
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
    nullableCanonical(
      "to_attestation_hash",
      "digest",
      input.preflight.to_attestation_hash,
    ),
    nullableCanonical(
      "resulting_rollback_candidate_publication_id",
      "identifier",
      event.resultingRollbackCandidatePublicationId,
    ),
    field("switched_at", "timestamp", event.switchedAt),
    field("authorized_by_kind", "text", event.authorizedBy.kind),
    field("authorized_identity_id", "text", event.authorizedBy.identityId),
  ]);
  const history = Object.freeze({
    switch_id: event.switchId,
    event_version: SERVING_SWITCH_EVENT_VERSION,
    event_hash: eventHash,
    preflight_hash: input.preflight.preflight_hash,
    action: event.action,
    expected_prior_generation: event.expectedPriorGeneration,
    expected_prior_rollback_candidate_publication_id:
      observed.currentHead?.rollbackCandidatePublicationId ?? null,
    expected_prior_switched_at_ms:
      observed.currentHead === null
        ? null
        : assertTimestamp(
            observed.currentHead.switchedAt,
            "prior switch v2 time",
          ),
    new_generation: event.newGeneration,
    from_publication_id: event.fromPublicationId,
    from_closure_hash: event.fromClosureHash,
    to_publication_id: event.toPublicationId,
    to_closure_hash: event.toClosureHash,
    to_attestation_hash: input.preflight.to_attestation_hash,
    resulting_rollback_candidate_publication_id:
      event.resultingRollbackCandidatePublicationId,
    switched_at_ms: input.preflight.switched_at_ms,
    authorized_by_kind: event.authorizedBy.kind,
    authorized_identity_id: event.authorizedBy.identityId,
  } satisfies ServingSwitchHistoryRow);
  const persistence = Object.freeze({
    plan,
    preflight: input.preflight,
    history,
  });
  const result = {};
  Object.defineProperty(result, servingSwitchProjectionV2Brand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedServingSwitchProjectionsV2.set(result, persistence);
  return Object.freeze(result) as ServingSwitchProjectionV2;
};

export const readServingSwitchPersistenceV2 = (
  value: ServingSwitchProjectionV2,
): ServingSwitchPersistenceV2 => {
  assertServingSwitchProjectionV2(value);
  const persistence = trustedServingSwitchProjectionsV2.get(value);
  if (persistence === undefined)
    throw new TypeError("serving switch projection v2 is not trusted");
  return persistence;
};

export const classifyServingSwitchRetryV2 = (input: {
  readonly expected: ServingSwitchProjectionV2;
  readonly currentHead: StoredPublicationHead | null;
  readonly preflightAtGeneration: ServingSwitchPreflightProofV2 | null;
  readonly historyAtGeneration: ServingSwitchHistoryRow | null;
  readonly targetState: PublicationState;
  readonly formerState: PublicationState | null;
}): ServingSwitchRetryDecision => {
  const expected = readServingSwitchPersistenceV2(input.expected);
  if (input.currentHead !== null) validateHead(input.currentHead);
  const cas = expected.plan.steps.find(
    (
      step,
    ): step is Extract<HeadSwitchStep, { kind: "compare_and_swap_head" }> =>
      step.kind === "compare_and_swap_head",
  );
  if (cas === undefined)
    throw new TypeError("switch v2 plan lacks its head CAS");
  if (input.historyAtGeneration === null) {
    if (input.preflightAtGeneration !== null)
      return Object.freeze({
        outcome: rowsExactlyEqual(
          input.preflightAtGeneration,
          expected.preflight,
        )
          ? "integrity_failure"
          : "conflict",
      });
    if (!headsEqual(input.currentHead, cas.expected))
      return Object.freeze({ outcome: "stale" });
    const expectedTarget =
      expected.history.action === "activate" ? "ready" : "superseded";
    const expectedFormer =
      expected.history.from_publication_id === null ? null : "active";
    if (
      input.targetState !== expectedTarget ||
      input.formerState !== expectedFormer
    )
      return Object.freeze({ outcome: "integrity_failure" });
    return Object.freeze({ outcome: "execute" });
  }
  if (!rowsExactlyEqual(input.historyAtGeneration, expected.history))
    return Object.freeze({ outcome: "conflict" });
  if (input.preflightAtGeneration === null)
    return Object.freeze({ outcome: "integrity_failure" });
  if (!rowsExactlyEqual(input.preflightAtGeneration, expected.preflight))
    return Object.freeze({ outcome: "conflict" });
  const expectedFormer =
    expected.history.from_publication_id === null
      ? null
      : expected.history.action === "activate"
        ? "superseded"
        : "rolled_back";
  if (
    !headsEqual(input.currentHead, cas.next) ||
    input.targetState !== "active" ||
    input.formerState !== expectedFormer
  )
    return Object.freeze({ outcome: "integrity_failure" });
  return Object.freeze({ outcome: "idempotent_success" });
};
