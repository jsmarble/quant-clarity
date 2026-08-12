import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS,
  ProvenanceV2ConnectedTraversalVectorsSchema,
  validateProvenanceV2ConnectedTraversalVectors,
} from "./index.js";

const vectors = PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS;

describe("provenance v2 connected traversal vectors", () => {
  it("is a closed dormant review-candidate artifact", () => {
    expect(
      Value.Check(ProvenanceV2ConnectedTraversalVectorsSchema, vectors),
    ).toBe(true);
    expect(validateProvenanceV2ConnectedTraversalVectors(vectors)).toEqual([]);
    expect(
      validateProvenanceV2ConnectedTraversalVectors(structuredClone(vectors)),
    ).toEqual([]);
    expect(vectors).toMatchObject({
      status: "review_candidate",
      authority_eligible: false,
      outcome: "authority_refused",
      persisted: false,
      semantic_oracle_executed: false,
    });
    expect(Object.keys(vectors.pending)).toHaveLength(7);
  });

  it("pins exact row, projection, traversal, and unresolved-input counts", () => {
    expect(vectors.evidence_counts).toEqual({
      root_member_rows: 371,
      leaf_outputs: 371,
      plan_root_projections: 371,
      provider_claim_projections: 15,
      total_projections: 386,
      traversal_instances: 9,
      derived_digest_substitutions: 3,
      unresolved_safe_preimage_digests: 30,
      unresolved_external_anchor_digests: 10,
    });
    expect(vectors.traversals.map((item) => item.member_count)).toEqual([
      1, 1, 1, 11, 1, 17, 73, 3, 278,
    ]);
    expect(vectors.derived_digest_substitutions).toHaveLength(3);
  });

  it("links only computed collection slots into the synthetic authority frame", () => {
    const computed = vectors.candidate_authority_frame.fields.filter(
      (field) => field.resolution === "computed_collection",
    );
    expect(computed.map((field) => field.name)).toEqual([
      "adapter_manifest_set_root",
      "endpoint_set_root",
      "verifier_policy_set_root",
      "field_policy_set_root",
    ]);
    expect(
      vectors.candidate_refused_receipt_frame.fields.find(
        (field) => field.name === "authority_root",
      ),
    ).toMatchObject({
      resolution: "computed_frame",
      value: vectors.candidate_authority_frame.sha256,
    });
  });

  it("fails closed without reading accessors or hostile Proxy properties", () => {
    let getterHits = 0;
    const accessor = structuredClone(vectors) as Record<string, unknown>;
    Object.defineProperty(accessor, "status", {
      enumerable: true,
      get() {
        getterHits += 1;
        return "review_candidate";
      },
    });
    expect(validateProvenanceV2ConnectedTraversalVectors(accessor)).toEqual([
      "connected traversal vectors do not match their closed schema",
    ]);
    expect(getterHits).toBe(0);

    const proxy = new Proxy(structuredClone(vectors), {
      ownKeys() {
        throw new Error("hostile ownKeys trap");
      },
    });
    expect(validateProvenanceV2ConnectedTraversalVectors(proxy)).toEqual([
      "connected traversal vectors do not match their closed schema",
    ]);
  });

  it("rejects enumerable prototype-key smuggling", () => {
    const candidate = structuredClone(vectors) as Record<string, unknown>;
    Object.defineProperty(candidate, "__proto__", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: { smuggled: true },
    });
    expect(validateProvenanceV2ConnectedTraversalVectors(candidate)).toEqual([
      "connected traversal vectors do not match their closed schema",
    ]);
  });
});
