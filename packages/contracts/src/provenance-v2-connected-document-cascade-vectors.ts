import { FormatRegistry, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  ProvenanceV2RegistrationPlanSchema,
  ProvenanceV2SuccessorManifestSchema,
  type ProvenanceV2RegistrationPlan,
} from "./provenance-v2-registration.js";
import { PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT } from "./provenance-v2-canonical-document.js";
import { PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS } from "./provenance-v2-connected-registration-document.js";
import { PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH } from "./provenance-v2-connected-registration-graph.js";
import { PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS } from "./provenance-v2-connected-successor-manifest-vectors.js";
import { PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS } from "./provenance-v2-connected-traversal-vectors.js";
import { PROVENANCE_V2_ROOT_BINDING_PLAN } from "./provenance-v2-root-binding-plan.js";

const REVIEW_CANDIDATE_SCHEMA = {
  "x-quantclarity-contract-status": "review_candidate",
} as const;
const SHA256 = "^sha256:[0-9a-f]{64}$";
const EVEN_HEX = "^(?:[0-9a-f]{2})+$";
const CANDIDATE_CONTRACT =
  "provenance-v2-connected-document-cascade-candidate@1";
const DOCUMENT_HASH =
  "sha256:1b101e77d9095fdd7728b078fff33a91ef76fbbf2a222a95b5c54af48056764f";
const SUCCESSOR_HASH =
  "sha256:38b9b756957810326f32ae8f7daa8a2305fecc75c5a9d865a65207570dee4786";
const CHUNK_HASHES = Object.freeze([
  "sha256:dcdb710a89cd278bfb682f975a92d2bf6f2a8d9c9d5147ebf17b5df88da46b59",
  "sha256:601ef6044be72c04ca373078b16df707f02bed7e49c3b5afe375989f59741e34",
  "sha256:3695bd301b83328c55837a8c07630bd585f9391c5d4786ffe2a37e0bede8715b",
  "sha256:51376a3cc5cee5707a69bfdae50c208868e1b5fbe22abf30a295ca86e00f5b17",
  "sha256:275a6be72224e19bbc69ffe69148581a9285867129fb537c9fc172c69f1633dd",
  "sha256:b7937701d8e9ed0c96c2207d1a19b382813890a74d627cbd9d0b3892dd041ab5",
  "sha256:226e57cbf22b965c4cce93a9cf3e2cc25ea213c7944757745a941b0e89cdb9f6",
  "sha256:9b042a06294897ee8554be0a85098f2ce5f14cc3c982e98428ab373d60722f66",
  "sha256:ebf34e96c5b8c472d3ca36ca33d7da898c22e40c0d4a00244de555456a478c60",
  "sha256:8c5b46a07415e559640185d9eee5b2e643cd6d24de9807cea1b6836fdc15fa44",
  "sha256:f961a38e05b37ef89e798a5194b93b7e573b3c21f1d44e987f1fdd84685104be",
  "sha256:3522d905634a0d55f613a74b296aa10a9009a49bdadea4be9642bdc432f4cad1",
] as const);

const successorManifest = Object.freeze({
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
    "sha256:cc57d08c4c4275eda385c9a1c25c151d18a424f1b7228c7ceda8799edc0ae5d7",
  roster_version: "fixture-roster_version",
  roster_content_hash:
    "sha256:00000000000000000000000000000000000000000000000000000000000000cf",
  source_register_version: "register-connected@1",
  source_register_artifact_hash:
    "sha256:00000000000000000000000000000000000000000000000000000000000dbba1",
  source_policy_version: "fixture-source_policy_version",
  parser_version: "fixture-parser_version",
  extraction_policy_version: null,
  admitted_run_plan_ceilings: Object.freeze({
    request_ceiling: 1,
    byte_ceiling: 1,
    ai_token_ceiling: 1,
    browser_millisecond_ceiling: 1,
    elapsed_millisecond_ceiling: 20_000,
    cost_microusd_ceiling: 1,
  }),
  source_owner_count: 1,
  source_owner_set_root:
    "sha256:71149ab1febe53fe5164c244f6334adce5410215b94570fd39270e1fad8ae6e0",
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
    "sha256:01fabddcc69c77f7c13c8d9b69113e55bb579d359e5b3fb3181fcafefdcf0185",
  source_count: 1,
  source_set_root:
    "sha256:5189f930d7e3df2b38e64538551591322eda095bc9497e793a2c1ccd2776a2fa",
} as const);

const roots = Object.freeze({
  adapter_manifest_set_root:
    "sha256:04edd19cdfc2d2e09bab2d83902d90582eb9758b10da090380a67f72d16c9d27",
  endpoint_set_root:
    "sha256:32c6665ee3b8f0e61feeedc785f33a5d99eaa95d931e377b228086fdf4b3f648",
  verifier_policy_set_root:
    "sha256:561a3d5ec4f4b4ecfe7aea46e837a792f9a9f53d8238b5e810e9732ea0a71672",
  field_policy_set_root:
    "sha256:920737072bc4329bfc0ee13a25f79bae548d058f9c7d27132d0ef7df2ddf2ad4",
} as const);

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
    if (codePoint === undefined) throw new Error("invalid cascade text");
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
const bytesHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const document = (() => {
  const candidate = JSON.parse(
    JSON.stringify(
      PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS.document,
    ),
  ) as ProvenanceV2RegistrationPlan;
  const receipt = candidate.adapter_receipts[0];
  if (receipt === undefined)
    throw new Error("connected cascade adapter receipt missing");
  receipt.successor_manifest = successorManifest;
  candidate.roots = roots;
  return deepFreeze(candidate);
})();
const canonicalJson = canonical(document);
const canonicalBytes = utf8(canonicalJson);
if (canonicalBytes.length !== 47_485)
  throw new Error("connected document cascade byte length drifted");

const chunks = Object.freeze(
  Array.from(
    { length: Math.ceil(canonicalBytes.length / 4_096) },
    (_, ordinal) => {
      const byteOffset = ordinal * 4_096;
      const bytes = canonicalBytes.slice(byteOffset, byteOffset + 4_096);
      const sha256 = CHUNK_HASHES[ordinal];
      if (sha256 === undefined)
        throw new Error("connected cascade chunk hash missing");
      return Object.freeze({
        ordinal,
        byte_offset: byteOffset,
        byte_length: bytes.length,
        bytes_hex: bytesHex(bytes),
        sha256,
      });
    },
  ),
);

const fieldByName = (
  rowId: string,
  fieldName: string,
): { readonly tag: string; readonly value: string | boolean | null } => {
  const row = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.find(
    (candidate) => candidate.row_id === rowId,
  );
  const field = row?.fields.find((candidate) => candidate.name === fieldName);
  if (field === undefined) throw new Error("connected cascade target missing");
  return field;
};

const graphOverlay = Object.freeze(
  PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS.occurrences.map(
    (occurrence) => {
      const before = fieldByName(occurrence.row_id, occurrence.field);
      const afterValue =
        occurrence.field === "successor_manifest_hash"
          ? SUCCESSOR_HASH
          : occurrence.computed_digest;
      return Object.freeze({
        row_id: occurrence.row_id,
        table: occurrence.table,
        field: occurrence.field,
        encoding: occurrence.encoding,
        preimage_kind: occurrence.preimage_kind,
        before: Object.freeze({ tag: before.tag, value: before.value }),
        after: Object.freeze({
          tag: afterValue === null ? "null" : "digest",
          value: afterValue,
        }),
      });
    },
  ),
);

const traversalValues = Object.freeze([
  [
    "source_owner_set_root",
    1,
    "sha256:5b679ce2f7c8bbda525fce799f97bb8c36bd392137cc132d838b1a1d5c66aba5",
    "sha256:71149ab1febe53fe5164c244f6334adce5410215b94570fd39270e1fad8ae6e0",
  ],
  [
    "source_register_member_set_root",
    1,
    "sha256:c9a8268279d1803de21957743d3782707248d04be710c6b65517047a8219f503",
    "sha256:42f00a7ebfcb485e23adfd593c30112c4b76563025edfab536dafa6e94757317",
  ],
  [
    "environment_set_root",
    1,
    "sha256:01ca48d8e0d2c6de68dd0a677274ed6813f14a65ca67296078b646af4e19734a",
    "sha256:75e45a2d14b93f86852b2523f71deda92e34dfc1af56bbfe9d76d31af8518d92",
  ],
  [
    "credential_set_root",
    11,
    "sha256:8e3da257c9270733ae8dbcac8a664331fb39cf02d7142c72cfad5156c321b40c",
    "sha256:01fabddcc69c77f7c13c8d9b69113e55bb579d359e5b3fb3181fcafefdcf0185",
  ],
  [
    "source_set_root",
    1,
    "sha256:a78f6998dd6dbe864cad00037c266a5a64da9330547c87848395bea7592b5404",
    "sha256:5189f930d7e3df2b38e64538551591322eda095bc9497e793a2c1ccd2776a2fa",
  ],
  [
    "adapter_manifest_set_root",
    17,
    "sha256:dbae30b7d12790e85a92f6abdd56bd7885f11154df4d903e73398b837df2dceb",
    roots.adapter_manifest_set_root,
  ],
  [
    "endpoint_set_root",
    73,
    "sha256:95f9ceaaabc42ce7f2544f92c4bcf6bd70594451c3ff0432c9342f55b2e1f79a",
    roots.endpoint_set_root,
  ],
  [
    "verifier_policy_set_root",
    3,
    "sha256:a91e72931ee66de861bdd4596b98431bb96f04ee5790be3b9dd8cc120d0c4cf5",
    roots.verifier_policy_set_root,
  ],
  [
    "field_policy_set_root",
    278,
    "sha256:340be7b0668f902d7cdf2dd444290545f6136f06c88f8de9d21cfaff1f16e9d6",
    roots.field_policy_set_root,
  ],
] as const);
const traversals = Object.freeze(
  traversalValues.map(([name, memberCount, rowManifest, digest]) =>
    Object.freeze({
      name,
      member_count: memberCount,
      ordered_row_id_manifest_sha256: rowManifest,
      collection_sha256: digest,
    }),
  ),
);

const authorityFields = Object.freeze(
  PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_authority_frame.fields.map(
    (field) => {
      const values: Record<string, string> = {
        contract_version: CANDIDATE_CONTRACT,
        semantic_policy_hash: document.semantic_policy_hash,
        canonical_document_hash: DOCUMENT_HASH,
        environment: "production",
        canonical_document_bytes: String(canonicalBytes.length),
        normalized_row_count: "371",
        run_plan_hash: document.run_plan_hash,
        ...roots,
      };
      const value = values[field.name] ?? field.value;
      const resolution =
        field.name === "canonical_document_hash" ||
        field.name === "canonical_document_bytes"
          ? "computed_document"
          : Object.hasOwn(roots, field.name)
            ? "computed_collection"
            : field.name === "normalized_row_count"
              ? "artifact_local_inventory_count"
              : field.name === "contract_version"
                ? "candidate_literal"
                : field.name === "closed_at_ms"
                  ? "synthetic_close_fixture"
                  : "synthetic_fixture_scalar";
      return Object.freeze({
        name: field.name,
        tag: field.tag,
        value,
        resolution,
      });
    },
  ),
);
const receiptFields = Object.freeze(
  PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_refused_receipt_frame.fields.map(
    (field) =>
      Object.freeze({
        name: field.name,
        tag: field.tag,
        value:
          field.name === "authority_root"
            ? "sha256:ed521c61b69ab3eb592a3f0113cb0153f205f394ebf912a7e5b3c5cbf594d04e"
            : field.name === "oracle_contract_version"
              ? CANDIDATE_CONTRACT
              : field.name === "semantic_policy_hash"
                ? document.semantic_policy_hash
                : field.value,
        resolution:
          field.name === "authority_root"
            ? "computed_frame"
            : field.name === "oracle_contract_version"
              ? "candidate_literal"
              : field.name === "oracle_implementation_hash"
                ? "synthetic_unresolved_anchor"
                : field.name === "verified_at_ms"
                  ? "synthetic_close_fixture"
                  : "synthetic_fixture_scalar",
      }),
  ),
);

const hash = () => Type.String({ pattern: SHA256 });
const frameResolution = Type.Union([
  Type.Literal("computed_document"),
  Type.Literal("computed_collection"),
  Type.Literal("computed_frame"),
  Type.Literal("artifact_local_inventory_count"),
  Type.Literal("candidate_literal"),
  Type.Literal("synthetic_close_fixture"),
  Type.Literal("synthetic_unresolved_anchor"),
  Type.Literal("synthetic_fixture_scalar"),
]);
const frameFields = Type.Array(
  Type.Union([
    Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 64 }),
        tag: Type.Literal("null"),
        value: Type.Null(),
        resolution: frameResolution,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 64 }),
        tag: Type.Literal("text"),
        value: Type.String({ maxLength: 512 }),
        resolution: frameResolution,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 64 }),
        tag: Type.Literal("integer"),
        value: Type.String({ pattern: "^(?:0|[1-9][0-9]{0,15})$" }),
        resolution: frameResolution,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 64 }),
        tag: Type.Literal("digest"),
        value: hash(),
        resolution: frameResolution,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: 64 }),
        tag: Type.Literal("boolean"),
        value: Type.Boolean(),
        resolution: frameResolution,
      },
      { additionalProperties: false },
    ),
  ]),
  { minItems: 1, maxItems: 32 },
);

export const ProvenanceV2ConnectedDocumentCascadeVectorsSchema = Type.Object(
  {
    contract_version: Type.Literal(
      "provenance-v2-connected-document-cascade-vectors@1",
    ),
    status: Type.Literal("review_candidate"),
    coverage: Type.Literal(
      "synthetic_document_digest_overlay_and_refused_cascade",
    ),
    authority_eligible: Type.Literal(false),
    outcome: Type.Literal("authority_refused"),
    persisted: Type.Literal(false),
    document_digest_overlay_executed: Type.Literal(true),
    successor_cascade_executed: Type.Literal(true),
    retained_resolver_executed: Type.Literal(false),
    semantic_oracle_executed: Type.Literal(false),
    source_contracts: Type.Object(
      {
        registration_plan: Type.Literal(document.contract_version),
        canonical_json: Type.Literal(document.canonical_json_version),
        root_registry: Type.Literal(
          PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.contract_version,
        ),
        root_binding_plan: Type.Literal(
          PROVENANCE_V2_ROOT_BINDING_PLAN.contract_version,
        ),
        connected_graph: Type.Literal(
          PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.contract_version,
        ),
        traversal_vectors: Type.Literal(
          PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.contract_version,
        ),
        successor_vectors: Type.Literal(
          PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.contract_version,
        ),
        registration_document_vectors: Type.Literal(
          PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS.contract_version,
        ),
        document_resolver: Type.Literal(
          PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT.contract_version,
        ),
      },
      { additionalProperties: false },
    ),
    evidence_counts: Type.Object(
      {
        graph_rows: Type.Literal(371),
        safe_preimage_occurrences: Type.Literal(31),
        digest_overlays: Type.Literal(30),
        absent_null_checks: Type.Literal(1),
        distinct_digest_values: Type.Literal(26),
        leaf_outputs: Type.Literal(371),
        traversal_projections: Type.Literal(386),
        traversals: Type.Literal(9),
        plan_roots: Type.Literal(4),
      },
      { additionalProperties: false },
    ),
    graph_overlay: Type.Array(
      Type.Union([
        Type.Object(
          {
            row_id: Type.String({ minLength: 1, maxLength: 160 }),
            table: Type.String({ pattern: "^provenance_v2_[a-z0-9_]+$" }),
            field: Type.String({ minLength: 1, maxLength: 64 }),
            encoding: Type.Union([
              Type.Literal("nfc_utf8"),
              Type.Literal("rfc8785_jcs"),
            ]),
            preimage_kind: Type.Literal("bytes"),
            before: Type.Object(
              { tag: Type.Literal("digest"), value: hash() },
              { additionalProperties: false },
            ),
            after: Type.Object(
              { tag: Type.Literal("digest"), value: hash() },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            row_id: Type.String({ minLength: 1, maxLength: 160 }),
            table: Type.String({ pattern: "^provenance_v2_[a-z0-9_]+$" }),
            field: Type.String({ minLength: 1, maxLength: 64 }),
            encoding: Type.Union([
              Type.Literal("nfc_utf8"),
              Type.Literal("rfc8785_jcs"),
            ]),
            preimage_kind: Type.Literal("absent"),
            before: Type.Object(
              { tag: Type.Literal("null"), value: Type.Null() },
              { additionalProperties: false },
            ),
            after: Type.Object(
              { tag: Type.Literal("null"), value: Type.Null() },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
      ]),
      { minItems: 31, maxItems: 31 },
    ),
    successor: Type.Object(
      {
        manifest: ProvenanceV2SuccessorManifestSchema,
        canonical_json: Type.String({ minLength: 1, maxLength: 4_096 }),
        utf8_byte_length: Type.Literal(2_008),
        sha256: Type.Literal(SUCCESSOR_HASH),
        adapter_receipt_leaf_sha256: Type.Literal(
          "sha256:87c86c0f32d8347c22026b24cbc58f50d27bf31a25c53c5db6ecf958d75451b8",
        ),
      },
      { additionalProperties: false },
    ),
    final_document: Type.Object(
      {
        document: ProvenanceV2RegistrationPlanSchema,
        canonical_json: Type.String({ minLength: 1, maxLength: 1_048_576 }),
        canonical_utf8_hex: Type.String({
          pattern: EVEN_HEX,
          maxLength: 2_097_152,
        }),
        utf8_byte_length: Type.Literal(47_485),
        sha256: Type.Literal(DOCUMENT_HASH),
      },
      { additionalProperties: false },
    ),
    chunks: Type.Array(
      Type.Object(
        {
          ordinal: Type.Integer({ minimum: 0, maximum: 11 }),
          byte_offset: Type.Integer({ minimum: 0, maximum: 47_484 }),
          byte_length: Type.Integer({ minimum: 1, maximum: 4_096 }),
          bytes_hex: Type.String({ pattern: EVEN_HEX, maxLength: 8_192 }),
          sha256: hash(),
        },
        { additionalProperties: false },
      ),
      { minItems: 12, maxItems: 12 },
    ),
    graph_outputs: Type.Object(
      {
        leaf_output_manifest_sha256: hash(),
        traversals: Type.Array(
          Type.Object(
            {
              name: Type.String({ minLength: 1, maxLength: 64 }),
              member_count: Type.Integer({ minimum: 0, maximum: 400 }),
              ordered_row_id_manifest_sha256: hash(),
              collection_sha256: hash(),
            },
            { additionalProperties: false },
          ),
          { minItems: 9, maxItems: 9 },
        ),
      },
      { additionalProperties: false },
    ),
    candidate_authority_frame: Type.Object(
      {
        fields: frameFields,
        frame_hex: Type.String({ pattern: EVEN_HEX, maxLength: 8_192 }),
        sha256: hash(),
      },
      { additionalProperties: false },
    ),
    candidate_refused_receipt_frame: Type.Object(
      {
        fields: frameFields,
        frame_hex: Type.String({ pattern: EVEN_HEX, maxLength: 4_096 }),
        sha256: hash(),
      },
      { additionalProperties: false },
    ),
    pending: Type.Object(
      {
        document_output_projection_and_semantic_parity: Type.Literal("pending"),
        normalized_row_inventory_semantics: Type.Literal("pending"),
        root_input_byte_accounting: Type.Literal("pending"),
        external_and_repository_anchor_resolvers: Type.Literal("pending"),
        repository_build_manifest: Type.Literal("pending"),
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
    $id: "ProvenanceV2ConnectedDocumentCascadeVectors",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

export const PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS = deepFreeze({
  contract_version: "provenance-v2-connected-document-cascade-vectors@1",
  status: "review_candidate",
  coverage: "synthetic_document_digest_overlay_and_refused_cascade",
  authority_eligible: false,
  outcome: "authority_refused",
  persisted: false,
  document_digest_overlay_executed: true,
  successor_cascade_executed: true,
  retained_resolver_executed: false,
  semantic_oracle_executed: false,
  source_contracts: {
    registration_plan: document.contract_version,
    canonical_json: document.canonical_json_version,
    root_registry: PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.contract_version,
    root_binding_plan: PROVENANCE_V2_ROOT_BINDING_PLAN.contract_version,
    connected_graph:
      PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.contract_version,
    traversal_vectors:
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.contract_version,
    successor_vectors:
      PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.contract_version,
    registration_document_vectors:
      PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS.contract_version,
    document_resolver:
      PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT.contract_version,
  },
  evidence_counts: {
    graph_rows: 371,
    safe_preimage_occurrences: 31,
    digest_overlays: 30,
    absent_null_checks: 1,
    distinct_digest_values: 26,
    leaf_outputs: 371,
    traversal_projections: 386,
    traversals: 9,
    plan_roots: 4,
  },
  graph_overlay: graphOverlay,
  successor: {
    manifest: successorManifest,
    canonical_json: canonical(successorManifest),
    utf8_byte_length: 2_008,
    sha256: SUCCESSOR_HASH,
    adapter_receipt_leaf_sha256:
      "sha256:87c86c0f32d8347c22026b24cbc58f50d27bf31a25c53c5db6ecf958d75451b8",
  },
  final_document: {
    document,
    canonical_json: canonicalJson,
    canonical_utf8_hex: bytesHex(canonicalBytes),
    utf8_byte_length: canonicalBytes.length,
    sha256: DOCUMENT_HASH,
  },
  chunks,
  graph_outputs: {
    leaf_output_manifest_sha256:
      "sha256:00257e2e320ae212f6039c95f9a7ddd561554b459b22c5e1e67545a21ed4ba4f",
    traversals,
  },
  candidate_authority_frame: {
    fields: authorityFields,
    frame_hex:
      "514350563201002470726f76656e616e63652d76322d617574686f726974792d726f6f742d6672616d6540310000001601000000000000003470726f76656e616e63652d76322d636f6e6e65637465642d646f63756d656e742d636173636164652d63616e646964617465403104000000000000002000000000000000000000000000000000000000000000000000000000000075300400000000000000201b101e77d9095fdd7728b078fff33a91ef76fbbf2a222a95b5c54af48056764f0100000000000000287076695f33333333333333332d333333332d343333332d383333332d33333333333333333333333301000000000000000a70726f64756374696f6e0100000000000000287670615f31313131313131312d313131312d343131312d383131312d31313131313131313131313101000000000000002872706c5f32323232323232322d323232322d343232322d383232322d323232323232323232323232040000000000000020000000000000000000000000000000000000000000000000000000000000753102000000000000000d3137383634303634303030303002000000000000000d3137383634393238303030303002000000000000000d31373836343036343030303030020000000000000005343734383502000000000000000333373102000000000000000d313738363430363430303030300200000000000000013104000000000000002004edd19cdfc2d2e09bab2d83902d90582eb9758b10da090380a67f72d16c9d270200000000000000013104000000000000002032c6665ee3b8f0e61feeedc785f33a5d99eaa95d931e377b228086fdf4b3f64802000000000000000131040000000000000020561a3d5ec4f4b4ecfe7aea46e837a792f9a9f53d8238b5e810e9732ea0a7167202000000000000000134040000000000000020920737072bc4329bfc0ee13a25f79bae548d058f9c7d27132d0ef7df2ddf2ad4",
    sha256:
      "sha256:ed521c61b69ab3eb592a3f0113cb0153f205f394ebf912a7e5b3c5cbf594d04e",
  },
  candidate_refused_receipt_frame: {
    fields: receiptFields,
    frame_hex:
      "514350563201001e70726f76656e616e63652d76322d6f7261636c652d726563656970744031000000060100000000000000287670615f31313131313131312d313131312d343131312d383131312d31313131313131313131313101000000000000003470726f76656e616e63652d76322d636f6e6e65637465642d646f63756d656e742d636173636164652d63616e646964617465403104000000000000002000000000000000000000000000000000000000000000000000000000000000000400000000000000200000000000000000000000000000000000000000000000000000000000007530040000000000000020ed521c61b69ab3eb592a3f0113cb0153f205f394ebf912a7e5b3c5cbf594d04e02000000000000000d31373836343036343030303030",
    sha256:
      "sha256:accf0cd74312ce2ebbcb1f3c135b0ea380a0bf3b0071804518c5b7a415ee86ee",
  },
  pending: {
    document_output_projection_and_semantic_parity: "pending",
    normalized_row_inventory_semantics: "pending",
    root_input_byte_accounting: "pending",
    external_and_repository_anchor_resolvers: "pending",
    repository_build_manifest: "pending",
    semantic_oracle: "pending",
    migration_schema_parity: "pending",
    frozen_d1_enumeration: "pending",
    accepted_aggregate_limits: "pending",
    protected_writers_and_activation: "pending",
  },
} as const);

const checkSchema = (
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
      8_000_000 - budget.stringBytes,
    );
    return budget.stringBytes <= 8_000_000 ? value : undefined;
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
  if (++budget.nodes > 120_000 || keys.length > 1_024) return undefined;
  budget.properties += keys.length;
  if (
    budget.properties > 300_000 ||
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
    const length = descriptors.length;
    if (
      prototype !== Array.prototype ||
      length === undefined ||
      !("value" in length) ||
      !Number.isSafeInteger(length.value) ||
      (length.value as number) < 0 ||
      (length.value as number) > 1_024 ||
      keys.length !== (length.value as number) + 1
    )
      return undefined;
    const copy: unknown[] = [];
    for (let index = 0; index < (length.value as number); index += 1) {
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
    budget.stringBytes += utf8LengthWithin(key, 8_000_000 - budget.stringBytes);
    if (budget.stringBytes > 8_000_000) return undefined;
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const child = snapshotPlainData(descriptor.value, seen, budget, depth + 1);
    if (child === undefined) return undefined;
    copy[key] = child;
  }
  seen.delete(value);
  return copy;
};

export const validateProvenanceV2ConnectedDocumentCascadeVectors = (
  value: unknown = PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS,
): string[] => {
  const snapshot = snapshotPlainData(value);
  if (!checkSchema(ProvenanceV2ConnectedDocumentCascadeVectorsSchema, snapshot))
    return [
      "connected document cascade vectors do not match the closed schema",
    ];
  if (
    JSON.stringify(snapshot) !==
    JSON.stringify(PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS)
  )
    return [
      "connected document cascade vectors must equal the reviewed singleton",
    ];
  return [];
};
