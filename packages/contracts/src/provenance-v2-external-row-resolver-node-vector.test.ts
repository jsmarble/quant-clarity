import { describe, expect, it } from "vitest";

import { PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS } from "./provenance-v2-connected-document-cascade-vectors.js";
import { PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH } from "./provenance-v2-connected-registration-graph.js";
import { PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS } from "./provenance-v2-external-row-resolver-vectors.js";
import { PROVENANCE_V2_ROOT_BINDING_PLAN } from "./provenance-v2-root-binding-plan.js";

type Scalar = string | number | boolean | null;
interface Field {
  name: string;
  tag: string;
  value: Scalar;
}
interface Row {
  row_id: string;
  table: string;
  fields: Field[];
}
interface Witness {
  witness_id: string;
  table: string;
  fields: Field[];
}
interface ExternalBinding {
  kind: "external_row_digest";
  table: string;
  digest_column: string;
  joins: { local_column: string; remote_column: string }[];
  required_predicates: {
    column: string;
    value: string | number | boolean;
  }[];
  cardinality: "exactly_one";
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const sourceRowIds = [
  "row-source_register_receipt-receipt",
  "row-source_register_member-member",
  "row-adapter_manifest_receipt-receipt",
  "row-source_endpoint-endpoint",
  "row-source_endpoint_registration-registration",
] as const;

const graphRows = sourceRowIds.map((rowId) => {
  const row = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.find(
    (candidate) => candidate.row_id === rowId,
  );
  if (row === undefined) throw new Error("missing reviewed source row");
  return structuredClone(row) as Row;
});

const authorityRow: Row = {
  row_id: "candidate-authority-plan-frame-source",
  table: "provenance_v2_authority_plan",
  fields: [
    {
      name: "authority_plan_id",
      tag: "text",
      value:
        PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.final_document.document
          .authority_plan_id,
    },
    {
      name: "run_plan_id",
      tag: "text",
      value:
        PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.final_document.document
          .run_plan_id,
    },
    {
      name: "run_plan_hash",
      tag: "digest",
      value:
        "sha256:0000000000000000000000000000000000000000000000000000000000007531",
    },
  ],
};

const canonicalSources: Row[] = [...graphRows, authorityRow];
const canonicalWitnesses: Witness[] = [
  {
    witness_id: "witness-source-compliance-record",
    table: "source_compliance_record",
    fields: [
      {
        name: "provider_id",
        tag: "text",
        value: "prv_44444444-4444-4444-8444-444444444444",
      },
      {
        name: "register_version",
        tag: "text",
        value: "register-connected@1",
      },
      {
        name: "artifact_hash",
        tag: "digest",
        value:
          "sha256:00000000000000000000000000000000000000000000000000000000000dbba1",
      },
      { name: "approval_state", tag: "text", value: "approved" },
      { name: "access_permitted", tag: "integer", value: 1 },
      { name: "retention_permitted", tag: "integer", value: 1 },
      { name: "publication_permitted", tag: "integer", value: 1 },
    ],
  },
  {
    witness_id: "witness-publication-run-plan-provider",
    table: "publication_run_plan_provider",
    fields: [
      {
        name: "run_plan_id",
        tag: "text",
        value: "rpl_22222222-2222-4222-8222-222222222222",
      },
      {
        name: "provider_id",
        tag: "text",
        value: "prv_44444444-4444-4444-8444-444444444444",
      },
      {
        name: "roster_content_hash",
        tag: "digest",
        value:
          "sha256:00000000000000000000000000000000000000000000000000000000000000cf",
      },
    ],
  },
  {
    witness_id: "witness-publication-run-plan-seal",
    table: "publication_run_plan_seal",
    fields: [
      {
        name: "run_plan_id",
        tag: "text",
        value: "rpl_22222222-2222-4222-8222-222222222222",
      },
      {
        name: "plan_hash",
        tag: "digest",
        value:
          "sha256:0000000000000000000000000000000000000000000000000000000000007531",
      },
    ],
  },
];

const externalBindings = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings
  .filter(
    (entry) =>
      typeof entry.binding === "object" &&
      entry.binding !== null &&
      "kind" in entry.binding &&
      entry.binding.kind === "external_row_digest",
  )
  .map((entry) => ({
    table: entry.table,
    field: entry.field,
    binding: entry.binding as ExternalBinding,
  }));

const read = (
  row: Row | Witness,
  name: string,
  expectedTag: string,
): Scalar => {
  const matches = row.fields.filter((field) => field.name === name);
  if (matches.length !== 1 || matches[0]!.tag !== expectedTag)
    throw new Error("typed_field_mismatch");
  return matches[0]!.value;
};

const execute = (sources: Row[], witnesses: Witness[]) => {
  const canonicalIdentity = canonicalSources.map((row) => [
    row.row_id,
    row.table,
  ]);
  const inputIdentity = sources.map((row) => [row.row_id, row.table]);
  if (
    sources.length !== canonicalSources.length ||
    new Set(sources.map((row) => row.row_id)).size !== sources.length ||
    JSON.stringify([...inputIdentity].sort()) !==
      JSON.stringify([...canonicalIdentity].sort())
  )
    throw new Error("source_inventory_mismatch");
  const canonicalByIdentity = new Map(
    canonicalSources.map((row) => [`${row.table}\u0000${row.row_id}`, row]),
  );
  if (
    sources.some((row) => {
      const canonical = canonicalByIdentity.get(
        `${row.table}\u0000${row.row_id}`,
      );
      return (
        canonical === undefined ||
        JSON.stringify(row) !== JSON.stringify(canonical)
      );
    })
  )
    throw new Error("source_content_mismatch");
  if (
    witnesses.length !== canonicalWitnesses.length ||
    new Set(witnesses.map((row) => row.witness_id)).size !== witnesses.length
  )
    throw new Error("witness_inventory_mismatch");

  const results = externalBindings.flatMap((entry) => {
    const applicable = sources.filter(
      (row) =>
        row.table === entry.table &&
        row.fields.some((field) => field.name === entry.field),
    );
    return applicable.map((source) => {
      const storedDigest = read(source, entry.field, "digest");
      if (typeof storedDigest !== "string" || !SHA256.test(storedDigest))
        throw new Error("stored_digest_invalid");
      const matches = witnesses.filter((witness) => {
        if (witness.table !== entry.binding.table) return false;
        const joinsMatch = entry.binding.joins.every((join) => {
          const local = read(source, join.local_column, "text");
          const remote = read(witness, join.remote_column, "text");
          return typeof local === typeof remote && local === remote;
        });
        const predicatesMatch = entry.binding.required_predicates.every(
          (predicate) => {
            const tag =
              typeof predicate.value === "number"
                ? "integer"
                : typeof predicate.value === "boolean"
                  ? "boolean"
                  : "text";
            const actual = read(witness, predicate.column, tag);
            return (
              typeof actual === typeof predicate.value &&
              actual === predicate.value
            );
          },
        );
        return joinsMatch && predicatesMatch;
      });
      if (matches.length !== 1) throw new Error("witness_cardinality_mismatch");
      const witness = matches[0]!;
      const resolvedDigest = read(
        witness,
        entry.binding.digest_column,
        "digest",
      );
      if (
        typeof resolvedDigest !== "string" ||
        !SHA256.test(resolvedDigest) ||
        resolvedDigest !== storedDigest
      )
        throw new Error("digest_parity_mismatch");
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
          local_value: read(source, join.local_column, "text"),
          remote_value: read(witness, join.remote_column, "text"),
          equal: true,
        })),
        predicate_evidence: entry.binding.required_predicates.map(
          (predicate) => {
            const tag =
              typeof predicate.value === "number"
                ? "integer"
                : typeof predicate.value === "boolean"
                  ? "boolean"
                  : "text";
            return {
              column: predicate.column,
              required_value: predicate.value,
              witness_value: read(witness, predicate.column, tag),
              equal: true,
            };
          },
        ),
        cardinality: "exactly_one",
        match_count: 1,
        resolved_digest: resolvedDigest,
        stored_digest: storedDigest,
        digest_equal: true,
      };
    });
  });
  if (results.length !== 7) throw new Error("resolution_count_mismatch");
  return results;
};

describe("provenance-v2 external-row resolver independent Node vector", () => {
  it("executes all seven exact join, predicate, cardinality, and digest checks", () => {
    expect(canonicalWitnesses).toEqual(
      PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS.witness_rows,
    );
    expect(execute(canonicalSources, canonicalWitnesses)).toEqual(
      PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS.resolutions,
    );
    expect(
      execute(
        [...canonicalSources].reverse(),
        [...canonicalWitnesses].reverse(),
      ),
    ).toEqual(PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS.resolutions);
  });

  it("rejects missing, duplicate, shadowed, and mistyped inputs", () => {
    expect(() =>
      execute(canonicalSources.slice(1), canonicalWitnesses),
    ).toThrow("source_inventory_mismatch");
    expect(() =>
      execute(
        [...canonicalSources, structuredClone(canonicalSources[0]!)],
        canonicalWitnesses,
      ),
    ).toThrow("source_inventory_mismatch");
    expect(() =>
      execute(canonicalSources, canonicalWitnesses.slice(1)),
    ).toThrow("witness_inventory_mismatch");
    expect(() =>
      execute(canonicalSources, [
        ...canonicalWitnesses,
        structuredClone(canonicalWitnesses[0]!),
      ]),
    ).toThrow("witness_inventory_mismatch");

    const mistyped = structuredClone(canonicalSources);
    mistyped[0]!.fields.find((field) => field.name === "artifact_hash")!.tag =
      "text";
    expect(() => execute(mistyped, canonicalWitnesses)).toThrow(
      "source_content_mismatch",
    );

    const mistypedWitness = structuredClone(canonicalWitnesses);
    mistypedWitness[0]!.fields.find(
      (field) => field.name === "approval_state",
    )!.tag = "digest";
    expect(() => execute(canonicalSources, mistypedWitness)).toThrow(
      "typed_field_mismatch",
    );
  });

  it("rejects every required predicate, join, and digest mismatch", () => {
    for (const fieldName of [
      "approval_state",
      "access_permitted",
      "retention_permitted",
      "publication_permitted",
    ]) {
      const changed = structuredClone(canonicalWitnesses);
      const field = changed[0]!.fields.find(
        (candidate) => candidate.name === fieldName,
      )!;
      field.value = typeof field.value === "number" ? 0 : "rejected";
      expect(() => execute(canonicalSources, changed)).toThrow(
        "witness_cardinality_mismatch",
      );
    }

    const wrongJoin = structuredClone(canonicalWitnesses);
    wrongJoin[0]!.fields.find(
      (field) => field.name === "register_version",
    )!.value = "register-wrong@1";
    expect(() => execute(canonicalSources, wrongJoin)).toThrow(
      "witness_cardinality_mismatch",
    );

    const wrongDigest = structuredClone(canonicalWitnesses);
    wrongDigest[1]!.fields.find(
      (field) => field.name === "roster_content_hash",
    )!.value =
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    expect(() => execute(canonicalSources, wrongDigest)).toThrow(
      "digest_parity_mismatch",
    );
  });
});
