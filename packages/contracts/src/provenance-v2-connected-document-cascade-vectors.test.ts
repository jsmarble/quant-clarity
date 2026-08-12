import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS,
  PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS,
  PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH,
  PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS,
  PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS,
  PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
  inspectProvenanceV2RegistrationPlanCandidate,
  parseProvenanceV2CanonicalDocument,
  validateProvenanceV2ConnectedDocumentCascadeVectors,
} from "./index.js";

const vectors = PROVENANCE_V2_CONNECTED_DOCUMENT_CASCADE_VECTORS;
const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fromHex = (value: string): Uint8Array =>
  Uint8Array.from(Buffer.from(value, "hex"));

describe("connected provenance-v2 document cascade vectors", () => {
  it("is one closed authority-refusing reviewed singleton", () => {
    expect(validateProvenanceV2ConnectedDocumentCascadeVectors()).toEqual([]);
    expect(vectors).toMatchObject({
      status: "review_candidate",
      coverage: "synthetic_document_digest_overlay_and_refused_cascade",
      authority_eligible: false,
      outcome: "authority_refused",
      persisted: false,
      document_digest_overlay_executed: true,
      successor_cascade_executed: true,
      retained_resolver_executed: false,
      semantic_oracle_executed: false,
    });
    expect(vectors.source_contracts).toEqual({
      registration_plan: vectors.final_document.document.contract_version,
      canonical_json: vectors.final_document.document.canonical_json_version,
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
    });
    expect(
      inspectProvenanceV2RegistrationPlanCandidate(
        vectors.final_document.document,
      ),
    ).toEqual([
      "registration authority is disabled until a repository-pinned benchmark contract replaces benchmark_pending",
    ]);
  });

  it("overlays every document occurrence once without treating null as bytes", () => {
    expect(vectors.graph_overlay).toHaveLength(31);
    expect(
      new Set(vectors.graph_overlay.map((item) => item.row_id + item.field))
        .size,
    ).toBe(31);
    expect(
      vectors.graph_overlay.filter((item) => item.after.tag === "digest"),
    ).toHaveLength(30);
    expect(
      vectors.graph_overlay.filter((item) => item.after.tag === "null"),
    ).toEqual([
      expect.objectContaining({
        row_id: "row-source_endpoint_parameter-parameter",
        field: "pattern_hash",
        preimage_kind: "absent",
        before: { tag: "null", value: null },
        after: { tag: "null", value: null },
      }),
    ]);
    for (const overlay of vectors.graph_overlay) {
      const row = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.find(
        (candidate) => candidate.row_id === overlay.row_id,
      );
      const field = row?.fields.find(
        (candidate) => candidate.name === overlay.field,
      );
      expect(field).toMatchObject({
        tag: overlay.before.tag,
        value: overlay.before.value,
      });
      const occurrence =
        PROVENANCE_V2_CONNECTED_REGISTRATION_DOCUMENT_VECTORS.occurrences.find(
          (candidate) =>
            candidate.row_id === overlay.row_id &&
            candidate.field === overlay.field,
        );
      expect(occurrence).toBeDefined();
      expect(overlay.after.value).toBe(
        overlay.field === "successor_manifest_hash"
          ? vectors.successor.sha256
          : occurrence?.computed_digest,
      );
    }
    expect(
      vectors.graph_overlay.find(
        (item) => item.field === "successor_manifest_hash",
      )?.after.value,
    ).toBe(vectors.successor.sha256);
  });

  it("pins the final canonical document and dense retained chunk fixture", () => {
    const bytes = fromHex(vectors.final_document.canonical_utf8_hex);
    expect(Buffer.from(bytes).toString("utf8")).toBe(
      vectors.final_document.canonical_json,
    );
    expect(bytes.length).toBe(vectors.final_document.utf8_byte_length);
    expect(sha256(bytes)).toBe(vectors.final_document.sha256);
    expect(parseProvenanceV2CanonicalDocument(bytes)).toMatchObject({
      outcome: "accepted_review_candidate",
      authority_eligible: false,
    });
    const reassembled: number[] = [];
    let offset = 0;
    for (const [ordinal, chunk] of vectors.chunks.entries()) {
      const chunkBytes = fromHex(chunk.bytes_hex);
      expect(chunk.ordinal).toBe(ordinal);
      expect(chunk.byte_offset).toBe(offset);
      expect(chunk.byte_length).toBe(chunkBytes.length);
      expect(sha256(chunkBytes)).toBe(chunk.sha256);
      reassembled.push(...chunkBytes);
      offset += chunkBytes.length;
    }
    expect(Buffer.from(reassembled).toString("hex")).toBe(
      vectors.final_document.canonical_utf8_hex,
    );
  });

  it("keeps every unresolved authority gate machine-readable", () => {
    expect(vectors.pending).toEqual({
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
    });
  });

  it("rejects nested drift and hostile plain-data shapes", () => {
    const mutated = structuredClone(vectors);
    mutated.final_document.document.environment = "preview";
    expect(
      validateProvenanceV2ConnectedDocumentCascadeVectors(mutated),
    ).toEqual([
      "connected document cascade vectors must equal the reviewed singleton",
    ]);

    const accessor = structuredClone(vectors) as unknown as Record<
      string,
      unknown
    >;
    let getterHits = 0;
    Object.defineProperty(accessor, "status", {
      enumerable: true,
      get() {
        getterHits += 1;
        return "review_candidate";
      },
    });
    expect(
      validateProvenanceV2ConnectedDocumentCascadeVectors(accessor),
    ).toEqual([
      "connected document cascade vectors do not match the closed schema",
    ]);
    expect(getterHits).toBe(0);

    const prototypeKey = structuredClone(vectors) as unknown as Record<
      string,
      unknown
    >;
    Object.defineProperty(prototypeKey, "__proto__", {
      value: { smuggled: true },
      enumerable: true,
    });
    expect(
      validateProvenanceV2ConnectedDocumentCascadeVectors(prototypeKey),
    ).toEqual([
      "connected document cascade vectors do not match the closed schema",
    ]);

    const impossibleOverlay = structuredClone(vectors) as unknown as {
      graph_overlay: { after: { tag: string; value: string | null } }[];
    };
    impossibleOverlay.graph_overlay[0]!.after = {
      tag: "null",
      value: null,
    };
    expect(
      validateProvenanceV2ConnectedDocumentCascadeVectors(impossibleOverlay),
    ).toEqual([
      "connected document cascade vectors do not match the closed schema",
    ]);

    const malformedFrame = structuredClone(vectors) as unknown as {
      candidate_authority_frame: {
        fields: { tag: string; value: string }[];
      };
    };
    malformedFrame.candidate_authority_frame.fields.find(
      (field) => field.tag === "digest",
    )!.value = "sha256:bad";
    expect(
      validateProvenanceV2ConnectedDocumentCascadeVectors(malformedFrame),
    ).toEqual([
      "connected document cascade vectors do not match the closed schema",
    ]);
  });
});
