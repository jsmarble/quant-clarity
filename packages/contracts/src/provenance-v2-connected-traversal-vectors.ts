import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const REVIEW_CANDIDATE_SCHEMA = {
  "x-quantclarity-contract-status": "review_candidate",
} as const;
const digest = () => Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const frameField = Type.Union([
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 64 }),
      tag: Type.Literal("text"),
      value: Type.String({ maxLength: 512 }),
      resolution: Type.Union([
        Type.Literal("synthetic_post_resolution_fixture"),
        Type.Literal("computed_collection"),
        Type.Literal("computed_frame"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 64 }),
      tag: Type.Literal("integer"),
      value: Type.String({ pattern: "^(?:0|[1-9][0-9]{0,15})$" }),
      resolution: Type.Union([
        Type.Literal("synthetic_post_resolution_fixture"),
        Type.Literal("computed_collection"),
        Type.Literal("computed_frame"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 64 }),
      tag: Type.Literal("digest"),
      value: digest(),
      resolution: Type.Union([
        Type.Literal("synthetic_post_resolution_fixture"),
        Type.Literal("computed_collection"),
        Type.Literal("computed_frame"),
      ]),
    },
    { additionalProperties: false },
  ),
]);

export const ProvenanceV2ConnectedTraversalVectorsSchema = Type.Object(
  {
    contract_version: Type.Literal(
      "provenance-v2-connected-traversal-vectors@1",
    ),
    status: Type.Literal("review_candidate"),
    coverage: Type.Literal(
      "connected_plan_root_traversal_and_synthetic_frame_linkage",
    ),
    authority_eligible: Type.Literal(false),
    outcome: Type.Literal("authority_refused"),
    persisted: Type.Literal(false),
    semantic_oracle_executed: Type.Literal(false),
    source_graph_contract_version: Type.Literal(
      "provenance-v2-connected-registration-graph@1",
    ),
    registry_contract_version: Type.Literal("provenance-v2-root-registry@1"),
    binding_plan_contract_version: Type.Literal(
      "provenance-v2-root-binding-plan@1",
    ),
    pending: Type.Object(
      {
        document_and_anchor_resolvers: Type.Literal("pending"),
        successor_manifest_preimage_parity: Type.Literal("pending"),
        semantic_oracle: Type.Literal("pending"),
        repository_build_manifest: Type.Literal("pending"),
        migration_schema_parity: Type.Literal("pending"),
        frozen_d1_enumeration_and_row_lookup_closure: Type.Literal("pending"),
        accepted_aggregate_limits: Type.Literal("pending"),
      },
      { additionalProperties: false },
    ),
    evidence_counts: Type.Object(
      {
        root_member_rows: Type.Literal(371),
        leaf_outputs: Type.Literal(371),
        plan_root_projections: Type.Literal(371),
        provider_claim_projections: Type.Literal(15),
        total_projections: Type.Literal(386),
        traversal_instances: Type.Literal(9),
        derived_digest_substitutions: Type.Literal(3),
        unresolved_safe_preimage_digests: Type.Literal(30),
        unresolved_external_anchor_digests: Type.Literal(10),
      },
      { additionalProperties: false },
    ),
    derived_digest_substitutions: Type.Array(
      Type.Object(
        {
          target_row_id: Type.String({ minLength: 1, maxLength: 160 }),
          target_field: Type.String({ minLength: 1, maxLength: 64 }),
          source_kind: Type.Union([
            Type.Literal("collection_digest"),
            Type.Literal("row_digest"),
          ]),
          source_name: Type.String({ minLength: 1, maxLength: 96 }),
          computed_digest: digest(),
        },
        { additionalProperties: false },
      ),
      { minItems: 3, maxItems: 3 },
    ),
    leaf_output_manifest: Type.Object(
      {
        domain: Type.Literal("provenance-v2-connected-leaf-manifest@1"),
        member_count: Type.Literal(371),
        sha256: digest(),
      },
      { additionalProperties: false },
    ),
    traversals: Type.Array(
      Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 96 }),
          purpose: Type.Union([
            Type.Literal("successor_claim"),
            Type.Literal("plan_root"),
          ]),
          member_count: Type.Integer({ minimum: 1, maximum: 278 }),
          ordered_row_id_manifest_sha256: digest(),
          collection_sha256: digest(),
        },
        { additionalProperties: false },
      ),
      { minItems: 9, maxItems: 9 },
    ),
    candidate_successor_claims: Type.Object(
      {
        source_owner_count: Type.Literal(1),
        source_owner_set_root: digest(),
        source_register_member_count: Type.Literal(1),
        source_register_member_set_root: digest(),
        source_register_receipt_hash: digest(),
        environment_count: Type.Literal(1),
        environment_set_root: digest(),
        credential_count: Type.Literal(11),
        credential_set_root: digest(),
        source_count: Type.Literal(1),
        source_set_root: digest(),
      },
      { additionalProperties: false },
    ),
    candidate_authority_frame: Type.Object(
      {
        domain: Type.Literal("provenance-v2-authority-root-frame@1"),
        fields: Type.Array(frameField, { minItems: 22, maxItems: 22 }),
        frame_hex: Type.String({ pattern: "^[0-9a-f]+$", maxLength: 8192 }),
        sha256: digest(),
      },
      { additionalProperties: false },
    ),
    candidate_refused_receipt_frame: Type.Object(
      {
        domain: Type.Literal("provenance-v2-oracle-receipt@1"),
        fields: Type.Array(frameField, { minItems: 6, maxItems: 6 }),
        frame_hex: Type.String({ pattern: "^[0-9a-f]+$", maxLength: 4096 }),
        sha256: digest(),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: "ProvenanceV2ConnectedTraversalVectors",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

const zeroDigest =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";
const synthetic = (
  name: string,
  tag: "text" | "integer" | "digest",
  value: string,
) =>
  Object.freeze({
    name,
    tag,
    value,
    resolution: "synthetic_post_resolution_fixture",
  });
const computed = (
  name: string,
  value: string,
  resolution: "computed_collection" | "computed_frame",
) => Object.freeze({ name, tag: "digest", value, resolution });

// These values are golden outputs, not an executable registrar or oracle. The
// independent Node and workerd tests recompute them from the reviewed H2a graph.
export const PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS = Object.freeze({
  contract_version: "provenance-v2-connected-traversal-vectors@1",
  status: "review_candidate",
  coverage: "connected_plan_root_traversal_and_synthetic_frame_linkage",
  authority_eligible: false,
  outcome: "authority_refused",
  persisted: false,
  semantic_oracle_executed: false,
  source_graph_contract_version: "provenance-v2-connected-registration-graph@1",
  registry_contract_version: "provenance-v2-root-registry@1",
  binding_plan_contract_version: "provenance-v2-root-binding-plan@1",
  pending: Object.freeze({
    document_and_anchor_resolvers: "pending",
    successor_manifest_preimage_parity: "pending",
    semantic_oracle: "pending",
    repository_build_manifest: "pending",
    migration_schema_parity: "pending",
    frozen_d1_enumeration_and_row_lookup_closure: "pending",
    accepted_aggregate_limits: "pending",
  }),
  evidence_counts: Object.freeze({
    root_member_rows: 371,
    leaf_outputs: 371,
    plan_root_projections: 371,
    provider_claim_projections: 15,
    total_projections: 386,
    traversal_instances: 9,
    derived_digest_substitutions: 3,
    unresolved_safe_preimage_digests: 30,
    unresolved_external_anchor_digests: 10,
  }),
  derived_digest_substitutions: Object.freeze([
    Object.freeze({
      target_row_id: "row-source_register_receipt-receipt",
      target_field: "member_set_root",
      source_kind: "collection_digest",
      source_name: "source_register_member_set_root",
      computed_digest:
        "sha256:42f00a7ebfcb485e23adfd593c30112c4b76563025edfab536dafa6e94757317",
    }),
    Object.freeze({
      target_row_id: "row-source_endpoint_registration-registration",
      target_field: "endpoint_content_hash",
      source_kind: "row_digest",
      source_name: "provenance_v2_source_endpoint.endpoint_content_hash",
      computed_digest:
        "sha256:7caf7ce80f9a17633e263aa3b968fce43da9d45a309522716c91954b0f985882",
    }),
    Object.freeze({
      target_row_id: "row-source_endpoint_registration-registration",
      target_field: "manifest_source_hash",
      source_kind: "row_digest",
      source_name: "provenance_v2_adapter_manifest_source.manifest_source_hash",
      computed_digest:
        "sha256:a11ef6c66c8d2e60e531d6c1c16b244c58d90578f6663f675eeca392fc29e0b2",
    }),
  ]),
  leaf_output_manifest: Object.freeze({
    domain: "provenance-v2-connected-leaf-manifest@1",
    member_count: 371,
    sha256:
      "sha256:6794b40f432ecd03f5eeb424e5379f4c17a7699bdb2f5b85953eed61aa25c3db",
  }),
  traversals: Object.freeze(
    (
      [
        [
          "source_owner_set_root",
          "successor_claim",
          1,
          "5b679ce2f7c8bbda525fce799f97bb8c36bd392137cc132d838b1a1d5c66aba5",
          "bb57b8f091888e72eff82aee5ba264927354b4e3824f389af1840542b0cedb36",
        ],
        [
          "source_register_member_set_root",
          "successor_claim",
          1,
          "c9a8268279d1803de21957743d3782707248d04be710c6b65517047a8219f503",
          "42f00a7ebfcb485e23adfd593c30112c4b76563025edfab536dafa6e94757317",
        ],
        [
          "environment_set_root",
          "successor_claim",
          1,
          "01ca48d8e0d2c6de68dd0a677274ed6813f14a65ca67296078b646af4e19734a",
          "75e45a2d14b93f86852b2523f71deda92e34dfc1af56bbfe9d76d31af8518d92",
        ],
        [
          "credential_set_root",
          "successor_claim",
          11,
          "8e3da257c9270733ae8dbcac8a664331fb39cf02d7142c72cfad5156c321b40c",
          "ec51feaaba25341507329ca9e16e28634215db0d85672cfdace9cbe0724115bb",
        ],
        [
          "source_set_root",
          "successor_claim",
          1,
          "a78f6998dd6dbe864cad00037c266a5a64da9330547c87848395bea7592b5404",
          "48ba83057b0298adda3678c03242d2a342277889d1d78968c3d94b07e9ccec44",
        ],
        [
          "adapter_manifest_set_root",
          "plan_root",
          17,
          "dbae30b7d12790e85a92f6abdd56bd7885f11154df4d903e73398b837df2dceb",
          "f881141d77ed1b7ca3ce561bc5777b8df3df5b3fb9ed52e37cf03519757d397f",
        ],
        [
          "endpoint_set_root",
          "plan_root",
          73,
          "95f9ceaaabc42ce7f2544f92c4bcf6bd70594451c3ff0432c9342f55b2e1f79a",
          "d8a51c6e094a2a867d229a907248a97e9388b2caed88cc15fc5d810a8656d947",
        ],
        [
          "verifier_policy_set_root",
          "plan_root",
          3,
          "a91e72931ee66de861bdd4596b98431bb96f04ee5790be3b9dd8cc120d0c4cf5",
          "561a3d5ec4f4b4ecfe7aea46e837a792f9a9f53d8238b5e810e9732ea0a71672",
        ],
        [
          "field_policy_set_root",
          "plan_root",
          278,
          "340be7b0668f902d7cdf2dd444290545f6136f06c88f8de9d21cfaff1f16e9d6",
          "22faae5cffedfd36bb75a2b8b7b9d567e944fbbc0268d9556e044deade6632bd",
        ],
      ] as const
    ).map(([name, purpose, member_count, rowManifest, collection]) =>
      Object.freeze({
        name,
        purpose,
        member_count,
        ordered_row_id_manifest_sha256: `sha256:${rowManifest}`,
        collection_sha256: `sha256:${collection}`,
      }),
    ),
  ),
  candidate_successor_claims: Object.freeze({
    source_owner_count: 1,
    source_owner_set_root:
      "sha256:bb57b8f091888e72eff82aee5ba264927354b4e3824f389af1840542b0cedb36",
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
  }),
  candidate_authority_frame: Object.freeze({
    domain: "provenance-v2-authority-root-frame@1",
    fields: Object.freeze([
      synthetic(
        "contract_version",
        "text",
        "provenance-v2-connected-traversal-candidate@1",
      ),
      synthetic("semantic_policy_hash", "digest", zeroDigest),
      synthetic("canonical_document_hash", "digest", zeroDigest),
      synthetic(
        "installation_id",
        "text",
        "pvi_33333333-3333-4333-8333-333333333333",
      ),
      synthetic("environment", "text", "test"),
      synthetic(
        "authority_plan_id",
        "text",
        "vpa_11111111-1111-4111-8111-111111111111",
      ),
      synthetic(
        "run_plan_id",
        "text",
        "rpl_22222222-2222-4222-8222-222222222222",
      ),
      synthetic("run_plan_hash", "digest", zeroDigest),
      synthetic("effective_from_ms", "integer", "1786406400000"),
      synthetic("effective_to_ms", "integer", "1786492800000"),
      synthetic("created_at_ms", "integer", "1786406400000"),
      synthetic("canonical_document_bytes", "integer", "1"),
      synthetic("normalized_row_count", "integer", "1"),
      synthetic("closed_at_ms", "integer", "1786406400000"),
      synthetic("adapter_manifest_count", "integer", "1"),
      computed(
        "adapter_manifest_set_root",
        "sha256:f881141d77ed1b7ca3ce561bc5777b8df3df5b3fb9ed52e37cf03519757d397f",
        "computed_collection",
      ),
      synthetic("endpoint_count", "integer", "1"),
      computed(
        "endpoint_set_root",
        "sha256:d8a51c6e094a2a867d229a907248a97e9388b2caed88cc15fc5d810a8656d947",
        "computed_collection",
      ),
      synthetic("verifier_policy_count", "integer", "1"),
      computed(
        "verifier_policy_set_root",
        "sha256:561a3d5ec4f4b4ecfe7aea46e837a792f9a9f53d8238b5e810e9732ea0a71672",
        "computed_collection",
      ),
      synthetic("field_policy_count", "integer", "4"),
      computed(
        "field_policy_set_root",
        "sha256:22faae5cffedfd36bb75a2b8b7b9d567e944fbbc0268d9556e044deade6632bd",
        "computed_collection",
      ),
    ]),
    frame_hex:
      "514350563201002470726f76656e616e63652d76322d617574686f726974792d726f6f742d6672616d6540310000001601000000000000002d70726f76656e616e63652d76322d636f6e6e65637465642d74726176657273616c2d63616e6469646174654031040000000000000020000000000000000000000000000000000000000000000000000000000000000004000000000000002000000000000000000000000000000000000000000000000000000000000000000100000000000000287076695f33333333333333332d333333332d343333332d383333332d333333333333333333333333010000000000000004746573740100000000000000287670615f31313131313131312d313131312d343131312d383131312d31313131313131313131313101000000000000002872706c5f32323232323232322d323232322d343232322d383232322d323232323232323232323232040000000000000020000000000000000000000000000000000000000000000000000000000000000002000000000000000d3137383634303634303030303002000000000000000d3137383634393238303030303002000000000000000d31373836343036343030303030020000000000000001310200000000000000013102000000000000000d3137383634303634303030303002000000000000000131040000000000000020f881141d77ed1b7ca3ce561bc5777b8df3df5b3fb9ed52e37cf03519757d397f02000000000000000131040000000000000020d8a51c6e094a2a867d229a907248a97e9388b2caed88cc15fc5d810a8656d94702000000000000000131040000000000000020561a3d5ec4f4b4ecfe7aea46e837a792f9a9f53d8238b5e810e9732ea0a716720200000000000000013404000000000000002022faae5cffedfd36bb75a2b8b7b9d567e944fbbc0268d9556e044deade6632bd",
    sha256:
      "sha256:130c1461a15fbc2f433e32a418baabec8940a3d1d1ba66985a0741f8783cf557",
  }),
  candidate_refused_receipt_frame: Object.freeze({
    domain: "provenance-v2-oracle-receipt@1",
    fields: Object.freeze([
      synthetic(
        "authority_plan_id",
        "text",
        "vpa_11111111-1111-4111-8111-111111111111",
      ),
      synthetic(
        "oracle_contract_version",
        "text",
        "provenance-v2-connected-traversal-candidate@1",
      ),
      synthetic("oracle_implementation_hash", "digest", zeroDigest),
      synthetic("semantic_policy_hash", "digest", zeroDigest),
      computed(
        "authority_root",
        "sha256:130c1461a15fbc2f433e32a418baabec8940a3d1d1ba66985a0741f8783cf557",
        "computed_frame",
      ),
      synthetic("verified_at_ms", "integer", "1786406400000"),
    ]),
    frame_hex:
      "514350563201001e70726f76656e616e63652d76322d6f7261636c652d726563656970744031000000060100000000000000287670615f31313131313131312d313131312d343131312d383131312d31313131313131313131313101000000000000002d70726f76656e616e63652d76322d636f6e6e65637465642d74726176657273616c2d63616e646964617465403104000000000000002000000000000000000000000000000000000000000000000000000000000000000400000000000000200000000000000000000000000000000000000000000000000000000000000000040000000000000020130c1461a15fbc2f433e32a418baabec8940a3d1d1ba66985a0741f8783cf55702000000000000000d31373836343036343030303030",
    sha256:
      "sha256:e01fa76b50d26e653a6dd68a74d2c1b8f8657966086a0c5849624b0dc2aedae4",
  }),
} as const);

const utf8LengthWithin = (value: string, maximum: number): number => {
  if (value.length > maximum) return maximum + 1;
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) return maximum + 1;
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
    budget.stringBytes += utf8LengthWithin(value, 64_000 - budget.stringBytes);
    return budget.stringBytes <= 64_000 ? value : undefined;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== "object" || depth > 10 || seen.has(value))
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
  if (++budget.nodes > 1_024 || keys.length > 128) return undefined;
  budget.properties += keys.length;
  if (budget.properties > 4_096 || keys.some((key) => typeof key === "symbol"))
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
      (lengthDescriptor.value as number) > 64 ||
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
    return copy;
  }
  if (prototype !== Object.prototype) return undefined;
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) {
    if (key.length > 128) return undefined;
    budget.stringBytes += utf8LengthWithin(key, 64_000 - budget.stringBytes);
    if (budget.stringBytes > 64_000) return undefined;
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const child = snapshotPlainData(descriptor.value, seen, budget, depth + 1);
    if (child === undefined) return undefined;
    copy[key] = child;
  }
  return copy;
};

export const validateProvenanceV2ConnectedTraversalVectors = (
  value: unknown,
): string[] => {
  const snapshot = snapshotPlainData(value);
  if (!Value.Check(ProvenanceV2ConnectedTraversalVectorsSchema, snapshot))
    return ["connected traversal vectors do not match their closed schema"];
  if (
    JSON.stringify(snapshot) !==
    JSON.stringify(PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS)
  )
    return ["connected traversal vectors must equal the reviewed singleton"];
  return [];
};
