import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS,
  PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
} from "@quant-clarity/contracts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Selector {
  readonly wildcard_ordinal: number;
  readonly kind: "array_object_by_field" | "array_index_by_ordinal";
  readonly row_column: string;
  readonly member_field?: string;
}

const vectors = PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS;
const hex = (value: string): Uint8Array => {
  if (value.length % 2 !== 0) throw new Error("invalid_hex");
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isInteger(byte)) throw new Error("invalid_hex");
    output[index] = byte;
  }
  return output;
};
const digest = async (bytes: Uint8Array): Promise<string> => {
  const copied = Uint8Array.from(bytes);
  const result = new Uint8Array(await crypto.subtle.digest("SHA-256", copied));
  return `sha256:${Array.from(result, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
};
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);
// Recursive JSON object types cannot use Record without circular-alias errors.
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
const isObject = (value: Json): value is { [key: string]: Json } =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const canonical = (value: Json): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`)
    .join(",")}}`;
};
const rowProjection = (
  row: (typeof PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows)[number],
): Record<string, Json> =>
  Object.fromEntries(
    row.fields.map((field) => [
      field.name,
      field.tag === "integer" ? Number(field.value) : field.value,
    ]),
  );
const decodePointer = (pointer: string): string[] =>
  pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));

const select = (
  document: Json,
  pointer: string,
  selectors: readonly Selector[],
  row: Readonly<Record<string, Json>>,
): Json => {
  let current = document;
  let wildcardOrdinal = 0;
  for (const token of decodePointer(pointer)) {
    if (token !== "*") {
      if (!isObject(current) || !Object.hasOwn(current, token))
        throw new Error("selector_missing");
      current = current[token]!;
      continue;
    }
    const selector = selectors.find(
      (candidate) => candidate.wildcard_ordinal === wildcardOrdinal,
    );
    wildcardOrdinal += 1;
    if (selector === undefined || !Array.isArray(current))
      throw new Error("selector_shape");
    const expected = row[selector.row_column];
    if (selector.kind === "array_index_by_ordinal") {
      if (
        typeof expected !== "number" ||
        !Number.isSafeInteger(expected) ||
        Object.is(expected, -0) ||
        expected < 0 ||
        expected >= current.length
      )
        throw new Error("selector_ordinal");
      current = current[expected]!;
      continue;
    }
    if (selector.member_field === undefined)
      throw new Error("selector_member_field");
    const matches = current.filter(
      (member) =>
        isObject(member) &&
        Object.hasOwn(member, selector.member_field!) &&
        member[selector.member_field!] === expected,
    );
    if (matches.length !== 1) throw new Error("selector_cardinality");
    current = matches[0]!;
  }
  if (wildcardOrdinal !== selectors.length)
    throw new Error("selector_unconsumed");
  return current;
};

describe("workerd connected provenance-v2 registration document", () => {
  it("independently resolves every occurrence and retained byte", async () => {
    const document = vectors.document as unknown as Json;
    expect(utf8(canonical(document))).toEqual(
      hex(vectors.canonical_document.canonical_utf8_hex),
    );
    expect(await digest(utf8(canonical(document)))).toBe(
      vectors.canonical_document.sha256,
    );
    const bindings = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(
      (entry) =>
        (entry.binding as { readonly kind?: string }).kind === "document_value",
    );
    const actual = [];
    for (const row of PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows) {
      for (const entry of bindings.filter((item) => item.table === row.table)) {
        const binding = entry.binding as {
          readonly pointer_pattern: string;
          readonly selectors: readonly Selector[];
          readonly encoding: "nfc_utf8" | "rfc8785_jcs";
          readonly null_result: "null" | "reject";
        };
        const selected = select(
          document,
          binding.pointer_pattern,
          binding.selectors,
          rowProjection(row),
        );
        const absent = selected === null && binding.null_result === "null";
        if (selected === null && !absent) throw new Error("unexpected_null");
        const preimage = absent
          ? null
          : binding.encoding === "nfc_utf8"
            ? typeof selected === "string"
              ? utf8(selected)
              : (() => {
                  throw new Error("nfc_value_type");
                })()
            : utf8(canonical(selected));
        actual.push({
          row_id: row.row_id,
          table: entry.table,
          field: entry.field,
          encoding: binding.encoding,
          preimage_kind: absent ? "absent" : "bytes",
          preimage_byte_length: preimage?.length ?? 0,
          computed_digest: preimage === null ? null : await digest(preimage),
        });
      }
    }
    expect(actual).toEqual(vectors.occurrences);

    const countBindings = PROVENANCE_V2_ROOT_BINDING_PLAN.count_bindings.filter(
      (entry) =>
        String((entry.binding as { readonly kind?: unknown }).kind).startsWith(
          "document_",
        ),
    );
    expect(countBindings).toHaveLength(27);
    const presentCounts = countBindings.flatMap((entry) =>
      Array.from(
        new Map(
          PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows
            .filter((row) => row.table === entry.table)
            .map((row) => {
              const selectors = (
                entry.binding as {
                  readonly selectors?: readonly Selector[];
                }
              ).selectors;
              const projection = rowProjection(row);
              return [
                JSON.stringify(
                  (selectors ?? []).map(
                    (selector) => projection[selector.row_column],
                  ),
                ),
                row,
              ] as const;
            }),
        ).values(),
      ).map((row) => {
        const binding = entry.binding as {
          readonly kind:
            | "document_array_length"
            | "document_declared_integer"
            | "document_filtered_array_length";
          readonly pointer_pattern: string;
          readonly selectors?: readonly Selector[];
          readonly predicate?: {
            readonly member_field: string;
            readonly equals: string;
          };
        };
        const selected = select(
          document,
          binding.pointer_pattern,
          binding.selectors ?? [],
          rowProjection(row),
        );
        const count =
          binding.kind === "document_declared_integer"
            ? selected
            : binding.kind === "document_filtered_array_length"
              ? Array.isArray(selected) && binding.predicate !== undefined
                ? selected.filter(
                    (member) =>
                      isObject(member) &&
                      member[binding.predicate!.member_field] ===
                        binding.predicate!.equals,
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
          throw new Error("count_type");
        return {
          row_id: row.row_id,
          table: entry.table,
          binding_kind: binding.kind,
          count,
        };
      }),
    );
    const policies = (document as { field_policies: Json[] }).field_policies;
    const zeroCounts = policies.flatMap((value) => {
      if (!isObject(value)) throw new Error("policy_shape");
      const group = value.record_group;
      const edges = value.precedence_edges;
      const dispositions = value.endpoint_dispositions;
      if (
        typeof group !== "string" ||
        !Array.isArray(edges) ||
        !Array.isArray(dispositions)
      )
        throw new Error("policy_shape");
      const dispositionValues = dispositions.map((member) => {
        if (!isObject(member)) throw new Error("policy_shape");
        return member.disposition;
      });
      return [
        ...(edges.length === 0
          ? [
              {
                row_id: `scope-field-policy-edge-${group}`,
                table: "provenance_v2_field_policy_precedence_edge",
                binding_kind: "document_array_length",
                count: 0,
              },
            ]
          : []),
        ...(!dispositionValues.includes("admitted")
          ? [
              {
                row_id: `scope-field-policy-admission-${group}`,
                table: "provenance_v2_field_policy_endpoint_admission",
                binding_kind: "document_filtered_array_length",
                count: 0,
              },
            ]
          : []),
        ...(!dispositionValues.includes("excluded")
          ? [
              {
                row_id: `scope-field-policy-exclusion-${group}`,
                table: "provenance_v2_field_policy_endpoint_exclusion",
                binding_kind: "document_filtered_array_length",
                count: 0,
              },
            ]
          : []),
      ];
    });
    const counts = [...presentCounts, ...zeroCounts];
    expect(presentCounts).toHaveLength(39);
    expect(zeroCounts).toHaveLength(7);
    expect(counts).toEqual(vectors.count_manifest);
    expect(counts).toHaveLength(46);

    const reconstructed = new Uint8Array(
      vectors.chunks.reduce((sum, chunk) => sum + chunk.byte_length, 0),
    );
    let offset = 0;
    for (const [ordinal, chunk] of vectors.chunks.entries()) {
      const bytes = hex(chunk.bytes_hex);
      expect(chunk.ordinal).toBe(ordinal);
      expect(chunk.byte_offset).toBe(offset);
      expect(chunk.byte_length).toBe(bytes.length);
      expect(await digest(bytes)).toBe(chunk.sha256);
      reconstructed.set(bytes, offset);
      offset += bytes.length;
    }
    expect(reconstructed).toEqual(
      hex(vectors.canonical_document.canonical_utf8_hex),
    );
    expect(await digest(reconstructed)).toBe(vectors.canonical_document.sha256);
  });

  it("fails closed on selector and chunk identity attacks", async () => {
    const binding = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.find(
      (entry) =>
        entry.table === "provenance_v2_source_endpoint_parameter_enum" &&
        entry.field === "value_hash",
    )!;
    const declared = binding.binding as {
      readonly pointer_pattern: string;
      readonly selectors: readonly Selector[];
    };
    const row = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.find(
      (entry) => entry.table === binding.table,
    )!;
    const hostile = rowProjection(row);
    hostile.ordinal = -0;
    expect(() =>
      select(
        vectors.document as unknown as Json,
        declared.pointer_pattern,
        declared.selectors,
        hostile,
      ),
    ).toThrow("selector_ordinal");

    const first = vectors.chunks[0]!;
    const changed = hex(`00${first.bytes_hex.slice(2)}`);
    expect(await digest(changed)).not.toBe(first.sha256);
    expect(vectors.chunks[1]!.byte_offset).toBe(first.byte_length);
    expect(vectors.chunks[1]!.byte_offset + 1).not.toBe(first.byte_length);
  });
});
