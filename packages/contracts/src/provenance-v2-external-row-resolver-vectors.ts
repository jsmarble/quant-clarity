import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS } from "./provenance-v2-connected-document-cascade-vectors.js";
import { PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH } from "./provenance-v2-connected-registration-graph.js";
import { PROVENANCE_V2_ROOT_BINDING_PLAN } from "./provenance-v2-root-binding-plan.js";

const REVIEW_CANDIDATE_SCHEMA = {
  "x-quantclarity-contract-status": "review_candidate",
} as const;
const SHA256 = "^sha256:[0-9a-f]{64}$";

type Scalar = string | number | boolean | null;
type TaggedField = Readonly<{
  name: string;
  tag: "text" | "integer" | "boolean" | "digest" | "null";
  value: Scalar;
}>;
type WitnessRow = Readonly<{
  witness_id: string;
  table: string;
  fields: readonly TaggedField[];
}>;
type ExternalRowBinding = Readonly<{
  kind: "external_row_digest";
  table: string;
  digest_column: string;
  joins: readonly Readonly<{
    local_column: string;
    remote_column: string;
  }>[];
  required_predicates: readonly Readonly<{
    column: string;
    value: string | number | boolean;
  }>[];
  cardinality: "exactly_one";
}>;
type ExternalBindingEntry = Readonly<{
  table: string;
  field: string;
  binding: ExternalRowBinding;
}>;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value))
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
};

const graphField = (rowId: string, fieldName: string): Scalar => {
  const row = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.find(
    (candidate) => candidate.row_id === rowId,
  );
  const field = row?.fields.find((candidate) => candidate.name === fieldName);
  if (field === undefined)
    throw new Error("external-row fixture field missing");
  return field.value;
};

const tagged = (
  name: string,
  tag: TaggedField["tag"],
  value: Scalar,
): TaggedField => Object.freeze({ name, tag, value });

const witnessRows = deepFreeze([
  {
    witness_id: "witness-source-compliance-record",
    table: "source_compliance_record",
    fields: [
      tagged(
        "provider_id",
        "text",
        graphField("row-source_register_receipt-receipt", "provider_id"),
      ),
      tagged(
        "register_version",
        "text",
        graphField("row-source_register_receipt-receipt", "register_version"),
      ),
      tagged(
        "artifact_hash",
        "digest",
        graphField("row-source_register_receipt-receipt", "artifact_hash"),
      ),
      tagged("approval_state", "text", "approved"),
      tagged("access_permitted", "integer", 1),
      tagged("retention_permitted", "integer", 1),
      tagged("publication_permitted", "integer", 1),
    ],
  },
  {
    witness_id: "witness-publication-run-plan-provider",
    table: "publication_run_plan_provider",
    fields: [
      tagged(
        "run_plan_id",
        "text",
        graphField("row-adapter_manifest_receipt-receipt", "run_plan_id"),
      ),
      tagged(
        "provider_id",
        "text",
        graphField("row-adapter_manifest_receipt-receipt", "provider_id"),
      ),
      tagged(
        "roster_content_hash",
        "digest",
        graphField(
          "row-adapter_manifest_receipt-receipt",
          "roster_content_hash",
        ),
      ),
    ],
  },
  {
    witness_id: "witness-publication-run-plan-seal",
    table: "publication_run_plan_seal",
    fields: [
      tagged(
        "run_plan_id",
        "text",
        PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.final_document.document
          .run_plan_id,
      ),
      tagged(
        "plan_hash",
        "digest",
        PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.final_document.document
          .run_plan_hash,
      ),
    ],
  },
] as const satisfies readonly WitnessRow[]);

const authorityPlanSource = deepFreeze({
  row_id: "candidate-authority-plan-frame-source",
  table: "provenance_v2_authority_plan",
  fields: [
    tagged(
      "authority_plan_id",
      "text",
      PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.final_document.document
        .authority_plan_id,
    ),
    tagged(
      "run_plan_id",
      "text",
      PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.final_document.document
        .run_plan_id,
    ),
    tagged(
      "run_plan_hash",
      "digest",
      PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.final_document.document
        .run_plan_hash,
    ),
  ],
} as const);

const fieldValue = (
  row: {
    readonly fields: readonly {
      readonly name: string;
      readonly value: Scalar;
    }[];
  },
  name: string,
): Scalar => {
  const field = row.fields.find((candidate) => candidate.name === name);
  if (field === undefined)
    throw new Error("external-row resolver field missing");
  return field.value;
};

const isExternalBindingEntry = (
  entry: (typeof PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings)[number],
): entry is typeof entry & ExternalBindingEntry => {
  const binding = entry.binding;
  return (
    typeof binding === "object" &&
    binding !== null &&
    "kind" in binding &&
    binding.kind === "external_row_digest"
  );
};

const externalBindings = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(
  isExternalBindingEntry,
);

const bindingInventory = deepFreeze(
  externalBindings.map((entry) => {
    return {
      source_table: entry.table,
      source_field: entry.field,
      target_table: entry.binding.table,
      target_digest_column: entry.binding.digest_column,
      joins: entry.binding.joins,
      required_predicates: entry.binding.required_predicates,
      cardinality: entry.binding.cardinality,
    };
  }),
);

const graphSources = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows;
const resolutionSources = [...graphSources, authorityPlanSource] as readonly {
  readonly row_id: string;
  readonly table: string;
  readonly fields: readonly { readonly name: string; readonly value: Scalar }[];
}[];

const resolutions = deepFreeze(
  externalBindings.flatMap((entry) => {
    return resolutionSources
      .filter(
        (row) =>
          row.table === entry.table &&
          row.fields.some((field) => field.name === entry.field),
      )
      .map((source) => {
        const matches = witnessRows.filter(
          (witness) =>
            witness.table === entry.binding.table &&
            entry.binding.joins.every(
              (join) =>
                fieldValue(source, join.local_column) ===
                fieldValue(witness, join.remote_column),
            ) &&
            entry.binding.required_predicates.every(
              (predicate) =>
                fieldValue(witness, predicate.column) === predicate.value,
            ),
        );
        if (matches.length !== 1)
          throw new Error("external-row witness cardinality mismatch");
        const witness = matches[0];
        if (witness === undefined)
          throw new Error(
            "external-row witness missing after cardinality check",
          );
        const storedDigest = fieldValue(source, entry.field);
        const resolvedDigest = fieldValue(witness, entry.binding.digest_column);
        if (
          typeof storedDigest !== "string" ||
          typeof resolvedDigest !== "string" ||
          storedDigest !== resolvedDigest
        )
          throw new Error("external-row digest parity mismatch");
        return {
          source_row_id: source.row_id,
          source_table: source.table,
          source_field: entry.field,
          witness_id: witness.witness_id,
          target_table: witness.table,
          target_digest_column: entry.binding.digest_column,
          join_evidence: entry.binding.joins.map((join) => ({
            local_column: join.local_column,
            remote_column: join.remote_column,
            local_value: fieldValue(source, join.local_column),
            remote_value: fieldValue(witness, join.remote_column),
            equal: true as const,
          })),
          predicate_evidence: entry.binding.required_predicates.map(
            (predicate) => ({
              column: predicate.column,
              required_value: predicate.value,
              witness_value: fieldValue(witness, predicate.column),
              equal: true as const,
            }),
          ),
          cardinality: "exactly_one" as const,
          match_count: 1 as const,
          resolved_digest: resolvedDigest,
          stored_digest: storedDigest,
          digest_equal: true as const,
        };
      });
  }),
);

const hash = () => Type.String({ pattern: SHA256 });
const scalar = () =>
  Type.Union([
    Type.String({ maxLength: 256 }),
    Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    Type.Boolean(),
    Type.Null(),
  ]);
const fieldSchema = Type.Union([
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 64 }),
      tag: Type.Literal("text"),
      value: Type.String({ maxLength: 256 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 64 }),
      tag: Type.Literal("integer"),
      value: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
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
      value: hash(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 64 }),
      tag: Type.Literal("null"),
      value: Type.Null(),
    },
    { additionalProperties: false },
  ),
]);

export const ProvenanceV2ExternalRowResolverVectorsSchema = Type.Object(
  {
    contract_version: Type.Literal(
      "provenance-v2-external-row-resolver-vectors@1",
    ),
    status: Type.Literal("review_candidate"),
    coverage: Type.Literal(
      "synthetic_external_row_join_predicate_cardinality_and_digest_parity",
    ),
    authority_eligible: Type.Literal(false),
    outcome: Type.Literal("authority_refused"),
    persisted: Type.Literal(false),
    d1_read_executed: Type.Literal(false),
    synthetic_external_row_resolver_executed: Type.Literal(true),
    repository_artifact_resolver_executed: Type.Literal(false),
    semantic_oracle_executed: Type.Literal(false),
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
      },
      { additionalProperties: false },
    ),
    predecessor_schema_sources: Type.Object(
      {
        source_compliance_record: Type.Literal(
          "migrations/canonical/0002_provenance_facts_and_control.sql",
        ),
        run_plan_provider_and_seal: Type.Literal(
          "migrations/canonical/0005_publication_run_plan_authority.sql",
        ),
      },
      { additionalProperties: false },
    ),
    evidence_counts: Type.Object(
      {
        binding_definitions: Type.Literal(7),
        graph_occurrences: Type.Literal(6),
        synthetic_authority_frame_occurrences: Type.Literal(1),
        total_resolutions: Type.Literal(7),
        witness_rows: Type.Literal(3),
        predicate_columns: Type.Literal(4),
        predicate_evaluations: Type.Literal(20),
      },
      { additionalProperties: false },
    ),
    binding_inventory: Type.Array(
      Type.Object(
        {
          source_table: Type.String({ minLength: 1, maxLength: 96 }),
          source_field: Type.String({ minLength: 1, maxLength: 64 }),
          target_table: Type.String({ minLength: 1, maxLength: 96 }),
          target_digest_column: Type.String({ minLength: 1, maxLength: 64 }),
          joins: Type.Array(
            Type.Object(
              {
                local_column: Type.String({ minLength: 1, maxLength: 64 }),
                remote_column: Type.String({ minLength: 1, maxLength: 64 }),
              },
              { additionalProperties: false },
            ),
            { minItems: 1, maxItems: 2 },
          ),
          required_predicates: Type.Array(
            Type.Object(
              {
                column: Type.String({ minLength: 1, maxLength: 64 }),
                value: scalar(),
              },
              { additionalProperties: false },
            ),
            { maxItems: 4 },
          ),
          cardinality: Type.Literal("exactly_one"),
        },
        { additionalProperties: false },
      ),
      { minItems: 7, maxItems: 7 },
    ),
    witness_rows: Type.Array(
      Type.Object(
        {
          witness_id: Type.String({ minLength: 1, maxLength: 96 }),
          table: Type.Union([
            Type.Literal("source_compliance_record"),
            Type.Literal("publication_run_plan_provider"),
            Type.Literal("publication_run_plan_seal"),
          ]),
          fields: Type.Array(fieldSchema, { minItems: 2, maxItems: 7 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 3, maxItems: 3 },
    ),
    resolutions: Type.Array(
      Type.Object(
        {
          source_row_id: Type.String({ minLength: 1, maxLength: 160 }),
          source_table: Type.String({ minLength: 1, maxLength: 96 }),
          source_field: Type.String({ minLength: 1, maxLength: 64 }),
          witness_id: Type.String({ minLength: 1, maxLength: 96 }),
          target_table: Type.String({ minLength: 1, maxLength: 96 }),
          target_digest_column: Type.String({ minLength: 1, maxLength: 64 }),
          join_evidence: Type.Array(
            Type.Object(
              {
                local_column: Type.String({ minLength: 1, maxLength: 64 }),
                remote_column: Type.String({ minLength: 1, maxLength: 64 }),
                local_value: scalar(),
                remote_value: scalar(),
                equal: Type.Literal(true),
              },
              { additionalProperties: false },
            ),
            { minItems: 1, maxItems: 2 },
          ),
          predicate_evidence: Type.Array(
            Type.Object(
              {
                column: Type.String({ minLength: 1, maxLength: 64 }),
                required_value: scalar(),
                witness_value: scalar(),
                equal: Type.Literal(true),
              },
              { additionalProperties: false },
            ),
            { maxItems: 4 },
          ),
          cardinality: Type.Literal("exactly_one"),
          match_count: Type.Literal(1),
          resolved_digest: hash(),
          stored_digest: hash(),
          digest_equal: Type.Literal(true),
        },
        { additionalProperties: false },
      ),
      { minItems: 7, maxItems: 7 },
    ),
    authority_boundary: Type.Object(
      {
        predecessor_witness_authority: Type.Literal(
          "synthetic_fixture_only_not_approved_d1_state",
        ),
        stored_digest_role: Type.Literal("comparison_claim_only"),
        resolver_result_role: Type.Literal("review_evidence_only"),
      },
      { additionalProperties: false },
    ),
    pending: Type.Object(
      {
        repository_artifact_resolvers: Type.Literal("pending"),
        reviewed_repository_build_manifest: Type.Literal("pending"),
        remote_or_persisted_predecessor_rows: Type.Literal("pending"),
        predecessor_approval_and_revocation_semantics: Type.Literal("pending"),
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
    $id: "ProvenanceV2ExternalRowResolverVectors",
    additionalProperties: false,
    ...REVIEW_CANDIDATE_SCHEMA,
  },
);

export const PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS = deepFreeze({
  contract_version: "provenance-v2-external-row-resolver-vectors@1",
  status: "review_candidate",
  coverage:
    "synthetic_external_row_join_predicate_cardinality_and_digest_parity",
  authority_eligible: false,
  outcome: "authority_refused",
  persisted: false,
  d1_read_executed: false,
  synthetic_external_row_resolver_executed: true,
  repository_artifact_resolver_executed: false,
  semantic_oracle_executed: false,
  source_contracts: {
    root_binding_plan: PROVENANCE_V2_ROOT_BINDING_PLAN.contract_version,
    connected_graph:
      PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.contract_version,
    document_cascade:
      PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.contract_version,
  },
  predecessor_schema_sources: {
    source_compliance_record:
      "migrations/canonical/0002_provenance_facts_and_control.sql",
    run_plan_provider_and_seal:
      "migrations/canonical/0005_publication_run_plan_authority.sql",
  },
  evidence_counts: {
    binding_definitions: 7,
    graph_occurrences: 6,
    synthetic_authority_frame_occurrences: 1,
    total_resolutions: 7,
    witness_rows: 3,
    predicate_columns: 4,
    predicate_evaluations: 20,
  },
  binding_inventory: bindingInventory,
  witness_rows: witnessRows,
  resolutions,
  authority_boundary: {
    predecessor_witness_authority:
      "synthetic_fixture_only_not_approved_d1_state",
    stored_digest_role: "comparison_claim_only",
    resolver_result_role: "review_evidence_only",
  },
  pending: {
    repository_artifact_resolvers: "pending",
    reviewed_repository_build_manifest: "pending",
    remote_or_persisted_predecessor_rows: "pending",
    predecessor_approval_and_revocation_semantics: "pending",
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
    budget.stringBytes += utf8LengthWithin(value, 250_000 - budget.stringBytes);
    return budget.stringBytes <= 250_000 ? value : undefined;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isSafeInteger(value) && !Object.is(value, -0)
      ? value
      : undefined;
  if (typeof value !== "object" || depth > 32 || seen.has(value))
    return undefined;
  let prototype: object | null;
  let keys: readonly (string | symbol)[];
  try {
    prototype = Reflect.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    return undefined;
  }
  if (++budget.nodes > 10_000 || keys.length > 256) return undefined;
  budget.properties += keys.length;
  if (budget.properties > 40_000 || keys.some((key) => typeof key === "symbol"))
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
      (length.value as number) > 256 ||
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
    budget.stringBytes += utf8LengthWithin(key, 250_000 - budget.stringBytes);
    if (budget.stringBytes > 250_000) return undefined;
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    const child = snapshotPlainData(descriptor.value, seen, budget, depth + 1);
    if (child === undefined) return undefined;
    Object.defineProperty(copy, key, {
      value: child,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  seen.delete(value);
  return copy;
};

export const validateProvenanceV2ExternalRowResolverVectors = (
  value: unknown = PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS,
): string[] => {
  const snapshot = snapshotPlainData(value);
  if (!Value.Check(ProvenanceV2ExternalRowResolverVectorsSchema, snapshot))
    return ["external-row resolver vectors do not match the closed schema"];
  if (
    JSON.stringify(snapshot) !==
    JSON.stringify(PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS)
  )
    return ["external-row resolver vectors must equal the reviewed singleton"];
  return [];
};
