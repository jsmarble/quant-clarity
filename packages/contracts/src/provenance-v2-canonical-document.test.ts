import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_BYTES,
  PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
  parseProvenanceV2CanonicalDocument,
  resolveProvenanceV2DocumentCountCandidate,
  resolveProvenanceV2DocumentValueCandidate,
  validateProvenanceV2DocumentResolverContract,
} from "./index.js";

interface Selector {
  readonly wildcard_ordinal: number;
  readonly kind: string;
  readonly row_column: string;
  readonly member_field?: string;
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
};

const rowValue = (column: string): string | number =>
  column.includes("ordinal") || column === "ordinal" ? 0 : `match-${column}`;

const admitted = (value: unknown) => {
  const parsed = parseProvenanceV2CanonicalDocument(
    new TextEncoder().encode(canonical(value)),
  );
  if (parsed.outcome !== "accepted_review_candidate")
    throw new Error("fixture document was not admitted");
  return parsed.document;
};

const probe = (
  pointer: string,
  selectors: readonly Selector[],
  terminal: unknown,
): {
  readonly document: unknown;
  readonly row: Record<string, string | number>;
} => {
  const row: Record<string, string | number> = {};
  let wildcardOrdinal = 0;
  const build = (tokens: readonly string[], index: number): unknown => {
    if (index === tokens.length) return terminal;
    const token = tokens[index]!;
    if (token !== "*") return { [token]: build(tokens, index + 1) };
    const selector = selectors.find(
      (candidate) => candidate.wildcard_ordinal === wildcardOrdinal,
    );
    wildcardOrdinal += 1;
    if (selector === undefined) throw new Error("fixture selector missing");
    const selected = build(tokens, index + 1);
    if (selector.kind === "array_index_by_ordinal") {
      row[selector.row_column] = 0;
      return [selected];
    }
    const expected = rowValue(selector.row_column);
    row[selector.row_column] = expected;
    if (
      typeof selected !== "object" ||
      selected === null ||
      Array.isArray(selected) ||
      selector.member_field === undefined
    )
      throw new Error("fixture object selector is not mergeable");
    return [{ [selector.member_field]: expected, ...selected }];
  };
  return { document: build(pointer.split("/").slice(1), 0), row };
};

describe("provenance-v2 canonical registration document", () => {
  it("admits only exact canonical UTF-8 bytes under the trusted evidence cap", () => {
    const bytes = new TextEncoder().encode('{"a":[1,true,null],"é":"ok"}');
    const result = parseProvenanceV2CanonicalDocument(bytes);
    expect(result.outcome).toBe("accepted_review_candidate");
    expect(result.authority_eligible).toBe(false);
    if (result.outcome !== "accepted_review_candidate") return;
    expect(result.canonical_bytes).toEqual(bytes);
    expect(Object.isFrozen(result.document)).toBe(true);
    bytes.fill(0);
    expect(new TextDecoder().decode(result.canonical_bytes)).toBe(
      '{"a":[1,true,null],"é":"ok"}',
    );
  });

  it.each([
    ['{"a":1,"a":2}', "duplicate_object_key"],
    ['{"a":1,"\\u0061":2}', "duplicate_object_key"],
    [' {"a":1}', "invalid_json"],
    ['{"b":1,"a":2}', "noncanonical_document_bytes"],
    ['{"a":1.0}', "noncanonical_integer"],
    ['{"a":1e0}', "noncanonical_integer"],
    ['{"a":-0}', "noncanonical_integer"],
    ['{"a":9007199254740992}', "noncanonical_integer"],
    ['{"a":"é"}', "noncanonical_unicode"],
    [String.raw`{"a":"\ud800"}`, "noncanonical_unicode"],
  ])("rejects hostile/noncanonical bytes %#", (text, error) => {
    expect(
      parseProvenanceV2CanonicalDocument(new TextEncoder().encode(text)),
    ).toMatchObject({
      outcome: "authority_refused",
      errors: [error],
    });
  });

  it("rejects BOM, invalid UTF-8, and the trusted cap before parsing", () => {
    expect(
      parseProvenanceV2CanonicalDocument(
        Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
      ),
    ).toMatchObject({ errors: ["bom_not_allowed"] });
    expect(
      parseProvenanceV2CanonicalDocument(Uint8Array.from([0xc0, 0xaf])),
    ).toMatchObject({ errors: ["invalid_utf8"] });
    expect(
      parseProvenanceV2CanonicalDocument(
        new Uint8Array(PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_BYTES + 1),
      ),
    ).toMatchObject({ errors: ["input_byte_limit_exceeded"] });
    const deep = `{"a":${"[".repeat(65)}null${"]".repeat(65)}}`;
    expect(
      parseProvenanceV2CanonicalDocument(new TextEncoder().encode(deep)),
    ).toMatchObject({ errors: ["document_depth_limit_exceeded"] });
    const wide = `{"a":[${"null,".repeat(100_000)}null]}`;
    expect(
      parseProvenanceV2CanonicalDocument(new TextEncoder().encode(wide)),
    ).toMatchObject({ errors: ["document_node_limit_exceeded"] });
  });

  it("JCS-encodes selected string values with JSON quotes", () => {
    const document = admitted({
      field_policies: [
        {
          canonical_policy_preimage: "policy-string",
          record_group: "price_tuple@1",
        },
      ],
    });
    expect(
      resolveProvenanceV2DocumentValueCandidate(
        document,
        "provenance_v2_field_policy",
        "canonical_bytes_hash",
        { record_group: "price_tuple@1" },
      ),
    ).toMatchObject({
      value: "policy-string",
      preimage_kind: "bytes",
      preimage_bytes: new TextEncoder().encode('"policy-string"'),
    });
  });

  it("compiles and executes all 18 document values and 27 document counts", () => {
    expect(validateProvenanceV2DocumentResolverContract()).toEqual([]);
    expect(PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT).toMatchObject({
      authority_eligible: false,
      persisted: false,
      document_value_binding_count: 18,
      document_count_binding_count: 27,
      retained_resolver_executed: false,
      semantic_oracle_executed: false,
    });

    const digestBindings =
      PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(
        (entry) =>
          (entry.binding as { readonly kind?: string }).kind ===
          "document_value",
      );
    for (const entry of digestBindings) {
      const binding = entry.binding as {
        readonly pointer_pattern: string;
        readonly selectors: readonly Selector[];
        readonly encoding: "nfc_utf8" | "rfc8785_jcs";
        readonly null_result: "null" | "reject";
      };
      const terminal =
        binding.null_result === "null"
          ? null
          : binding.encoding === "nfc_utf8"
            ? "selected"
            : { selected: true };
      const built = probe(binding.pointer_pattern, binding.selectors, terminal);
      const parsed = parseProvenanceV2CanonicalDocument(
        new TextEncoder().encode(canonical(built.document)),
      );
      expect(parsed.outcome, `${entry.table}.${entry.field}`).toBe(
        "accepted_review_candidate",
      );
      if (parsed.outcome !== "accepted_review_candidate") continue;
      expect(
        resolveProvenanceV2DocumentValueCandidate(
          parsed.document,
          entry.table,
          entry.field,
          built.row,
        ),
        `${entry.table}.${entry.field}`,
      ).toMatchObject(
        terminal === null
          ? {
              outcome: "resolved_review_candidate",
              value: null,
              preimage_kind: "absent",
              preimage_bytes: null,
            }
          : {
              outcome: "resolved_review_candidate",
              value: terminal,
              encoding: binding.encoding,
              preimage_kind: "bytes",
              preimage_bytes:
                binding.encoding === "nfc_utf8"
                  ? new TextEncoder().encode(terminal as string)
                  : new TextEncoder().encode(canonical(terminal)),
            },
      );
    }

    const countBindings = PROVENANCE_V2_ROOT_BINDING_PLAN.count_bindings.filter(
      (entry) =>
        [
          "document_array_length",
          "document_declared_integer",
          "document_filtered_array_length",
        ].includes((entry.binding as { readonly kind?: string }).kind ?? ""),
    );
    const inventoryBytes = JSON.stringify({
      document_values: digestBindings.map((entry) => {
        const binding = entry.binding as {
          readonly pointer_pattern: string;
          readonly selectors: readonly Selector[];
          readonly encoding: string;
          readonly null_result: string;
        };
        return {
          table: entry.table,
          field: entry.field,
          pointer_pattern: binding.pointer_pattern,
          selectors: binding.selectors,
          encoding: binding.encoding,
          null_result: binding.null_result,
        };
      }),
      document_counts: countBindings.map((entry) => {
        const binding = entry.binding as {
          readonly kind: string;
          readonly pointer_pattern: string;
          readonly selectors?: readonly Selector[];
          readonly predicate?: {
            readonly member_field: string;
            readonly equals: string;
          };
        };
        return {
          table: entry.table,
          kind: binding.kind,
          pointer_pattern: binding.pointer_pattern,
          selectors: binding.selectors ?? [],
          predicate: binding.predicate ?? null,
        };
      }),
    });
    expect(
      `sha256:${createHash("sha256").update(inventoryBytes).digest("hex")}`,
    ).toBe(
      PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT.exact_binding_inventory_sha256,
    );
    for (const entry of countBindings) {
      const binding = entry.binding as {
        readonly kind: string;
        readonly pointer_pattern: string;
        readonly selectors?: readonly Selector[];
        readonly predicate?: {
          readonly member_field: string;
          readonly equals: string;
        };
      };
      const terminal =
        binding.kind === "document_declared_integer"
          ? 2
          : binding.kind === "document_filtered_array_length"
            ? [{ [binding.predicate!.member_field]: binding.predicate!.equals }]
            : [1, 2];
      const built = probe(
        binding.pointer_pattern,
        binding.selectors ?? [],
        terminal,
      );
      const parsed = parseProvenanceV2CanonicalDocument(
        new TextEncoder().encode(canonical(built.document)),
      );
      if (parsed.outcome !== "accepted_review_candidate")
        throw new Error("count probe is not canonical");
      const resolved = resolveProvenanceV2DocumentCountCandidate(
        parsed.document,
        entry.table,
        built.row,
      );
      expect(resolved.outcome, entry.table).toBe("resolved_review_candidate");
      if (resolved.outcome === "resolved_review_candidate")
        expect(resolved.count, entry.table).toBe(
          binding.kind === "document_filtered_array_length" ? 1 : 2,
        );
    }
  });

  it("fails selectors closed on zero, duplicate, wrong type, and index bounds", () => {
    const document = admitted({ adapter_receipts: [] });
    expect(
      resolveProvenanceV2DocumentValueCandidate(
        document,
        "provenance_v2_adapter_manifest_receipt",
        "adapter_manifest_hash",
        { provider_id: "missing" },
      ),
    ).toMatchObject({ errors: ["document_selector_no_match"] });

    const duplicate = admitted({
      adapter_receipts: [
        { provider_id: "same", legacy_manifest: {} },
        { provider_id: "same", legacy_manifest: {} },
      ],
    });
    expect(
      resolveProvenanceV2DocumentValueCandidate(
        duplicate,
        "provenance_v2_adapter_manifest_receipt",
        "adapter_manifest_hash",
        { provider_id: "same" },
      ),
    ).toMatchObject({ errors: ["document_selector_multiple_matches"] });

    const enumDocument = admitted({
      endpoints: [
        {
          endpoint_id: "endpoint",
          parameters: [{ ordinal: 0, enum_values: ["only"] }],
        },
      ],
    });
    expect(
      resolveProvenanceV2DocumentValueCandidate(
        enumDocument,
        "provenance_v2_source_endpoint_parameter_enum",
        "value_hash",
        { endpoint_id: "endpoint", parameter_ordinal: 0, ordinal: 1 },
      ),
    ).toMatchObject({ errors: ["document_selector_index_out_of_bounds"] });
    expect(
      resolveProvenanceV2DocumentValueCandidate(
        enumDocument,
        "provenance_v2_source_endpoint_parameter_enum",
        "value_hash",
        { endpoint_id: "endpoint", parameter_ordinal: 0, ordinal: -0 },
      ),
    ).toMatchObject({ errors: ["document_selector_invalid_row"] });
    expect(
      resolveProvenanceV2DocumentValueCandidate(
        { adapter_receipts: [] },
        "provenance_v2_adapter_manifest_receipt",
        "adapter_manifest_hash",
        { provider_id: "missing" },
      ),
    ).toMatchObject({ errors: ["document_not_admitted"] });

    let trapHits = 0;
    const hostile = new Proxy(new TextEncoder().encode("{}"), {
      getPrototypeOf() {
        trapHits += 1;
        throw new Error("trap");
      },
    });
    expect(parseProvenanceV2CanonicalDocument(hostile)).toMatchObject({
      errors: ["input_not_plain_uint8array"],
    });
    expect(trapHits).toBe(0);
  });
});
