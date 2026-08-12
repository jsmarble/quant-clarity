import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY } from "./provenance-v2-registration.js";

const REVIEW_CANDIDATE_SCHEMA = {
  "x-quantclarity-contract-status": "review_candidate",
} as const;

const machineName = () => Type.String({ pattern: "^[a-z][a-z0-9_]*$" });
const tableName = () =>
  Type.String({
    pattern:
      "^(provenance_v2|publication_run_plan|source_compliance_record)[a-z0-9_]*$",
  });
const columnName = machineName;
const pointerPattern = () =>
  Type.String({ pattern: "^/(?:[^/~]|~[01]|\\*)+(?:/(?:[^/~]|~[01]|\\*)+)*$" });

const JoinSchema = Type.Object(
  {
    local_column: columnName(),
    remote_column: columnName(),
  },
  { additionalProperties: false },
);

const SelectorSchema = Type.Union([
  Type.Object(
    {
      wildcard_ordinal: Type.Integer({ minimum: 0, maximum: 15 }),
      kind: Type.Literal("array_object_by_field"),
      row_column: columnName(),
      member_field: machineName(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      wildcard_ordinal: Type.Integer({ minimum: 0, maximum: 15 }),
      kind: Type.Literal("array_index_by_ordinal"),
      row_column: columnName(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      wildcard_ordinal: Type.Integer({ minimum: 0, maximum: 15 }),
      kind: Type.Literal("object_key_via_array_lookup"),
      row_column: columnName(),
      lookup_array_pointer: pointerPattern(),
      lookup_match_field: machineName(),
      lookup_value_field: machineName(),
    },
    { additionalProperties: false },
  ),
]);
type Selector = Static<typeof SelectorSchema>;

const DigestBindingSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("leaf_output") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("document_value"),
      document: Type.Literal("registration_plan"),
      pointer_pattern: pointerPattern(),
      selectors: Type.Array(SelectorSchema, { maxItems: 4 }),
      encoding: Type.Union([
        Type.Literal("rfc8785_jcs"),
        Type.Literal("nfc_utf8"),
      ]),
      null_result: Type.Union([Type.Literal("null"), Type.Literal("reject")]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("retained_bytes"),
      source: Type.Union([
        Type.Object(
          {
            kind: Type.Literal("exact_row_blob"),
            table: tableName(),
            bytes_column: columnName(),
            length_column: columnName(),
            joins: Type.Array(JoinSchema, { minItems: 1 }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal("contiguous_chunk_sequence"),
            table: tableName(),
            bytes_column: columnName(),
            ordinal_column: columnName(),
            offset_column: columnName(),
            length_column: columnName(),
            joins: Type.Array(JoinSchema, { minItems: 1 }),
            count_table: tableName(),
            count_column: columnName(),
            total_length_column: columnName(),
          },
          { additionalProperties: false },
        ),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("external_row_digest"),
      table: tableName(),
      digest_column: columnName(),
      joins: Type.Array(JoinSchema, { minItems: 1 }),
      required_predicates: Type.Array(
        Type.Object(
          {
            column: columnName(),
            value: Type.Union([Type.String(), Type.Integer(), Type.Boolean()]),
          },
          { additionalProperties: false },
        ),
      ),
      cardinality: Type.Literal("exactly_one"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("repository_artifact"),
      path_source: Type.Union([
        Type.Object(
          {
            kind: Type.Literal("document_value"),
            pointer_pattern: pointerPattern(),
            selectors: Type.Array(SelectorSchema, { maxItems: 4 }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal("row_column"),
            table: tableName(),
            column: columnName(),
            joins: Type.Array(JoinSchema, { minItems: 1 }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal("literal"),
            value: Type.String({ minLength: 1, maxLength: 512 }),
          },
          { additionalProperties: false },
        ),
      ]),
      allowed_prefix: Type.String({ pattern: "^[a-z][a-z0-9_/-]*/$" }),
      encoding: Type.Literal("exact_file_bytes"),
      require_tracked: Type.Literal(true),
      build_manifest_status: Type.Literal("pending_reviewed_manifest"),
      null_result: Type.Union([
        Type.Literal("paired_null"),
        Type.Literal("reject"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("row_digest"),
      table: tableName(),
      digest_column: columnName(),
      joins: Type.Array(JoinSchema, { minItems: 1 }),
      digest_source: Type.Literal("independently_recomputed_leaf"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("collection_digest"),
      traversal: machineName(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("record_frame_digest"),
      record_frame: machineName(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("frame_output"),
      record_frame: machineName(),
    },
    { additionalProperties: false },
  ),
]);

const CountBindingSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("document_array_length"),
      pointer_pattern: pointerPattern(),
      selectors: Type.Array(SelectorSchema, { maxItems: 4 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("document_declared_integer"),
      pointer_pattern: pointerPattern(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("document_filtered_array_length"),
      pointer_pattern: pointerPattern(),
      selectors: Type.Array(SelectorSchema, { maxItems: 4 }),
      predicate: Type.Object(
        {
          member_field: machineName(),
          equals: Type.String({ minLength: 1, maxLength: 128 }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("contract_sequence_length"),
      artifact: Type.String({ minLength: 1, maxLength: 512 }),
      pointer_pattern: pointerPattern(),
      selectors: Type.Array(SelectorSchema, { maxItems: 4 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("row_integer"),
      table: tableName(),
      column: columnName(),
      joins: Type.Array(JoinSchema, { minItems: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("computed_sequence_length"),
      traversal: machineName(),
    },
    { additionalProperties: false },
  ),
]);

const OrderFieldSchema = Type.Object(
  {
    column: columnName(),
    frame_type: Type.Union([Type.Literal("text"), Type.Literal("integer")]),
    direction: Type.Literal("asc"),
    comparison: Type.Union([
      Type.Literal("integer"),
      Type.Literal("utf8_binary"),
    ]),
  },
  { additionalProperties: false },
);

const ScopeJoinSchema = Type.Object(
  {
    scope_column: columnName(),
    row_column: columnName(),
  },
  { additionalProperties: false },
);

const LookupStepSchema = Type.Object(
  {
    table: tableName(),
    cardinality: Type.Literal("exactly_one"),
    joins: Type.Array(
      Type.Object(
        {
          left: Type.Union([
            Type.Object(
              { kind: Type.Literal("scope"), column: columnName() },
              { additionalProperties: false },
            ),
            Type.Object(
              { kind: Type.Literal("prior_row"), column: columnName() },
              { additionalProperties: false },
            ),
          ]),
          right_column: columnName(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);

const TraversalSourceSchema = Type.Object(
  {
    ordinal: Type.Integer({ minimum: 0, maximum: 255 }),
    table: tableName(),
    family_tag: machineName(),
    scope_binding: Type.Union([
      Type.Object(
        {
          kind: Type.Literal("plan_scope"),
          joins: Type.Array(ScopeJoinSchema, { minItems: 1 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          kind: Type.Literal("global_contract"),
          artifact: Type.Literal(
            "contracts/generated/provenance-v2/field-corpus.v1.json",
          ),
          contract_version: Type.Literal("provenance-v2-field-corpus@1"),
        },
        { additionalProperties: false },
      ),
    ]),
    cardinality: Type.Union([
      Type.Literal("one"),
      Type.Literal("zero_or_one"),
      Type.Literal("many"),
    ]),
    order_by: Type.Array(OrderFieldSchema, { minItems: 1 }),
    digest_column: Type.Union([columnName(), Type.Null()]),
    digest_source: Type.Union([
      Type.Literal("independently_recomputed_leaf"),
      Type.Literal("independently_recomputed_child_traversal"),
    ]),
    child_traversal: Type.Union([machineName(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const ProvenanceV2RootBindingPlanSchema = Type.Object(
  {
    contract_version: Type.Literal("provenance-v2-root-binding-plan@1"),
    status: Type.Literal("review_candidate"),
    registry_contract_version: Type.Literal("provenance-v2-root-registry@1"),
    target_migration: Type.Literal(
      "0010_activate_provenance_v2_registration.sql",
    ),
    migration_schema_closure_status: Type.Literal("pending_target_migration"),
    traversal_contract: Type.Object(
      {
        member_projection_domain: Type.Literal(
          "provenance-v2-traversal-member@1",
        ),
        member_projection_fields: Type.Array(
          Type.Union([
            Type.Literal("source_ordinal:integer"),
            Type.Literal("family_tag:text"),
            Type.Literal("member_digest:digest"),
          ]),
          { minItems: 3, maxItems: 3, uniqueItems: true },
        ),
        source_order: Type.Literal("dense_source_ordinal_ascending"),
        row_order: Type.Literal("complete_declared_order_tuple_ascending"),
        collection_frame: Type.Literal(
          "scope_fields_then_total_member_count_then_projected_member_digests",
        ),
        caller_order_authoritative: Type.Literal(false),
      },
      { additionalProperties: false },
    ),
    digest_bindings: Type.Array(
      Type.Object(
        {
          table: tableName(),
          field: columnName(),
          hash_class: Type.Union([
            Type.Literal("digest_output"),
            Type.Literal("safe_preimage"),
            Type.Literal("external_anchor"),
            Type.Literal("top_level_root"),
            Type.Literal("lifecycle_metadata"),
          ]),
          binding: DigestBindingSchema,
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    count_bindings: Type.Array(
      Type.Object(
        {
          table: tableName(),
          binding: CountBindingSchema,
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    traversals: Type.Array(
      Type.Object(
        {
          name: machineName(),
          kind: Type.Literal("ordered_digest_set"),
          purpose: Type.Union([
            Type.Literal("plan_root"),
            Type.Literal("successor_claim"),
          ]),
          domain: Type.String({ pattern: "^provenance-v2-[a-z0-9-]+@1$" }),
          scope_columns: Type.Array(columnName(), { minItems: 1 }),
          zero_members: Type.Union([
            Type.Literal("allowed"),
            Type.Literal("rejected"),
          ]),
          sources: Type.Array(TraversalSourceSchema, { minItems: 1 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    record_frames: Type.Array(
      Type.Object(
        {
          name: machineName(),
          domain: Type.String({ pattern: "^provenance-v2-[a-z0-9-]+@1$" }),
          fields: Type.Array(
            Type.Object(
              {
                ordinal: Type.Integer({ minimum: 0, maximum: 255 }),
                name: machineName(),
                frame_type: Type.Union([
                  Type.Literal("text"),
                  Type.Literal("integer"),
                  Type.Literal("boolean"),
                  Type.Literal("digest"),
                ]),
                source: Type.Union([
                  Type.Object(
                    {
                      kind: Type.Literal("row_column"),
                      lookup: Type.Array(LookupStepSchema, { minItems: 1 }),
                      column: columnName(),
                    },
                    { additionalProperties: false },
                  ),
                  Type.Object(
                    {
                      kind: Type.Literal("collection"),
                      traversal: machineName(),
                    },
                    { additionalProperties: false },
                  ),
                ]),
              },
              { additionalProperties: false },
            ),
            { minItems: 1 },
          ),
        },
        { additionalProperties: false },
      ),
      { minItems: 2 },
    ),
    successor_claim_bindings: Type.Array(
      Type.Object(
        {
          field: machineName(),
          kind: Type.Union([
            Type.Literal("count"),
            Type.Literal("collection_digest"),
            Type.Literal("row_digest"),
          ]),
          traversal: Type.Union([machineName(), Type.Null()]),
          table: Type.Union([tableName(), Type.Null()]),
          column: Type.Union([columnName(), Type.Null()]),
          scope_joins: Type.Array(ScopeJoinSchema),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  {
    $id: "ProvenanceV2RootBindingPlan",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

const binding = (
  table: string,
  field: string,
  hashClass:
    | "digest_output"
    | "safe_preimage"
    | "external_anchor"
    | "top_level_root"
    | "lifecycle_metadata",
  resolver: unknown,
) => Object.freeze({ table, field, hash_class: hashClass, binding: resolver });

const leaf = (table: string, field: string) =>
  binding(
    table,
    field,
    "digest_output",
    Object.freeze({ kind: "leaf_output" }),
  );

const selector = (
  wildcardOrdinal: number,
  rowColumn: string,
  memberField: string,
) =>
  Object.freeze({
    wildcard_ordinal: wildcardOrdinal,
    kind: "array_object_by_field",
    row_column: rowColumn,
    member_field: memberField,
  });

const indexSelector = (wildcardOrdinal: number, rowColumn: string) =>
  Object.freeze({
    wildcard_ordinal: wildcardOrdinal,
    kind: "array_index_by_ordinal",
    row_column: rowColumn,
  });

const contractKeySelector = (
  wildcardOrdinal: number,
  rowColumn: string,
  lookupArrayPointer: string,
  lookupMatchField: string,
  lookupValueField: string,
) =>
  Object.freeze({
    wildcard_ordinal: wildcardOrdinal,
    kind: "object_key_via_array_lookup",
    row_column: rowColumn,
    lookup_array_pointer: lookupArrayPointer,
    lookup_match_field: lookupMatchField,
    lookup_value_field: lookupValueField,
  });

const documentValue = (
  table: string,
  field: string,
  pointer: string,
  encoding: "rfc8785_jcs" | "nfc_utf8",
  selectors: readonly Selector[] = [],
  nullResult: "null" | "reject" = "reject",
) =>
  binding(
    table,
    field,
    "safe_preimage",
    Object.freeze({
      kind: "document_value",
      document: "registration_plan",
      pointer_pattern: pointer,
      selectors: Object.freeze([...selectors]),
      encoding,
      null_result: nullResult,
    }),
  );

const joins = (...pairs: readonly (readonly [string, string])[]) =>
  Object.freeze(
    pairs.map(([local_column, remote_column]) =>
      Object.freeze({ local_column, remote_column }),
    ),
  );

const externalRow = (
  table: string,
  field: string,
  targetTable: string,
  targetDigest: string,
  keyJoins: ReturnType<typeof joins>,
  requiredPredicates: readonly {
    readonly column: string;
    readonly value: string | number | boolean;
  }[] = [],
) =>
  binding(
    table,
    field,
    "external_anchor",
    Object.freeze({
      kind: "external_row_digest",
      table: targetTable,
      digest_column: targetDigest,
      joins: keyJoins,
      required_predicates: Object.freeze([...requiredPredicates]),
      cardinality: "exactly_one",
    }),
  );

const repositoryArtifact = (
  table: string,
  field: string,
  pathSource:
    | {
        readonly kind: "document_value";
        readonly pointer_pattern: string;
        readonly selectors: readonly Selector[];
      }
    | {
        readonly kind: "row_column";
        readonly table: string;
        readonly column: string;
        readonly joins: ReturnType<typeof joins>;
      }
    | { readonly kind: "literal"; readonly value: string },
  prefix: string,
  nullResult: "paired_null" | "reject" = "reject",
) =>
  binding(
    table,
    field,
    "external_anchor",
    Object.freeze({
      kind: "repository_artifact",
      path_source: Object.freeze(
        pathSource.kind === "document_value"
          ? {
              ...pathSource,
              selectors: Object.freeze([...pathSource.selectors]),
            }
          : pathSource,
      ),
      allowed_prefix: prefix,
      encoding: "exact_file_bytes",
      require_tracked: true,
      build_manifest_status: "pending_reviewed_manifest",
      null_result: nullResult,
    }),
  );

const rowDigest = (
  table: string,
  field: string,
  targetTable: string,
  targetField: string,
  keyJoins: ReturnType<typeof joins>,
) =>
  binding(
    table,
    field,
    "top_level_root",
    Object.freeze({
      kind: "row_digest",
      table: targetTable,
      digest_column: targetField,
      joins: keyJoins,
      digest_source: "independently_recomputed_leaf",
    }),
  );

const collectionDigest = (table: string, field: string, traversal: string) =>
  binding(
    table,
    field,
    "top_level_root",
    Object.freeze({ kind: "collection_digest", traversal }),
  );

const recordFrameDigest = (table: string, field: string, recordFrame: string) =>
  binding(
    table,
    field,
    "top_level_root",
    Object.freeze({ kind: "record_frame_digest", record_frame: recordFrame }),
  );

const providerSelector = selector(0, "provider_id", "provider_id");
const endpointSelector = selector(0, "endpoint_id", "endpoint_id");
const policySelector = selector(0, "record_group", "record_group");

const LEAF_OUTPUTS = [
  ["provenance_v2_source_register_receipt", "receipt_content_hash"],
  ["provenance_v2_source_register_member", "member_hash"],
  ["provenance_v2_adapter_manifest_receipt", "manifest_content_hash"],
  ["provenance_v2_adapter_manifest_environment", "member_hash"],
  ["provenance_v2_adapter_manifest_credential", "member_hash"],
  ["provenance_v2_adapter_manifest_source", "manifest_source_hash"],
  ["provenance_v2_source_endpoint", "endpoint_content_hash"],
  ["provenance_v2_source_endpoint_registration", "registration_hash"],
  ["provenance_v2_source_endpoint_request", "request_content_hash"],
  ["provenance_v2_source_endpoint_parameter", "parameter_hash"],
  ["provenance_v2_source_endpoint_parameter_enum", "member_hash"],
  ["provenance_v2_source_endpoint_allowed_header", "member_hash"],
  ["provenance_v2_source_endpoint_redirect_host", "member_hash"],
  ["provenance_v2_source_endpoint_content_type", "member_hash"],
  ["provenance_v2_source_endpoint_expected_field", "member_hash"],
  ["provenance_v2_source_endpoint_raw_field_mapping", "mapping_content_hash"],
  ["provenance_v2_verifier_implementation", "content_hash"],
  ["provenance_v2_verifier_policy", "content_hash"],
  ["provenance_v2_verifier_policy_member", "member_hash"],
  ["provenance_v2_field_path_vocabulary", "member_hash"],
  ["provenance_v2_field_path_authority_role", "member_hash"],
  ["provenance_v2_field_path_enum_value", "member_hash"],
  ["provenance_v2_field_record_group", "group_hash"],
  ["provenance_v2_field_record_group_member", "member_hash"],
  ["provenance_v2_field_policy", "content_hash"],
  ["provenance_v2_field_policy_member", "member_hash"],
  ["provenance_v2_field_policy_precedence_class", "class_hash"],
  ["provenance_v2_field_policy_precedence_class_source", "member_hash"],
  ["provenance_v2_field_policy_precedence_edge", "edge_hash"],
  ["provenance_v2_field_policy_endpoint_admission", "member_hash"],
  ["provenance_v2_field_policy_endpoint_exclusion", "member_hash"],
] as const;

const DOCUMENT_VALUES = [
  documentValue(
    "provenance_v2_source_owner_receipt",
    "identity_content_hash",
    "/adapter_receipts/*/source_owner_receipts/*/identity_preimage",
    "nfc_utf8",
    [
      providerSelector,
      selector(1, "owner_organization_id", "owner_organization_id"),
    ],
  ),
  documentValue(
    "provenance_v2_adapter_manifest_receipt",
    "adapter_manifest_hash",
    "/adapter_receipts/*/legacy_manifest",
    "rfc8785_jcs",
    [providerSelector],
  ),
  documentValue(
    "provenance_v2_adapter_manifest_receipt",
    "successor_manifest_hash",
    "/adapter_receipts/*/successor_manifest",
    "rfc8785_jcs",
    [providerSelector],
  ),
  documentValue(
    "provenance_v2_adapter_manifest_credential",
    "purpose_hash",
    "/adapter_receipts/*/normalized_credentials/*/purpose",
    "nfc_utf8",
    [providerSelector, selector(1, "ordinal", "ordinal")],
  ),
  documentValue(
    "provenance_v2_adapter_manifest_source",
    "path_template_hash",
    "/adapter_receipts/*/normalized_sources/*/path_template",
    "nfc_utf8",
    [providerSelector, selector(1, "source_id", "source_id")],
  ),
  documentValue(
    "provenance_v2_source_endpoint",
    "path_template_hash",
    "/endpoints/*/path_template",
    "nfc_utf8",
    [endpointSelector],
  ),
  documentValue(
    "provenance_v2_source_endpoint",
    "adapter_manifest_hash",
    "/adapter_receipts/*/legacy_manifest",
    "rfc8785_jcs",
    [providerSelector],
  ),
  documentValue(
    "provenance_v2_source_endpoint_registration",
    "path_template_hash",
    "/endpoints/*/path_template",
    "nfc_utf8",
    [endpointSelector],
  ),
  documentValue(
    "provenance_v2_source_endpoint_registration",
    "adapter_manifest_hash",
    "/adapter_receipts/*/legacy_manifest",
    "rfc8785_jcs",
    [providerSelector],
  ),
  documentValue(
    "provenance_v2_source_endpoint_request",
    "safe_locator_template_hash",
    "/endpoints/*/safe_locator_template",
    "nfc_utf8",
    [endpointSelector],
  ),
  documentValue(
    "provenance_v2_source_endpoint_request",
    "pagination_hash",
    "/endpoints/*/pagination",
    "rfc8785_jcs",
    [endpointSelector],
  ),
  documentValue(
    "provenance_v2_source_endpoint_request",
    "provider_rate_limit_hash",
    "/endpoints/*/provider_rate_limit",
    "rfc8785_jcs",
    [endpointSelector],
  ),
  documentValue(
    "provenance_v2_source_endpoint_request",
    "crawl_purpose_hash",
    "/endpoints/*/crawl_purpose",
    "nfc_utf8",
    [endpointSelector],
  ),
  documentValue(
    "provenance_v2_source_endpoint_request",
    "robots_policy_hash",
    "/endpoints/*/robots_policy",
    "rfc8785_jcs",
    [endpointSelector],
  ),
  documentValue(
    "provenance_v2_source_endpoint_request",
    "content_signals_policy_hash",
    "/endpoints/*/content_signals_policy",
    "rfc8785_jcs",
    [endpointSelector],
  ),
  documentValue(
    "provenance_v2_source_endpoint_parameter",
    "pattern_hash",
    "/endpoints/*/parameters/*/pattern",
    "nfc_utf8",
    [endpointSelector, selector(1, "ordinal", "ordinal")],
    "null",
  ),
  documentValue(
    "provenance_v2_source_endpoint_parameter_enum",
    "value_hash",
    "/endpoints/*/parameters/*/enum_values/*",
    "nfc_utf8",
    [
      endpointSelector,
      selector(1, "parameter_ordinal", "ordinal"),
      indexSelector(2, "ordinal"),
    ],
  ),
  documentValue(
    "provenance_v2_field_policy",
    "canonical_bytes_hash",
    "/field_policies/*/canonical_policy_preimage",
    "rfc8785_jcs",
    [policySelector],
  ),
] as const;

const SOURCE_COMPLIANCE_PREDICATES = Object.freeze([
  Object.freeze({ column: "approval_state", value: "approved" }),
  Object.freeze({ column: "access_permitted", value: 1 }),
  Object.freeze({ column: "retention_permitted", value: 1 }),
  Object.freeze({ column: "publication_permitted", value: 1 }),
]);

const EXTERNAL_BINDINGS = [
  repositoryArtifact(
    "provenance_v2_source_owner_receipt",
    "relationship_approval_hash",
    {
      kind: "document_value",
      pointer_pattern:
        "/adapter_receipts/*/source_owner_receipts/*/relationship_approval_artifact_path",
      selectors: [
        providerSelector,
        selector(1, "owner_organization_id", "owner_organization_id"),
      ],
    },
    "docs/compliance/source-relationships/",
  ),
  externalRow(
    "provenance_v2_source_register_receipt",
    "artifact_hash",
    "source_compliance_record",
    "artifact_hash",
    joins(
      ["provider_id", "provider_id"],
      ["register_version", "register_version"],
    ),
    SOURCE_COMPLIANCE_PREDICATES,
  ),
  externalRow(
    "provenance_v2_source_register_member",
    "artifact_hash",
    "source_compliance_record",
    "artifact_hash",
    joins(
      ["provider_id", "provider_id"],
      ["register_version", "register_version"],
    ),
    SOURCE_COMPLIANCE_PREDICATES,
  ),
  externalRow(
    "provenance_v2_adapter_manifest_receipt",
    "roster_content_hash",
    "publication_run_plan_provider",
    "roster_content_hash",
    joins(["run_plan_id", "run_plan_id"], ["provider_id", "provider_id"]),
  ),
  externalRow(
    "provenance_v2_adapter_manifest_receipt",
    "source_artifact_hash",
    "source_compliance_record",
    "artifact_hash",
    joins(
      ["provider_id", "provider_id"],
      ["source_register_version", "register_version"],
    ),
    SOURCE_COMPLIANCE_PREDICATES,
  ),
  externalRow(
    "provenance_v2_source_endpoint",
    "source_register_artifact_hash",
    "source_compliance_record",
    "artifact_hash",
    joins(
      ["provider_id", "provider_id"],
      ["source_register_version", "register_version"],
    ),
    SOURCE_COMPLIANCE_PREDICATES,
  ),
  externalRow(
    "provenance_v2_source_endpoint_registration",
    "source_register_artifact_hash",
    "source_compliance_record",
    "artifact_hash",
    joins(
      ["provider_id", "provider_id"],
      ["source_register_version", "register_version"],
    ),
    SOURCE_COMPLIANCE_PREDICATES,
  ),
  repositoryArtifact(
    "provenance_v2_source_endpoint_approval",
    "approval_artifact_hash",
    {
      kind: "document_value",
      pointer_pattern: "/endpoints/*/approval/approval_artifact_path",
      selectors: [endpointSelector],
    },
    "docs/compliance/endpoints/",
  ),
  repositoryArtifact(
    "provenance_v2_verifier_implementation",
    "implementation_artifact_hash",
    {
      kind: "document_value",
      pointer_pattern:
        "/verifier_implementations/*/implementation_artifact_path",
      selectors: [selector(0, "implementation_key", "implementation_key")],
    },
    "packages/",
  ),
  repositoryArtifact(
    "provenance_v2_verifier_implementation",
    "prompt_hash",
    {
      kind: "document_value",
      pointer_pattern: "/verifier_implementations/*/prompt_artifact_path",
      selectors: [selector(0, "implementation_key", "implementation_key")],
    },
    "packages/",
    "paired_null",
  ),
  repositoryArtifact(
    "provenance_v2_verifier_implementation",
    "deterministic_procedure_hash",
    {
      kind: "document_value",
      pointer_pattern:
        "/verifier_implementations/*/deterministic_procedure_artifact_path",
      selectors: [selector(0, "implementation_key", "implementation_key")],
    },
    "docs/compliance/provenance-v2/",
    "paired_null",
  ),
  externalRow(
    "provenance_v2_authority_plan",
    "run_plan_hash",
    "publication_run_plan_seal",
    "plan_hash",
    joins(["run_plan_id", "run_plan_id"]),
  ),
  repositoryArtifact(
    "provenance_v2_authority_plan",
    "semantic_policy_hash",
    {
      kind: "literal",
      value: "contracts/generated/provenance-v2/registration-semantics.v1.json",
    },
    "contracts/generated/provenance-v2/",
  ),
  repositoryArtifact(
    "provenance_v2_authority_plan_oracle_receipt",
    "oracle_implementation_hash",
    { kind: "literal", value: "packages/pipeline/src/provenance-v2-oracle.ts" },
    "packages/",
  ),
  repositoryArtifact(
    "provenance_v2_authority_plan_oracle_receipt",
    "semantic_policy_hash",
    {
      kind: "literal",
      value: "contracts/generated/provenance-v2/registration-semantics.v1.json",
    },
    "contracts/generated/provenance-v2/",
  ),
  repositoryArtifact(
    "provenance_v2_authority_plan_approval_intent",
    "artifact_hash",
    {
      kind: "row_column",
      table: "provenance_v2_authority_plan_approval_intent",
      column: "artifact_path",
      joins: joins(["authority_plan_id", "authority_plan_id"]),
    },
    "docs/compliance/provenance-v2/",
  ),
  repositoryArtifact(
    "provenance_v2_authority_plan_approval",
    "artifact_hash",
    {
      kind: "row_column",
      table: "provenance_v2_authority_plan_approval_intent",
      column: "artifact_path",
      joins: joins(["authority_plan_id", "authority_plan_id"]),
    },
    "docs/compliance/provenance-v2/",
  ),
] as const;

const ROOT_BINDINGS = [
  collectionDigest(
    "provenance_v2_source_register_receipt",
    "member_set_root",
    "source_register_member_set_root",
  ),
  rowDigest(
    "provenance_v2_source_endpoint_registration",
    "endpoint_content_hash",
    "provenance_v2_source_endpoint",
    "endpoint_content_hash",
    joins(
      ["authority_plan_id", "authority_plan_id"],
      ["endpoint_id", "endpoint_id"],
    ),
  ),
  rowDigest(
    "provenance_v2_source_endpoint_registration",
    "manifest_source_hash",
    "provenance_v2_adapter_manifest_source",
    "manifest_source_hash",
    joins(
      ["authority_plan_id", "authority_plan_id"],
      ["provider_id", "provider_id"],
      ["source_id", "source_id"],
    ),
  ),
  ...[
    "endpoint",
    "field_policy",
    "verifier_policy",
    "adapter_manifest",
  ].flatMap((name) => [
    collectionDigest(
      "provenance_v2_authority_plan",
      `${name}_set_root`,
      `${name}_set_root`,
    ),
    collectionDigest(
      "provenance_v2_authority_plan_oracle_receipt",
      `${name}_set_root`,
      `${name}_set_root`,
    ),
  ]),
  recordFrameDigest(
    "provenance_v2_authority_plan_registration_close",
    "claimed_authority_root",
    "authority_root",
  ),
  recordFrameDigest(
    "provenance_v2_authority_plan_oracle_receipt",
    "authority_root",
    "authority_root",
  ),
  recordFrameDigest(
    "provenance_v2_authority_plan_seal",
    "authority_root",
    "authority_root",
  ),
  recordFrameDigest(
    "provenance_v2_authority_plan_approval_intent",
    "authority_root",
    "authority_root",
  ),
  binding(
    "provenance_v2_authority_plan_oracle_receipt",
    "receipt_hash",
    "lifecycle_metadata",
    Object.freeze({
      kind: "frame_output",
      record_frame: "oracle_receipt_hash",
    }),
  ),
] as const;

const retained = (
  table: string,
  field: string,
  source:
    | {
        readonly kind: "exact_row_blob";
        readonly table: string;
        readonly bytes_column: string;
        readonly length_column: string;
        readonly joins: ReturnType<typeof joins>;
      }
    | {
        readonly kind: "contiguous_chunk_sequence";
        readonly table: string;
        readonly bytes_column: string;
        readonly ordinal_column: string;
        readonly offset_column: string;
        readonly length_column: string;
        readonly joins: ReturnType<typeof joins>;
        readonly count_table: string;
        readonly count_column: string;
        readonly total_length_column: string;
      },
) =>
  binding(
    table,
    field,
    "safe_preimage",
    Object.freeze({
      kind: "retained_bytes",
      source: Object.freeze(source),
    }),
  );

const count = (table: string, resolver: unknown) =>
  Object.freeze({ table, binding: resolver });

const arrayCount = (
  table: string,
  pointer: string,
  selectors: readonly Selector[] = [],
) =>
  count(
    table,
    Object.freeze({
      kind: "document_array_length",
      pointer_pattern: pointer,
      selectors: Object.freeze([...selectors]),
    }),
  );

const declaredCount = (table: string, pointer: string) =>
  count(
    table,
    Object.freeze({
      kind: "document_declared_integer",
      pointer_pattern: pointer,
    }),
  );

const filteredArrayCount = (
  table: string,
  pointer: string,
  memberField: string,
  equals: string,
  selectors: readonly Selector[] = [],
) =>
  count(
    table,
    Object.freeze({
      kind: "document_filtered_array_length",
      pointer_pattern: pointer,
      selectors: Object.freeze([...selectors]),
      predicate: Object.freeze({ member_field: memberField, equals }),
    }),
  );

const contractCount = (
  table: string,
  pointer: string,
  selectors: readonly Selector[] = [],
) =>
  count(
    table,
    Object.freeze({
      kind: "contract_sequence_length",
      artifact: "contracts/generated/provenance-v2/field-corpus.v1.json",
      pointer_pattern: pointer,
      selectors: Object.freeze([...selectors]),
    }),
  );

const rowCount = (
  table: string,
  targetTable: string,
  column: string,
  keyJoins: ReturnType<typeof joins>,
) =>
  count(
    table,
    Object.freeze({
      kind: "row_integer",
      table: targetTable,
      column,
      joins: keyJoins,
    }),
  );

const source = (
  ordinal: number,
  table: string,
  familyTag: string,
  orderBy: readonly string[],
  options: {
    cardinality?: "one" | "zero_or_one" | "many";
    digestColumn?: string | null;
    childTraversal?: string | null;
  } = {},
) =>
  Object.freeze({
    ordinal,
    table,
    family_tag: familyTag,
    cardinality: options.cardinality ?? "many",
    order_by: Object.freeze(
      orderBy.map((column) =>
        Object.freeze({
          column,
          frame_type: column.includes("ordinal") ? "integer" : "text",
          direction: "asc",
          comparison: column.includes("ordinal") ? "integer" : "utf8_binary",
        }),
      ),
    ),
    digest_column:
      "digestColumn" in options
        ? (options.digestColumn ?? null)
        : "member_hash",
    digest_source:
      options.childTraversal === undefined || options.childTraversal === null
        ? "independently_recomputed_leaf"
        : "independently_recomputed_child_traversal",
    child_traversal: options.childTraversal ?? null,
  });

const traversal = (
  name: string,
  domain: string,
  scopeColumns: readonly string[],
  zeroMembers: "allowed" | "rejected",
  sources: readonly ReturnType<typeof source>[],
) =>
  Object.freeze({
    name,
    kind: "ordered_digest_set",
    purpose: [
      "adapter_manifest_set_root",
      "endpoint_set_root",
      "verifier_policy_set_root",
      "field_policy_set_root",
    ].includes(name)
      ? "plan_root"
      : "successor_claim",
    domain,
    scope_columns: Object.freeze([...scopeColumns]),
    zero_members: zeroMembers,
    sources: Object.freeze(
      sources.map((sourceItem) => {
        const registryEntry =
          PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.find(
            (entry) => entry.table === sourceItem.table,
          );
        const isPlanScoped = scopeColumns.every((scopeColumn) =>
          registryEntry?.fields.some((field) => field.name === scopeColumn),
        );
        return Object.freeze({
          ...sourceItem,
          scope_binding: isPlanScoped
            ? Object.freeze({
                kind: "plan_scope",
                joins: Object.freeze(
                  scopeColumns.map((scope_column) =>
                    Object.freeze({ scope_column, row_column: scope_column }),
                  ),
                ),
              })
            : Object.freeze({
                kind: "global_contract",
                artifact:
                  "contracts/generated/provenance-v2/field-corpus.v1.json",
                contract_version: "provenance-v2-field-corpus@1",
              }),
        });
      }),
    ),
  });

const lookupStep = (
  table: string,
  joinsValue: readonly {
    readonly left:
      | { readonly kind: "scope"; readonly column: string }
      | { readonly kind: "prior_row"; readonly column: string };
    readonly right_column: string;
  }[],
) =>
  Object.freeze({
    table,
    cardinality: "exactly_one",
    joins: Object.freeze([...joinsValue]),
  });

const scopeLookup = (table: string, column = "authority_plan_id") =>
  Object.freeze([
    lookupStep(table, [
      Object.freeze({
        left: Object.freeze({ kind: "scope", column: "authority_plan_id" }),
        right_column: column,
      }),
    ]),
  ]);

const rowFrameField = (
  ordinal: number,
  name: string,
  frameType: "text" | "integer" | "boolean" | "digest",
  table: string,
  column = name,
  lookup: readonly ReturnType<typeof lookupStep>[] = scopeLookup(table),
) =>
  Object.freeze({
    ordinal,
    name,
    frame_type: frameType,
    source: Object.freeze({
      kind: "row_column",
      lookup: Object.freeze([...lookup]),
      column,
    }),
  });

const collectionFrameField = (
  ordinal: number,
  name: string,
  traversalName: string,
) =>
  Object.freeze({
    ordinal,
    name,
    frame_type: "digest",
    source: Object.freeze({ kind: "collection", traversal: traversalName }),
  });

const planRootSources = (tables: readonly string[]) =>
  tables.map((table, ordinal) => {
    const entry = PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.find(
      (candidate) => candidate.table === table,
    );
    if (entry === undefined)
      throw new Error("root-binding source table is absent from the registry");
    return source(
      ordinal,
      entry.table,
      entry.table.replace(/^provenance_v2_/u, ""),
      entry.order_by,
      {
        digestColumn: entry.digest_output,
      },
    );
  });

const ADAPTER_MANIFEST_ROOT_TABLES = [
  "provenance_v2_source_owner_receipt",
  "provenance_v2_source_register_receipt",
  "provenance_v2_source_register_member",
  "provenance_v2_adapter_manifest_receipt",
  "provenance_v2_adapter_manifest_environment",
  "provenance_v2_adapter_manifest_credential",
  "provenance_v2_adapter_manifest_source",
] as const;

const ENDPOINT_ROOT_TABLES = [
  "provenance_v2_source_endpoint",
  "provenance_v2_source_endpoint_registration",
  "provenance_v2_source_endpoint_request",
  "provenance_v2_source_endpoint_parameter",
  "provenance_v2_source_endpoint_parameter_enum",
  "provenance_v2_source_endpoint_allowed_header",
  "provenance_v2_source_endpoint_redirect_host",
  "provenance_v2_source_endpoint_content_type",
  "provenance_v2_source_endpoint_expected_field",
  "provenance_v2_source_endpoint_raw_field_mapping",
  "provenance_v2_source_endpoint_approval",
] as const;

const VERIFIER_POLICY_ROOT_TABLES = [
  "provenance_v2_verifier_implementation",
  "provenance_v2_verifier_policy",
  "provenance_v2_verifier_policy_member",
] as const;

const FIELD_POLICY_ROOT_TABLES = [
  "provenance_v2_field_path_vocabulary",
  "provenance_v2_field_path_authority_role",
  "provenance_v2_field_path_enum_value",
  "provenance_v2_field_record_group",
  "provenance_v2_field_record_group_member",
  "provenance_v2_field_policy",
  "provenance_v2_field_policy_member",
  "provenance_v2_field_policy_precedence_class",
  "provenance_v2_field_policy_precedence_class_source",
  "provenance_v2_field_policy_precedence_edge",
  "provenance_v2_field_policy_endpoint_admission",
  "provenance_v2_field_policy_endpoint_exclusion",
] as const;

export const PROVENANCE_V2_ROOT_BINDING_PLAN = Object.freeze({
  contract_version: "provenance-v2-root-binding-plan@1",
  status: "review_candidate",
  registry_contract_version: "provenance-v2-root-registry@1",
  target_migration: "0010_activate_provenance_v2_registration.sql",
  migration_schema_closure_status: "pending_target_migration",
  traversal_contract: Object.freeze({
    member_projection_domain: "provenance-v2-traversal-member@1",
    member_projection_fields: Object.freeze([
      "source_ordinal:integer",
      "family_tag:text",
      "member_digest:digest",
    ]),
    source_order: "dense_source_ordinal_ascending",
    row_order: "complete_declared_order_tuple_ascending",
    collection_frame:
      "scope_fields_then_total_member_count_then_projected_member_digests",
    caller_order_authoritative: false,
  }),
  digest_bindings: Object.freeze([
    ...LEAF_OUTPUTS.map(([table, field]) => leaf(table, field)),
    ...DOCUMENT_VALUES,
    ...EXTERNAL_BINDINGS,
    ...ROOT_BINDINGS,
    retained(
      "provenance_v2_registration_document",
      "document_hash",
      Object.freeze({
        kind: "contiguous_chunk_sequence",
        table: "provenance_v2_registration_document_chunk",
        bytes_column: "chunk_bytes",
        ordinal_column: "ordinal",
        offset_column: "byte_offset",
        length_column: "byte_length",
        joins: joins(["authority_plan_id", "authority_plan_id"]),
        count_table: "provenance_v2_registration_document",
        count_column: "chunk_count",
        total_length_column: "document_byte_length",
      }),
    ),
    retained(
      "provenance_v2_registration_document_chunk",
      "chunk_hash",
      Object.freeze({
        kind: "exact_row_blob",
        table: "provenance_v2_registration_document_chunk",
        bytes_column: "chunk_bytes",
        length_column: "byte_length",
        joins: joins(
          ["authority_plan_id", "authority_plan_id"],
          ["ordinal", "ordinal"],
        ),
      }),
    ),
  ]),
  count_bindings: Object.freeze([
    arrayCount(
      "provenance_v2_source_owner_receipt",
      "/adapter_receipts/*/source_owner_receipts",
      [providerSelector],
    ),
    declaredCount(
      "provenance_v2_source_register_receipt",
      "/declared_counts/adapter_receipts",
    ),
    rowCount(
      "provenance_v2_source_register_member",
      "provenance_v2_source_register_receipt",
      "member_count",
      joins(
        ["authority_plan_id", "authority_plan_id"],
        ["provider_id", "provider_id"],
      ),
    ),
    declaredCount(
      "provenance_v2_adapter_manifest_receipt",
      "/declared_counts/adapter_receipts",
    ),
    arrayCount(
      "provenance_v2_adapter_manifest_environment",
      "/adapter_receipts/*/normalized_environments",
      [providerSelector],
    ),
    arrayCount(
      "provenance_v2_adapter_manifest_credential",
      "/adapter_receipts/*/normalized_credentials",
      [providerSelector],
    ),
    arrayCount(
      "provenance_v2_adapter_manifest_source",
      "/adapter_receipts/*/normalized_sources",
      [providerSelector],
    ),
    ...[
      "provenance_v2_source_endpoint",
      "provenance_v2_source_endpoint_registration",
      "provenance_v2_source_endpoint_request",
      "provenance_v2_source_endpoint_approval",
    ].map((table) => declaredCount(table, "/declared_counts/endpoints")),
    arrayCount(
      "provenance_v2_source_endpoint_parameter",
      "/endpoints/*/parameters",
      [endpointSelector],
    ),
    arrayCount(
      "provenance_v2_source_endpoint_parameter_enum",
      "/endpoints/*/parameters/*/enum_values",
      [endpointSelector, selector(1, "parameter_ordinal", "ordinal")],
    ),
    arrayCount(
      "provenance_v2_source_endpoint_allowed_header",
      "/endpoints/*/allowed_headers",
      [endpointSelector],
    ),
    arrayCount(
      "provenance_v2_source_endpoint_redirect_host",
      "/endpoints/*/redirect_hosts",
      [endpointSelector],
    ),
    arrayCount(
      "provenance_v2_source_endpoint_content_type",
      "/endpoints/*/content_types",
      [endpointSelector],
    ),
    arrayCount(
      "provenance_v2_source_endpoint_expected_field",
      "/endpoints/*/expected_fields",
      [endpointSelector],
    ),
    arrayCount(
      "provenance_v2_source_endpoint_raw_field_mapping",
      "/endpoints/*/raw_field_mappings",
      [endpointSelector],
    ),
    declaredCount(
      "provenance_v2_verifier_implementation",
      "/declared_counts/verifier_implementations",
    ),
    declaredCount(
      "provenance_v2_verifier_policy",
      "/declared_counts/verifier_policies",
    ),
    arrayCount(
      "provenance_v2_verifier_policy_member",
      "/verifier_policies/*/members",
      [selector(0, "verifier_policy_key", "verifier_policy_key")],
    ),
    contractCount("provenance_v2_field_path_vocabulary", "/fields"),
    contractCount(
      "provenance_v2_field_path_authority_role",
      "/fields/*/allowed_authority_roles",
      [selector(0, "field_path", "field_path")],
    ),
    contractCount("provenance_v2_field_path_enum_value", "/enum_domains/*", [
      contractKeySelector(
        0,
        "field_path",
        "/fields",
        "field_path",
        "enum_domain",
      ),
    ]),
    contractCount("provenance_v2_field_record_group", "/record_groups"),
    contractCount(
      "provenance_v2_field_record_group_member",
      "/record_groups/*/field_paths",
      [selector(0, "record_group", "record_group")],
    ),
    declaredCount(
      "provenance_v2_field_policy",
      "/declared_counts/field_policies",
    ),
    arrayCount(
      "provenance_v2_field_policy_member",
      "/field_policies/*/field_paths",
      [policySelector],
    ),
    arrayCount(
      "provenance_v2_field_policy_precedence_class",
      "/field_policies/*/precedence_classes",
      [policySelector],
    ),
    arrayCount(
      "provenance_v2_field_policy_precedence_class_source",
      "/field_policies/*/precedence_classes/*/source_classes",
      [policySelector, selector(1, "class_key", "class_key")],
    ),
    arrayCount(
      "provenance_v2_field_policy_precedence_edge",
      "/field_policies/*/precedence_edges",
      [policySelector],
    ),
    filteredArrayCount(
      "provenance_v2_field_policy_endpoint_admission",
      "/field_policies/*/endpoint_dispositions",
      "disposition",
      "admitted",
      [policySelector],
    ),
    filteredArrayCount(
      "provenance_v2_field_policy_endpoint_exclusion",
      "/field_policies/*/endpoint_dispositions",
      "disposition",
      "excluded",
      [policySelector],
    ),
  ]),
  traversals: Object.freeze([
    traversal(
      "source_owner_set_root",
      "provenance-v2-source-owner-set@1",
      ["authority_plan_id", "provider_id"],
      "rejected",
      [
        source(
          0,
          "provenance_v2_source_owner_receipt",
          "source_owner_receipt",
          [
            "authority_plan_id",
            "provider_id",
            "ordinal",
            "owner_organization_id",
          ],
          { digestColumn: null },
        ),
      ],
    ),
    traversal(
      "source_register_member_set_root",
      "provenance-v2-source-register-member-set@1",
      ["authority_plan_id", "provider_id"],
      "rejected",
      [
        source(
          0,
          "provenance_v2_source_register_member",
          "source_register_member",
          ["authority_plan_id", "provider_id", "ordinal", "source_id"],
        ),
      ],
    ),
    traversal(
      "environment_set_root",
      "provenance-v2-adapter-environment-set@1",
      ["authority_plan_id", "provider_id"],
      "rejected",
      [
        source(0, "provenance_v2_adapter_manifest_environment", "environment", [
          "authority_plan_id",
          "provider_id",
          "ordinal",
          "environment",
        ]),
      ],
    ),
    traversal(
      "credential_set_root",
      "provenance-v2-adapter-credential-set@1",
      ["authority_plan_id", "provider_id"],
      "allowed",
      [
        source(0, "provenance_v2_adapter_manifest_credential", "credential", [
          "authority_plan_id",
          "provider_id",
          "ordinal",
          "binding_name",
        ]),
      ],
    ),
    traversal(
      "source_set_root",
      "provenance-v2-adapter-source-set@1",
      ["authority_plan_id", "provider_id"],
      "rejected",
      [
        source(
          0,
          "provenance_v2_adapter_manifest_source",
          "source",
          ["authority_plan_id", "provider_id", "source_ordinal", "source_id"],
          { digestColumn: "manifest_source_hash" },
        ),
      ],
    ),
    traversal(
      "adapter_manifest_set_root",
      "provenance-v2-adapter-manifest-set@1",
      ["authority_plan_id"],
      "rejected",
      planRootSources(ADAPTER_MANIFEST_ROOT_TABLES),
    ),
    traversal(
      "endpoint_set_root",
      "provenance-v2-endpoint-set@1",
      ["authority_plan_id"],
      "rejected",
      planRootSources(ENDPOINT_ROOT_TABLES),
    ),
    traversal(
      "verifier_policy_set_root",
      "provenance-v2-verifier-policy-set@1",
      ["authority_plan_id"],
      "rejected",
      planRootSources(VERIFIER_POLICY_ROOT_TABLES),
    ),
    traversal(
      "field_policy_set_root",
      "provenance-v2-field-policy-set@1",
      ["authority_plan_id"],
      "rejected",
      planRootSources(FIELD_POLICY_ROOT_TABLES),
    ),
  ]),
  record_frames: Object.freeze([
    Object.freeze({
      name: "authority_root",
      domain: "provenance-v2-authority-root-frame@1",
      fields: Object.freeze([
        rowFrameField(
          0,
          "contract_version",
          "text",
          "provenance_v2_registration_document",
        ),
        rowFrameField(
          1,
          "semantic_policy_hash",
          "digest",
          "provenance_v2_authority_plan",
        ),
        rowFrameField(
          2,
          "canonical_document_hash",
          "digest",
          "provenance_v2_registration_document",
          "document_hash",
        ),
        rowFrameField(
          3,
          "installation_id",
          "text",
          "provenance_v2_authority_plan",
        ),
        rowFrameField(
          4,
          "environment",
          "text",
          "provenance_v2_installation_identity",
          "environment",
          Object.freeze([
            lookupStep("provenance_v2_authority_plan", [
              Object.freeze({
                left: Object.freeze({
                  kind: "scope",
                  column: "authority_plan_id",
                }),
                right_column: "authority_plan_id",
              }),
            ]),
            lookupStep("provenance_v2_installation_identity", [
              Object.freeze({
                left: Object.freeze({
                  kind: "prior_row",
                  column: "installation_id",
                }),
                right_column: "installation_id",
              }),
            ]),
          ]),
        ),
        rowFrameField(
          5,
          "authority_plan_id",
          "text",
          "provenance_v2_authority_plan",
        ),
        rowFrameField(6, "run_plan_id", "text", "provenance_v2_authority_plan"),
        rowFrameField(
          7,
          "run_plan_hash",
          "digest",
          "provenance_v2_authority_plan",
        ),
        rowFrameField(
          8,
          "effective_from_ms",
          "integer",
          "provenance_v2_authority_plan",
        ),
        rowFrameField(
          9,
          "effective_to_ms",
          "integer",
          "provenance_v2_authority_plan",
        ),
        rowFrameField(
          10,
          "created_at_ms",
          "integer",
          "provenance_v2_authority_plan",
        ),
        rowFrameField(
          11,
          "canonical_document_bytes",
          "integer",
          "provenance_v2_authority_plan_registration_close",
        ),
        rowFrameField(
          12,
          "normalized_row_count",
          "integer",
          "provenance_v2_authority_plan_registration_close",
        ),
        rowFrameField(
          13,
          "closed_at_ms",
          "integer",
          "provenance_v2_authority_plan_registration_close",
        ),
        rowFrameField(
          14,
          "adapter_manifest_count",
          "integer",
          "provenance_v2_authority_plan_registration_close",
        ),
        collectionFrameField(
          15,
          "adapter_manifest_set_root",
          "adapter_manifest_set_root",
        ),
        rowFrameField(
          16,
          "endpoint_count",
          "integer",
          "provenance_v2_authority_plan_registration_close",
        ),
        collectionFrameField(17, "endpoint_set_root", "endpoint_set_root"),
        rowFrameField(
          18,
          "verifier_policy_count",
          "integer",
          "provenance_v2_authority_plan_registration_close",
        ),
        collectionFrameField(
          19,
          "verifier_policy_set_root",
          "verifier_policy_set_root",
        ),
        rowFrameField(
          20,
          "field_policy_count",
          "integer",
          "provenance_v2_authority_plan_registration_close",
        ),
        collectionFrameField(
          21,
          "field_policy_set_root",
          "field_policy_set_root",
        ),
      ]),
    }),
    Object.freeze({
      name: "oracle_receipt_hash",
      domain: "provenance-v2-oracle-receipt@1",
      fields: Object.freeze([
        rowFrameField(
          0,
          "authority_plan_id",
          "text",
          "provenance_v2_authority_plan_oracle_receipt",
        ),
        rowFrameField(
          1,
          "oracle_contract_version",
          "text",
          "provenance_v2_authority_plan_oracle_receipt",
        ),
        rowFrameField(
          2,
          "oracle_implementation_hash",
          "digest",
          "provenance_v2_authority_plan_oracle_receipt",
        ),
        rowFrameField(
          3,
          "semantic_policy_hash",
          "digest",
          "provenance_v2_authority_plan_oracle_receipt",
        ),
        rowFrameField(
          4,
          "authority_root",
          "digest",
          "provenance_v2_authority_plan_oracle_receipt",
        ),
        rowFrameField(
          5,
          "verified_at_ms",
          "integer",
          "provenance_v2_authority_plan_oracle_receipt",
        ),
      ]),
    }),
  ]),
  successor_claim_bindings: Object.freeze([
    Object.freeze({
      field: "source_owner_count",
      kind: "count",
      traversal: "source_owner_set_root",
      table: null,
      column: null,
      scope_joins: Object.freeze([
        Object.freeze({
          scope_column: "authority_plan_id",
          row_column: "authority_plan_id",
        }),
        Object.freeze({
          scope_column: "provider_id",
          row_column: "provider_id",
        }),
      ]),
    }),
    Object.freeze({
      field: "source_owner_set_root",
      kind: "collection_digest",
      traversal: "source_owner_set_root",
      table: null,
      column: null,
      scope_joins: Object.freeze([
        Object.freeze({
          scope_column: "authority_plan_id",
          row_column: "authority_plan_id",
        }),
        Object.freeze({
          scope_column: "provider_id",
          row_column: "provider_id",
        }),
      ]),
    }),
    Object.freeze({
      field: "source_register_member_count",
      kind: "count",
      traversal: "source_register_member_set_root",
      table: null,
      column: null,
      scope_joins: Object.freeze([
        Object.freeze({
          scope_column: "authority_plan_id",
          row_column: "authority_plan_id",
        }),
        Object.freeze({
          scope_column: "provider_id",
          row_column: "provider_id",
        }),
      ]),
    }),
    Object.freeze({
      field: "source_register_member_set_root",
      kind: "collection_digest",
      traversal: "source_register_member_set_root",
      table: null,
      column: null,
      scope_joins: Object.freeze([
        Object.freeze({
          scope_column: "authority_plan_id",
          row_column: "authority_plan_id",
        }),
        Object.freeze({
          scope_column: "provider_id",
          row_column: "provider_id",
        }),
      ]),
    }),
    Object.freeze({
      field: "source_register_receipt_hash",
      kind: "row_digest",
      traversal: null,
      table: "provenance_v2_source_register_receipt",
      column: "receipt_content_hash",
      scope_joins: Object.freeze([
        Object.freeze({
          scope_column: "authority_plan_id",
          row_column: "authority_plan_id",
        }),
        Object.freeze({
          scope_column: "provider_id",
          row_column: "provider_id",
        }),
      ]),
    }),
    Object.freeze({
      field: "environment_count",
      kind: "count",
      traversal: "environment_set_root",
      table: null,
      column: null,
      scope_joins: Object.freeze([
        Object.freeze({
          scope_column: "authority_plan_id",
          row_column: "authority_plan_id",
        }),
        Object.freeze({
          scope_column: "provider_id",
          row_column: "provider_id",
        }),
      ]),
    }),
    Object.freeze({
      field: "environment_set_root",
      kind: "collection_digest",
      traversal: "environment_set_root",
      table: null,
      column: null,
      scope_joins: Object.freeze([
        Object.freeze({
          scope_column: "authority_plan_id",
          row_column: "authority_plan_id",
        }),
        Object.freeze({
          scope_column: "provider_id",
          row_column: "provider_id",
        }),
      ]),
    }),
    Object.freeze({
      field: "credential_count",
      kind: "count",
      traversal: "credential_set_root",
      table: null,
      column: null,
      scope_joins: Object.freeze([
        Object.freeze({
          scope_column: "authority_plan_id",
          row_column: "authority_plan_id",
        }),
        Object.freeze({
          scope_column: "provider_id",
          row_column: "provider_id",
        }),
      ]),
    }),
    Object.freeze({
      field: "credential_set_root",
      kind: "collection_digest",
      traversal: "credential_set_root",
      table: null,
      column: null,
      scope_joins: Object.freeze([
        Object.freeze({
          scope_column: "authority_plan_id",
          row_column: "authority_plan_id",
        }),
        Object.freeze({
          scope_column: "provider_id",
          row_column: "provider_id",
        }),
      ]),
    }),
    Object.freeze({
      field: "source_count",
      kind: "count",
      traversal: "source_set_root",
      table: null,
      column: null,
      scope_joins: Object.freeze([
        Object.freeze({
          scope_column: "authority_plan_id",
          row_column: "authority_plan_id",
        }),
        Object.freeze({
          scope_column: "provider_id",
          row_column: "provider_id",
        }),
      ]),
    }),
    Object.freeze({
      field: "source_set_root",
      kind: "collection_digest",
      traversal: "source_set_root",
      table: null,
      column: null,
      scope_joins: Object.freeze([
        Object.freeze({
          scope_column: "authority_plan_id",
          row_column: "authority_plan_id",
        }),
        Object.freeze({
          scope_column: "provider_id",
          row_column: "provider_id",
        }),
      ]),
    }),
  ]),
} as const);

const isPlainAcyclicData = (
  value: unknown,
  seen: Set<object> = new Set(),
): boolean => {
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return false;
  try {
    if (
      Reflect.getPrototypeOf(value) !==
      (Array.isArray(value) ? Array.prototype : Object.prototype)
    )
      return false;
    if (Reflect.ownKeys(value).some((key) => typeof key === "symbol"))
      return false;
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
      if (descriptor.get !== undefined || descriptor.set !== undefined)
        return false;
      if (!isPlainAcyclicData(descriptor.value, seen)) return false;
    }
    seen.delete(value);
    return true;
  } catch {
    return false;
  }
};

export const validateProvenanceV2RootBindingPlan = (
  value: unknown,
): string[] => {
  if (!isPlainAcyclicData(value))
    return ["root binding plan must be plain acyclic data"];
  try {
    if (!Value.Check(ProvenanceV2RootBindingPlanSchema, value))
      return ["root binding plan does not match its closed schema"];
  } catch {
    return ["root binding plan does not match its closed schema"];
  }
  const plan = value;
  const errors: string[] = [];
  const expectedProjectionFields = [
    "source_ordinal:integer",
    "family_tag:text",
    "member_digest:digest",
  ];
  if (
    plan.traversal_contract.member_projection_fields.some(
      (field, index) => field !== expectedProjectionFields[index],
    )
  )
    errors.push("traversal member projection fields must be exact and ordered");
  const registryDigests = new Map(
    PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.flatMap((entry) =>
      entry.fields.flatMap((field) =>
        field.hash_class === null
          ? []
          : [[`${entry.table}.${field.name}`, field.hash_class] as const],
      ),
    ),
  );
  const bindingKeys = plan.digest_bindings.map(
    (item) => `${item.table}.${item.field}`,
  );
  if (new Set(bindingKeys).size !== bindingKeys.length)
    errors.push("digest bindings contain a duplicate table and field key");
  for (const [key, hashClass] of registryDigests) {
    const matches = plan.digest_bindings.filter(
      (item) => `${item.table}.${item.field}` === key,
    );
    if (matches.length !== 1)
      errors.push("every registry digest requires exactly one binding");
    else if (matches[0]?.hash_class !== hashClass)
      errors.push("digest binding hash class must match the root registry");
  }
  if (
    plan.digest_bindings.some(
      (item) => !registryDigests.has(`${item.table}.${item.field}`),
    )
  )
    errors.push("digest binding references an unknown registry digest");

  const allowedKinds: Record<string, readonly string[]> = {
    digest_output: ["leaf_output"],
    safe_preimage: ["document_value", "retained_bytes"],
    external_anchor: ["external_row_digest", "repository_artifact"],
    top_level_root: ["row_digest", "collection_digest", "record_frame_digest"],
    lifecycle_metadata: ["frame_output"],
  };
  if (
    plan.digest_bindings.some(
      (item) => !allowedKinds[item.hash_class]?.includes(item.binding.kind),
    )
  )
    errors.push("digest binding kind is incompatible with its hash class");

  const findRegistryEntry = (table: string) =>
    PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.find(
      (entry) => entry.table === table,
    );
  const selectorsClosePointer = (
    pointer: string,
    selectors: readonly { readonly wildcard_ordinal: number }[],
  ) => {
    const wildcardCount = pointer
      .split("/")
      .filter((part) => part === "*").length;
    return (
      wildcardCount === selectors.length &&
      selectors.every((item, index) => item.wildcard_ordinal === index)
    );
  };
  for (const item of plan.digest_bindings) {
    const resolver = item.binding;
    if (
      resolver.kind === "document_value" &&
      !selectorsClosePointer(resolver.pointer_pattern, resolver.selectors)
    )
      errors.push(
        "document digest selectors must bind every wildcard exactly once",
      );
    if (resolver.kind === "repository_artifact") {
      if (
        resolver.path_source.kind === "document_value" &&
        !selectorsClosePointer(
          resolver.path_source.pointer_pattern,
          resolver.path_source.selectors,
        )
      )
        errors.push(
          "artifact path selectors must bind every wildcard exactly once",
        );
      if (
        resolver.path_source.kind === "literal" &&
        !resolver.path_source.value.startsWith(resolver.allowed_prefix)
      )
        errors.push("literal artifact path must be within its allowed prefix");
      if (resolver.path_source.kind === "row_column") {
        const pathSource = resolver.path_source;
        const sourceEntry = findRegistryEntry(item.table);
        const targetEntry = findRegistryEntry(pathSource.table);
        if (
          !targetEntry?.fields.some(
            (field) => field.name === pathSource.column,
          ) ||
          pathSource.joins.some(
            (join) =>
              !sourceEntry?.fields.some(
                (field) => field.name === join.local_column,
              ) ||
              !targetEntry.fields.some(
                (field) => field.name === join.remote_column,
              ),
          )
        )
          errors.push("artifact row path must resolve by declared typed joins");
      }
    }
    if (resolver.kind === "row_digest") {
      const sourceEntry = findRegistryEntry(item.table);
      const targetEntry = findRegistryEntry(resolver.table);
      if (
        targetEntry?.digest_output !== resolver.digest_column ||
        resolver.joins.some(
          (join) =>
            !sourceEntry?.fields.some(
              (field) => field.name === join.local_column,
            ) ||
            !targetEntry.fields.some(
              (field) => field.name === join.remote_column,
            ),
        )
      )
        errors.push(
          "row-digest binding must resolve one declared digest output by complete typed joins",
        );
    }
  }

  const rootMemberTables = PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries
    .filter((entry) => entry.disposition === "root_member")
    .map((entry) => entry.table);
  const countTables = plan.count_bindings.map((item) => item.table);
  if (new Set(countTables).size !== countTables.length)
    errors.push("count bindings contain a duplicate table key");
  if (
    rootMemberTables.some(
      (table) =>
        countTables.filter((candidate) => candidate === table).length !== 1,
    ) ||
    countTables.some((table) => !rootMemberTables.includes(table))
  )
    errors.push("every root-member table requires exactly one count binding");
  for (const item of plan.count_bindings) {
    const resolver = item.binding;
    if (
      (resolver.kind === "document_array_length" ||
        resolver.kind === "document_filtered_array_length" ||
        resolver.kind === "contract_sequence_length") &&
      !selectorsClosePointer(resolver.pointer_pattern, resolver.selectors)
    )
      errors.push("count selectors must bind every wildcard exactly once");
  }

  const traversalNames = plan.traversals.map((item) => item.name);
  if (new Set(traversalNames).size !== traversalNames.length)
    errors.push("traversal names must be unique");
  for (const item of plan.traversals) {
    if (item.sources.some((sourceItem, index) => sourceItem.ordinal !== index))
      errors.push("traversal source ordinals must be dense and canonical");
    if (
      new Set(item.sources.map((sourceItem) => sourceItem.family_tag)).size !==
      item.sources.length
    )
      errors.push("traversal family tags must be unique");
    for (const sourceItem of item.sources) {
      const registryEntry = PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.find(
        (entry) => entry.table === sourceItem.table,
      );
      if (registryEntry === undefined)
        errors.push("traversal source references an unknown registry table");
      else if (
        (registryEntry.disposition === "root_member" &&
          sourceItem.order_by.length !== registryEntry.order_by.length) ||
        (registryEntry.disposition === "root_member" &&
          sourceItem.order_by.some(
            (field, index) => field.column !== registryEntry.order_by[index],
          ))
      )
        errors.push(
          "traversal source order must equal the complete registry order",
        );
      if (
        registryEntry !== undefined &&
        (sourceItem.digest_column !== registryEntry.digest_output ||
          sourceItem.order_by.some((order) => {
            const field = registryEntry.fields.find(
              (candidate) => candidate.name === order.column,
            );
            return (
              field?.frame_type !== order.frame_type ||
              (order.frame_type === "integer") !==
                (order.comparison === "integer")
            );
          }))
      )
        errors.push(
          "traversal source digest and typed order must match its registry entry",
        );
      if (sourceItem.scope_binding.kind === "plan_scope") {
        if (
          sourceItem.scope_binding.joins.length !== item.scope_columns.length ||
          sourceItem.scope_binding.joins.some(
            (join, index) =>
              join.scope_column !== item.scope_columns[index] ||
              !registryEntry?.fields.some(
                (field) => field.name === join.row_column,
              ),
          )
        )
          errors.push("plan traversal source must bind every scope column");
      } else if (
        registryEntry?.fields.some(
          (field) => field.name === "authority_plan_id",
        ) ||
        item.name !== "field_policy_set_root"
      )
        errors.push(
          "global traversal source is restricted to fixed corpus rows",
        );
      if (
        item.purpose === "plan_root" &&
        registryEntry?.root_owner !== item.name.replace(/_root$/u, "")
      )
        errors.push("plan-root source must match its declared root owner");
      if (
        sourceItem.child_traversal !== null &&
        !traversalNames.includes(sourceItem.child_traversal)
      )
        errors.push("traversal source references an unknown child traversal");
    }
  }
  const referencedTraversals = plan.digest_bindings.flatMap((item) =>
    item.binding.kind === "collection_digest" ? [item.binding.traversal] : [],
  );
  if (referencedTraversals.some((name) => !traversalNames.includes(name)))
    errors.push("digest binding references an unknown traversal");

  const visit = (name: string, path: ReadonlySet<string>): boolean => {
    if (path.has(name)) return false;
    const nextPath = new Set(path).add(name);
    const node = plan.traversals.find((item) => item.name === name);
    return (
      node?.sources.every(
        (item) =>
          item.child_traversal === null ||
          visit(item.child_traversal, nextPath),
      ) ?? false
    );
  };
  if (traversalNames.some((name) => !visit(name, new Set())))
    errors.push("traversal graph must be closed and acyclic");

  const planRootSources = plan.traversals
    .filter((item) => item.purpose === "plan_root")
    .flatMap((item) => item.sources.map((sourceItem) => sourceItem.table));
  if (
    rootMemberTables.some(
      (table) =>
        planRootSources.filter((candidate) => candidate === table).length !== 1,
    ) ||
    planRootSources.some((table) => !rootMemberTables.includes(table))
  )
    errors.push(
      "every root-member table requires one plan-root ownership path",
    );

  const recordFrameNames = plan.record_frames.map((item) => item.name);
  if (new Set(recordFrameNames).size !== recordFrameNames.length)
    errors.push("record-frame names must be unique");
  for (const frame of plan.record_frames) {
    if (frame.fields.some((field, index) => field.ordinal !== index))
      errors.push("record-frame field ordinals must be dense and canonical");
    const registryCollection =
      PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.collections.find(
        (collection) => collection.name === frame.name,
      );
    if (
      registryCollection?.domain !== frame.domain ||
      registryCollection.fields.length !== frame.fields.length ||
      registryCollection.fields.some((field, index) => {
        const candidate = frame.fields[index];
        return (
          candidate?.name !== field.name ||
          candidate.frame_type !== field.frame_type ||
          field.repeated
        );
      })
    )
      errors.push(
        "record frame must exactly bind its registry collection frame",
      );
    if (
      frame.fields.some(
        (field) =>
          field.source.kind === "collection" &&
          !traversalNames.includes(field.source.traversal),
      )
    )
      errors.push("record-frame field references an unknown traversal");
    if (
      frame.fields.some((field) => {
        const sourceValue = field.source;
        return (
          sourceValue.kind === "row_column" &&
          !findRegistryEntry(
            sourceValue.lookup.at(-1)?.table ?? "",
          )?.fields.some((candidate) => candidate.name === sourceValue.column)
        );
      })
    )
      errors.push(
        "record-frame row source references an unknown registry field",
      );
  }
  const referencedFrames = plan.digest_bindings.flatMap((item) =>
    item.binding.kind === "record_frame_digest" ||
    item.binding.kind === "frame_output"
      ? [item.binding.record_frame]
      : [],
  );
  if (referencedFrames.some((name) => !recordFrameNames.includes(name)))
    errors.push("digest binding references an unknown record frame");

  const expectedSuccessorClaims = [
    "credential_count",
    "credential_set_root",
    "environment_count",
    "environment_set_root",
    "source_count",
    "source_owner_count",
    "source_owner_set_root",
    "source_register_member_count",
    "source_register_member_set_root",
    "source_register_receipt_hash",
    "source_set_root",
  ];
  const actualSuccessorClaims = plan.successor_claim_bindings
    .map((item) => item.field)
    .toSorted();
  if (
    actualSuccessorClaims.length !== expectedSuccessorClaims.length ||
    actualSuccessorClaims.some(
      (field, index) => field !== expectedSuccessorClaims[index],
    )
  )
    errors.push("successor child claims require one exact binding");
  if (
    plan.successor_claim_bindings.some(
      (item) =>
        (item.kind === "row_digest") !== (item.table !== null) ||
        (item.kind === "row_digest") !== (item.column !== null) ||
        (item.kind !== "row_digest") !== (item.traversal !== null) ||
        (item.traversal !== null && !traversalNames.includes(item.traversal)),
    )
  )
    errors.push("successor child claim binding is internally inconsistent");
  if (JSON.stringify(plan) !== JSON.stringify(PROVENANCE_V2_ROOT_BINDING_PLAN))
    errors.push(
      "root binding plan must equal the reviewed canonical singleton",
    );
  return errors;
};
