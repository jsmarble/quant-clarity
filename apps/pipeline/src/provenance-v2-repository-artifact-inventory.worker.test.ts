import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS,
  PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH,
  PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
  PROVENANCE_V2_SEMANTIC_POLICY,
} from "@quant-clarity/contracts";

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
}

const rowFields = (row: {
  fields: readonly { name: string; value: Scalar }[];
}) => Object.fromEntries(row.fields.map((field) => [field.name, field.value]));

const select = (
  root: Json,
  pointer: string,
  selectors: readonly Selector[],
  row: Record<string, Scalar>,
): string | null => {
  let current = root;
  let wildcardOrdinal = 0;
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
      (candidate) => candidate.wildcard_ordinal === wildcardOrdinal,
    );
    wildcardOrdinal += 1;
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

const safe = (value: string, prefix: string): boolean =>
  /^[a-z0-9][a-z0-9._/-]{0,511}$/u.test(value) &&
  value.startsWith(prefix) &&
  !value.includes("//") &&
  !value.includes("\\") &&
  !/[:?#]/u.test(value) &&
  value
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

describe("independent workerd provenance-v2 repository evidence", () => {
  it("executes every document and literal path program without claiming missing rows", () => {
    const programs = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(
      (entry) =>
        (entry.binding as { kind?: unknown }).kind === "repository_artifact",
    );
    const actual = programs.map((entry) => {
      const program = entry.binding as RepositoryProgram;
      if (program.path_source.kind === "row_column") return null;
      if (program.path_source.kind === "literal")
        return program.path_source.value;
      const rows = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.filter(
        (row) =>
          row.table === entry.table &&
          row.fields.some((field) => field.name === entry.field),
      );
      if (rows.length !== 1 || rows[0] === undefined)
        throw new Error("source_cardinality");
      return select(
        PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS.final_document
          .document,
        program.path_source.pointer_pattern,
        program.path_source.selectors,
        rowFields(rows[0]),
      );
    });
    expect(actual).toEqual(
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.resolutions.map(
        (entry) => entry.logical_path,
      ),
    );
    for (const [index, path] of actual.entries()) {
      if (path !== null) {
        const expected =
          PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.resolutions[index];
        if (expected === undefined) throw new Error("resolution_missing");
        expect(safe(path, expected.allowed_prefix)).toBe(true);
      }
    }
  });

  it("independently hashes the exact present-file byte witness", async () => {
    const [entry] =
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.partial_build_witness.entries;
    const bytes = new TextEncoder().encode(
      `${JSON.stringify(PROVENANCE_V2_SEMANTIC_POLICY, null, 2)}\n`,
    );
    expect(bytes.byteLength).toBe(entry.byte_length);
    expect(hex(bytes)).toBe(entry.exact_bytes_hex);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    expect(`sha256:${hex(digest)}`).toBe(entry.sha256);
  });

  it("independently pins the complete ordered binding program inventory", async () => {
    const programs = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(
      (entry) =>
        (entry.binding as { kind?: unknown }).kind === "repository_artifact",
    );
    const inventoryJson = JSON.stringify(
      programs.map((entry) => {
        const program = entry.binding as RepositoryProgram & {
          null_result: "paired_null" | "reject";
          require_tracked: true;
          build_manifest_status: "pending_reviewed_manifest";
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
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(inventoryJson),
      ),
    );
    expect(`sha256:${hex(digest)}`).toBe(
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.binding_inventory_sha256,
    );
  });

  it("rejects prefix confusion and traversal independently", () => {
    const prefix = "docs/compliance/provenance-v2/";
    expect(safe("docs/compliance/provenance-v2/review.json", prefix)).toBe(
      true,
    );
    expect(safe("docs/compliance/provenance-v2/../secret", prefix)).toBe(false);
    expect(
      safe("docs/compliance/provenance-v2-lookalike/review.json", prefix),
    ).toBe(false);
    expect(safe("docs/compliance/provenance-v2//review.json", prefix)).toBe(
      false,
    );
  });

  it("rejects missing and duplicate document selector matches", () => {
    const row = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.find(
      (candidate) =>
        candidate.row_id === "row-source_endpoint_approval-approval",
    );
    if (row === undefined) throw new Error("source_missing");
    const document = structuredClone(
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
    const pointer = "/endpoints/*/approval/approval_artifact_path";
    expect(() =>
      select(
        { ...document, endpoints: [] },
        pointer,
        selectors,
        rowFields(row),
      ),
    ).toThrow("selector_cardinality");
    expect(() =>
      select(
        {
          ...document,
          endpoints: [document.endpoints[0]!, document.endpoints[0]!],
        },
        pointer,
        selectors,
        rowFields(row),
      ),
    ).toThrow("selector_cardinality");
  });
});
