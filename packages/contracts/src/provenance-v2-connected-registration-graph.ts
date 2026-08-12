import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  PROVENANCE_V2_FIELD_CORPUS,
} from "./provenance-v2-registration.js";
import { PROVENANCE_V2_ROOT_BINDING_PLAN } from "./provenance-v2-root-binding-plan.js";

const REVIEW_CANDIDATE_SCHEMA = {
  "x-quantclarity-contract-status": "review_candidate",
} as const;
const digest = () => Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const fieldValue = Type.Union([
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 64 }),
      tag: Type.Literal("null"),
      value: Type.Null(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 64 }),
      tag: Type.Literal("text"),
      value: Type.String({ maxLength: 512 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 64 }),
      tag: Type.Literal("integer"),
      value: Type.String({ pattern: "^(?:0|[1-9][0-9]{0,15})$" }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 64 }),
      tag: Type.Literal("boolean"),
      value: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 64 }),
      tag: Type.Literal("digest"),
      value: digest(),
    },
    { additionalProperties: false },
  ),
]);

export const ProvenanceV2ConnectedRegistrationGraphSchema = Type.Object(
  {
    contract_version: Type.Literal(
      "provenance-v2-connected-registration-graph@1",
    ),
    status: Type.Literal("review_candidate"),
    coverage: Type.Literal(
      "complete_synthetic_registration_preimage_inventory",
    ),
    authority_eligible: Type.Literal(false),
    outcome: Type.Literal("authority_refused"),
    registry_contract_version: Type.Literal("provenance-v2-root-registry@1"),
    binding_plan_contract_version: Type.Literal(
      "provenance-v2-root-binding-plan@1",
    ),
    field_corpus_contract_version: Type.Literal("provenance-v2-field-corpus@1"),
    pending: Type.Object(
      {
        leaf_and_traversal_recomputation: Type.Literal("pending"),
        derived_digest_linkage: Type.Literal("pending"),
        document_and_anchor_resolvers: Type.Literal("pending"),
        semantic_oracle: Type.Literal("pending"),
        repository_build_manifest: Type.Literal("pending"),
        migration_schema_parity: Type.Literal("pending"),
        accepted_aggregate_limits: Type.Literal("pending"),
      },
      { additionalProperties: false },
    ),
    selected_scope: Type.Object(
      {
        authority_plan_id: Type.String({ minLength: 1, maxLength: 64 }),
        provider_id: Type.String({ minLength: 1, maxLength: 64 }),
        endpoint_id: Type.String({ minLength: 1, maxLength: 64 }),
      },
      { additionalProperties: false },
    ),
    root_member_row_count: Type.Literal(371),
    table_counts: Type.Array(
      Type.Object(
        {
          table: Type.String({
            pattern: "^provenance_v2_[a-z0-9_]+$",
            maxLength: 96,
          }),
          count: Type.Integer({ minimum: 1, maximum: 201 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 33, maxItems: 33 },
    ),
    collection_member_counts: Type.Object(
      {
        adapter_manifest_set_root: Type.Literal(17),
        endpoint_set_root: Type.Literal(73),
        verifier_policy_set_root: Type.Literal(3),
        field_policy_set_root: Type.Literal(278),
      },
      { additionalProperties: false },
    ),
    authority_entity_counts: Type.Object(
      {
        adapter_manifest_count: Type.Literal(1),
        endpoint_count: Type.Literal(1),
        verifier_policy_count: Type.Literal(1),
        field_policy_count: Type.Literal(4),
      },
      { additionalProperties: false },
    ),
    rows: Type.Array(
      Type.Object(
        {
          row_id: Type.String({
            pattern: "^row-[a-z0-9_-]+$",
            maxLength: 160,
          }),
          table: Type.String({
            pattern: "^provenance_v2_[a-z0-9_]+$",
            maxLength: 96,
          }),
          fields: Type.Array(fieldValue, { minItems: 1, maxItems: 64 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 371, maxItems: 371 },
    ),
    ordering_probes: Type.Object(
      {
        connected_integer_ordinals: Type.Array(
          Type.String({ pattern: "^(?:[0-9]|10)$" }),
          { minItems: 11, maxItems: 11, uniqueItems: true },
        ),
        comparator_only_utf8_binary: Type.Array(
          Type.Union([Type.Literal("z"), Type.Literal("é")]),
          { minItems: 2, maxItems: 2, uniqueItems: true },
        ),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: "ProvenanceV2ConnectedRegistrationGraph",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

type Scalar = string | number | boolean | null;
type Overrides = Readonly<Record<string, Scalar>>;
type GraphRow = Readonly<{
  row_id: string;
  table: string;
  fields: readonly Readonly<{
    name: string;
    tag: "null" | "text" | "integer" | "boolean" | "digest";
    value: string | boolean | null;
  }>[];
}>;

const PLAN = "vpa_11111111-1111-4111-8111-111111111111";
const RUN = "rpl_22222222-2222-4222-8222-222222222222";
const INSTALLATION = "pvi_33333333-3333-4333-8333-333333333333";
const PROVIDER = "prv_44444444-4444-4444-8444-444444444444";
const ENDPOINT = "sep_55555555-5555-4555-8555-555555555555";
const PROVIDER_ORGANIZATION = "org_66666666-6666-4666-8666-666666666666";
const SOURCE = "source-connected";
const REGISTER_VERSION = "register-connected@1";
const VERIFIER = "verifier-connected";
const IMPLEMENTATION = "implementation-connected";
const START_MS = 1_786_406_400_000;
const END_MS = 1_786_492_800_000;
const CORPUS = PROVENANCE_V2_FIELD_CORPUS;
type CorpusEnumDomain = keyof typeof CORPUS.enum_domains;
type CorpusField = Readonly<{
  ordinal: number;
  field_path: string;
  field_group: string;
  record_group: string;
  value_kind: string;
  cardinality: string;
  nullability: string;
  requirement_state: string;
  enum_domain: CorpusEnumDomain | null;
  source_mappability: string;
  allowed_authority_roles: readonly string[];
}>;
type CorpusGroup = Readonly<{
  ordinal: number;
  record_group: string;
  equality_rule: string;
  field_paths: readonly string[];
}>;
const CORPUS_FIELDS = CORPUS.fields as unknown as readonly CorpusField[];
const CORPUS_GROUPS = CORPUS.record_groups as unknown as readonly CorpusGroup[];

const fixtureDigest = (ordinal: number): string =>
  `sha256:${ordinal.toString(16).padStart(64, "0")}`;
let rowSequence = 0;

const defaultValue = (name: string): Scalar => {
  const exact: Readonly<Record<string, Scalar>> = {
    authority_plan_id: PLAN,
    run_plan_id: RUN,
    installation_id: INSTALLATION,
    provider_id: PROVIDER,
    endpoint_id: ENDPOINT,
    source_id: SOURCE,
    environment: "production",
    register_version: REGISTER_VERSION,
    source_register_version: REGISTER_VERSION,
    verifier_policy_key: VERIFIER,
    implementation_key: IMPLEMENTATION,
    provider_organization_id: PROVIDER_ORGANIZATION,
    owner_organization_id: PROVIDER_ORGANIZATION,
    source_owner_organization_id: PROVIDER_ORGANIZATION,
    owner_kind: "provider_operator",
    source_owner_kind: "provider_operator",
    provider_owner_relationship: "provider_controlled",
    identity_contract_version: "provenance-v2-source-owner@1",
    adapter_contract_version: "1.0.0",
    adapter_version: `1.0.0+sha256.${"a".repeat(64)}`,
    adapter_source_type: "provider_api",
    authority_source_class: "provider_exact_api",
    host_ascii: "api.example.invalid",
    effective_from_ms: START_MS,
    effective_to_ms: END_MS,
    created_at_ms: START_MS,
    approved_at_ms: START_MS,
    reviewed_at_ms: START_MS,
    next_review_at_ms: END_MS,
    manifest_duration_ms: 10_000,
    timeout_ms: 10_000,
    elapsed_millisecond_ceiling: 20_000,
  };
  if (Object.hasOwn(exact, name)) return exact[name] ?? null;
  if (name.endsWith("_count") || name.endsWith("_ordinal")) return 0;
  if (name === "ordinal") return 0;
  if (
    name.endsWith("_permitted") ||
    name.endsWith("_approved") ||
    name.endsWith("_required")
  )
    return true;
  if (name.endsWith("_ms")) return START_MS;
  return `fixture-${name}`;
};

const makeRow = (
  table: string,
  suffix: string,
  overrides: Overrides = {},
): GraphRow => {
  const entry = PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.find(
    (candidate) => candidate.table === table,
  );
  if (entry?.disposition !== "root_member")
    throw new Error("connected graph table is not a root member");
  const rowDigestBase = rowSequence * 64;
  rowSequence += 1;
  const fields = entry.fields
    .filter((field) => field.name !== entry.digest_output)
    .map((field, index) => {
      const supplied = overrides[field.name];
      const semanticDefault = defaultValue(field.name);
      const fallback =
        field.frame_type === "integer"
          ? typeof semanticDefault === "number"
            ? semanticDefault
            : field.name.endsWith("_count") ||
                field.name.endsWith("_ordinal") ||
                field.name === "ordinal"
              ? 0
              : 1
          : field.frame_type === "boolean"
            ? field.name.endsWith("_permitted") ||
              field.name.endsWith("_approved") ||
              field.name.endsWith("_required")
            : semanticDefault;
      const value = supplied === undefined ? fallback : supplied;
      if (value === null) {
        if (!field.nullable)
          throw new Error("connected graph assigned null to a non-null field");
        return Object.freeze({
          name: field.name,
          tag: "null" as const,
          value: null,
        });
      }
      const tag = field.frame_type;
      return Object.freeze({
        name: field.name,
        tag,
        value:
          tag === "integer"
            ? String(value)
            : tag === "boolean"
              ? Boolean(value)
              : tag === "digest"
                ? String(value).startsWith("sha256:")
                  ? String(value)
                  : fixtureDigest(rowDigestBase + index + 1)
                : String(value),
      });
    });
  return Object.freeze({
    row_id: `row-${table.replace(/^provenance_v2_/u, "")}-${suffix}`,
    table,
    fields: Object.freeze(fields),
  });
};

const globalCorpusRows = (): GraphRow[] => {
  const rows: GraphRow[] = [];
  for (const field of CORPUS_FIELDS) {
    rows.push(
      makeRow(
        "provenance_v2_field_path_vocabulary",
        `field-${String(field.ordinal)}`,
        {
          vocabulary_version: CORPUS.contract_version,
          ordinal: field.ordinal,
          field_path: field.field_path,
          field_group: field.field_group,
          record_group: field.record_group,
          value_kind: field.value_kind,
          cardinality: field.cardinality,
          nullability: field.nullability,
          requirement_state: field.requirement_state,
          enum_domain: field.enum_domain,
          source_mappability: field.source_mappability,
        },
      ),
    );
    field.allowed_authority_roles.forEach((role, ordinal) =>
      rows.push(
        makeRow(
          "provenance_v2_field_path_authority_role",
          `field-${String(field.ordinal)}-role-${String(ordinal)}`,
          { field_path: field.field_path, ordinal, authority_role: role },
        ),
      ),
    );
    if (field.enum_domain !== null) {
      CORPUS.enum_domains[field.enum_domain].forEach((enumValue, ordinal) =>
        rows.push(
          makeRow(
            "provenance_v2_field_path_enum_value",
            `field-${String(field.ordinal)}-enum-${String(ordinal)}`,
            { field_path: field.field_path, ordinal, enum_value: enumValue },
          ),
        ),
      );
    }
  }
  for (const group of CORPUS_GROUPS) {
    rows.push(
      makeRow(
        "provenance_v2_field_record_group",
        `group-${String(group.ordinal)}`,
        {
          ordinal: group.ordinal,
          record_group: group.record_group,
          equality_rule: group.equality_rule,
          member_count: group.field_paths.length,
        },
      ),
    );
    group.field_paths.forEach((fieldPath, ordinal) =>
      rows.push(
        makeRow(
          "provenance_v2_field_record_group_member",
          `group-${String(group.ordinal)}-member-${String(ordinal)}`,
          { record_group: group.record_group, ordinal, field_path: fieldPath },
        ),
      ),
    );
  }
  return rows;
};

const adapterRows = (): GraphRow[] => [
  makeRow("provenance_v2_source_owner_receipt", "owner", {
    ordinal: 0,
    owner_organization_id: PROVIDER_ORGANIZATION,
    owner_kind: "provider_operator",
    provider_owner_relationship: "provider_controlled",
  }),
  makeRow("provenance_v2_source_register_receipt", "receipt", {
    member_count: 1,
    access_permitted: true,
    retention_permitted: true,
    excerpt_permitted: true,
    publication_permitted: true,
    approval_state: "approved",
  }),
  makeRow("provenance_v2_source_register_member", "member", {
    ordinal: 0,
  }),
  makeRow("provenance_v2_adapter_manifest_receipt", "receipt", {
    provider_ordinal: 0,
    receipt_contract_version: "provenance-v2-adapter-receipt@1",
    source_count: 1,
    environment_count: 1,
    credential_count: 11,
    extraction_policy_version: null,
  }),
  makeRow("provenance_v2_adapter_manifest_environment", "environment", {
    ordinal: 0,
  }),
  ...Array.from({ length: 11 }, (_, ordinal) =>
    makeRow(
      "provenance_v2_adapter_manifest_credential",
      `credential-${String(ordinal)}`,
      {
        ordinal,
        binding_name: `PROVIDER_API_TOKEN_${String(ordinal).padStart(2, "0")}`,
      },
    ),
  ),
  makeRow("provenance_v2_adapter_manifest_source", "source", {
    source_ordinal: 0,
  }),
];

const endpointRows = (): GraphRow[] => {
  const rows: GraphRow[] = [
    makeRow("provenance_v2_source_endpoint", "endpoint", {
      endpoint_ordinal: 0,
    }),
    makeRow("provenance_v2_source_endpoint_registration", "registration"),
    makeRow("provenance_v2_source_endpoint_request", "request", {
      scheme: "https",
      method: "GET",
      authentication_class: "bearer",
      credential_binding_name: "PROVIDER_API_TOKEN_00",
      credential_injection: "authorization_bearer",
      credential_header: "Authorization",
      parameter_count: 1,
      allowed_header_count: 1,
      redirect_host_count: 1,
      content_type_count: 1,
      expected_field_count: CORPUS_FIELDS.length,
      raw_field_mapping_count: CORPUS_FIELDS.length,
    }),
    makeRow("provenance_v2_source_endpoint_parameter", "parameter", {
      ordinal: 0,
      parameter_name: "model",
      location: "query",
      value_type: "string",
      required: true,
      pattern_hash: null,
      maximum_length: 128,
      enum_count: 1,
    }),
    makeRow("provenance_v2_source_endpoint_parameter_enum", "enum", {
      parameter_ordinal: 0,
      parameter_name: "model",
      ordinal: 0,
    }),
    makeRow("provenance_v2_source_endpoint_allowed_header", "header", {
      ordinal: 0,
      header_name: "Authorization",
    }),
    makeRow("provenance_v2_source_endpoint_redirect_host", "redirect", {
      ordinal: 0,
    }),
    makeRow("provenance_v2_source_endpoint_content_type", "content-type", {
      ordinal: 0,
      content_type: "application/json",
    }),
  ];
  for (const field of CORPUS_FIELDS) {
    const excluded = field.record_group === "precision_component_tuple@1";
    rows.push(
      makeRow(
        "provenance_v2_source_endpoint_expected_field",
        `expected-${String(field.ordinal)}`,
        {
          ordinal: field.ordinal,
          raw_provider_field: `raw_field_${String(field.ordinal)}`,
          field_path: field.field_path,
          declaration_kind:
            field.record_group === "offering_applicability@1"
              ? "applicability"
              : field.field_group === "price"
                ? "price"
                : "precision",
          record_group: field.record_group,
          disposition: excluded ? "excluded" : "admitted",
          exclusion_reason: excluded ? "not_launch_corpus" : null,
        },
      ),
      makeRow(
        "provenance_v2_source_endpoint_raw_field_mapping",
        `mapping-${String(field.ordinal)}`,
        {
          ordinal: field.ordinal,
          declaration_kind:
            field.record_group === "offering_applicability@1"
              ? "applicability"
              : field.field_group === "price"
                ? "price"
                : "precision",
          record_group: field.record_group,
          record_selector: "/items/*",
          raw_locator_kind: "json_pointer_pattern@1",
          raw_locator: `/raw_field_${String(field.ordinal)}`,
          raw_label: `raw_field_${String(field.ordinal)}`,
          canonical_field_path: field.field_path,
          value_source:
            field.source_mappability === "field_identity_literal"
              ? "field_identity_literal"
              : field.source_mappability === "registered_literal"
                ? "registered_literal"
                : field.source_mappability === "observation_timestamp"
                  ? "observation_timestamp"
                  : "observed_value",
          registered_value:
            field.source_mappability === "registered_literal"
              ? `registered-${field.field_path}`
              : null,
        },
      ),
    );
  }
  rows.push(makeRow("provenance_v2_source_endpoint_approval", "approval"));
  return rows;
};

const verifierRows = (): GraphRow[] => [
  makeRow("provenance_v2_verifier_implementation", "implementation", {
    ordinal: 0,
    implementation_kind: "deterministic_parser",
    family_key: "deterministic-parser",
    prompt_hash: null,
    deterministic_procedure_hash: fixtureDigest(900_001),
  }),
  makeRow("provenance_v2_verifier_policy", "policy", {
    ordinal: 0,
    profile_kind: "deterministic_structured",
    minimum_member_count: 1,
    minimum_distinct_family_count: 1,
    span_entailment_required: false,
    independent_corroboration_required: false,
    confidence_semantics: "not_applicable",
    minimum_confidence_ppm: 0,
    disagreement_action: "quarantine",
    member_count: 1,
  }),
  makeRow("provenance_v2_verifier_policy_member", "member", {
    ordinal: 0,
    member_role: "primary",
  }),
];

const fieldPolicyRows = (): GraphRow[] => {
  const rows = globalCorpusRows();
  for (const group of CORPUS_GROUPS) {
    const twoClasses = group.ordinal === 0;
    rows.push(
      makeRow("provenance_v2_field_policy", `policy-${String(group.ordinal)}`, {
        ordinal: group.ordinal,
        record_group: group.record_group,
        policy_version: "policy-connected@1",
        order_kind: "total",
        equality_rule: group.equality_rule,
        confidence_semantics: "not_applicable",
        minimum_confidence_ppm: 0,
        conflict_rule: "unknown",
        quarantine_rule: "affected_field",
        field_count: group.field_paths.length,
        precedence_class_count: twoClasses ? 2 : 1,
        precedence_edge_count: twoClasses ? 1 : 0,
        endpoint_disposition_count: 1,
      }),
    );
    group.field_paths.forEach((fieldPath, ordinal) =>
      rows.push(
        makeRow(
          "provenance_v2_field_policy_member",
          `policy-${String(group.ordinal)}-member-${String(ordinal)}`,
          {
            record_group: group.record_group,
            ordinal,
            field_path: fieldPath,
          },
        ),
      ),
    );
    const primaryClass = `structured-${String(group.ordinal)}`;
    rows.push(
      makeRow(
        "provenance_v2_field_policy_precedence_class",
        `class-${String(group.ordinal)}-primary`,
        {
          record_group: group.record_group,
          class_key: primaryClass,
          ordinal: 0,
          source_class_count: 2,
        },
      ),
      makeRow(
        "provenance_v2_field_policy_precedence_class_source",
        `class-${String(group.ordinal)}-api`,
        {
          record_group: group.record_group,
          class_key: primaryClass,
          ordinal: 0,
          authority_source_class: "provider_exact_api",
        },
      ),
      makeRow(
        "provenance_v2_field_policy_precedence_class_source",
        `class-${String(group.ordinal)}-catalog`,
        {
          record_group: group.record_group,
          class_key: primaryClass,
          ordinal: 1,
          authority_source_class: "provider_exact_authenticated_catalog",
        },
      ),
    );
    if (twoClasses) {
      rows.push(
        makeRow(
          "provenance_v2_field_policy_precedence_class",
          "class-0-secondary",
          {
            record_group: group.record_group,
            class_key: "public-documentation",
            ordinal: 1,
            source_class_count: 1,
          },
        ),
        makeRow(
          "provenance_v2_field_policy_precedence_class_source",
          "class-0-docs",
          {
            record_group: group.record_group,
            class_key: "public-documentation",
            ordinal: 0,
            authority_source_class: "provider_controlled_public",
          },
        ),
        makeRow("provenance_v2_field_policy_precedence_edge", "edge-0", {
          record_group: group.record_group,
          ordinal: 0,
          higher_class_key: primaryClass,
          lower_class_key: "public-documentation",
        }),
      );
    }
    if (group.ordinal === 3)
      rows.push(
        makeRow(
          "provenance_v2_field_policy_endpoint_exclusion",
          "exclusion-3",
          {
            record_group: group.record_group,
            ordinal: 0,
            reason_code: "not_launch_corpus",
          },
        ),
      );
    else
      rows.push(
        makeRow(
          "provenance_v2_field_policy_endpoint_admission",
          `admission-${String(group.ordinal)}`,
          {
            record_group: group.record_group,
            ordinal: 0,
            class_key: primaryClass,
            authority_source_class: "provider_exact_api",
            admission_role: "primary",
          },
        ),
      );
  }
  return rows;
};

const rows = Object.freeze([
  ...adapterRows(),
  ...endpointRows(),
  ...verifierRows(),
  ...fieldPolicyRows(),
]);

const rootTables = PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries
  .filter((entry) => entry.disposition === "root_member")
  .map((entry) => entry.table);
const tableCounts = Object.freeze(
  rootTables.map((table) =>
    Object.freeze({
      table,
      count: rows.filter((row) => row.table === table).length,
    }),
  ),
);

export const PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH = Object.freeze({
  contract_version: "provenance-v2-connected-registration-graph@1",
  status: "review_candidate",
  coverage: "complete_synthetic_registration_preimage_inventory",
  authority_eligible: false,
  outcome: "authority_refused",
  registry_contract_version: "provenance-v2-root-registry@1",
  binding_plan_contract_version: "provenance-v2-root-binding-plan@1",
  field_corpus_contract_version: "provenance-v2-field-corpus@1",
  pending: Object.freeze({
    leaf_and_traversal_recomputation: "pending",
    derived_digest_linkage: "pending",
    document_and_anchor_resolvers: "pending",
    semantic_oracle: "pending",
    repository_build_manifest: "pending",
    migration_schema_parity: "pending",
    accepted_aggregate_limits: "pending",
  }),
  selected_scope: Object.freeze({
    authority_plan_id: PLAN,
    provider_id: PROVIDER,
    endpoint_id: ENDPOINT,
  }),
  root_member_row_count: 371,
  table_counts: tableCounts,
  collection_member_counts: Object.freeze({
    adapter_manifest_set_root: 17,
    endpoint_set_root: 73,
    verifier_policy_set_root: 3,
    field_policy_set_root: 278,
  }),
  authority_entity_counts: Object.freeze({
    adapter_manifest_count: 1,
    endpoint_count: 1,
    verifier_policy_count: 1,
    field_policy_count: 4,
  }),
  rows,
  ordering_probes: Object.freeze({
    connected_integer_ordinals: Object.freeze(
      Array.from({ length: 11 }, (_, ordinal) => String(ordinal)),
    ),
    comparator_only_utf8_binary: Object.freeze(["z", "é"]),
  }),
} as const);

const utf8ByteLengthWithin = (value: string, maximum: number): number => {
  if (value.length > maximum) return maximum + 1;
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) return Number.MAX_SAFE_INTEGER;
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
    budget.stringBytes += utf8ByteLengthWithin(
      value,
      1_000_000 - budget.stringBytes,
    );
    return budget.stringBytes <= 1_000_000 ? value : undefined;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== "object" || depth > 12 || seen.has(value))
    return undefined;
  let prototype: object | null;
  let keys: readonly (string | symbol)[];
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Reflect.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return undefined;
  }
  if (++budget.nodes > 8_192 || keys.length > 1_024) return undefined;
  budget.properties += keys.length;
  if (budget.properties > 80_000 || keys.some((key) => typeof key === "symbol"))
    return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const lengthDescriptor = descriptors.length;
    if (
      prototype !== Array.prototype ||
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      (lengthDescriptor.value as number) < 0 ||
      (lengthDescriptor.value as number) > 512 ||
      keys.length !== (lengthDescriptor.value as number) + 1
    )
      return undefined;
    const length = lengthDescriptor.value as number;
    const copy: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor))
        return undefined;
      const child = snapshotPlainData(
        descriptor.value,
        seen,
        budget,
        depth + 1,
      );
      if (child === undefined) return undefined;
      copy.push(child);
    }
    return copy;
  }
  if (prototype !== Object.prototype) return undefined;
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    if (key.length > 128) return undefined;
    budget.stringBytes += utf8ByteLengthWithin(
      key,
      1_000_000 - budget.stringBytes,
    );
    if (budget.stringBytes > 1_000_000) return undefined;
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const child = snapshotPlainData(descriptor.value, seen, budget, depth + 1);
    if (child === undefined) return undefined;
    copy[key] = child;
  }
  return copy;
};

export const validateProvenanceV2ConnectedRegistrationGraph = (
  value: unknown,
): string[] => {
  const snapshot = snapshotPlainData(value);
  if (!Value.Check(ProvenanceV2ConnectedRegistrationGraphSchema, snapshot))
    return ["connected registration graph does not match its closed schema"];
  const candidate = snapshot as {
    rows: readonly {
      fields: readonly { tag: string; value: unknown }[];
    }[];
  };
  if (
    candidate.rows.some((row) =>
      row.fields.some(
        (field) =>
          field.tag === "integer" &&
          (typeof field.value !== "string" ||
            BigInt(field.value) > BigInt(Number.MAX_SAFE_INTEGER)),
      ),
    )
  )
    return ["connected registration graph contains an unsafe integer"];
  if (
    JSON.stringify(snapshot) !==
    JSON.stringify(PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH)
  )
    return ["connected registration graph must equal the reviewed singleton"];
  if (PROVENANCE_V2_ROOT_BINDING_PLAN.traversals.length !== 9)
    return [
      "connected registration graph requires the reviewed traversal inventory",
    ];
  return [];
};
