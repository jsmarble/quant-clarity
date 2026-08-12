import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { ProvenanceV2SuccessorManifestSchema } from "./provenance-v2-registration.js";

const REVIEW_CANDIDATE_SCHEMA = {
  "x-quantclarity-contract-status": "review_candidate",
} as const;
const digest = () => Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const boundedName = () => Type.String({ minLength: 1, maxLength: 96 });

const ProjectionFieldSchema = Type.Object(
  {
    target: boundedName(),
    table: Type.String({
      pattern: "^provenance_v2_[a-z0-9_]+$",
      maxLength: 96,
    }),
    column: boundedName(),
    conversion: Type.Union([
      Type.Literal("identity"),
      Type.Literal("safe_integer"),
    ]),
    cardinality: Type.Literal("exactly_one"),
  },
  { additionalProperties: false },
);

export const ProvenanceV2ConnectedSuccessorManifestVectorsSchema = Type.Object(
  {
    contract_version: Type.Literal(
      "provenance-v2-connected-successor-manifest-vectors@1",
    ),
    status: Type.Literal("review_candidate"),
    coverage: Type.Literal(
      "synthetic_successor_manifest_preimage_and_adapter_leaf_parity",
    ),
    authority_eligible: Type.Literal(false),
    outcome: Type.Literal("authority_refused"),
    persisted: Type.Literal(false),
    document_resolver_executed: Type.Literal(false),
    semantic_oracle_executed: Type.Literal(false),
    source_graph_contract_version: Type.Literal(
      "provenance-v2-connected-registration-graph@1",
    ),
    source_traversal_contract_version: Type.Literal(
      "provenance-v2-connected-traversal-vectors@1",
    ),
    successor_preimage_contract_version: Type.Literal(
      "provenance-v2-successor-manifest-preimage@1",
    ),
    registry_contract_version: Type.Literal("provenance-v2-root-registry@1"),
    binding_plan_contract_version: Type.Literal(
      "provenance-v2-root-binding-plan@1",
    ),
    selected_scope: Type.Object(
      {
        authority_plan_id: Type.String({ pattern: "^vpa_[0-9a-f-]{36}$" }),
        provider_id: Type.String({ pattern: "^prv_[0-9a-f-]{36}$" }),
      },
      { additionalProperties: false },
    ),
    projection_counts: Type.Object(
      {
        top_level_properties: Type.Literal(30),
        literal_properties: Type.Literal(2),
        normalized_row_properties: Type.Literal(16),
        nested_ceiling_properties: Type.Literal(6),
        successor_claim_properties: Type.Literal(11),
        resolved_safe_preimage_occurrences: Type.Literal(1),
        opaque_safe_preimage_occurrences: Type.Literal(29),
        opaque_external_anchor_occurrences: Type.Literal(10),
      },
      { additionalProperties: false },
    ),
    projection_plan: Type.Object(
      {
        scope_columns: Type.Array(
          Type.Union([
            Type.Literal("authority_plan_id"),
            Type.Literal("provider_id"),
          ]),
          { minItems: 2, maxItems: 2, uniqueItems: true },
        ),
        literals: Type.Array(
          Type.Union([
            Type.Literal("contract_version"),
            Type.Literal("canonical_json_version"),
          ]),
          { minItems: 2, maxItems: 2, uniqueItems: true },
        ),
        normalized_row_fields: Type.Array(ProjectionFieldSchema, {
          minItems: 16,
          maxItems: 16,
        }),
        ceiling_fields: Type.Array(ProjectionFieldSchema, {
          minItems: 6,
          maxItems: 6,
        }),
        successor_claim_fields: Type.Array(boundedName(), {
          minItems: 11,
          maxItems: 11,
          uniqueItems: true,
        }),
      },
      { additionalProperties: false },
    ),
    successor_manifest: ProvenanceV2SuccessorManifestSchema,
    canonical_preimage: Type.Object(
      {
        canonical_json_version: Type.Literal("quantclarity-canonical-json@1"),
        utf8_byte_length: Type.Literal(2008),
        canonical_json: Type.String({ minLength: 2008, maxLength: 2008 }),
        canonical_utf8_hex: Type.String({
          pattern: "^[0-9a-f]+$",
          minLength: 4016,
          maxLength: 4016,
        }),
        sha256: digest(),
      },
      { additionalProperties: false },
    ),
    adapter_receipt_fixture_parity: Type.Object(
      {
        row_id: Type.Literal("row-adapter_manifest_receipt-receipt"),
        target_field: Type.Literal("successor_manifest_hash"),
        stored_digest: digest(),
        computed_digest: digest(),
        fixture_digest_equal: Type.Literal(true),
        leaf_domain: Type.Literal("provenance-v2-adapter-receipt-leaf@1"),
        recomputed_manifest_content_hash: digest(),
      },
      { additionalProperties: false },
    ),
    downstream_cascade: Type.Object(
      {
        leaf_manifest_sha256: digest(),
        adapter_manifest_set_root: digest(),
        endpoint_set_root_unchanged: digest(),
        verifier_policy_set_root_unchanged: digest(),
        field_policy_set_root_unchanged: digest(),
        candidate_authority_root: digest(),
        candidate_refused_receipt_hash: digest(),
      },
      { additionalProperties: false },
    ),
    pending: Type.Object(
      {
        registration_document_selector_and_strict_byte_ingestion:
          Type.Literal("pending"),
        retained_document_and_remaining_safe_preimage_resolvers:
          Type.Literal("pending"),
        external_and_repository_anchor_resolvers: Type.Literal("pending"),
        repository_build_manifest: Type.Literal("pending"),
        semantic_oracle: Type.Literal("pending"),
        migration_schema_parity: Type.Literal("pending"),
        frozen_d1_enumeration_and_row_lookup_closure: Type.Literal("pending"),
        accepted_aggregate_limits: Type.Literal("pending"),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: "ProvenanceV2ConnectedSuccessorManifestVectors",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

export const PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS = Object.freeze(
  {
    contract_version: "provenance-v2-connected-successor-manifest-vectors@1",
    status: "review_candidate",
    coverage: "synthetic_successor_manifest_preimage_and_adapter_leaf_parity",
    authority_eligible: false,
    outcome: "authority_refused",
    persisted: false,
    document_resolver_executed: false,
    semantic_oracle_executed: false,
    source_graph_contract_version:
      "provenance-v2-connected-registration-graph@1",
    source_traversal_contract_version:
      "provenance-v2-connected-traversal-vectors@1",
    successor_preimage_contract_version:
      "provenance-v2-successor-manifest-preimage@1",
    registry_contract_version: "provenance-v2-root-registry@1",
    binding_plan_contract_version: "provenance-v2-root-binding-plan@1",
    selected_scope: Object.freeze({
      authority_plan_id: "vpa_11111111-1111-4111-8111-111111111111",
      provider_id: "prv_44444444-4444-4444-8444-444444444444",
    }),
    projection_counts: Object.freeze({
      top_level_properties: 30,
      literal_properties: 2,
      normalized_row_properties: 16,
      nested_ceiling_properties: 6,
      successor_claim_properties: 11,
      resolved_safe_preimage_occurrences: 1,
      opaque_safe_preimage_occurrences: 29,
      opaque_external_anchor_occurrences: 10,
    }),
    projection_plan: Object.freeze({
      scope_columns: Object.freeze(["authority_plan_id", "provider_id"]),
      literals: Object.freeze(["contract_version", "canonical_json_version"]),
      normalized_row_fields: Object.freeze([
        Object.freeze({
          target: "authority_plan_id",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "authority_plan_id",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "run_plan_id",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "run_plan_id",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "installation_id",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "installation_id",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "provider_ordinal",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "provider_ordinal",
          conversion: "safe_integer",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "provider_id",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "provider_id",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "provider_organization_id",
          table: "provenance_v2_source_owner_receipt",
          column: "provider_organization_id",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "legacy_adapter_contract_version",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "adapter_contract_version",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "legacy_adapter_version",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "adapter_version",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "adapter_manifest_hash",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "adapter_manifest_hash",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "roster_version",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "roster_version",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "roster_content_hash",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "roster_content_hash",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "source_register_version",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "source_register_version",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "source_register_artifact_hash",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "source_artifact_hash",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "source_policy_version",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "source_policy_version",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "parser_version",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "parser_version",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "extraction_policy_version",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "extraction_policy_version",
          conversion: "identity",
          cardinality: "exactly_one",
        }),
      ]),
      ceiling_fields: Object.freeze([
        Object.freeze({
          target: "request_ceiling",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "request_ceiling",
          conversion: "safe_integer",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "byte_ceiling",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "byte_ceiling",
          conversion: "safe_integer",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "ai_token_ceiling",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "ai_token_ceiling",
          conversion: "safe_integer",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "browser_millisecond_ceiling",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "browser_millisecond_ceiling",
          conversion: "safe_integer",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "elapsed_millisecond_ceiling",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "elapsed_millisecond_ceiling",
          conversion: "safe_integer",
          cardinality: "exactly_one",
        }),
        Object.freeze({
          target: "cost_microusd_ceiling",
          table: "provenance_v2_adapter_manifest_receipt",
          column: "cost_microusd_ceiling",
          conversion: "safe_integer",
          cardinality: "exactly_one",
        }),
      ]),
      successor_claim_fields: Object.freeze([
        "source_owner_count",
        "source_owner_set_root",
        "source_register_member_count",
        "source_register_member_set_root",
        "source_register_receipt_hash",
        "environment_count",
        "environment_set_root",
        "credential_count",
        "credential_set_root",
        "source_count",
        "source_set_root",
      ]),
    }),
    successor_manifest: Object.freeze({
      contract_version: "provenance-v2-successor-manifest@1",
      canonical_json_version: "quantclarity-canonical-json@1",
      authority_plan_id: "vpa_11111111-1111-4111-8111-111111111111",
      run_plan_id: "rpl_22222222-2222-4222-8222-222222222222",
      installation_id: "pvi_33333333-3333-4333-8333-333333333333",
      provider_ordinal: 0,
      provider_id: "prv_44444444-4444-4444-8444-444444444444",
      provider_organization_id: "org_66666666-6666-4666-8666-666666666666",
      legacy_adapter_contract_version: "1.0.0",
      legacy_adapter_version:
        "1.0.0+sha256.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      adapter_manifest_hash:
        "sha256:00000000000000000000000000000000000000000000000000000000000dbba2",
      roster_version: "fixture-roster_version",
      roster_content_hash:
        "sha256:00000000000000000000000000000000000000000000000000000000000000cf",
      source_owner_count: 1,
      source_owner_set_root:
        "sha256:bb57b8f091888e72eff82aee5ba264927354b4e3824f389af1840542b0cedb36",
      source_register_version: "register-connected@1",
      source_register_artifact_hash:
        "sha256:00000000000000000000000000000000000000000000000000000000000dbba1",
      source_register_member_count: 1,
      source_register_member_set_root:
        "sha256:42f00a7ebfcb485e23adfd593c30112c4b76563025edfab536dafa6e94757317",
      source_register_receipt_hash:
        "sha256:948dd008e0e8a553eaa26170357fa55ce66e9d7aff302844bc45e2ce89b36eb5",
      environment_count: 1,
      environment_set_root:
        "sha256:75e45a2d14b93f86852b2523f71deda92e34dfc1af56bbfe9d76d31af8518d92",
      credential_count: 11,
      credential_set_root:
        "sha256:ec51feaaba25341507329ca9e16e28634215db0d85672cfdace9cbe0724115bb",
      source_count: 1,
      source_set_root:
        "sha256:48ba83057b0298adda3678c03242d2a342277889d1d78968c3d94b07e9ccec44",
      admitted_run_plan_ceilings: {
        request_ceiling: 1,
        byte_ceiling: 1,
        ai_token_ceiling: 1,
        browser_millisecond_ceiling: 1,
        elapsed_millisecond_ceiling: 20000,
        cost_microusd_ceiling: 1,
      },
      source_policy_version: "fixture-source_policy_version",
      parser_version: "fixture-parser_version",
      extraction_policy_version: null,
    }),
    canonical_preimage: Object.freeze({
      canonical_json_version: "quantclarity-canonical-json@1",
      utf8_byte_length: 2008,
      canonical_json:
        '{"adapter_manifest_hash":"sha256:00000000000000000000000000000000000000000000000000000000000dbba2","admitted_run_plan_ceilings":{"ai_token_ceiling":1,"browser_millisecond_ceiling":1,"byte_ceiling":1,"cost_microusd_ceiling":1,"elapsed_millisecond_ceiling":20000,"request_ceiling":1},"authority_plan_id":"vpa_11111111-1111-4111-8111-111111111111","canonical_json_version":"quantclarity-canonical-json@1","contract_version":"provenance-v2-successor-manifest@1","credential_count":11,"credential_set_root":"sha256:ec51feaaba25341507329ca9e16e28634215db0d85672cfdace9cbe0724115bb","environment_count":1,"environment_set_root":"sha256:75e45a2d14b93f86852b2523f71deda92e34dfc1af56bbfe9d76d31af8518d92","extraction_policy_version":null,"installation_id":"pvi_33333333-3333-4333-8333-333333333333","legacy_adapter_contract_version":"1.0.0","legacy_adapter_version":"1.0.0+sha256.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","parser_version":"fixture-parser_version","provider_id":"prv_44444444-4444-4444-8444-444444444444","provider_ordinal":0,"provider_organization_id":"org_66666666-6666-4666-8666-666666666666","roster_content_hash":"sha256:00000000000000000000000000000000000000000000000000000000000000cf","roster_version":"fixture-roster_version","run_plan_id":"rpl_22222222-2222-4222-8222-222222222222","source_count":1,"source_owner_count":1,"source_owner_set_root":"sha256:bb57b8f091888e72eff82aee5ba264927354b4e3824f389af1840542b0cedb36","source_policy_version":"fixture-source_policy_version","source_register_artifact_hash":"sha256:00000000000000000000000000000000000000000000000000000000000dbba1","source_register_member_count":1,"source_register_member_set_root":"sha256:42f00a7ebfcb485e23adfd593c30112c4b76563025edfab536dafa6e94757317","source_register_receipt_hash":"sha256:948dd008e0e8a553eaa26170357fa55ce66e9d7aff302844bc45e2ce89b36eb5","source_register_version":"register-connected@1","source_set_root":"sha256:48ba83057b0298adda3678c03242d2a342277889d1d78968c3d94b07e9ccec44"}',
      canonical_utf8_hex:
        "7b22616461707465725f6d616e69666573745f68617368223a227368613235363a30303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030306462626132222c2261646d69747465645f72756e5f706c616e5f6365696c696e6773223a7b2261695f746f6b656e5f6365696c696e67223a312c2262726f777365725f6d696c6c697365636f6e645f6365696c696e67223a312c22627974655f6365696c696e67223a312c22636f73745f6d6963726f7573645f6365696c696e67223a312c22656c61707365645f6d696c6c697365636f6e645f6365696c696e67223a32303030302c22726571756573745f6365696c696e67223a317d2c22617574686f726974795f706c616e5f6964223a227670615f31313131313131312d313131312d343131312d383131312d313131313131313131313131222c2263616e6f6e6963616c5f6a736f6e5f76657273696f6e223a227175616e74636c61726974792d63616e6f6e6963616c2d6a736f6e4031222c22636f6e74726163745f76657273696f6e223a2270726f76656e616e63652d76322d737563636573736f722d6d616e69666573744031222c2263726564656e7469616c5f636f756e74223a31312c2263726564656e7469616c5f7365745f726f6f74223a227368613235363a65633531666561616261323533343135303733323963613965313665323836333432313564623064383536373263666461636539636265303732343131356262222c22656e7669726f6e6d656e745f636f756e74223a312c22656e7669726f6e6d656e745f7365745f726f6f74223a227368613235363a37356534356132643134623933663836383532623235323366373164656461393265333464666331616635366262666539643736643331616638353138643932222c2265787472616374696f6e5f706f6c6963795f76657273696f6e223a6e756c6c2c22696e7374616c6c6174696f6e5f6964223a227076695f33333333333333332d333333332d343333332d383333332d333333333333333333333333222c226c65676163795f616461707465725f636f6e74726163745f76657273696f6e223a22312e302e30222c226c65676163795f616461707465725f76657273696f6e223a22312e302e302b7368613235362e61616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161222c227061727365725f76657273696f6e223a22666978747572652d7061727365725f76657273696f6e222c2270726f76696465725f6964223a227072765f34343434343434342d343434342d343434342d383434342d343434343434343434343434222c2270726f76696465725f6f7264696e616c223a302c2270726f76696465725f6f7267616e697a6174696f6e5f6964223a226f72675f36363636363636362d363636362d343636362d383636362d363636363636363636363636222c22726f737465725f636f6e74656e745f68617368223a227368613235363a30303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030306366222c22726f737465725f76657273696f6e223a22666978747572652d726f737465725f76657273696f6e222c2272756e5f706c616e5f6964223a2272706c5f32323232323232322d323232322d343232322d383232322d323232323232323232323232222c22736f757263655f636f756e74223a312c22736f757263655f6f776e65725f636f756e74223a312c22736f757263655f6f776e65725f7365745f726f6f74223a227368613235363a62623537623866303931383838653732656666383261656535626132363439323733353462346533383234663338396166313834303534326230636564623336222c22736f757263655f706f6c6963795f76657273696f6e223a22666978747572652d736f757263655f706f6c6963795f76657273696f6e222c22736f757263655f72656769737465725f61727469666163745f68617368223a227368613235363a30303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030306462626131222c22736f757263655f72656769737465725f6d656d6265725f636f756e74223a312c22736f757263655f72656769737465725f6d656d6265725f7365745f726f6f74223a227368613235363a34326630306137656266636234383565323361646664353933633330313132633462373635363330323565646661623533366461666136653934373537333137222c22736f757263655f72656769737465725f726563656970745f68617368223a227368613235363a39343864643030386530653861353533656161323631373033353766613535636536366539643761666633303238343462633435653263653839623336656235222c22736f757263655f72656769737465725f76657273696f6e223a2272656769737465722d636f6e6e65637465644031222c22736f757263655f7365745f726f6f74223a227368613235363a34386261383330353762303239386164646133363738633033323432643261333432323737383839643164373839363863336439346230376539636365633434227d",
      sha256:
        "sha256:036882a68140745f9d1ba07983b6d810c951515e21aa5a96dd504a605040814b",
    }),
    adapter_receipt_fixture_parity: Object.freeze({
      row_id: "row-adapter_manifest_receipt-receipt",
      target_field: "successor_manifest_hash",
      stored_digest:
        "sha256:036882a68140745f9d1ba07983b6d810c951515e21aa5a96dd504a605040814b",
      computed_digest:
        "sha256:036882a68140745f9d1ba07983b6d810c951515e21aa5a96dd504a605040814b",
      fixture_digest_equal: true,
      leaf_domain: "provenance-v2-adapter-receipt-leaf@1",
      recomputed_manifest_content_hash:
        "sha256:39fe956bba73e5df093a523e29bf858a444617e6bc32489e3db3dd27d691c565",
    }),
    downstream_cascade: Object.freeze({
      leaf_manifest_sha256:
        "sha256:a16b58ee147352a3c6f56c7678582abeefba1b1c15c89e54a9ff60d3c582bf65",
      adapter_manifest_set_root:
        "sha256:2a171193d007a838e33a8b5776cb311431cb2403dc0eeead28422d4f4c246f1f",
      endpoint_set_root_unchanged:
        "sha256:d8a51c6e094a2a867d229a907248a97e9388b2caed88cc15fc5d810a8656d947",
      verifier_policy_set_root_unchanged:
        "sha256:561a3d5ec4f4b4ecfe7aea46e837a792f9a9f53d8238b5e810e9732ea0a71672",
      field_policy_set_root_unchanged:
        "sha256:22faae5cffedfd36bb75a2b8b7b9d567e944fbbc0268d9556e044deade6632bd",
      candidate_authority_root:
        "sha256:53065532ae4961575062933336b3e46134b8150aeeb71e5fd97e06248d7bfd26",
      candidate_refused_receipt_hash:
        "sha256:f5ca0c6700224325f301ebf4df5dc60042f0664fb9364b9c52c68042c98dda68",
    }),
    pending: Object.freeze({
      registration_document_selector_and_strict_byte_ingestion: "pending",
      retained_document_and_remaining_safe_preimage_resolvers: "pending",
      external_and_repository_anchor_resolvers: "pending",
      repository_build_manifest: "pending",
      semantic_oracle: "pending",
      migration_schema_parity: "pending",
      frozen_d1_enumeration_and_row_lookup_closure: "pending",
      accepted_aggregate_limits: "pending",
    }),
  } as const,
);

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
    budget.stringBytes += utf8LengthWithin(value, 128_000 - budget.stringBytes);
    return budget.stringBytes <= 128_000 ? value : undefined;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isSafeInteger(value) && !Object.is(value, -0)
      ? value
      : undefined;
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
  if (++budget.nodes > 2_048 || keys.length > 256) return undefined;
  budget.properties += keys.length;
  if (budget.properties > 8_192 || keys.some((key) => typeof key === "symbol"))
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
      (lengthDescriptor.value as number) > 128 ||
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
    seen.delete(value);
    return copy;
  }
  if (prototype !== Object.prototype) return undefined;
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    if (key.length > 128) return undefined;
    budget.stringBytes += utf8LengthWithin(key, 128_000 - budget.stringBytes);
    if (budget.stringBytes > 128_000) return undefined;
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const child = snapshotPlainData(descriptor.value, seen, budget, depth + 1);
    if (child === undefined) return undefined;
    copy[key] = child;
  }
  seen.delete(value);
  return copy;
};

export const validateProvenanceV2ConnectedSuccessorManifestVectors = (
  value: unknown,
): string[] => {
  const snapshot = snapshotPlainData(value);
  if (
    !Value.Check(ProvenanceV2ConnectedSuccessorManifestVectorsSchema, snapshot)
  )
    return [
      "connected successor manifest vectors do not match their closed schema",
    ];
  if (
    JSON.stringify(snapshot) !==
    JSON.stringify(PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS)
  )
    return [
      "connected successor manifest vectors must equal the reviewed singleton",
    ];
  return [];
};
