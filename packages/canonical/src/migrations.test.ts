import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { compareExactDecimal } from "@quant-clarity/domain";

import { canonicalPrice } from "./index.js";

const HASH = `sha256:${"a".repeat(64)}`;
const OTHER_HASH = `sha256:${"b".repeat(64)}`;
const VECTOR_ID = "c".repeat(64);
const OTHER_VECTOR_ID = "d".repeat(64);

function id(prefix: string, sequence: number): string {
  return `${prefix}_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;
}

function applyMigrations(
  directory: "canonical" | "serving",
  through?: string,
): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const migrationDirectory = resolve("migrations", directory);
  for (const filename of readdirSync(migrationDirectory).sort()) {
    if (through !== undefined && filename > through) continue;
    applyAtomicMigration(
      database,
      readFileSync(resolve(migrationDirectory, filename), "utf8"),
    );
  }
  return database;
}

function applyAtomicMigration(database: DatabaseSync, sql: string): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(sql);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function applyServingProviderDispositionMigration(
  database: DatabaseSync,
): void {
  applyAtomicMigration(
    database,
    readFileSync(
      resolve(
        "migrations",
        "serving",
        "0003_publication_provider_dispositions.sql",
      ),
      "utf8",
    ),
  );
}

function applyServingSealedClosureMigration(database: DatabaseSync): void {
  applyAtomicMigration(
    database,
    readFileSync(
      resolve("migrations", "serving", "0004_sealed_publication_closure.sql"),
      "utf8",
    ),
  );
}

function expectConstraint(action: () => unknown, message?: string): void {
  expect(action).toThrow(
    message ?? /constraint|mismatch|immutable|cannot|lacks|does not equal/iu,
  );
}

interface Seed {
  acquisitionRunId: string;
  evidenceId: string;
  familyId: string;
  modelId: string;
  observationId: string;
  offeringId: string;
  organizationId: string;
  policyId: string;
  providerId: string;
  providerRunId: string;
  runId: string;
  scopeId: string;
}

function insertIdentity(
  database: DatabaseSync,
  resourceId: string,
  resourceType: string,
): void {
  database
    .prepare(
      "INSERT INTO resource_identity(resource_id, resource_type, created_at_ms) VALUES (?, ?, 1)",
    )
    .run(resourceId, resourceType);
}

function seedCanonical(database: DatabaseSync): Seed {
  const organizationId = id("org", 1);
  const familyId = id("fam", 2);
  const modelId = id("mdl", 3);
  const providerId = id("prv", 4);
  const offeringId = id("off", 5);
  for (const [resourceId, resourceType] of [
    [organizationId, "organization"],
    [familyId, "model_family"],
    [modelId, "model"],
    [providerId, "provider"],
    [offeringId, "offering"],
  ] as const)
    insertIdentity(database, resourceId, resourceType);

  database
    .prepare(
      "INSERT INTO organization VALUES (?, 'example-publisher', 'Example Publisher', 'example publisher', 'publisher', NULL, 1)",
    )
    .run(organizationId);
  database
    .prepare(
      "INSERT INTO model_family VALUES (?, 'example-family', 'Example Family', 'example family', NULL, 1)",
    )
    .run(familyId);
  database
    .prepare(
      "INSERT INTO model VALUES (?, ?, 'example-model', 'Example Model', 'example model', 'active', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1)",
    )
    .run(modelId, familyId);
  database
    .prepare(
      "INSERT INTO provider VALUES (?, NULL, 'example-provider', 'Example Provider', 'example provider', 'active', NULL, '[]', 1)",
    )
    .run(providerId);
  database
    .prepare(
      "INSERT INTO offering VALUES (?, ?, 'accounts/example/models/example-model', 'accounts/example/models/example-model', 'standard', 'serverless', '', ?, 'active', 1, NULL, '[]', 1)",
    )
    .run(offeringId, providerId, modelId);

  const scopeId = id("scp", 6);
  database
    .prepare(
      "INSERT INTO claim_scope VALUES (?, 'offering', ?, 'https://api.example.invalid/v1/models/example-model', 1, NULL, 1, ?, 'accounts/example/models/example-model', 'standard', 'serverless', '', NULL)",
    )
    .run(scopeId, offeringId, providerId);

  const policyId = id("pol", 7);
  database
    .prepare(
      "INSERT INTO policy_version VALUES (?, 'source_precedence', '1.0.0', 1, ?, 'active', NULL)",
    )
    .run(policyId, HASH);
  const pricePolicyId = id("pol", 8);
  database
    .prepare(
      "INSERT INTO policy_version VALUES (?, 'price_comparison', '1.0.0', 1, ?, 'active', NULL)",
    )
    .run(pricePolicyId, OTHER_HASH);

  database
    .prepare(
      "INSERT INTO source_compliance_record VALUES (?, 'register@1', 'docs/compliance/sources/example.json', ?, '[\"catalog\"]', 'legal reviewer', 1, 100000, 'approved', 1, 1, 1, 1, '', '', 1)",
    )
    .run(providerId, HASH);
  database
    .prepare("INSERT INTO provider_roster VALUES (?, 'roster@1', ?, 1)")
    .run(providerId, HASH);
  database
    .prepare(
      "INSERT INTO provider_roster_item VALUES (?, 'roster@1', 'item-1', 'accounts/example/models/example-model', 'standard', 'serverless', '', ?)",
    )
    .run(providerId, modelId);

  const occurrenceId = id("occ", 9);
  const runId = id("run", 10);
  const providerRunId = id("pvr", 11);
  const acquisitionRunId = id("src", 12);
  database
    .prepare(
      "INSERT INTO schedule_occurrence VALUES (?, 1, '0 5 * * 1,4', 'monday-thursday', 1)",
    )
    .run(occurrenceId);
  database
    .prepare(
      "INSERT INTO pipeline_run VALUES (?, ?, 1, 'commit', '1.0.0', '[\"example\"]', 'running', 1, NULL, NULL, NULL, NULL, 1)",
    )
    .run(runId, occurrenceId);
  database
    .prepare(
      "INSERT INTO provider_run VALUES (?, ?, ?, 'adapter@1', 'roster@1', 'register@1', 'running', 1, NULL, NULL, 1)",
    )
    .run(providerRunId, runId, providerId);
  database
    .prepare(
      "INSERT INTO acquisition_run VALUES (?, ?, ?, ?, 'provider_api', 'running', 1, NULL, 1)",
    )
    .run(acquisitionRunId, runId, providerRunId, organizationId);

  const observationId = id("obs", 13);
  const evidenceId = id("evd", 14);
  database
    .prepare(
      "INSERT INTO observation VALUES (?, ?, 'catalog', 'provider_api', 'Example Provider', 'https://api.example.invalid/v1/models/redacted', 2, 'deterministic_json', 'parser@1', ?, ?, NULL, 1, 2)",
    )
    .run(observationId, acquisitionRunId, policyId, HASH);
  database
    .prepare(
      "INSERT INTO evidence VALUES (?, ?, 'local-fixture/example.json', '{}', '/models/0', ?, 'private_24_month_minimum', NULL, 2)",
    )
    .run(evidenceId, observationId, HASH);

  return {
    acquisitionRunId,
    evidenceId,
    familyId,
    modelId,
    observationId,
    offeringId,
    organizationId,
    policyId,
    providerId,
    providerRunId,
    runId,
    scopeId,
  };
}

function insertClaim(
  database: DatabaseSync,
  seed: Seed,
  input: {
    claimId: string;
    fieldName: string;
    normalized?: string;
    scopeId?: string;
    subjectId?: string;
    verificationState?: string;
  },
): void {
  const normalized = input.normalized ?? "1";
  database
    .prepare(
      "INSERT INTO field_claim VALUES (?, ?, ?, json(?), json(?), 'known', ?, ?, ?, 'exact_provider_api', ?, ?, ?, NULL, NULL, '{}', 2)",
    )
    .run(
      input.claimId,
      input.subjectId ?? seed.offeringId,
      input.fieldName,
      JSON.stringify(normalized),
      JSON.stringify(normalized),
      seed.observationId,
      seed.evidenceId,
      input.scopeId ?? seed.scopeId,
      input.verificationState ?? "verified",
      seed.policyId,
      2,
    );
}

describe("canonical D1 migrations (DATA-001–DATA-067, BE-001–BE-006)", () => {
  it("applies every migration with foreign-key integrity", () => {
    const database = applyMigrations("canonical");
    const violations = database.prepare("PRAGMA foreign_key_check").all();
    expect(violations).toEqual([]);
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "resource_identity",
        "claim_scope",
        "field_claim",
        "precision_observation",
        "price_schedule",
        "source_compliance_record",
        "roster_outcome",
      ]),
    );
  });

  it("enforces resource registry and polymorphic target types", () => {
    const database = applyMigrations("canonical");
    const modelId = id("mdl", 100);
    insertIdentity(database, modelId, "model");
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO provider VALUES (?, NULL, 'wrong', 'Wrong', 'wrong', 'active', NULL, '[]', 1)",
          )
          .run(modelId),
      "provider identity type mismatch",
    );
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO offering VALUES (?, ?, 'x', 'x', 'standard', 'serverless', '', ?, 'active', 1, NULL, NULL, 1)",
        )
        .run(id("off", 101), id("prv", 102), modelId),
    );
  });

  it("keeps offering identities exact, immutable, and collision-free", () => {
    const database = applyMigrations("canonical");
    const seed = seedCanonical(database);
    const duplicate = id("off", 101);
    insertIdentity(database, duplicate, "offering");
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO offering VALUES (?, ?, 'different-raw-spelling', 'accounts/example/models/example-model', 'standard', 'serverless', '', ?, 'active', 1, NULL, NULL, 1)",
        )
        .run(duplicate, seed.providerId, seed.modelId),
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE offering SET tier_key = 'priority' WHERE offering_id = ?",
          )
          .run(seed.offeringId),
      "offering identity tuple is immutable",
    );
  });

  it("rejects wildcard, broader, and mismatched offering scopes", () => {
    const database = applyMigrations("canonical");
    const seed = seedCanonical(database);
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO claim_scope VALUES (?, 'offering', ?, '/models/0', 1, NULL, 1, ?, 'accounts/example/models/example-model', '*', 'serverless', '', NULL)",
        )
        .run(id("scp", 101), seed.offeringId, seed.providerId),
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO claim_scope VALUES (?, 'offering', ?, '/models/0', 1, NULL, 1, ?, 'accounts/example/models/example-model', 'priority', 'serverless', '', NULL)",
          )
          .run(id("scp", 102), seed.offeringId, seed.providerId),
      "offering scope does not equal offering identity",
    );

    const modelScopeId = id("scp", 103);
    database
      .prepare(
        "INSERT INTO claim_scope VALUES (?, 'model', ?, '/models/0', 1, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL)",
      )
      .run(modelScopeId, seed.modelId);
    expectConstraint(() => {
      insertClaim(database, seed, {
        claimId: id("clm", 104),
        fieldName: "price.input",
        scopeId: modelScopeId,
        subjectId: seed.modelId,
      });
    }, "price or precision claim lacks exact offering scope");
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE claim_scope SET tier_key = 'priority' WHERE scope_id = ?",
          )
          .run(seed.scopeId),
      "claim scope is append-only",
    );
  });

  it("requires evidence from the same observation and append-only claims", () => {
    const database = applyMigrations("canonical");
    const seed = seedCanonical(database);
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO field_claim VALUES (?, ?, 'status', 'null', 'null', 'known', ?, ?, ?, 'provider_api', 'verified', ?, 2, NULL, NULL, '{}', 2)",
        )
        .run(
          id("clm", 110),
          seed.offeringId,
          seed.observationId,
          seed.evidenceId,
          seed.scopeId,
          seed.policyId,
        ),
    );

    const claimId = id("clm", 111);
    insertClaim(database, seed, { claimId, fieldName: "status" });
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE field_claim SET verification_state = 'rejected' WHERE claim_id = ?",
          )
          .run(claimId),
      "field claim is append-only",
    );
    expectConstraint(
      () =>
        database
          .prepare("DELETE FROM evidence WHERE evidence_id = ?")
          .run(seed.evidenceId),
      "evidence cannot be deleted",
    );
  });

  it("binds identity and lineage pointers to verified typed claims", () => {
    const database = applyMigrations("canonical");
    const seed = seedCanonical(database);
    const modelScopeId = id("scp", 160);
    database
      .prepare(
        "INSERT INTO claim_scope VALUES (?, 'model', ?, '/models/0', 1, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL)",
      )
      .run(modelScopeId, seed.modelId);

    const candidateReleaseClaimId = id("clm", 161);
    insertClaim(database, seed, {
      claimId: candidateReleaseClaimId,
      fieldName: "release_date",
      normalized: "2026-01-01",
      scopeId: modelScopeId,
      subjectId: seed.modelId,
      verificationState: "candidate",
    });
    expectConstraint(
      () =>
        database
          .prepare("UPDATE model SET release_claim_id = ? WHERE model_id = ?")
          .run(candidateReleaseClaimId, seed.modelId),
      "model claim pointer mismatch",
    );

    const wrongSubjectClaimId = id("clm", 162);
    insertClaim(database, seed, {
      claimId: wrongSubjectClaimId,
      fieldName: "publisher",
    });
    expectConstraint(
      () =>
        database
          .prepare("UPDATE model SET publisher_claim_id = ? WHERE model_id = ?")
          .run(wrongSubjectClaimId, seed.modelId),
      "model claim pointer mismatch",
    );

    const releaseClaimId = id("clm", 163);
    insertClaim(database, seed, {
      claimId: releaseClaimId,
      fieldName: "release_date",
      normalized: "2026-01-01",
      scopeId: modelScopeId,
      subjectId: seed.modelId,
    });
    database
      .prepare("UPDATE model SET release_claim_id = ? WHERE model_id = ?")
      .run(releaseClaimId, seed.modelId);

    const checkpointId = id("chk", 164);
    insertIdentity(database, checkpointId, "checkpoint");
    database
      .prepare(
        "INSERT INTO checkpoint VALUES (?, ?, 'publisher/checkpoint', 'publisher_original', NULL, NULL, NULL, NULL, NULL, NULL, 2)",
      )
      .run(checkpointId, seed.organizationId);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO model_checkpoint VALUES (?, ?, ?, 'authoritative_source', ?, 2)",
          )
          .run(id("mck", 165), seed.modelId, checkpointId, releaseClaimId),
      "model checkpoint claim pointer mismatch",
    );
    const roleClaimId = id("clm", 166);
    insertClaim(database, seed, {
      claimId: roleClaimId,
      fieldName: "role",
      normalized: "authoritative_source",
      scopeId: modelScopeId,
      subjectId: seed.modelId,
    });
    database
      .prepare(
        "INSERT INTO model_checkpoint VALUES (?, ?, ?, 'authoritative_source', ?, 2)",
      )
      .run(id("mck", 167), seed.modelId, checkpointId, roleClaimId);

    const derivedCheckpointId = id("chk", 168);
    insertIdentity(database, derivedCheckpointId, "checkpoint");
    database
      .prepare(
        "INSERT INTO checkpoint VALUES (?, ?, 'publisher/derived', 'publisher_quantized_variant', NULL, NULL, NULL, NULL, NULL, NULL, 2)",
      )
      .run(derivedCheckpointId, seed.organizationId);
    const checkpointScopeId = id("scp", 169);
    database
      .prepare(
        "INSERT INTO claim_scope VALUES (?, 'checkpoint', ?, '/lineage/0', 1, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL)",
      )
      .run(checkpointScopeId, checkpointId);
    const wrongRelationshipClaimId = id("clm", 170);
    insertClaim(database, seed, {
      claimId: wrongRelationshipClaimId,
      fieldName: "relationship",
      normalized: "quantized_from",
      scopeId: checkpointScopeId,
      subjectId: checkpointId,
    });
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO checkpoint_edge VALUES (?, ?, ?, 'derived_from', ?, 2)",
          )
          .run(
            id("edg", 171),
            checkpointId,
            derivedCheckpointId,
            wrongRelationshipClaimId,
          ),
      "checkpoint edge claim pointer mismatch",
    );
    const relationshipClaimId = id("clm", 172);
    insertClaim(database, seed, {
      claimId: relationshipClaimId,
      fieldName: "relationship",
      normalized: "derived_from",
      scopeId: checkpointScopeId,
      subjectId: checkpointId,
    });
    database
      .prepare(
        "INSERT INTO checkpoint_edge VALUES (?, ?, ?, 'derived_from', ?, 2)",
      )
      .run(
        id("edg", 173),
        checkpointId,
        derivedCheckpointId,
        relationshipClaimId,
      );
  });

  it("enforces exact price and precision applicability", () => {
    const database = applyMigrations("canonical");
    const seed = seedCanonical(database);
    const priceClaimId = id("clm", 120);
    insertClaim(database, seed, {
      claimId: priceClaimId,
      fieldName: "price.input",
      normalized: "0.2",
    });
    const price = canonicalPrice("0.20", null);
    database
      .prepare(
        "INSERT INTO price_schedule VALUES (?, ?, 'input', 'standard', ?, ?, ?, ?, 'omitted', 'per_million_tokens', '[]', ?, 1, ?, ?, 2, NULL, NULL, 2)",
      )
      .run(
        id("pcs", 121),
        seed.offeringId,
        price.amountDecimal,
        price.amountSortKey,
        price.currency,
        price.currencyProvenance,
        HASH,
        id("pol", 8),
        priceClaimId,
      );
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO price_schedule VALUES (?, ?, 'input', 'standard', '0.20', '000000000000000000000000.200000000000000000', 'EUR', 'system_default', 'omitted', 'per_million_tokens', '[]', ?, 1, ?, ?, 2, NULL, NULL, 2)",
        )
        .run(
          id("pcs", 122),
          seed.offeringId,
          OTHER_HASH,
          id("pol", 8),
          id("clm", 123),
        ),
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE price_schedule SET amount_decimal = '1' WHERE price_id = ?",
          )
          .run(id("pcs", 121)),
      "price schedule is immutable",
    );

    const precisionClaimId = id("clm", 124);
    insertClaim(database, seed, {
      claimId: precisionClaimId,
      fieldName: "serving_precision",
      normalized: "FP8",
    });
    database
      .prepare(
        "INSERT INTO precision_observation VALUES (?, ?, ?, 'FP8', 'FP8', 'precision', 'FP8', ?, NULL, NULL, 2)",
      )
      .run(id("prc", 125), seed.offeringId, precisionClaimId, seed.scopeId);
    const mismatchedPrecisionClaimId = id("clm", 129);
    insertClaim(database, seed, {
      claimId: mismatchedPrecisionClaimId,
      fieldName: "serving_precision",
      normalized: "BF16",
    });
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO precision_observation VALUES (?, ?, ?, 'FP8', 'FP8', 'precision', 'FP8', ?, NULL, NULL, 2)",
          )
          .run(
            id("prc", 130),
            seed.offeringId,
            mismatchedPrecisionClaimId,
            seed.scopeId,
          ),
      "precision applicability mismatch",
    );

    const componentScopeId = id("scp", 126);
    database
      .prepare(
        "INSERT INTO claim_scope VALUES (?, 'offering', ?, '/models/0/precision/weights', 1, NULL, 1, ?, 'accounts/example/models/example-model', 'standard', 'serverless', '', 'weights')",
      )
      .run(componentScopeId, seed.offeringId, seed.providerId);
    const candidateClaimId = id("clm", 127);
    insertClaim(database, seed, {
      claimId: candidateClaimId,
      fieldName: "serving_precision.weights",
      normalized: "FP8",
      scopeId: componentScopeId,
      verificationState: "candidate",
    });
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO precision_component VALUES (?, ?, 'weights', 'FP8', NULL, ?, 2)",
          )
          .run(id("cmp", 128), id("prc", 125), candidateClaimId),
      "precision component applicability mismatch",
    );
  });

  it("requires current source approval and complete terminal rosters", () => {
    const database = applyMigrations("canonical");
    const seed = seedCanonical(database);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE provider_run SET status = 'succeeded', ended_at_ms = 3 WHERE provider_run_id = ?",
          )
          .run(seed.providerRunId),
      "provider run has nonterminal acquisitions",
    );
    database
      .prepare(
        "UPDATE acquisition_run SET status = 'succeeded', ended_at_ms = 3 WHERE acquisition_run_id = ?",
      )
      .run(seed.acquisitionRunId);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE provider_run SET status = 'succeeded', ended_at_ms = 3 WHERE provider_run_id = ?",
          )
          .run(seed.providerRunId),
      "provider run has missing roster outcomes",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE pipeline_run SET status = 'succeeded', ended_at_ms = 3 WHERE run_id = ?",
          )
          .run(seed.runId),
      "pipeline run has nonterminal children",
    );
    database
      .prepare(
        "INSERT INTO roster_outcome VALUES (?, ?, ?, 'roster@1', 'item-1', 'published_candidate_with_unknowns', ?, ?, NULL, 1, 2)",
      )
      .run(
        id("out", 130),
        seed.providerRunId,
        seed.providerId,
        seed.evidenceId,
        seed.offeringId,
      );
    database
      .prepare(
        "UPDATE provider_run SET status = 'succeeded', ended_at_ms = 3 WHERE provider_run_id = ?",
      )
      .run(seed.providerRunId);
    expect(
      database
        .prepare("SELECT status FROM provider_run WHERE provider_run_id = ?")
        .get(seed.providerRunId),
    ).toEqual({ status: "succeeded" });
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE provider_run SET status = 'running', ended_at_ms = NULL WHERE provider_run_id = ?",
          )
          .run(seed.providerRunId),
      "terminal provider run is immutable",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE provider_run SET error_summary_json = '{}' WHERE provider_run_id = ?",
          )
          .run(seed.providerRunId),
      "terminal provider run is immutable",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE provider_run SET adapter_version = 'adapter@2' WHERE provider_run_id = ?",
          )
          .run(seed.providerRunId),
      "provider run provenance is immutable",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "DELETE FROM provider_roster_item WHERE provider_id = ? AND roster_version = 'roster@1' AND roster_item_id = 'item-1'",
          )
          .run(seed.providerId),
      "provider roster item cannot be deleted",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE roster_outcome SET attempt_count = 2 WHERE provider_run_id = ?",
          )
          .run(seed.providerRunId),
      "roster outcome is append-only",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO provider_roster_item VALUES (?, 'roster@1', 'late-item', 'late-model', 'standard', 'serverless', '', ?)",
          )
          .run(seed.providerId, seed.modelId),
      "referenced provider roster cannot grow",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO acquisition_run VALUES (?, ?, ?, ?, 'provider_api', 'running', 4, NULL, 4)",
          )
          .run(
            id("src", 131),
            seed.runId,
            seed.providerRunId,
            seed.organizationId,
          ),
      "acquisition and provider run mismatch",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO observation VALUES (?, ?, 'catalog', 'provider_api', 'Example', 'https://example.invalid/post-terminal', 5, 'deterministic', 'parser@1', ?, ?, NULL, 0, 5)",
          )
          .run(id("obs", 132), seed.acquisitionRunId, seed.policyId, HASH),
      "observation and acquisition source type mismatch",
    );
  });

  it("ties acquisitions and observations to immutable run provenance", () => {
    const database = applyMigrations("canonical");
    const seed = seedCanonical(database);
    const occurrenceId = id("occ", 150);
    const otherRunId = id("run", 151);
    database
      .prepare(
        "INSERT INTO schedule_occurrence VALUES (?, 2, 'manual', 'manual', 1)",
      )
      .run(occurrenceId);
    database
      .prepare(
        "INSERT INTO pipeline_run VALUES (?, ?, 1, 'commit', '1.0.0', '[]', 'running', 2, NULL, NULL, NULL, NULL, 2)",
      )
      .run(otherRunId, occurrenceId);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO acquisition_run VALUES (?, ?, ?, ?, 'provider_api', 'running', 2, NULL, 2)",
          )
          .run(
            id("src", 152),
            otherRunId,
            seed.providerRunId,
            seed.organizationId,
          ),
      "acquisition and provider run mismatch",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO observation VALUES (?, ?, 'catalog', 'public_static_page', 'Example', 'https://example.invalid/model', 3, 'deterministic', 'parser@1', ?, ?, NULL, 0, 3)",
          )
          .run(id("obs", 153), seed.acquisitionRunId, seed.policyId, HASH),
      "observation and acquisition source type mismatch",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO observation VALUES (?, ?, 'unapproved-source', 'provider_api', 'Example', 'https://example.invalid/model', 3, 'deterministic', 'parser@1', ?, ?, NULL, 0, 3)",
          )
          .run(id("obs", 154), seed.acquisitionRunId, seed.policyId, HASH),
      "observation source is not in the approved register",
    );
    database
      .prepare(
        "INSERT INTO source_compliance_record VALUES (?, 'register@no-excerpt', 'docs/compliance/sources/no-excerpt.json', ?, '[\"catalog\"]', 'legal reviewer', 1, 100000, 'approved', 1, 1, 0, 1, '', '', 1)",
      )
      .run(seed.providerId, OTHER_HASH);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO provider_run VALUES (?, ?, ?, 'adapter@1', 'roster@1', 'register@no-excerpt', 'running', 2, NULL, NULL, 2)",
          )
          .run(id("pvr", 155), otherRunId, seed.providerId),
      "provider run lacks current source approval",
    );
    database
      .prepare(
        "UPDATE acquisition_run SET status = 'succeeded', ended_at_ms = 4 WHERE acquisition_run_id = ?",
      )
      .run(seed.acquisitionRunId);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO observation VALUES (?, ?, 'catalog', 'provider_api', 'Example', 'https://example.invalid/late', 5, 'deterministic', 'parser@1', ?, ?, NULL, 0, 5)",
          )
          .run(id("obs", 156), seed.acquisitionRunId, seed.policyId, HASH),
      "observation and acquisition source type mismatch",
    );
    expectConstraint(
      () =>
        database
          .prepare("DELETE FROM acquisition_run WHERE acquisition_run_id = ?")
          .run(seed.acquisitionRunId),
      "acquisition run cannot be deleted",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE acquisition_run SET source_type = 'public_static_page' WHERE acquisition_run_id = ?",
          )
          .run(seed.acquisitionRunId),
      "acquisition run provenance is immutable",
    );
  });

  it("rejects malformed hashes and non-canonical decimal storage", () => {
    const database = applyMigrations("canonical");
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO policy_version VALUES (?, 'normalization', 'bad', 1, ?, 'draft', NULL)",
        )
        .run(id("pol", 140), `sha256:${"G".repeat(64)}`),
    );
    const seed = seedCanonical(database);
    const claimId = id("clm", 141);
    insertClaim(database, seed, {
      claimId,
      fieldName: "price.input",
      normalized: "1",
    });
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO price_schedule VALUES (?, ?, 'input', 'standard', ?, ?, 'USD', 'provider_stated', 'omitted', 'per_million_tokens', '[]', ?, 1, ?, ?, 2, NULL, NULL, 2)",
        )
        .run(
          id("pcs", 142),
          seed.offeringId,
          `1.${"0".repeat(19)}`,
          `000000000000000000000001.${"0".repeat(18)}`,
          HASH,
          id("pol", 8),
          claimId,
        ),
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO price_schedule VALUES (?, ?, 'input', 'standard', '1', '000000000000000000000002.000000000000000000', 'USD', 'provider_stated', 'stated', 'per_million_tokens', '[]', ?, 1, ?, ?, 2, NULL, NULL, 2)",
          )
          .run(id("pcs", 143), seed.offeringId, HASH, id("pol", 8), claimId),
      "price amount and sort key do not round-trip",
    );
  });

  it("preserves exact decimal ordering as fixed-width lexical ordering", () => {
    const digits = fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 18 })
      .map((values) => values.join(""));
    const decimal = fc
      .tuple(
        fc.bigInt({ min: 0n, max: 999_999_999_999_999_999_999_999n }),
        fc.option(digits, { nil: undefined }),
      )
      .map(([integer, fraction]) =>
        fraction === undefined
          ? integer.toString()
          : `${integer.toString()}.${fraction}`,
      );
    fc.assert(
      fc.property(decimal, decimal, (left, right) => {
        const numeric = Math.sign(compareExactDecimal(left, right));
        const leftKey = canonicalPrice(left, "USD").amountSortKey;
        const rightKey = canonicalPrice(right, "USD").amountSortKey;
        expect(Math.sign(leftKey.localeCompare(rightKey))).toBe(numeric);
      }),
      { numRuns: 500 },
    );
  });
});

describe("serving publication migrations (PIPE-050–PIPE-056)", () => {
  function insertBuildingPublication(
    database: DatabaseSync,
    publicationId: string,
    counts = { resources: 1, exactDocuments: 1, vectorDocuments: 1 },
    parentPublicationId: string | null = null,
    generatedAtMs = 1,
  ): void {
    database
      .prepare(
        "INSERT INTO publication VALUES (?, 'building', '1.0.0', '1.0.0', 'precision@1', 'display@1', 'price@1', 'source@1', 'embedding@1', 'commit', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 'vector@1', ?, '[]', ?)",
      )
      .run(
        publicationId,
        id("run", 200),
        parentPublicationId,
        generatedAtMs,
        counts.resources,
        counts.exactDocuments,
        counts.vectorDocuments,
        HASH,
        OTHER_HASH,
        generatedAtMs,
      );
  }

  it("upgrades selected and unavailable legacy dispositions without inventing identity", () => {
    const database = applyMigrations(
      "serving",
      "0002_publication_integrity.sql",
    );
    const selectedPublicationId = id("pub", 180);
    const unavailablePublicationId = id("pub", 181);
    insertBuildingPublication(database, selectedPublicationId, {
      resources: 0,
      exactDocuments: 0,
      vectorDocuments: 0,
    });
    insertBuildingPublication(database, unavailablePublicationId, {
      resources: 0,
      exactDocuments: 0,
      vectorDocuments: 0,
    });
    const selectedSliceId = id("prn", 182);
    const fictitiousUnavailableSliceId = id("prn", 183);
    database
      .prepare(
        "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(
        selectedSliceId,
        selectedPublicationId,
        id("prv", 184),
        id("pvr", 185),
      );
    database
      .prepare(
        "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, 0, 'unavailable')",
      )
      .run(
        fictitiousUnavailableSliceId,
        unavailablePublicationId,
        id("prv", 186),
        id("pvr", 187),
      );

    applyServingProviderDispositionMigration(database);

    expect(
      database
        .prepare(
          "SELECT provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state FROM publication_provider_slice ORDER BY publication_id",
        )
        .all(),
    ).toEqual([
      {
        provider_slice_id: selectedSliceId,
        publication_id: selectedPublicationId,
        provider_id: id("prv", 184),
        provider_run_id: id("pvr", 185),
        carried_forward: 0,
        freshness_state: "fresh",
      },
      {
        provider_slice_id: null,
        publication_id: unavailablePublicationId,
        provider_id: id("prv", 186),
        provider_run_id: id("pvr", 187),
        carried_forward: 0,
        freshness_state: "unavailable",
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.1.0" });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      (
        database
          .prepare("PRAGMA index_list('publication_provider_slice')")
          .all() as { name: string; partial: number }[]
      ).some(
        (index) =>
          index.name === "publication_provider_slice_identity_idx" &&
          index.partial === 1,
      ),
    ).toBe(true);
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%publication_provider_slice_v2%'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("rejects a legacy active empty head before mutating its schema", () => {
    const database = applyMigrations(
      "serving",
      "0002_publication_integrity.sql",
    );
    const publicationId = id("pub", 175);
    insertBuildingPublication(
      database,
      publicationId,
      { resources: 0, exactDocuments: 0, vectorDocuments: 0 },
      null,
      1,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, 0, 'unavailable')",
      )
      .run(id("prn", 176), publicationId, id("prv", 177), id("pvr", 178));
    database
      .prepare(
        "UPDATE publication SET state = 'ready', ready_at_ms = 2 WHERE publication_id = ?",
      )
      .run(publicationId);
    database
      .prepare(
        "UPDATE publication SET state = 'active', activated_at_ms = 3 WHERE publication_id = ?",
      )
      .run(publicationId);
    database
      .prepare("INSERT INTO publication_head VALUES (1, ?, NULL, 3, 1)")
      .run(publicationId);

    expect(() => {
      applyServingProviderDispositionMigration(database);
    }).toThrow();

    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.0.0" });
    expect(
      database
        .prepare(
          "SELECT active_publication_id, generation FROM publication_head WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ active_publication_id: publicationId, generation: 1 });
    expect(
      (
        database
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'publication_provider_slice'",
          )
          .get() as { sql: string }
      ).sql,
    ).toContain("TEXT PRIMARY KEY");
  });

  it("rejects unprovable legacy carried lineage before mutating its schema", () => {
    const database = applyMigrations(
      "serving",
      "0002_publication_integrity.sql",
    );
    const publicationId = id("pub", 179);
    insertBuildingPublication(database, publicationId, {
      resources: 0,
      exactDocuments: 0,
      vectorDocuments: 0,
    });
    database
      .prepare(
        "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, 1, 'fresh')",
      )
      .run(id("prn", 180), publicationId, id("prv", 181), id("pvr", 182));

    expect(() => {
      applyServingProviderDispositionMigration(database);
    }).toThrow();

    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.0.0" });
    expect(
      database
        .prepare(
          "SELECT carried_forward, freshness_state FROM publication_provider_slice WHERE publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({ carried_forward: 1, freshness_state: "fresh" });
  });

  it("rejects unexpected legacy schema metadata before rebuilding tables", () => {
    const database = applyMigrations(
      "serving",
      "0002_publication_integrity.sql",
    );
    database
      .prepare(
        "UPDATE serving_schema_metadata SET schema_version = 'unexpected' WHERE singleton = 1",
      )
      .run();

    expect(() => {
      applyServingProviderDispositionMigration(database);
    }).toThrow();

    expect(
      (
        database
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'publication_provider_slice'",
          )
          .get() as { sql: string }
      ).sql,
    ).toContain("TEXT PRIMARY KEY");
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'publication_provider_slice_v2'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("rejects malformed legacy identities before rebuilding tables", () => {
    const database = applyMigrations(
      "serving",
      "0002_publication_integrity.sql",
    );
    const publicationId = id("pub", 183);
    insertBuildingPublication(database, publicationId, {
      resources: 0,
      exactDocuments: 0,
      vectorDocuments: 0,
    });
    database
      .prepare(
        "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(
        id("prn", 184),
        publicationId,
        "prv_00000000-0000-5000-8000-000000000001",
        id("pvr", 185),
      );

    expect(() => {
      applyServingProviderDispositionMigration(database);
    }).toThrow();

    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.0.0" });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'publication_provider_slice_v2'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("persists an unavailable disposition but rejects an empty candidate as ready", () => {
    const database = applyMigrations(
      "serving",
      "0003_publication_provider_dispositions.sql",
    );
    const activePublicationId = id("pub", 170);
    const activeModelId = id("mdl", 171);
    insertBuildingPublication(database, activePublicationId);
    database
      .prepare(
        "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(id("prn", 172), activePublicationId, id("prv", 173), id("pvr", 174));
    database
      .prepare(
        "INSERT INTO publication_resource VALUES (?, 'model', ?, '{}', ?)",
      )
      .run(activePublicationId, activeModelId, HASH);
    database
      .prepare(
        "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, 'active', '[]', '', '[]', 'active model', ?)",
      )
      .run(activePublicationId, VECTOR_ID, activeModelId, HASH);
    database
      .prepare(
        "UPDATE publication SET state = 'ready', ready_at_ms = 2 WHERE publication_id = ?",
      )
      .run(activePublicationId);
    database
      .prepare(
        "UPDATE publication SET state = 'active', activated_at_ms = 3 WHERE publication_id = ?",
      )
      .run(activePublicationId);
    database
      .prepare("INSERT INTO publication_head VALUES (1, ?, NULL, 3, 1)")
      .run(activePublicationId);

    const publicationId = id("pub", 188);
    const providerId = id("prv", 189);
    const providerRunId = id("pvr", 190);
    insertBuildingPublication(database, publicationId, {
      resources: 0,
      exactDocuments: 0,
      vectorDocuments: 0,
    });
    database
      .prepare(
        "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (NULL, ?, ?, ?, 0, 'unavailable')",
      )
      .run(publicationId, providerId, providerRunId);
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (NULL, ?, ?, ?, 0, 'unavailable')",
        )
        .run(publicationId, providerId, id("pvr", 191)),
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication_provider_slice SET provider_run_id = ? WHERE publication_id = ? AND provider_id = ?",
          )
          .run(id("pvr", 192), publicationId, providerId),
      "publication provider slice is immutable",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "DELETE FROM publication_provider_slice WHERE publication_id = ? AND provider_id = ?",
          )
          .run(publicationId, providerId),
      "publication provider slice cannot be deleted",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'ready', ready_at_ms = 2 WHERE publication_id = ?",
          )
          .run(publicationId),
      "publication closure counts are incomplete",
    );

    expect(
      database
        .prepare(
          "SELECT provider_slice_id, provider_run_id, carried_forward, freshness_state FROM publication_provider_slice WHERE publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({
      provider_slice_id: null,
      provider_run_id: providerRunId,
      carried_forward: 0,
      freshness_state: "unavailable",
    });
    expect(
      database
        .prepare("SELECT state FROM publication WHERE publication_id = ?")
        .get(publicationId),
    ).toEqual({ state: "building" });
    expect(
      database
        .prepare(
          "SELECT active_publication_id, generation FROM publication_head WHERE singleton = 1",
        )
        .get(),
    ).toEqual({
      active_publication_id: activePublicationId,
      generation: 1,
    });
  });

  it.each([
    ["unavailable with a slice", id("prn", 191), 0, "unavailable"],
    ["carried unavailable", null, 1, "unavailable"],
    ["fresh without a slice", null, 0, "fresh"],
    ["stale without a slice", null, 1, "stale"],
    ["non-carried stale", id("prn", 192), 0, "stale"],
  ])("rejects %s", (_case, providerSliceId, carriedForward, freshnessState) => {
    const database = applyMigrations(
      "serving",
      "0003_publication_provider_dispositions.sql",
    );
    const publicationId = id("pub", 193);
    insertBuildingPublication(database, publicationId, {
      resources: 0,
      exactDocuments: 0,
      vectorDocuments: 0,
    });
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          providerSliceId,
          publicationId,
          id("prv", 194),
          id("pvr", 195),
          carriedForward,
          freshnessState,
        ),
    );
  });

  it.each([
    [
      "slice UUID version",
      "prn_00000000-0000-5000-8000-000000000001",
      id("prv", 194),
      id("pvr", 195),
    ],
    [
      "provider UUID variant",
      id("prn", 194),
      "prv_00000000-0000-4000-7000-000000000001",
      id("pvr", 195),
    ],
    [
      "provider-run hexadecimal grammar",
      id("prn", 194),
      id("prv", 194),
      "pvr_0000000g-0000-4000-8000-000000000001",
    ],
  ])("rejects malformed %s", (_case, sliceId, providerId, providerRunId) => {
    const database = applyMigrations(
      "serving",
      "0003_publication_provider_dispositions.sql",
    );
    const publicationId = id("pub", 195);
    insertBuildingPublication(database, publicationId, {
      resources: 0,
      exactDocuments: 0,
      vectorDocuments: 0,
    });
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
        )
        .run(sliceId, publicationId, providerId, providerRunId),
    );
  });

  it("reuses selected content only with identical provider/run lineage", () => {
    const database = applyMigrations(
      "serving",
      "0003_publication_provider_dispositions.sql",
    );
    const providerSliceId = id("prn", 196);
    const providerId = id("prv", 197);
    const providerRunId = id("pvr", 198);
    const firstPublicationId = id("pub", 199);
    const secondPublicationId = id("pub", 200);
    const thirdPublicationId = id("pub", 201);
    const fourthPublicationId = id("pub", 202);
    insertBuildingPublication(database, firstPublicationId, {
      resources: 1,
      exactDocuments: 1,
      vectorDocuments: 1,
    });
    for (const [publicationId, generatedAtMs] of [
      [secondPublicationId, 4],
      [thirdPublicationId, 5],
      [fourthPublicationId, 6],
    ] as const)
      insertBuildingPublication(
        database,
        publicationId,
        { resources: 0, exactDocuments: 0, vectorDocuments: 0 },
        null,
        generatedAtMs,
      );
    database
      .prepare(
        "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(providerSliceId, firstPublicationId, providerId, providerRunId);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 1, 'fresh')",
          )
          .run(providerSliceId, secondPublicationId, providerId, providerRunId),
      "carried provider slice lacks a queryable prior publication",
    );
    const modelId = id("mdl", 204);
    database
      .prepare(
        "INSERT INTO publication_resource VALUES (?, 'model', ?, '{}', ?)",
      )
      .run(firstPublicationId, modelId, HASH);
    database
      .prepare(
        "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, 'lineage', '[]', '', '[]', 'lineage model', ?)",
      )
      .run(firstPublicationId, VECTOR_ID, modelId, HASH);
    database
      .prepare(
        "UPDATE publication SET state = 'ready', ready_at_ms = 2 WHERE publication_id = ?",
      )
      .run(firstPublicationId);
    database
      .prepare(
        "UPDATE publication SET state = 'active', activated_at_ms = 3 WHERE publication_id = ?",
      )
      .run(firstPublicationId);
    database
      .prepare(
        "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 1, 'stale')",
      )
      .run(providerSliceId, secondPublicationId, providerId, providerRunId);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
          )
          .run(providerSliceId, thirdPublicationId, providerId, providerRunId),
      "reused provider slice must be carried forward",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 1, 'fresh')",
          )
          .run(
            providerSliceId,
            thirdPublicationId,
            id("prv", 202),
            providerRunId,
          ),
      "provider slice lineage is inconsistent",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 1, 'fresh')",
          )
          .run(providerSliceId, thirdPublicationId, providerId, id("pvr", 203)),
      "provider slice lineage is inconsistent",
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 1, 'fresh')",
      )
      .run(providerSliceId, fourthPublicationId, providerId, providerRunId);
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_provider_slice WHERE provider_slice_id = ?",
        )
        .get(providerSliceId),
    ).toEqual({ count: 3 });
  });

  it("allows failed/building retries and fences both overlapping-build races", () => {
    const database = applyMigrations(
      "serving",
      "0003_publication_provider_dispositions.sql",
    );
    const providerSliceId = id("prn", 214);
    const providerId = id("prv", 215);
    const providerRunId = id("pvr", 216);
    const failedPublicationId = id("pub", 217);
    const winningPublicationId = id("pub", 218);
    const competingPublicationId = id("pub", 219);
    insertBuildingPublication(
      database,
      failedPublicationId,
      { resources: 0, exactDocuments: 0, vectorDocuments: 0 },
      null,
      1,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(providerSliceId, failedPublicationId, providerId, providerRunId);
    database
      .prepare(
        "UPDATE publication SET state = 'failed', failure_codes_json = '[\"candidate_failed\"]' WHERE publication_id = ?",
      )
      .run(failedPublicationId);

    for (const [publicationId, generatedAtMs] of [
      [winningPublicationId, 1],
      [competingPublicationId, 2],
    ] as const) {
      insertBuildingPublication(
        database,
        publicationId,
        { resources: 1, exactDocuments: 1, vectorDocuments: 1 },
        null,
        generatedAtMs,
      );
      database
        .prepare(
          "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
        )
        .run(providerSliceId, publicationId, providerId, providerRunId);
      const modelId =
        publicationId === winningPublicationId
          ? id("mdl", 220)
          : id("mdl", 221);
      database
        .prepare(
          "INSERT INTO publication_resource VALUES (?, 'model', ?, '{}', ?)",
        )
        .run(publicationId, modelId, HASH);
      database
        .prepare(
          "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, 'retry', '[]', '', '[]', 'retry model', ?)",
        )
        .run(
          publicationId,
          publicationId === winningPublicationId
            ? "e".repeat(64)
            : "f".repeat(64),
          modelId,
          HASH,
        );
    }

    database
      .prepare(
        "UPDATE publication SET state = 'ready', ready_at_ms = 3 WHERE publication_id = ?",
      )
      .run(winningPublicationId);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'ready', ready_at_ms = 3 WHERE publication_id = ?",
          )
          .run(competingPublicationId),
      "publication closure counts are incomplete",
    );
    expect(
      database
        .prepare("SELECT state FROM publication WHERE publication_id = ?")
        .get(competingPublicationId),
    ).toEqual({ state: "building" });
    database
      .prepare(
        "UPDATE publication SET state = 'active', activated_at_ms = 4 WHERE publication_id = ?",
      )
      .run(winningPublicationId);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'ready', ready_at_ms = 5 WHERE publication_id = ?",
          )
          .run(competingPublicationId),
      "publication closure counts are incomplete",
    );
    expect(
      database
        .prepare("SELECT state FROM publication WHERE publication_id = ?")
        .get(competingPublicationId),
    ).toEqual({ state: "building" });
  });

  it("rejects a slice occurrence from a future publication", () => {
    const database = applyMigrations(
      "serving",
      "0003_publication_provider_dispositions.sql",
    );
    const olderCandidateId = id("pub", 222);
    const futurePublicationId = id("pub", 223);
    const providerSliceId = id("prn", 224);
    const providerId = id("prv", 225);
    const providerRunId = id("pvr", 226);
    insertBuildingPublication(
      database,
      olderCandidateId,
      { resources: 0, exactDocuments: 0, vectorDocuments: 0 },
      null,
      1,
    );
    insertBuildingPublication(
      database,
      futurePublicationId,
      { resources: 1, exactDocuments: 1, vectorDocuments: 1 },
      null,
      100,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(providerSliceId, futurePublicationId, providerId, providerRunId);
    const modelId = id("mdl", 227);
    database
      .prepare(
        "INSERT INTO publication_resource VALUES (?, 'model', ?, '{}', ?)",
      )
      .run(futurePublicationId, modelId, HASH);
    database
      .prepare(
        "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, 'future', '[]', '', '[]', 'future model', ?)",
      )
      .run(futurePublicationId, "1".repeat(64), modelId, HASH);
    database
      .prepare(
        "UPDATE publication SET state = 'ready', ready_at_ms = 101 WHERE publication_id = ?",
      )
      .run(futurePublicationId);
    database
      .prepare(
        "UPDATE publication SET state = 'active', activated_at_ms = 102 WHERE publication_id = ?",
      )
      .run(futurePublicationId);

    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 1, 'fresh')",
          )
          .run(providerSliceId, olderCandidateId, providerId, providerRunId),
      "provider slice occurrence chronology is inconsistent",
    );
  });

  it("requires complete closure before a head can select a publication", () => {
    const database = applyMigrations(
      "serving",
      "0003_publication_provider_dispositions.sql",
    );
    const publicationId = id("pub", 201);
    const modelId = id("mdl", 202);
    insertBuildingPublication(database, publicationId);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'ready', ready_at_ms = 2 WHERE publication_id = ?",
          )
          .run(publicationId),
      "publication closure counts are incomplete",
    );
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, 0, 'stale')",
        )
        .run(id("prn", 203), publicationId, id("prv", 204), id("pvr", 205)),
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(id("prn", 203), publicationId, id("prv", 204), id("pvr", 205));
    database
      .prepare(
        "INSERT INTO publication_resource VALUES (?, 'model', ?, '{}', ?)",
      )
      .run(publicationId, modelId, HASH);
    database
      .prepare(
        "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, 'example', '[]', 'Publisher', '[]', 'example model', ?)",
      )
      .run(publicationId, VECTOR_ID, modelId, HASH);
    database
      .prepare(
        "UPDATE publication SET state = 'ready', ready_at_ms = 2 WHERE publication_id = ?",
      )
      .run(publicationId);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_provider_slice (provider_slice_id, publication_id, provider_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
          )
          .run(id("prn", 211), publicationId, id("prv", 212), id("pvr", 213)),
      "provider slices may be staged only while building",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'failed' WHERE publication_id = ?",
          )
          .run(publicationId),
      "invalid publication state transition",
    );
    expectConstraint(
      () =>
        database
          .prepare("INSERT INTO publication_head VALUES (1, ?, NULL, 2, 1)")
          .run(publicationId),
      "publication head must select an active publication",
    );
    database
      .prepare(
        "UPDATE publication SET state = 'active', activated_at_ms = 3 WHERE publication_id = ?",
      )
      .run(publicationId);
    database
      .prepare("INSERT INTO publication_head VALUES (1, ?, NULL, 3, 1)")
      .run(publicationId);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'superseded' WHERE publication_id = ?",
          )
          .run(publicationId),
      "active publication must be switched before demotion",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET activated_at_ms = 4 WHERE publication_id = ?",
          )
          .run(publicationId),
      "activation timestamp may change only on activation transition",
    );
    expectConstraint(
      () =>
        database
          .prepare("DELETE FROM publication_resource WHERE publication_id = ?")
          .run(publicationId),
      "publication resource cannot be deleted",
    );

    const nextPublicationId = id("pub", 206);
    const nextModelId = id("mdl", 207);
    insertBuildingPublication(
      database,
      nextPublicationId,
      { resources: 1, exactDocuments: 1, vectorDocuments: 1 },
      publicationId,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(id("prn", 208), nextPublicationId, id("prv", 209), id("pvr", 210));
    database
      .prepare(
        "INSERT INTO publication_resource VALUES (?, 'model', ?, '{}', ?)",
      )
      .run(nextPublicationId, nextModelId, HASH);
    database
      .prepare(
        "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, 'next', '[]', 'Publisher', '[]', 'next model', ?)",
      )
      .run(nextPublicationId, OTHER_VECTOR_ID, nextModelId, HASH);
    database
      .prepare(
        "UPDATE publication SET state = 'ready', ready_at_ms = 4 WHERE publication_id = ?",
      )
      .run(nextPublicationId);
    database
      .prepare(
        "UPDATE publication SET state = 'active', activated_at_ms = 5 WHERE publication_id = ?",
      )
      .run(nextPublicationId);

    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication_head SET active_publication_id = ?, rollback_candidate_publication_id = ?, switched_at_ms = 6, generation = 3 WHERE singleton = 1",
          )
          .run(nextPublicationId, publicationId),
      "publication head generation must increase by exactly one",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication_head SET active_publication_id = ?, rollback_candidate_publication_id = ?, switched_at_ms = 3, generation = 2 WHERE singleton = 1",
          )
          .run(nextPublicationId, publicationId),
      "publication head switch time must strictly increase",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication_head SET active_publication_id = ?, rollback_candidate_publication_id = NULL, switched_at_ms = 6, generation = 2 WHERE singleton = 1",
          )
          .run(nextPublicationId),
      "publication rollback candidate must equal former active publication",
    );

    database.exec("BEGIN");
    database
      .prepare(
        "UPDATE publication_head SET active_publication_id = ?, rollback_candidate_publication_id = ?, switched_at_ms = 6, generation = 2 WHERE singleton = 1",
      )
      .run(nextPublicationId, publicationId);
    database
      .prepare(
        "UPDATE publication SET state = 'superseded' WHERE publication_id = ?",
      )
      .run(publicationId);
    database.exec("COMMIT");
    expect(
      database.prepare("SELECT * FROM publication_head").get(),
    ).toMatchObject({
      active_publication_id: nextPublicationId,
      rollback_candidate_publication_id: publicationId,
      switched_at_ms: 6,
      generation: 2,
    });
    expect(
      database
        .prepare(
          "SELECT head.active_publication_id, publication.publication_id AS vector_namespace, publication.closure_hash AS manifest_hash, publication.activated_at_ms AS published_at_ms FROM publication_head AS head JOIN publication ON publication.publication_id = head.active_publication_id WHERE head.singleton = 1",
        )
        .get(),
    ).toEqual({
      active_publication_id: nextPublicationId,
      vector_namespace: nextPublicationId,
      manifest_hash: OTHER_HASH,
      published_at_ms: 5,
    });

    database.exec("BEGIN");
    database
      .prepare(
        "UPDATE publication SET state = 'active' WHERE publication_id = ?",
      )
      .run(publicationId);
    database
      .prepare(
        "UPDATE publication_head SET active_publication_id = ?, rollback_candidate_publication_id = ?, switched_at_ms = 7, generation = 3 WHERE singleton = 1",
      )
      .run(publicationId, nextPublicationId);
    database
      .prepare(
        "UPDATE publication SET state = 'rolled_back' WHERE publication_id = ?",
      )
      .run(nextPublicationId);
    database.exec("COMMIT");

    database.exec("BEGIN");
    database
      .prepare(
        "UPDATE publication SET state = 'active' WHERE publication_id = ?",
      )
      .run(nextPublicationId);
    database
      .prepare(
        "UPDATE publication_head SET active_publication_id = ?, rollback_candidate_publication_id = ?, switched_at_ms = 8, generation = 4 WHERE singleton = 1",
      )
      .run(nextPublicationId, publicationId);
    database
      .prepare(
        "UPDATE publication SET state = 'rolled_back' WHERE publication_id = ?",
      )
      .run(publicationId);
    database.exec("COMMIT");
    expect(
      database
        .prepare(
          "SELECT publication_id, state, closure_hash FROM publication ORDER BY publication_id",
        )
        .all(),
    ).toEqual([
      {
        publication_id: publicationId,
        state: "rolled_back",
        closure_hash: OTHER_HASH,
      },
      {
        publication_id: nextPublicationId,
        state: "active",
        closure_hash: OTHER_HASH,
      },
    ]);
    expect(
      database.prepare("SELECT * FROM publication_head").get(),
    ).toMatchObject({
      active_publication_id: nextPublicationId,
      rollback_candidate_publication_id: publicationId,
      switched_at_ms: 8,
      generation: 4,
    });
  });

  it("rejects resource type mismatches and post-readiness staging", () => {
    const database = applyMigrations(
      "serving",
      "0003_publication_provider_dispositions.sql",
    );
    const publicationId = id("pub", 210);
    insertBuildingPublication(database, publicationId);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_resource VALUES (?, 'model', ?, '{}', ?)",
          )
          .run(publicationId, id("prv", 211), HASH),
      "publication resource type and ID prefix disagree",
    );
    const modelId = id("mdl", 212);
    database
      .prepare(
        "INSERT INTO publication_resource VALUES (?, 'model', ?, '{}', ?)",
      )
      .run(publicationId, modelId, HASH);
    for (const invalidDocumentId of [
      "f".repeat(63),
      "F".repeat(64),
      "g".repeat(64),
    ])
      expectConstraint(() =>
        database
          .prepare(
            "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, 'one', '[]', '', '[]', 'one', ?)",
          )
          .run(publicationId, invalidDocumentId, modelId, HASH),
      );
    database
      .prepare(
        "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, 'one', '[]', '', '[]', 'one', ?)",
      )
      .run(publicationId, VECTOR_ID, modelId, HASH);
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, 'two', '[]', '', '[]', 'two', ?)",
        )
        .run(publicationId, OTHER_VECTOR_ID, modelId, OTHER_HASH),
    );
  });

  it("rejects a count-masked missing search document", () => {
    const database = applyMigrations(
      "serving",
      "0003_publication_provider_dispositions.sql",
    );
    const publicationId = id("pub", 220);
    insertBuildingPublication(database, publicationId, {
      resources: 2,
      exactDocuments: 1,
      vectorDocuments: 2,
    });
    database
      .prepare(
        "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(id("prn", 221), publicationId, id("prv", 222), id("pvr", 223));
    for (const modelId of [id("mdl", 224), id("mdl", 225)])
      database
        .prepare(
          "INSERT INTO publication_resource VALUES (?, 'model', ?, '{}', ?)",
        )
        .run(publicationId, modelId, HASH);
    database
      .prepare(
        "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, 'one', '[]', '', '[]', 'one', ?)",
      )
      .run(publicationId, VECTOR_ID, id("mdl", 224), HASH);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'ready', ready_at_ms = 2 WHERE publication_id = ?",
          )
          .run(publicationId),
      "publication closure counts are incomplete",
    );
  });

  it("adds the sealed-closure schema only to an unheaded non-queryable database", () => {
    const database = applyMigrations(
      "serving",
      "0004_sealed_publication_closure.sql",
    );
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.2.0" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'publication_%' ORDER BY name",
        )
        .all()
        .map((row) => (row as { name: string }).name),
    ).toEqual(
      expect.arrayContaining([
        "publication_closure_seal",
        "publication_inventory_chunk",
        "publication_provider_attribution",
        "publication_provider_slice_metadata",
        "publication_staging_revision",
        "publication_vector_inventory",
      ]),
    );
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("rejects legacy queryable state before changing schema metadata", () => {
    const database = applyMigrations(
      "serving",
      "0003_publication_provider_dispositions.sql",
    );
    const publicationId = id("pub", 230);
    const modelId = id("mdl", 231);
    insertBuildingPublication(database, publicationId);
    database
      .prepare(
        "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(id("prn", 232), publicationId, id("prv", 233), id("pvr", 234));
    database
      .prepare(
        "INSERT INTO publication_resource VALUES (?, 'model', ?, '{}', ?)",
      )
      .run(publicationId, modelId, HASH);
    database
      .prepare(
        "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, 'one', '[]', '', '[]', 'one', ?)",
      )
      .run(publicationId, VECTOR_ID, modelId, HASH);
    database
      .prepare(
        "UPDATE publication SET state = 'ready', ready_at_ms = 2 WHERE publication_id = ?",
      )
      .run(publicationId);

    expect(() => {
      applyServingSealedClosureMigration(database);
    }).toThrow();
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.1.0" });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'publication_closure_seal'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("atomically rejects malformed metadata and colliding 1.2 objects", () => {
    const malformed = applyMigrations(
      "serving",
      "0003_publication_provider_dispositions.sql",
    );
    malformed.exec("DROP TABLE serving_schema_metadata");
    malformed.exec(
      "CREATE TABLE serving_schema_metadata(singleton INTEGER, schema_version TEXT, created_at_ms INTEGER)",
    );
    malformed.exec(
      "INSERT INTO serving_schema_metadata VALUES (2, '1.1.0', 0)",
    );
    expect(() => {
      applyServingSealedClosureMigration(malformed);
    }).toThrow();
    expect(
      malformed
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'publication_closure_seal'",
        )
        .get(),
    ).toEqual({ count: 0 });

    const collision = applyMigrations(
      "serving",
      "0003_publication_provider_dispositions.sql",
    );
    collision.exec("CREATE TABLE publication_vector_inventory(fake TEXT)");
    expect(() => {
      applyServingSealedClosureMigration(collision);
    }).toThrow();
    expect(
      collision
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('publication_staging_revision', 'publication_provider_slice_metadata', 'publication_provider_attribution', 'publication_vector_inventory') ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: "publication_vector_inventory" }]);
    expect(
      collision
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.1.0" });
  });

  it("keeps readiness and every publication-head mutation closed for Phase 4D", () => {
    const database = applyMigrations(
      "serving",
      "0004_sealed_publication_closure.sql",
    );
    const publicationId = id("pub", 280);
    insertBuildingPublication(database, publicationId, {
      resources: 0,
      exactDocuments: 0,
      vectorDocuments: 0,
    });
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'ready', ready_at_ms = 3 WHERE publication_id = ?",
          )
          .run(publicationId),
      "readiness receipts are not persisted",
    );
    expectConstraint(
      () =>
        database
          .prepare("INSERT INTO publication_head VALUES (1, ?, NULL, 3, 1)")
          .run(publicationId),
      "publication head switching is not implemented",
    );
    expect(
      database.prepare("SELECT count(*) AS count FROM publication_head").get(),
    ).toEqual({ count: 0 });
  });
});
