import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS,
  PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH,
  PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
} from "@quant-clarity/contracts";

type Atom = string | number | boolean | null;
interface TestField {
  name: string;
  tag: string;
  value: Atom;
}
interface TestRow {
  row_id: string;
  table: string;
  fields: TestField[];
}
interface TestWitness {
  witness_id: string;
  table: string;
  fields: TestField[];
}
interface ExternalProgram {
  kind: "external_row_digest";
  table: string;
  digest_column: string;
  joins: { local_column: string; remote_column: string }[];
  required_predicates: {
    column: string;
    value: string | number | boolean;
  }[];
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const selectedIds = [
  "row-source_register_receipt-receipt",
  "row-source_register_member-member",
  "row-adapter_manifest_receipt-receipt",
  "row-source_endpoint-endpoint",
  "row-source_endpoint_registration-registration",
] as const;

const selectedRows = selectedIds.map((rowId) => {
  const row = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.find(
    (candidate) => candidate.row_id === rowId,
  );
  if (row === undefined) throw new Error("fixture_source_missing");
  return structuredClone(row) as TestRow;
});
selectedRows.push({
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
});

const predecessorRows: TestWitness[] = [
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

const programs = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings
  .filter(
    (entry) =>
      typeof entry.binding === "object" &&
      entry.binding !== null &&
      "kind" in entry.binding &&
      entry.binding.kind === "external_row_digest",
  )
  .map((entry) => ({
    sourceTable: entry.table,
    sourceField: entry.field,
    program: entry.binding as ExternalProgram,
  }));

const ownTypedValue = (
  row: TestRow | TestWitness,
  name: string,
  tag: string,
): Atom => {
  const fields = row.fields.filter((field) => field.name === name);
  if (fields.length !== 1 || fields[0]!.tag !== tag)
    throw new Error("typed_field_mismatch");
  return fields[0]!.value;
};

const runWorkerdResolver = (rows: TestRow[], witnesses: TestWitness[]) => {
  const expectedIdentities = selectedRows
    .map((row) => `${row.table}\u0000${row.row_id}`)
    .sort();
  const actualIdentities = rows
    .map((row) => `${row.table}\u0000${row.row_id}`)
    .sort();
  if (
    rows.length !== selectedRows.length ||
    new Set(actualIdentities).size !== actualIdentities.length ||
    JSON.stringify(actualIdentities) !== JSON.stringify(expectedIdentities)
  )
    throw new Error("source_inventory_mismatch");
  const expectedByIdentity = new Map(
    selectedRows.map((row) => [`${row.table}\u0000${row.row_id}`, row]),
  );
  if (
    rows.some((row) => {
      const expected = expectedByIdentity.get(
        `${row.table}\u0000${row.row_id}`,
      );
      return (
        expected === undefined ||
        JSON.stringify(row) !== JSON.stringify(expected)
      );
    })
  )
    throw new Error("source_content_mismatch");
  if (
    witnesses.length !== predecessorRows.length ||
    new Set(witnesses.map((row) => row.witness_id)).size !== witnesses.length
  )
    throw new Error("witness_inventory_mismatch");

  const output = programs.flatMap(({ sourceTable, sourceField, program }) =>
    rows
      .filter(
        (row) =>
          row.table === sourceTable &&
          row.fields.some((field) => field.name === sourceField),
      )
      .map((row) => {
        const stored = ownTypedValue(row, sourceField, "digest");
        if (typeof stored !== "string" || !digestPattern.test(stored))
          throw new Error("stored_digest_invalid");
        const matches = witnesses.filter((witness) => {
          if (witness.table !== program.table) return false;
          for (const join of program.joins) {
            const left = ownTypedValue(row, join.local_column, "text");
            const right = ownTypedValue(witness, join.remote_column, "text");
            if (typeof left !== typeof right || left !== right) return false;
          }
          for (const predicate of program.required_predicates) {
            const tag =
              typeof predicate.value === "number"
                ? "integer"
                : typeof predicate.value === "boolean"
                  ? "boolean"
                  : "text";
            const value = ownTypedValue(witness, predicate.column, tag);
            if (
              typeof value !== typeof predicate.value ||
              value !== predicate.value
            )
              return false;
          }
          return true;
        });
        if (matches.length !== 1)
          throw new Error("witness_cardinality_mismatch");
        const witness = matches[0]!;
        const resolved = ownTypedValue(
          witness,
          program.digest_column,
          "digest",
        );
        if (
          typeof resolved !== "string" ||
          !digestPattern.test(resolved) ||
          resolved !== stored
        )
          throw new Error("digest_parity_mismatch");
        return {
          source_row_id: row.row_id,
          source_table: row.table,
          source_field: sourceField,
          witness_id: witness.witness_id,
          target_table: witness.table,
          target_digest_column: program.digest_column,
          join_evidence: program.joins.map((join) => ({
            local_column: join.local_column,
            remote_column: join.remote_column,
            local_value: ownTypedValue(row, join.local_column, "text"),
            remote_value: ownTypedValue(witness, join.remote_column, "text"),
            equal: true,
          })),
          predicate_evidence: program.required_predicates.map((predicate) => {
            const tag =
              typeof predicate.value === "number"
                ? "integer"
                : typeof predicate.value === "boolean"
                  ? "boolean"
                  : "text";
            return {
              column: predicate.column,
              required_value: predicate.value,
              witness_value: ownTypedValue(witness, predicate.column, tag),
              equal: true,
            };
          }),
          cardinality: "exactly_one",
          match_count: 1,
          resolved_digest: resolved,
          stored_digest: stored,
          digest_equal: true,
        };
      }),
  );
  if (output.length !== 7) throw new Error("resolution_count_mismatch");
  return output;
};

describe("provenance-v2 external-row resolver workerd vector", () => {
  it("independently executes every reviewed external-row binding", () => {
    expect(predecessorRows).toEqual(
      PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS.witness_rows,
    );
    expect(runWorkerdResolver(selectedRows, predecessorRows)).toEqual(
      PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS.resolutions,
    );
    expect(
      runWorkerdResolver(
        [...selectedRows].reverse(),
        [...predecessorRows].reverse(),
      ),
    ).toEqual(PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS.resolutions);
  });

  it("fails closed on inventory, predicate, join, type, and digest attacks", () => {
    expect(() =>
      runWorkerdResolver(selectedRows.slice(1), predecessorRows),
    ).toThrow("source_inventory_mismatch");
    expect(() =>
      runWorkerdResolver(selectedRows, [
        ...predecessorRows,
        structuredClone(predecessorRows[0]!),
      ]),
    ).toThrow("witness_inventory_mismatch");

    const predicate = structuredClone(predecessorRows);
    predicate[0]!.fields.find(
      (field) => field.name === "publication_permitted",
    )!.value = 0;
    expect(() => runWorkerdResolver(selectedRows, predicate)).toThrow(
      "witness_cardinality_mismatch",
    );

    const join = structuredClone(predecessorRows);
    join[2]!.fields.find((field) => field.name === "run_plan_id")!.value =
      "rpl_99999999-9999-4999-8999-999999999999";
    expect(() => runWorkerdResolver(selectedRows, join)).toThrow(
      "witness_cardinality_mismatch",
    );

    const type = structuredClone(selectedRows);
    type[2]!.fields.find((field) => field.name === "roster_content_hash")!.tag =
      "text";
    expect(() => runWorkerdResolver(type, predecessorRows)).toThrow(
      "source_content_mismatch",
    );

    const witnessType = structuredClone(predecessorRows);
    witnessType[0]!.fields.find(
      (field) => field.name === "approval_state",
    )!.tag = "digest";
    expect(() => runWorkerdResolver(selectedRows, witnessType)).toThrow(
      "typed_field_mismatch",
    );

    const digest = structuredClone(predecessorRows);
    digest[2]!.fields.find((field) => field.name === "plan_hash")!.value =
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    expect(() => runWorkerdResolver(selectedRows, digest)).toThrow(
      "digest_parity_mismatch",
    );
  });
});
