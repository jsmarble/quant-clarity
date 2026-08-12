import { createHash } from "node:crypto";

import { FormatRegistry } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS,
  PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH,
  PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS,
  PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
  inspectProvenanceV2RegistrationPlanCandidate,
  parseProvenanceV2CanonicalDocument,
  resolveProvenanceV2DocumentCountCandidate,
  resolveProvenanceV2DocumentValueCandidate,
  validateProvenanceV2ConnectedRegistrationDocumentVectors,
} from "./index.js";

const vectors = PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS;
const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fromHex = (value: string): Uint8Array =>
  Uint8Array.from(Buffer.from(value, "hex"));
const rowProjection = (
  row: (typeof PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows)[number],
): Record<string, string | number | boolean | null> =>
  Object.fromEntries(
    row.fields.map((field) => [
      field.name,
      field.tag === "integer" ? Number(field.value) : field.value,
    ]),
  );

describe("connected provenance-v2 registration document vectors", () => {
  it("is one schema-valid authority-refusing reviewed singleton", () => {
    expect(validateProvenanceV2ConnectedRegistrationDocumentVectors()).toEqual(
      [],
    );
    expect(vectors).toMatchObject({
      status: "review_candidate",
      authority_eligible: false,
      outcome: "authority_refused",
      persisted: false,
      document_resolver_executed: true,
      retained_resolver_executed: false,
      retained_chunk_fixture_verified: true,
      semantic_oracle_executed: false,
    });
    expect(
      inspectProvenanceV2RegistrationPlanCandidate(vectors.document),
    ).toEqual([
      "registration authority is disabled until a repository-pinned benchmark contract replaces benchmark_pending",
    ]);
  });

  it("solves canonical byte length and chunk count as an exact fixed point", () => {
    const bytes = fromHex(vectors.canonical_document.canonical_utf8_hex);
    expect(Buffer.from(bytes).toString("utf8")).toBe(
      vectors.canonical_document.canonical_json,
    );
    const impossibleDate = structuredClone(vectors.document);
    impossibleDate.adapter_receipts[0]!.legacy_manifest.compliance_review.reviewed_at =
      "2026-02-31T00:00:00.000Z";
    expect(
      inspectProvenanceV2RegistrationPlanCandidate(impossibleDate),
    ).toEqual(["registration plan does not match the closed schema"]);
    expect(Object.isFrozen(vectors.document)).toBe(true);
    expect(Object.isFrozen(vectors.document.adapter_receipts[0])).toBe(true);
    expect(vectors.source_contracts).toEqual({
      registration_plan: vectors.document.contract_version,
      canonical_json: vectors.document.canonical_json_version,
      connected_graph:
        PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.contract_version,
      root_binding_plan: PROVENANCE_V2_ROOT_BINDING_PLAN.contract_version,
      document_resolver:
        PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT.contract_version,
      successor_vectors:
        PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.contract_version,
    });
    expect(bytes.length).toBe(vectors.canonical_document.utf8_byte_length);
    expect(sha256(bytes)).toBe(vectors.canonical_document.sha256);
    expect(vectors.document.declared_counts.canonical_document_bytes).toBe(
      bytes.length,
    );
    expect(vectors.document.declared_counts.document_chunks).toBe(
      vectors.chunks.length,
    );
    expect(vectors.chunk_policy.chunk_count).toBe(vectors.chunks.length);
    const parsed = parseProvenanceV2CanonicalDocument(bytes);
    expect(parsed).toMatchObject({
      outcome: "accepted_review_candidate",
      authority_eligible: false,
    });
  });

  it("reconstructs every retained byte exactly from dense contiguous chunks", () => {
    const reconstructed: number[] = [];
    let nextOffset = 0;
    for (const [ordinal, chunk] of vectors.chunks.entries()) {
      const bytes = fromHex(chunk.bytes_hex);
      expect(chunk.ordinal).toBe(ordinal);
      expect(chunk.byte_offset).toBe(nextOffset);
      expect(chunk.byte_length).toBe(bytes.length);
      expect(bytes.length).toBeLessThanOrEqual(
        vectors.chunk_policy.maximum_chunk_bytes,
      );
      expect(sha256(bytes)).toBe(chunk.sha256);
      reconstructed.push(...bytes);
      nextOffset += bytes.length;
    }
    const bytes = Uint8Array.from(reconstructed);
    expect(bytes.length).toBe(vectors.canonical_document.utf8_byte_length);
    expect(sha256(bytes)).toBe(vectors.canonical_document.sha256);
    expect(Buffer.from(bytes).toString("hex")).toBe(
      vectors.canonical_document.canonical_utf8_hex,
    );
  });

  it("resolves all 31 actual graph occurrences with 30 digests and one unhashable absence", () => {
    const bytes = fromHex(vectors.canonical_document.canonical_utf8_hex);
    const parsed = parseProvenanceV2CanonicalDocument(bytes);
    if (parsed.outcome !== "accepted_review_candidate")
      throw new Error("canonical vector did not admit");
    const bindings = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(
      (entry) =>
        (entry.binding as { readonly kind?: string }).kind === "document_value",
    );
    expect(bindings).toHaveLength(18);
    const actual = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.flatMap(
      (row) =>
        bindings
          .filter((entry) => entry.table === row.table)
          .map((entry) => {
            const result = resolveProvenanceV2DocumentValueCandidate(
              parsed.document,
              entry.table,
              entry.field,
              rowProjection(row),
            );
            if (result.outcome !== "resolved_review_candidate")
              throw new Error("document occurrence did not resolve");
            return {
              row_id: row.row_id,
              table: entry.table,
              field: entry.field,
              encoding: result.encoding,
              preimage_kind: result.preimage_kind,
              preimage_byte_length: result.preimage_bytes?.length ?? 0,
              computed_digest:
                result.preimage_bytes === null
                  ? null
                  : sha256(result.preimage_bytes),
            };
          }),
    );
    expect(actual).toEqual(vectors.occurrences);
    expect(actual).toHaveLength(31);
    expect(actual.filter((item) => item.computed_digest !== null)).toHaveLength(
      30,
    );
    expect(
      new Set(
        actual.flatMap((item) =>
          item.computed_digest === null ? [] : [item.computed_digest],
        ),
      ).size,
    ).toBe(26);
    expect(actual.filter((item) => item.preimage_kind === "absent")).toEqual([
      expect.objectContaining({
        row_id: "row-source_endpoint_parameter-parameter",
        field: "pattern_hash",
        preimage_byte_length: 0,
        computed_digest: null,
      }),
    ]);
  });

  it("executes 39 scoped document counts and enumerates seven zero-scope witnesses", () => {
    const parsed = parseProvenanceV2CanonicalDocument(
      fromHex(vectors.canonical_document.canonical_utf8_hex),
    );
    if (parsed.outcome !== "accepted_review_candidate")
      throw new Error("canonical vector did not admit");
    const bindings = PROVENANCE_V2_ROOT_BINDING_PLAN.count_bindings.filter(
      (entry) =>
        String((entry.binding as { readonly kind?: unknown }).kind).startsWith(
          "document_",
        ),
    );
    expect(bindings).toHaveLength(27);
    const present = bindings.flatMap((entry) =>
      Array.from(
        new Map(
          PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows
            .filter((row) => row.table === entry.table)
            .map((row) => {
              const selectors = (
                entry.binding as {
                  readonly selectors?: readonly {
                    readonly row_column?: string;
                  }[];
                }
              ).selectors;
              const projection = rowProjection(row);
              return [
                JSON.stringify(
                  (selectors ?? []).map(
                    (selector) => projection[selector.row_column ?? ""],
                  ),
                ),
                row,
              ] as const;
            }),
        ).values(),
      ).map((row) => {
        const result = resolveProvenanceV2DocumentCountCandidate(
          parsed.document,
          entry.table,
          rowProjection(row),
        );
        if (result.outcome !== "resolved_review_candidate")
          throw new Error("document count did not resolve");
        return {
          row_id: row.row_id,
          table: entry.table,
          binding_kind: (entry.binding as { readonly kind: string }).kind,
          count: result.count,
        };
      }),
    );
    const zeroContexts = vectors.document.field_policies.flatMap((policy) => [
      ...(policy.precedence_edges.length === 0
        ? [
            {
              row_id: `scope-field-policy-edge-${policy.record_group}`,
              table: "provenance_v2_field_policy_precedence_edge",
              binding_kind: "document_array_length",
              count: 0,
            },
          ]
        : []),
      ...(!policy.endpoint_dispositions.some(
        (disposition) => disposition.disposition === "admitted",
      )
        ? [
            {
              row_id: `scope-field-policy-admission-${policy.record_group}`,
              table: "provenance_v2_field_policy_endpoint_admission",
              binding_kind: "document_filtered_array_length",
              count: 0,
            },
          ]
        : []),
      ...(!policy.endpoint_dispositions.some(
        (disposition) => disposition.disposition === "excluded",
      )
        ? [
            {
              row_id: `scope-field-policy-exclusion-${policy.record_group}`,
              table: "provenance_v2_field_policy_endpoint_exclusion",
              binding_kind: "document_filtered_array_length",
              count: 0,
            },
          ]
        : []),
    ]);
    const actual = [...present, ...zeroContexts];
    expect(present).toHaveLength(39);
    expect(zeroContexts).toHaveLength(7);
    expect(actual).toEqual(vectors.count_manifest);
    expect(actual).toHaveLength(46);
    expect(
      actual.filter(
        (item) =>
          item.binding_kind === "document_filtered_array_length" &&
          item.count === 0,
      ),
    ).toHaveLength(4);
  });

  it("rejects chunk gaps, overlap, reorder, length drift, and byte mutation", () => {
    const validateChunks = (
      chunks: readonly {
        ordinal: number;
        byte_offset: number;
        byte_length: number;
        bytes_hex: string;
        sha256: string;
      }[],
    ): boolean => {
      let offset = 0;
      const output: number[] = [];
      for (const [ordinal, chunk] of chunks.entries()) {
        const bytes = fromHex(chunk.bytes_hex);
        if (
          chunk.ordinal !== ordinal ||
          chunk.byte_offset !== offset ||
          chunk.byte_length !== bytes.length ||
          bytes.length === 0 ||
          bytes.length > vectors.chunk_policy.maximum_chunk_bytes ||
          sha256(bytes) !== chunk.sha256
        )
          return false;
        offset += bytes.length;
        output.push(...bytes);
      }
      const bytes = Uint8Array.from(output);
      return (
        chunks.length === vectors.chunk_policy.chunk_count &&
        bytes.length === vectors.canonical_document.utf8_byte_length &&
        sha256(bytes) === vectors.canonical_document.sha256
      );
    };
    expect(validateChunks(vectors.chunks)).toBe(true);
    const clone = () =>
      vectors.chunks.map((chunk) => ({ ...structuredClone(chunk) }));
    const gap = clone();
    gap[1]!.byte_offset += 1;
    expect(validateChunks(gap)).toBe(false);
    const overlap = clone();
    overlap[1]!.byte_offset -= 1;
    expect(validateChunks(overlap)).toBe(false);
    const reversed = clone().reverse();
    expect(validateChunks(reversed)).toBe(false);
    const length = clone();
    length[0]!.byte_length -= 1;
    expect(validateChunks(length)).toBe(false);
    const mutation = clone();
    mutation[0]!.bytes_hex = `00${mutation[0]!.bytes_hex.slice(2)}`;
    expect(validateChunks(mutation)).toBe(false);
    expect(validateChunks(clone().slice(1))).toBe(false);
  });

  it("rejects hostile artifact objects without executing getters", () => {
    let getterHits = 0;
    const hostile = structuredClone(vectors) as Record<string, unknown>;
    Object.defineProperty(hostile, "status", {
      enumerable: true,
      get() {
        getterHits += 1;
        throw new Error("hostile getter executed");
      },
    });
    expect(() =>
      validateProvenanceV2ConnectedRegistrationDocumentVectors(hostile),
    ).not.toThrow();
    expect(
      validateProvenanceV2ConnectedRegistrationDocumentVectors(hostile),
    ).toEqual([
      "connected registration document vectors do not match the closed schema",
    ]);
    expect(getterHits).toBe(0);
    expect(
      validateProvenanceV2ConnectedRegistrationDocumentVectors(
        new Proxy(structuredClone(vectors), {
          ownKeys() {
            throw new Error("hostile proxy executed");
          },
        }),
      ),
    ).toEqual([
      "connected registration document vectors do not match the closed schema",
    ]);
    expect(() => {
      (vectors.document as { environment: string }).environment = "preview";
    }).toThrow();
    expect(vectors.document.environment).toBe("production");

    let descriptorHits = 0;
    const tooWide = new Proxy(
      {},
      {
        ownKeys: () =>
          Array.from({ length: 5_000 }, (_, index) => `key_${String(index)}`),
        getOwnPropertyDescriptor: () => {
          descriptorHits += 1;
          return { enumerable: true, configurable: true, value: null };
        },
      },
    );
    expect(
      validateProvenanceV2ConnectedRegistrationDocumentVectors(tooWide),
    ).toEqual([
      "connected registration document vectors do not match the closed schema",
    ]);
    expect(descriptorHits).toBe(0);
  });

  it("restores a caller-installed date-time format", () => {
    const callerFormat = () => false;
    const previous = FormatRegistry.Get("date-time");
    FormatRegistry.Set("date-time", callerFormat);
    try {
      expect(
        inspectProvenanceV2RegistrationPlanCandidate(vectors.document),
      ).toEqual([
        "registration authority is disabled until a repository-pinned benchmark contract replaces benchmark_pending",
      ]);
      expect(
        validateProvenanceV2ConnectedRegistrationDocumentVectors(),
      ).toEqual([]);
      expect(FormatRegistry.Get("date-time")).toBe(callerFormat);
    } finally {
      if (previous === undefined) FormatRegistry.Delete("date-time");
      else FormatRegistry.Set("date-time", previous);
    }
  });
});
