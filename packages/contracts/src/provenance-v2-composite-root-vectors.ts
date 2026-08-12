import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { PROVENANCE_V2_AUTHORITY_ROOT_VECTORS } from "./provenance-v2-authority-root-vectors.js";
import { PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY } from "./provenance-v2-registration.js";
import { PROVENANCE_V2_ROOT_BINDING_PLAN } from "./provenance-v2-root-binding-plan.js";

const REVIEW_CANDIDATE_SCHEMA = {
  "x-quantclarity-contract-status": "review_candidate",
} as const;
const digest = () => Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const hex = () =>
  Type.String({ pattern: "^(?:[0-9a-f]{2})+$", maxLength: 32_768 });
const machineName = () => Type.String({ pattern: "^[a-z][a-z0-9_]*$" });
const tableName = () => Type.String({ pattern: "^provenance_v2_[a-z0-9_]+$" });
const field = Type.Union([
  Type.Object(
    {
      tag: Type.Literal("text"),
      value: Type.String({ maxLength: 256 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      tag: Type.Literal("integer"),
      value: Type.String({ pattern: "^(?:0|[1-9][0-9]{0,15})$" }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { tag: Type.Literal("digest"), value: digest() },
    { additionalProperties: false },
  ),
]);

export const ProvenanceV2CompositeRootVectorsSchema = Type.Object(
  {
    contract_version: Type.Literal("provenance-v2-composite-root-vectors@1"),
    status: Type.Literal("review_candidate"),
    coverage: Type.Literal("isolated_family_projection_and_frame_composition"),
    authority_eligible: Type.Literal(false),
    outcome: Type.Literal("authority_refused"),
    registry_contract_version: Type.Literal("provenance-v2-root-registry@1"),
    binding_plan_contract_version: Type.Literal(
      "provenance-v2-root-binding-plan@1",
    ),
    leaf_vector_contract_version: Type.Literal(
      "provenance-v2-authority-root-vectors@1",
    ),
    pending: Type.Object(
      {
        resolver_closure: Type.Literal("pending"),
        semantic_oracle: Type.Literal("pending"),
        repository_build_manifest: Type.Literal("pending"),
        migration_schema_parity: Type.Literal("pending"),
        accepted_aggregate_limits: Type.Literal("pending"),
      },
      { additionalProperties: false },
    ),
    leaf_vector_names: Type.Array(
      Type.String({ pattern: "^leaf-[a-z0-9_-]+$" }),
      { minItems: 33, maxItems: 33, uniqueItems: true },
    ),
    traversals: Type.Array(
      Type.Object(
        {
          name: machineName(),
          domain: Type.String({ pattern: "^provenance-v2-[a-z0-9-]+@1$" }),
          scope_fields: Type.Array(field, { minItems: 1, maxItems: 2 }),
          member_count: Type.Integer({ minimum: 1, maximum: 64 }),
          ordered_members: Type.Array(
            Type.Object(
              {
                registry_table: tableName(),
                leaf_vector_name: Type.String({
                  pattern: "^leaf-[a-z0-9_-]+$",
                }),
                source_ordinal: Type.Integer({ minimum: 0, maximum: 31 }),
                family_tag: machineName(),
                leaf_digest: digest(),
                projection_digest: digest(),
              },
              { additionalProperties: false },
            ),
            { minItems: 1, maxItems: 32 },
          ),
          frame_hex: hex(),
          sha256: digest(),
        },
        { additionalProperties: false },
      ),
      { minItems: 9, maxItems: 9 },
    ),
    candidate_successor_claim_shape: Type.Object(
      {
        source_owner_count: Type.Literal(1),
        source_owner_set_root: digest(),
        source_register_member_count: Type.Literal(1),
        source_register_member_set_root: digest(),
        source_register_receipt_hash: digest(),
        environment_count: Type.Literal(1),
        environment_set_root: digest(),
        credential_count: Type.Literal(1),
        credential_set_root: digest(),
        source_count: Type.Literal(1),
        source_set_root: digest(),
      },
      { additionalProperties: false },
    ),
    authority_root: Type.Object(
      {
        name: Type.Literal("authority_root"),
        domain: Type.Literal("provenance-v2-authority-root-frame@1"),
        fields: Type.Array(field, { minItems: 22, maxItems: 22 }),
        frame_hex: hex(),
        sha256: digest(),
      },
      { additionalProperties: false },
    ),
    candidate_receipt: Type.Object(
      {
        name: Type.Literal("oracle_receipt_hash"),
        domain: Type.Literal("provenance-v2-oracle-receipt@1"),
        fields: Type.Array(field, { minItems: 6, maxItems: 6 }),
        frame_hex: hex(),
        sha256: digest(),
        authority_eligible: Type.Literal(false),
      },
      { additionalProperties: false },
    ),
    ordering_cases: Type.Object(
      {
        integer_numeric: Type.Array(
          Type.Union([Type.Literal("2"), Type.Literal("10")]),
          { minItems: 2, maxItems: 2, uniqueItems: true },
        ),
        utf8_binary: Type.Array(
          Type.Union([Type.Literal("z"), Type.Literal("é")]),
          { minItems: 2, maxItems: 2, uniqueItems: true },
        ),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: "ProvenanceV2CompositeRootVectors",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

const PROJECTION_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  "source_owner_set_root/provenance_v2_source_owner_receipt":
    "sha256:e19d46e26f9bd40691b876b46696cb20669c92626b99afdde2c7a867b1419b0a",
  "source_register_member_set_root/provenance_v2_source_register_member":
    "sha256:1c854b3b3daadbdaeda2cbcde814a44aefbef0f77a851017a2be9f94d1e187e8",
  "environment_set_root/provenance_v2_adapter_manifest_environment":
    "sha256:1c3bc26213693472b142c7d8306c5eebfa5b76868ed19584d590424106c7fd07",
  "credential_set_root/provenance_v2_adapter_manifest_credential":
    "sha256:735485e084269d4329bfd27764c74b1f8a2cbf76424d8a476d244340c163064e",
  "source_set_root/provenance_v2_adapter_manifest_source":
    "sha256:d2858715e4ee7a3156a8819ac1aa8bbe7ae9e920a2158f330de24e6c01c0cbec",
  "adapter_manifest_set_root/provenance_v2_source_owner_receipt":
    "sha256:e19d46e26f9bd40691b876b46696cb20669c92626b99afdde2c7a867b1419b0a",
  "adapter_manifest_set_root/provenance_v2_source_register_receipt":
    "sha256:459e96513d3ef2dbfd6d1293968bc5b54d9ce3887bab8507aa63d7bdf0f7c491",
  "adapter_manifest_set_root/provenance_v2_source_register_member":
    "sha256:39a8ff0ee50eb6fd2b3b38f9f7f1bbbc6703520dcdd80c4f2a446465d7b8b741",
  "adapter_manifest_set_root/provenance_v2_adapter_manifest_receipt":
    "sha256:02f493c483ebe1a45dd5eee45b441a75853cfd98754fef227c28dafcfb240e4e",
  "adapter_manifest_set_root/provenance_v2_adapter_manifest_environment":
    "sha256:5207e15bb84870c377f611fdc047f259cc9cb1f553d923841d6869bfaa321662",
  "adapter_manifest_set_root/provenance_v2_adapter_manifest_credential":
    "sha256:d23f8b89c7fd463d11d61bfa953be1cc37d9c4e8afb739f8254b44065977123a",
  "adapter_manifest_set_root/provenance_v2_adapter_manifest_source":
    "sha256:8ea5c634bb3f2c57c1825fa0d950af3d39e865fae5384022272e605b1a845436",
  "endpoint_set_root/provenance_v2_source_endpoint":
    "sha256:9e51ec54d61de6689a8ae4303b517994bd6aad7d9b5d8f91110e2b9e0c7627c3",
  "endpoint_set_root/provenance_v2_source_endpoint_registration":
    "sha256:284203af4f0d38bd0433d753bb1124a8c904a1e42356224ab8babca06078155c",
  "endpoint_set_root/provenance_v2_source_endpoint_request":
    "sha256:987d534af5367cfc8644c9f2c2136a7829c3336c9e2aa3e6b4e722e4cef2859d",
  "endpoint_set_root/provenance_v2_source_endpoint_parameter":
    "sha256:5b50e284ca421afd54ff721f120b0af29b7893804a10e6c33a558a62ad095386",
  "endpoint_set_root/provenance_v2_source_endpoint_parameter_enum":
    "sha256:9d5d6458086b42f6c8d6f9476ba04d779668370ea0de266ca7e784b19b7d2fd5",
  "endpoint_set_root/provenance_v2_source_endpoint_allowed_header":
    "sha256:23cbf25d9d0492cc3c7dd796d68edebf6fb3bb7912faa3c3ae181277947b95a3",
  "endpoint_set_root/provenance_v2_source_endpoint_redirect_host":
    "sha256:0fbc70ab4e9035b4d5f2c02004827e990becc97bce28c5d745ae5a1d6b7e2cda",
  "endpoint_set_root/provenance_v2_source_endpoint_content_type":
    "sha256:d214be21973aa7334163943d4c49ab2e772a493b3d1e41b6d433e0abeeeb0f54",
  "endpoint_set_root/provenance_v2_source_endpoint_expected_field":
    "sha256:67f722c1075d9274c58f363c43afdfc27dd284351b59beae3e45fc0f23713850",
  "endpoint_set_root/provenance_v2_source_endpoint_raw_field_mapping":
    "sha256:0c2b117ebfc7c34a49dd92f8a000c6e72183d1c0f505885ebefe6b141a3a37cd",
  "endpoint_set_root/provenance_v2_source_endpoint_approval":
    "sha256:6df21d3ebd7920a16f7051547b944f1faae2e88897bf2806565ed027bf2c1a5a",
  "verifier_policy_set_root/provenance_v2_verifier_implementation":
    "sha256:a01c291086c46c8617db0bc7539bcfe181e0822c40fc284c0b65fc4e86758311",
  "verifier_policy_set_root/provenance_v2_verifier_policy":
    "sha256:418b87ba6681de6556d654376ec409971fcfae58ab2391210f223638b77d8c1f",
  "verifier_policy_set_root/provenance_v2_verifier_policy_member":
    "sha256:29888bd6ea6b768d0fee869a549ff423500c8d0dcc0db85ea3f8d8b037d0f262",
  "field_policy_set_root/provenance_v2_field_path_vocabulary":
    "sha256:9c70db784f7ff9b50d042ef9960a73bc11f692c30c41412784a1c653e0aa5fae",
  "field_policy_set_root/provenance_v2_field_path_authority_role":
    "sha256:5a253ce88b46adf3ec9abfd0e6072c45579adeed13edf5f3e671bfd68fae4b8f",
  "field_policy_set_root/provenance_v2_field_path_enum_value":
    "sha256:508b14239f6dfb1444a66c96682b0414277f09fd889e24de3361b40b748a6e92",
  "field_policy_set_root/provenance_v2_field_record_group":
    "sha256:b5923d0331092f80a9a2480f52e7baf7cfbc771c7465c51af848343857eaeeca",
  "field_policy_set_root/provenance_v2_field_record_group_member":
    "sha256:a71c54f7e0d10edafe479a0cb517ae85939def6cf12285af4075ee12c3e0c322",
  "field_policy_set_root/provenance_v2_field_policy":
    "sha256:7c445f21fe6568cd6edb91ba5844f1631c3f4e7565ce66e4876da5b069b00ba8",
  "field_policy_set_root/provenance_v2_field_policy_member":
    "sha256:64c2f733c4814470c8919cfc24eca43f730450782efb3b0700ef982e4cd4ab59",
  "field_policy_set_root/provenance_v2_field_policy_precedence_class":
    "sha256:4a3f6a0b8e74d88c29420c8a369c92991b7cb27ed185b5cb7e19225e588c605f",
  "field_policy_set_root/provenance_v2_field_policy_precedence_class_source":
    "sha256:4e9906d1215712087c5e0132616e8ff51a2192a511af4379dac1a585a897c2da",
  "field_policy_set_root/provenance_v2_field_policy_precedence_edge":
    "sha256:8786ed7c90b6a8aba99db0e792b8b2e2ac2a131c712773dbd9d7c6019bd89fcd",
  "field_policy_set_root/provenance_v2_field_policy_endpoint_admission":
    "sha256:389e5fd21e56ad2d866cf36556f8b06a450fa3a5de75839dece21e66539400bb",
  "field_policy_set_root/provenance_v2_field_policy_endpoint_exclusion":
    "sha256:ca313f74ea1e7ff91161e48ec2835689153f0814ad8b846ad1aafcc30c21cfa1",
});

const TRAVERSAL_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  source_owner_set_root:
    "sha256:735f4e640a64111edf7ab3fb3e117c679b202fb1ed594b057253aed3a6749d3e",
  source_register_member_set_root:
    "sha256:f576ae59e7336c8d1c1e4b506b875996cd8749ebb3dda8e59019e0222c06eb10",
  environment_set_root:
    "sha256:869ff1aa5cb97c141d4e0cb3997f83c8f5bd79bee2f43bf4281e5c98e2c6f8ab",
  credential_set_root:
    "sha256:8b4e7e41d3abcd8a2020db1fec856df59ab960f35c8ea0a6c7ec1dee0e25ffb0",
  source_set_root:
    "sha256:2cc40526c9dd6f1ebb6c67bcec56b89d895c6cc265e1b4bba24bd895047e2c80",
  adapter_manifest_set_root:
    "sha256:f4cf9d6455b4a60f39ba4aacc71e2856569c69a65c96ce146109081307759cb2",
  endpoint_set_root:
    "sha256:a6ae8382bfbf4660d2b3e81acaf47793bc3a84b618d8f650c5e0009043c54bda",
  verifier_policy_set_root:
    "sha256:0cd857acfe0b9e4adad0b0280fe48d52f86777f4f0ad915934c68909ffe3ddd2",
  field_policy_set_root:
    "sha256:dabcaa24cf4f13d259e45dd35a1c831576421653f71734c48a8806e91a2e53f9",
});

const TRAVERSAL_FRAMES: Readonly<Record<string, string>> = Object.freeze({
  source_owner_set_root:
    "514350563201002070726f76656e616e63652d76322d736f757263652d6f776e65722d7365744031000000040100000000000000076669656c642d30010000000000000006c3a9f09fa7aa02000000000000000131040000000000000020e19d46e26f9bd40691b876b46696cb20669c92626b99afdde2c7a867b1419b0a",
  source_register_member_set_root:
    "514350563201002a70726f76656e616e63652d76322d736f757263652d72656769737465722d6d656d6265722d7365744031000000040100000000000000076669656c642d30010000000000000006c3a9f09fa7aa020000000000000001310400000000000000201c854b3b3daadbdaeda2cbcde814a44aefbef0f77a851017a2be9f94d1e187e8",
  environment_set_root:
    "514350563201002770726f76656e616e63652d76322d616461707465722d656e7669726f6e6d656e742d7365744031000000040100000000000000076669656c642d30010000000000000006c3a9f09fa7aa020000000000000001310400000000000000201c3bc26213693472b142c7d8306c5eebfa5b76868ed19584d590424106c7fd07",
  credential_set_root:
    "514350563201002670726f76656e616e63652d76322d616461707465722d63726564656e7469616c2d7365744031000000040100000000000000076669656c642d30010000000000000006c3a9f09fa7aa02000000000000000131040000000000000020735485e084269d4329bfd27764c74b1f8a2cbf76424d8a476d244340c163064e",
  source_set_root:
    "514350563201002270726f76656e616e63652d76322d616461707465722d736f757263652d7365744031000000040100000000000000076669656c642d30010000000000000006c3a9f09fa7aa02000000000000000131040000000000000020d2858715e4ee7a3156a8819ac1aa8bbe7ae9e920a2158f330de24e6c01c0cbec",
  adapter_manifest_set_root:
    "514350563201002470726f76656e616e63652d76322d616461707465722d6d616e69666573742d7365744031000000090100000000000000076669656c642d3002000000000000000137040000000000000020e19d46e26f9bd40691b876b46696cb20669c92626b99afdde2c7a867b1419b0a040000000000000020459e96513d3ef2dbfd6d1293968bc5b54d9ce3887bab8507aa63d7bdf0f7c49104000000000000002039a8ff0ee50eb6fd2b3b38f9f7f1bbbc6703520dcdd80c4f2a446465d7b8b74104000000000000002002f493c483ebe1a45dd5eee45b441a75853cfd98754fef227c28dafcfb240e4e0400000000000000205207e15bb84870c377f611fdc047f259cc9cb1f553d923841d6869bfaa321662040000000000000020d23f8b89c7fd463d11d61bfa953be1cc37d9c4e8afb739f8254b44065977123a0400000000000000208ea5c634bb3f2c57c1825fa0d950af3d39e865fae5384022272e605b1a845436",
  endpoint_set_root:
    "514350563201001c70726f76656e616e63652d76322d656e64706f696e742d73657440310000000d0100000000000000076669656c642d3002000000000000000231310400000000000000209e51ec54d61de6689a8ae4303b517994bd6aad7d9b5d8f91110e2b9e0c7627c3040000000000000020284203af4f0d38bd0433d753bb1124a8c904a1e42356224ab8babca06078155c040000000000000020987d534af5367cfc8644c9f2c2136a7829c3336c9e2aa3e6b4e722e4cef2859d0400000000000000205b50e284ca421afd54ff721f120b0af29b7893804a10e6c33a558a62ad0953860400000000000000209d5d6458086b42f6c8d6f9476ba04d779668370ea0de266ca7e784b19b7d2fd504000000000000002023cbf25d9d0492cc3c7dd796d68edebf6fb3bb7912faa3c3ae181277947b95a30400000000000000200fbc70ab4e9035b4d5f2c02004827e990becc97bce28c5d745ae5a1d6b7e2cda040000000000000020d214be21973aa7334163943d4c49ab2e772a493b3d1e41b6d433e0abeeeb0f5404000000000000002067f722c1075d9274c58f363c43afdfc27dd284351b59beae3e45fc0f237138500400000000000000200c2b117ebfc7c34a49dd92f8a000c6e72183d1c0f505885ebefe6b141a3a37cd0400000000000000206df21d3ebd7920a16f7051547b944f1faae2e88897bf2806565ed027bf2c1a5a",
  verifier_policy_set_root:
    "514350563201002370726f76656e616e63652d76322d76657269666965722d706f6c6963792d7365744031000000050100000000000000076669656c642d3002000000000000000133040000000000000020a01c291086c46c8617db0bc7539bcfe181e0822c40fc284c0b65fc4e86758311040000000000000020418b87ba6681de6556d654376ec409971fcfae58ab2391210f223638b77d8c1f04000000000000002029888bd6ea6b768d0fee869a549ff423500c8d0dcc0db85ea3f8d8b037d0f262",
  field_policy_set_root:
    "514350563201002070726f76656e616e63652d76322d6669656c642d706f6c6963792d73657440310000000e0100000000000000076669656c642d3002000000000000000231320400000000000000209c70db784f7ff9b50d042ef9960a73bc11f692c30c41412784a1c653e0aa5fae0400000000000000205a253ce88b46adf3ec9abfd0e6072c45579adeed13edf5f3e671bfd68fae4b8f040000000000000020508b14239f6dfb1444a66c96682b0414277f09fd889e24de3361b40b748a6e92040000000000000020b5923d0331092f80a9a2480f52e7baf7cfbc771c7465c51af848343857eaeeca040000000000000020a71c54f7e0d10edafe479a0cb517ae85939def6cf12285af4075ee12c3e0c3220400000000000000207c445f21fe6568cd6edb91ba5844f1631c3f4e7565ce66e4876da5b069b00ba804000000000000002064c2f733c4814470c8919cfc24eca43f730450782efb3b0700ef982e4cd4ab590400000000000000204a3f6a0b8e74d88c29420c8a369c92991b7cb27ed185b5cb7e19225e588c605f0400000000000000204e9906d1215712087c5e0132616e8ff51a2192a511af4379dac1a585a897c2da0400000000000000208786ed7c90b6a8aba99db0e792b8b2e2ac2a131c712773dbd9d7c6019bd89fcd040000000000000020389e5fd21e56ad2d866cf36556f8b06a450fa3a5de75839dece21e66539400bb040000000000000020ca313f74ea1e7ff91161e48ec2835689153f0814ad8b846ad1aafcc30c21cfa1",
});

const leafVectorsByTable = new Map<
  string,
  (typeof PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors)[number]
>(
  PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors.flatMap((vector) =>
    vector.registry_table === null ? [] : [[vector.registry_table, vector]],
  ),
);
const scopeFields = (columns: readonly string[]) =>
  Object.freeze(
    columns.map((column) =>
      Object.freeze({
        tag: "text" as const,
        value: column === "authority_plan_id" ? "field-0" : "é🧪",
      }),
    ),
  );

const traversals = PROVENANCE_V2_ROOT_BINDING_PLAN.traversals.map((traversal) =>
  Object.freeze({
    name: traversal.name,
    domain: traversal.domain,
    scope_fields: scopeFields(traversal.scope_columns),
    member_count: traversal.sources.length,
    ordered_members: Object.freeze(
      traversal.sources.map((source) => {
        const vector = leafVectorsByTable.get(source.table);
        const projectionDigest =
          PROJECTION_DIGESTS[`${traversal.name}/${source.table}`];
        if (vector === undefined || projectionDigest === undefined)
          throw new Error("composite vector source lacks reviewed evidence");
        return Object.freeze({
          registry_table: source.table,
          leaf_vector_name: vector.name,
          source_ordinal: source.ordinal,
          family_tag: source.family_tag,
          leaf_digest: vector.sha256,
          projection_digest: projectionDigest,
        });
      }),
    ),
    frame_hex: TRAVERSAL_FRAMES[traversal.name] ?? "",
    sha256: TRAVERSAL_DIGESTS[traversal.name] ?? "",
  }),
);
const traversalDigest = (name: string) => {
  const value = TRAVERSAL_DIGESTS[name];
  if (value === undefined)
    throw new Error("missing composite traversal digest");
  return value;
};

const AUTHORITY_FIELDS = Object.freeze([
  { tag: "text", value: "provenance-v2-registration-plan@1" },
  { tag: "digest", value: `sha256:${"11".repeat(32)}` },
  { tag: "digest", value: `sha256:${"22".repeat(32)}` },
  { tag: "text", value: "installation-vector" },
  { tag: "text", value: "production" },
  { tag: "text", value: "field-0" },
  { tag: "text", value: "run-vector" },
  { tag: "digest", value: `sha256:${"33".repeat(32)}` },
  { tag: "integer", value: "1786406400000" },
  { tag: "integer", value: "1786492800000" },
  { tag: "integer", value: "1786406300000" },
  { tag: "integer", value: "4096" },
  { tag: "integer", value: "33" },
  { tag: "integer", value: "1786406350000" },
  { tag: "integer", value: "1" },
  { tag: "digest", value: traversalDigest("adapter_manifest_set_root") },
  { tag: "integer", value: "1" },
  { tag: "digest", value: traversalDigest("endpoint_set_root") },
  { tag: "integer", value: "1" },
  { tag: "digest", value: traversalDigest("verifier_policy_set_root") },
  { tag: "integer", value: "1" },
  { tag: "digest", value: traversalDigest("field_policy_set_root") },
] as const);
const AUTHORITY_DIGEST =
  "sha256:9cfcffbfd524dab07c5d11b6542d15a6f8aa15b6236ca41e5fa77b8626656611";

export const PROVENANCE_V2_COMPOSITE_ROOT_VECTORS = Object.freeze({
  contract_version: "provenance-v2-composite-root-vectors@1",
  status: "review_candidate",
  coverage: "isolated_family_projection_and_frame_composition",
  authority_eligible: false,
  outcome: "authority_refused",
  registry_contract_version: "provenance-v2-root-registry@1",
  binding_plan_contract_version: "provenance-v2-root-binding-plan@1",
  leaf_vector_contract_version: "provenance-v2-authority-root-vectors@1",
  pending: Object.freeze({
    resolver_closure: "pending",
    semantic_oracle: "pending",
    repository_build_manifest: "pending",
    migration_schema_parity: "pending",
    accepted_aggregate_limits: "pending",
  }),
  leaf_vector_names: Object.freeze(
    PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors.flatMap((vector) =>
      vector.registry_table === null ? [] : [vector.name],
    ),
  ),
  traversals: Object.freeze(traversals),
  candidate_successor_claim_shape: Object.freeze({
    source_owner_count: 1,
    source_owner_set_root: traversalDigest("source_owner_set_root"),
    source_register_member_count: 1,
    source_register_member_set_root: traversalDigest(
      "source_register_member_set_root",
    ),
    source_register_receipt_hash:
      leafVectorsByTable.get("provenance_v2_source_register_receipt")?.sha256 ??
      "",
    environment_count: 1,
    environment_set_root: traversalDigest("environment_set_root"),
    credential_count: 1,
    credential_set_root: traversalDigest("credential_set_root"),
    source_count: 1,
    source_set_root: traversalDigest("source_set_root"),
  }),
  authority_root: Object.freeze({
    name: "authority_root",
    domain: "provenance-v2-authority-root-frame@1",
    fields: AUTHORITY_FIELDS,
    frame_hex:
      "514350563201002470726f76656e616e63652d76322d617574686f726974792d726f6f742d6672616d6540310000001601000000000000002170726f76656e616e63652d76322d726567697374726174696f6e2d706c616e403104000000000000002011111111111111111111111111111111111111111111111111111111111111110400000000000000202222222222222222222222222222222222222222222222222222222222222222010000000000000013696e7374616c6c6174696f6e2d766563746f7201000000000000000a70726f64756374696f6e0100000000000000076669656c642d3001000000000000000a72756e2d766563746f72040000000000000020333333333333333333333333333333333333333333333333333333333333333302000000000000000d3137383634303634303030303002000000000000000d3137383634393238303030303002000000000000000d3137383634303633303030303002000000000000000434303936020000000000000002333302000000000000000d3137383634303633353030303002000000000000000131040000000000000020f4cf9d6455b4a60f39ba4aacc71e2856569c69a65c96ce146109081307759cb202000000000000000131040000000000000020a6ae8382bfbf4660d2b3e81acaf47793bc3a84b618d8f650c5e0009043c54bda020000000000000001310400000000000000200cd857acfe0b9e4adad0b0280fe48d52f86777f4f0ad915934c68909ffe3ddd202000000000000000131040000000000000020dabcaa24cf4f13d259e45dd35a1c831576421653f71734c48a8806e91a2e53f9",
    sha256: AUTHORITY_DIGEST,
  }),
  candidate_receipt: Object.freeze({
    name: "oracle_receipt_hash",
    domain: "provenance-v2-oracle-receipt@1",
    fields: Object.freeze([
      { tag: "text", value: "field-0" },
      { tag: "text", value: "provenance-v2-structural-candidate@1" },
      { tag: "digest", value: `sha256:${"44".repeat(32)}` },
      { tag: "digest", value: `sha256:${"11".repeat(32)}` },
      { tag: "digest", value: AUTHORITY_DIGEST },
      { tag: "integer", value: "1786406360000" },
    ]),
    frame_hex:
      "514350563201001e70726f76656e616e63652d76322d6f7261636c652d726563656970744031000000060100000000000000076669656c642d3001000000000000002470726f76656e616e63652d76322d7374727563747572616c2d63616e6469646174654031040000000000000020444444444444444444444444444444444444444444444444444444444444444404000000000000002011111111111111111111111111111111111111111111111111111111111111110400000000000000209cfcffbfd524dab07c5d11b6542d15a6f8aa15b6236ca41e5fa77b862665661102000000000000000d31373836343036333630303030",
    sha256:
      "sha256:6ce96aa13c7eda309de786518dc2cd5674564681325bdddde7109b6567077cce",
    authority_eligible: false,
  }),
  ordering_cases: Object.freeze({
    integer_numeric: Object.freeze(["2", "10"]),
    utf8_binary: Object.freeze(["z", "é"]),
  }),
} as const);

const snapshotPlainAcyclicData = (
  value: unknown,
  seen: Set<object> = new Set(),
  budget: { nodes: number; properties: number } = { nodes: 0, properties: 0 },
  depth = 0,
): unknown => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "string" && value.length > 32_768)
      throw new Error("string limit");
    return value;
  }
  if (typeof value !== "object") throw new Error("not plain data");
  if (seen.has(value)) throw new Error("cyclic data");
  budget.nodes += 1;
  if (budget.nodes > 4_096 || depth > 32) throw new Error("data limit");
  try {
    if (
      Reflect.getPrototypeOf(value) !==
      (Array.isArray(value) ? Array.prototype : Object.prototype)
    )
      throw new Error("exotic prototype");
    seen.add(value);
    if (Reflect.ownKeys(value).some((key) => typeof key === "symbol"))
      throw new Error("symbol key");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const descriptorEntries = Object.entries(descriptors);
    budget.properties += descriptorEntries.length;
    if (
      descriptorEntries.length > 256 ||
      budget.properties > 8_192 ||
      descriptorEntries.some(([key]) => key.length > 256)
    )
      throw new Error("property limit");
    const arrayLength = Array.isArray(value)
      ? Number(descriptors.length?.value)
      : null;
    if (typeof arrayLength === "number") {
      if (
        !Number.isSafeInteger(arrayLength) ||
        arrayLength < 0 ||
        arrayLength > 128
      )
        throw new Error("array limit");
      for (let index = 0; index < arrayLength; index += 1)
        if (!Object.hasOwn(descriptors, String(index)))
          throw new Error("sparse array");
    }
    const snapshot: unknown[] | Record<string, unknown> = Array.isArray(value)
      ? []
      : {};
    for (const descriptor of Object.values(descriptors)) {
      if (descriptor.get !== undefined || descriptor.set !== undefined)
        throw new Error("accessor");
    }
    for (const [key, descriptor] of descriptorEntries) {
      if (key === "length" && Array.isArray(value)) continue;
      snapshot[key as keyof typeof snapshot] = snapshotPlainAcyclicData(
        descriptor.value,
        seen,
        budget,
        depth + 1,
      ) as never;
    }
    seen.delete(value);
    return snapshot;
  } catch {
    seen.delete(value);
    throw new Error("not plain data");
  }
};

export const validateProvenanceV2CompositeRootVectors = (
  value: unknown,
): string[] => {
  let snapshot: unknown;
  try {
    snapshot = snapshotPlainAcyclicData(value);
  } catch {
    return ["composite root vectors must be plain acyclic data"];
  }
  if (!Value.Check(ProvenanceV2CompositeRootVectorsSchema, snapshot))
    return ["composite root vectors do not match their closed schema"];
  const artifact = snapshot;
  const errors: string[] = [];
  const rootMembers = PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.filter(
    (entry) => entry.disposition === "root_member",
  );
  if (
    artifact.leaf_vector_names.length !== rootMembers.length ||
    rootMembers.some((entry) => {
      const vector = leafVectorsByTable.get(entry.table);
      return (
        vector === undefined ||
        !artifact.leaf_vector_names.includes(vector.name)
      );
    })
  )
    errors.push(
      "composite evidence must reference every root-member leaf vector",
    );
  if (
    artifact.traversals.length !==
    PROVENANCE_V2_ROOT_BINDING_PLAN.traversals.length
  )
    errors.push("composite evidence must cover every declared traversal");
  if (new Set(artifact.traversals.map((item) => item.name)).size !== 9)
    errors.push("composite traversal names must be unique");
  for (const expected of PROVENANCE_V2_ROOT_BINDING_PLAN.traversals) {
    const candidate = artifact.traversals.find(
      (item) => item.name === expected.name,
    );
    if (
      candidate?.domain !== expected.domain ||
      JSON.stringify(candidate.scope_fields) !==
        JSON.stringify(scopeFields(expected.scope_columns)) ||
      candidate.member_count !== expected.sources.length ||
      candidate.ordered_members.length !== expected.sources.length ||
      candidate.frame_hex !== TRAVERSAL_FRAMES[expected.name] ||
      candidate.sha256 !== TRAVERSAL_DIGESTS[expected.name] ||
      expected.sources.some((source, index) => {
        const member = candidate.ordered_members[index];
        const vector = leafVectorsByTable.get(source.table);
        if (member === undefined || vector === undefined) return true;
        return (
          member.registry_table !== source.table ||
          member.leaf_vector_name !== vector.name ||
          member.leaf_digest !== vector.sha256 ||
          member.source_ordinal !== source.ordinal ||
          member.family_tag !== source.family_tag ||
          member.projection_digest !==
            PROJECTION_DIGESTS[`${expected.name}/${source.table}`]
        );
      })
    )
      errors.push("composite traversal must exactly bind the reviewed plan");
  }
  const [authorityFrame, receiptFrame] =
    PROVENANCE_V2_ROOT_BINDING_PLAN.record_frames;
  if (authorityFrame === undefined || receiptFrame === undefined)
    throw new Error("reviewed binding plan lacks its record frames");
  if (
    authorityFrame.fields.length !== artifact.authority_root.fields.length ||
    authorityFrame.fields.some(
      (item, index) =>
        item.ordinal !== index ||
        item.frame_type !== artifact.authority_root.fields[index]?.tag,
    ) ||
    receiptFrame.fields.length !== artifact.candidate_receipt.fields.length ||
    receiptFrame.fields.some(
      (item, index) =>
        item.ordinal !== index ||
        item.frame_type !== artifact.candidate_receipt.fields[index]?.tag,
    )
  )
    errors.push("composite record frames must match the reviewed binding plan");
  for (const fieldBinding of authorityFrame.fields) {
    if (fieldBinding.source.kind !== "collection") continue;
    const traversalName = fieldBinding.source.traversal;
    const candidate = artifact.traversals.find(
      (traversal) => traversal.name === traversalName,
    );
    if (
      candidate === undefined ||
      artifact.authority_root.fields[fieldBinding.ordinal]?.value !==
        candidate.sha256
    )
      errors.push("authority frame must contain every recomputed plan root");
  }
  if (
    artifact.candidate_receipt.fields[4]?.value !==
    artifact.authority_root.sha256
  )
    errors.push("candidate receipt must bind the reviewed authority root");
  const sourceRegisterVector = leafVectorsByTable.get(
    "provenance_v2_source_register_receipt",
  );
  if (
    artifact.candidate_successor_claim_shape.source_owner_set_root !==
      TRAVERSAL_DIGESTS.source_owner_set_root ||
    artifact.candidate_successor_claim_shape.source_register_member_set_root !==
      TRAVERSAL_DIGESTS.source_register_member_set_root ||
    artifact.candidate_successor_claim_shape.source_register_receipt_hash !==
      sourceRegisterVector?.sha256 ||
    artifact.candidate_successor_claim_shape.environment_set_root !==
      TRAVERSAL_DIGESTS.environment_set_root ||
    artifact.candidate_successor_claim_shape.credential_set_root !==
      TRAVERSAL_DIGESTS.credential_set_root ||
    artifact.candidate_successor_claim_shape.source_set_root !==
      TRAVERSAL_DIGESTS.source_set_root
  )
    errors.push(
      "candidate successor shape must list every Provider-scoped root",
    );
  if (
    JSON.stringify(artifact) !==
    JSON.stringify(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS)
  )
    errors.push(
      "composite root vectors must equal the reviewed canonical singleton",
    );
  return errors;
};
