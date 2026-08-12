import {
  FormatRegistry,
  Type,
  type Static,
  type TSchema,
} from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { AdapterManifestSchema } from "./adapter-manifest.js";

const isCanonicalRegistrationTimestamp = (candidate: string): boolean => {
  if (
    !/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u.test(
      candidate,
    )
  )
    return false;
  const parsed = Date.parse(candidate);
  return (
    Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate
  );
};

const checkRegistrationSchema = (value: unknown): boolean => {
  const previous = FormatRegistry.Get("date-time");
  FormatRegistry.Set("date-time", isCanonicalRegistrationTimestamp);
  try {
    return Value.Check(ProvenanceV2RegistrationPlanSchema, value);
  } finally {
    if (previous === undefined) FormatRegistry.Delete("date-time");
    else FormatRegistry.Set("date-time", previous);
  }
};

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const SHA256 = "^sha256:[0-9a-f]{64}$";
const MACHINE_KEY = "^[a-z][a-z0-9_-]{0,63}$";
const FIELD_PATH = "^[a-z][a-z0-9_.]{0,127}$";
const DNS_HOST =
  "^(?=.{1,253}$)(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\\.)+(?:[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)$";
const REVIEW_CANDIDATE_SCHEMA = {
  "x-quantclarity-contract-status": "review_candidate",
} as const;

const id = (prefix: string) =>
  Type.String({ pattern: `^${prefix}_${UUID_V4}$` });
const hash = () => Type.String({ pattern: SHA256 });
const ordinal = (maximum = 1_000_000) => Type.Integer({ minimum: 0, maximum });
const nullable = <T extends TSchema>(schema: T) =>
  Type.Union([schema, Type.Null()]);
const machineKey = () => Type.String({ pattern: MACHINE_KEY });
const fieldPath = () => Type.String({ pattern: FIELD_PATH });
const boundedText = (maximum = 512) =>
  Type.String({ minLength: 1, maxLength: maximum });

const EnvironmentSchema = Type.Union([
  Type.Literal("preview"),
  Type.Literal("production"),
]);
const SourceClassSchema = Type.Union([
  Type.Literal("provider_exact_api"),
  Type.Literal("provider_exact_authenticated_catalog"),
  Type.Literal("provider_controlled_public"),
  Type.Literal("provider_support_or_changelog"),
  Type.Literal("publisher_checkpoint"),
  Type.Literal("independent_structured_catalog"),
]);
const AuthorityRoleSchema = Type.Union([
  Type.Literal("primary"),
  Type.Literal("corroborating"),
  Type.Literal("conflict_detection_only"),
  Type.Literal("deterministic_system"),
]);
const RecordGroupSchema = Type.Union([
  Type.Literal("offering_applicability@1"),
  Type.Literal("price_tuple@1"),
  Type.Literal("precision_summary_tuple@1"),
  Type.Literal("precision_component_tuple@1"),
]);

export const ProvenanceV2RegistrationLimitsSchema = Type.Object(
  {
    contract_version: Type.Literal("provenance-v2-registration-limits@1"),
    acceptance_status: Type.Literal("benchmark_pending"),
    evidence_artifact_hash: Type.Null(),
    provider_count: Type.Integer({ minimum: 1, maximum: 16 }),
    endpoint_count: Type.Integer({ minimum: 1, maximum: 512 }),
    normalized_row_count: Type.Integer({ minimum: 1, maximum: 5_000_000 }),
    canonical_document_bytes: Type.Integer({
      minimum: 1,
      maximum: 1_000_000_000,
    }),
    root_input_bytes: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
    parameter_enum_rows: Type.Integer({ minimum: 0, maximum: 4_194_304 }),
    precedence_edges: Type.Integer({ minimum: 0, maximum: 524_288 }),
    verifier_members: Type.Integer({ minimum: 1, maximum: 32_768 }),
    raw_field_mappings: Type.Integer({ minimum: 1, maximum: 65_536 }),
    document_chunks: Type.Integer({ minimum: 1, maximum: 16_384 }),
    document_chunk_bytes: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
    oracle_result_pages: Type.Integer({ minimum: 1, maximum: 65_536 }),
    oracle_d1_calls: Type.Integer({ minimum: 1, maximum: 65_536 }),
    oracle_cpu_milliseconds: Type.Integer({ minimum: 1, maximum: 300_000 }),
  },
  {
    $id: "ProvenanceV2RegistrationLimits",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

const SourceOwnerReceiptSchema = Type.Object(
  {
    ordinal: ordinal(31),
    owner_organization_id: id("org"),
    owner_kind: Type.Union([
      Type.Literal("provider_operator"),
      Type.Literal("model_publisher"),
      Type.Literal("independent_catalog_operator"),
    ]),
    provider_owner_relationship: Type.Union([
      Type.Literal("provider_controlled"),
      Type.Literal("publisher_controlled"),
      Type.Literal("independent"),
    ]),
    identity_contract_version: Type.Literal("provenance-v2-source-owner@1"),
    identity_preimage: boundedText(4_096),
    identity_content_hash: hash(),
    relationship_approval_artifact_path: boundedText(512),
    relationship_approval_hash: hash(),
    created_at_ms: Type.Integer({ minimum: 0, maximum: 253_402_300_799_999 }),
  },
  { additionalProperties: false },
);

const SourceRegisterMemberSchema = Type.Object(
  {
    ordinal: ordinal(31),
    source_id: machineKey(),
    member_hash: hash(),
  },
  { additionalProperties: false },
);

const SourceRegisterReceiptSchema = Type.Object(
  {
    register_version: boundedText(128),
    artifact_path: boundedText(512),
    artifact_hash: hash(),
    approval_state: Type.Literal("approved"),
    reviewed_at_ms: Type.Integer({ minimum: 0, maximum: 253_402_300_799_999 }),
    next_review_at_ms: Type.Integer({
      minimum: 1,
      maximum: 253_402_300_799_999,
    }),
    access_permitted: Type.Literal(true),
    retention_permitted: Type.Literal(true),
    excerpt_permitted: Type.Boolean(),
    publication_permitted: Type.Literal(true),
    members: Type.Array(SourceRegisterMemberSchema, {
      minItems: 1,
      maxItems: 32,
    }),
    member_set_root: hash(),
    receipt_content_hash: hash(),
  },
  { additionalProperties: false },
);

const NormalizedCredentialSchema = Type.Object(
  {
    ordinal: ordinal(15),
    binding_name: Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,127}$" }),
    purpose: boundedText(256),
    purpose_hash: hash(),
    member_hash: hash(),
  },
  { additionalProperties: false },
);

const NormalizedSourceSchema = Type.Object(
  {
    ordinal: ordinal(31),
    source_id: machineKey(),
    adapter_source_type: Type.Union([
      Type.Literal("provider_api"),
      Type.Literal("authenticated_catalog"),
      Type.Literal("public_static_page"),
      Type.Literal("public_rendered_page"),
      Type.Literal("publisher_checkpoint_repository"),
    ]),
    owner_organization_id: id("org"),
    owner_kind: Type.Union([
      Type.Literal("provider_operator"),
      Type.Literal("model_publisher"),
      Type.Literal("independent_catalog_operator"),
    ]),
    provider_owner_relationship: Type.Union([
      Type.Literal("provider_controlled"),
      Type.Literal("publisher_controlled"),
      Type.Literal("independent"),
    ]),
    authority_source_class: SourceClassSchema,
    host_ascii: Type.String({ minLength: 1, maxLength: 253 }),
    path_template: Type.String({ minLength: 1, maxLength: 1_024 }),
    path_template_hash: hash(),
    manifest_source_hash: hash(),
  },
  { additionalProperties: false },
);

const AdmittedRunPlanCeilingsSchema = Type.Object(
  {
    request_ceiling: Type.Integer({ minimum: 1, maximum: 10_000 }),
    byte_ceiling: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
    ai_token_ceiling: Type.Integer({ minimum: 0, maximum: 10_000_000 }),
    browser_millisecond_ceiling: Type.Integer({
      minimum: 0,
      maximum: 43_200_000,
    }),
    elapsed_millisecond_ceiling: Type.Integer({
      minimum: 1,
      maximum: 43_200_000,
    }),
    cost_microusd_ceiling: Type.Integer({
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
  },
  { additionalProperties: false },
);

export const ProvenanceV2SuccessorManifestSchema = Type.Object(
  {
    contract_version: Type.Literal("provenance-v2-successor-manifest@1"),
    canonical_json_version: Type.Literal("quantclarity-canonical-json@1"),
    authority_plan_id: id("vpa"),
    run_plan_id: id("rpl"),
    installation_id: id("pvi"),
    provider_ordinal: ordinal(15),
    provider_id: id("prv"),
    provider_organization_id: id("org"),
    legacy_adapter_contract_version: boundedText(32),
    legacy_adapter_version: boundedText(128),
    adapter_manifest_hash: hash(),
    roster_version: boundedText(128),
    roster_content_hash: hash(),
    source_owner_count: Type.Integer({ minimum: 1, maximum: 32 }),
    source_owner_set_root: hash(),
    source_register_version: boundedText(128),
    source_register_artifact_hash: hash(),
    source_register_member_count: Type.Integer({ minimum: 1, maximum: 32 }),
    source_register_member_set_root: hash(),
    source_register_receipt_hash: hash(),
    environment_count: Type.Integer({ minimum: 1, maximum: 4 }),
    environment_set_root: hash(),
    credential_count: Type.Integer({ minimum: 0, maximum: 16 }),
    credential_set_root: hash(),
    source_count: Type.Integer({ minimum: 1, maximum: 32 }),
    source_set_root: hash(),
    admitted_run_plan_ceilings: AdmittedRunPlanCeilingsSchema,
    source_policy_version: boundedText(128),
    parser_version: boundedText(128),
    extraction_policy_version: nullable(boundedText(128)),
  },
  {
    $id: "ProvenanceV2SuccessorManifest",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

export const ProvenanceV2AdapterReceiptSchema = Type.Object(
  {
    contract_version: Type.Literal("provenance-v2-adapter-receipt@1"),
    authority_plan_id: id("vpa"),
    run_plan_id: id("rpl"),
    installation_id: id("pvi"),
    provider_ordinal: ordinal(15),
    provider_id: id("prv"),
    provider_organization_id: id("org"),
    legacy_manifest: AdapterManifestSchema,
    successor_manifest: ProvenanceV2SuccessorManifestSchema,
    source_owner_receipts: Type.Array(SourceOwnerReceiptSchema, {
      minItems: 1,
      maxItems: 32,
    }),
    source_register_receipt: SourceRegisterReceiptSchema,
    normalized_environments: Type.Array(
      Type.Union([
        Type.Literal("local"),
        Type.Literal("test"),
        Type.Literal("preview"),
        Type.Literal("production"),
      ]),
      { minItems: 1, maxItems: 4, uniqueItems: true },
    ),
    normalized_credentials: Type.Array(NormalizedCredentialSchema, {
      maxItems: 16,
    }),
    normalized_sources: Type.Array(NormalizedSourceSchema, {
      minItems: 1,
      maxItems: 32,
    }),
    admitted_run_plan_ceilings: AdmittedRunPlanCeilingsSchema,
    source_policy_version: boundedText(128),
    parser_version: boundedText(128),
    extraction_policy_version: nullable(boundedText(128)),
    adapter_manifest_hash: hash(),
    successor_manifest_hash: hash(),
    manifest_content_hash: hash(),
    created_at_ms: Type.Integer({ minimum: 0, maximum: 253_402_300_799_999 }),
  },
  {
    $id: "ProvenanceV2AdapterReceipt",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

const EndpointParameterSchema = Type.Object(
  {
    ordinal: ordinal(63),
    parameter_name: machineKey(),
    location: Type.Union([Type.Literal("path"), Type.Literal("query")]),
    value_type: Type.Union([
      Type.Literal("string"),
      Type.Literal("integer"),
      Type.Literal("boolean"),
    ]),
    required: Type.Boolean(),
    pattern: nullable(Type.String({ minLength: 1, maxLength: 256 })),
    pattern_hash: nullable(hash()),
    maximum_length: nullable(Type.Integer({ minimum: 1, maximum: 4_096 })),
    enum_values: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      maxItems: 128,
      uniqueItems: true,
    }),
    parameter_hash: hash(),
  },
  { additionalProperties: false },
);

export const ProvenanceV2RawFieldMappingSchema = Type.Object(
  {
    authority_plan_id: id("vpa"),
    endpoint_id: id("sep"),
    ordinal: ordinal(4_095),
    declaration_kind: Type.Union([
      Type.Literal("applicability"),
      Type.Literal("price"),
      Type.Literal("precision"),
    ]),
    record_group: RecordGroupSchema,
    record_selector: boundedText(512),
    raw_locator_kind: Type.Union([
      Type.Literal("json_pointer_pattern@1"),
      Type.Literal("provider_label@1"),
      Type.Literal("registered_literal@1"),
    ]),
    raw_locator: boundedText(2_048),
    raw_label: nullable(Type.String({ minLength: 1, maxLength: 256 })),
    canonical_field_path: fieldPath(),
    value_source: Type.Union([
      Type.Literal("observed_value"),
      Type.Literal("field_identity_literal"),
      Type.Literal("registered_literal"),
      Type.Literal("observation_timestamp"),
    ]),
    registered_value: nullable(Type.String({ maxLength: 512 })),
    mapping_content_hash: hash(),
  },
  {
    $id: "ProvenanceV2RawFieldMapping",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

const ExpectedFieldDispositionSchema = Type.Object(
  {
    ordinal: ordinal(127),
    raw_provider_field: boundedText(256),
    canonical_field_path: fieldPath(),
    record_group: RecordGroupSchema,
    disposition: Type.Union([
      Type.Literal("admitted"),
      Type.Literal("excluded"),
    ]),
    exclusion_reason: nullable(
      Type.Union([
        Type.Literal("base_object_not_exact_offering"),
        Type.Literal("not_launch_corpus"),
        Type.Literal("unsafe_or_ambiguous_mapping"),
        Type.Literal("source_not_authoritative"),
      ]),
    ),
  },
  { additionalProperties: false },
);

const EndpointSchema = Type.Object(
  {
    ordinal: ordinal(511),
    endpoint_id: id("sep"),
    provider_id: id("prv"),
    source_id: machineKey(),
    authority_source_class: SourceClassSchema,
    source_owner_organization_id: id("org"),
    provider_owner_relationship: Type.Union([
      Type.Literal("provider_controlled"),
      Type.Literal("publisher_controlled"),
      Type.Literal("independent"),
    ]),
    source_register_version: boundedText(128),
    source_register_artifact_hash: hash(),
    adapter_manifest_hash: hash(),
    manifest_source_hash: hash(),
    host_ascii: Type.String({ minLength: 1, maxLength: 253 }),
    path_template: Type.String({ minLength: 1, maxLength: 1_024 }),
    safe_locator_template: Type.String({ minLength: 1, maxLength: 1_024 }),
    scheme: Type.Literal("https"),
    method: Type.Literal("GET"),
    pagination: boundedText(128),
    authentication_class: Type.Union([
      Type.Literal("none"),
      Type.Literal("api_key"),
      Type.Literal("bearer"),
    ]),
    credential_binding_name: nullable(
      Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,127}$" }),
    ),
    credential_injection: nullable(
      Type.Union([
        Type.Literal("authorization_bearer"),
        Type.Literal("header"),
      ]),
    ),
    credential_header: nullable(
      Type.String({ pattern: "^[A-Za-z0-9-]{1,64}$" }),
    ),
    compressed_byte_limit: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
    uncompressed_byte_limit: Type.Integer({
      minimum: 1,
      maximum: 1_000_000_000,
    }),
    timeout_ms: Type.Integer({ minimum: 1, maximum: 43_200_000 }),
    redirect_limit: Type.Integer({ minimum: 0, maximum: 3 }),
    provider_rate_limit: boundedText(128),
    crawl_purpose: boundedText(128),
    robots_policy: boundedText(128),
    content_signals_policy: boundedText(128),
    browser_session_approved: Type.Boolean(),
    retention_permitted: Type.Literal(true),
    publication_permitted: Type.Literal(true),
    parameters: Type.Array(EndpointParameterSchema, { maxItems: 64 }),
    allowed_headers: Type.Array(
      Type.String({ pattern: "^[A-Za-z0-9-]{1,64}$" }),
      { maxItems: 16, uniqueItems: true },
    ),
    redirect_hosts: Type.Array(Type.String({ minLength: 1, maxLength: 253 }), {
      maxItems: 8,
      uniqueItems: true,
    }),
    content_types: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
    }),
    expected_fields: Type.Array(ExpectedFieldDispositionSchema, {
      minItems: 1,
      maxItems: 128,
    }),
    raw_field_mappings: Type.Array(ProvenanceV2RawFieldMappingSchema, {
      minItems: 1,
      maxItems: 4_096,
    }),
    approval: Type.Object(
      {
        effective_from_ms: Type.Integer({
          minimum: 0,
          maximum: 253_402_300_799_999,
        }),
        effective_to_ms: Type.Integer({
          minimum: 1,
          maximum: 253_402_300_799_999,
        }),
        approval_artifact_path: boundedText(512),
        approval_artifact_hash: hash(),
        approved_at_ms: Type.Integer({
          minimum: 0,
          maximum: 253_402_300_799_999,
        }),
      },
      { additionalProperties: false },
    ),
    endpoint_content_hash: hash(),
    registration_hash: hash(),
    request_content_hash: hash(),
  },
  { additionalProperties: false },
);

const VerifierImplementationSchema = Type.Object(
  {
    ordinal: ordinal(511),
    implementation_key: machineKey(),
    implementation_kind: Type.Union([
      Type.Literal("deterministic_parser"),
      Type.Literal("span_entailment"),
      Type.Literal("generative_reextraction"),
      Type.Literal("authoritative_corroboration"),
      Type.Literal("anomaly_validator"),
    ]),
    family_key: machineKey(),
    implementation_version: boundedText(128),
    implementation_artifact_path: boundedText(512),
    implementation_artifact_hash: hash(),
    prompt_artifact_path: nullable(boundedText(512)),
    prompt_hash: nullable(hash()),
    deterministic_procedure_artifact_path: nullable(boundedText(512)),
    deterministic_procedure_hash: nullable(hash()),
    content_hash: hash(),
  },
  { additionalProperties: false },
);

const VerifierPolicySchema = Type.Object(
  {
    ordinal: ordinal(511),
    verifier_policy_key: machineKey(),
    policy_version: boundedText(128),
    effective_from_ms: Type.Integer({
      minimum: 0,
      maximum: 253_402_300_799_999,
    }),
    effective_to_ms: Type.Integer({ minimum: 1, maximum: 253_402_300_799_999 }),
    profile_kind: Type.Union([
      Type.Literal("deterministic_structured"),
      Type.Literal("span_independent_model"),
      Type.Literal("span_independent_deterministic"),
      Type.Literal("span_second_authoritative"),
    ]),
    minimum_member_count: Type.Integer({ minimum: 1, maximum: 64 }),
    minimum_distinct_family_count: Type.Integer({ minimum: 1, maximum: 64 }),
    span_entailment_required: Type.Boolean(),
    independent_corroboration_required: Type.Boolean(),
    confidence_semantics: Type.Union([
      Type.Literal("not_applicable"),
      Type.Literal("scored"),
    ]),
    minimum_confidence_ppm: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
    disagreement_action: Type.Union([
      Type.Literal("quarantine"),
      Type.Literal("ineligible"),
    ]),
    members: Type.Array(
      Type.Object(
        {
          ordinal: ordinal(63),
          implementation_key: machineKey(),
          member_role: Type.Union([
            Type.Literal("primary"),
            Type.Literal("entailment"),
            Type.Literal("independent_reextract"),
            Type.Literal("corroborating_authority"),
            Type.Literal("anomaly"),
          ]),
          member_hash: hash(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
    content_hash: hash(),
  },
  { additionalProperties: false },
);

const FieldPolicySchema = Type.Object(
  {
    ordinal: ordinal(3),
    record_group: RecordGroupSchema,
    policy_version: boundedText(128),
    field_paths: Type.Array(fieldPath(), {
      minItems: 1,
      maxItems: 32,
      uniqueItems: true,
    }),
    effective_from_ms: Type.Integer({
      minimum: 0,
      maximum: 253_402_300_799_999,
    }),
    effective_to_ms: Type.Integer({ minimum: 1, maximum: 253_402_300_799_999 }),
    order_kind: Type.Literal("total"),
    verifier_policy_key: machineKey(),
    confidence_semantics: Type.Union([
      Type.Literal("not_applicable"),
      Type.Literal("scored"),
    ]),
    minimum_confidence_ppm: Type.Integer({ minimum: 0, maximum: 1_000_000 }),
    equality_rule: Type.Union([
      Type.Literal("exact_applicability_tuple"),
      Type.Literal("exact_price_tuple"),
      Type.Literal("precision_value_and_scope"),
    ]),
    conflict_rule: Type.Union([
      Type.Literal("unknown"),
      Type.Literal("quarantine"),
    ]),
    quarantine_rule: Type.Union([
      Type.Literal("affected_field"),
      Type.Literal("affected_offering"),
      Type.Literal("provider_bundle"),
    ]),
    precedence_classes: Type.Array(
      Type.Object(
        {
          ordinal: ordinal(511),
          class_key: machineKey(),
          source_classes: Type.Array(SourceClassSchema, {
            minItems: 1,
            maxItems: 6,
            uniqueItems: true,
          }),
          class_hash: hash(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 512 },
    ),
    precedence_edges: Type.Array(
      Type.Object(
        {
          ordinal: ordinal(4_095),
          higher_class_key: machineKey(),
          lower_class_key: machineKey(),
          edge_hash: hash(),
        },
        { additionalProperties: false },
      ),
      { maxItems: 4_096 },
    ),
    endpoint_dispositions: Type.Array(
      Type.Object(
        {
          ordinal: ordinal(511),
          endpoint_id: id("sep"),
          disposition: Type.Union([
            Type.Literal("admitted"),
            Type.Literal("excluded"),
          ]),
          class_key: nullable(machineKey()),
          authority_source_class: nullable(SourceClassSchema),
          admission_role: nullable(AuthorityRoleSchema),
          exclusion_reason: nullable(
            Type.Union([
              Type.Literal("base_object_not_exact_offering"),
              Type.Literal("not_launch_corpus"),
              Type.Literal("unsafe_or_ambiguous_mapping"),
              Type.Literal("source_not_authoritative"),
            ]),
          ),
          member_hash: hash(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 512 },
    ),
    canonical_policy_preimage: boundedText(65_536),
    canonical_bytes_hash: hash(),
    content_hash: hash(),
  },
  { additionalProperties: false },
);

const DeclaredCountsSchema = Type.Object(
  {
    adapter_receipts: Type.Integer({ minimum: 1, maximum: 16 }),
    endpoints: Type.Integer({ minimum: 1, maximum: 512 }),
    verifier_implementations: Type.Integer({ minimum: 1, maximum: 512 }),
    verifier_policies: Type.Integer({ minimum: 1, maximum: 512 }),
    field_policies: Type.Literal(4),
    normalized_rows: Type.Integer({ minimum: 1, maximum: 5_000_000 }),
    canonical_document_bytes: Type.Integer({
      minimum: 1,
      maximum: 1_000_000_000,
    }),
    root_input_bytes: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
    document_chunks: Type.Integer({ minimum: 1, maximum: 16_384 }),
    parameter_enum_rows: Type.Integer({ minimum: 0, maximum: 4_194_304 }),
    precedence_edges: Type.Integer({ minimum: 0, maximum: 524_288 }),
    verifier_members: Type.Integer({ minimum: 1, maximum: 32_768 }),
    raw_field_mappings: Type.Integer({ minimum: 1, maximum: 65_536 }),
  },
  { additionalProperties: false },
);

export const ProvenanceV2RegistrationPlanSchema = Type.Object(
  {
    contract_version: Type.Literal("provenance-v2-registration-plan@1"),
    canonical_json_version: Type.Literal("quantclarity-canonical-json@1"),
    root_contract_version: Type.Literal("provenance-v2-authority-root@1"),
    semantic_policy_version: Type.Literal(
      "provenance-v2-registration-semantics@1",
    ),
    semantic_policy_hash: hash(),
    field_corpus_version: Type.Literal("provenance-v2-field-path@1"),
    root_registry_version: Type.Literal("provenance-v2-root-registry@1"),
    installation_id: id("pvi"),
    environment: EnvironmentSchema,
    authority_plan_id: id("vpa"),
    run_plan_id: id("rpl"),
    run_plan_hash: hash(),
    effective_from_ms: Type.Integer({
      minimum: 0,
      maximum: 253_402_300_799_999,
    }),
    effective_to_ms: Type.Integer({ minimum: 1, maximum: 253_402_300_799_999 }),
    created_at_ms: Type.Integer({ minimum: 0, maximum: 253_402_300_799_999 }),
    declared_limits: ProvenanceV2RegistrationLimitsSchema,
    declared_counts: DeclaredCountsSchema,
    adapter_receipts: Type.Array(ProvenanceV2AdapterReceiptSchema, {
      minItems: 1,
      maxItems: 16,
    }),
    endpoints: Type.Array(EndpointSchema, { minItems: 1, maxItems: 512 }),
    verifier_implementations: Type.Array(VerifierImplementationSchema, {
      minItems: 1,
      maxItems: 512,
    }),
    verifier_policies: Type.Array(VerifierPolicySchema, {
      minItems: 1,
      maxItems: 512,
    }),
    field_policies: Type.Array(FieldPolicySchema, {
      minItems: 4,
      maxItems: 4,
    }),
    roots: Type.Object(
      {
        adapter_manifest_set_root: hash(),
        endpoint_set_root: hash(),
        verifier_policy_set_root: hash(),
        field_policy_set_root: hash(),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: "ProvenanceV2RegistrationPlan",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

export type ProvenanceV2RegistrationLimits = Static<
  typeof ProvenanceV2RegistrationLimitsSchema
>;
export type ProvenanceV2AdapterReceipt = Static<
  typeof ProvenanceV2AdapterReceiptSchema
>;
export type ProvenanceV2SuccessorManifest = Static<
  typeof ProvenanceV2SuccessorManifestSchema
>;
export type ProvenanceV2RawFieldMapping = Static<
  typeof ProvenanceV2RawFieldMappingSchema
>;
export type ProvenanceV2RegistrationPlan = Static<
  typeof ProvenanceV2RegistrationPlanSchema
>;

export const PROVENANCE_V2_CANONICAL_JSON_CONTRACT = Object.freeze({
  contract_version: "quantclarity-canonical-json@1",
  status: "review_candidate",
  parser: "duplicate-detecting-strict-json",
  serialization: "RFC8785-JCS",
  unicode: "NFC",
  number_domain: "safe-integer-only",
  encoding: "UTF-8-without-BOM-or-trailing-bytes",
  object_key_order: "UTF-16-code-unit-order-per-RFC8785",
  null_absence_equivalent: false,
} as const);

export const PROVENANCE_V2_FRAME_CONTRACT = Object.freeze({
  contract_version: "provenance-v2-authority-root@1",
  status: "review_candidate",
  magic_hex: "514350563201",
  domain_length: "uint16-big-endian",
  domain_encoding: "printable-ascii",
  field_count: "uint32-big-endian",
  field_header: "one-byte-tag + uint64-big-endian-payload-length",
  tags: Object.freeze({
    null: 0,
    text: 1,
    integer: 2,
    boolean: 3,
    bytes: 4,
    digest: 4,
  }),
  digest_payload: "raw-32-byte-sha256",
  integer_payload: "minimal-base10-safe-integer-ascii",
  text_payload: "exact-NFC-UTF8",
  boolean_payload: "single-byte-00-or-01",
  null_payload: "empty",
  field_names_encoded: false,
  collection_member_encoding: "ordered-repeated-raw-child-digests",
} as const);

export const PROVENANCE_V2_RAW_FIELD_MAPPING_CONTRACT = Object.freeze({
  contract_version: "provenance-v2-raw-field-mapping@1",
  status: "review_candidate",
  json_pointer_contract: "RFC6901",
  array_member_wildcard_token: "~*",
  wildcard_limit_per_locator: 1,
  general_json_path_allowed: false,
  provider_label_comparison: "exact-NFC-UTF8",
  fuzzy_or_generative_equivalence_allowed: false,
  registered_literal_scope:
    "corpus-valid non-secret applicability or record discriminator",
  every_expected_field_requires_mapping: true,
  every_expected_field_requires_admission_or_exclusion: true,
  mapping_root_owner: "endpoint_set",
  admission_and_exclusion_root_owner: "field_policy_set",
} as const);

export const PROVENANCE_V2_SUCCESSOR_MANIFEST_CONTRACT = Object.freeze({
  contract_version: "provenance-v2-successor-manifest-preimage@1",
  status: "review_candidate",
  schema: "ProvenanceV2SuccessorManifest",
  preimage: "exact RFC8785/JCS canonical JSON bytes of successor_manifest",
  canonical_json_version: "quantclarity-canonical-json@1",
  digest: "SHA-256 encoded as lowercase sha256:<hex>",
  caller_roots_authoritative: false,
  oracle_requirement:
    "recompute every declared child root and count before successor_manifest_hash",
  field_inclusion: "every schema property exactly once; no exclusions",
} as const);

export const PROVENANCE_V2_SEMANTIC_POLICY = Object.freeze({
  contract_version: "provenance-v2-registration-semantics@1",
  status: "review_candidate",
  oracle_revalidates_all_semantics: true,
  initial_primary_order_kind: "total",
  incomparability_can_select_or_fallback: false,
  provider_structured_class: Object.freeze([
    "provider_exact_api",
    "provider_exact_authenticated_catalog",
  ]),
  provider_structured_admission_role: "primary",
  equal_authority_disagreement: "unknown_or_quarantine_per_group_policy",
  forbidden_primary_source_classes: Object.freeze([
    "publisher_checkpoint",
    "independent_structured_catalog",
  ]),
  tuple_policy_unit: "record_group",
  tuple_shared_authority: Object.freeze([
    "policy_version",
    "endpoint_disposition",
    "precedence_graph",
    "effective_interval",
    "claim",
    "observation",
    "evidence",
    "applicability",
  ]),
  hash_classes: Object.freeze([
    "digest_output",
    "safe_preimage",
    "external_anchor",
    "top_level_root",
    "lifecycle_metadata",
  ]),
  unclassified_hash_result: "reject",
  null_absence_zero_unknown_not_applicable_distinct: true,
  visitor_or_credential_values_allowed: false,
} as const);

export const PROVENANCE_V2_FIELD_CORPUS = Object.freeze({
  contract_version: "provenance-v2-field-path@1",
  status: "review_candidate",
  record_groups: Object.freeze([
    Object.freeze({
      ordinal: 0,
      record_group: "offering_applicability@1",
      equality_rule: "exact_applicability_tuple",
      context_bindings: Object.freeze([
        "endpoint",
        "policy",
        "observation",
        "evidence",
      ]),
      field_paths: Object.freeze([
        "offering.applicability.provider_id",
        "offering.applicability.provider_model_id",
        "offering.applicability.tier_key",
        "offering.applicability.endpoint_class",
        "offering.applicability.material_region_key",
        "offering.applicability.component_scope",
      ]),
    }),
    Object.freeze({
      ordinal: 1,
      record_group: "price_tuple@1",
      equality_rule: "exact_price_tuple",
      context_bindings: Object.freeze([
        "offering_applicability",
        "endpoint",
        "policy",
        "observation",
        "evidence",
      ]),
      field_paths: Object.freeze([
        "price.role",
        "price.price_class",
        "price.amount_decimal",
        "price.currency",
        "price.currency_provenance",
        "price.unit",
        "price.conditions",
        "price.is_standard_comparable",
        "price.effective_from",
        "price.effective_to",
        "price.observed_at",
      ]),
    }),
    Object.freeze({
      ordinal: 2,
      record_group: "precision_summary_tuple@1",
      equality_rule: "precision_value_and_scope",
      context_bindings: Object.freeze([
        "offering_applicability",
        "endpoint",
        "policy",
        "observation",
        "evidence",
      ]),
      field_paths: Object.freeze([
        "precision.summary.normalized_format",
        "precision.summary.summary_format",
        "precision.summary.raw_field_name",
        "precision.summary.raw_precision",
        "precision.summary.provider_definition",
        "precision.summary.format_variant",
        "precision.summary.observed_at",
      ]),
    }),
    Object.freeze({
      ordinal: 3,
      record_group: "precision_component_tuple@1",
      equality_rule: "precision_value_and_scope",
      context_bindings: Object.freeze([
        "offering_applicability",
        "precision_summary",
        "endpoint",
        "policy",
        "observation",
        "evidence",
      ]),
      field_paths: Object.freeze([
        "precision.component.component_kind",
        "precision.component.component_label",
        "precision.component.normalized_format",
        "precision.component.raw_field_name",
        "precision.component.raw_precision",
        "precision.component.provider_definition",
        "precision.component.format_variant",
        "precision.component.observed_at",
      ]),
    }),
  ]),
  enum_domains: Object.freeze({
    component_scope: Object.freeze([
      "offering",
      "stored_weights",
      "weight_computation",
      "activations",
      "accumulation",
      "kv_cache",
      "attention",
      "experts",
      "shared_layers",
      "other",
    ]),
    precision_component_kind: Object.freeze([
      "stored_weights",
      "weight_computation",
      "activations",
      "accumulation",
      "kv_cache",
      "attention",
      "experts",
      "shared_layers",
      "other",
    ]),
    currency_provenance: Object.freeze(["provider_stated", "system_default"]),
    precision_format: Object.freeze([
      "BF16",
      "FP16",
      "FP8",
      "FP6",
      "FP4",
      "NVFP4",
      "MXFP4",
      "INT8",
      "INT4",
      "mixed",
      "other",
    ]),
    price_class: Object.freeze([
      "standard",
      "promotional",
      "batch",
      "subscription",
      "committed",
      "volume",
      "dedicated",
      "region_tiered",
      "context_tiered",
      "other_conditional",
    ]),
    price_role: Object.freeze(["input", "output", "cached_input"]),
    price_unit: Object.freeze(["per_million_tokens"]),
  }),
  fields: Object.freeze(
    [
      [
        "offering.applicability.provider_id",
        "offering_applicability",
        "offering_applicability@1",
        "text",
        "one",
        "non_null",
        "required",
        null,
        "registered_literal",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "offering.applicability.provider_model_id",
        "offering_applicability",
        "offering_applicability@1",
        "text",
        "one",
        "non_null",
        "required",
        null,
        "observed_or_registered",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "offering.applicability.tier_key",
        "offering_applicability",
        "offering_applicability@1",
        "text",
        "one",
        "non_null",
        "required",
        null,
        "observed_or_registered",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "offering.applicability.endpoint_class",
        "offering_applicability",
        "offering_applicability@1",
        "text",
        "one",
        "non_null",
        "required",
        null,
        "observed_or_registered",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "offering.applicability.material_region_key",
        "offering_applicability",
        "offering_applicability@1",
        "text",
        "one",
        "non_null",
        "required",
        null,
        "observed_or_registered",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "offering.applicability.component_scope",
        "offering_applicability",
        "offering_applicability@1",
        "enum",
        "one",
        "non_null",
        "required",
        "component_scope",
        "registered_literal",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "price.role",
        "price",
        "price_tuple@1",
        "enum",
        "one",
        "non_null",
        "required",
        "price_role",
        "field_identity_literal",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "price.price_class",
        "price",
        "price_tuple@1",
        "enum",
        "one",
        "non_null",
        "required",
        "price_class",
        "observed_or_registered",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "price.amount_decimal",
        "price",
        "price_tuple@1",
        "decimal",
        "one",
        "non_null",
        "required",
        null,
        "observed",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "price.currency",
        "price",
        "price_tuple@1",
        "currency",
        "one",
        "non_null",
        "required",
        null,
        "observed_or_deterministic",
        [
          "primary",
          "corroborating",
          "conflict_detection_only",
          "deterministic_system",
        ],
      ],
      [
        "price.currency_provenance",
        "price",
        "price_tuple@1",
        "enum",
        "one",
        "non_null",
        "required",
        "currency_provenance",
        "deterministic",
        ["deterministic_system"],
      ],
      [
        "price.unit",
        "price",
        "price_tuple@1",
        "enum",
        "one",
        "non_null",
        "required",
        "price_unit",
        "observed_or_registered",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "price.conditions",
        "price",
        "price_tuple@1",
        "string_set",
        "many",
        "non_null",
        "required",
        null,
        "observed",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "price.is_standard_comparable",
        "price",
        "price_tuple@1",
        "boolean",
        "one",
        "non_null",
        "required",
        null,
        "deterministic",
        ["deterministic_system"],
      ],
      [
        "price.effective_from",
        "price",
        "price_tuple@1",
        "timestamp_ms",
        "one",
        "nullable",
        "conditional",
        null,
        "observed",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "price.effective_to",
        "price",
        "price_tuple@1",
        "timestamp_ms",
        "one",
        "nullable",
        "conditional",
        null,
        "observed",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "price.observed_at",
        "price",
        "price_tuple@1",
        "timestamp_ms",
        "one",
        "non_null",
        "required",
        null,
        "observation_timestamp",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "precision.summary.normalized_format",
        "precision_summary",
        "precision_summary_tuple@1",
        "enum",
        "one",
        "non_null",
        "required",
        "precision_format",
        "deterministic",
        ["deterministic_system"],
      ],
      [
        "precision.summary.summary_format",
        "precision_summary",
        "precision_summary_tuple@1",
        "enum",
        "one",
        "non_null",
        "required",
        "precision_format",
        "deterministic",
        ["deterministic_system"],
      ],
      [
        "precision.summary.raw_field_name",
        "precision_summary",
        "precision_summary_tuple@1",
        "text",
        "one",
        "non_null",
        "required",
        null,
        "field_identity_literal",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "precision.summary.raw_precision",
        "precision_summary",
        "precision_summary_tuple@1",
        "text",
        "one",
        "non_null",
        "required",
        null,
        "observed",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "precision.summary.provider_definition",
        "precision_summary",
        "precision_summary_tuple@1",
        "text",
        "one",
        "nullable",
        "conditional",
        null,
        "observed",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "precision.summary.format_variant",
        "precision_summary",
        "precision_summary_tuple@1",
        "text",
        "one",
        "nullable",
        "conditional",
        null,
        "observed",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "precision.summary.observed_at",
        "precision_summary",
        "precision_summary_tuple@1",
        "timestamp_ms",
        "one",
        "non_null",
        "required",
        null,
        "observation_timestamp",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "precision.component.component_kind",
        "precision_component",
        "precision_component_tuple@1",
        "enum",
        "one",
        "non_null",
        "required",
        "precision_component_kind",
        "field_identity_literal",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "precision.component.component_label",
        "precision_component",
        "precision_component_tuple@1",
        "text",
        "one",
        "nullable",
        "conditional",
        null,
        "field_identity_literal",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "precision.component.normalized_format",
        "precision_component",
        "precision_component_tuple@1",
        "enum",
        "one",
        "non_null",
        "required",
        "precision_format",
        "deterministic",
        ["deterministic_system"],
      ],
      [
        "precision.component.raw_field_name",
        "precision_component",
        "precision_component_tuple@1",
        "text",
        "one",
        "non_null",
        "required",
        null,
        "field_identity_literal",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "precision.component.raw_precision",
        "precision_component",
        "precision_component_tuple@1",
        "text",
        "one",
        "non_null",
        "required",
        null,
        "observed",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "precision.component.provider_definition",
        "precision_component",
        "precision_component_tuple@1",
        "text",
        "one",
        "nullable",
        "conditional",
        null,
        "observed",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "precision.component.format_variant",
        "precision_component",
        "precision_component_tuple@1",
        "text",
        "one",
        "nullable",
        "conditional",
        null,
        "observed",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
      [
        "precision.component.observed_at",
        "precision_component",
        "precision_component_tuple@1",
        "timestamp_ms",
        "one",
        "non_null",
        "required",
        null,
        "observation_timestamp",
        ["primary", "corroborating", "conflict_detection_only"],
      ],
    ].map((field, fieldOrdinal) =>
      Object.freeze({
        ordinal: fieldOrdinal,
        field_path: field[0],
        field_group: field[1],
        record_group: field[2],
        value_kind: field[3],
        cardinality: field[4],
        nullability: field[5],
        requirement_state: field[6],
        enum_domain: field[7],
        source_mappability: field[8],
        condition:
          field[0] === "precision.component.component_label"
            ? "required_iff_component_kind_other"
            : null,
        allowed_authority_roles: Object.freeze(field[9] as readonly string[]),
      }),
    ),
  ),
} as const);

export const ProvenanceV2FieldCorpusSchema = Type.Object(
  {
    contract_version: Type.Literal("provenance-v2-field-path@1"),
    status: Type.Literal("review_candidate"),
    record_groups: Type.Array(
      Type.Object(
        {
          ordinal: ordinal(3),
          record_group: RecordGroupSchema,
          equality_rule: Type.Union([
            Type.Literal("exact_applicability_tuple"),
            Type.Literal("exact_price_tuple"),
            Type.Literal("precision_value_and_scope"),
          ]),
          context_bindings: Type.Array(
            Type.Union([
              Type.Literal("offering_applicability"),
              Type.Literal("precision_summary"),
              Type.Literal("endpoint"),
              Type.Literal("policy"),
              Type.Literal("observation"),
              Type.Literal("evidence"),
            ]),
            { minItems: 4, maxItems: 6, uniqueItems: true },
          ),
          field_paths: Type.Array(fieldPath(), {
            minItems: 1,
            maxItems: 32,
            uniqueItems: true,
          }),
        },
        { additionalProperties: false },
      ),
      { minItems: 4, maxItems: 4 },
    ),
    enum_domains: Type.Record(
      Type.String({ pattern: MACHINE_KEY }),
      Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
        minItems: 1,
        uniqueItems: true,
      }),
    ),
    fields: Type.Array(
      Type.Object(
        {
          ordinal: ordinal(31),
          field_path: fieldPath(),
          field_group: Type.Union([
            Type.Literal("offering_applicability"),
            Type.Literal("price"),
            Type.Literal("precision_summary"),
            Type.Literal("precision_component"),
          ]),
          record_group: RecordGroupSchema,
          value_kind: Type.Union([
            Type.Literal("text"),
            Type.Literal("decimal"),
            Type.Literal("currency"),
            Type.Literal("timestamp_ms"),
            Type.Literal("boolean"),
            Type.Literal("enum"),
            Type.Literal("string_set"),
          ]),
          cardinality: Type.Union([Type.Literal("one"), Type.Literal("many")]),
          nullability: Type.Union([
            Type.Literal("non_null"),
            Type.Literal("nullable"),
          ]),
          requirement_state: Type.Union([
            Type.Literal("required"),
            Type.Literal("conditional"),
          ]),
          enum_domain: nullable(machineKey()),
          source_mappability: Type.Union([
            Type.Literal("registered_literal"),
            Type.Literal("observed_or_registered"),
            Type.Literal("field_identity_literal"),
            Type.Literal("observed"),
            Type.Literal("observed_or_deterministic"),
            Type.Literal("deterministic"),
            Type.Literal("observation_timestamp"),
          ]),
          condition: nullable(
            Type.Literal("required_iff_component_kind_other"),
          ),
          allowed_authority_roles: Type.Array(AuthorityRoleSchema, {
            minItems: 1,
            maxItems: 4,
            uniqueItems: true,
          }),
        },
        { additionalProperties: false },
      ),
      { minItems: 32, maxItems: 32 },
    ),
  },
  {
    $id: "ProvenanceV2FieldCorpus",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

const RegistryFrameTypeSchema = Type.Union([
  Type.Literal("text"),
  Type.Literal("integer"),
  Type.Literal("boolean"),
  Type.Literal("digest"),
]);
const RegistryHashClassSchema = Type.Union([
  Type.Literal("digest_output"),
  Type.Literal("safe_preimage"),
  Type.Literal("external_anchor"),
  Type.Literal("top_level_root"),
  Type.Literal("lifecycle_metadata"),
]);

export const ProvenanceV2AuthorityRootRegistrySchema = Type.Object(
  {
    contract_version: Type.Literal("provenance-v2-root-registry@1"),
    target_migration: Type.Literal(
      "0010_activate_provenance_v2_registration.sql",
    ),
    status: Type.Literal("review_candidate"),
    root_owners: Type.Array(
      Type.Union([
        Type.Literal("adapter_manifest_set"),
        Type.Literal("endpoint_set"),
        Type.Literal("verifier_policy_set"),
        Type.Literal("field_policy_set"),
        Type.Literal("top_level_authority_root"),
        Type.Literal("lifecycle_overlay"),
        Type.Literal("prohibited"),
      ]),
      { minItems: 7, maxItems: 7, uniqueItems: true },
    ),
    collections: Type.Array(
      Type.Object(
        {
          name: Type.String({ pattern: "^[a-z][a-z0-9_]*$" }),
          domain: Type.String({ pattern: "^provenance-v2-[a-z0-9-]+@1$" }),
          member_root_owner: nullable(
            Type.Union([
              Type.Literal("adapter_manifest_set"),
              Type.Literal("endpoint_set"),
              Type.Literal("verifier_policy_set"),
              Type.Literal("field_policy_set"),
            ]),
          ),
          fields: Type.Array(
            Type.Object(
              {
                name: Type.String({ pattern: "^[a-z][a-z0-9_]*$" }),
                frame_type: RegistryFrameTypeSchema,
                repeated: Type.Boolean(),
              },
              { additionalProperties: false },
            ),
            { minItems: 1 },
          ),
        },
        { additionalProperties: false },
      ),
      { minItems: 6, uniqueItems: true },
    ),
    entries: Type.Array(
      Type.Object(
        {
          table: Type.String({ pattern: "^provenance_v2_[a-z0-9_]+$" }),
          disposition: Type.Union([
            Type.Literal("root_member"),
            Type.Literal("top_level"),
            Type.Literal("lifecycle_overlay"),
            Type.Literal("prohibited"),
          ]),
          root_owner: Type.Union([
            Type.Literal("adapter_manifest_set"),
            Type.Literal("endpoint_set"),
            Type.Literal("verifier_policy_set"),
            Type.Literal("field_policy_set"),
            Type.Literal("top_level_authority_root"),
            Type.Literal("lifecycle_overlay"),
            Type.Literal("prohibited"),
          ]),
          leaf_domain: nullable(
            Type.String({ pattern: "^provenance-v2-[a-z0-9-]+@1$" }),
          ),
          order_by: Type.Array(Type.String({ pattern: "^[a-z][a-z0-9_]*$" }), {
            uniqueItems: true,
          }),
          count_source: nullable(
            Type.String({ pattern: "^[a-z][a-z0-9_.]*$" }),
          ),
          digest_output: nullable(
            Type.String({ pattern: "^[a-z][a-z0-9_]*$" }),
          ),
          fields: Type.Array(
            Type.Object(
              {
                name: Type.String({ pattern: "^[a-z][a-z0-9_]*$" }),
                frame_type: RegistryFrameTypeSchema,
                nullable: Type.Boolean(),
                hash_class: nullable(RegistryHashClassSchema),
                anchor: nullable(Type.String({ minLength: 1, maxLength: 256 })),
              },
              { additionalProperties: false },
            ),
            { uniqueItems: true },
          ),
          child_tables: Type.Array(
            Type.String({ pattern: "^provenance_v2_[a-z0-9_]+$" }),
            { uniqueItems: true },
          ),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, uniqueItems: true },
    ),
  },
  {
    $id: "ProvenanceV2AuthorityRootRegistry",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

type RegistryFrameType = "text" | "integer" | "boolean" | "digest";
type RegistryHashClass =
  | "digest_output"
  | "safe_preimage"
  | "external_anchor"
  | "top_level_root"
  | "lifecycle_metadata";

const registryField = (
  name: string,
  frameType: RegistryFrameType,
  nullableValue = false,
  hashClass: RegistryHashClass | null = null,
  anchor: string | null = null,
) =>
  Object.freeze({
    name,
    frame_type: frameType,
    nullable: nullableValue,
    hash_class: hashClass,
    anchor,
  });

const textField = (name: string, nullableValue = false) =>
  registryField(name, "text", nullableValue);
const integerField = (name: string, nullableValue = false) =>
  registryField(name, "integer", nullableValue);
const booleanField = (name: string, nullableValue = false) =>
  registryField(name, "boolean", nullableValue);
const digestOutput = (name: string) =>
  registryField(
    name,
    "digest",
    false,
    "digest_output",
    "recomputed leaf frame",
  );
const safeDigest = (name: string, anchor: string, nullableValue = false) =>
  registryField(name, "digest", nullableValue, "safe_preimage", anchor);
const externalDigest = (name: string, anchor: string, nullableValue = false) =>
  registryField(name, "digest", nullableValue, "external_anchor", anchor);
const rootDigest = (name: string) =>
  registryField(
    name,
    "digest",
    false,
    "top_level_root",
    "recomputed set/root frame",
  );
const lifecycleDigest = (name: string, anchor: string) =>
  registryField(name, "digest", false, "lifecycle_metadata", anchor);

type RootOwner =
  | "adapter_manifest_set"
  | "endpoint_set"
  | "verifier_policy_set"
  | "field_policy_set"
  | "top_level_authority_root"
  | "lifecycle_overlay"
  | "prohibited";

const rootEntry = (
  table: string,
  rootOwner: RootOwner,
  domain: string,
  orderBy: readonly string[],
  countSource: string,
  digestColumn: string | null,
  fields: readonly ReturnType<typeof registryField>[],
  childTables: readonly string[] = [],
) =>
  Object.freeze({
    table,
    disposition: "root_member" as const,
    root_owner: rootOwner,
    leaf_domain: domain,
    order_by: Object.freeze([...orderBy]),
    count_source: countSource,
    digest_output: digestColumn,
    fields: Object.freeze([...fields]),
    child_tables: Object.freeze([...childTables]),
  });

const inventoryEntry = (
  table: string,
  disposition: "top_level" | "lifecycle_overlay" | "prohibited",
  rootOwner: RootOwner,
  fields: readonly ReturnType<typeof registryField>[],
) =>
  Object.freeze({
    table,
    disposition,
    root_owner: rootOwner,
    leaf_domain: null,
    order_by: Object.freeze([] as string[]),
    count_source: null,
    digest_output: null,
    fields: Object.freeze([...fields]),
    child_tables: Object.freeze([] as string[]),
  });

const PLAN = "authority_plan_id";

export const PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY = Object.freeze({
  contract_version: "provenance-v2-root-registry@1",
  target_migration: "0010_activate_provenance_v2_registration.sql",
  status: "review_candidate",
  root_owners: Object.freeze([
    "adapter_manifest_set",
    "endpoint_set",
    "verifier_policy_set",
    "field_policy_set",
    "top_level_authority_root",
    "lifecycle_overlay",
    "prohibited",
  ]),
  collections: Object.freeze([
    Object.freeze({
      name: "adapter_manifest_set_root",
      domain: "provenance-v2-adapter-manifest-set@1",
      member_root_owner: "adapter_manifest_set",
      fields: Object.freeze([
        Object.freeze({ name: PLAN, frame_type: "text", repeated: false }),
        Object.freeze({
          name: "member_count",
          frame_type: "integer",
          repeated: false,
        }),
        Object.freeze({
          name: "member_digest",
          frame_type: "digest",
          repeated: true,
        }),
      ]),
    }),
    Object.freeze({
      name: "endpoint_set_root",
      domain: "provenance-v2-endpoint-set@1",
      member_root_owner: "endpoint_set",
      fields: Object.freeze([
        Object.freeze({ name: PLAN, frame_type: "text", repeated: false }),
        Object.freeze({
          name: "member_count",
          frame_type: "integer",
          repeated: false,
        }),
        Object.freeze({
          name: "member_digest",
          frame_type: "digest",
          repeated: true,
        }),
      ]),
    }),
    Object.freeze({
      name: "verifier_policy_set_root",
      domain: "provenance-v2-verifier-policy-set@1",
      member_root_owner: "verifier_policy_set",
      fields: Object.freeze([
        Object.freeze({ name: PLAN, frame_type: "text", repeated: false }),
        Object.freeze({
          name: "member_count",
          frame_type: "integer",
          repeated: false,
        }),
        Object.freeze({
          name: "member_digest",
          frame_type: "digest",
          repeated: true,
        }),
      ]),
    }),
    Object.freeze({
      name: "field_policy_set_root",
      domain: "provenance-v2-field-policy-set@1",
      member_root_owner: "field_policy_set",
      fields: Object.freeze([
        Object.freeze({ name: PLAN, frame_type: "text", repeated: false }),
        Object.freeze({
          name: "member_count",
          frame_type: "integer",
          repeated: false,
        }),
        Object.freeze({
          name: "member_digest",
          frame_type: "digest",
          repeated: true,
        }),
      ]),
    }),
    Object.freeze({
      name: "authority_root",
      domain: "provenance-v2-authority-root-frame@1",
      member_root_owner: null,
      fields: Object.freeze([
        ...[
          "contract_version",
          "semantic_policy_hash",
          "canonical_document_hash",
          "installation_id",
          "environment",
          PLAN,
          "run_plan_id",
          "run_plan_hash",
          "effective_from_ms",
          "effective_to_ms",
          "created_at_ms",
          "canonical_document_bytes",
          "normalized_row_count",
          "closed_at_ms",
          "adapter_manifest_count",
          "adapter_manifest_set_root",
          "endpoint_count",
          "endpoint_set_root",
          "verifier_policy_count",
          "verifier_policy_set_root",
          "field_policy_count",
          "field_policy_set_root",
        ].map((name) =>
          Object.freeze({
            name,
            frame_type:
              name.endsWith("_hash") || name.endsWith("_root")
                ? "digest"
                : name.endsWith("_ms") ||
                    name.endsWith("_count") ||
                    name.endsWith("_bytes")
                  ? "integer"
                  : "text",
            repeated: false,
          }),
        ),
      ]),
    }),
    Object.freeze({
      name: "oracle_receipt_hash",
      domain: "provenance-v2-oracle-receipt@1",
      member_root_owner: null,
      fields: Object.freeze([
        ...[
          PLAN,
          "oracle_contract_version",
          "oracle_implementation_hash",
          "semantic_policy_hash",
          "authority_root",
          "verified_at_ms",
        ].map((name) =>
          Object.freeze({
            name,
            frame_type:
              name.endsWith("_hash") || name.endsWith("_root")
                ? "digest"
                : name.endsWith("_ms")
                  ? "integer"
                  : "text",
            repeated: false,
          }),
        ),
      ]),
    }),
  ]),
  entries: Object.freeze([
    rootEntry(
      "provenance_v2_source_owner_receipt",
      "adapter_manifest_set",
      "provenance-v2-source-owner-receipt@1",
      [PLAN, "provider_id", "ordinal", "owner_organization_id"],
      "adapter_receipt.source_owner_receipts.length",
      null,
      [
        textField(PLAN),
        textField("provider_id"),
        integerField("ordinal"),
        textField("provider_organization_id"),
        textField("owner_organization_id"),
        textField("owner_kind"),
        textField("provider_owner_relationship"),
        textField("identity_contract_version"),
        safeDigest(
          "identity_content_hash",
          "registration_document.source_owner_receipts[].identity_preimage",
        ),
        externalDigest(
          "relationship_approval_hash",
          "repository relationship approval artifact",
        ),
        integerField("created_at_ms"),
      ],
    ),
    rootEntry(
      "provenance_v2_source_register_receipt",
      "adapter_manifest_set",
      "provenance-v2-source-register-receipt@1",
      [PLAN, "provider_id"],
      "adapter_receipts.length",
      "receipt_content_hash",
      [
        textField(PLAN),
        textField("provider_id"),
        textField("register_version"),
        externalDigest(
          "artifact_hash",
          "source_compliance_record exact approved artifact",
        ),
        integerField("member_count"),
        rootDigest("member_set_root"),
        textField("approval_state"),
        integerField("reviewed_at_ms"),
        integerField("next_review_at_ms"),
        booleanField("access_permitted"),
        booleanField("retention_permitted"),
        booleanField("excerpt_permitted"),
        booleanField("publication_permitted"),
        digestOutput("receipt_content_hash"),
      ],
      ["provenance_v2_source_register_member"],
    ),
    rootEntry(
      "provenance_v2_source_register_member",
      "adapter_manifest_set",
      "provenance-v2-source-register-member@1",
      [PLAN, "provider_id", "ordinal", "source_id"],
      "source_register_receipt.member_count",
      "member_hash",
      [
        textField(PLAN),
        textField("provider_id"),
        textField("register_version"),
        externalDigest(
          "artifact_hash",
          "source_compliance_record exact approved artifact",
        ),
        integerField("ordinal"),
        textField("source_id"),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_adapter_manifest_receipt",
      "adapter_manifest_set",
      "provenance-v2-adapter-receipt-leaf@1",
      [PLAN, "provider_ordinal", "provider_id"],
      "registration_plan.declared_counts.adapter_receipts",
      "manifest_content_hash",
      [
        textField(PLAN),
        textField("run_plan_id"),
        textField("installation_id"),
        integerField("provider_ordinal"),
        textField("provider_id"),
        textField("receipt_contract_version"),
        textField("adapter_contract_version"),
        textField("adapter_version"),
        safeDigest(
          "adapter_manifest_hash",
          "registration_document.adapter_receipts[].legacy_manifest canonical JSON bytes",
        ),
        safeDigest(
          "successor_manifest_hash",
          "registration_document.adapter_receipts[].successor_manifest exact provenance-v2-successor-manifest-preimage@1 canonical JSON bytes",
        ),
        textField("source_policy_version"),
        textField("parser_version"),
        textField("extraction_policy_version", true),
        textField("roster_version"),
        externalDigest(
          "roster_content_hash",
          "publication_run_plan_provider approved roster",
        ),
        textField("source_register_version"),
        externalDigest(
          "source_artifact_hash",
          "source_compliance_record exact approved artifact",
        ),
        integerField("source_count"),
        integerField("environment_count"),
        integerField("credential_count"),
        integerField("request_ceiling"),
        integerField("byte_ceiling"),
        integerField("ai_token_ceiling"),
        integerField("browser_millisecond_ceiling"),
        integerField("elapsed_millisecond_ceiling"),
        integerField("cost_microusd_ceiling"),
        integerField("manifest_requests_per_run"),
        integerField("pages_per_source"),
        integerField("manifest_bytes_per_run"),
        integerField("manifest_duration_ms"),
        integerField("retry_attempts"),
        integerField("manifest_browser_sessions"),
        integerField("manifest_ai_tokens"),
        integerField("items_per_run"),
        digestOutput("manifest_content_hash"),
        integerField("created_at_ms"),
      ],
      [
        "provenance_v2_adapter_manifest_environment",
        "provenance_v2_adapter_manifest_credential",
        "provenance_v2_adapter_manifest_source",
      ],
    ),
    rootEntry(
      "provenance_v2_adapter_manifest_environment",
      "adapter_manifest_set",
      "provenance-v2-adapter-environment@1",
      [PLAN, "provider_id", "ordinal", "environment"],
      "adapter_receipt.normalized_environments.length",
      "member_hash",
      [
        textField(PLAN),
        textField("provider_id"),
        integerField("ordinal"),
        textField("environment"),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_adapter_manifest_credential",
      "adapter_manifest_set",
      "provenance-v2-adapter-credential@1",
      [PLAN, "provider_id", "ordinal", "binding_name"],
      "adapter_receipt.normalized_credentials.length",
      "member_hash",
      [
        textField(PLAN),
        textField("provider_id"),
        integerField("ordinal"),
        textField("binding_name"),
        safeDigest(
          "purpose_hash",
          "registration_document.normalized_credentials[].purpose",
        ),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_adapter_manifest_source",
      "adapter_manifest_set",
      "provenance-v2-adapter-source@1",
      [PLAN, "provider_id", "source_ordinal", "source_id"],
      "adapter_receipt.normalized_sources.length",
      "manifest_source_hash",
      [
        textField(PLAN),
        textField("provider_id"),
        integerField("source_ordinal"),
        textField("source_id"),
        textField("adapter_source_type"),
        textField("provider_organization_id"),
        textField("owner_organization_id"),
        textField("owner_kind"),
        textField("provider_owner_relationship"),
        textField("authority_source_class"),
        textField("host_ascii"),
        safeDigest(
          "path_template_hash",
          "registration_document.normalized_sources[].path_template",
        ),
        digestOutput("manifest_source_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_source_endpoint",
      "endpoint_set",
      "provenance-v2-source-endpoint@1",
      [PLAN, "provider_id", "endpoint_ordinal", "endpoint_id"],
      "registration_plan.declared_counts.endpoints",
      "endpoint_content_hash",
      [
        textField("endpoint_id"),
        textField(PLAN),
        integerField("endpoint_ordinal"),
        textField("provider_id"),
        textField("source_register_version"),
        externalDigest(
          "source_register_artifact_hash",
          "source_compliance_record exact approved artifact",
        ),
        textField("source_id"),
        textField("adapter_source_type"),
        textField("source_owner_organization_id"),
        textField("provider_owner_relationship"),
        textField("host_ascii"),
        safeDigest(
          "path_template_hash",
          "registration_document.endpoints[].path_template",
        ),
        safeDigest(
          "adapter_manifest_hash",
          "registration_document matching legacy_manifest canonical JSON bytes",
        ),
        digestOutput("endpoint_content_hash"),
        integerField("created_at_ms"),
      ],
      [
        "provenance_v2_source_endpoint_registration",
        "provenance_v2_source_endpoint_request",
        "provenance_v2_source_endpoint_approval",
      ],
    ),
    rootEntry(
      "provenance_v2_source_endpoint_registration",
      "endpoint_set",
      "provenance-v2-source-endpoint-registration@1",
      [PLAN, "endpoint_id"],
      "registration_plan.declared_counts.endpoints",
      "registration_hash",
      [
        textField(PLAN),
        textField("endpoint_id"),
        textField("provider_id"),
        textField("source_register_version"),
        externalDigest(
          "source_register_artifact_hash",
          "source_compliance_record exact approved artifact",
        ),
        textField("source_id"),
        textField("adapter_source_type"),
        textField("provider_organization_id"),
        textField("source_owner_organization_id"),
        textField("source_owner_kind"),
        textField("provider_owner_relationship"),
        textField("host_ascii"),
        safeDigest(
          "path_template_hash",
          "registration_document.endpoints[].path_template",
        ),
        safeDigest(
          "adapter_manifest_hash",
          "registration_document matching legacy_manifest canonical JSON bytes",
        ),
        rootDigest("endpoint_content_hash"),
        textField("authority_source_class"),
        rootDigest("manifest_source_hash"),
        digestOutput("registration_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_source_endpoint_request",
      "endpoint_set",
      "provenance-v2-source-endpoint-request@1",
      [PLAN, "endpoint_id"],
      "registration_plan.declared_counts.endpoints",
      "request_content_hash",
      [
        textField(PLAN),
        textField("endpoint_id"),
        textField("provider_id"),
        textField("scheme"),
        textField("method"),
        safeDigest(
          "safe_locator_template_hash",
          "registration_document.endpoints[].safe_locator_template",
        ),
        safeDigest(
          "pagination_hash",
          "registration_document.endpoints[].pagination",
        ),
        textField("authentication_class"),
        textField("credential_binding_name", true),
        textField("credential_injection", true),
        textField("credential_header", true),
        integerField("compressed_byte_limit"),
        integerField("uncompressed_byte_limit"),
        integerField("timeout_ms"),
        integerField("redirect_limit"),
        safeDigest(
          "provider_rate_limit_hash",
          "registration_document.endpoints[].provider_rate_limit",
        ),
        safeDigest(
          "crawl_purpose_hash",
          "registration_document.endpoints[].crawl_purpose",
        ),
        safeDigest(
          "robots_policy_hash",
          "registration_document.endpoints[].robots_policy",
        ),
        safeDigest(
          "content_signals_policy_hash",
          "registration_document.endpoints[].content_signals_policy",
        ),
        booleanField("browser_session_approved"),
        booleanField("retention_permitted"),
        booleanField("publication_permitted"),
        integerField("parameter_count"),
        integerField("allowed_header_count"),
        integerField("redirect_host_count"),
        integerField("content_type_count"),
        integerField("expected_field_count"),
        integerField("raw_field_mapping_count"),
        digestOutput("request_content_hash"),
      ],
      [
        "provenance_v2_source_endpoint_parameter",
        "provenance_v2_source_endpoint_allowed_header",
        "provenance_v2_source_endpoint_redirect_host",
        "provenance_v2_source_endpoint_content_type",
        "provenance_v2_source_endpoint_expected_field",
        "provenance_v2_source_endpoint_raw_field_mapping",
      ],
    ),
    rootEntry(
      "provenance_v2_source_endpoint_parameter",
      "endpoint_set",
      "provenance-v2-endpoint-parameter@1",
      [PLAN, "endpoint_id", "ordinal", "parameter_name"],
      "endpoint.parameters.length",
      "parameter_hash",
      [
        textField(PLAN),
        textField("endpoint_id"),
        integerField("ordinal"),
        textField("parameter_name"),
        textField("location"),
        textField("value_type"),
        booleanField("required"),
        safeDigest(
          "pattern_hash",
          "registration_document.endpoints[].parameters[].pattern",
          true,
        ),
        integerField("maximum_length", true),
        integerField("enum_count"),
        digestOutput("parameter_hash"),
      ],
      ["provenance_v2_source_endpoint_parameter_enum"],
    ),
    rootEntry(
      "provenance_v2_source_endpoint_parameter_enum",
      "endpoint_set",
      "provenance-v2-endpoint-parameter-enum@1",
      [PLAN, "endpoint_id", "parameter_ordinal", "ordinal"],
      "endpoint.parameter.enum_values.length",
      "member_hash",
      [
        textField(PLAN),
        textField("endpoint_id"),
        integerField("parameter_ordinal"),
        textField("parameter_name"),
        integerField("ordinal"),
        safeDigest(
          "value_hash",
          "registration_document.endpoints[].parameters[].enum_values[]",
        ),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_source_endpoint_allowed_header",
      "endpoint_set",
      "provenance-v2-endpoint-allowed-header@1",
      [PLAN, "endpoint_id", "ordinal", "header_name"],
      "endpoint.allowed_headers.length",
      "member_hash",
      [
        textField(PLAN),
        textField("endpoint_id"),
        integerField("ordinal"),
        textField("header_name"),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_source_endpoint_redirect_host",
      "endpoint_set",
      "provenance-v2-endpoint-redirect-host@1",
      [PLAN, "endpoint_id", "ordinal", "host_ascii"],
      "endpoint.redirect_hosts.length",
      "member_hash",
      [
        textField(PLAN),
        textField("endpoint_id"),
        integerField("ordinal"),
        textField("host_ascii"),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_source_endpoint_content_type",
      "endpoint_set",
      "provenance-v2-endpoint-content-type@1",
      [PLAN, "endpoint_id", "ordinal", "content_type"],
      "endpoint.content_types.length",
      "member_hash",
      [
        textField(PLAN),
        textField("endpoint_id"),
        integerField("ordinal"),
        textField("content_type"),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_source_endpoint_expected_field",
      "endpoint_set",
      "provenance-v2-endpoint-expected-field@1",
      [PLAN, "endpoint_id", "ordinal", "field_path"],
      "endpoint.expected_fields.length",
      "member_hash",
      [
        textField(PLAN),
        textField("endpoint_id"),
        integerField("ordinal"),
        textField("raw_provider_field"),
        textField("field_path"),
        textField("declaration_kind"),
        textField("record_group"),
        textField("disposition"),
        textField("exclusion_reason", true),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_source_endpoint_raw_field_mapping",
      "endpoint_set",
      "provenance-v2-raw-field-mapping@1",
      [PLAN, "endpoint_id", "ordinal", "canonical_field_path"],
      "endpoint.raw_field_mappings.length",
      "mapping_content_hash",
      [
        textField(PLAN),
        textField("endpoint_id"),
        integerField("ordinal"),
        textField("declaration_kind"),
        textField("record_group"),
        textField("record_selector"),
        textField("raw_locator_kind"),
        textField("raw_locator"),
        textField("raw_label", true),
        textField("canonical_field_path"),
        textField("value_source"),
        textField("registered_value", true),
        digestOutput("mapping_content_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_source_endpoint_approval",
      "endpoint_set",
      "provenance-v2-endpoint-approval@1",
      [PLAN, "endpoint_id"],
      "registration_plan.declared_counts.endpoints",
      null,
      [
        textField(PLAN),
        textField("endpoint_id"),
        integerField("effective_from_ms"),
        integerField("effective_to_ms"),
        externalDigest(
          "approval_artifact_hash",
          "repository endpoint approval artifact",
        ),
        integerField("approved_at_ms"),
      ],
    ),
    rootEntry(
      "provenance_v2_verifier_implementation",
      "verifier_policy_set",
      "provenance-v2-verifier-implementation@1",
      [PLAN, "ordinal", "implementation_key"],
      "registration_plan.declared_counts.verifier_implementations",
      "content_hash",
      [
        textField(PLAN),
        textField("implementation_key"),
        integerField("ordinal"),
        textField("implementation_kind"),
        textField("family_key"),
        textField("implementation_version"),
        externalDigest(
          "implementation_artifact_hash",
          "repository implementation artifact",
        ),
        externalDigest("prompt_hash", "repository prompt artifact", true),
        externalDigest(
          "deterministic_procedure_hash",
          "repository deterministic procedure artifact",
          true,
        ),
        digestOutput("content_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_verifier_policy",
      "verifier_policy_set",
      "provenance-v2-verifier-policy@1",
      [PLAN, "ordinal", "verifier_policy_key"],
      "registration_plan.declared_counts.verifier_policies",
      "content_hash",
      [
        textField(PLAN),
        integerField("ordinal"),
        textField("verifier_policy_key"),
        textField("policy_version"),
        integerField("effective_from_ms"),
        integerField("effective_to_ms"),
        textField("profile_kind"),
        integerField("minimum_member_count"),
        integerField("minimum_distinct_family_count"),
        booleanField("span_entailment_required"),
        booleanField("independent_corroboration_required"),
        textField("confidence_semantics"),
        integerField("minimum_confidence_ppm"),
        textField("disagreement_action"),
        integerField("member_count"),
        digestOutput("content_hash"),
      ],
      ["provenance_v2_verifier_policy_member"],
    ),
    rootEntry(
      "provenance_v2_verifier_policy_member",
      "verifier_policy_set",
      "provenance-v2-verifier-policy-member@1",
      [PLAN, "verifier_policy_key", "ordinal", "implementation_key"],
      "verifier_policy.members.length",
      "member_hash",
      [
        textField(PLAN),
        textField("verifier_policy_key"),
        integerField("ordinal"),
        textField("implementation_key"),
        textField("member_role"),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_field_path_vocabulary",
      "field_policy_set",
      "provenance-v2-field-vocabulary-member@1",
      ["vocabulary_version", "ordinal", "field_path"],
      "field_corpus.fields.length",
      "member_hash",
      [
        textField("vocabulary_version"),
        integerField("ordinal"),
        textField("field_path"),
        textField("field_group"),
        textField("record_group"),
        textField("value_kind"),
        textField("cardinality"),
        textField("nullability"),
        textField("requirement_state"),
        textField("enum_domain", true),
        textField("source_mappability"),
        digestOutput("member_hash"),
      ],
      [
        "provenance_v2_field_path_authority_role",
        "provenance_v2_field_path_enum_value",
      ],
    ),
    rootEntry(
      "provenance_v2_field_path_authority_role",
      "field_policy_set",
      "provenance-v2-field-authority-role@1",
      ["field_path", "ordinal", "authority_role"],
      "field_corpus.field.allowed_authority_roles.length",
      "member_hash",
      [
        textField("field_path"),
        integerField("ordinal"),
        textField("authority_role"),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_field_path_enum_value",
      "field_policy_set",
      "provenance-v2-field-enum-value@1",
      ["field_path", "ordinal", "enum_value"],
      "field_corpus.enum_domain.values.length",
      "member_hash",
      [
        textField("field_path"),
        integerField("ordinal"),
        textField("enum_value"),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_field_record_group",
      "field_policy_set",
      "provenance-v2-field-record-group@1",
      ["ordinal", "record_group"],
      "field_corpus.record_groups.length",
      "group_hash",
      [
        integerField("ordinal"),
        textField("record_group"),
        textField("equality_rule"),
        integerField("member_count"),
        digestOutput("group_hash"),
      ],
      ["provenance_v2_field_record_group_member"],
    ),
    rootEntry(
      "provenance_v2_field_record_group_member",
      "field_policy_set",
      "provenance-v2-field-record-group-member@1",
      ["record_group", "ordinal", "field_path"],
      "field_corpus.record_group.field_paths.length",
      "member_hash",
      [
        textField("record_group"),
        integerField("ordinal"),
        textField("field_path"),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_field_policy",
      "field_policy_set",
      "provenance-v2-field-policy@1",
      [PLAN, "ordinal", "record_group"],
      "registration_plan.declared_counts.field_policies",
      "content_hash",
      [
        textField(PLAN),
        integerField("ordinal"),
        textField("record_group"),
        textField("policy_version"),
        integerField("effective_from_ms"),
        integerField("effective_to_ms"),
        textField("order_kind"),
        textField("verifier_policy_key"),
        textField("confidence_semantics"),
        integerField("minimum_confidence_ppm"),
        textField("equality_rule"),
        textField("conflict_rule"),
        textField("quarantine_rule"),
        integerField("field_count"),
        integerField("precedence_class_count"),
        integerField("precedence_edge_count"),
        integerField("endpoint_disposition_count"),
        safeDigest(
          "canonical_bytes_hash",
          "registration_document.field_policies[].canonical_policy_preimage",
        ),
        digestOutput("content_hash"),
      ],
      [
        "provenance_v2_field_policy_member",
        "provenance_v2_field_policy_precedence_class",
        "provenance_v2_field_policy_precedence_edge",
        "provenance_v2_field_policy_endpoint_admission",
        "provenance_v2_field_policy_endpoint_exclusion",
      ],
    ),
    rootEntry(
      "provenance_v2_field_policy_member",
      "field_policy_set",
      "provenance-v2-field-policy-member@1",
      [PLAN, "record_group", "ordinal", "field_path"],
      "field_policy.field_paths.length",
      "member_hash",
      [
        textField(PLAN),
        textField("record_group"),
        integerField("ordinal"),
        textField("field_path"),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_field_policy_precedence_class",
      "field_policy_set",
      "provenance-v2-precedence-class@1",
      [PLAN, "record_group", "ordinal", "class_key"],
      "field_policy.precedence_classes.length",
      "class_hash",
      [
        textField(PLAN),
        textField("record_group"),
        textField("class_key"),
        integerField("ordinal"),
        integerField("source_class_count"),
        digestOutput("class_hash"),
      ],
      ["provenance_v2_field_policy_precedence_class_source"],
    ),
    rootEntry(
      "provenance_v2_field_policy_precedence_class_source",
      "field_policy_set",
      "provenance-v2-precedence-class-source@1",
      [PLAN, "record_group", "class_key", "ordinal", "authority_source_class"],
      "precedence_class.source_classes.length",
      "member_hash",
      [
        textField(PLAN),
        textField("record_group"),
        textField("class_key"),
        integerField("ordinal"),
        textField("authority_source_class"),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_field_policy_precedence_edge",
      "field_policy_set",
      "provenance-v2-precedence-edge@1",
      [PLAN, "record_group", "ordinal", "higher_class_key", "lower_class_key"],
      "field_policy.precedence_edges.length",
      "edge_hash",
      [
        textField(PLAN),
        textField("record_group"),
        integerField("ordinal"),
        textField("higher_class_key"),
        textField("lower_class_key"),
        digestOutput("edge_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_field_policy_endpoint_admission",
      "field_policy_set",
      "provenance-v2-endpoint-admission@1",
      [PLAN, "record_group", "ordinal", "endpoint_id"],
      "field_policy.admitted_endpoint_count",
      "member_hash",
      [
        textField(PLAN),
        textField("record_group"),
        integerField("ordinal"),
        textField("endpoint_id"),
        textField("class_key"),
        textField("authority_source_class"),
        textField("admission_role"),
        digestOutput("member_hash"),
      ],
    ),
    rootEntry(
      "provenance_v2_field_policy_endpoint_exclusion",
      "field_policy_set",
      "provenance-v2-endpoint-exclusion@1",
      [PLAN, "record_group", "ordinal", "endpoint_id"],
      "field_policy.excluded_endpoint_count",
      "member_hash",
      [
        textField(PLAN),
        textField("record_group"),
        integerField("ordinal"),
        textField("endpoint_id"),
        textField("reason_code"),
        digestOutput("member_hash"),
      ],
    ),
    inventoryEntry(
      "provenance_v2_installation_identity",
      "top_level",
      "top_level_authority_root",
      [
        textField("installation_id"),
        textField("environment"),
        integerField("initialized_at_ms"),
      ],
    ),
    inventoryEntry(
      "provenance_v2_authority_plan",
      "top_level",
      "top_level_authority_root",
      [
        textField("authority_plan_id"),
        textField("installation_id"),
        textField("run_plan_id"),
        externalDigest(
          "run_plan_hash",
          "publication_run_plan_approval exact plan",
        ),
        externalDigest(
          "semantic_policy_hash",
          "generated provenance-v2 registration semantic-policy artifact",
        ),
        rootDigest("endpoint_set_root"),
        rootDigest("field_policy_set_root"),
        rootDigest("verifier_policy_set_root"),
        rootDigest("adapter_manifest_set_root"),
        integerField("effective_from_ms"),
        integerField("effective_to_ms"),
        integerField("created_at_ms"),
      ],
    ),
    inventoryEntry(
      "provenance_v2_registration_document",
      "top_level",
      "top_level_authority_root",
      [
        textField(PLAN),
        textField("contract_version"),
        textField("canonical_json_version"),
        safeDigest(
          "document_hash",
          "exact retained canonical registration document bytes",
        ),
        integerField("document_byte_length"),
        integerField("chunk_count"),
      ],
    ),
    inventoryEntry(
      "provenance_v2_registration_document_chunk",
      "top_level",
      "top_level_authority_root",
      [
        textField(PLAN),
        integerField("ordinal"),
        integerField("byte_offset"),
        integerField("byte_length"),
        safeDigest("chunk_hash", "exact retained document chunk bytes"),
      ],
    ),
    inventoryEntry(
      "provenance_v2_authority_plan_registration_close",
      "top_level",
      "top_level_authority_root",
      [
        textField(PLAN),
        integerField("endpoint_count"),
        integerField("field_policy_count"),
        integerField("verifier_policy_count"),
        integerField("adapter_manifest_count"),
        integerField("normalized_row_count"),
        integerField("canonical_document_bytes"),
        integerField("root_input_bytes"),
        rootDigest("claimed_authority_root"),
        integerField("closed_at_ms"),
      ],
    ),
    inventoryEntry(
      "provenance_v2_authority_plan_oracle_receipt",
      "lifecycle_overlay",
      "lifecycle_overlay",
      [
        textField(PLAN),
        textField("oracle_contract_version"),
        externalDigest(
          "oracle_implementation_hash",
          "repository oracle implementation artifact",
        ),
        externalDigest(
          "semantic_policy_hash",
          "repository semantic policy artifact",
        ),
        rootDigest("endpoint_set_root"),
        rootDigest("field_policy_set_root"),
        rootDigest("verifier_policy_set_root"),
        rootDigest("adapter_manifest_set_root"),
        integerField("endpoint_count"),
        integerField("field_policy_count"),
        integerField("verifier_policy_count"),
        integerField("adapter_manifest_count"),
        rootDigest("authority_root"),
        integerField("verified_at_ms"),
        lifecycleDigest("receipt_hash", "recomputed oracle receipt frame"),
      ],
    ),
    inventoryEntry(
      "provenance_v2_authority_plan_seal",
      "lifecycle_overlay",
      "lifecycle_overlay",
      [
        textField(PLAN),
        rootDigest("authority_root"),
        integerField("sealed_at_ms"),
      ],
    ),
    inventoryEntry(
      "provenance_v2_authority_plan_approval_intent",
      "lifecycle_overlay",
      "lifecycle_overlay",
      [
        textField(PLAN),
        textField("artifact_path"),
        externalDigest("artifact_hash", "repository approval artifact"),
        textField("approval_roles_json"),
        rootDigest("authority_root"),
        integerField("created_at_ms"),
      ],
    ),
    inventoryEntry(
      "provenance_v2_authority_plan_approval",
      "lifecycle_overlay",
      "lifecycle_overlay",
      [
        textField(PLAN),
        externalDigest("artifact_hash", "repository approval artifact"),
        textField("approval_roles_json"),
        integerField("approved_at_ms"),
      ],
    ),
    inventoryEntry(
      "provenance_v2_source_endpoint_revocation",
      "lifecycle_overlay",
      "lifecycle_overlay",
      [
        textField(PLAN),
        textField("endpoint_id"),
        textField("reason_code"),
        integerField("effective_at_ms"),
      ],
    ),
    inventoryEntry(
      "provenance_v2_authority_plan_revocation",
      "lifecycle_overlay",
      "lifecycle_overlay",
      [
        textField(PLAN),
        textField("reason_code"),
        integerField("effective_at_ms"),
      ],
    ),
    inventoryEntry(
      "provenance_v2_provider_bundle",
      "prohibited",
      "prohibited",
      [],
    ),
    inventoryEntry(
      "provenance_v2_acquisition_permit",
      "prohibited",
      "prohibited",
      [],
    ),
    inventoryEntry(
      "provenance_v2_admitted_response",
      "prohibited",
      "prohibited",
      [],
    ),
  ]),
} as const);

const VectorFieldSchema = Type.Object(
  {
    tag: Type.Union([
      Type.Literal("null"),
      Type.Literal("text"),
      Type.Literal("integer"),
      Type.Literal("boolean"),
      Type.Literal("bytes"),
      Type.Literal("digest"),
    ]),
    value: Type.Union([Type.String(), Type.Boolean(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const ProvenanceV2AuthorityRootVectorsSchema = Type.Object(
  {
    contract_version: Type.Literal("provenance-v2-authority-root-vectors@1"),
    frame_contract_version: Type.Literal("provenance-v2-authority-root@1"),
    status: Type.Literal("review_candidate"),
    vectors: Type.Array(
      Type.Object(
        {
          name: Type.String({ pattern: "^[a-z][a-z0-9_-]*$" }),
          registry_table: nullable(
            Type.String({ pattern: "^provenance_v2_[a-z0-9_]+$" }),
          ),
          collection_name: nullable(
            Type.String({ pattern: "^[a-z][a-z0-9_]*$" }),
          ),
          domain: Type.String({ pattern: "^provenance-v2-[a-z0-9-]+@1$" }),
          fields: Type.Array(VectorFieldSchema, { maxItems: 1_024 }),
          frame_hex: Type.String({ pattern: "^[0-9a-f]+$" }),
          sha256: hash(),
        },
        { additionalProperties: false },
      ),
      { minItems: 10 },
    ),
  },
  {
    $id: "ProvenanceV2AuthorityRootVectors",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

const isPlainData = (
  value: unknown,
  seen: Set<object> = new Set<object>(),
): boolean => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return true;
  if (typeof value !== "object" || seen.has(value)) return false;
  try {
    seen.add(value);
    const prototype = Reflect.getPrototypeOf(value);
    if (Reflect.ownKeys(value).some((key) => typeof key === "symbol"))
      return false;
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) return false;
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index) || !isPlainData(value[index], seen))
          return false;
      }
      return true;
    }
    if (prototype !== Object.prototype && prototype !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(descriptors).every((key) => {
      if (typeof key === "symbol") return false;
      const descriptor = descriptors[key];
      return (
        descriptor !== undefined &&
        descriptor.get === undefined &&
        descriptor.set === undefined &&
        isPlainData(descriptor.value, seen)
      );
    });
  } catch {
    return false;
  }
};

const denseOrdinals = (
  values: readonly { readonly ordinal: number }[],
  label: string,
  errors: string[],
): void => {
  if (values.some((value, index) => value.ordinal !== index))
    errors.push(`${label} ordinals must be dense, zero-based, and canonical`);
};

const uniqueStrings = (
  values: readonly string[],
  label: string,
  errors: string[],
): void => {
  if (new Set(values).size !== values.length)
    errors.push(`${label} contains a duplicate`);
};

export const validateProvenanceV2RegistrationLimits = (
  value: unknown,
  requireAccepted = false,
): string[] => {
  if (!isPlainData(value)) return ["registration limits must be plain data"];
  if (!Value.Check(ProvenanceV2RegistrationLimitsSchema, value))
    return ["registration limits do not match the closed schema"];
  const limits = value;
  const errors: string[] = [];
  if (requireAccepted)
    errors.push(
      "registration authority is disabled until a repository-pinned benchmark contract replaces benchmark_pending",
    );
  if (
    limits.document_chunks * limits.document_chunk_bytes <
    limits.canonical_document_bytes
  )
    errors.push("document chunk capacity is below canonical document bytes");
  return errors;
};

export const validateProvenanceV2ContractArtifacts = (
  vectors: unknown,
): string[] => {
  const errors: string[] = [];
  if (!isPlainData(PROVENANCE_V2_FIELD_CORPUS))
    errors.push("field corpus must be plain data");
  else if (
    !Value.Check(ProvenanceV2FieldCorpusSchema, PROVENANCE_V2_FIELD_CORPUS)
  )
    errors.push("field corpus does not match its closed schema");
  if (!isPlainData(PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY))
    errors.push("root registry must be plain data");
  else if (
    !Value.Check(
      ProvenanceV2AuthorityRootRegistrySchema,
      PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
    )
  )
    errors.push("root registry does not match its closed schema");
  if (!isPlainData(vectors)) errors.push("root vectors must be plain data");
  else if (!Value.Check(ProvenanceV2AuthorityRootVectorsSchema, vectors))
    errors.push("root vectors do not match their closed schema");
  if (errors.length > 0) return errors;

  const corpus = PROVENANCE_V2_FIELD_CORPUS as unknown as Static<
    typeof ProvenanceV2FieldCorpusSchema
  >;
  denseOrdinals(corpus.fields, "field corpus", errors);
  denseOrdinals(corpus.record_groups, "record groups", errors);
  uniqueStrings(
    corpus.fields.map((field) => field.field_path),
    "field corpus paths",
    errors,
  );
  uniqueStrings(
    corpus.record_groups.map((group) => group.record_group),
    "record groups",
    errors,
  );
  const corpusPaths = new Set(corpus.fields.map((field) => field.field_path));
  const groupedPaths = corpus.record_groups.flatMap((group) =>
    group.field_paths.map((path) => `${group.record_group}:${path}`),
  );
  uniqueStrings(groupedPaths, "record-group membership", errors);
  for (const field of corpus.fields) {
    const group = corpus.record_groups.find(
      (candidate) => candidate.record_group === field.record_group,
    );
    if (!group?.field_paths.includes(field.field_path))
      errors.push(
        `field ${field.field_path} is not in its declared record group`,
      );
    if (
      field.enum_domain !== null &&
      !Object.hasOwn(corpus.enum_domains, field.enum_domain)
    )
      errors.push(
        `field ${field.field_path} references an unknown enum domain`,
      );
  }
  for (const group of corpus.record_groups)
    for (const path of group.field_paths)
      if (!corpusPaths.has(path))
        errors.push(
          `record group ${group.record_group} references unknown ${path}`,
        );

  const registry = PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY as unknown as Static<
    typeof ProvenanceV2AuthorityRootRegistrySchema
  >;
  uniqueStrings(
    registry.entries.map((entry) => entry.table),
    "root-registry tables",
    errors,
  );
  uniqueStrings(
    registry.entries.flatMap((entry) =>
      entry.leaf_domain === null ? [] : [entry.leaf_domain],
    ),
    "root-registry leaf domains",
    errors,
  );
  uniqueStrings(
    registry.collections.map((collection) => collection.domain),
    "root-registry collection domains",
    errors,
  );
  for (const entry of registry.entries) {
    uniqueStrings(
      entry.fields.map((field) => field.name),
      `${entry.table} fields`,
      errors,
    );
    const digestOutputs = entry.fields.filter(
      (field) => field.hash_class === "digest_output",
    );
    if (digestOutputs.length > 1)
      errors.push(`${entry.table} has more than one digest output`);
    if ((digestOutputs[0]?.name ?? null) !== entry.digest_output)
      errors.push(
        `${entry.table} digest output does not match its field registry`,
      );
    for (const field of entry.fields) {
      if (field.frame_type === "digest" && field.hash_class === null)
        errors.push(`${entry.table}.${field.name} has an unclassified digest`);
      if (field.frame_type !== "digest" && field.hash_class !== null)
        errors.push(
          `${entry.table}.${field.name} classifies a non-digest field`,
        );
      if (field.hash_class !== null && field.anchor === null)
        errors.push(
          `${entry.table}.${field.name} lacks its digest provenance anchor`,
        );
    }
    if (
      entry.disposition === "root_member" &&
      (entry.leaf_domain === null || entry.count_source === null)
    )
      errors.push(`${entry.table} root member lacks domain or count source`);
  }

  const vectorDocument = vectors as Static<
    typeof ProvenanceV2AuthorityRootVectorsSchema
  >;
  uniqueStrings(
    vectorDocument.vectors.map((vector) => vector.name),
    "root vector names",
    errors,
  );
  for (const entry of registry.entries.filter(
    (candidate) => candidate.disposition === "root_member",
  )) {
    const matches = vectorDocument.vectors.filter(
      (vector) => vector.registry_table === entry.table,
    );
    if (matches.length !== 1)
      errors.push(
        `${entry.table} must have exactly one independent leaf vector`,
      );
    const vector = matches[0];
    if (vector !== undefined) {
      if (vector.domain !== entry.leaf_domain)
        errors.push(`${entry.table} vector domain does not match registry`);
      const expectedTags = entry.fields
        .filter((field) => field.hash_class !== "digest_output")
        .map((field) => field.frame_type);
      const actualTags = vector.fields.map((field) => field.tag);
      if (
        expectedTags.length !== actualTags.length ||
        expectedTags.some(
          (tag, index) =>
            actualTags[index] !== tag && actualTags[index] !== "null",
        )
      )
        errors.push(
          `${entry.table} vector field tags do not match registry order`,
        );
    }
  }
  for (const collection of registry.collections) {
    const matches = vectorDocument.vectors.filter(
      (vector) => vector.collection_name === collection.name,
    );
    if (matches.length !== 1)
      errors.push(`${collection.name} must have exactly one collection vector`);
    const vector = matches[0];
    if (vector !== undefined) {
      if (vector.domain !== collection.domain)
        errors.push(`${collection.name} vector domain does not match registry`);
      if (
        collection.fields.some(
          (field, index) =>
            field.repeated && index !== collection.fields.length - 1,
        )
      )
        errors.push(`${collection.name} repeated field must be final`);
      const expectedTags = collection.fields.flatMap((field) =>
        field.repeated
          ? [field.frame_type, field.frame_type]
          : [field.frame_type],
      );
      const actualTags = vector.fields.map((field) => field.tag);
      if (
        expectedTags.length !== actualTags.length ||
        expectedTags.some((tag, index) => actualTags[index] !== tag)
      )
        errors.push(
          `${collection.name} vector field tags do not match registry order`,
        );
      const repeatedCount = collection.fields.some((field) => field.repeated)
        ? 2
        : 0;
      const countIndex = collection.fields.findIndex((field) =>
        field.name.endsWith("_count"),
      );
      const countField = countIndex < 0 ? undefined : vector.fields[countIndex];
      if (
        repeatedCount > 0 &&
        (countField?.tag !== "integer" ||
          countField.value !== String(repeatedCount))
      )
        errors.push(
          `${collection.name} vector count does not match repeated members`,
        );
    }
  }
  for (const vector of vectorDocument.vectors) {
    if (vector.frame_hex.length % 2 !== 0)
      errors.push(`${vector.name} has an odd-length frame`);
    for (const field of vector.fields) {
      if (field.tag === "null" && field.value !== null)
        errors.push(`${vector.name} null field has a payload`);
      if (field.tag === "boolean" && typeof field.value !== "boolean")
        errors.push(`${vector.name} boolean field is not Boolean`);
      if (
        (field.tag === "text" ||
          field.tag === "integer" ||
          field.tag === "bytes" ||
          field.tag === "digest") &&
        typeof field.value !== "string"
      )
        errors.push(`${vector.name} ${field.tag} field is not text encoded`);
      if (
        field.tag === "text" &&
        typeof field.value === "string" &&
        field.value.normalize("NFC") !== field.value
      )
        errors.push(`${vector.name} contains non-NFC text`);
    }
  }
  return errors;
};

const graphIsTotalOrder = (
  classKeys: readonly string[],
  edges: readonly {
    readonly higher_class_key: string;
    readonly lower_class_key: string;
  }[],
): boolean => {
  const reachable = new Map(
    classKeys.map((key) => [key, new Set<string>()] as const),
  );
  for (const edge of edges)
    reachable.get(edge.higher_class_key)?.add(edge.lower_class_key);
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of classKeys) {
      const targets = reachable.get(key);
      if (targets === undefined) return false;
      for (const target of [...targets])
        for (const transitive of reachable.get(target) ?? [])
          if (!targets.has(transitive)) {
            targets.add(transitive);
            changed = true;
          }
    }
  }
  if (classKeys.some((key) => reachable.get(key)?.has(key) === true))
    return false;
  for (let left = 0; left < classKeys.length; left += 1)
    for (let right = left + 1; right < classKeys.length; right += 1) {
      const a = classKeys[left];
      const b = classKeys[right];
      if (a === undefined || b === undefined) return false;
      if (
        reachable.get(a)?.has(b) !== true &&
        reachable.get(b)?.has(a) !== true
      )
        return false;
    }
  return true;
};

const arraysEqual = <T>(left: readonly T[], right: readonly T[]): boolean =>
  left.length === right.length &&
  left.every((entry, index) => entry === right[index]);

const hasAsciiControl = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f))
      return true;
  }
  return false;
};

export const isProvenanceV2RegistrationHostCandidate = (
  host: string,
): boolean => {
  if (!new RegExp(DNS_HOST, "u").test(host)) return false;
  if (host.split(".").some((label) => label.startsWith("xn--"))) return false;
  const forbiddenExact = new Set(["example.com", "example.net", "example.org"]);
  if (forbiddenExact.has(host)) return false;
  return ![
    ".example",
    ".invalid",
    ".internal",
    ".local",
    ".localhost",
    ".localdomain",
    ".onion",
    ".arpa",
    ".test",
  ].some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
};

export const isProvenanceV2PathTemplateCandidate = (
  pathTemplate: string,
  parameters: readonly {
    readonly parameter_name: string;
    readonly location: string;
    readonly required?: boolean;
  }[],
): boolean => {
  if (
    !pathTemplate.startsWith("/") ||
    pathTemplate.startsWith("//") ||
    /[\\\\?#@]/u.test(pathTemplate) ||
    hasAsciiControl(pathTemplate) ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(pathTemplate) ||
    /%(?:2f|5c|2e)/iu.test(pathTemplate) ||
    pathTemplate
      .split("/")
      .slice(1)
      .some((segment) => segment.length === 0)
  )
    return false;
  const placeholders = [
    ...pathTemplate.matchAll(/\{([a-z][a-z0-9_]*)\}/gu),
  ].map((match) => match[1]);
  if (/[{}]/u.test(pathTemplate.replace(/\{[a-z][a-z0-9_]*\}/gu, "")))
    return false;
  const pathParameters = parameters
    .filter((parameter) => parameter.location === "path")
    .map((parameter) => parameter.parameter_name);
  return (
    new Set(placeholders).size === placeholders.length &&
    arraysEqual(placeholders, pathParameters) &&
    parameters
      .filter((parameter) => parameter.location === "path")
      .every((parameter) => parameter.required)
  );
};

export const isProvenanceV2SafeLocatorCandidate = (
  safeLocator: string,
): boolean =>
  safeLocator.startsWith("/") &&
  !safeLocator.startsWith("//") &&
  !/[{}\\\\?#@]/u.test(safeLocator) &&
  !hasAsciiControl(safeLocator) &&
  !/%(?:2e|2f|5c)/iu.test(safeLocator) &&
  !/(?:^|\/)\.{1,2}(?:\/|$)/u.test(safeLocator) &&
  !safeLocator
    .split("/")
    .slice(1)
    .some((segment) => segment.length === 0);

export const isProvenanceV2RawLocatorCandidate = (
  kind: string,
  locator: string,
): boolean => {
  if (kind !== "json_pointer_pattern@1") return true;
  if (locator !== "" && !locator.startsWith("/")) return false;
  const tokens = locator === "" ? [] : locator.slice(1).split("/");
  let wildcardCount = 0;
  for (const token of tokens) {
    for (let index = 0; index < token.length; index += 1)
      if (token[index] === "~") {
        const escape = token[index + 1];
        if (escape === "0" || escape === "1") index += 1;
        else if (escape === "*") {
          wildcardCount += 1;
          index += 1;
        } else return false;
      }
  }
  return wildcardCount <= 1;
};

export const inspectProvenanceV2RegistrationPlanCandidate = (
  value: unknown,
): string[] => {
  if (!isPlainData(value))
    return ["registration plan must be acyclic plain data"];
  if (!checkRegistrationSchema(value))
    return ["registration plan does not match the closed schema"];
  const plan = value as ProvenanceV2RegistrationPlan;
  const errors = validateProvenanceV2RegistrationLimits(
    plan.declared_limits,
    true,
  );
  if (!(
    plan.created_at_ms <= plan.effective_from_ms &&
    plan.effective_from_ms < plan.effective_to_ms
  ))
    errors.push("registration plan interval is invalid");
  if (
    plan.adapter_receipts.some(
      (receipt, index) => receipt.provider_ordinal !== index,
    )
  )
    errors.push(
      "adapter receipt ordinals must be dense, zero-based, and canonical",
    );
  denseOrdinals(plan.endpoints, "endpoints", errors);
  denseOrdinals(
    plan.verifier_implementations,
    "verifier implementations",
    errors,
  );
  denseOrdinals(plan.verifier_policies, "verifier policies", errors);
  denseOrdinals(plan.field_policies, "field policies", errors);
  if (plan.declared_counts.adapter_receipts !== plan.adapter_receipts.length)
    errors.push("adapter receipt count does not match");
  if (plan.declared_counts.endpoints !== plan.endpoints.length)
    errors.push("endpoint count does not match");
  if (
    plan.declared_counts.verifier_implementations !==
    plan.verifier_implementations.length
  )
    errors.push("verifier implementation count does not match");
  if (plan.declared_counts.verifier_policies !== plan.verifier_policies.length)
    errors.push("verifier policy count does not match");
  if (plan.declared_counts.field_policies !== plan.field_policies.length)
    errors.push("field policy count does not match");
  const actualParameterEnumRows = plan.endpoints.reduce(
    (sum, endpoint) =>
      sum +
      endpoint.parameters.reduce(
        (parameterSum, parameter) =>
          parameterSum + parameter.enum_values.length,
        0,
      ),
    0,
  );
  const actualPrecedenceEdges = plan.field_policies.reduce(
    (sum, policy) => sum + policy.precedence_edges.length,
    0,
  );
  const actualVerifierMembers = plan.verifier_policies.reduce(
    (sum, policy) => sum + policy.members.length,
    0,
  );
  const actualRawFieldMappings = plan.endpoints.reduce(
    (sum, endpoint) => sum + endpoint.raw_field_mappings.length,
    0,
  );
  if (plan.declared_counts.parameter_enum_rows !== actualParameterEnumRows)
    errors.push("parameter enum row count does not match graph");
  if (plan.declared_counts.precedence_edges !== actualPrecedenceEdges)
    errors.push("precedence edge count does not match graph");
  if (plan.declared_counts.verifier_members !== actualVerifierMembers)
    errors.push("verifier member count does not match graph");
  if (plan.declared_counts.raw_field_mappings !== actualRawFieldMappings)
    errors.push("raw mapping count does not match graph");
  if (plan.adapter_receipts.length > plan.declared_limits.provider_count)
    errors.push("provider count exceeds pending aggregate limit");
  if (plan.endpoints.length > plan.declared_limits.endpoint_count)
    errors.push("endpoint count exceeds pending aggregate limit");
  if (
    plan.declared_counts.document_chunks > plan.declared_limits.document_chunks
  )
    errors.push("document chunk count exceeds pending aggregate limit");
  if (
    plan.declared_counts.normalized_rows >
    plan.declared_limits.normalized_row_count
  )
    errors.push("normalized row count exceeds accepted aggregate limit");
  if (
    plan.declared_counts.canonical_document_bytes >
    plan.declared_limits.canonical_document_bytes
  )
    errors.push("canonical document bytes exceed accepted aggregate limit");
  if (
    plan.declared_counts.root_input_bytes >
    plan.declared_limits.root_input_bytes
  )
    errors.push("root input bytes exceed accepted aggregate limit");
  if (actualParameterEnumRows > plan.declared_limits.parameter_enum_rows)
    errors.push("parameter enum rows exceed accepted aggregate limit");
  if (actualPrecedenceEdges > plan.declared_limits.precedence_edges)
    errors.push("precedence edges exceed accepted aggregate limit");
  if (actualVerifierMembers > plan.declared_limits.verifier_members)
    errors.push("verifier members exceed accepted aggregate limit");
  if (actualRawFieldMappings > plan.declared_limits.raw_field_mappings)
    errors.push("raw mappings exceed accepted aggregate limit");

  uniqueStrings(
    plan.adapter_receipts.map((receipt) => receipt.provider_id),
    "adapter providers",
    errors,
  );
  uniqueStrings(
    plan.endpoints.map((endpoint) => endpoint.endpoint_id),
    "endpoint identities",
    errors,
  );
  uniqueStrings(
    plan.verifier_implementations.map((entry) => entry.implementation_key),
    "verifier implementations",
    errors,
  );
  uniqueStrings(
    plan.verifier_policies.map((entry) => entry.verifier_policy_key),
    "verifier policies",
    errors,
  );
  for (const receipt of plan.adapter_receipts) {
    if (
      receipt.authority_plan_id !== plan.authority_plan_id ||
      receipt.run_plan_id !== plan.run_plan_id ||
      receipt.installation_id !== plan.installation_id
    )
      errors.push(
        `adapter receipt ${receipt.provider_id} has cross-plan identity`,
      );
    denseOrdinals(
      receipt.source_owner_receipts,
      `${receipt.provider_id} owners`,
      errors,
    );
    denseOrdinals(
      receipt.source_register_receipt.members,
      `${receipt.provider_id} register`,
      errors,
    );
    denseOrdinals(
      receipt.normalized_credentials,
      `${receipt.provider_id} credentials`,
      errors,
    );
    denseOrdinals(
      receipt.normalized_sources,
      `${receipt.provider_id} sources`,
      errors,
    );
  }

  const corpus = PROVENANCE_V2_FIELD_CORPUS as unknown as Static<
    typeof ProvenanceV2FieldCorpusSchema
  >;
  const groupEndpoints = new Map<string, Set<string>>();
  const endpointGroupDispositions = new Map<string, "admitted" | "excluded">();
  for (const endpoint of plan.endpoints) {
    denseOrdinals(
      endpoint.parameters,
      `${endpoint.endpoint_id} parameters`,
      errors,
    );
    denseOrdinals(
      endpoint.expected_fields,
      `${endpoint.endpoint_id} expected fields`,
      errors,
    );
    denseOrdinals(
      endpoint.raw_field_mappings,
      `${endpoint.endpoint_id} raw mappings`,
      errors,
    );
    uniqueStrings(
      endpoint.expected_fields.map((field) => field.canonical_field_path),
      `${endpoint.endpoint_id} expected field paths`,
      errors,
    );
    if (endpoint.uncompressed_byte_limit < endpoint.compressed_byte_limit)
      errors.push(`${endpoint.endpoint_id} uncompressed limit is too small`);
    for (const mapping of endpoint.raw_field_mappings) {
      if (
        mapping.authority_plan_id !== plan.authority_plan_id ||
        mapping.endpoint_id !== endpoint.endpoint_id
      )
        errors.push(
          `${endpoint.endpoint_id} contains a cross-endpoint raw mapping`,
        );
      const expected = endpoint.expected_fields.find(
        (field) => field.canonical_field_path === mapping.canonical_field_path,
      );
      if (expected?.record_group !== mapping.record_group)
        errors.push(
          `${endpoint.endpoint_id} raw mapping lacks an exact expected field`,
        );
      if (
        (mapping.value_source === "registered_literal") !==
        (mapping.registered_value !== null)
      )
        errors.push(
          `${endpoint.endpoint_id}.${mapping.canonical_field_path} has an invalid registered-literal shape`,
        );
    }
    for (const expected of endpoint.expected_fields) {
      const members =
        groupEndpoints.get(expected.record_group) ?? new Set<string>();
      members.add(endpoint.endpoint_id);
      groupEndpoints.set(expected.record_group, members);
      if (
        !endpoint.raw_field_mappings.some(
          (mapping) =>
            mapping.canonical_field_path === expected.canonical_field_path &&
            mapping.record_group === expected.record_group,
        )
      )
        errors.push(
          `${endpoint.endpoint_id}.${expected.canonical_field_path} lacks a raw mapping`,
        );
      if (
        (expected.disposition === "admitted") !==
        (expected.exclusion_reason === null)
      )
        errors.push(
          `${endpoint.endpoint_id}.${expected.canonical_field_path} has an invalid disposition reason`,
        );
    }
    for (const recordGroup of new Set(
      endpoint.expected_fields.map((field) => field.record_group),
    )) {
      const group = corpus.record_groups.find(
        (candidate) => candidate.record_group === recordGroup,
      );
      const expectedFields = endpoint.expected_fields.filter(
        (field) => field.record_group === recordGroup,
      );
      if (
        group?.field_paths.length !== expectedFields.length ||
        group.field_paths.some(
          (fieldPath, index) =>
            expectedFields[index]?.canonical_field_path !== fieldPath,
        )
      )
        errors.push(
          `${endpoint.endpoint_id}.${recordGroup} does not declare the complete ordered corpus tuple`,
        );
      const dispositions = new Set(
        expectedFields.map((field) => field.disposition),
      );
      if (dispositions.size !== 1)
        errors.push(
          `${endpoint.endpoint_id}.${recordGroup} mixes admitted and excluded fields`,
        );
      else {
        const disposition = dispositions.values().next().value;
        if (disposition !== undefined)
          endpointGroupDispositions.set(
            `${recordGroup}\u0000${endpoint.endpoint_id}`,
            disposition,
          );
      }
      const mappingPaths = endpoint.raw_field_mappings
        .filter((mapping) => mapping.record_group === recordGroup)
        .map((mapping) => mapping.canonical_field_path);
      if (
        group?.field_paths.length !== mappingPaths.length ||
        group.field_paths.some(
          (fieldPath) =>
            mappingPaths.filter((candidate) => candidate === fieldPath)
              .length !== 1,
        )
      )
        errors.push(
          `${endpoint.endpoint_id}.${recordGroup} lacks one exact mapping per tuple field`,
        );
    }
  }

  for (const policy of plan.field_policies) {
    const group = corpus.record_groups.find(
      (candidate) => candidate.record_group === policy.record_group,
    );
    if (
      group?.field_paths.length !== policy.field_paths.length ||
      group.field_paths.some(
        (path, index) => policy.field_paths[index] !== path,
      )
    )
      errors.push(
        `${policy.record_group} policy does not cover its exact ordered tuple`,
      );
    denseOrdinals(
      policy.precedence_classes,
      `${policy.record_group} classes`,
      errors,
    );
    denseOrdinals(
      policy.precedence_edges,
      `${policy.record_group} edges`,
      errors,
    );
    denseOrdinals(
      policy.endpoint_dispositions,
      `${policy.record_group} dispositions`,
      errors,
    );
    const classKeys = policy.precedence_classes.map((entry) => entry.class_key);
    uniqueStrings(classKeys, `${policy.record_group} class keys`, errors);
    const sourceClasses = policy.precedence_classes.flatMap(
      (entry) => entry.source_classes,
    );
    uniqueStrings(
      sourceClasses,
      `${policy.record_group} source-class memberships`,
      errors,
    );
    if (!graphIsTotalOrder(classKeys, policy.precedence_edges))
      errors.push(
        `${policy.record_group} precedence graph is not a total order`,
      );
    const structuredClass = policy.precedence_classes.find(
      (entry) =>
        entry.source_classes.includes("provider_exact_api") ||
        entry.source_classes.includes("provider_exact_authenticated_catalog"),
    );
    if (
      structuredClass === undefined ||
      !structuredClass.source_classes.includes("provider_exact_api") ||
      !structuredClass.source_classes.includes(
        "provider_exact_authenticated_catalog",
      )
    )
      errors.push(
        `${policy.record_group} does not place API and catalog in one class`,
      );
    const expectedEndpoints =
      groupEndpoints.get(policy.record_group) ?? new Set<string>();
    const dispositionEndpoints = policy.endpoint_dispositions.map(
      (entry) => entry.endpoint_id,
    );
    uniqueStrings(
      dispositionEndpoints,
      `${policy.record_group} endpoint dispositions`,
      errors,
    );
    if (
      expectedEndpoints.size !== dispositionEndpoints.length ||
      [...expectedEndpoints].some(
        (endpointId) => !dispositionEndpoints.includes(endpointId),
      )
    )
      errors.push(
        `${policy.record_group} lacks exhaustive endpoint disposition closure`,
      );
    for (const disposition of policy.endpoint_dispositions) {
      const admitted = disposition.disposition === "admitted";
      const fieldDisposition = endpointGroupDispositions.get(
        `${policy.record_group}\u0000${disposition.endpoint_id}`,
      );
      if (
        fieldDisposition !== undefined &&
        fieldDisposition !== disposition.disposition
      )
        errors.push(
          `${policy.record_group}.${disposition.endpoint_id} field and policy dispositions disagree`,
        );
      if (
        admitted !==
        (disposition.class_key !== null &&
          disposition.authority_source_class !== null &&
          disposition.admission_role !== null &&
          disposition.exclusion_reason === null)
      )
        errors.push(
          `${policy.record_group}.${disposition.endpoint_id} has an invalid admission/exclusion shape`,
        );
      if (
        admitted &&
        disposition.authority_source_class !== null &&
        !policy.precedence_classes.some((entry) => {
          const authoritySourceClass = disposition.authority_source_class;
          return (
            authoritySourceClass !== null &&
            entry.class_key === disposition.class_key &&
            entry.source_classes.includes(authoritySourceClass)
          );
        })
      )
        errors.push(
          `${policy.record_group}.${disposition.endpoint_id} references no exact class membership`,
        );
      if (
        admitted &&
        (disposition.authority_source_class === "publisher_checkpoint" ||
          disposition.authority_source_class ===
            "independent_structured_catalog") &&
        disposition.admission_role === "primary"
      )
        errors.push(
          `${policy.record_group}.${disposition.endpoint_id} promotes a forbidden primary source`,
        );
      if (
        admitted &&
        (disposition.authority_source_class === "provider_exact_api" ||
          disposition.authority_source_class ===
            "provider_exact_authenticated_catalog") &&
        disposition.admission_role !== "primary"
      )
        errors.push(
          `${policy.record_group}.${disposition.endpoint_id} weakens structured-provider equality`,
        );
    }
  }
  return errors;
};
