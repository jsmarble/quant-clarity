import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_COMPOSITE_ROOT_VECTORS,
  validateProvenanceV2CompositeRootVectors,
} from "./index.js";

const clone = <T>(value: T): T => structuredClone(value);

describe("provenance-v2 composite root vector contract", () => {
  it("is a closed, authority-refused family-composition review candidate", () => {
    expect(
      validateProvenanceV2CompositeRootVectors(
        PROVENANCE_V2_COMPOSITE_ROOT_VECTORS,
      ),
    ).toEqual([]);
    expect(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS).toMatchObject({
      status: "review_candidate",
      authority_eligible: false,
      outcome: "authority_refused",
      pending: {
        resolver_closure: "pending",
        semantic_oracle: "pending",
        repository_build_manifest: "pending",
        migration_schema_parity: "pending",
        accepted_aggregate_limits: "pending",
      },
    });
    expect(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.traversals).toHaveLength(9);
    expect(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.leaf_vector_names).toHaveLength(
      33,
    );
  });

  it("rejects missing families, binding substitutions, and digest drift", () => {
    const missing = clone(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS) as unknown as {
      leaf_vector_names: string[];
    };
    missing.leaf_vector_names.pop();
    expect(validateProvenanceV2CompositeRootVectors(missing)).toContain(
      "composite root vectors do not match their closed schema",
    );

    const substituted = clone(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS,
    ) as unknown as {
      traversals: {
        ordered_members: { family_tag: string; projection_digest: string }[];
      }[];
    };
    const member = substituted.traversals[0]?.ordered_members[0];
    if (member === undefined) throw new Error("fixture lacks member");
    member.family_tag = "wrong_family";
    expect(validateProvenanceV2CompositeRootVectors(substituted)).toContain(
      "composite traversal must exactly bind the reviewed plan",
    );

    const digestDrift = clone(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS,
    ) as unknown as {
      authority_root: { sha256: string };
    };
    digestDrift.authority_root.sha256 = `sha256:${"00".repeat(32)}`;
    expect(validateProvenanceV2CompositeRootVectors(digestDrift)).toContain(
      "composite root vectors must equal the reviewed canonical singleton",
    );
  });

  it("fails closed before inspecting accessors, prototypes, and cycles", () => {
    let getterHits = 0;
    const accessor = clone(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS) as object;
    Object.defineProperty(accessor, "status", {
      enumerable: true,
      get: () => {
        getterHits += 1;
        return "review_candidate";
      },
    });
    expect(validateProvenanceV2CompositeRootVectors(accessor)).toEqual([
      "composite root vectors must be plain acyclic data",
    ]);
    expect(getterHits).toBe(0);
    expect(
      validateProvenanceV2CompositeRootVectors(
        Object.create(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS),
      ),
    ).toEqual(["composite root vectors must be plain acyclic data"]);

    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(validateProvenanceV2CompositeRootVectors(cycle)).toEqual([
      "composite root vectors must be plain acyclic data",
    ]);

    let proxyGetHits = 0;
    const proxy = new Proxy(clone(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS), {
      get() {
        proxyGetHits += 1;
        throw new Error("hostile get");
      },
    });
    expect(() => validateProvenanceV2CompositeRootVectors(proxy)).not.toThrow();
    expect(proxyGetHits).toBe(0);

    const sparse = clone(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS) as unknown as {
      leaf_vector_names: string[];
    };
    Reflect.deleteProperty(sparse.leaf_vector_names, "1");
    expect(validateProvenanceV2CompositeRootVectors(sparse)).toEqual([
      "composite root vectors must be plain acyclic data",
    ]);

    const oversized = Array.from({ length: 129 }, () => null);
    expect(validateProvenanceV2CompositeRootVectors(oversized)).toEqual([
      "composite root vectors must be plain acyclic data",
    ]);
  });
});
