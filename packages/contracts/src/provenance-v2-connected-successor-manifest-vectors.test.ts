import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS as vectors,
  PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
  ProvenanceV2ConnectedSuccessorManifestVectorsSchema,
  ProvenanceV2SuccessorManifestSchema,
  validateProvenanceV2ConnectedSuccessorManifestVectors,
} from "./index.js";

describe("provenance v2 connected successor manifest vectors", () => {
  it("is a closed dormant review-candidate artifact", () => {
    expect(
      Value.Check(ProvenanceV2ConnectedSuccessorManifestVectorsSchema, vectors),
    ).toBe(true);
    expect(
      Value.Check(
        ProvenanceV2SuccessorManifestSchema,
        vectors.successor_manifest,
      ),
    ).toBe(true);
    expect(
      validateProvenanceV2ConnectedSuccessorManifestVectors(vectors),
    ).toEqual([]);
    expect(
      validateProvenanceV2ConnectedSuccessorManifestVectors(
        structuredClone(vectors),
      ),
    ).toEqual([]);
    expect(vectors).toMatchObject({
      status: "review_candidate",
      authority_eligible: false,
      outcome: "authority_refused",
      persisted: false,
      document_resolver_executed: false,
      semantic_oracle_executed: false,
    });
    expect(Object.values(vectors.pending)).toEqual(
      Array.from({ length: 8 }, () => "pending"),
    );
  });

  it("covers every successor property and binding exactly once", () => {
    expect(Object.keys(vectors.successor_manifest)).toEqual(
      Object.keys(ProvenanceV2SuccessorManifestSchema.properties),
    );
    expect(
      Object.keys(vectors.successor_manifest.admitted_run_plan_ceilings),
    ).toEqual(
      Object.keys(
        ProvenanceV2SuccessorManifestSchema.properties
          .admitted_run_plan_ceilings.properties,
      ),
    );
    const claims = PROVENANCE_V2_ROOT_BINDING_PLAN.successor_claim_bindings.map(
      (binding) => binding.field,
    );
    expect(vectors.projection_plan.successor_claim_fields).toEqual(claims);
    expect(
      new Set(
        vectors.projection_plan.normalized_row_fields.map(
          (item) => item.target,
        ),
      ).size,
    ).toBe(16);
    expect(
      new Set(vectors.projection_plan.ceiling_fields.map((item) => item.target))
        .size,
    ).toBe(6);
    const ownedProperties = [
      ...vectors.projection_plan.literals,
      ...vectors.projection_plan.normalized_row_fields.map(
        (item) => item.target,
      ),
      "admitted_run_plan_ceilings",
      ...vectors.projection_plan.successor_claim_fields,
    ];
    expect(ownedProperties).toHaveLength(30);
    expect(new Set(ownedProperties).size).toBe(30);
    expect(new Set(ownedProperties)).toEqual(
      new Set(Object.keys(ProvenanceV2SuccessorManifestSchema.properties)),
    );
    expect(vectors.projection_plan.scope_columns).toEqual([
      "authority_plan_id",
      "provider_id",
    ]);
  });

  it("derives the exact resolved and opaque digest occurrence partition", () => {
    const bindings = new Map(
      PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.map((binding) => [
        `${binding.table}.${binding.field}`,
        binding,
      ]),
    );
    const occurrences = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.flatMap(
      (row) =>
        row.fields
          .filter((field) => field.tag === "digest")
          .map((field) => ({
            row_id: row.row_id,
            table: row.table,
            field: field.name,
            binding: bindings.get(`${row.table}.${field.name}`),
          })),
    );
    const safe = occurrences.filter(
      (item) => item.binding?.hash_class === "safe_preimage",
    );
    const external = occurrences.filter(
      (item) => item.binding?.hash_class === "external_anchor",
    );
    const resolved = safe.filter((item) => {
      const binding = item.binding?.binding as
        { kind?: unknown; encoding?: unknown } | undefined;
      return (
        item.row_id === "row-adapter_manifest_receipt-receipt" &&
        item.field === "successor_manifest_hash" &&
        binding?.kind === "document_value" &&
        binding.encoding === "rfc8785_jcs"
      );
    });
    expect(safe).toHaveLength(30);
    expect(external).toHaveLength(10);
    expect(resolved).toHaveLength(1);
    expect(vectors.projection_counts).toMatchObject({
      resolved_safe_preimage_occurrences: resolved.length,
      opaque_safe_preimage_occurrences: safe.length - resolved.length,
      opaque_external_anchor_occurrences: external.length,
    });
  });

  it("pins exact canonical bytes and the downstream refused cascade", () => {
    expect(vectors.canonical_preimage).toMatchObject({
      utf8_byte_length: 2008,
      sha256:
        "sha256:036882a68140745f9d1ba07983b6d810c951515e21aa5a96dd504a605040814b",
    });
    expect(vectors.canonical_preimage.canonical_utf8_hex).toHaveLength(4016);
    expect(vectors.adapter_receipt_fixture_parity).toMatchObject({
      fixture_digest_equal: true,
      recomputed_manifest_content_hash:
        "sha256:39fe956bba73e5df093a523e29bf858a444617e6bc32489e3db3dd27d691c565",
    });
    expect(vectors.projection_counts).toMatchObject({
      resolved_safe_preimage_occurrences: 1,
      opaque_safe_preimage_occurrences: 29,
      opaque_external_anchor_occurrences: 10,
    });
  });

  it("fails closed without reading hostile properties", () => {
    let hits = 0;
    const accessor = structuredClone(vectors) as Record<string, unknown>;
    Object.defineProperty(accessor, "status", {
      enumerable: true,
      get() {
        hits += 1;
        return "review_candidate";
      },
    });
    expect(
      validateProvenanceV2ConnectedSuccessorManifestVectors(accessor),
    ).toEqual([
      "connected successor manifest vectors do not match their closed schema",
    ]);
    expect(hits).toBe(0);
    const proxy = new Proxy(structuredClone(vectors), {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    expect(
      validateProvenanceV2ConnectedSuccessorManifestVectors(proxy),
    ).toEqual([
      "connected successor manifest vectors do not match their closed schema",
    ]);
  });

  it("rejects prototype-key smuggling and unsafe numbers", () => {
    const smuggled = structuredClone(vectors) as Record<string, unknown>;
    Object.defineProperty(smuggled, "__proto__", {
      enumerable: true,
      value: { smuggled: true },
    });
    expect(
      validateProvenanceV2ConnectedSuccessorManifestVectors(smuggled),
    ).not.toEqual([]);
    const unsafe = structuredClone(vectors) as unknown as {
      successor_manifest: { provider_ordinal: number };
    };
    unsafe.successor_manifest.provider_ordinal = -0;
    expect(
      validateProvenanceV2ConnectedSuccessorManifestVectors(unsafe),
    ).not.toEqual([]);
  });

  it("bounds nested arrays, aliases, and hostile string work before admission", () => {
    const nested = structuredClone(vectors) as unknown as {
      selected_scope: Record<string, unknown>;
    };
    Object.defineProperty(nested.selected_scope, "__proto__", {
      enumerable: true,
      value: { smuggled: true },
    });
    expect(
      validateProvenanceV2ConnectedSuccessorManifestVectors(nested),
    ).not.toEqual([]);

    let lengthHits = 0;
    const trapped = structuredClone(vectors) as unknown as {
      projection_plan: { normalized_row_fields: unknown[] };
    };
    trapped.projection_plan.normalized_row_fields = new Proxy(
      trapped.projection_plan.normalized_row_fields,
      {
        get() {
          lengthHits += 1;
          throw new Error("hostile array read");
        },
      },
    );
    expect(
      validateProvenanceV2ConnectedSuccessorManifestVectors(trapped),
    ).toEqual([]);
    expect(lengthHits).toBe(0);

    const oversized = structuredClone(vectors) as unknown as {
      successor_manifest: { roster_version: string };
    };
    oversized.successor_manifest.roster_version = "🧪".repeat(128_001);
    expect(
      validateProvenanceV2ConnectedSuccessorManifestVectors(oversized),
    ).not.toEqual([]);

    const shared = structuredClone(vectors) as unknown as {
      selected_scope: Record<string, unknown>;
      projection_counts: Record<string, unknown>;
    };
    shared.projection_counts = shared.selected_scope;
    expect(
      validateProvenanceV2ConnectedSuccessorManifestVectors(shared),
    ).not.toEqual([]);
  });
});
