import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS } from "./provenance-v2-connected-document-cascade-vectors.js";
import { PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH } from "./provenance-v2-connected-registration-graph.js";
import { PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY } from "./provenance-v2-repository-artifact-inventory.js";
import { PROVENANCE_V2_ROOT_BINDING_PLAN } from "./provenance-v2-root-binding-plan.js";

type Scalar = string | number | boolean | null;
type Json = Scalar | Json[] | { [key: string]: Json };
interface Selector {
  wildcard_ordinal: number;
  kind: string;
  row_column: string;
  member_field?: string;
}
interface RepositoryProgram {
  kind: "repository_artifact";
  path_source:
    | { kind: "document_value"; pointer_pattern: string; selectors: Selector[] }
    | { kind: "literal"; value: string }
    | { kind: "row_column"; table: string; column: string };
  allowed_prefix: string;
  null_result: "paired_null" | "reject";
}

const toFields = (row: {
  fields: readonly { name: string; value: Scalar }[];
}) => Object.fromEntries(row.fields.map((field) => [field.name, field.value]));

const select = (
  root: Json,
  pointer: string,
  selectors: readonly Selector[],
  row: Record<string, Scalar>,
): string | null => {
  let current = root;
  let wildcard = 0;
  for (const encoded of pointer.slice(1).split("/")) {
    const token = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (token !== "*") {
      if (
        current === null ||
        typeof current !== "object" ||
        Array.isArray(current) ||
        !Object.hasOwn(current, token)
      )
        throw new Error("pointer_missing");
      current = current[token] as Json;
      continue;
    }
    const selector = selectors.find(
      (candidate) => candidate.wildcard_ordinal === wildcard,
    );
    wildcard += 1;
    if (
      selector?.kind !== "array_object_by_field" ||
      selector.member_field === undefined ||
      !Array.isArray(current)
    )
      throw new Error("selector_invalid");
    const matches = current.filter(
      (candidate) =>
        candidate !== null &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        Object.hasOwn(candidate, selector.member_field!) &&
        candidate[selector.member_field!] === row[selector.row_column],
    );
    if (matches.length !== 1) throw new Error("selector_cardinality");
    current = matches[0] as Json;
  }
  if (current !== null && typeof current !== "string")
    throw new Error("path_type");
  return current;
};

const safe = (value: string, prefix: string): boolean => {
  if (
    !/^[a-z0-9][a-z0-9._/-]{0,511}$/u.test(value) ||
    !value.startsWith(prefix) ||
    value.includes("//") ||
    value.includes("\\") ||
    /[:?#]/u.test(value)
  )
    return false;
  return value
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
};

describe("independent Node provenance-v2 repository evidence", () => {
  it("derives all executable paths from the reviewed binding plan", () => {
    const programs = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(
      (entry) =>
        (entry.binding as { kind?: unknown }).kind === "repository_artifact",
    );
    const actual = programs.map((entry) => {
      const program = entry.binding as RepositoryProgram;
      if (program.path_source.kind === "row_column")
        return {
          table: entry.table,
          field: entry.field,
          path: null,
          pending: true,
        };
      if (program.path_source.kind === "literal")
        return {
          table: entry.table,
          field: entry.field,
          path: program.path_source.value,
          pending: false,
        };
      const rows = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.filter(
        (row) =>
          row.table === entry.table &&
          row.fields.some((field) => field.name === entry.field),
      );
      expect(rows).toHaveLength(1);
      const row = rows[0];
      if (row === undefined) throw new Error("source_row_missing");
      return {
        table: entry.table,
        field: entry.field,
        path: select(
          PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.final_document
            .document,
          program.path_source.pointer_pattern,
          program.path_source.selectors,
          toFields(row),
        ),
        pending: false,
      };
    });
    expect(actual).toHaveLength(10);
    const inventoryJson = JSON.stringify(
      programs.map((entry) => {
        const program = entry.binding as RepositoryProgram & {
          require_tracked: true;
          build_manifest_status: "pending_reviewed_manifest";
          null_result: "paired_null" | "reject";
        };
        return {
          table: entry.table,
          field: entry.field,
          path_source: program.path_source,
          allowed_prefix: program.allowed_prefix,
          null_result: program.null_result,
          require_tracked: program.require_tracked,
          build_manifest_status: program.build_manifest_status,
        };
      }),
    );
    expect(
      `sha256:${createHash("sha256").update(inventoryJson).digest("hex")}`,
    ).toBe(
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.binding_inventory_sha256,
    );
    expect(actual.map((entry) => entry.path)).toEqual(
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.resolutions.map(
        (entry) => entry.logical_path,
      ),
    );
    for (const [index, entry] of actual.entries()) {
      const expected =
        PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.resolutions[index];
      if (expected === undefined) throw new Error("resolution_missing");
      if (expected.logical_path !== null)
        expect(safe(expected.logical_path, expected.allowed_prefix)).toBe(true);
      expect(entry.pending).toBe(
        expected.resolution_status === "missing_source_row",
      );
    }
  });

  it("independently hashes exact repository bytes", () => {
    const [entry] =
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.partial_build_witness.entries;
    const bytes = readFileSync(entry.logical_path);
    expect(bytes.byteLength).toBe(entry.byte_length);
    expect(bytes.toString("hex")).toBe(entry.exact_bytes_hex);
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(
      entry.sha256,
    );
  });

  it("rejects zero and duplicate selector matches independently", () => {
    const source = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.find(
      (row) => row.row_id === "row-source_endpoint_approval-approval",
    );
    if (source === undefined) throw new Error("source_missing");
    const root = structuredClone(
      PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.final_document.document,
    ) as unknown as { endpoints: Json[] };
    const selectors: Selector[] = [
      {
        wildcard_ordinal: 0,
        kind: "array_object_by_field",
        row_column: "endpoint_id",
        member_field: "endpoint_id",
      },
    ];
    expect(() =>
      select(
        { ...root, endpoints: [] },
        "/endpoints/*/approval/approval_artifact_path",
        selectors,
        toFields(source),
      ),
    ).toThrow("selector_cardinality");
    expect(() =>
      select(
        {
          ...root,
          endpoints: [root.endpoints[0] as Json, root.endpoints[0] as Json],
        },
        "/endpoints/*/approval/approval_artifact_path",
        selectors,
        toFields(source),
      ),
    ).toThrow("selector_cardinality");
  });
});
