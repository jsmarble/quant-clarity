import { FormatRegistry, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  PROVENANCE_V2_FIELD_CORPUS,
  ProvenanceV2RegistrationPlanSchema,
  type ProvenanceV2RegistrationPlan,
} from "./provenance-v2-registration.js";
import { PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT } from "./provenance-v2-canonical-document.js";
import { PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH } from "./provenance-v2-connected-registration-graph.js";
import { PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS } from "./provenance-v2-connected-successor-manifest-vectors.js";
import { PROVENANCE_V2_ROOT_BINDING_PLAN } from "./provenance-v2-root-binding-plan.js";

const REVIEW_CANDIDATE_SCHEMA = {
  "x-quantclarity-contract-status": "review_candidate",
} as const;
const SHA256 = "^sha256:[0-9a-f]{64}$";
const PLAN = "vpa_11111111-1111-4111-8111-111111111111";
const RUN = "rpl_22222222-2222-4222-8222-222222222222";
const INSTALLATION = "pvi_33333333-3333-4333-8333-333333333333";
const PROVIDER = "prv_44444444-4444-4444-8444-444444444444";
const ENDPOINT = "sep_55555555-5555-4555-8555-555555555555";
const ORGANIZATION = "org_66666666-6666-4666-8666-666666666666";
const SOURCE = "source-connected";
const START_MS = 1_786_406_400_000;
const END_MS = 1_786_492_800_000;
const CHUNK_BYTES = 4_096;
const DOCUMENT_HASH =
  "sha256:a01345c5edc943f99316ca2353959b98eaf644695d72c5479616b2b6fefd47f5";
const CHUNK_HASHES = Object.freeze([
  "sha256:dcdb710a89cd278bfb682f975a92d2bf6f2a8d9c9d5147ebf17b5df88da46b59",
  "sha256:601ef6044be72c04ca373078b16df707f02bed7e49c3b5afe375989f59741e34",
  "sha256:cfeefb87574ced55379174a91b24752408bbd3ebc8f098fd4199c16110bc13a4",
  "sha256:51376a3cc5cee5707a69bfdae50c208868e1b5fbe22abf30a295ca86e00f5b17",
  "sha256:275a6be72224e19bbc69ffe69148581a9285867129fb537c9fc172c69f1633dd",
  "sha256:b7937701d8e9ed0c96c2207d1a19b382813890a74d627cbd9d0b3892dd041ab5",
  "sha256:226e57cbf22b965c4cce93a9cf3e2cc25ea213c7944757745a941b0e89cdb9f6",
  "sha256:9b042a06294897ee8554be0a85098f2ce5f14cc3c982e98428ab373d60722f66",
  "sha256:ebf34e96c5b8c472d3ca36ca33d7da898c22e40c0d4a00244de555456a478c60",
  "sha256:8c5b46a07415e559640185d9eee5b2e643cd6d24de9807cea1b6836fdc15fa44",
  "sha256:f961a38e05b37ef89e798a5194b93b7e573b3c21f1d44e987f1fdd84685104be",
  "sha256:f4aae859115affb7b7f7ee5422852a52b38006cdee77aad721157ce3e85bcc23",
] as const);
const placeholder = (ordinal: number): string =>
  `sha256:${ordinal.toString(16).padStart(64, "0")}`;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value))
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
};

const canonical = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
};

const utf8 = (value: string): Uint8Array => {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) throw new Error("invalid fixture text");
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff)
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff)
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    else
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
  }
  return Uint8Array.from(bytes);
};

const legacyManifest = {
  contract_version: "1.0.0",
  provider_id: PROVIDER,
  adapter_version: `1.0.0+sha256.${"a".repeat(64)}`,
  enabled_environments: ["production"],
  source_policy_version: "source-policy-connected@1",
  sources: [
    {
      source_id: SOURCE,
      scheme: "https",
      host: "api.example.invalid",
      path_template: "/v1/models",
      safe_locator_template: "/v1/safe-models",
      parameters: [
        {
          name: "model",
          location: "query",
          value_type: "string",
          required: true,
          enum_values: ["fixture-model"],
          pattern: null,
          maximum_length: 128,
        },
      ],
      method: "GET",
      authentication_class: "bearer",
      credential_handle: "PROVIDER_API_TOKEN_00",
      credential_injection: "authorization_bearer",
      credential_header: "Authorization",
      allowed_headers: ["Authorization"],
      source_type: "provider_api",
      pagination: "single_page",
      content_types: ["application/json"],
      compressed_byte_limit: 1_048_576,
      uncompressed_byte_limit: 2_097_152,
      timeout_ms: 10_000,
      redirect_limit: 1,
      redirect_hosts: ["api.example.invalid"],
      provider_rate_limit: "one_request_per_second",
      crawl_purpose: "public_provider_catalog",
      robots_policy: "respect_disallow",
      content_signals_policy: "respect_machine_readable_signals",
      retention_permitted: true,
      publication_permitted: true,
      expected_precision_fields: ["precision"],
      expected_price_fields: ["price"],
      browser_session_approved: false,
    },
  ],
  credential_handles: Array.from({ length: 11 }, (_, ordinal) => ({
    binding_name: `PROVIDER_API_TOKEN_${String(ordinal).padStart(2, "0")}`,
    purpose: `synthetic-provider-api-credential-${String(ordinal)}`,
  })),
  roster_path: "fixtures/providers/connected.json",
  roster_version: "roster-connected@1",
  roster_hash: placeholder(900_010),
  parser_version: "parser-connected@1",
  extraction_policy_version: null,
  budgets: {
    requests_per_run: 100,
    pages_per_source: 10,
    bytes_per_run: 10_000_000,
    duration_ms: 20_000,
    retry_attempts: 2,
    browser_sessions: 0,
    ai_tokens: 0,
    items_per_run: 10_000,
  },
  compliance_review: {
    register_path: "docs/compliance/sources/connected.md",
    register_hash: placeholder(900_001),
    reviewer_role: "source-governance-reviewer",
    reviewed_at: "2026-08-01T00:00:00.000Z",
    terms_version: "terms-connected@1",
    robots_version: "robots-connected@1",
    content_signals_version: "content-signals-connected@1",
    access_permitted: true,
    retention_permitted: true,
    publication_permitted: true,
    next_review_at: "2027-08-01T00:00:00.000Z",
  },
} as const;

const expectedFields = PROVENANCE_V2_FIELD_CORPUS.fields.map((field) => {
  const excluded = field.record_group === "precision_component_tuple@1";
  return {
    ordinal: field.ordinal,
    raw_provider_field: `raw_field_${String(field.ordinal)}`,
    canonical_field_path: field.field_path,
    record_group: field.record_group,
    disposition: excluded ? ("excluded" as const) : ("admitted" as const),
    exclusion_reason: excluded ? ("not_launch_corpus" as const) : null,
  };
});

const rawMappings = PROVENANCE_V2_FIELD_CORPUS.fields.map((field) => ({
  authority_plan_id: PLAN,
  endpoint_id: ENDPOINT,
  ordinal: field.ordinal,
  declaration_kind:
    field.record_group === "offering_applicability@1"
      ? ("applicability" as const)
      : field.field_group === "price"
        ? ("price" as const)
        : ("precision" as const),
  record_group: field.record_group,
  record_selector: "/items/~*",
  raw_locator_kind: "json_pointer_pattern@1" as const,
  raw_locator: `/raw_field_${String(field.ordinal)}`,
  raw_label: `raw_field_${String(field.ordinal)}`,
  canonical_field_path: field.field_path,
  value_source:
    field.source_mappability === "field_identity_literal"
      ? ("field_identity_literal" as const)
      : field.source_mappability === "registered_literal"
        ? ("registered_literal" as const)
        : field.source_mappability === "observation_timestamp"
          ? ("observation_timestamp" as const)
          : ("observed_value" as const),
  registered_value:
    field.source_mappability === "registered_literal"
      ? `registered-${String(field.ordinal)}`
      : null,
  mapping_content_hash: placeholder(10_000 + field.ordinal),
}));

const fieldPolicies = PROVENANCE_V2_FIELD_CORPUS.record_groups.map((group) => {
  const primaryClass = `structured-${String(group.ordinal)}`;
  const twoClasses = group.ordinal === 0;
  const excluded = group.ordinal === 3;
  return {
    ordinal: group.ordinal,
    record_group: group.record_group,
    policy_version: "policy-connected@1",
    field_paths: [...group.field_paths],
    effective_from_ms: START_MS,
    effective_to_ms: END_MS,
    order_kind: "total" as const,
    verifier_policy_key: "verifier-connected",
    confidence_semantics: "not_applicable" as const,
    minimum_confidence_ppm: 0,
    equality_rule: group.equality_rule,
    conflict_rule: "unknown" as const,
    quarantine_rule: "affected_field" as const,
    precedence_classes: [
      {
        ordinal: 0,
        class_key: primaryClass,
        source_classes: [
          "provider_exact_api" as const,
          "provider_exact_authenticated_catalog" as const,
        ],
        class_hash: placeholder(20_000 + group.ordinal * 10),
      },
      ...(twoClasses
        ? [
            {
              ordinal: 1,
              class_key: "public-documentation",
              source_classes: ["provider_controlled_public" as const],
              class_hash: placeholder(20_001),
            },
          ]
        : []),
    ],
    precedence_edges: twoClasses
      ? [
          {
            ordinal: 0,
            higher_class_key: primaryClass,
            lower_class_key: "public-documentation",
            edge_hash: placeholder(21_000),
          },
        ]
      : [],
    endpoint_dispositions: [
      {
        ordinal: 0,
        endpoint_id: ENDPOINT,
        disposition: excluded ? ("excluded" as const) : ("admitted" as const),
        class_key: excluded ? null : primaryClass,
        authority_source_class: excluded
          ? null
          : ("provider_exact_api" as const),
        admission_role: excluded ? null : ("primary" as const),
        exclusion_reason: excluded ? ("not_launch_corpus" as const) : null,
        member_hash: placeholder(22_000 + group.ordinal),
      },
    ],
    canonical_policy_preimage: `policy-preimage-${String(group.ordinal)}`,
    canonical_bytes_hash: placeholder(23_000 + group.ordinal),
    content_hash: placeholder(24_000 + group.ordinal),
  };
});

const buildPlan = (
  canonicalDocumentBytes: number,
  documentChunks: number,
): ProvenanceV2RegistrationPlan =>
  ({
    contract_version: "provenance-v2-registration-plan@1",
    canonical_json_version: "quantclarity-canonical-json@1",
    root_contract_version: "provenance-v2-authority-root@1",
    semantic_policy_version: "provenance-v2-registration-semantics@1",
    semantic_policy_hash: placeholder(30_000),
    field_corpus_version: "provenance-v2-field-path@1",
    root_registry_version: "provenance-v2-root-registry@1",
    installation_id: INSTALLATION,
    environment: "production",
    authority_plan_id: PLAN,
    run_plan_id: RUN,
    run_plan_hash: placeholder(30_001),
    effective_from_ms: START_MS,
    effective_to_ms: END_MS,
    created_at_ms: START_MS,
    declared_limits: {
      contract_version: "provenance-v2-registration-limits@1",
      acceptance_status: "benchmark_pending",
      evidence_artifact_hash: null,
      provider_count: 1,
      endpoint_count: 1,
      normalized_row_count: 5_000,
      canonical_document_bytes: 1_048_576,
      root_input_bytes: 1_048_576,
      parameter_enum_rows: 128,
      precedence_edges: 64,
      verifier_members: 64,
      raw_field_mappings: 128,
      document_chunks: 256,
      document_chunk_bytes: CHUNK_BYTES,
      oracle_result_pages: 64,
      oracle_d1_calls: 64,
      oracle_cpu_milliseconds: 10_000,
    },
    declared_counts: {
      adapter_receipts: 1,
      endpoints: 1,
      verifier_implementations: 1,
      verifier_policies: 1,
      field_policies: 4,
      normalized_rows: 371,
      canonical_document_bytes: canonicalDocumentBytes,
      root_input_bytes: 1,
      document_chunks: documentChunks,
      parameter_enum_rows: 1,
      precedence_edges: 1,
      verifier_members: 1,
      raw_field_mappings: 32,
    },
    adapter_receipts: [
      {
        contract_version: "provenance-v2-adapter-receipt@1",
        authority_plan_id: PLAN,
        run_plan_id: RUN,
        installation_id: INSTALLATION,
        provider_ordinal: 0,
        provider_id: PROVIDER,
        provider_organization_id: ORGANIZATION,
        legacy_manifest: legacyManifest,
        successor_manifest:
          PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.successor_manifest,
        source_owner_receipts: [
          {
            ordinal: 0,
            owner_organization_id: ORGANIZATION,
            owner_kind: "provider_operator",
            provider_owner_relationship: "provider_controlled",
            identity_contract_version: "provenance-v2-source-owner@1",
            identity_preimage: "synthetic-provider-owner-identity",
            identity_content_hash: placeholder(31_000),
            relationship_approval_artifact_path:
              "docs/compliance/source-relationships/connected.json",
            relationship_approval_hash: placeholder(31_001),
            created_at_ms: START_MS,
          },
        ],
        source_register_receipt: {
          register_version: "register-connected@1",
          artifact_path: "docs/compliance/sources/connected.md",
          artifact_hash: placeholder(900_001),
          approval_state: "approved",
          reviewed_at_ms: START_MS,
          next_review_at_ms: END_MS,
          access_permitted: true,
          retention_permitted: true,
          excerpt_permitted: true,
          publication_permitted: true,
          members: [
            { ordinal: 0, source_id: SOURCE, member_hash: placeholder(31_002) },
          ],
          member_set_root:
            PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS
              .successor_manifest.source_register_member_set_root,
          receipt_content_hash:
            PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS
              .successor_manifest.source_register_receipt_hash,
        },
        normalized_environments: ["production"],
        normalized_credentials: Array.from({ length: 11 }, (_, ordinal) => ({
          ordinal,
          binding_name: `PROVIDER_API_TOKEN_${String(ordinal).padStart(2, "0")}`,
          purpose: `synthetic-provider-api-credential-${String(ordinal)}`,
          purpose_hash: placeholder(32_000 + ordinal),
          member_hash: placeholder(33_000 + ordinal),
        })),
        normalized_sources: [
          {
            ordinal: 0,
            source_id: SOURCE,
            adapter_source_type: "provider_api",
            owner_organization_id: ORGANIZATION,
            owner_kind: "provider_operator",
            provider_owner_relationship: "provider_controlled",
            authority_source_class: "provider_exact_api",
            host_ascii: "api.example.invalid",
            path_template: "/v1/models",
            path_template_hash: placeholder(34_000),
            manifest_source_hash: placeholder(34_001),
          },
        ],
        admitted_run_plan_ceilings:
          PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.successor_manifest
            .admitted_run_plan_ceilings,
        source_policy_version: "source-policy-connected@1",
        parser_version: "parser-connected@1",
        extraction_policy_version: null,
        adapter_manifest_hash: placeholder(35_000),
        successor_manifest_hash:
          PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.canonical_preimage
            .sha256,
        manifest_content_hash: placeholder(35_001),
        created_at_ms: START_MS,
      },
    ],
    endpoints: [
      {
        ordinal: 0,
        endpoint_id: ENDPOINT,
        provider_id: PROVIDER,
        source_id: SOURCE,
        authority_source_class: "provider_exact_api",
        source_owner_organization_id: ORGANIZATION,
        provider_owner_relationship: "provider_controlled",
        source_register_version: "register-connected@1",
        source_register_artifact_hash: placeholder(900_001),
        adapter_manifest_hash: placeholder(35_000),
        manifest_source_hash: placeholder(34_001),
        host_ascii: "api.example.invalid",
        path_template: "/v1/models",
        safe_locator_template: "/v1/safe-models",
        scheme: "https",
        method: "GET",
        pagination: "single_page",
        authentication_class: "bearer",
        credential_binding_name: "PROVIDER_API_TOKEN_00",
        credential_injection: "authorization_bearer",
        credential_header: "Authorization",
        compressed_byte_limit: 1_048_576,
        uncompressed_byte_limit: 2_097_152,
        timeout_ms: 10_000,
        redirect_limit: 1,
        provider_rate_limit: "one_request_per_second",
        crawl_purpose: "public_provider_catalog",
        robots_policy: "respect_disallow",
        content_signals_policy: "respect_machine_readable_signals",
        browser_session_approved: false,
        retention_permitted: true,
        publication_permitted: true,
        parameters: [
          {
            ordinal: 0,
            parameter_name: "model",
            location: "query",
            value_type: "string",
            required: true,
            pattern: null,
            pattern_hash: null,
            maximum_length: 128,
            enum_values: ["fixture-model"],
            parameter_hash: placeholder(36_000),
          },
        ],
        allowed_headers: ["Authorization"],
        redirect_hosts: ["api.example.invalid"],
        content_types: ["application/json"],
        expected_fields: expectedFields,
        raw_field_mappings: rawMappings,
        approval: {
          effective_from_ms: START_MS,
          effective_to_ms: END_MS,
          approval_artifact_path: "docs/compliance/endpoints/connected.json",
          approval_artifact_hash: placeholder(36_001),
          approved_at_ms: START_MS,
        },
        endpoint_content_hash: placeholder(36_002),
        registration_hash: placeholder(36_003),
        request_content_hash: placeholder(36_004),
      },
    ],
    verifier_implementations: [
      {
        ordinal: 0,
        implementation_key: "implementation-connected",
        implementation_kind: "deterministic_parser",
        family_key: "deterministic-parser",
        implementation_version: "implementation-connected@1",
        implementation_artifact_path:
          "packages/pipeline/src/provenance-v2-verifier.ts",
        implementation_artifact_hash: placeholder(37_000),
        prompt_artifact_path: null,
        prompt_hash: null,
        deterministic_procedure_artifact_path:
          "docs/compliance/provenance-v2/deterministic-procedure.json",
        deterministic_procedure_hash: placeholder(37_001),
        content_hash: placeholder(37_002),
      },
    ],
    verifier_policies: [
      {
        ordinal: 0,
        verifier_policy_key: "verifier-connected",
        policy_version: "verifier-policy-connected@1",
        effective_from_ms: START_MS,
        effective_to_ms: END_MS,
        profile_kind: "deterministic_structured",
        minimum_member_count: 1,
        minimum_distinct_family_count: 1,
        span_entailment_required: false,
        independent_corroboration_required: false,
        confidence_semantics: "not_applicable",
        minimum_confidence_ppm: 0,
        disagreement_action: "quarantine",
        members: [
          {
            ordinal: 0,
            implementation_key: "implementation-connected",
            member_role: "primary",
            member_hash: placeholder(38_000),
          },
        ],
        content_hash: placeholder(38_001),
      },
    ],
    field_policies: fieldPolicies,
    roots: {
      adapter_manifest_set_root: placeholder(39_000),
      endpoint_set_root: placeholder(39_001),
      verifier_policy_set_root: placeholder(39_002),
      field_policy_set_root: placeholder(39_003),
    },
  }) as unknown as ProvenanceV2RegistrationPlan;

const fixedPoint = (): {
  readonly document: ProvenanceV2RegistrationPlan;
  readonly canonicalJson: string;
  readonly bytes: Uint8Array;
} => {
  let byteLength = 1;
  let chunkCount = 1;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const document = buildPlan(byteLength, chunkCount);
    const canonicalJson = canonical(document);
    const bytes = utf8(canonicalJson);
    const nextChunkCount = Math.ceil(bytes.length / CHUNK_BYTES);
    if (bytes.length === byteLength && nextChunkCount === chunkCount)
      return {
        document: JSON.parse(canonicalJson) as ProvenanceV2RegistrationPlan,
        canonicalJson,
        bytes,
      };
    byteLength = bytes.length;
    chunkCount = nextChunkCount;
  }
  throw new Error(
    "canonical registration document fixed point did not converge",
  );
};

const fixed = fixedPoint();
const schemaValid = (() => {
  const previous = FormatRegistry.Get("date-time");
  FormatRegistry.Set("date-time", (candidate) => {
    const parsed = Date.parse(candidate);
    return (
      Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate
    );
  });
  try {
    return Value.Check(ProvenanceV2RegistrationPlanSchema, fixed.document);
  } finally {
    if (previous === undefined) FormatRegistry.Delete("date-time");
    else FormatRegistry.Set("date-time", previous);
  }
})();
if (!schemaValid)
  throw new Error("connected registration document does not match its schema");

const checkConnectedDocumentSchema = (
  schema: Parameters<typeof Value.Check>[0],
  value: unknown,
): boolean => {
  const previous = FormatRegistry.Get("date-time");
  FormatRegistry.Set("date-time", (candidate) => {
    const parsed = Date.parse(candidate);
    return (
      Number.isFinite(parsed) && new Date(parsed).toISOString() === candidate
    );
  });
  try {
    return Value.Check(schema, value);
  } finally {
    if (previous === undefined) FormatRegistry.Delete("date-time");
    else FormatRegistry.Set("date-time", previous);
  }
};

const chunks = Object.freeze(
  Array.from(
    { length: Math.ceil(fixed.bytes.length / CHUNK_BYTES) },
    (_, ordinal) => {
      const byteOffset = ordinal * CHUNK_BYTES;
      const bytes = fixed.bytes.slice(byteOffset, byteOffset + CHUNK_BYTES);
      const chunkHash = CHUNK_HASHES[ordinal];
      if (chunkHash === undefined) throw new Error("chunk hash is absent");
      return Object.freeze({
        ordinal,
        byte_offset: byteOffset,
        byte_length: bytes.length,
        bytes_hex: Array.from(bytes, (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
        sha256: chunkHash,
      });
    },
  ),
);

const occurrence = (
  row_id: string,
  table: string,
  field: string,
  encoding: "nfc_utf8" | "rfc8785_jcs",
  preimage_kind: "bytes" | "absent",
  preimage_byte_length: number,
  computed_digest: string | null,
) =>
  Object.freeze({
    row_id,
    table,
    field,
    encoding,
    preimage_kind,
    preimage_byte_length,
    computed_digest,
  });

const occurrences = Object.freeze([
  occurrence(
    "row-source_owner_receipt-owner",
    "provenance_v2_source_owner_receipt",
    "identity_content_hash",
    "nfc_utf8",
    "bytes",
    33,
    "sha256:a58c8c2d07e7ab429b03859e59d86d2d6e050d1f892f153ef710524170d92ec0",
  ),
  occurrence(
    "row-adapter_manifest_receipt-receipt",
    "provenance_v2_adapter_manifest_receipt",
    "adapter_manifest_hash",
    "rfc8785_jcs",
    "bytes",
    3323,
    "sha256:cc57d08c4c4275eda385c9a1c25c151d18a424f1b7228c7ceda8799edc0ae5d7",
  ),
  occurrence(
    "row-adapter_manifest_receipt-receipt",
    "provenance_v2_adapter_manifest_receipt",
    "successor_manifest_hash",
    "rfc8785_jcs",
    "bytes",
    2008,
    "sha256:036882a68140745f9d1ba07983b6d810c951515e21aa5a96dd504a605040814b",
  ),
  ...Array.from({ length: 11 }, (_, ordinal) =>
    occurrence(
      `row-adapter_manifest_credential-credential-${String(ordinal)}`,
      "provenance_v2_adapter_manifest_credential",
      "purpose_hash",
      "nfc_utf8",
      "bytes",
      ordinal === 10 ? 36 : 35,
      [
        "sha256:fcd159ab5751babfba336af4a97c348ce0fb2582121baf2e753b7f7d9eb2c904",
        "sha256:73b0c1fd6cf90a656b548996b4cf4bcde311032f5094409e0871acb8240464f8",
        "sha256:a697c336f1895fa7257ca38edd6f0ceb44eb1c9b458dd27417551f38dd688239",
        "sha256:98ad38cf21402ddcd0f3e411a517521de246720e09588ee564e9575378f1f7f0",
        "sha256:e5a071558dc72acf5c154855847c3ada9ed8cc8292e224adef3c5f76879c326a",
        "sha256:71c5a33b67649a21c0c21a39db6cb5245ed3e40bb734fdabef0d799455e22ea9",
        "sha256:6f3569c9e863f73420f05fc0b3345c5256b3f7ac706d1eda79dc67b18298e158",
        "sha256:347cf6aadd66c9304850e442c784aa62c06f8aea56d60d5f0cc8c36b8d1e2ee0",
        "sha256:75c796ee60e6b243664fd6399fc695ad6056ae86ed25f8d8811375c87237d0ff",
        "sha256:62debbb877511981a5ebc792a5941321e60c1b11fb593421c949c798d7ec2648",
        "sha256:360d2af7b2a9c6fae19b1f1321b024aa9fb7ef39c016159b7f04b3fc7a1e5756",
      ][ordinal] ?? "invalid",
    ),
  ),
  occurrence(
    "row-adapter_manifest_source-source",
    "provenance_v2_adapter_manifest_source",
    "path_template_hash",
    "nfc_utf8",
    "bytes",
    10,
    "sha256:d7b0903584595062c9a8a7bf8cc51283d06c5b6d794a8254e198669236e7bc9d",
  ),
  occurrence(
    "row-source_endpoint-endpoint",
    "provenance_v2_source_endpoint",
    "path_template_hash",
    "nfc_utf8",
    "bytes",
    10,
    "sha256:d7b0903584595062c9a8a7bf8cc51283d06c5b6d794a8254e198669236e7bc9d",
  ),
  occurrence(
    "row-source_endpoint-endpoint",
    "provenance_v2_source_endpoint",
    "adapter_manifest_hash",
    "rfc8785_jcs",
    "bytes",
    3323,
    "sha256:cc57d08c4c4275eda385c9a1c25c151d18a424f1b7228c7ceda8799edc0ae5d7",
  ),
  occurrence(
    "row-source_endpoint_registration-registration",
    "provenance_v2_source_endpoint_registration",
    "path_template_hash",
    "nfc_utf8",
    "bytes",
    10,
    "sha256:d7b0903584595062c9a8a7bf8cc51283d06c5b6d794a8254e198669236e7bc9d",
  ),
  occurrence(
    "row-source_endpoint_registration-registration",
    "provenance_v2_source_endpoint_registration",
    "adapter_manifest_hash",
    "rfc8785_jcs",
    "bytes",
    3323,
    "sha256:cc57d08c4c4275eda385c9a1c25c151d18a424f1b7228c7ceda8799edc0ae5d7",
  ),
  occurrence(
    "row-source_endpoint_request-request",
    "provenance_v2_source_endpoint_request",
    "safe_locator_template_hash",
    "nfc_utf8",
    "bytes",
    15,
    "sha256:1297cad086ee993ab2ba0277a48b39714d77b4af583440224339506622013bbb",
  ),
  occurrence(
    "row-source_endpoint_request-request",
    "provenance_v2_source_endpoint_request",
    "pagination_hash",
    "rfc8785_jcs",
    "bytes",
    13,
    "sha256:189719d30aeddc3a26f4c42768ece3869e8fc38cb6d0ecfab29a6da7d5c3e0bf",
  ),
  occurrence(
    "row-source_endpoint_request-request",
    "provenance_v2_source_endpoint_request",
    "provider_rate_limit_hash",
    "rfc8785_jcs",
    "bytes",
    24,
    "sha256:e65e58001dfb80a38545609b74f261e12bc03cb6847527094b3a620ae671ed15",
  ),
  occurrence(
    "row-source_endpoint_request-request",
    "provenance_v2_source_endpoint_request",
    "crawl_purpose_hash",
    "nfc_utf8",
    "bytes",
    23,
    "sha256:3ab1004caed4c812efa2a86e943c2eafa27b797622a216377652acd3b86dc4e3",
  ),
  occurrence(
    "row-source_endpoint_request-request",
    "provenance_v2_source_endpoint_request",
    "robots_policy_hash",
    "rfc8785_jcs",
    "bytes",
    18,
    "sha256:da2de69549ad761295b88b69e6ea23bd487000709baaa47620096577f3dcc977",
  ),
  occurrence(
    "row-source_endpoint_request-request",
    "provenance_v2_source_endpoint_request",
    "content_signals_policy_hash",
    "rfc8785_jcs",
    "bytes",
    34,
    "sha256:5daf97aa50b388c9cf60a59f6506c225fa318d0be033a297a812b9889e1a6217",
  ),
  occurrence(
    "row-source_endpoint_parameter-parameter",
    "provenance_v2_source_endpoint_parameter",
    "pattern_hash",
    "nfc_utf8",
    "absent",
    0,
    null,
  ),
  occurrence(
    "row-source_endpoint_parameter_enum-enum",
    "provenance_v2_source_endpoint_parameter_enum",
    "value_hash",
    "nfc_utf8",
    "bytes",
    13,
    "sha256:e6954ed9cce48114b2875996c433c4ada96795c4f7b5401b3ed7578086bbe242",
  ),
  ...[
    "sha256:b6c454364aa0f6e726eb255f0939251d04bac6bfb8a60e645e24c77a7dcf7e82",
    "sha256:9e9dba2333ebb02418136af520acca71de22219e54740b821550f28ffa4b4a9e",
    "sha256:cb36d91bcbcd74b985b8202f37182c760eca967d2a238610d4f26643767ab989",
    "sha256:f252584e666df12ef4029f22cdff132d8ae4fff1b99c49d6c72ac297ef9ffba5",
  ].map((digest, ordinal) =>
    occurrence(
      `row-field_policy-policy-${String(ordinal)}`,
      "provenance_v2_field_policy",
      "canonical_bytes_hash",
      "rfc8785_jcs",
      "bytes",
      19,
      digest,
    ),
  ),
]);

type FixtureJson =
  null | boolean | number | string | FixtureJson[] | FixtureJsonObject;

interface FixtureJsonObject {
  [key: string]: FixtureJson;
}

const isFixtureObject = (value: FixtureJson): value is FixtureJsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const fixtureRowProjection = (
  row: (typeof PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows)[number],
): Readonly<Record<string, FixtureJson>> =>
  Object.fromEntries(
    row.fields.map((field) => [
      field.name,
      field.tag === "integer" ? Number(field.value) : field.value,
    ]),
  );

const fixtureSelect = (
  document: FixtureJson,
  pointer: string,
  selectors: readonly {
    readonly wildcard_ordinal: number;
    readonly kind: string;
    readonly row_column?: string;
    readonly member_field?: string;
  }[],
  row: Readonly<Record<string, FixtureJson>>,
): FixtureJson => {
  let current = document;
  let wildcardOrdinal = 0;
  for (const token of pointer
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))) {
    if (token !== "*") {
      if (!isFixtureObject(current) || !Object.hasOwn(current, token))
        throw new Error("connected fixture count pointer did not resolve");
      const next = current[token];
      if (next === undefined)
        throw new Error("connected fixture count pointer did not resolve");
      current = next;
      continue;
    }
    const selector = selectors.find(
      (candidate) => candidate.wildcard_ordinal === wildcardOrdinal,
    );
    wildcardOrdinal += 1;
    if (selector?.row_column === undefined || !Array.isArray(current))
      throw new Error("connected fixture count selector is invalid");
    const expected = row[selector.row_column];
    if (selector.kind === "array_index_by_ordinal") {
      if (
        typeof expected !== "number" ||
        !Number.isSafeInteger(expected) ||
        Object.is(expected, -0) ||
        expected < 0 ||
        expected >= current.length
      )
        throw new Error("connected fixture count ordinal is invalid");
      const next = current[expected];
      if (next === undefined)
        throw new Error("connected fixture count ordinal is absent");
      current = next;
      continue;
    }
    if (selector.member_field === undefined)
      throw new Error("connected fixture count member field is absent");
    const memberField = selector.member_field;
    const matches = current.filter(
      (member) =>
        isFixtureObject(member) &&
        Object.hasOwn(member, memberField) &&
        member[memberField] === expected,
    );
    if (matches.length !== 1)
      throw new Error("connected fixture count selector is not singular");
    const match = matches[0];
    if (match === undefined)
      throw new Error("connected fixture count selector is absent");
    current = match;
  }
  if (wildcardOrdinal !== selectors.length)
    throw new Error("connected fixture count selector was not consumed");
  return current;
};

const documentCountBindings =
  PROVENANCE_V2_ROOT_BINDING_PLAN.count_bindings.filter((entry) =>
    String((entry.binding as { readonly kind?: unknown }).kind).startsWith(
      "document_",
    ),
  );

const presentCountManifest = documentCountBindings.flatMap((entry) =>
  Array.from(
    new Map(
      PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows
        .filter((row) => row.table === entry.table)
        .map((row) => {
          const binding = entry.binding as {
            readonly selectors?: readonly {
              readonly row_column?: string;
            }[];
          };
          const projection = fixtureRowProjection(row);
          const parentScope = (binding.selectors ?? []).map(
            (selector) => projection[selector.row_column ?? ""],
          );
          return [JSON.stringify(parentScope), row] as const;
        }),
    ).values(),
  ).map((row) => {
    const binding = entry.binding as
      | {
          readonly kind: "document_array_length";
          readonly pointer_pattern: string;
          readonly selectors: readonly {
            readonly wildcard_ordinal: number;
            readonly kind: string;
            readonly row_column?: string;
            readonly member_field?: string;
          }[];
        }
      | {
          readonly kind: "document_declared_integer";
          readonly pointer_pattern: string;
        }
      | {
          readonly kind: "document_filtered_array_length";
          readonly pointer_pattern: string;
          readonly selectors: readonly {
            readonly wildcard_ordinal: number;
            readonly kind: string;
            readonly row_column?: string;
            readonly member_field?: string;
          }[];
          readonly predicate: {
            readonly member_field: string;
            readonly equals: string;
          };
        };
    const selected = fixtureSelect(
      fixed.document,
      binding.pointer_pattern,
      "selectors" in binding ? binding.selectors : [],
      fixtureRowProjection(row),
    );
    const count =
      binding.kind === "document_declared_integer"
        ? selected
        : binding.kind === "document_filtered_array_length"
          ? Array.isArray(selected)
            ? selected.filter(
                (member) =>
                  isFixtureObject(member) &&
                  member[binding.predicate.member_field] ===
                    binding.predicate.equals,
              ).length
            : null
          : Array.isArray(selected)
            ? selected.length
            : null;
    if (
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      Object.is(count, -0) ||
      count < 0
    )
      throw new Error("connected fixture document count is invalid");
    return Object.freeze({
      row_id: row.row_id,
      table: entry.table,
      binding_kind: binding.kind,
      count,
    });
  }),
);

const missingZeroPolicyContexts = Object.freeze(
  fixed.document.field_policies.flatMap((policy) => [
    ...(policy.precedence_edges.length === 0
      ? [
          Object.freeze({
            row_id: `scope-field-policy-edge-${policy.record_group}`,
            table: "provenance_v2_field_policy_precedence_edge",
            binding_kind: "document_array_length" as const,
            count: 0,
          }),
        ]
      : []),
    ...(!policy.endpoint_dispositions.some(
      (disposition) => disposition.disposition === "admitted",
    )
      ? [
          Object.freeze({
            row_id: `scope-field-policy-admission-${policy.record_group}`,
            table: "provenance_v2_field_policy_endpoint_admission",
            binding_kind: "document_filtered_array_length" as const,
            count: 0,
          }),
        ]
      : []),
    ...(!policy.endpoint_dispositions.some(
      (disposition) => disposition.disposition === "excluded",
    )
      ? [
          Object.freeze({
            row_id: `scope-field-policy-exclusion-${policy.record_group}`,
            table: "provenance_v2_field_policy_endpoint_exclusion",
            binding_kind: "document_filtered_array_length" as const,
            count: 0,
          }),
        ]
      : []),
  ]),
);

const countManifest = Object.freeze([
  ...presentCountManifest,
  ...missingZeroPolicyContexts,
]);

if (documentCountBindings.length !== 27 || countManifest.length !== 46)
  throw new Error(
    `connected fixture document count inventory drifted: ${String(documentCountBindings.length)}/${String(countManifest.length)}`,
  );

export const ProvenanceV2ConnectedRegistrationDocumentVectorsSchema =
  Type.Object(
    {
      contract_version: Type.Literal(
        "provenance-v2-connected-registration-document-vectors@1",
      ),
      status: Type.Literal("review_candidate"),
      coverage: Type.Literal(
        "schema_valid_canonical_document_and_retained_byte_fixture",
      ),
      authority_eligible: Type.Literal(false),
      outcome: Type.Literal("authority_refused"),
      persisted: Type.Literal(false),
      document_resolver_executed: Type.Literal(true),
      retained_resolver_executed: Type.Literal(false),
      retained_chunk_fixture_verified: Type.Literal(true),
      semantic_oracle_executed: Type.Literal(false),
      safe_preimage_occurrence_resolution_complete: Type.Literal(true),
      document_count_resolution_inventory_complete: Type.Literal(true),
      source_contracts: Type.Object(
        {
          registration_plan: Type.Literal("provenance-v2-registration-plan@1"),
          canonical_json: Type.Literal("quantclarity-canonical-json@1"),
          connected_graph: Type.Literal(
            "provenance-v2-connected-registration-graph@1",
          ),
          root_binding_plan: Type.Literal("provenance-v2-root-binding-plan@1"),
          document_resolver: Type.Literal(
            "provenance-v2-registration-document-resolver@1",
          ),
          successor_vectors: Type.Literal(
            "provenance-v2-connected-successor-manifest-vectors@1",
          ),
        },
        { additionalProperties: false },
      ),
      evidence_counts: Type.Object(
        {
          document_value_binding_definitions: Type.Literal(18),
          document_value_occurrences: Type.Literal(31),
          digest_occurrences: Type.Literal(30),
          absent_occurrences: Type.Literal(1),
          distinct_digest_values: Type.Literal(26),
          document_count_binding_definitions: Type.Literal(27),
          document_count_occurrences: Type.Literal(46),
          document_count_resolver_executions: Type.Literal(39),
          document_count_zero_scope_witnesses: Type.Literal(7),
        },
        { additionalProperties: false },
      ),
      document: ProvenanceV2RegistrationPlanSchema,
      canonical_document: Type.Object(
        {
          utf8_byte_length: Type.Integer({ minimum: 1, maximum: 1_048_576 }),
          canonical_json: Type.String({ minLength: 1, maxLength: 1_048_576 }),
          canonical_utf8_hex: Type.String({
            pattern: "^(?:[0-9a-f]{2})+$",
            maxLength: 2_097_152,
          }),
          sha256: Type.String({ pattern: SHA256 }),
        },
        { additionalProperties: false },
      ),
      chunk_policy: Type.Object(
        {
          maximum_chunk_bytes: Type.Literal(CHUNK_BYTES),
          chunk_count: Type.Integer({ minimum: 1, maximum: 64 }),
          dense_ordinals_from_zero: Type.Literal(true),
          contiguous_offsets: Type.Literal(true),
        },
        { additionalProperties: false },
      ),
      chunks: Type.Array(
        Type.Object(
          {
            ordinal: Type.Integer({ minimum: 0, maximum: 63 }),
            byte_offset: Type.Integer({ minimum: 0, maximum: 1_048_575 }),
            byte_length: Type.Integer({ minimum: 1, maximum: CHUNK_BYTES }),
            bytes_hex: Type.String({
              pattern: "^(?:[0-9a-f]{2})+$",
              maxLength: CHUNK_BYTES * 2,
            }),
            sha256: Type.String({ pattern: SHA256 }),
          },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: 64 },
      ),
      occurrences: Type.Array(
        Type.Union([
          Type.Object(
            {
              row_id: Type.String({ minLength: 1, maxLength: 160 }),
              table: Type.String({
                pattern: "^provenance_v2_[a-z0-9_]+$",
                maxLength: 96,
              }),
              field: Type.String({ minLength: 1, maxLength: 64 }),
              encoding: Type.Union([
                Type.Literal("nfc_utf8"),
                Type.Literal("rfc8785_jcs"),
              ]),
              preimage_kind: Type.Literal("bytes"),
              preimage_byte_length: Type.Integer({
                minimum: 1,
                maximum: 1_048_576,
              }),
              computed_digest: Type.String({ pattern: SHA256 }),
            },
            { additionalProperties: false },
          ),
          Type.Object(
            {
              row_id: Type.String({ minLength: 1, maxLength: 160 }),
              table: Type.String({
                pattern: "^provenance_v2_[a-z0-9_]+$",
                maxLength: 96,
              }),
              field: Type.String({ minLength: 1, maxLength: 64 }),
              encoding: Type.Union([
                Type.Literal("nfc_utf8"),
                Type.Literal("rfc8785_jcs"),
              ]),
              preimage_kind: Type.Literal("absent"),
              preimage_byte_length: Type.Literal(0),
              computed_digest: Type.Null(),
            },
            { additionalProperties: false },
          ),
        ]),
        { minItems: 31, maxItems: 31 },
      ),
      count_manifest: Type.Array(
        Type.Object(
          {
            row_id: Type.String({ minLength: 1, maxLength: 160 }),
            table: Type.String({
              pattern: "^provenance_v2_[a-z0-9_]+$",
              maxLength: 96,
            }),
            binding_kind: Type.Union([
              Type.Literal("document_array_length"),
              Type.Literal("document_declared_integer"),
              Type.Literal("document_filtered_array_length"),
            ]),
            count: Type.Integer({ minimum: 0, maximum: 10_000 }),
          },
          { additionalProperties: false },
        ),
        { minItems: 46, maxItems: 46 },
      ),
      pending: Type.Object(
        {
          digest_and_root_cascade_regeneration: Type.Literal("pending"),
          normalized_row_inventory_parity: Type.Literal("pending"),
          root_input_byte_accounting: Type.Literal("pending"),
          external_and_repository_anchor_resolvers: Type.Literal("pending"),
          repository_build_manifest: Type.Literal("pending"),
          semantic_oracle: Type.Literal("pending"),
          migration_schema_parity: Type.Literal("pending"),
          frozen_d1_enumeration: Type.Literal("pending"),
          accepted_aggregate_limits: Type.Literal("pending"),
        },
        { additionalProperties: false },
      ),
    },
    {
      $id: "ProvenanceV2ConnectedRegistrationDocumentVectors",
      additionalProperties: false,
      ...REVIEW_CANDIDATE_SCHEMA,
    },
  );

export const PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS =
  Object.freeze({
    contract_version: "provenance-v2-connected-registration-document-vectors@1",
    status: "review_candidate",
    coverage: "schema_valid_canonical_document_and_retained_byte_fixture",
    authority_eligible: false,
    outcome: "authority_refused",
    persisted: false,
    document_resolver_executed: true,
    retained_resolver_executed: false,
    retained_chunk_fixture_verified: true,
    semantic_oracle_executed: false,
    safe_preimage_occurrence_resolution_complete: true,
    document_count_resolution_inventory_complete: true,
    source_contracts: Object.freeze({
      registration_plan: fixed.document.contract_version,
      canonical_json: fixed.document.canonical_json_version,
      connected_graph:
        PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.contract_version,
      root_binding_plan: PROVENANCE_V2_ROOT_BINDING_PLAN.contract_version,
      document_resolver:
        PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT.contract_version,
      successor_vectors:
        PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.contract_version,
    }),
    evidence_counts: Object.freeze({
      document_value_binding_definitions: 18,
      document_value_occurrences: 31,
      digest_occurrences: 30,
      absent_occurrences: 1,
      distinct_digest_values: 26,
      document_count_binding_definitions: 27,
      document_count_occurrences: 46,
      document_count_resolver_executions: 39,
      document_count_zero_scope_witnesses: 7,
    }),
    document: deepFreeze(fixed.document),
    canonical_document: Object.freeze({
      utf8_byte_length: fixed.bytes.length,
      canonical_json: fixed.canonicalJson,
      canonical_utf8_hex: Array.from(fixed.bytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
      sha256: DOCUMENT_HASH,
    }),
    chunk_policy: Object.freeze({
      maximum_chunk_bytes: CHUNK_BYTES,
      chunk_count: chunks.length,
      dense_ordinals_from_zero: true,
      contiguous_offsets: true,
    }),
    chunks,
    occurrences,
    count_manifest: countManifest,
    pending: Object.freeze({
      digest_and_root_cascade_regeneration: "pending",
      normalized_row_inventory_parity: "pending",
      root_input_byte_accounting: "pending",
      external_and_repository_anchor_resolvers: "pending",
      repository_build_manifest: "pending",
      semantic_oracle: "pending",
      migration_schema_parity: "pending",
      frozen_d1_enumeration: "pending",
      accepted_aggregate_limits: "pending",
    }),
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
    budget.stringBytes += utf8LengthWithin(
      value,
      4_000_000 - budget.stringBytes,
    );
    return budget.stringBytes <= 4_000_000 ? value : undefined;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isSafeInteger(value) && !Object.is(value, -0)
      ? value
      : undefined;
  if (typeof value !== "object" || depth > 64 || seen.has(value))
    return undefined;
  let prototype: object | null;
  let keys: readonly (string | symbol)[];
  try {
    prototype = Reflect.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return undefined;
  }
  if (++budget.nodes > 100_000 || keys.length > 1_024) return undefined;
  budget.properties += keys.length;
  if (
    budget.properties > 250_000 ||
    keys.some((key) => typeof key === "symbol")
  )
    return undefined;
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return undefined;
  }
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
    const copy: unknown[] = [];
    for (
      let index = 0;
      index < (lengthDescriptor.value as number);
      index += 1
    ) {
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
    seen.delete(value);
    return copy;
  }
  if (prototype !== Object.prototype) return undefined;
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    if (key.length > 128) return undefined;
    budget.stringBytes += utf8LengthWithin(key, 4_000_000 - budget.stringBytes);
    if (budget.stringBytes > 4_000_000) return undefined;
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const child = snapshotPlainData(descriptor.value, seen, budget, depth + 1);
    if (child === undefined) return undefined;
    copy[key] = child;
  }
  seen.delete(value);
  return copy;
};

export const validateProvenanceV2ConnectedRegistrationDocumentVectors = (
  value: unknown = PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS,
): string[] => {
  const snapshot = snapshotPlainData(value);
  if (
    !checkConnectedDocumentSchema(
      ProvenanceV2ConnectedRegistrationDocumentVectorsSchema,
      snapshot,
    )
  )
    return [
      "connected registration document vectors do not match the closed schema",
    ];
  if (
    JSON.stringify(snapshot) !==
    JSON.stringify(PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS)
  )
    return [
      "connected registration document vectors must equal the reviewed singleton",
    ];
  return [];
};
