import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS,
  validateProvenanceV2ExternalRowResolverVectors,
} from "./provenance-v2-external-row-resolver-vectors.js";
import { PROVENANCE_V2_ROOT_BINDING_PLAN } from "./provenance-v2-root-binding-plan.js";

const vectors = PROVENANCE_V2_EXTERNAL_ROW_RESOLVER_VECTORS;

const expectedBindings = [
  [
    "provenance_v2_source_register_receipt",
    "artifact_hash",
    "source_compliance_record",
    "artifact_hash",
    "provider_id:provider_id,register_version:register_version",
  ],
  [
    "provenance_v2_source_register_member",
    "artifact_hash",
    "source_compliance_record",
    "artifact_hash",
    "provider_id:provider_id,register_version:register_version",
  ],
  [
    "provenance_v2_adapter_manifest_receipt",
    "roster_content_hash",
    "publication_run_plan_provider",
    "roster_content_hash",
    "run_plan_id:run_plan_id,provider_id:provider_id",
  ],
  [
    "provenance_v2_adapter_manifest_receipt",
    "source_artifact_hash",
    "source_compliance_record",
    "artifact_hash",
    "provider_id:provider_id,source_register_version:register_version",
  ],
  [
    "provenance_v2_source_endpoint",
    "source_register_artifact_hash",
    "source_compliance_record",
    "artifact_hash",
    "provider_id:provider_id,source_register_version:register_version",
  ],
  [
    "provenance_v2_source_endpoint_registration",
    "source_register_artifact_hash",
    "source_compliance_record",
    "artifact_hash",
    "provider_id:provider_id,source_register_version:register_version",
  ],
  [
    "provenance_v2_authority_plan",
    "run_plan_hash",
    "publication_run_plan_seal",
    "plan_hash",
    "run_plan_id:run_plan_id",
  ],
] as const;

describe("provenance-v2 external-row resolver review vectors", () => {
  it("locks the exact seven external-row binding definitions", () => {
    const live = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings
      .filter(
        (entry) =>
          typeof entry.binding === "object" &&
          entry.binding !== null &&
          "kind" in entry.binding &&
          entry.binding.kind === "external_row_digest",
      )
      .map((entry) => {
        const binding = entry.binding as {
          table: string;
          digest_column: string;
          joins: readonly {
            local_column: string;
            remote_column: string;
          }[];
        };
        return [
          entry.table,
          entry.field,
          binding.table,
          binding.digest_column,
          binding.joins
            .map((join) => `${join.local_column}:${join.remote_column}`)
            .join(","),
        ];
      });

    expect(live).toEqual(expectedBindings);
    expect(
      vectors.binding_inventory.map((binding) => [
        binding.source_table,
        binding.source_field,
        binding.target_table,
        binding.target_digest_column,
        binding.joins
          .map((join) => `${join.local_column}:${join.remote_column}`)
          .join(","),
      ]),
    ).toEqual(expectedBindings);
  });

  it("freezes the five compliance, one roster, and one seal resolutions", () => {
    expect(vectors.evidence_counts).toEqual({
      binding_definitions: 7,
      graph_occurrences: 6,
      synthetic_authority_frame_occurrences: 1,
      total_resolutions: 7,
      witness_rows: 3,
      predicate_columns: 4,
      predicate_evaluations: 20,
    });
    expect(
      Object.fromEntries(
        [
          "source_compliance_record",
          "publication_run_plan_provider",
          "publication_run_plan_seal",
        ].map((table) => [
          table,
          vectors.resolutions.filter(
            (resolution) => resolution.target_table === table,
          ).length,
        ]),
      ),
    ).toEqual({
      source_compliance_record: 5,
      publication_run_plan_provider: 1,
      publication_run_plan_seal: 1,
    });
    expect(
      vectors.resolutions.reduce(
        (total, resolution) => total + resolution.predicate_evidence.length,
        0,
      ),
    ).toBe(20);
    expect(
      vectors.resolutions.map((resolution) => [
        resolution.match_count,
        resolution.digest_equal,
        resolution.resolved_digest === resolution.stored_digest,
      ]),
    ).toEqual(Array.from({ length: 7 }, () => [1, true, true]));
  });

  it("keeps the evidence dormant and non-authoritative", () => {
    expect(vectors).toMatchObject({
      status: "review_candidate",
      outcome: "authority_refused",
      authority_eligible: false,
      persisted: false,
      d1_read_executed: false,
      synthetic_external_row_resolver_executed: true,
      repository_artifact_resolver_executed: false,
      semantic_oracle_executed: false,
    });
    expect(vectors.authority_boundary).toEqual({
      predecessor_witness_authority:
        "synthetic_fixture_only_not_approved_d1_state",
      stored_digest_role: "comparison_claim_only",
      resolver_result_role: "review_evidence_only",
    });
    expect(new Set(Object.values(vectors.pending))).toEqual(
      new Set(["pending"]),
    );
  });

  it("validates only the reviewed singleton and never executes accessors", () => {
    expect(validateProvenanceV2ExternalRowResolverVectors()).toEqual([]);

    const changed = structuredClone(vectors) as unknown as {
      witness_rows: { fields: { value: string | number | boolean | null }[] }[];
    };
    changed.witness_rows[0]!.fields[2]!.value =
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    expect(validateProvenanceV2ExternalRowResolverVectors(changed)).toEqual([
      "external-row resolver vectors must equal the reviewed singleton",
    ]);

    let getterHits = 0;
    const accessor = structuredClone(vectors) as Record<string, unknown>;
    Object.defineProperty(accessor, "status", {
      enumerable: true,
      get() {
        getterHits += 1;
        return "review_candidate";
      },
    });
    expect(validateProvenanceV2ExternalRowResolverVectors(accessor)).toEqual([
      "external-row resolver vectors do not match the closed schema",
    ]);
    expect(getterHits).toBe(0);

    const prototypeKey = structuredClone(vectors) as Record<string, unknown>;
    Object.defineProperty(prototypeKey, "__proto__", {
      value: { smuggled: true },
      enumerable: true,
      configurable: true,
    });
    expect(
      validateProvenanceV2ExternalRowResolverVectors(prototypeKey),
    ).toEqual(["external-row resolver vectors do not match the closed schema"]);
  });
});
