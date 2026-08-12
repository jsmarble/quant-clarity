import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
  validateProvenanceV2RootBindingPlan,
} from "./index.js";

const clone = <T>(value: T): T => structuredClone(value);

describe("provenance-v2 root binding plan", () => {
  it("closes every digest and root-member count exactly once", () => {
    expect(
      validateProvenanceV2RootBindingPlan(PROVENANCE_V2_ROOT_BINDING_PLAN),
    ).toEqual([]);

    const digestKeys = PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.flatMap(
      (entry) =>
        entry.fields.flatMap((field) =>
          field.hash_class === null ? [] : [`${entry.table}.${field.name}`],
        ),
    );
    expect(
      PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.map(
        (item) => `${item.table}.${item.field}`,
      ),
    ).toHaveLength(digestKeys.length);
    expect(
      new Set(
        PROVENANCE_V2_ROOT_BINDING_PLAN.count_bindings.map(
          (item) => item.table,
        ),
      ).size,
    ).toBe(
      PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.filter(
        (entry) => entry.disposition === "root_member",
      ).length,
    );
  });

  it("separates leaf, document, external, row, collection, and frame trust", () => {
    const digestBindings =
      PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings as unknown as readonly {
        readonly binding: { readonly kind: string };
      }[];
    expect(new Set(digestBindings.map((item) => item.binding.kind))).toEqual(
      new Set([
        "leaf_output",
        "document_value",
        "retained_bytes",
        "external_row_digest",
        "repository_artifact",
        "row_digest",
        "collection_digest",
        "record_frame_digest",
        "frame_output",
      ]),
    );
    expect(
      PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.find(
        (item) => item.field === "prompt_hash",
      )?.binding,
    ).toMatchObject({
      kind: "repository_artifact",
      null_result: "paired_null",
      require_tracked: true,
      build_manifest_status: "pending_reviewed_manifest",
    });
    expect(PROVENANCE_V2_ROOT_BINDING_PLAN.traversal_contract).toEqual({
      member_projection_domain: "provenance-v2-traversal-member@1",
      member_projection_fields: [
        "source_ordinal:integer",
        "family_tag:text",
        "member_digest:digest",
      ],
      source_order: "dense_source_ordinal_ascending",
      row_order: "complete_declared_order_tuple_ascending",
      collection_frame:
        "scope_fields_then_total_member_count_then_projected_member_digests",
      caller_order_authoritative: false,
    });
    expect(
      PROVENANCE_V2_ROOT_BINDING_PLAN.count_bindings.find(
        (item) =>
          item.table === "provenance_v2_field_policy_endpoint_admission",
      )?.binding,
    ).toMatchObject({
      kind: "document_filtered_array_length",
      predicate: { member_field: "disposition", equals: "admitted" },
    });
    expect(
      PROVENANCE_V2_ROOT_BINDING_PLAN.count_bindings.find(
        (item) => item.table === "provenance_v2_field_path_vocabulary",
      )?.binding,
    ).toMatchObject({
      kind: "contract_sequence_length",
      artifact: "contracts/generated/provenance-v2/field-corpus.v1.json",
    });

    const documentBytes = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.find(
      (item) => item.field === "document_hash",
    )?.binding;
    const chunkBytes = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.find(
      (item) => item.field === "chunk_hash",
    )?.binding as
      | {
          readonly kind: string;
          readonly source: {
            readonly kind: string;
            readonly bytes_column: string;
            readonly joins: readonly {
              readonly local_column: string;
              readonly remote_column: string;
            }[];
          };
        }
      | undefined;
    expect(documentBytes).toMatchObject({
      kind: "retained_bytes",
      source: {
        kind: "contiguous_chunk_sequence",
        bytes_column: "chunk_bytes",
        ordinal_column: "ordinal",
        offset_column: "byte_offset",
      },
    });
    if (
      chunkBytes?.kind !== "retained_bytes" ||
      chunkBytes.source.kind !== "exact_row_blob"
    )
      throw new Error("fixture lacks exact chunk byte binding");
    expect(chunkBytes.source.bytes_column).toBe("chunk_bytes");
    expect(chunkBytes.source.joins).toContainEqual({
      local_column: "ordinal",
      remote_column: "ordinal",
    });
  });

  it("types scalar/map selectors and every ownership scope explicitly", () => {
    const enumDigest = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.find(
      (item) =>
        item.table === "provenance_v2_source_endpoint_parameter_enum" &&
        item.field === "value_hash",
    )?.binding as
      | {
          readonly kind: string;
          readonly selectors: readonly {
            readonly wildcard_ordinal: number;
            readonly kind: string;
            readonly row_column: string;
          }[];
        }
      | undefined;
    if (enumDigest?.kind !== "document_value")
      throw new Error("fixture lacks enum document binding");
    expect(enumDigest.selectors).toContainEqual({
      wildcard_ordinal: 2,
      kind: "array_index_by_ordinal",
      row_column: "ordinal",
    });
    expect(
      PROVENANCE_V2_ROOT_BINDING_PLAN.count_bindings.find(
        (item) => item.table === "provenance_v2_field_path_enum_value",
      )?.binding,
    ).toMatchObject({
      kind: "contract_sequence_length",
      selectors: [
        {
          kind: "object_key_via_array_lookup",
          row_column: "field_path",
          lookup_array_pointer: "/fields",
          lookup_match_field: "field_path",
          lookup_value_field: "enum_domain",
        },
      ],
    });

    const fieldPolicy = PROVENANCE_V2_ROOT_BINDING_PLAN.traversals.find(
      (item) => item.name === "field_policy_set_root",
    );
    expect(fieldPolicy).toBeDefined();
    expect(
      fieldPolicy?.sources.filter(
        (source) => source.scope_binding.kind === "global_contract",
      ),
    ).toHaveLength(5);
    expect(
      fieldPolicy?.sources.filter(
        (source) => source.scope_binding.kind === "plan_scope",
      ),
    ).toHaveLength(7);

    const authorityFrame = PROVENANCE_V2_ROOT_BINDING_PLAN.record_frames.find(
      (item) => item.name === "authority_root",
    );
    expect(
      authorityFrame?.fields.find((field) => field.name === "environment")
        ?.source,
    ).toMatchObject({
      kind: "row_column",
      lookup: [
        { table: "provenance_v2_authority_plan" },
        { table: "provenance_v2_installation_identity" },
      ],
    });
    expect(
      PROVENANCE_V2_ROOT_BINDING_PLAN.successor_claim_bindings.every(
        (item) => item.scope_joins.length === 2,
      ),
    ).toBe(true);
  });

  it("rejects duplicate, missing, unknown, and class-substituted bindings", () => {
    const duplicate = clone(PROVENANCE_V2_ROOT_BINDING_PLAN) as unknown as {
      digest_bindings: unknown[];
    };
    duplicate.digest_bindings.push(clone(duplicate.digest_bindings[0]));
    expect(validateProvenanceV2RootBindingPlan(duplicate)).toContain(
      "digest bindings contain a duplicate table and field key",
    );

    const missing = clone(PROVENANCE_V2_ROOT_BINDING_PLAN) as unknown as {
      digest_bindings: unknown[];
    };
    missing.digest_bindings.pop();
    expect(validateProvenanceV2RootBindingPlan(missing)).toContain(
      "every registry digest requires exactly one binding",
    );

    const substituted = clone(PROVENANCE_V2_ROOT_BINDING_PLAN) as unknown as {
      digest_bindings: {
        hash_class: string;
        binding: { kind: string };
      }[];
    };
    const safe = substituted.digest_bindings.find(
      (item) => item.hash_class === "safe_preimage",
    );
    if (safe === undefined) throw new Error("fixture lacks safe digest");
    safe.binding = { kind: "leaf_output" };
    expect(validateProvenanceV2RootBindingPlan(substituted)).toContain(
      "digest binding kind is incompatible with its hash class",
    );

    const targetSubstitution = clone(
      PROVENANCE_V2_ROOT_BINDING_PLAN,
    ) as unknown as {
      count_bindings: { binding: { kind: string; column?: string } }[];
    };
    const rowInteger = targetSubstitution.count_bindings.find(
      (item) => item.binding.kind === "row_integer",
    );
    if (rowInteger === undefined) throw new Error("fixture lacks row count");
    rowInteger.binding.column = "created_at_ms";
    expect(validateProvenanceV2RootBindingPlan(targetSubstitution)).toContain(
      "root binding plan must equal the reviewed canonical singleton",
    );
  });

  it("rejects traversal order drift, cycles, and unknown frame references", () => {
    const wrongOrder = clone(PROVENANCE_V2_ROOT_BINDING_PLAN) as unknown as {
      traversals: {
        sources: { order_by: unknown[] }[];
      }[];
    };
    const ordered = wrongOrder.traversals.find(
      (item) => (item.sources[0]?.order_by.length ?? 0) > 1,
    );
    if (ordered === undefined) throw new Error("fixture lacks ordered source");
    ordered.sources[0]?.order_by.reverse();
    expect(validateProvenanceV2RootBindingPlan(wrongOrder)).toContain(
      "traversal source order must equal the complete registry order",
    );

    const cycle = clone(PROVENANCE_V2_ROOT_BINDING_PLAN) as unknown as {
      traversals: {
        name: string;
        sources: {
          digest_source: string;
          child_traversal: string | null;
        }[];
      }[];
    };
    const node = cycle.traversals[0];
    if (node?.sources[0] === undefined)
      throw new Error("fixture lacks traversal source");
    node.sources[0].digest_source = "independently_recomputed_child_traversal";
    node.sources[0].child_traversal = node.name;
    expect(validateProvenanceV2RootBindingPlan(cycle)).toContain(
      "traversal graph must be closed and acyclic",
    );

    const unknownFrame = clone(PROVENANCE_V2_ROOT_BINDING_PLAN) as unknown as {
      digest_bindings: {
        binding: { kind: string; record_frame?: string };
      }[];
    };
    const frameBinding = unknownFrame.digest_bindings.find(
      (item) => item.binding.kind === "record_frame_digest",
    );
    if (frameBinding === undefined)
      throw new Error("fixture lacks frame binding");
    frameBinding.binding.record_frame = "missing_frame";
    expect(validateProvenanceV2RootBindingPlan(unknownFrame)).toContain(
      "digest binding references an unknown record frame",
    );

    const duplicateOwner = clone(
      PROVENANCE_V2_ROOT_BINDING_PLAN,
    ) as unknown as {
      traversals: {
        purpose: string;
        sources: unknown[];
      }[];
    };
    const planRoots = duplicateOwner.traversals.filter(
      (item) => item.purpose === "plan_root",
    );
    if (planRoots[0] === undefined || planRoots[1] === undefined)
      throw new Error("fixture lacks plan roots");
    planRoots[1].sources.push(clone(planRoots[0].sources[0]));
    expect(validateProvenanceV2RootBindingPlan(duplicateOwner)).toContain(
      "every root-member table requires one plan-root ownership path",
    );
  });

  it("binds every successor child count and root before its hash", () => {
    expect(
      PROVENANCE_V2_ROOT_BINDING_PLAN.successor_claim_bindings.map(
        (item) => item.field,
      ),
    ).toEqual([
      "source_owner_count",
      "source_owner_set_root",
      "source_register_member_count",
      "source_register_member_set_root",
      "source_register_receipt_hash",
      "environment_count",
      "environment_set_root",
      "credential_count",
      "credential_set_root",
      "source_count",
      "source_set_root",
    ]);
    const missing = clone(PROVENANCE_V2_ROOT_BINDING_PLAN) as unknown as {
      successor_claim_bindings: unknown[];
    };
    missing.successor_claim_bindings.pop();
    expect(validateProvenanceV2RootBindingPlan(missing)).toContain(
      "successor child claims require one exact binding",
    );
  });

  it("fails closed on hostile object inspection", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("must not escape validation");
        },
        ownKeys() {
          throw new Error("must not escape validation");
        },
      },
    );
    expect(validateProvenanceV2RootBindingPlan(hostile)).toEqual([
      "root binding plan must be plain acyclic data",
    ]);

    const accessor = clone(PROVENANCE_V2_ROOT_BINDING_PLAN) as object;
    Object.defineProperty(accessor, "status", {
      get: () => "review_candidate",
      enumerable: true,
    });
    expect(validateProvenanceV2RootBindingPlan(accessor)).toEqual([
      "root binding plan must be plain acyclic data",
    ]);

    expect(
      validateProvenanceV2RootBindingPlan(
        Object.create(PROVENANCE_V2_ROOT_BINDING_PLAN),
      ),
    ).toEqual(["root binding plan must be plain acyclic data"]);
  });
});
