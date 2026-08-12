import { describe, expect, it } from "vitest";

import {
  AdapterManifestSchema,
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  PROVENANCE_V2_AUTHORITY_ROOT_VECTORS,
  PROVENANCE_V2_FIELD_CORPUS,
  PROVENANCE_V2_SEMANTIC_POLICY,
  ProvenanceV2AdapterReceiptSchema,
  validateProvenanceV2ContractArtifacts,
  validateProvenanceV2RegistrationLimits,
} from "./index.js";

const clone = <T>(value: T): T => structuredClone(value);

describe("provenance-v2 registration contracts", () => {
  it("embeds the one canonical AdapterManifest schema authority", () => {
    expect(ProvenanceV2AdapterReceiptSchema.properties.legacy_manifest).toBe(
      AdapterManifestSchema,
    );
  });

  it("closes the 28 policy paths into four indivisible record groups", () => {
    expect(PROVENANCE_V2_FIELD_CORPUS.fields).toHaveLength(28);
    expect(PROVENANCE_V2_FIELD_CORPUS.record_groups).toHaveLength(4);
    expect(
      validateProvenanceV2ContractArtifacts(
        PROVENANCE_V2_AUTHORITY_ROOT_VECTORS,
      ),
    ).toEqual([]);

    for (const group of PROVENANCE_V2_FIELD_CORPUS.record_groups) {
      expect(
        PROVENANCE_V2_FIELD_CORPUS.fields
          .filter((field) => field.record_group === group.record_group)
          .map((field) => field.field_path),
      ).toEqual(group.field_paths);
    }
  });

  it("keeps provider API and catalog equal while forbidding unsafe primary classes", () => {
    expect(PROVENANCE_V2_SEMANTIC_POLICY.provider_structured_class).toEqual([
      "provider_exact_api",
      "provider_exact_authenticated_catalog",
    ]);
    expect(PROVENANCE_V2_SEMANTIC_POLICY.initial_primary_order_kind).toBe(
      "total",
    );
    expect(
      PROVENANCE_V2_SEMANTIC_POLICY.forbidden_primary_source_classes,
    ).toEqual(["publisher_checkpoint", "independent_structured_catalog"]);
  });

  it("classifies every registry digest and assigns every table exactly once", () => {
    const tableNames = PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.map(
      (entry) => entry.table,
    );
    expect(new Set(tableNames).size).toBe(tableNames.length);
    for (const entry of PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries) {
      for (const field of entry.fields) {
        expect(field.frame_type === "digest").toBe(field.hash_class !== null);
        if (field.hash_class !== null) expect(field.anchor).not.toBeNull();
      }
      expect(
        entry.fields.filter((field) => field.hash_class === "digest_output"),
      ).toHaveLength(entry.digest_output === null ? 0 : 1);
    }
  });

  it("requires accepted aggregate limits and evidence before plan authority", () => {
    const limits = {
      contract_version: "provenance-v2-registration-limits@1",
      acceptance_status: "benchmark_pending",
      evidence_artifact_hash: null,
      provider_count: 1,
      endpoint_count: 1,
      normalized_row_count: 100,
      canonical_document_bytes: 1_024,
      root_input_bytes: 4_096,
      parameter_enum_rows: 10,
      precedence_edges: 10,
      verifier_members: 10,
      raw_field_mappings: 10,
      document_chunks: 1,
      document_chunk_bytes: 1_024,
      oracle_result_pages: 1,
      oracle_d1_calls: 1,
      oracle_cpu_milliseconds: 1,
    } as const;
    expect(validateProvenanceV2RegistrationLimits(limits)).toEqual([]);
    expect(validateProvenanceV2RegistrationLimits(limits, true)).toEqual([
      "registration authority is disabled until a repository-pinned benchmark contract replaces benchmark_pending",
    ]);
    expect(
      validateProvenanceV2RegistrationLimits({
        ...limits,
        acceptance_status: "accepted",
      }),
    ).toEqual(["registration limits do not match the closed schema"]);
  });

  it("rejects corpus, registry, and vector drift", () => {
    const duplicateName = PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors[1].name;
    const vectors = {
      ...clone(PROVENANCE_V2_AUTHORITY_ROOT_VECTORS),
      vectors: PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors.map(
        (vector, index) => ({
          ...clone(vector),
          name: index === 0 ? duplicateName : vector.name,
        }),
      ),
    };
    expect(validateProvenanceV2ContractArtifacts(vectors)).toContain(
      "root vector names contains a duplicate",
    );

    const wrongDomain = {
      ...clone(PROVENANCE_V2_AUTHORITY_ROOT_VECTORS),
      vectors: PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors.map((vector) =>
        vector.registry_table === "provenance_v2_source_owner_receipt"
          ? { ...clone(vector), domain: "provenance-v2-wrong-domain@1" }
          : clone(vector),
      ),
    };
    expect(validateProvenanceV2ContractArtifacts(wrongDomain)).toContain(
      "provenance_v2_source_owner_receipt vector domain does not match registry",
    );

    expect(
      PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries
        .flatMap((entry) => entry.fields)
        .filter(
          (field) => field.frame_type === "digest" && field.hash_class === null,
        ),
    ).toEqual([]);
  });

  it("rejects accessors, exotic prototypes, and sparse arrays as contract data", () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "contract_version", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    expect(validateProvenanceV2RegistrationLimits(hostile)).toEqual([
      "registration limits must be plain data",
    ]);

    const sparse = new Array(2) as unknown as Record<string, unknown>;
    expect(validateProvenanceV2RegistrationLimits(sparse)).toEqual([
      "registration limits must be plain data",
    ]);

    const throwingProxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("must close validation");
        },
      },
    );
    expect(validateProvenanceV2RegistrationLimits(throwingProxy)).toEqual([
      "registration limits must be plain data",
    ]);

    const symbolData = { value: "plain" } as Record<PropertyKey, unknown>;
    symbolData[Symbol("hidden")] = "not JSON";
    expect(validateProvenanceV2RegistrationLimits(symbolData)).toEqual([
      "registration limits must be plain data",
    ]);
  });
});
