import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";

import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY,
  ProvenanceV2RepositoryArtifactInventorySchema,
  isProvenanceV2RepositoryLogicalPath,
  validateProvenanceV2RepositoryArtifactInventory,
} from "./provenance-v2-repository-artifact-inventory.js";
import { PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH } from "./provenance-v2-connected-registration-graph.js";
import { PROVENANCE_V2_ROOT_BINDING_PLAN } from "./provenance-v2-root-binding-plan.js";

describe("provenance-v2 repository artifact inventory", () => {
  it("freezes all ten binding paths without claiming a reviewed build manifest", () => {
    const inventory = PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY;
    expect(
      Value.Check(ProvenanceV2RepositoryArtifactInventorySchema, inventory),
    ).toBe(true);
    expect(validateProvenanceV2RepositoryArtifactInventory(inventory)).toEqual(
      [],
    );
    expect(inventory.evidence_counts).toEqual({
      binding_definitions: 10,
      document_path_executions: 5,
      literal_path_executions: 3,
      row_column_sources_pending: 2,
      paired_null_occurrences: 1,
      nonnull_path_occurrences: 7,
      present_tracked_witness_occurrences: 2,
      missing_required_file_occurrences: 5,
      distinct_present_files: 1,
      distinct_missing_paths: 5,
    });
    expect(inventory.resolutions).toHaveLength(10);
    expect(
      PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(
        (entry) =>
          (entry.binding as { readonly kind?: unknown }).kind ===
          "repository_artifact",
      ),
    ).toHaveLength(10);
    expect(inventory.reviewed_build_manifest_complete).toBe(false);
    expect(inventory.binding_inventory_sha256).toBe(
      "sha256:f791d7c78ca4eb540358595d192f988a5e856994616d47fb5c7d9cd8704b843e",
    );
    expect(inventory.repository_artifact_resolver_executed).toBe(false);
    expect(inventory.available_repository_path_programs_executed).toBe(true);
    expect(inventory.repository_path_resolver_executed).toBe(false);
    expect(inventory.authority_eligible).toBe(false);
    expect(inventory.outcome).toBe("authority_refused");
    expect(inventory.authority_boundary.approvals_invented).toBe(false);
  });

  it("pins the deterministic procedure to its compliance-document namespace", () => {
    const resolution =
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.resolutions.find(
        (entry) => entry.source_field === "deterministic_procedure_hash",
      );
    expect(resolution).toMatchObject({
      logical_path:
        "docs/compliance/provenance-v2/deterministic-procedure.json",
      allowed_prefix: "docs/compliance/provenance-v2/",
      path_safe_and_within_prefix: true,
      resolution_status: "missing_required_file",
    });
  });

  it("proves exact bytes and tracked regular-file status for the sole present witness", () => {
    const [entry] =
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.partial_build_witness.entries;
    expect(entry).toBeDefined();
    const bytes = readFileSync(entry.logical_path);
    const metadata = lstatSync(entry.logical_path);
    expect(metadata.isFile()).toBe(true);
    expect(metadata.isSymbolicLink()).toBe(false);
    expect(bytes.byteLength).toBe(entry.byte_length);
    expect(bytes.toString("hex")).toBe(entry.exact_bytes_hex);
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(
      entry.sha256,
    );
    expect(
      execFileSync("git", ["ls-files", "--error-unmatch", entry.logical_path], {
        encoding: "utf8",
      }).trim(),
    ).toBe(entry.logical_path);
  });

  it("separates present, missing, paired-null, and missing-row outcomes", () => {
    const groups = Object.groupBy(
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.resolutions,
      (entry) => entry.resolution_status,
    );
    expect(groups.present_tracked_witness).toHaveLength(2);
    expect(groups.missing_required_file).toHaveLength(5);
    expect(groups.paired_null).toHaveLength(1);
    expect(groups.missing_source_row).toHaveLength(2);
    expect(
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.missing_required_paths,
    ).toEqual([
      "docs/compliance/source-relationships/connected.json",
      "docs/compliance/endpoints/connected.json",
      "packages/pipeline/src/provenance-v2-verifier.ts",
      "docs/compliance/provenance-v2/deterministic-procedure.json",
      "packages/pipeline/src/provenance-v2-oracle.ts",
    ]);
    for (const path of PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.missing_required_paths) {
      try {
        lstatSync(path);
        throw new Error("declared missing repository path exists");
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    }
    for (const resolution of PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY.resolutions.filter(
      (entry) => entry.resolution_status === "missing_source_row",
    ))
      expect(
        PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows.filter(
          (row) =>
            row.table === resolution.source_table &&
            row.fields.some((field) => field.name === resolution.source_field),
        ),
      ).toHaveLength(0);
  });

  it("rejects traversal, prefix lookalikes, URLs, and ambiguous separators", () => {
    const prefix = "docs/compliance/provenance-v2/";
    expect(
      isProvenanceV2RepositoryLogicalPath(
        "docs/compliance/provenance-v2/review.json",
        prefix,
      ),
    ).toBe(true);
    for (const candidate of [
      "/docs/compliance/provenance-v2/review.json",
      "docs/compliance/provenance-v2/../secret",
      "docs/compliance/provenance-v2//review.json",
      "docs/compliance/provenance-v2\\review.json",
      "docs/compliance/provenance-v2-lookalike/review.json",
      "https://example.invalid/review.json",
      "docs/compliance/provenance-v2/review.json?token=x",
    ])
      expect(isProvenanceV2RepositoryLogicalPath(candidate, prefix)).toBe(
        false,
      );
    for (const malformedPrefix of [
      "",
      "packages",
      "/packages/",
      "packages//",
      "packages/../",
      "https://example.invalid/",
    ])
      expect(
        isProvenanceV2RepositoryLogicalPath(
          "packages-evil/provenance-v2-oracle.ts",
          malformedPrefix,
        ),
      ).toBe(false);
  });

  it("fails closed for drift and hostile plain-data shapes", () => {
    const drifted = structuredClone(
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY,
    ) as unknown as { pending: { semantic_oracle: string } };
    drifted.pending.semantic_oracle = "complete";
    expect(validateProvenanceV2RepositoryArtifactInventory(drifted)).toEqual([
      "repository artifact inventory does not match its closed schema",
    ]);

    const polluted = structuredClone(
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY,
    ) as object;
    Object.defineProperty(polluted, "__proto__", {
      value: { authority_eligible: true },
      enumerable: true,
    });
    expect(validateProvenanceV2RepositoryArtifactInventory(polluted)).toEqual([
      "repository artifact inventory does not match its closed schema",
    ]);

    let getterHits = 0;
    const accessor = structuredClone(
      PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY,
    ) as Record<string, unknown>;
    Object.defineProperty(accessor, "status", {
      get() {
        getterHits += 1;
        return "review_candidate";
      },
      enumerable: true,
    });
    expect(validateProvenanceV2RepositoryArtifactInventory(accessor)).toEqual([
      "repository artifact inventory does not match its closed schema",
    ]);
    expect(getterHits).toBe(0);

    const descriptorTrap = new Proxy(
      structuredClone(PROVENANCE_V2_REPOSITORY_ARTIFACT_INVENTORY),
      {
        getOwnPropertyDescriptor() {
          throw new Error("hostile descriptor");
        },
      },
    );
    expect(() =>
      validateProvenanceV2RepositoryArtifactInventory(descriptorTrap),
    ).not.toThrow();
    expect(
      validateProvenanceV2RepositoryArtifactInventory(descriptorTrap),
    ).toEqual([
      "repository artifact inventory does not match its closed schema",
    ]);
  });
});
