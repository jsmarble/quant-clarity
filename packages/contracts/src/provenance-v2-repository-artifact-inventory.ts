import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS } from "./provenance-v2-connected-document-cascade-vectors.js";
import { PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH } from "./provenance-v2-connected-registration-graph.js";
import { PROVENANCE_V2_ROOT_BINDING_PLAN } from "./provenance-v2-root-binding-plan.js";
import { PROVENANCE_V2_SEMANTIC_POLICY } from "./provenance-v2-registration.js";

const REVIEW_CANDIDATE_SCHEMA = {
  "x-quantclarity-contract-status": "review_candidate",
} as const;
const SHA256 = "^sha256:[0-9a-f]{64}$";
const SAFE_PATH = "^[a-z0-9][a-z0-9._/-]{0,511}$";
const SEMANTIC_POLICY_PATH =
  "contracts/generated/provenance-v2/registration-semantics.v1.json";
const SEMANTIC_POLICY_SHA256 =
  "sha256:65a3259f56e160508281e775898967423d21a284dfb7b63db0342f16d59f7804";
const REPOSITORY_BINDING_INVENTORY_SHA256 =
  "sha256:f791d7c78ca4eb540358595d192f988a5e856994616d47fb5c7d9cd8704b843e";

type Scalar = string | number | boolean | null;
type Json = Scalar | Json[] | { [key: string]: Json };
type GraphRow =
  (typeof PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows)[number];
type BindingEntry =
  (typeof PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings)[number];
type RepositorySelector = Readonly<{
  wildcard_ordinal: number;
  kind:
    | "array_object_by_field"
    | "array_index_by_ordinal"
    | "object_key_via_array_lookup";
  row_column: string;
  member_field?: string;
}>;
type RepositoryBinding = Readonly<{
  kind: "repository_artifact";
  path_source:
    | Readonly<{
        kind: "document_value";
        pointer_pattern: string;
        selectors: readonly RepositorySelector[];
      }>
    | Readonly<{ kind: "literal"; value: string }>
    | Readonly<{
        kind: "row_column";
        table: string;
        column: string;
        joins: readonly unknown[];
      }>;
  allowed_prefix: string;
  encoding: "exact_file_bytes";
  require_tracked: true;
  build_manifest_status: "pending_reviewed_manifest";
  null_result: "paired_null" | "reject";
}>;
type RepositoryBindingEntry = BindingEntry & {
  readonly binding: RepositoryBinding;
};

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value))
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
};

const isRepositoryBinding = (
  entry: BindingEntry,
): entry is RepositoryBindingEntry =>
  (entry.binding as { readonly kind?: unknown }).kind === "repository_artifact";

const fieldRecord = (row: GraphRow): Readonly<Record<string, Scalar>> =>
  Object.freeze(
    Object.fromEntries(row.fields.map((field) => [field.name, field.value])),
  );

const pointerTokens = (pointer: string): readonly string[] => {
  if (!pointer.startsWith("/")) throw new Error("repository pointer invalid");
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
};

const selectDocumentPath = (
  document: Json,
  pointer: string,
  selectors: readonly RepositorySelector[],
  row: Readonly<Record<string, Scalar>>,
): string | null => {
  let current: Json = document;
  let wildcardOrdinal = 0;
  for (const token of pointerTokens(pointer)) {
    if (token !== "*") {
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current) ||
        !Object.hasOwn(current, token)
      )
        throw new Error("repository pointer target missing");
      current = current[token] as Json;
      continue;
    }
    const selector = selectors.find(
      (candidate) => candidate.wildcard_ordinal === wildcardOrdinal,
    );
    wildcardOrdinal += 1;
    if (selector === undefined || !Array.isArray(current))
      throw new Error("repository selector missing");
    if (selector.kind === "array_index_by_ordinal") {
      const ordinal = row[selector.row_column];
      if (
        typeof ordinal !== "number" ||
        !Number.isSafeInteger(ordinal) ||
        Object.is(ordinal, -0) ||
        ordinal < 0 ||
        ordinal >= current.length
      )
        throw new Error("repository selector ordinal invalid");
      current = current[ordinal] as Json;
      continue;
    }
    if (selector.kind !== "array_object_by_field")
      throw new Error("repository selector kind unsupported in fixture");
    const expected = row[selector.row_column];
    const matches = current.filter(
      (candidate) =>
        candidate !== null &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        selector.member_field !== undefined &&
        Object.hasOwn(candidate, selector.member_field) &&
        candidate[selector.member_field] === expected,
    );
    if (matches.length !== 1)
      throw new Error("repository selector cardinality mismatch");
    current = matches[0] as Json;
  }
  if (current !== null && typeof current !== "string")
    throw new Error("repository path target must be string or null");
  return current;
};

export const isProvenanceV2RepositoryLogicalPath = (
  value: string,
  allowedPrefix: string,
): boolean => {
  const prefixSegments = allowedPrefix.endsWith("/")
    ? allowedPrefix.slice(0, -1).split("/")
    : [];
  if (
    allowedPrefix.length < 2 ||
    allowedPrefix.length > 128 ||
    !new RegExp(SAFE_PATH, "u").test(allowedPrefix) ||
    !allowedPrefix.endsWith("/") ||
    allowedPrefix.includes("\\") ||
    allowedPrefix.includes("//") ||
    allowedPrefix.includes(":") ||
    allowedPrefix.includes("?") ||
    allowedPrefix.includes("#") ||
    prefixSegments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    ) ||
    !new RegExp(SAFE_PATH, "u").test(value) ||
    !value.startsWith(allowedPrefix) ||
    value.includes("\\") ||
    value.includes("//") ||
    value.includes(":") ||
    value.includes("?") ||
    value.includes("#")
  )
    return false;
  const segments = value.split("/");
  return segments.every(
    (segment, index) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      (index < segments.length - 1 || !value.endsWith("/")),
  );
};

const document = PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.final_document
  .document as unknown as Json;
const repositoryBindings =
  PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(isRepositoryBinding);

const pathStatus = (
  path: string,
): "present_tracked_witness" | "missing_required_file" =>
  path === SEMANTIC_POLICY_PATH
    ? "present_tracked_witness"
    : "missing_required_file";

const resolutions = deepFreeze(
  repositoryBindings.map((entry) => {
    const sources = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.filter(
      (row) =>
        row.table === entry.table &&
        row.fields.some((field) => field.name === entry.field),
    );
    let sourceRowId: string | null = null;
    let path: string | null = null;
    let status:
      | "present_tracked_witness"
      | "missing_required_file"
      | "paired_null"
      | "missing_source_row";
    if (entry.binding.path_source.kind === "document_value") {
      if (sources.length !== 1)
        throw new Error("repository document source cardinality mismatch");
      const source = sources[0];
      if (source === undefined)
        throw new Error("repository document source missing");
      sourceRowId = source.row_id;
      path = selectDocumentPath(
        document,
        entry.binding.path_source.pointer_pattern,
        entry.binding.path_source.selectors,
        fieldRecord(source),
      );
      if (path === null) {
        if (entry.binding.null_result !== "paired_null")
          throw new Error("repository null path is not paired-null");
        status = "paired_null";
      } else status = pathStatus(path);
    } else if (entry.binding.path_source.kind === "literal") {
      path = entry.binding.path_source.value;
      status = pathStatus(path);
    } else {
      if (sources.length !== 0)
        throw new Error("repository pending row source unexpectedly exists");
      status = "missing_source_row";
    }
    if (
      path !== null &&
      !isProvenanceV2RepositoryLogicalPath(path, entry.binding.allowed_prefix)
    )
      throw new Error("repository path is outside its allowed prefix");
    const storedField =
      sources.length === 1
        ? sources[0]?.fields.find((field) => field.name === entry.field)
        : undefined;
    return {
      source_table: entry.table,
      source_field: entry.field,
      path_source_kind: entry.binding.path_source.kind,
      source_row_id: sourceRowId,
      logical_path: path,
      allowed_prefix: entry.binding.allowed_prefix,
      path_safe_and_within_prefix: path === null ? null : (true as const),
      null_result: entry.binding.null_result,
      require_tracked: entry.binding.require_tracked,
      build_manifest_status: entry.binding.build_manifest_status,
      stored_digest:
        storedField?.value === null || typeof storedField?.value === "string"
          ? storedField.value
          : null,
      resolution_status: status,
    };
  }),
);

const encodeUtf8 = (value: string): Uint8Array => {
  const output: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined)
      throw new Error("repository witness UTF-8 error");
    if (codePoint <= 0x7f) output.push(codePoint);
    else if (codePoint <= 0x7ff)
      output.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff)
      output.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    else
      output.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
  }
  return new Uint8Array(output);
};

const semanticPolicyBytes = encodeUtf8(
  `${JSON.stringify(PROVENANCE_V2_SEMANTIC_POLICY, null, 2)}\n`,
);
const bytesHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const hash = () => Type.String({ pattern: SHA256 });
const path = () => Type.String({ pattern: SAFE_PATH, maxLength: 512 });

export const ProvenanceV2RepositoryArtifactInventorySchema = Type.Object(
  {
    contract_version: Type.Literal(
      "provenance-v2-repository-artifact-inventory@1",
    ),
    status: Type.Literal("review_candidate"),
    coverage: Type.Literal(
      "complete_repository_binding_path_inventory_and_partial_exact_byte_witness",
    ),
    authority_eligible: Type.Literal(false),
    outcome: Type.Literal("authority_refused"),
    persisted: Type.Literal(false),
    available_repository_path_programs_executed: Type.Literal(true),
    repository_path_resolver_executed: Type.Literal(false),
    repository_artifact_resolver_executed: Type.Literal(false),
    reviewed_build_manifest_complete: Type.Literal(false),
    source_contracts: Type.Object(
      {
        root_binding_plan: Type.Literal(
          PROVENANCE_V2_ROOT_BINDING_PLAN.contract_version,
        ),
        connected_graph: Type.Literal(
          PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.contract_version,
        ),
        document_cascade: Type.Literal(
          PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.contract_version,
        ),
        semantic_policy: Type.Literal(
          PROVENANCE_V2_SEMANTIC_POLICY.contract_version,
        ),
      },
      { additionalProperties: false },
    ),
    evidence_counts: Type.Object(
      {
        binding_definitions: Type.Literal(10),
        document_path_executions: Type.Literal(5),
        literal_path_executions: Type.Literal(3),
        row_column_sources_pending: Type.Literal(2),
        paired_null_occurrences: Type.Literal(1),
        nonnull_path_occurrences: Type.Literal(7),
        present_tracked_witness_occurrences: Type.Literal(2),
        missing_required_file_occurrences: Type.Literal(5),
        distinct_present_files: Type.Literal(1),
        distinct_missing_paths: Type.Literal(5),
      },
      { additionalProperties: false },
    ),
    binding_inventory_encoding: Type.Literal(
      "ordered-json-of-table-field-path-source-prefix-null-tracking-status",
    ),
    binding_inventory_sha256: Type.Literal(REPOSITORY_BINDING_INVENTORY_SHA256),
    resolutions: Type.Array(
      Type.Object(
        {
          source_table: Type.String({ minLength: 1, maxLength: 96 }),
          source_field: Type.String({ minLength: 1, maxLength: 64 }),
          path_source_kind: Type.Union([
            Type.Literal("document_value"),
            Type.Literal("literal"),
            Type.Literal("row_column"),
          ]),
          source_row_id: Type.Union([
            Type.Null(),
            Type.String({ minLength: 1, maxLength: 160 }),
          ]),
          logical_path: Type.Union([Type.Null(), path()]),
          allowed_prefix: Type.String({ minLength: 2, maxLength: 128 }),
          path_safe_and_within_prefix: Type.Union([
            Type.Null(),
            Type.Literal(true),
          ]),
          null_result: Type.Union([
            Type.Literal("paired_null"),
            Type.Literal("reject"),
          ]),
          require_tracked: Type.Literal(true),
          build_manifest_status: Type.Literal("pending_reviewed_manifest"),
          stored_digest: Type.Union([Type.Null(), hash()]),
          resolution_status: Type.Union([
            Type.Literal("present_tracked_witness"),
            Type.Literal("missing_required_file"),
            Type.Literal("paired_null"),
            Type.Literal("missing_source_row"),
          ]),
        },
        { additionalProperties: false },
      ),
      { minItems: 10, maxItems: 10 },
    ),
    partial_build_witness: Type.Object(
      {
        contract_version: Type.Literal(
          "provenance-v2-partial-repository-build-witness@1",
        ),
        complete: Type.Literal(false),
        exact_vcs_commit_binding: Type.Literal("pending"),
        entries: Type.Array(
          Type.Object(
            {
              logical_path: Type.Literal(SEMANTIC_POLICY_PATH),
              byte_length: Type.Literal(1108),
              sha256: Type.Literal(SEMANTIC_POLICY_SHA256),
              exact_bytes_hex: Type.String({
                pattern: "^(?:[0-9a-f]{2}){1108}$",
              }),
              file_kind: Type.Literal("regular_file"),
              symlink_allowed: Type.Literal(false),
              tracked_requirement: Type.Literal(true),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: 1 },
        ),
      },
      { additionalProperties: false },
    ),
    missing_required_paths: Type.Array(path(), { minItems: 5, maxItems: 5 }),
    authority_boundary: Type.Object(
      {
        path_resolution_role: Type.Literal("review_evidence_only"),
        present_file_hash_role: Type.Literal("comparison_witness_only"),
        missing_artifact_result: Type.Literal("authority_refused"),
        approvals_invented: Type.Literal(false),
      },
      { additionalProperties: false },
    ),
    pending: Type.Object(
      {
        complete_reviewed_repository_build_manifest: Type.Literal("pending"),
        exact_vcs_commit_or_build_identity: Type.Literal("pending"),
        missing_repository_artifacts: Type.Literal("pending"),
        approval_and_revocation_semantics: Type.Literal("pending"),
        persisted_predecessor_rows: Type.Literal("pending"),
        document_output_projection_and_semantic_parity: Type.Literal("pending"),
        semantic_oracle: Type.Literal("pending"),
        migration_schema_parity: Type.Literal("pending"),
        frozen_d1_enumeration: Type.Literal("pending"),
        accepted_aggregate_limits: Type.Literal("pending"),
        protected_writers_and_activation: Type.Literal("pending"),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: "ProvenanceV2RepositoryArtifactInventory",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

const missingRequiredPaths = deepFreeze(
  [
    ...new Set(
      resolutions
        .filter(
          (resolution) =>
            resolution.resolution_status === "missing_required_file",
        )
        .map((resolution) => resolution.logical_path),
    ),
  ].filter((candidate): candidate is string => candidate !== null),
);

export const PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY = deepFreeze({
  contract_version: "provenance-v2-repository-artifact-inventory@1",
  status: "review_candidate",
  coverage:
    "complete_repository_binding_path_inventory_and_partial_exact_byte_witness",
  authority_eligible: false,
  outcome: "authority_refused",
  persisted: false,
  available_repository_path_programs_executed: true,
  repository_path_resolver_executed: false,
  repository_artifact_resolver_executed: false,
  reviewed_build_manifest_complete: false,
  source_contracts: {
    root_binding_plan: PROVENANCE_V2_ROOT_BINDING_PLAN.contract_version,
    connected_graph:
      PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.contract_version,
    document_cascade:
      PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.contract_version,
    semantic_policy: PROVENANCE_V2_SEMANTIC_POLICY.contract_version,
  },
  evidence_counts: {
    binding_definitions: 10,
    document_path_executions: 5,
    literal_path_executions: 3,
    row_column_sources_pending: 2,
    paired_null_occurrences: 1,
    nonnull_path_occurrences: 7,
    present_tracked_witness_occurrences: 2,
    missing_required_file_occurrences: 5,
    distinct_present_files: 1,
    distinct_missing_paths: 5,
  },
  binding_inventory_encoding:
    "ordered-json-of-table-field-path-source-prefix-null-tracking-status",
  binding_inventory_sha256: REPOSITORY_BINDING_INVENTORY_SHA256,
  resolutions,
  partial_build_witness: {
    contract_version: "provenance-v2-partial-repository-build-witness@1",
    complete: false,
    exact_vcs_commit_binding: "pending",
    entries: [
      {
        logical_path: SEMANTIC_POLICY_PATH,
        byte_length: semanticPolicyBytes.byteLength,
        sha256: SEMANTIC_POLICY_SHA256,
        exact_bytes_hex: bytesHex(semanticPolicyBytes),
        file_kind: "regular_file",
        symlink_allowed: false,
        tracked_requirement: true,
      },
    ],
  },
  missing_required_paths: missingRequiredPaths,
  authority_boundary: {
    path_resolution_role: "review_evidence_only",
    present_file_hash_role: "comparison_witness_only",
    missing_artifact_result: "authority_refused",
    approvals_invented: false,
  },
  pending: {
    complete_reviewed_repository_build_manifest: "pending",
    exact_vcs_commit_or_build_identity: "pending",
    missing_repository_artifacts: "pending",
    approval_and_revocation_semantics: "pending",
    persisted_predecessor_rows: "pending",
    document_output_projection_and_semantic_parity: "pending",
    semantic_oracle: "pending",
    migration_schema_parity: "pending",
    frozen_d1_enumeration: "pending",
    accepted_aggregate_limits: "pending",
    protected_writers_and_activation: "pending",
  },
} as const);

const utf8LengthWithin = (value: string, maximum: number): number => {
  if (value.length > maximum) return maximum + 1;
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined || (codePoint >= 0xd800 && codePoint <= 0xdfff))
      return maximum + 1;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
    if (bytes > maximum) return maximum + 1;
    if (codePoint > 0xffff) index += 1;
  }
  return bytes;
};

const snapshotPlainData = (
  value: unknown,
  seen = new Set<object>(),
  budget = { nodes: 0, properties: 0, stringBytes: 0 },
  depth = 0,
): unknown => {
  if (typeof value === "string") {
    budget.stringBytes += utf8LengthWithin(value, 200_000 - budget.stringBytes);
    return budget.stringBytes <= 200_000 ? value : undefined;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isSafeInteger(value) && !Object.is(value, -0)
      ? value
      : undefined;
  if (typeof value !== "object" || depth > 24 || seen.has(value))
    return undefined;
  let prototype: object | null;
  let keys: readonly (string | symbol)[];
  try {
    prototype = Reflect.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return undefined;
  }
  if (++budget.nodes > 5_000 || keys.length > 256) return undefined;
  budget.properties += keys.length;
  if (budget.properties > 20_000 || keys.some((key) => typeof key === "symbol"))
    return undefined;
  if (Array.isArray(value)) {
    let lengthDescriptor: PropertyDescriptor | undefined;
    try {
      lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    } catch {
      return undefined;
    }
    if (
      prototype !== Array.prototype ||
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > 512 ||
      keys.length !== lengthDescriptor.value + 1
    )
      return undefined;
    const length = lengthDescriptor.value;
    const output: unknown[] = [];
    seen.add(value);
    for (let index = 0; index < length; index += 1) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      } catch {
        return undefined;
      }
      if (descriptor === undefined || !("value" in descriptor))
        return undefined;
      const child = snapshotPlainData(
        descriptor.value,
        seen,
        budget,
        depth + 1,
      );
      if (child === undefined) return undefined;
      output.push(child);
    }
    seen.delete(value);
    return output;
  }
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const output = Object.create(null) as Record<string, unknown>;
  seen.add(value);
  for (const key of keys as readonly string[]) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      return undefined;
    }
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const child = snapshotPlainData(descriptor.value, seen, budget, depth + 1);
    if (child === undefined) return undefined;
    Object.defineProperty(output, key, {
      value: child,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  seen.delete(value);
  return output;
};

export const validateProvenanceV2RepositoryArtifactInventory = (
  candidate: unknown,
): readonly string[] => {
  const snapshot = snapshotPlainData(candidate);
  if (
    snapshot === undefined ||
    !Value.Check(ProvenanceV2RepositoryArtifactInventorySchema, snapshot)
  )
    return ["repository artifact inventory does not match its closed schema"];
  if (
    JSON.stringify(snapshot) !==
    JSON.stringify(PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY)
  )
    return [
      "repository artifact inventory differs from the reviewed singleton",
    ];
  return [];
};
