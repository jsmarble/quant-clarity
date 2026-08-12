import { describe, expect, it } from "vitest";

import {
  AdapterManifestSchema,
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  PROVENANCE_V2_AUTHORITY_ROOT_VECTORS,
  PROVENANCE_V2_FIELD_CORPUS,
  PROVENANCE_V2_SEMANTIC_POLICY,
  PROVENANCE_V2_SUCCESSOR_MANIFEST_CONTRACT,
  ProvenanceV2AdapterReceiptSchema,
  isProvenanceV2PathTemplateCandidate,
  isProvenanceV2RawLocatorCandidate,
  isProvenanceV2RegistrationHostCandidate,
  isProvenanceV2SafeLocatorCandidate,
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

  it("defines the successor commitment as exact canonical bytes", () => {
    expect(PROVENANCE_V2_SUCCESSOR_MANIFEST_CONTRACT).toMatchObject({
      contract_version: "provenance-v2-successor-manifest-preimage@1",
      status: "review_candidate",
      schema: "ProvenanceV2SuccessorManifest",
      canonical_json_version: "quantclarity-canonical-json@1",
      caller_roots_authoritative: false,
      field_inclusion: "every schema property exactly once; no exclusions",
    });
  });

  it("fails closed on unsafe registration hosts, paths, and raw locators", () => {
    expect(isProvenanceV2RegistrationHostCandidate("api.provider.dev")).toBe(
      true,
    );
    for (const host of [
      "localhost",
      "127.0.0.1",
      "api.local",
      "example.com",
      "xn--invalid-.dev",
      "xn--80ak6aa92e.com",
      "service.onion",
      "home.arpa",
      "localhost.localdomain",
    ])
      expect(isProvenanceV2RegistrationHostCandidate(host)).toBe(false);

    expect(
      isProvenanceV2PathTemplateCandidate("/v1/{model}", [
        { parameter_name: "model", location: "path", required: true },
      ]),
    ).toBe(true);
    expect(isProvenanceV2PathTemplateCandidate("/v1/../admin", [])).toBe(false);
    expect(isProvenanceV2PathTemplateCandidate("/v1/%2fadmin", [])).toBe(false);
    expect(isProvenanceV2SafeLocatorCandidate("/v1/models")).toBe(true);
    expect(isProvenanceV2SafeLocatorCandidate("/v1/{model}")).toBe(false);
    expect(
      isProvenanceV2RawLocatorCandidate(
        "json_pointer_pattern@1",
        "/data/~*/price",
      ),
    ).toBe(true);
    expect(
      isProvenanceV2RawLocatorCandidate(
        "json_pointer_pattern@1",
        "/~*/~*/price",
      ),
    ).toBe(false);
    expect(
      isProvenanceV2RawLocatorCandidate("json_pointer_pattern@1", "$.data[*]"),
    ).toBe(false);
  });

  it("closes the 32 policy paths into four indivisible record groups", () => {
    expect(PROVENANCE_V2_FIELD_CORPUS.fields).toHaveLength(32);
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
    expect(
      PROVENANCE_V2_FIELD_CORPUS.fields.find(
        (field) => field.field_path === "precision.component.component_label",
      ),
    ).toMatchObject({
      nullability: "nullable",
      requirement_state: "conditional",
      condition: "required_iff_component_kind_other",
    });
    expect(
      PROVENANCE_V2_FIELD_CORPUS.enum_domains.precision_component_kind,
    ).not.toContain("offering");
    expect(
      PROVENANCE_V2_FIELD_CORPUS.fields.find(
        (field) =>
          field.field_path === "offering.applicability.component_scope",
      )?.enum_domain,
    ).toBe("component_scope");
    expect(
      PROVENANCE_V2_FIELD_CORPUS.fields.find(
        (field) => field.field_path === "precision.component.component_kind",
      )?.enum_domain,
    ).toBe("precision_component_kind");
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
