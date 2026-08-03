import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { compareExactDecimal } from "@quant-clarity/domain";

import { canonicalPrice } from "./index.js";

const HASH = `sha256:${"a".repeat(64)}`;
const OTHER_HASH = `sha256:${"b".repeat(64)}`;
const THIRD_HASH = `sha256:${"c".repeat(64)}`;
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

function applyServingReadinessReceiptMigration(database: DatabaseSync): void {
  applyAtomicMigration(
    database,
    readFileSync(
      resolve("migrations", "serving", "0005_readiness_receipt_ledger.sql"),
      "utf8",
    ),
  );
}

function applyServingActivationMigration(database: DatabaseSync): void {
  applyAtomicMigration(
    database,
    readFileSync(
      resolve("migrations", "serving", "0006_exact_generation_activation.sql"),
      "utf8",
    ),
  );
}

function applyServingProviderSearchMigration(database: DatabaseSync): void {
  applyAtomicMigration(
    database,
    readFileSync(
      resolve(
        "migrations",
        "serving",
        "0007_provider_search_exact_projection.sql",
      ),
      "utf8",
    ),
  );
}

function applyServingProviderNameNulGuardMigration(
  database: DatabaseSync,
): void {
  applyAtomicMigration(
    database,
    readFileSync(
      resolve("migrations", "serving", "0008_provider_name_nul_guard.sql"),
      "utf8",
    ),
  );
}

function applyServingModelVariantNameMigration(database: DatabaseSync): void {
  applyAtomicMigration(
    database,
    readFileSync(
      resolve(
        "migrations",
        "serving",
        "0009_model_variant_name_exact_projection.sql",
      ),
      "utf8",
    ),
  );
}

function applyServingProviderModelIdMigration(database: DatabaseSync): void {
  applyAtomicMigration(
    database,
    readFileSync(
      resolve(
        "migrations",
        "serving",
        "0010_provider_model_id_exact_projection.sql",
      ),
      "utf8",
    ),
  );
}

function applyServingRetainedHotPublicationMigration(
  database: DatabaseSync,
): void {
  applyAtomicMigration(
    database,
    readFileSync(
      resolve("migrations", "serving", "0011_retained_hot_publications.sql"),
      "utf8",
    ),
  );
}

function applyServingProviderEligibilityMigration(
  database: DatabaseSync,
): void {
  applyAtomicMigration(
    database,
    readFileSync(
      resolve(
        "migrations",
        "serving",
        "0012_provider_model_eligibility_index.sql",
      ),
      "utf8",
    ),
  );
}

function splitMigrationStatements(sql: string): readonly string[] {
  const statements: string[] = [];
  let current = "";
  let trigger = false;
  let inSingleQuotedLiteral = false;
  for (const line of sql.split("\n")) {
    current += `${line}\n`;
    let structuralLine = "";
    for (let index = 0; index < line.length; index += 1) {
      const character = line.charAt(index);
      if (
        !inSingleQuotedLiteral &&
        character === "-" &&
        line[index + 1] === "-"
      )
        break;
      if (character === "'") {
        if (inSingleQuotedLiteral && line[index + 1] === "'") {
          index += 1;
        } else {
          inSingleQuotedLiteral = !inSingleQuotedLiteral;
        }
        structuralLine += " ";
      } else {
        structuralLine += inSingleQuotedLiteral ? " " : character;
      }
    }
    if (/^CREATE TRIGGER\b/u.test(structuralLine)) trigger = true;
    if (
      !inSingleQuotedLiteral &&
      ((trigger && /^END;\s*$/u.test(structuralLine)) ||
        (!trigger && /;\s*$/u.test(structuralLine)))
    ) {
      statements.push(current);
      current = "";
      trigger = false;
    }
  }
  if (current.trim() !== "")
    throw new Error(
      "migration statement splitter found an incomplete statement",
    );
  return statements;
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

  function insertBuildingProviderSearchContext(
    database: DatabaseSync,
    publicationId: string,
    providerId: string,
    displayName: string,
    sequence: number,
  ): void {
    insertBuildingPublication(
      database,
      publicationId,
      { resources: 1, exactDocuments: 0, vectorDocuments: 0 },
      null,
      sequence,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice(publication_id, provider_id, provider_slice_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(publicationId, providerId, id("prn", sequence), id("pvr", sequence));
    database
      .prepare(
        "INSERT INTO publication_provider_slice_metadata VALUES (?, ?, 'adapter@1', 'roster@1', 'register@1')",
      )
      .run(publicationId, providerId);
    database
      .prepare(
        "INSERT INTO publication_resource VALUES (?, 'provider', ?, ?, ?)",
      )
      .run(
        publicationId,
        providerId,
        JSON.stringify({
          provider_id: providerId,
          display_name: {
            state: "known",
            value: displayName,
            observed_at: "2026-08-02T00:00:00.000Z",
            evidence_ids: [id("evd", sequence)],
          },
        }),
        HASH,
      );
    database
      .prepare(
        "INSERT INTO publication_provider_attribution VALUES (?, 'provider', ?, ?)",
      )
      .run(publicationId, providerId, providerId);
  }

  function insertBuildingModelVariantNameContext(
    database: DatabaseSync,
    publicationId: string,
    resources: readonly Readonly<{
      resourceType: "model" | "variant";
      resourceId: string;
      displayNameState: "known" | "unknown";
      displayName?: string;
    }>[],
    sequence: number,
    completeSearch = false,
  ): void {
    insertBuildingPublication(
      database,
      publicationId,
      {
        resources: resources.length,
        exactDocuments: completeSearch ? resources.length : 0,
        vectorDocuments: completeSearch ? resources.length : 0,
      },
      null,
      sequence,
    );
    for (const resource of resources) {
      const idProperty =
        resource.resourceType === "model" ? "model_id" : "variant_id";
      const displayName =
        resource.displayNameState === "known"
          ? {
              state: "known",
              value: resource.displayName,
              observed_at: "2026-08-02T00:00:00.000Z",
              evidence_ids: [id("evd", sequence)],
            }
          : { state: "unknown" };
      database
        .prepare("INSERT INTO publication_resource VALUES (?, ?, ?, ?, ?)")
        .run(
          publicationId,
          resource.resourceType,
          resource.resourceId,
          JSON.stringify({
            [idProperty]: resource.resourceId,
            display_name: displayName,
          }),
          HASH,
        );
    }
  }

  function insertBuildingProviderModelIdContext(
    database: DatabaseSync,
    publicationId: string,
    providerId: string,
    targetType: "model" | "variant",
    targetId: string,
    offerings: readonly Readonly<{
      offeringId: string;
      rawProviderModelId: string;
    }>[],
    sequence: number,
  ): void {
    insertBuildingPublication(
      database,
      publicationId,
      {
        resources: offerings.length + 1,
        exactDocuments: 1,
        vectorDocuments: 1,
      },
      null,
      sequence,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice(publication_id, provider_id, provider_slice_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(publicationId, providerId, id("prn", sequence), id("pvr", sequence));
    database
      .prepare(
        "INSERT INTO publication_provider_slice_metadata VALUES (?, ?, 'adapter@1', 'roster@1', 'register@1')",
      )
      .run(publicationId, providerId);
    const targetIdentity = targetType === "model" ? "model_id" : "variant_id";
    database
      .prepare("INSERT INTO publication_resource VALUES (?, ?, ?, ?, ?)")
      .run(
        publicationId,
        targetType,
        targetId,
        JSON.stringify({
          [targetIdentity]: targetId,
          display_name: { state: "unknown" },
        }),
        OTHER_HASH,
      );
    for (const offering of offerings) {
      database
        .prepare(
          "INSERT INTO publication_resource VALUES (?, 'offering', ?, ?, ?)",
        )
        .run(
          publicationId,
          offering.offeringId,
          JSON.stringify({
            offering_id: offering.offeringId,
            provider_id: providerId,
            model_resource_id: targetId,
            provider_model_id: offering.rawProviderModelId,
          }),
          HASH,
        );
      database
        .prepare(
          "INSERT INTO publication_provider_attribution VALUES (?, 'offering', ?, ?)",
        )
        .run(publicationId, offering.offeringId, providerId);
    }
    const vectorId = sequence.toString(16).padStart(64, "0");
    database
      .prepare(
        "INSERT INTO publication_search_document VALUES (?, ?, ?, ?, 'target', '[]', '', '[]', 'target', ?)",
      )
      .run(publicationId, vectorId, targetType, targetId, HASH);
    database
      .prepare(
        "INSERT INTO publication_vector_inventory VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        publicationId,
        publicationId,
        vectorId,
        targetType,
        targetId,
        HASH,
        HASH,
      );
    const resourceKeys = [
      `${targetType}:${targetId}`,
      ...offerings.map((offering) => `offering:${offering.offeringId}`),
    ].sort();
    for (const [kind, firstKey, lastKey, count] of [
      [
        "resources",
        resourceKeys[0]!,
        resourceKeys.at(-1)!,
        resourceKeys.length,
      ],
      ["exact_search", vectorId, vectorId, 1],
      ["vectors", vectorId, vectorId, 1],
    ] as const)
      database
        .prepare(
          "INSERT INTO publication_inventory_chunk VALUES (?, ?, 0, ?, ?, ?, ?)",
        )
        .run(publicationId, kind, firstKey, lastKey, count, HASH);
  }

  function insertProviderModelIdDocument(
    database: DatabaseSync,
    values: Readonly<{
      publicationId: string;
      offeringId: string;
      providerId: string;
      targetType: "model" | "variant";
      targetId: string;
      rawHex: string;
      normalizedHex: string;
      offeringHash?: string;
      targetHash?: string;
    }>,
  ): void {
    database
      .prepare(
        `INSERT INTO publication_provider_model_id_search_document(
          publication_id, offering_id, provider_id,
          target_resource_type, target_resource_id, projection_version,
          raw_provider_model_id_utf8, normalized_provider_model_id_utf8,
          offering_content_hash, target_content_hash
        ) VALUES (?, ?, ?, ?, ?, 'provider-model-id@1', unhex(?), unhex(?), ?, ?)`,
      )
      .run(
        values.publicationId,
        values.offeringId,
        values.providerId,
        values.targetType,
        values.targetId,
        values.rawHex,
        values.normalizedHex,
        values.offeringHash ?? HASH,
        values.targetHash ?? OTHER_HASH,
      );
  }

  function insertProviderModelIdClosureSeal(
    database: DatabaseSync,
    publicationId: string,
    offeringCount: number,
  ): void {
    const revision = database
      .prepare(
        "SELECT revision FROM publication_staging_revision WHERE publication_id = ?",
      )
      .get(publicationId) as { revision: number };
    database
      .prepare(
        `INSERT INTO publication_closure_seal(
          publication_id, staging_revision, manifest_contract_version,
          hash_domain, hash_encoding_version, enabled_provider_scope_version,
          enabled_provider_count, provider_slice_count,
          provider_attribution_count, resource_count, exact_document_count,
          vector_document_count, chunk_count, bundle_hash,
          enabled_provider_scope_hash, provider_slice_hash,
          provider_attribution_hash, resource_inventory_hash,
          exact_search_inventory_hash, vector_inventory_hash, chunk_root_hash,
          closure_hash, sealed_at_ms
        ) VALUES (?, ?, '1.0.0', 'publication-closure', '1', 'scope@1',
          1, 1, ?, ?, 1, 1, 3, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        publicationId,
        revision.revision,
        offeringCount,
        offeringCount + 1,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        OTHER_HASH,
        10_000,
      );
  }

  function insertCompleteModelPublication(
    database: DatabaseSync,
    publicationId: string,
    modelId: string,
    displayName: string,
    sequence: number,
  ): void {
    insertBuildingModelVariantNameContext(
      database,
      publicationId,
      [
        {
          resourceType: "model",
          resourceId: modelId,
          displayNameState: "known",
          displayName,
        },
      ],
      sequence,
      true,
    );
    const unavailableProviderId = id("prv", sequence);
    database
      .prepare(
        "INSERT INTO publication_provider_slice(publication_id, provider_id, provider_slice_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, NULL, ?, 0, 'unavailable')",
      )
      .run(publicationId, unavailableProviderId, id("pvr", sequence));
    database
      .prepare(
        "INSERT INTO publication_provider_slice_metadata VALUES (?, ?, 'adapter@1', 'roster@1', 'register@1')",
      )
      .run(publicationId, unavailableProviderId);
    database
      .prepare(
        "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, ?, '[]', '', '[]', ?, ?)",
      )
      .run(
        publicationId,
        VECTOR_ID,
        modelId,
        displayName.toLowerCase(),
        displayName,
        HASH,
      );
    database
      .prepare(
        "INSERT INTO publication_vector_inventory VALUES (?, ?, ?, 'model', ?, ?, ?)",
      )
      .run(publicationId, publicationId, VECTOR_ID, modelId, HASH, HASH);
    for (const [kind, key] of [
      ["resources", `model:${modelId}`],
      ["exact_search", VECTOR_ID],
      ["vectors", VECTOR_ID],
    ] as const)
      database
        .prepare(
          "INSERT INTO publication_inventory_chunk VALUES (?, ?, 0, ?, ?, 1, ?)",
        )
        .run(publicationId, kind, key, key, HASH);
  }

  function insertClosureSeal(
    database: DatabaseSync,
    publicationId: string,
  ): void {
    const revision = database
      .prepare(
        "SELECT revision FROM publication_staging_revision WHERE publication_id = ?",
      )
      .get(publicationId) as { revision: number };
    database
      .prepare(
        "INSERT INTO publication_closure_seal(publication_id, staging_revision, manifest_contract_version, hash_domain, hash_encoding_version, enabled_provider_scope_version, enabled_provider_count, provider_slice_count, provider_attribution_count, resource_count, exact_document_count, vector_document_count, chunk_count, bundle_hash, enabled_provider_scope_hash, provider_slice_hash, provider_attribution_hash, resource_inventory_hash, exact_search_inventory_hash, vector_inventory_hash, chunk_root_hash, closure_hash, sealed_at_ms) VALUES (?, ?, '1.0.0', 'publication-closure', '1', 'scope@1', 1, 1, 0, 1, 1, 1, 3, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        publicationId,
        revision.revision,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        OTHER_HASH,
        10_000,
      );
  }

  function insertReadinessAttestationFixture(
    database: DatabaseSync,
    publicationId: string,
    readyAtMs: number,
  ): void {
    database
      .prepare(
        "INSERT INTO publication_readiness_attestation VALUES (?, 'local', ?, ?, '1.0.0', ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        publicationId,
        OTHER_HASH,
        HASH,
        readyAtMs,
        readyAtMs,
        readyAtMs,
        readyAtMs,
        readyAtMs,
        readyAtMs,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
      );
  }

  function insertAttestedReadyPublication(
    database: DatabaseSync,
    publicationId: string,
    sequence: number,
    clockMs: number,
  ): void {
    const providerId = id("prv", sequence);
    const providerRunId = id("pvr", sequence + 1);
    const providerSliceId = id("prn", sequence + 2);
    const modelId = id("mdl", sequence + 3);
    const vectorId = sequence.toString(16).padStart(64, "0");
    const generatedAtMs = clockMs - 5_000;
    const sealedAtMs = clockMs - 4_000;
    const observedAtMs = clockMs - 3_000;
    const readyAtMs = clockMs - 2_000;
    const maximumReceiptAgeMs = 120_000;

    insertBuildingPublication(
      database,
      publicationId,
      { resources: 1, exactDocuments: 1, vectorDocuments: 1 },
      null,
      generatedAtMs,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice(publication_id, provider_id, provider_slice_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(publicationId, providerId, providerSliceId, providerRunId);
    database
      .prepare(
        "INSERT INTO publication_provider_slice_metadata VALUES (?, ?, 'adapter@1', 'roster@1', 'register@1')",
      )
      .run(publicationId, providerId);
    database
      .prepare(
        "INSERT INTO publication_resource VALUES (?, 'model', ?, '{}', ?)",
      )
      .run(publicationId, modelId, HASH);
    database
      .prepare(
        "INSERT INTO publication_search_document VALUES (?, ?, 'model', ?, 'example', '[]', 'Publisher', '[]', 'example model', ?)",
      )
      .run(publicationId, vectorId, modelId, HASH);
    database
      .prepare(
        "INSERT INTO publication_vector_inventory VALUES (?, ?, ?, 'model', ?, ?, ?)",
      )
      .run(publicationId, publicationId, vectorId, modelId, HASH, OTHER_HASH);
    for (const [kind, key] of [
      ["resources", `model:${modelId}`],
      ["exact_search", vectorId],
      ["vectors", vectorId],
    ] as const)
      database
        .prepare(
          "INSERT INTO publication_inventory_chunk VALUES (?, ?, 0, ?, ?, 1, ?)",
        )
        .run(publicationId, kind, key, key, HASH);
    const revision = database
      .prepare(
        "SELECT revision FROM publication_staging_revision WHERE publication_id = ?",
      )
      .get(publicationId) as { revision: number };
    database
      .prepare(
        "INSERT INTO publication_closure_seal(publication_id, staging_revision, manifest_contract_version, hash_domain, hash_encoding_version, enabled_provider_scope_version, enabled_provider_count, provider_slice_count, provider_attribution_count, resource_count, exact_document_count, vector_document_count, chunk_count, bundle_hash, enabled_provider_scope_hash, provider_slice_hash, provider_attribution_hash, resource_inventory_hash, exact_search_inventory_hash, vector_inventory_hash, chunk_root_hash, closure_hash, sealed_at_ms) VALUES (?, ?, '1.0.0', 'publication-closure', '1', 'scope@1', 1, 1, 0, 1, 1, 1, 3, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        publicationId,
        revision.revision,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        OTHER_HASH,
        sealedAtMs,
      );
    for (const kind of ["archive", "serving", "vectors", "probes"])
      database
        .prepare(
          "INSERT INTO publication_readiness_receipt VALUES (?, ?, '1.0.0', ?, 'local', ?, ?, '1.0.0', 'commit', ?)",
        )
        .run(publicationId, kind, HASH, OTHER_HASH, HASH, observedAtMs);
    database
      .prepare(
        "INSERT INTO publication_archive_receipt VALUES (?, 'archive', ?, 1)",
      )
      .run(publicationId, HASH);
    database
      .prepare(
        "INSERT INTO publication_serving_receipt VALUES (?, 'serving', 1, ?, 1, ?, 0, ?, 1, 1, ?, ?, 'fts5-unicode61@1', 1, 1, 1, 1, 1)",
      )
      .run(publicationId, HASH, HASH, HASH, HASH, HASH);
    database
      .prepare(
        "INSERT INTO publication_vector_receipt VALUES (?, 'vectors', ?, 1, 1, ?, 'vector-visibility@1', 'mutation-1', 1, 1, 1)",
      )
      .run(publicationId, publicationId, HASH);
    database
      .prepare(
        "INSERT INTO publication_probe_receipt VALUES (?, 'probes', 'search-gold@1', 1, 1, 1, 1, 1, 1, 1)",
      )
      .run(publicationId);
    database
      .prepare(
        "INSERT INTO publication_readiness_attestation VALUES (?, 'local', ?, ?, '1.0.0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        publicationId,
        OTHER_HASH,
        HASH,
        readyAtMs,
        maximumReceiptAgeMs,
        observedAtMs + maximumReceiptAgeMs,
        observedAtMs,
        observedAtMs,
        observedAtMs,
        observedAtMs,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
      );
    database
      .prepare(
        "UPDATE publication SET state = 'ready', ready_at_ms = ? WHERE publication_id = ?",
      )
      .run(readyAtMs, publicationId);
  }

  function switchPreflightValues(input: {
    switchId: string;
    action: "activate" | "rollback";
    expectedGeneration: number;
    expectedRollbackPublicationId: string | null;
    expectedSwitchedAtMs: number | null;
    fromPublicationId: string | null;
    toPublicationId: string;
    switchedAtMs: number;
    observedAtMs: number;
  }): (string | number | null)[] {
    return [
      input.switchId,
      "1.0.0",
      HASH,
      input.action,
      "local",
      input.expectedGeneration,
      input.expectedRollbackPublicationId,
      input.expectedSwitchedAtMs,
      input.expectedGeneration + 1,
      input.fromPublicationId,
      input.fromPublicationId === null ? null : OTHER_HASH,
      input.toPublicationId,
      OTHER_HASH,
      input.action === "activate" ? HASH : null,
      input.switchedAtMs,
      input.observedAtMs,
      60_000,
      input.observedAtMs + 60_000,
      "fts5-unicode61@1",
      1,
      1,
      HASH,
      1,
      HASH,
      1,
      input.toPublicationId,
      1,
      1,
      HASH,
      "vector-visibility@1",
      "mutation-1",
      1,
      1,
      1,
      "search-gold@1",
      1,
      1,
      1,
      1,
      1,
      1,
    ];
  }

  function insertSwitchPreflight(
    database: DatabaseSync,
    values: readonly (string | number | null)[],
  ): void {
    database
      .prepare(
        `INSERT INTO publication_switch_preflight VALUES (${values.map(() => "?").join(", ")})`,
      )
      .run(...values);
  }

  function insertSwitchHistory(
    database: DatabaseSync,
    input: {
      switchId: string;
      eventHash: string;
      action: "activate" | "rollback";
      expectedGeneration: number;
      expectedRollbackPublicationId: string | null;
      expectedSwitchedAtMs: number | null;
      fromPublicationId: string | null;
      toPublicationId: string;
      switchedAtMs: number;
    },
  ): void {
    database
      .prepare(
        "INSERT INTO publication_switch_history VALUES (?, '1.0.0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pipeline', 'pipeline:test')",
      )
      .run(
        input.switchId,
        input.eventHash,
        HASH,
        input.action,
        input.expectedGeneration,
        input.expectedRollbackPublicationId,
        input.expectedSwitchedAtMs,
        input.expectedGeneration + 1,
        input.fromPublicationId,
        input.fromPublicationId === null ? null : OTHER_HASH,
        input.toPublicationId,
        OTHER_HASH,
        input.action === "activate" ? HASH : null,
        input.fromPublicationId,
        input.switchedAtMs,
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

  it("adds publication-scoped FTS and an immutable readiness ledger while keeping head switching closed", () => {
    const database = applyMigrations(
      "serving",
      "0005_readiness_receipt_ledger.sql",
    );
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.3.0" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('publication_search_fts', 'publication_readiness_receipt', 'publication_archive_receipt', 'publication_serving_receipt', 'publication_vector_receipt', 'publication_probe_receipt', 'publication_readiness_attestation') ORDER BY name",
        )
        .all()
        .map((row) => (row as { name: string }).name),
    ).toEqual([
      "publication_archive_receipt",
      "publication_probe_receipt",
      "publication_readiness_attestation",
      "publication_readiness_receipt",
      "publication_search_fts",
      "publication_serving_receipt",
      "publication_vector_receipt",
    ]);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_readiness_receipt VALUES (?, 'archive', '1.0.0', ?, 'local', ?, ?, '1.0.0', 'git:test', 1)",
          )
          .run(id("pub", 290), HASH, HASH, HASH),
      "readiness receipt does not bind the sealed building publication",
    );
    expectConstraint(
      () =>
        database
          .prepare("INSERT INTO publication_head VALUES (1, ?, NULL, 3, 1)")
          .run(id("pub", 291)),
      "publication head switching is not implemented",
    );
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("atomically rejects malformed metadata and colliding readiness objects", () => {
    const malformed = applyMigrations(
      "serving",
      "0004_sealed_publication_closure.sql",
    );
    malformed.exec("DROP TABLE serving_schema_metadata");
    malformed.exec(
      "CREATE TABLE serving_schema_metadata(singleton INTEGER, schema_version TEXT, created_at_ms INTEGER)",
    );
    malformed.exec(
      "INSERT INTO serving_schema_metadata VALUES (1, '1.2.0', 0), (2, '1.2.0', 0)",
    );
    expect(() => {
      applyServingReadinessReceiptMigration(malformed);
    }).toThrow();
    expect(
      malformed
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE name = 'publication_search_fts'",
        )
        .get(),
    ).toEqual({ count: 0 });

    const collision = applyMigrations(
      "serving",
      "0004_sealed_publication_closure.sql",
    );
    collision.exec("CREATE TABLE publication_readiness_receipt(fake TEXT)");
    expect(() => {
      applyServingReadinessReceiptMigration(collision);
    }).toThrow();
    expect(
      collision
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('publication_search_fts', 'publication_readiness_receipt') ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: "publication_readiness_receipt" }]);
    expect(
      collision
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.2.0" });
  });

  it("preserves selected-content and overlapping-slice readiness fences in schema 1.3", () => {
    const database = applyMigrations(
      "serving",
      "0005_readiness_receipt_ledger.sql",
    );
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec(
      "DROP TRIGGER publication_readiness_attestation_insert_guard",
    );

    const unavailablePublicationId = id("pub", 300);
    insertBuildingPublication(
      database,
      unavailablePublicationId,
      { resources: 1, exactDocuments: 1, vectorDocuments: 1 },
      null,
      1,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice(publication_id, provider_id, provider_slice_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, NULL, ?, 0, 'unavailable')",
      )
      .run(unavailablePublicationId, id("prv", 301), id("pvr", 302));
    insertReadinessAttestationFixture(database, unavailablePublicationId, 2);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'ready', ready_at_ms = 2 WHERE publication_id = ?",
          )
          .run(unavailablePublicationId),
      "publication selected content or provider lineage is incomplete",
    );

    const firstPublicationId = id("pub", 303);
    const competingPublicationId = id("pub", 304);
    const providerId = id("prv", 305);
    const providerRunId = id("pvr", 306);
    const providerSliceId = id("prn", 307);
    for (const [publicationId, generatedAtMs] of [
      [firstPublicationId, 3],
      [competingPublicationId, 4],
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
          "INSERT INTO publication_provider_slice(publication_id, provider_id, provider_slice_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
        )
        .run(publicationId, providerId, providerSliceId, providerRunId);
      insertReadinessAttestationFixture(
        database,
        publicationId,
        generatedAtMs + 2,
      );
    }
    database
      .prepare(
        "UPDATE publication SET state = 'ready', ready_at_ms = 5 WHERE publication_id = ?",
      )
      .run(firstPublicationId);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'ready', ready_at_ms = 6 WHERE publication_id = ?",
          )
          .run(competingPublicationId),
      "publication selected content or provider lineage is incomplete",
    );
  });

  it("adds exact-generation switch preflights and append-only history in schema 1.4", () => {
    const database = applyMigrations(
      "serving",
      "0006_exact_generation_activation.sql",
    );
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.4.0" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('publication_switch_preflight', 'publication_switch_history') ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: "publication_switch_history" },
      { name: "publication_switch_preflight" },
    ]);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'publication_head_closed_delete'",
        )
        .get(),
    ).toEqual({ name: "publication_head_closed_delete" });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("adds the provider exact-search projection, closed v2 proofs, and NUL controls through schema 1.5.1", () => {
    const database = applyMigrations(
      "serving",
      "0008_provider_name_nul_guard.sql",
    );
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.5.1" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('publication_provider_search_document', 'publication_provider_search_fts') ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: "publication_provider_search_document" },
      { name: "publication_provider_search_fts" },
    ]);
    expect(
      database
        .prepare("PRAGMA index_info(publication_provider_search_exact_idx)")
        .all()
        .map((row) => row.name),
    ).toEqual(["publication_id", "normalized_name", "provider_id"]);

    const servingColumns = database
      .prepare("PRAGMA table_info(publication_serving_receipt)")
      .all()
      .map((row) => row.name);
    const preflightColumns = database
      .prepare("PRAGMA table_info(publication_switch_preflight)")
      .all()
      .map((row) => row.name);
    const providerProofColumns = [
      "provider_search_projection_version",
      "provider_search_document_count",
      "provider_search_inventory_hash",
      "provider_search_fts_build_version",
      "provider_search_fts_document_count",
      "provider_search_fts_queryable",
      "provider_search_exact_parity",
    ];
    expect(servingColumns.slice(-providerProofColumns.length)).toEqual(
      providerProofColumns,
    );
    expect(preflightColumns.slice(-providerProofColumns.length)).toEqual(
      providerProofColumns,
    );

    const schemas = database
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('publication_readiness_receipt', 'publication_readiness_attestation', 'publication_probe_receipt', 'publication_switch_preflight', 'publication_switch_history') ORDER BY name",
      )
      .all() as { name: string; sql: string }[];
    expect(
      schemas.find((row) => row.name === "publication_readiness_receipt")?.sql,
    ).toContain("receipt_version = '2.0.0'");
    expect(
      schemas.find((row) => row.name === "publication_readiness_attestation")
        ?.sql,
    ).toContain("evaluator_version = '2.0.0'");
    expect(
      schemas.find((row) => row.name === "publication_probe_receipt")?.sql,
    ).toContain("probe_set_version = 'search-gold@2'");
    expect(
      schemas.find((row) => row.name === "publication_switch_preflight")?.sql,
    ).toContain("preflight_version = '2.0.0'");
    expect(
      schemas.find((row) => row.name === "publication_switch_history")?.sql,
    ).toContain("event_version = '1.0.0'");
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'publication_provider_search_document_nul_insert_guard'",
        )
        .get(),
    ).toEqual({
      name: "publication_provider_search_document_nul_insert_guard",
    });
    const nulGuardSql = database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'publication_provider_search_document_nul_insert_guard'",
      )
      .get() as { sql: string };
    expect(nulGuardSql.sql).toContain("CAST(NEW.display_name AS BLOB)");
    expect(nulGuardSql.sql).toContain("CAST(NEW.normalized_name AS BLOB)");
    expect(nulGuardSql.sql).toContain("$.display_name.value");
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("populates provider FTS only from eligible unsealed building provider rows", () => {
    const database = applyMigrations(
      "serving",
      "0008_provider_name_nul_guard.sql",
    );
    const publicationId = id("pub", 360);
    const providerId = id("prv", 361);
    insertBuildingPublication(
      database,
      publicationId,
      { resources: 1, exactDocuments: 0, vectorDocuments: 0 },
      null,
      1,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice(publication_id, provider_id, provider_slice_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(publicationId, providerId, id("prn", 362), id("pvr", 363));
    database
      .prepare(
        "INSERT INTO publication_provider_slice_metadata VALUES (?, ?, 'adapter@1', 'roster@1', 'register@1')",
      )
      .run(publicationId, providerId);
    const providerJson = JSON.stringify({
      provider_id: providerId,
      display_name: {
        state: "known",
        value: "Example Provider",
        observed_at: "2026-08-02T00:00:00.000Z",
        evidence_ids: [id("evd", 364)],
      },
    });
    database
      .prepare(
        "INSERT INTO publication_resource VALUES (?, 'provider', ?, ?, ?)",
      )
      .run(publicationId, providerId, providerJson, HASH);
    database
      .prepare(
        "INSERT INTO publication_provider_attribution VALUES (?, 'provider', ?, ?)",
      )
      .run(publicationId, providerId, providerId);

    database
      .prepare(
        "INSERT INTO publication_provider_search_document VALUES (?, ?, 'provider-name@1', 'Example Provider', 'example provider', ?)",
      )
      .run(publicationId, providerId, HASH);
    expect(
      database
        .prepare(
          "SELECT publication_id, provider_id, display_name FROM publication_provider_search_fts WHERE publication_id = ?",
        )
        .all(publicationId),
    ).toEqual([
      {
        publication_id: publicationId,
        provider_id: providerId,
        display_name: "Example Provider",
      },
    ]);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication_provider_search_document SET normalized_name = 'changed' WHERE publication_id = ? AND provider_id = ?",
          )
          .run(publicationId, providerId),
      "provider search document is immutable",
    );

    database
      .prepare(
        "INSERT INTO publication_provider_search_fts(publication_id, provider_id, display_name) VALUES (?, ?, 'Example Provider')",
      )
      .run(publicationId, providerId);
    database
      .prepare(
        "INSERT INTO publication_inventory_chunk VALUES (?, 'resources', 0, ?, ?, 1, ?)",
      )
      .run(
        publicationId,
        `provider:${providerId}`,
        `provider:${providerId}`,
        HASH,
      );
    const revision = database
      .prepare(
        "SELECT revision FROM publication_staging_revision WHERE publication_id = ?",
      )
      .get(publicationId) as { revision: number };
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_closure_seal(publication_id, staging_revision, manifest_contract_version, hash_domain, hash_encoding_version, enabled_provider_scope_version, enabled_provider_count, provider_slice_count, provider_attribution_count, resource_count, exact_document_count, vector_document_count, chunk_count, bundle_hash, enabled_provider_scope_hash, provider_slice_hash, provider_attribution_hash, resource_inventory_hash, exact_search_inventory_hash, vector_inventory_hash, chunk_root_hash, closure_hash, sealed_at_ms) VALUES (?, ?, '1.0.0', 'publication-closure', '1', 'scope@1', 1, 1, 1, 1, 0, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)",
          )
          .run(
            publicationId,
            revision.revision,
            HASH,
            HASH,
            HASH,
            HASH,
            HASH,
            HASH,
            HASH,
            HASH,
            OTHER_HASH,
          ),
      "provider search projection does not close",
    );

    const unavailablePublicationId = id("pub", 365);
    const unavailableProviderId = id("prv", 366);
    insertBuildingPublication(
      database,
      unavailablePublicationId,
      { resources: 0, exactDocuments: 0, vectorDocuments: 0 },
      null,
      2,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice(publication_id, provider_id, provider_slice_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, NULL, ?, 0, 'unavailable')",
      )
      .run(unavailablePublicationId, unavailableProviderId, id("pvr", 367));
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_provider_search_document VALUES (?, ?, 'provider-name@1', 'Inferred', 'inferred', ?)",
          )
          .run(unavailablePublicationId, unavailableProviderId, HASH),
      "provider search document does not match eligible canonical provider content",
    );
  });

  it("rejects leading and embedded U+0000 bytes in provider search rows", () => {
    const database = applyMigrations(
      "serving",
      "0008_provider_name_nul_guard.sql",
    );
    expect(
      database
        .prepare(
          "SELECT instr(CAST(? AS BLOB), CAST(char(0) AS BLOB)) AS leading, instr(CAST(? AS BLOB), CAST(char(0) AS BLOB)) AS embedded",
        )
        .get("\u0000A", "A\u0000B"),
    ).toEqual({ leading: 1, embedded: 2 });

    const cases = [
      { displayName: "\u0000Leading", normalizedName: "leading" },
      { displayName: "Embedded\u0000Name", normalizedName: "embedded name" },
      { displayName: "Trailing\u0000", normalizedName: "trailing" },
      { displayName: "Leading", normalizedName: "\u0000leading" },
      { displayName: "Embedded Name", normalizedName: "embedded\u0000name" },
      { displayName: "Trailing", normalizedName: "trailing\u0000" },
    ] as const;
    cases.forEach(({ displayName, normalizedName }, ordinal) => {
      const sequence = 700 + ordinal * 10;
      const publicationId = id("pub", sequence);
      const providerId = id("prv", sequence + 1);
      insertBuildingProviderSearchContext(
        database,
        publicationId,
        providerId,
        displayName,
        sequence + 2,
      );
      expect(() =>
        database
          .prepare(
            "INSERT INTO publication_provider_search_document VALUES (?, ?, 'provider-name@1', ?, ?, ?)",
          )
          .run(publicationId, providerId, displayName, normalizedName, HASH),
      ).toThrow(/U\+0000|constraint/iu);
    });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_provider_search_document",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_provider_search_fts",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("persists the worst-case ProviderSchema Unicode normalization expansion", () => {
    const database = applyMigrations(
      "serving",
      "0008_provider_name_nul_guard.sql",
    );
    const publicationId = id("pub", 368);
    const providerId = id("prv", 369);
    const displayName = "\ufdfa".repeat(200);
    const normalizedName =
      "\u0635\u0644\u0649 \u0627\u0644\u0644\u0647 \u0639\u0644\u064a\u0647 \u0648\u0633\u0644\u0645".repeat(
        200,
      );
    expect(Array.from(normalizedName)).toHaveLength(3_600);
    insertBuildingPublication(
      database,
      publicationId,
      { resources: 1, exactDocuments: 0, vectorDocuments: 0 },
      null,
      1,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice(publication_id, provider_id, provider_slice_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(publicationId, providerId, id("prn", 370), id("pvr", 371));
    database
      .prepare(
        "INSERT INTO publication_provider_slice_metadata VALUES (?, ?, 'adapter@1', 'roster@1', 'register@1')",
      )
      .run(publicationId, providerId);
    database
      .prepare(
        "INSERT INTO publication_resource VALUES (?, 'provider', ?, ?, ?)",
      )
      .run(
        publicationId,
        providerId,
        JSON.stringify({
          provider_id: providerId,
          display_name: {
            state: "known",
            value: displayName,
            observed_at: "2026-08-02T00:00:00.000Z",
            evidence_ids: [id("evd", 372)],
          },
        }),
        HASH,
      );
    database
      .prepare(
        "INSERT INTO publication_provider_attribution VALUES (?, 'provider', ?, ?)",
      )
      .run(publicationId, providerId, providerId);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_provider_search_document VALUES (?, ?, 'provider-name@1', ?, ?, ?)",
          )
          .run(
            publicationId,
            providerId,
            displayName,
            `${normalizedName}x`,
            HASH,
          ),
      "length(normalized_name) BETWEEN 1 AND 3600",
    );
    database
      .prepare(
        "INSERT INTO publication_provider_search_document VALUES (?, ?, 'provider-name@1', ?, ?, ?)",
      )
      .run(publicationId, providerId, displayName, normalizedName, HASH);

    expect(
      database
        .prepare(
          "SELECT length(display_name) AS display_length, length(normalized_name) AS normalized_length FROM publication_provider_search_document WHERE publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({ display_length: 200, normalized_length: 3_600 });
    expect(
      database
        .prepare(
          "SELECT display_name FROM publication_provider_search_fts WHERE publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({ display_name: displayName });
  });

  it("fails readiness closed when direct provider FTS corruption occurs after sealing", () => {
    const database = applyMigrations(
      "serving",
      "0008_provider_name_nul_guard.sql",
    );
    const publicationId = id("pub", 380);
    const providerId = id("prv", 381);
    insertBuildingPublication(
      database,
      publicationId,
      { resources: 1, exactDocuments: 0, vectorDocuments: 0 },
      null,
      1,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_slice(publication_id, provider_id, provider_slice_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, ?, ?, 0, 'fresh')",
      )
      .run(publicationId, providerId, id("prn", 382), id("pvr", 383));
    database
      .prepare(
        "INSERT INTO publication_provider_slice_metadata VALUES (?, ?, 'adapter@1', 'roster@1', 'register@1')",
      )
      .run(publicationId, providerId);
    database
      .prepare(
        "INSERT INTO publication_resource VALUES (?, 'provider', ?, ?, ?)",
      )
      .run(
        publicationId,
        providerId,
        JSON.stringify({
          provider_id: providerId,
          display_name: {
            state: "known",
            value: "Sealed Provider",
            observed_at: "2026-08-02T00:00:00.000Z",
            evidence_ids: [id("evd", 384)],
          },
        }),
        HASH,
      );
    database
      .prepare(
        "INSERT INTO publication_provider_attribution VALUES (?, 'provider', ?, ?)",
      )
      .run(publicationId, providerId, providerId);
    database
      .prepare(
        "INSERT INTO publication_provider_search_document VALUES (?, ?, 'provider-name@1', 'Sealed Provider', 'sealed provider', ?)",
      )
      .run(publicationId, providerId, HASH);
    database
      .prepare(
        "INSERT INTO publication_inventory_chunk VALUES (?, 'resources', 0, ?, ?, 1, ?)",
      )
      .run(
        publicationId,
        `provider:${providerId}`,
        `provider:${providerId}`,
        HASH,
      );
    const revision = database
      .prepare(
        "SELECT revision FROM publication_staging_revision WHERE publication_id = ?",
      )
      .get(publicationId) as { revision: number };
    database
      .prepare(
        "INSERT INTO publication_closure_seal(publication_id, staging_revision, manifest_contract_version, hash_domain, hash_encoding_version, enabled_provider_scope_version, enabled_provider_count, provider_slice_count, provider_attribution_count, resource_count, exact_document_count, vector_document_count, chunk_count, bundle_hash, enabled_provider_scope_hash, provider_slice_hash, provider_attribution_hash, resource_inventory_hash, exact_search_inventory_hash, vector_inventory_hash, chunk_root_hash, closure_hash, sealed_at_ms) VALUES (?, ?, '1.0.0', 'publication-closure', '1', 'scope@1', 1, 1, 1, 1, 0, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)",
      )
      .run(
        publicationId,
        revision.revision,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        OTHER_HASH,
      );

    for (const kind of ["archive", "serving", "vectors", "probes"])
      database
        .prepare(
          "INSERT INTO publication_readiness_receipt VALUES (?, ?, '2.0.0', ?, 'local', ?, ?, '1.0.0', 'commit', 2)",
        )
        .run(publicationId, kind, HASH, OTHER_HASH, HASH);
    database
      .prepare(
        "INSERT INTO publication_archive_receipt VALUES (?, 'archive', ?, 1)",
      )
      .run(publicationId, HASH);
    database
      .prepare(
        "INSERT INTO publication_serving_receipt VALUES (?, 'serving', 1, ?, 1, ?, 1, ?, 1, 0, ?, ?, 'fts5-unicode61@1', 0, 1, 1, 1, 1, 'provider-name@1', 1, ?, 'provider-name-fts5-unicode61@1', 1, 1, 1)",
      )
      .run(publicationId, HASH, HASH, HASH, HASH, HASH, HASH);
    database
      .prepare(
        "INSERT INTO publication_vector_receipt VALUES (?, 'vectors', ?, 0, 0, ?, 'vector-visibility@1', 'mutation-1', 1, 1, 1)",
      )
      .run(publicationId, publicationId, HASH);
    database
      .prepare(
        "INSERT INTO publication_probe_receipt VALUES (?, 'probes', 'search-gold@2', 1, 1, 1, 1, 1, 1, 1)",
      )
      .run(publicationId);

    // FTS5 virtual tables cannot carry mutation-blocking triggers. Simulate a
    // compromised writer after sealing and prove the next durable gate detects it.
    database
      .prepare(
        "INSERT INTO publication_provider_search_fts(publication_id, provider_id, display_name) VALUES (?, ?, 'Sealed Provider')",
      )
      .run(publicationId, providerId);
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_readiness_attestation VALUES (?, 'local', ?, ?, '2.0.0', 3, 1, 3, 2, 2, 2, 2, ?, ?, ?, ?, ?)",
          )
          .run(publicationId, OTHER_HASH, HASH, HASH, HASH, HASH, HASH, HASH),
      "provider search FTS does not match the canonical projection",
    );
    expect(
      database
        .prepare(
          "SELECT state, ready_at_ms FROM publication WHERE publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({ state: "building", ready_at_ms: null });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_readiness_attestation WHERE publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT count(*) AS count FROM publication_head").get(),
    ).toEqual({ count: 0 });
  });

  it("atomically rejects legacy proof-bearing state and schema-object collisions in migration 0007", () => {
    const legacy = applyMigrations(
      "serving",
      "0006_exact_generation_activation.sql",
    );
    const clockMs = Math.floor(Date.now() / 1_000) * 1_000;
    insertAttestedReadyPublication(legacy, id("pub", 370), 371, clockMs);
    expect(() => {
      applyServingProviderSearchMigration(legacy);
    }).toThrow();
    expect(
      legacy
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.4.0" });
    expect(
      legacy
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE name = 'publication_provider_search_document'",
        )
        .get(),
    ).toEqual({ count: 0 });

    const collision = applyMigrations(
      "serving",
      "0006_exact_generation_activation.sql",
    );
    collision.exec(
      "CREATE TABLE publication_provider_search_document(fake TEXT)",
    );
    expect(() => {
      applyServingProviderSearchMigration(collision);
    }).toThrow();
    expect(
      collision
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.4.0" });
    expect(
      collision
        .prepare("PRAGMA table_info(publication_provider_search_document)")
        .all()
        .map((row) => row.name),
    ).toEqual(["fake"]);
  });

  it("rolls back a late migration 0007 failure and remains cleanly retryable", () => {
    const database = applyMigrations(
      "serving",
      "0006_exact_generation_activation.sql",
    );
    database.exec(`
      CREATE TRIGGER test_fail_schema_15_update
      BEFORE UPDATE ON serving_schema_metadata
      BEGIN SELECT RAISE(ABORT, 'injected late schema 1.5 failure'); END
    `);

    expect(() => {
      applyServingProviderSearchMigration(database);
    }).toThrow("injected late schema 1.5 failure");
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.4.0" });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE name LIKE 'publication_provider_search_%'",
        )
        .get(),
    ).toEqual({ count: 0 });

    const v1Schemas = database
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('publication_readiness_receipt', 'publication_readiness_attestation', 'publication_probe_receipt', 'publication_switch_preflight', 'publication_switch_history') ORDER BY name",
      )
      .all() as { name: string; sql: string }[];
    expect(
      v1Schemas.find((row) => row.name === "publication_readiness_receipt")
        ?.sql,
    ).toContain("receipt_version = '1.0.0'");
    expect(
      v1Schemas.find((row) => row.name === "publication_readiness_attestation")
        ?.sql,
    ).toContain("evaluator_version = '1.0.0'");
    expect(
      v1Schemas.find((row) => row.name === "publication_probe_receipt")?.sql,
    ).not.toContain("search-gold@2");
    expect(
      v1Schemas.find((row) => row.name === "publication_switch_preflight")?.sql,
    ).toContain("preflight_version = '1.0.0'");
    expect(
      v1Schemas.find((row) => row.name === "publication_switch_history")?.sql,
    ).toContain("event_version = '1.0.0'");
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('publication_state_transition', 'publication_switch_preflight_insert_guard', 'publication_switch_history_insert_guard', 'publication_switch_history_apply', 'publication_head_switch_insert', 'publication_head_switch_update', 'publication_head_closed_delete') ORDER BY name",
        )
        .all()
        .map((row) => row.name),
    ).toEqual([
      "publication_head_closed_delete",
      "publication_head_switch_insert",
      "publication_head_switch_update",
      "publication_state_transition",
      "publication_switch_history_apply",
      "publication_switch_history_insert_guard",
      "publication_switch_preflight_insert_guard",
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });

    database.exec("DROP TRIGGER test_fail_schema_15_update");
    applyServingProviderSearchMigration(database);
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.5.0" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('publication_provider_search_document', 'publication_provider_search_fts') ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: "publication_provider_search_document" },
      { name: "publication_provider_search_fts" },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });

  it("preflights existing NUL data and the exact schema before migration 0008", () => {
    const existing = applyMigrations(
      "serving",
      "0007_provider_search_exact_projection.sql",
    );
    const publicationId = id("pub", 760);
    const providerId = id("prv", 761);
    const displayName = "Existing\u0000Provider";
    insertBuildingProviderSearchContext(
      existing,
      publicationId,
      providerId,
      displayName,
      762,
    );
    existing
      .prepare(
        "INSERT INTO publication_provider_search_document VALUES (?, ?, 'provider-name@1', ?, ?, ?)",
      )
      .run(
        publicationId,
        providerId,
        displayName,
        "existing\u0000provider",
        HASH,
      );
    expect(
      existing
        .prepare(
          "SELECT instr(CAST(display_name AS BLOB), CAST(char(0) AS BLOB)) AS display_nul, instr(CAST(normalized_name AS BLOB), CAST(char(0) AS BLOB)) AS normalized_nul FROM publication_provider_search_document",
        )
        .get(),
    ).toEqual({ display_nul: 9, normalized_nul: 9 });

    expect(() => {
      applyServingProviderNameNulGuardMigration(existing);
    }).toThrow();
    expect(
      existing
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.5.0" });
    expect(
      existing
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE name = 'publication_provider_search_document_nul_insert_guard'",
        )
        .get(),
    ).toEqual({ count: 0 });

    const oldSchema = applyMigrations(
      "serving",
      "0006_exact_generation_activation.sql",
    );
    expect(() => {
      applyServingProviderNameNulGuardMigration(oldSchema);
    }).toThrow();
    expect(
      oldSchema
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.4.0" });
  });

  it("advances a clean schema 1.5.0 database without rewriting provider rows", () => {
    const database = applyMigrations(
      "serving",
      "0007_provider_search_exact_projection.sql",
    );
    const publicationId = id("pub", 764);
    const providerId = id("prv", 765);
    insertBuildingProviderSearchContext(
      database,
      publicationId,
      providerId,
      "Clean Provider",
      766,
    );
    database
      .prepare(
        "INSERT INTO publication_provider_search_document VALUES (?, ?, 'provider-name@1', 'Clean Provider', 'clean provider', ?)",
      )
      .run(publicationId, providerId, HASH);
    const before = database
      .prepare(
        "SELECT * FROM publication_provider_search_document WHERE publication_id = ? AND provider_id = ?",
      )
      .get(publicationId, providerId);

    applyServingProviderNameNulGuardMigration(database);

    expect(
      database
        .prepare(
          "SELECT * FROM publication_provider_search_document WHERE publication_id = ? AND provider_id = ?",
        )
        .get(publicationId, providerId),
    ).toEqual(before);
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.5.1" });
  });

  it("rolls back a late migration 0008 failure and remains cleanly retryable", () => {
    const database = applyMigrations(
      "serving",
      "0007_provider_search_exact_projection.sql",
    );
    database.exec(`
      CREATE TRIGGER test_fail_schema_151_update
      BEFORE UPDATE ON serving_schema_metadata
      BEGIN SELECT RAISE(ABORT, 'injected late schema 1.5.1 failure'); END
    `);

    expect(() => {
      applyServingProviderNameNulGuardMigration(database);
    }).toThrow("injected late schema 1.5.1 failure");
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.5.0" });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE name = 'publication_provider_search_document_nul_insert_guard'",
        )
        .get(),
    ).toEqual({ count: 0 });

    database.exec("DROP TRIGGER test_fail_schema_151_update");
    applyServingProviderNameNulGuardMigration(database);
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.5.1" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'publication_provider_search_document_nul_insert_guard'",
        )
        .get(),
    ).toEqual({
      name: "publication_provider_search_document_nul_insert_guard",
    });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });

  it("adds the STRICT model/variant BLOB projection and closed v3 proof schemas in 1.6.0", () => {
    const database = applyMigrations(
      "serving",
      "0009_model_variant_name_exact_projection.sql",
    );
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.6.0" });

    const projectionSchema = database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'publication_model_variant_name_search_document'",
      )
      .get() as { sql: string };
    expect(projectionSchema.sql).toContain(
      "publication_model_variant_name_search_document",
    );
    expect(projectionSchema.sql).toContain("display_name_utf8 BLOB");
    expect(projectionSchema.sql).toContain("normalized_name_utf8 BLOB");
    expect(projectionSchema.sql).toMatch(/\) STRICT$/u);
    expect(
      database
        .prepare("PRAGMA index_info(publication_model_variant_name_exact_idx)")
        .all()
        .map((row) => row.name),
    ).toEqual(["publication_id", "normalized_name_utf8", "resource_id"]);

    const providerProofColumns = [
      "provider_search_projection_version",
      "provider_search_document_count",
      "provider_search_inventory_hash",
      "provider_search_fts_build_version",
      "provider_search_fts_document_count",
      "provider_search_fts_queryable",
      "provider_search_exact_parity",
    ];
    const modelProofColumns = [
      "model_variant_name_projection_version",
      "model_variant_name_document_count",
      "model_variant_name_inventory_hash",
      "model_variant_name_storage_version",
      "model_variant_name_storage_document_count",
      "model_variant_name_storage_queryable",
      "model_variant_name_storage_exact_parity",
    ];
    for (const table of [
      "publication_serving_receipt",
      "publication_switch_preflight",
    ]) {
      const columns = database
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name);
      expect(columns.slice(-14)).toEqual([
        ...providerProofColumns,
        ...modelProofColumns,
      ]);
    }

    const schemas = database
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('publication_readiness_receipt', 'publication_readiness_attestation', 'publication_probe_receipt', 'publication_switch_preflight', 'publication_switch_history') ORDER BY name",
      )
      .all() as { name: string; sql: string }[];
    expect(
      schemas.find((row) => row.name === "publication_readiness_receipt")?.sql,
    ).toContain("receipt_version = '3.0.0'");
    expect(
      schemas.find((row) => row.name === "publication_readiness_attestation")
        ?.sql,
    ).toContain("evaluator_version = '3.0.0'");
    expect(
      schemas.find((row) => row.name === "publication_probe_receipt")?.sql,
    ).toContain("probe_set_version = 'search-gold@3'");
    expect(
      schemas.find((row) => row.name === "publication_switch_preflight")?.sql,
    ).toContain("preflight_version = '3.0.0'");
    expect(
      schemas.find((row) => row.name === "publication_switch_history")?.sql,
    ).toContain("event_version = '1.0.0'");
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'publication_provider_search_document_nul_insert_guard'",
        )
        .get(),
    ).toEqual({
      name: "publication_provider_search_document_nul_insert_guard",
    });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it.each([
    { subtype: "archive", corruptAt: "archive" },
    { subtype: "serving", corruptAt: "serving" },
    { subtype: "vectors", corruptAt: "vectors" },
    { subtype: "probes", corruptAt: "probes" },
  ] as const)(
    "atomically rejects a corrupt v3 $subtype subtype before readiness",
    ({ corruptAt }) => {
      const database = applyMigrations(
        "serving",
        "0009_model_variant_name_exact_projection.sql",
      );
      const publicationId = id(
        "pub",
        900 + ["archive", "serving", "vectors", "probes"].indexOf(corruptAt),
      );
      const clockMs = Math.floor(Date.now() / 1_000) * 1_000;
      const sealedAtMs = clockMs - 4_000;
      const observedAtMs = clockMs - 3_000;
      const readyAtMs = clockMs - 2_000;
      const maximumReceiptAgeMs = 120_000;
      insertBuildingPublication(
        database,
        publicationId,
        { resources: 1, exactDocuments: 0, vectorDocuments: 0 },
        null,
        clockMs - 5_000,
      );
      const familyId = id("fam", 900);
      const providerId = id("prv", 900);
      database
        .prepare(
          "INSERT INTO publication_provider_slice(publication_id, provider_id, provider_slice_id, provider_run_id, carried_forward, freshness_state) VALUES (?, ?, NULL, ?, 0, 'unavailable')",
        )
        .run(publicationId, providerId, id("pvr", 900));
      database
        .prepare(
          "INSERT INTO publication_provider_slice_metadata VALUES (?, ?, 'adapter@1', 'roster@1', 'register@1')",
        )
        .run(publicationId, providerId);
      database
        .prepare(
          "INSERT INTO publication_resource VALUES (?, 'model_family', ?, '{}', ?)",
        )
        .run(publicationId, familyId, HASH);
      database
        .prepare(
          "INSERT INTO publication_inventory_chunk VALUES (?, 'resources', 0, ?, ?, 1, ?)",
        )
        .run(
          publicationId,
          `model_family:${familyId}`,
          `model_family:${familyId}`,
          HASH,
        );
      const revision = database
        .prepare(
          "SELECT revision FROM publication_staging_revision WHERE publication_id = ?",
        )
        .get(publicationId) as { revision: number };
      database
        .prepare(
          "INSERT INTO publication_closure_seal VALUES (?, ?, '1.0.0', 'publication-closure', '1', 'scope@1', 1, 1, 0, 1, 0, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          publicationId,
          revision.revision,
          HASH,
          HASH,
          HASH,
          HASH,
          HASH,
          HASH,
          HASH,
          HASH,
          OTHER_HASH,
          sealedAtMs,
        );

      expect(() => {
        database.exec("BEGIN IMMEDIATE");
        try {
          for (const kind of ["archive", "serving", "vectors", "probes"])
            database
              .prepare(
                "INSERT INTO publication_readiness_receipt VALUES (?, ?, '3.0.0', ?, 'local', ?, ?, '1.0.0', 'commit', ?)",
              )
              .run(publicationId, kind, HASH, OTHER_HASH, HASH, observedAtMs);
          database
            .prepare(
              "INSERT INTO publication_archive_receipt VALUES (?, 'archive', ?, ?)",
            )
            .run(publicationId, HASH, corruptAt === "archive" ? 0 : 1);
          database
            .prepare(
              `INSERT INTO publication_serving_receipt VALUES (
                ?, 'serving', 1, ?, 1, ?, 0, ?, 1, 0, ?, ?,
                'fts5-unicode61@1', 0, 1, 1, 1, 1,
                'provider-name@1', 0, ?, 'provider-name-fts5-unicode61@1', 0, 1, 1,
                'model-variant-name@1', 0, ?, 'model-variant-name-utf8-blob@1', 0, 1, ?
              )`,
            )
            .run(
              publicationId,
              HASH,
              HASH,
              HASH,
              HASH,
              HASH,
              THIRD_HASH,
              OTHER_HASH,
              corruptAt === "serving" ? 0 : 1,
            );
          database
            .prepare(
              "INSERT INTO publication_vector_receipt VALUES (?, 'vectors', ?, 0, 0, ?, 'vector-visibility@1', 'mutation-v3', 1, 1, ?)",
            )
            .run(
              publicationId,
              publicationId,
              HASH,
              corruptAt === "vectors" ? 0 : 1,
            );
          database
            .prepare(
              "INSERT INTO publication_probe_receipt VALUES (?, 'probes', 'search-gold@3', 1, 1, ?, 1, 1, 1, 1)",
            )
            .run(publicationId, corruptAt === "probes" ? 0 : 1);
          database
            .prepare(
              "INSERT INTO publication_readiness_attestation VALUES (?, 'local', ?, ?, '3.0.0', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              publicationId,
              OTHER_HASH,
              HASH,
              readyAtMs,
              maximumReceiptAgeMs,
              observedAtMs + maximumReceiptAgeMs,
              observedAtMs,
              observedAtMs,
              observedAtMs,
              observedAtMs,
              HASH,
              HASH,
              HASH,
              HASH,
              HASH,
            );
          database
            .prepare(
              "UPDATE publication SET state = 'ready', ready_at_ms = ? WHERE publication_id = ?",
            )
            .run(readyAtMs, publicationId);
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      }).toThrow();
      expect(
        database
          .prepare(
            `SELECT candidate.state,
              (SELECT count(*) FROM publication_readiness_receipt WHERE publication_id = candidate.publication_id) AS binding_count,
              (SELECT count(*) FROM publication_readiness_attestation WHERE publication_id = candidate.publication_id) AS attestation_count
            FROM publication AS candidate WHERE candidate.publication_id = ?`,
          )
          .get(publicationId),
      ).toEqual({
        state: "building",
        binding_count: 0,
        attestation_count: 0,
      });
    },
  );

  it("requires exact pristine schema 1.5.1 and rejects every model projection object kind before mutation", () => {
    const oldSchema = applyMigrations(
      "serving",
      "0007_provider_search_exact_projection.sql",
    );
    expect(() => {
      applyServingModelVariantNameMigration(oldSchema);
    }).toThrow();
    expect(
      oldSchema
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.5.0" });

    const proofBearing = applyMigrations(
      "serving",
      "0008_provider_name_nul_guard.sql",
    );
    proofBearing
      .prepare(
        "INSERT INTO publication VALUES (?, 'ready', '1.0.0', '1.0.0', 'precision@1', 'display@1', 'price@1', 'source@1', 'embedding@1', 'commit', ?, NULL, 1, 1, NULL, 0, 0, 0, ?, 'vector@1', ?, '[]', 1)",
      )
      .run(id("pub", 800), id("run", 800), HASH, OTHER_HASH);
    expect(() => {
      applyServingModelVariantNameMigration(proofBearing);
    }).toThrow();
    expect(
      proofBearing
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.5.1" });

    const collisions = [
      "CREATE TABLE publication_model_variant_name_search_document(fake TEXT)",
      "CREATE INDEX publication_model_variant_name_exact_idx ON publication(publication_id)",
      "CREATE TRIGGER publication_model_variant_name_search_document_insert_guard BEFORE INSERT ON publication BEGIN SELECT 1; END",
    ];
    for (const collisionSql of collisions) {
      const collision = applyMigrations(
        "serving",
        "0008_provider_name_nul_guard.sql",
      );
      collision.exec(collisionSql);
      expect(() => {
        applyServingModelVariantNameMigration(collision);
      }).toThrow();
      expect(
        collision
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.5.1" });
      expect(
        collision
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'publication_model_variant_name_search_seal_guard'",
          )
          .get(),
      ).toEqual({ count: 0 });
    }
  });

  it.each([
    {
      table: "publication_archive_receipt",
      insertSql:
        "INSERT INTO publication_archive_receipt(publication_id, kind, retained_bundle_hash, immutable) VALUES (?, 'archive', ?, 1)",
      parameters: [HASH],
    },
    {
      table: "publication_serving_receipt",
      insertSql: `INSERT INTO publication_serving_receipt(
        publication_id, kind,
        enabled_provider_count, enabled_provider_scope_hash,
        provider_slice_count, provider_slice_hash,
        provider_attribution_count, provider_attribution_hash,
        resource_count, exact_document_count,
        resource_inventory_hash, exact_search_inventory_hash,
        fts_build_version, fts_document_count, fts_queryable,
        foreign_keys_valid, content_hashes_valid, unavailable_provider_isolation_valid,
        provider_search_projection_version, provider_search_document_count,
        provider_search_inventory_hash, provider_search_fts_build_version,
        provider_search_fts_document_count, provider_search_fts_queryable,
        provider_search_exact_parity
      ) VALUES (
        ?, 'serving',
        0, ?,
        0, ?,
        0, ?,
        0, 0,
        ?, ?,
        'fts5-unicode61@1', 0, 1,
        1, 1, 1,
        'provider-name@1', 0,
        ?, 'provider-name-fts5-unicode61@1',
        0, 1,
        1
      )`,
      parameters: [HASH, HASH, HASH, HASH, HASH, HASH],
    },
    {
      table: "publication_vector_receipt",
      insertSql: `INSERT INTO publication_vector_receipt(
        publication_id, kind, vector_namespace, document_count,
        verified_document_count, vector_inventory_hash,
        visibility_probe_version, mutation_id, all_ids_present,
        all_namespaces_match, queryable
      ) VALUES (?, 'vectors', 'vector-namespace', 0, 0, ?, 'probe@1', 'mutation-1', 1, 1, 1)`,
      parameters: [HASH],
    },
    {
      table: "publication_probe_receipt",
      insertSql: `INSERT INTO publication_probe_receipt(
        publication_id, kind, probe_set_version, integrity_passed,
        evidence_coverage_passed, exact_search_passed,
        semantic_search_passed, structured_filter_passed,
        neutrality_passed, version_isolation_passed
      ) VALUES (?, 'probes', 'search-gold@2', 1, 1, 1, 1, 1, 1, 1)`,
      parameters: [],
    },
  ])(
    "atomically rejects orphan $table rows",
    ({ table, insertSql, parameters }) => {
      const database = applyMigrations(
        "serving",
        "0008_provider_name_nul_guard.sql",
      );
      const publicationId = id("pub", 809);
      database.exec("PRAGMA foreign_keys = OFF");
      database.exec(`DROP TRIGGER ${table}_insert_guard`);
      database.prepare(insertSql).run(publicationId, ...parameters);
      database.exec("PRAGMA foreign_keys = ON");

      expect(() => {
        applyServingModelVariantNameMigration(database);
      }).toThrow();
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.5.1" });
      expect(
        database.prepare(`SELECT count(*) AS count FROM ${table}`).get(),
      ).toEqual({ count: 1 });
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'publication_model_variant_name_search_document'",
          )
          .get(),
      ).toEqual({ count: 0 });
    },
  );

  it("stores exact model and variant UTF-8 BLOBs through unhex while preserving U+0000 bytes", () => {
    const database = applyMigrations(
      "serving",
      "0009_model_variant_name_exact_projection.sql",
    );
    const publicationId = id("pub", 810);
    const modelId = id("mdl", 811);
    const variantId = modelId.replace(/^mdl_/u, "var_");
    insertBuildingModelVariantNameContext(
      database,
      publicationId,
      [
        {
          resourceType: "model",
          resourceId: modelId,
          displayNameState: "known",
          displayName: "A\u0000B",
        },
        {
          resourceType: "variant",
          resourceId: variantId,
          displayNameState: "known",
          displayName: "\u0000V",
        },
      ],
      810,
    );

    const insert = database.prepare(
      "INSERT INTO publication_model_variant_name_search_document VALUES (?, ?, ?, 'model-variant-name@1', unhex(?), unhex(?), ?)",
    );
    expectConstraint(() =>
      database
        .prepare(
          "INSERT INTO publication_model_variant_name_search_document VALUES (?, 'model', ?, 'model-variant-name@1', ?, unhex('61'), ?)",
        )
        .run(publicationId, modelId, "A\u0000B", HASH),
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "INSERT INTO publication_model_variant_name_search_document VALUES (?, 'model', ?, 'model-variant-name@1', unhex(''), unhex('61'), ?)",
          )
          .run(publicationId, modelId, HASH),
      "model/variant name search document does not match eligible canonical content",
    );
    expectConstraint(
      () =>
        insert.run(
          publicationId,
          "model",
          modelId,
          "410042",
          "006100",
          OTHER_HASH,
        ),
      "model/variant name search document does not match eligible canonical content",
    );
    expectConstraint(
      () =>
        insert.run(
          publicationId,
          "model",
          id("mdl", 899),
          "410042",
          "006100",
          HASH,
        ),
      "model/variant name search document does not match eligible canonical content",
    );

    insert.run(publicationId, "model", modelId, "410042", "006100", HASH);
    insert.run(publicationId, "variant", variantId, "0056", "760076", HASH);
    expect(
      database
        .prepare(
          "SELECT resource_type, resource_id, typeof(display_name_utf8) AS display_type, typeof(normalized_name_utf8) AS normalized_type, hex(display_name_utf8) AS display_hex, hex(normalized_name_utf8) AS normalized_hex FROM publication_model_variant_name_search_document ORDER BY resource_type",
        )
        .all(),
    ).toEqual([
      {
        resource_type: "model",
        resource_id: modelId,
        display_type: "blob",
        normalized_type: "blob",
        display_hex: "410042",
        normalized_hex: "006100",
      },
      {
        resource_type: "variant",
        resource_id: variantId,
        display_type: "blob",
        normalized_type: "blob",
        display_hex: "0056",
        normalized_hex: "760076",
      },
    ]);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication_model_variant_name_search_document SET normalized_name_utf8 = unhex('61') WHERE publication_id = ? AND resource_type = 'model'",
          )
          .run(publicationId),
      "model/variant name search document is immutable",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "DELETE FROM publication_model_variant_name_search_document WHERE publication_id = ? AND resource_type = 'variant'",
          )
          .run(publicationId),
      "model/variant name search document cannot be deleted",
    );

    const unknownPublicationId = id("pub", 812);
    const unknownModelId = id("mdl", 812);
    insertBuildingModelVariantNameContext(
      database,
      unknownPublicationId,
      [
        {
          resourceType: "model",
          resourceId: unknownModelId,
          displayNameState: "unknown",
        },
      ],
      812,
    );
    expectConstraint(
      () =>
        insert.run(
          unknownPublicationId,
          "model",
          unknownModelId,
          "55",
          "75",
          HASH,
        ),
      "model/variant name search document does not match eligible canonical content",
    );
  });

  it("enforces model projection byte bounds, identity, and bidirectional seal completeness", () => {
    const missing = applyMigrations(
      "serving",
      "0009_model_variant_name_exact_projection.sql",
    );
    const missingPublicationId = id("pub", 820);
    const missingModelId = id("mdl", 820);
    insertCompleteModelPublication(
      missing,
      missingPublicationId,
      missingModelId,
      "Missing Projection",
      820,
    );
    expectConstraint(() => {
      insertClosureSeal(missing, missingPublicationId);
    }, "model/variant name search projection does not close");

    const exactDisplay = "\ud83d\ude00".repeat(200);
    const exactDisplayHex = Buffer.from(exactDisplay, "utf8").toString("hex");
    const oversizedDisplayHex = `${exactDisplayHex}61`;
    const boundedPublicationId = id("pub", 821);
    const boundedModelId = id("mdl", 821);
    insertBuildingModelVariantNameContext(
      missing,
      boundedPublicationId,
      [
        {
          resourceType: "model",
          resourceId: boundedModelId,
          displayNameState: "known",
          displayName: `${exactDisplay}a`,
        },
      ],
      821,
    );
    expectConstraint(() =>
      missing
        .prepare(
          "INSERT INTO publication_model_variant_name_search_document VALUES (?, 'model', ?, 'model-variant-name@1', unhex(?), unhex('61'), ?)",
        )
        .run(boundedPublicationId, boundedModelId, oversizedDisplayHex, HASH),
    );
    expectConstraint(() =>
      missing
        .prepare(
          "INSERT INTO publication_model_variant_name_search_document VALUES (?, 'model', ?, 'model-variant-name@1', unhex(?), unhex(?), ?)",
        )
        .run(
          boundedPublicationId,
          boundedModelId,
          oversizedDisplayHex,
          "61".repeat(14_401),
          HASH,
        ),
    );

    missing
      .prepare(
        "INSERT INTO publication_model_variant_name_search_document VALUES (?, 'model', ?, 'model-variant-name@1', unhex(?), unhex(?), ?)",
      )
      .run(
        missingPublicationId,
        missingModelId,
        Buffer.from("Missing Projection", "utf8").toString("hex"),
        Buffer.from("missing projection", "utf8").toString("hex"),
        HASH,
      );
    insertClosureSeal(missing, missingPublicationId);
    expect(
      missing
        .prepare(
          "SELECT count(*) AS count FROM publication_closure_seal WHERE publication_id = ?",
        )
        .get(missingPublicationId),
    ).toEqual({ count: 1 });

    const reverse = applyMigrations(
      "serving",
      "0009_model_variant_name_exact_projection.sql",
    );
    const reversePublicationId = id("pub", 822);
    const reverseModelId = id("mdl", 822);
    insertCompleteModelPublication(
      reverse,
      reversePublicationId,
      reverseModelId,
      "Canonical Name",
      822,
    );
    reverse.exec(
      "DROP TRIGGER publication_model_variant_name_search_document_insert_guard",
    );
    reverse
      .prepare(
        "INSERT INTO publication_model_variant_name_search_document VALUES (?, 'model', ?, 'model-variant-name@1', unhex('44726966746564'), unhex('64726966746564'), ?)",
      )
      .run(reversePublicationId, reverseModelId, HASH);
    expectConstraint(() => {
      insertClosureSeal(reverse, reversePublicationId);
    }, "model/variant name search projection does not close");
  });

  it("rolls back a late migration 0009 failure and remains cleanly retryable", () => {
    const database = applyMigrations(
      "serving",
      "0008_provider_name_nul_guard.sql",
    );
    database.exec(`
      CREATE TRIGGER test_fail_schema_160_update
      BEFORE UPDATE ON serving_schema_metadata
      BEGIN SELECT RAISE(ABORT, 'injected late schema 1.6.0 failure'); END
    `);

    expect(() => {
      applyServingModelVariantNameMigration(database);
    }).toThrow("injected late schema 1.6.0 failure");
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.5.1" });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE name LIKE 'publication_model_variant_name_%'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('publication_provider_search_seal_guard', 'publication_provider_search_document_nul_insert_guard') ORDER BY name",
        )
        .all()
        .map((row) => row.name),
    ).toEqual([
      "publication_provider_search_document_nul_insert_guard",
      "publication_provider_search_seal_guard",
    ]);
    const v2Schemas = database
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('publication_readiness_receipt', 'publication_readiness_attestation', 'publication_probe_receipt', 'publication_switch_preflight', 'publication_switch_history') ORDER BY name",
      )
      .all() as { name: string; sql: string }[];
    expect(
      v2Schemas.find((row) => row.name === "publication_readiness_receipt")
        ?.sql,
    ).toContain("receipt_version = '2.0.0'");
    expect(
      v2Schemas.find((row) => row.name === "publication_switch_preflight")?.sql,
    ).toContain("preflight_version = '2.0.0'");
    expect(
      v2Schemas.find((row) => row.name === "publication_switch_history")?.sql,
    ).toContain("event_version = '1.0.0'");

    database.exec("DROP TRIGGER test_fail_schema_160_update");
    applyServingModelVariantNameMigration(database);
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.6.0" });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });

  it("adds the STRICT provider-model-ID projection and exact closed v4 schemas in 1.7.0", () => {
    const database = applyMigrations(
      "serving",
      "0010_provider_model_id_exact_projection.sql",
    );
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.7.0" });

    const schema = database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'publication_provider_model_id_search_document'",
      )
      .get() as { sql: string };
    expect(schema.sql).toContain("raw_provider_model_id_utf8 BLOB");
    expect(schema.sql).toContain("normalized_provider_model_id_utf8 BLOB");
    expect(schema.sql).toMatch(/\) STRICT$/u);
    expect(
      database
        .prepare(
          "PRAGMA index_info(publication_provider_model_id_raw_exact_idx)",
        )
        .all()
        .map((row) => row.name),
    ).toEqual(["publication_id", "raw_provider_model_id_utf8", "offering_id"]);
    expect(
      database
        .prepare(
          "PRAGMA index_info(publication_provider_model_id_normalized_exact_idx)",
        )
        .all()
        .map((row) => row.name),
    ).toEqual([
      "publication_id",
      "normalized_provider_model_id_utf8",
      "offering_id",
    ]);

    const providerModelIdProofColumns = [
      "provider_model_id_projection_version",
      "provider_model_id_document_count",
      "provider_model_id_inventory_hash",
      "provider_model_id_storage_version",
      "provider_model_id_storage_document_count",
      "provider_model_id_storage_queryable",
      "provider_model_id_storage_exact_parity",
    ];
    for (const table of [
      "publication_serving_receipt",
      "publication_switch_preflight",
    ]) {
      const columns = database
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name);
      expect(columns.slice(-7)).toEqual(providerModelIdProofColumns);
    }
    const schemas = database
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('publication_readiness_receipt', 'publication_readiness_attestation', 'publication_probe_receipt', 'publication_switch_preflight', 'publication_switch_history') ORDER BY name",
      )
      .all() as { name: string; sql: string }[];
    expect(
      schemas.find((row) => row.name === "publication_readiness_receipt")?.sql,
    ).toContain("receipt_version = '4.0.0'");
    expect(
      schemas.find((row) => row.name === "publication_readiness_attestation")
        ?.sql,
    ).toContain("evaluator_version = '4.0.0'");
    expect(
      schemas.find((row) => row.name === "publication_probe_receipt")?.sql,
    ).toContain("probe_set_version = 'search-gold@4'");
    expect(
      schemas.find((row) => row.name === "publication_switch_preflight")?.sql,
    ).toContain("preflight_version = '4.0.0'");
    expect(
      schemas.find((row) => row.name === "publication_switch_history")?.sql,
    ).toContain("event_version = '1.0.0'");
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });

  it("requires exact pristine schema 1.6.0 and rejects every provider-model-ID object collision before mutation", () => {
    const oldSchema = applyMigrations(
      "serving",
      "0008_provider_name_nul_guard.sql",
    );
    expect(() => {
      applyServingProviderModelIdMigration(oldSchema);
    }).toThrow();
    expect(
      oldSchema
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.5.1" });

    const proofBearing = applyMigrations(
      "serving",
      "0009_model_variant_name_exact_projection.sql",
    );
    proofBearing
      .prepare(
        "INSERT INTO publication VALUES (?, 'ready', '1.0.0', '1.0.0', 'precision@1', 'display@1', 'price@1', 'source@1', 'embedding@1', 'commit', ?, NULL, 1, 1, NULL, 0, 0, 0, ?, 'vector@1', ?, '[]', 1)",
      )
      .run(id("pub", 830), id("run", 830), HASH, OTHER_HASH);
    expect(() => {
      applyServingProviderModelIdMigration(proofBearing);
    }).toThrow();
    expect(
      proofBearing
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.6.0" });

    const collisions = [
      {
        name: "publication_provider_model_id_search_document",
        sql: "CREATE TABLE publication_provider_model_id_search_document(fake TEXT)",
      },
      {
        name: "publication_provider_model_id_raw_exact_idx",
        sql: "CREATE INDEX publication_provider_model_id_raw_exact_idx ON publication(publication_id)",
      },
      {
        name: "publication_provider_model_id_normalized_exact_idx",
        sql: "CREATE INDEX publication_provider_model_id_normalized_exact_idx ON publication(publication_id)",
      },
      ...[
        "publication_provider_model_id_search_document_insert_guard",
        "publication_provider_model_id_search_document_immutable_update",
        "publication_provider_model_id_search_document_immutable_delete",
        "publication_provider_model_id_search_seal_guard",
      ].map((name) => ({
        name,
        sql: `CREATE TRIGGER ${name} BEFORE INSERT ON publication BEGIN SELECT 1; END`,
      })),
    ];
    for (const collision of collisions) {
      const database = applyMigrations(
        "serving",
        "0009_model_variant_name_exact_projection.sql",
      );
      database.exec(collision.sql);
      expect(() => {
        applyServingProviderModelIdMigration(database);
      }).toThrow();
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.6.0" });
      expect(
        database
          .prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = ?")
          .get(collision.name),
      ).toEqual({ count: 1 });
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'publication_model_variant_name_search_seal_guard'",
          )
          .get(),
      ).toEqual({ count: 1 });
    }
  });

  it.each([
    {
      label: "missing retained exact index",
      objectName: "publication_model_variant_name_exact_idx",
      damage: "DROP INDEX publication_model_variant_name_exact_idx",
    },
    {
      label: "modified retained exact index",
      objectName: "publication_model_variant_name_exact_idx",
      damage: `DROP INDEX publication_model_variant_name_exact_idx;
        CREATE INDEX publication_model_variant_name_exact_idx
        ON publication_model_variant_name_search_document(
          publication_id,
          resource_id,
          normalized_name_utf8
        )`,
    },
    {
      label: "missing retained provider exact index",
      objectName: "publication_provider_search_exact_idx",
      damage: "DROP INDEX publication_provider_search_exact_idx",
    },
    {
      label: "modified retained provider exact index",
      objectName: "publication_provider_search_exact_idx",
      damage: `DROP INDEX publication_provider_search_exact_idx;
        CREATE INDEX publication_provider_search_exact_idx
        ON publication_provider_search_document(
          publication_id,
          provider_id,
          normalized_name
        )`,
    },
    {
      label: "missing retained immutable trigger",
      objectName:
        "publication_model_variant_name_search_document_immutable_update",
      damage:
        "DROP TRIGGER publication_model_variant_name_search_document_immutable_update",
    },
    {
      label: "missing retained provider insert guard",
      objectName: "publication_provider_search_document_insert_guard",
      damage: "DROP TRIGGER publication_provider_search_document_insert_guard",
    },
    {
      label: "missing retained provider FTS trigger",
      objectName: "publication_provider_search_fts_insert",
      damage: "DROP TRIGGER publication_provider_search_fts_insert",
    },
  ])(
    "rejects a $label before mutation and succeeds after exact repair",
    ({ damage, objectName }) => {
      const database = applyMigrations(
        "serving",
        "0009_model_variant_name_exact_projection.sql",
      );
      const original = database
        .prepare("SELECT type, sql FROM sqlite_master WHERE name = ?")
        .get(objectName) as { type: "index" | "trigger"; sql: string };
      database.exec(damage);

      expect(() => {
        applyServingProviderModelIdMigration(database);
      }).toThrow();
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.6.0" });
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name LIKE 'publication_provider_model_id_%'",
          )
          .get(),
      ).toEqual({ count: 0 });

      database.exec(
        `DROP ${original.type.toUpperCase()} IF EXISTS ${objectName}`,
      );
      database.exec(original.sql);
      applyServingProviderModelIdMigration(database);
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.7.0" });
    },
  );

  it("transactionally canonicalizes a message-preserving no-op retained trigger", () => {
    const database = applyMigrations(
      "serving",
      "0009_model_variant_name_exact_projection.sql",
    );
    const publicationId = id("pub", 829);
    const modelId = id("mdl", 829);
    insertBuildingModelVariantNameContext(
      database,
      publicationId,
      [
        {
          resourceType: "model",
          resourceId: modelId,
          displayNameState: "known",
          displayName: "Canonical trigger",
        },
      ],
      829,
    );
    database
      .prepare(
        "INSERT INTO publication_model_variant_name_search_document VALUES (?, 'model', ?, 'model-variant-name@1', CAST('Canonical trigger' AS BLOB), CAST('canonical trigger' AS BLOB), ?)",
      )
      .run(publicationId, modelId, HASH);

    const triggerName =
      "publication_model_variant_name_search_document_immutable_update";
    const canonical = database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
      )
      .get(triggerName) as { sql: string };
    database.exec(`DROP TRIGGER ${triggerName}`);
    database.exec(`CREATE TRIGGER ${triggerName}
      BEFORE UPDATE ON publication_model_variant_name_search_document
      WHEN 0
      BEGIN SELECT RAISE(ABORT, 'model/variant name search document is immutable'); END`);
    expect(
      database
        .prepare(
          "UPDATE publication_model_variant_name_search_document SET normalized_name_utf8 = normalized_name_utf8 WHERE publication_id = ? AND resource_id = ?",
        )
        .run(publicationId, modelId).changes,
    ).toBe(1);

    applyServingProviderModelIdMigration(database);
    expect(
      database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
        )
        .get(triggerName),
    ).toEqual(canonical);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication_model_variant_name_search_document SET normalized_name_utf8 = normalized_name_utf8 WHERE publication_id = ? AND resource_id = ?",
          )
          .run(publicationId, modelId),
      "model/variant name search document is immutable",
    );
  });

  it.each([
    "publication_model_variant_name_exact_idx",
    "publication_provider_search_exact_idx",
  ])(
    "rejects same-length partial retained index %s before mutation and remains retryable",
    (indexName) => {
      const database = applyMigrations(
        "serving",
        "0009_model_variant_name_exact_projection.sql",
      );
      const original = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .get(indexName) as { sql: string };
      const partial = `${original.sql
        .replaceAll("\n  ", "\n")
        .replace("(\npublication_id", "(publication_id")
        .replace(/\n\)$/u, ")")} WHERE 0`;
      expect(partial).toHaveLength(original.sql.length);

      database.exec(`DROP INDEX ${indexName}`);
      database.exec(partial);
      expect(
        database
          .prepare("SELECT partial FROM pragma_index_list(?) WHERE name = ?")
          .get(
            indexName === "publication_model_variant_name_exact_idx"
              ? "publication_model_variant_name_search_document"
              : "publication_provider_search_document",
            indexName,
          ),
      ).toEqual({ partial: 1 });

      expect(() => {
        applyServingProviderModelIdMigration(database);
      }).toThrow();
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.6.0" });
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name LIKE 'publication_provider_model_id_%'",
          )
          .get(),
      ).toEqual({ count: 0 });

      database.exec(`DROP INDEX ${indexName}`);
      database.exec(original.sql);
      applyServingProviderModelIdMigration(database);
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.7.0" });
    },
  );

  it.each([
    {
      label: "unique model index",
      indexName: "publication_model_variant_name_exact_idx",
      sql: `CREATE UNIQUE INDEX publication_model_variant_name_exact_idx
        ON publication_model_variant_name_search_document(
          publication_id, normalized_name_utf8, resource_id
        )`,
    },
    {
      label: "collated model index",
      indexName: "publication_model_variant_name_exact_idx",
      sql: `CREATE INDEX publication_model_variant_name_exact_idx
        ON publication_model_variant_name_search_document(
          publication_id, normalized_name_utf8 COLLATE NOCASE, resource_id
        )`,
    },
    {
      label: "descending model index",
      indexName: "publication_model_variant_name_exact_idx",
      sql: `CREATE INDEX publication_model_variant_name_exact_idx
        ON publication_model_variant_name_search_document(
          publication_id, normalized_name_utf8 DESC, resource_id
        )`,
    },
    {
      label: "unique provider index",
      indexName: "publication_provider_search_exact_idx",
      sql: `CREATE UNIQUE INDEX publication_provider_search_exact_idx
        ON publication_provider_search_document(
          publication_id, normalized_name, provider_id
        )`,
    },
    {
      label: "collated provider index",
      indexName: "publication_provider_search_exact_idx",
      sql: `CREATE INDEX publication_provider_search_exact_idx
        ON publication_provider_search_document(
          publication_id, normalized_name COLLATE NOCASE, provider_id
        )`,
    },
    {
      label: "descending provider index",
      indexName: "publication_provider_search_exact_idx",
      sql: `CREATE INDEX publication_provider_search_exact_idx
        ON publication_provider_search_document(
          publication_id, normalized_name DESC, provider_id
        )`,
    },
  ])(
    "rejects a $label before mutation and remains retryable",
    ({ indexName, sql }) => {
      const database = applyMigrations(
        "serving",
        "0009_model_variant_name_exact_projection.sql",
      );
      const original = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .get(indexName) as { sql: string };

      database.exec(`DROP INDEX ${indexName}`);
      database.exec(sql);
      expect(() => {
        applyServingProviderModelIdMigration(database);
      }).toThrow();
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.6.0" });
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name LIKE 'publication_provider_model_id_%'",
          )
          .get(),
      ).toEqual({ count: 0 });

      database.exec(`DROP INDEX ${indexName}`);
      database.exec(original.sql);
      applyServingProviderModelIdMigration(database);
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.7.0" });
    },
  );

  it.each([
    ["publication_closure_seal", ["publication_closure_seal_insert_guard"]],
    [
      "publication_readiness_receipt",
      ["publication_readiness_receipt_insert_guard"],
    ],
    [
      "publication_archive_receipt",
      ["publication_archive_receipt_insert_guard"],
    ],
    [
      "publication_serving_receipt",
      ["publication_serving_receipt_insert_guard"],
    ],
    ["publication_vector_receipt", ["publication_vector_receipt_insert_guard"]],
    ["publication_probe_receipt", ["publication_probe_receipt_insert_guard"]],
    [
      "publication_readiness_attestation",
      ["publication_readiness_attestation_insert_guard"],
    ],
    ["publication_head", ["publication_head_switch_insert"]],
    [
      "publication_switch_preflight",
      ["publication_switch_preflight_insert_guard"],
    ],
    [
      "publication_switch_history",
      [
        "publication_switch_history_insert_guard",
        "publication_switch_history_apply",
      ],
    ],
  ] as const)(
    "rejects a lone %s proof row while every publication remains building",
    (table, insertGuards) => {
      const database = applyMigrations(
        "serving",
        "0009_model_variant_name_exact_projection.sql",
      );
      const publicationId = id("pub", 835);
      insertBuildingPublication(
        database,
        publicationId,
        { resources: 1, exactDocuments: 0, vectorDocuments: 0 },
        null,
        835,
      );

      // Construct one schema-shaped orphan while constraint enforcement is
      // explicitly suspended. This isolates each migration precondition: no
      // seal, readiness row, or ready lifecycle state can short-circuit it.
      database.exec("PRAGMA foreign_keys = OFF");
      database.exec("PRAGMA ignore_check_constraints = ON");
      for (const insertGuard of insertGuards)
        database.exec(`DROP TRIGGER ${insertGuard}`);
      const columns = database.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
        type: string;
      }[];
      const values = columns.map((column) => {
        if (
          column.name === "publication_id" ||
          column.name === "active_publication_id" ||
          column.name === "to_publication_id"
        )
          return publicationId;
        return column.type === "INTEGER" ? 0 : "x";
      });
      database
        .prepare(
          `INSERT INTO ${table} (${columns.map((column) => `"${column.name}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        )
        .run(...values);
      database.exec("PRAGMA ignore_check_constraints = OFF");
      database.exec("PRAGMA foreign_keys = ON");

      expect(() => {
        applyServingProviderModelIdMigration(database);
      }).toThrow();
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.6.0" });
      expect(
        database
          .prepare("SELECT state FROM publication WHERE publication_id = ?")
          .get(publicationId),
      ).toEqual({ state: "building" });
      expect(
        database.prepare(`SELECT count(*) AS count FROM ${table}`).get(),
      ).toEqual({ count: 1 });
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'publication_provider_model_id_search_document'",
          )
          .get(),
      ).toEqual({ count: 0 });
    },
  );

  it.each([
    {
      proofTable: "publication_readiness_attestation",
      guardMessage:
        "provider model ID exact indexes are missing malformed or unqueryable",
      insertSql: `INSERT INTO publication_readiness_attestation(
        publication_id, environment, closure_hash, bundle_hash,
        evaluator_version, ready_at_ms, maximum_receipt_age_ms,
        effective_valid_until_ms, archive_observed_at_ms,
        serving_observed_at_ms, vector_observed_at_ms,
        probes_observed_at_ms, archive_receipt_hash,
        serving_receipt_hash, vector_receipt_hash,
        probes_receipt_hash, attestation_hash
      ) VALUES (?, 'local', ?, ?, '4.0.0', 0, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?)`,
      parameters: (publicationId: string) => [
        publicationId,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
      ],
    },
    {
      proofTable: "publication_switch_history",
      guardMessage:
        "switch-time provider model ID exact indexes are missing malformed or unqueryable",
      insertSql: `INSERT INTO publication_switch_history(
        switch_id, event_version, event_hash, preflight_hash, action,
        expected_prior_generation,
        expected_prior_rollback_candidate_publication_id,
        expected_prior_switched_at_ms, new_generation,
        from_publication_id, from_closure_hash, to_publication_id,
        to_closure_hash, to_attestation_hash,
        resulting_rollback_candidate_publication_id, switched_at_ms,
        authorized_by_kind, authorized_identity_id
      ) VALUES ('switch-index-guard', '1.0.0', ?, ?, 'activate',
        0, NULL, NULL, 1, NULL, NULL, ?, ?, ?, NULL, 0,
        'pipeline', 'pipeline:index-guard')`,
      parameters: (publicationId: string) => [
        HASH,
        OTHER_HASH,
        publicationId,
        HASH,
        OTHER_HASH,
      ],
    },
  ])(
    "rejects direct $proofTable insertion and rolls back missing or malformed exact indexes",
    ({ proofTable, guardMessage, insertSql, parameters }) => {
      const publicationId = id("pub", 838);
      for (const definition of [
        {
          name: "publication_provider_model_id_raw_exact_idx",
          columns: [
            "publication_id",
            "raw_provider_model_id_utf8",
            "offering_id",
          ],
          wrongColumns: ["publication_id", "provider_id", "offering_id"],
        },
        {
          name: "publication_provider_model_id_normalized_exact_idx",
          columns: [
            "publication_id",
            "normalized_provider_model_id_utf8",
            "offering_id",
          ],
          wrongColumns: ["publication_id", "target_resource_id", "offering_id"],
        },
      ]) {
        for (const mode of ["missing", "wrong-columns"] as const) {
          const database = applyMigrations("serving");
          database.exec("BEGIN IMMEDIATE");
          try {
            database.exec(`DROP INDEX ${definition.name}`);
            if (mode === "wrong-columns")
              database.exec(
                `CREATE INDEX ${definition.name} ON publication_provider_model_id_search_document(${definition.wrongColumns.join(", ")})`,
              );
            expect(() =>
              database.prepare(insertSql).run(...parameters(publicationId)),
            ).toThrow(mode === "missing" ? definition.name : guardMessage);
          } finally {
            database.exec("ROLLBACK");
          }
          expect(
            database
              .prepare(`PRAGMA index_info(${definition.name})`)
              .all()
              .map((row) => row.name),
          ).toEqual(definition.columns);
          expect(
            database
              .prepare(`SELECT count(*) AS count FROM ${proofTable}`)
              .get(),
          ).toEqual({ count: 0 });
          database.close();
        }
      }
    },
  );

  it.each([
    {
      proofTable: "publication_readiness_attestation",
      guardMessage:
        "provider model ID exact indexes are missing malformed or unqueryable",
      insertSql: `INSERT INTO publication_readiness_attestation(
        publication_id, environment, closure_hash, bundle_hash,
        evaluator_version, ready_at_ms, maximum_receipt_age_ms,
        effective_valid_until_ms, archive_observed_at_ms,
        serving_observed_at_ms, vector_observed_at_ms,
        probes_observed_at_ms, archive_receipt_hash,
        serving_receipt_hash, vector_receipt_hash,
        probes_receipt_hash, attestation_hash
      ) VALUES (?, 'local', ?, ?, '4.0.0', 0, 0, 0, 0, 0, 0, 0, ?, ?, ?, ?, ?)`,
      parameters: (publicationId: string) => [
        publicationId,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
        HASH,
      ],
    },
    {
      proofTable: "publication_switch_history",
      guardMessage:
        "switch-time provider model ID exact indexes are missing malformed or unqueryable",
      insertSql: `INSERT INTO publication_switch_history(
        switch_id, event_version, event_hash, preflight_hash, action,
        expected_prior_generation,
        expected_prior_rollback_candidate_publication_id,
        expected_prior_switched_at_ms, new_generation,
        from_publication_id, from_closure_hash, to_publication_id,
        to_closure_hash, to_attestation_hash,
        resulting_rollback_candidate_publication_id, switched_at_ms,
        authorized_by_kind, authorized_identity_id
      ) VALUES ('switch-ff-guard', '1.0.0', ?, ?, 'activate',
        0, NULL, NULL, 1, NULL, NULL, ?, ?, ?, NULL, 0,
        'pipeline', 'pipeline:ff-guard')`,
      parameters: (publicationId: string) => [
        HASH,
        OTHER_HASH,
        publicationId,
        HASH,
        OTHER_HASH,
      ],
    },
  ])(
    "executes both forced X'FF' miss probes before direct $proofTable insertion",
    ({ proofTable, guardMessage, insertSql, parameters }) => {
      for (const corruptColumn of [
        "raw_provider_model_id_utf8",
        "normalized_provider_model_id_utf8",
      ] as const) {
        const database = applyMigrations("serving");
        const publicationId = id("pub", 839);
        database.exec("PRAGMA foreign_keys = OFF");
        database.exec(
          "DROP TRIGGER publication_provider_model_id_search_document_insert_guard",
        );
        database
          .prepare(
            `INSERT INTO publication_provider_model_id_search_document(
              publication_id, offering_id, provider_id,
              target_resource_type, target_resource_id, projection_version,
              raw_provider_model_id_utf8,
              normalized_provider_model_id_utf8,
              offering_content_hash, target_content_hash
            ) VALUES (?, ?, ?, 'model', ?, 'provider-model-id@1',
              ${corruptColumn === "raw_provider_model_id_utf8" ? "X'FF'" : "X'61'"},
              ${corruptColumn === "normalized_provider_model_id_utf8" ? "X'FF'" : "X'61'"},
              ?, ?)`,
          )
          .run(
            publicationId,
            id("off", 839),
            id("prv", 839),
            id("mdl", 839),
            HASH,
            OTHER_HASH,
          );
        database.exec("PRAGMA foreign_keys = ON");

        expect(() =>
          database.prepare(insertSql).run(...parameters(publicationId)),
        ).toThrow(guardMessage);
        expect(
          database.prepare(`SELECT count(*) AS count FROM ${proofTable}`).get(),
        ).toEqual({ count: 0 });
        database.close();
      }
    },
  );

  it("stores duplicate exact provider model IDs as strict UTF-8 BLOBs and closes one row per offering", () => {
    const database = applyMigrations("serving");
    const publicationId = id("pub", 840);
    const providerId = id("prv", 840);
    const targetId = id("mdl", 840);
    const offerings = [
      { offeringId: id("off", 840), rawProviderModelId: "A\u0000B" },
      { offeringId: id("off", 841), rawProviderModelId: "A\u0000B" },
    ];
    insertBuildingProviderModelIdContext(
      database,
      publicationId,
      providerId,
      "model",
      targetId,
      offerings,
      840,
    );
    const rawHex = Buffer.from("A\u0000B", "utf8").toString("hex");
    insertProviderModelIdDocument(database, {
      publicationId,
      offeringId: offerings[0]!.offeringId,
      providerId,
      targetType: "model",
      targetId,
      rawHex,
      normalizedHex: "",
    });
    insertProviderModelIdDocument(database, {
      publicationId,
      offeringId: offerings[1]!.offeringId,
      providerId,
      targetType: "model",
      targetId,
      rawHex,
      normalizedHex: "",
    });
    expect(
      database
        .prepare(
          `SELECT offering_id, typeof(raw_provider_model_id_utf8) AS raw_type,
             typeof(normalized_provider_model_id_utf8) AS normalized_type,
             hex(raw_provider_model_id_utf8) AS raw_hex,
             hex(normalized_provider_model_id_utf8) AS normalized_hex
           FROM publication_provider_model_id_search_document
           WHERE publication_id = ? ORDER BY offering_id`,
        )
        .all(publicationId),
    ).toEqual(
      offerings.map((offering) => ({
        offering_id: offering.offeringId,
        raw_type: "blob",
        normalized_type: "blob",
        raw_hex: rawHex.toUpperCase(),
        normalized_hex: "",
      })),
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication_provider_model_id_search_document SET normalized_provider_model_id_utf8 = X'61' WHERE publication_id = ?",
          )
          .run(publicationId),
      "provider model ID search document is immutable",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "DELETE FROM publication_provider_model_id_search_document WHERE publication_id = ?",
          )
          .run(publicationId),
      "provider model ID search document cannot be deleted",
    );
    insertProviderModelIdClosureSeal(database, publicationId, offerings.length);
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_closure_seal WHERE publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({ count: 1 });
  });

  it("rejects malformed UTF-8, byte overflow, canonical drift, and incomplete provider-model-ID closure", () => {
    const database = applyMigrations("serving");
    const publicationId = id("pub", 850);
    const providerId = id("prv", 850);
    const targetId = id("var", 850);
    const offeringId = id("off", 850);
    insertBuildingProviderModelIdContext(
      database,
      publicationId,
      providerId,
      "variant",
      targetId,
      [{ offeringId, rawProviderModelId: "canonical/model" }],
      850,
    );
    expectConstraint(() => {
      insertProviderModelIdClosureSeal(database, publicationId, 1);
    }, "provider model ID search projection does not close");

    expectConstraint(() => {
      insertProviderModelIdDocument(database, {
        publicationId,
        offeringId,
        providerId,
        targetType: "variant",
        targetId,
        rawHex: "80",
        normalizedHex: "",
      });
    }, "raw provider model ID must be strict UTF-8");

    for (const malformedHex of ["80", "c080", "eda080", "f4908080"])
      expectConstraint(() => {
        insertProviderModelIdDocument(database, {
          publicationId,
          offeringId,
          providerId,
          targetType: "variant",
          targetId,
          rawHex: Buffer.from("canonical/model", "utf8").toString("hex"),
          normalizedHex: malformedHex,
        });
      }, "normalized provider model ID must be strict UTF-8");
    expectConstraint(() => {
      insertProviderModelIdDocument(database, {
        publicationId,
        offeringId,
        providerId,
        targetType: "variant",
        targetId,
        rawHex: Buffer.from("drifted/model", "utf8").toString("hex"),
        normalizedHex: "61",
      });
    }, "provider model ID search document does not match canonical offering and target content");
    expectConstraint(() => {
      insertProviderModelIdDocument(database, {
        publicationId,
        offeringId,
        providerId,
        targetType: "variant",
        targetId,
        rawHex: Buffer.from("canonical/model", "utf8").toString("hex"),
        normalizedHex: "61",
        targetHash: HASH,
      });
    }, "provider model ID search document does not match canonical offering and target content");

    database.exec(
      "DROP TRIGGER publication_provider_model_id_search_document_insert_guard",
    );
    expectConstraint(() => {
      insertProviderModelIdDocument(database, {
        publicationId,
        offeringId,
        providerId,
        targetType: "variant",
        targetId,
        rawHex: "61".repeat(1025),
        normalizedHex: "61",
      });
    });
    expectConstraint(() => {
      insertProviderModelIdDocument(database, {
        publicationId,
        offeringId,
        providerId,
        targetType: "variant",
        targetId,
        rawHex: Buffer.from("canonical/model", "utf8").toString("hex"),
        normalizedHex: "61".repeat(18_433),
      });
    });
    insertProviderModelIdDocument(database, {
      publicationId,
      offeringId,
      providerId,
      targetType: "variant",
      targetId,
      rawHex: Buffer.from("drifted/model", "utf8").toString("hex"),
      normalizedHex: "61",
    });
    expectConstraint(() => {
      insertProviderModelIdClosureSeal(database, publicationId, 1);
    }, "provider model ID search projection does not close");
  });

  it("accepts the exact provider-model-ID BLOB byte ceilings", () => {
    const database = applyMigrations("serving");
    const publicationId = id("pub", 860);
    const providerId = id("prv", 860);
    const targetId = id("mdl", 860);
    const offeringId = id("off", 860);
    const rawProviderModelId = "😀".repeat(256);
    insertBuildingProviderModelIdContext(
      database,
      publicationId,
      providerId,
      "model",
      targetId,
      [{ offeringId, rawProviderModelId }],
      860,
    );
    insertProviderModelIdDocument(database, {
      publicationId,
      offeringId,
      providerId,
      targetType: "model",
      targetId,
      rawHex: Buffer.from(rawProviderModelId, "utf8").toString("hex"),
      normalizedHex: "61".repeat(18_432),
    });
    expect(
      database
        .prepare(
          `SELECT length(raw_provider_model_id_utf8) AS raw_bytes,
             length(normalized_provider_model_id_utf8) AS normalized_bytes
           FROM publication_provider_model_id_search_document
           WHERE publication_id = ? AND offering_id = ?`,
        )
        .get(publicationId, offeringId),
    ).toEqual({ raw_bytes: 1024, normalized_bytes: 18_432 });
  });

  it("rolls back after every migration 0010 statement boundary and remains retryable", () => {
    const migration = readFileSync(
      resolve(
        "migrations",
        "serving",
        "0010_provider_model_id_exact_projection.sql",
      ),
      "utf8",
    );
    const statements = splitMigrationStatements(migration);
    expect(statements).toHaveLength(50);
    for (let boundary = 1; boundary <= statements.length; boundary += 1) {
      const database = applyMigrations(
        "serving",
        "0009_model_variant_name_exact_projection.sql",
      );
      expect(() => {
        applyAtomicMigration(
          database,
          `${statements.slice(0, boundary).join("\n")}\nSELECT * FROM __injected_migration_failure__;`,
        );
      }).toThrow();
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.6.0" });
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name LIKE 'publication_provider_model_id_%'",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = 'publication_model_variant_name_search_seal_guard'",
          )
          .get(),
      ).toEqual({ count: 1 });
      const receiptSchema = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'publication_readiness_receipt'",
        )
        .get() as { sql: string };
      expect(receiptSchema.sql).toContain("receipt_version = '3.0.0'");
      applyServingProviderModelIdMigration(database);
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.7.0" });
      database.close();
    }
  });

  it("adds exact partial covering retained-hot history indexes in schema 1.8.0", () => {
    const database = applyMigrations(
      "serving",
      "0011_retained_hot_publications.sql",
    );
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.8.0" });

    const expected = [
      {
        name: "publication_switch_history_from_retained_hot_idx",
        firstColumn: "from_publication_id",
        predicate: "WHERE from_publication_id IS NOT NULL",
      },
      {
        name: "publication_switch_history_prior_rollback_retained_hot_idx",
        firstColumn: "expected_prior_rollback_candidate_publication_id",
        predicate:
          "WHERE expected_prior_rollback_candidate_publication_id IS NOT NULL",
      },
    ] as const;
    const indexList = database
      .prepare("PRAGMA index_list(publication_switch_history)")
      .all() as {
      name: string;
      origin: string;
      partial: number;
      unique: number;
    }[];
    for (const index of expected) {
      expect(indexList).toContainEqual(
        expect.objectContaining({
          name: index.name,
          origin: "c",
          partial: 1,
          unique: 0,
        }),
      );
      const keyColumns = database
        .prepare(`PRAGMA index_xinfo(${index.name})`)
        .all()
        .filter((row) => row.key === 1)
        .map((row) => ({
          name: row.name,
          descending: row.desc,
          collation: row.coll,
        }));
      expect(keyColumns).toEqual([
        { name: index.firstColumn, descending: 0, collation: "BINARY" },
        { name: "switched_at_ms", descending: 1, collation: "BINARY" },
        { name: "new_generation", descending: 1, collation: "BINARY" },
      ]);
      const schema = database
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .get(index.name) as { sql: string };
      expect(schema.sql).toContain(index.predicate);
    }
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });

  it("requires exact clean schema 1.7.0 and rejects retained-hot object collisions before mutation", () => {
    const wrongVersion = applyMigrations(
      "serving",
      "0009_model_variant_name_exact_projection.sql",
    );
    expect(() => {
      applyServingRetainedHotPublicationMigration(wrongVersion);
    }).toThrow();
    expect(
      wrongVersion
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.6.0" });

    const dirty = applyMigrations(
      "serving",
      "0010_provider_model_id_exact_projection.sql",
    );
    const immutableTrigger = dirty
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'publication_switch_history_immutable_update'",
      )
      .get() as { sql: string };
    dirty.exec("DROP TRIGGER publication_switch_history_immutable_update");
    expect(() => {
      applyServingRetainedHotPublicationMigration(dirty);
    }).toThrow();
    expect(
      dirty
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.7.0" });
    dirty.exec(immutableTrigger.sql);

    dirty.exec("DROP TRIGGER publication_switch_history_immutable_update");
    dirty.exec(`CREATE TRIGGER publication_switch_history_immutable_update
      BEFORE UPDATE ON publication_switch_history WHEN 0
      BEGIN SELECT RAISE(ABORT, 'switch history is append-only'); END`);
    expect(() => {
      applyServingRetainedHotPublicationMigration(dirty);
    }).toThrow();
    expect(
      dirty
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.7.0" });
    dirty.exec("DROP TRIGGER publication_switch_history_immutable_update");
    dirty.exec(immutableTrigger.sql);

    const applyTrigger = dirty
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'publication_switch_history_apply'",
      )
      .get() as { sql: string };
    dirty.exec("DROP TRIGGER publication_switch_history_apply");
    const spoofedApplyPrefix = `CREATE TRIGGER publication_switch_history_apply
      AFTER INSERT ON publication_switch_history BEGIN
      SELECT 'update publication_head rollback_candidate_publication_id = new.resulting_rollback_candidate_publication_id';`;
    const spoofedApply = `${spoofedApplyPrefix}${" ".repeat(
      1067 - spoofedApplyPrefix.length - " END".length,
    )} END`;
    expect(spoofedApply).toHaveLength(1067);
    dirty.exec(spoofedApply);
    expect(() => {
      applyServingRetainedHotPublicationMigration(dirty);
    }).toThrow();
    dirty.exec("DROP TRIGGER publication_switch_history_apply");
    dirty.exec(applyTrigger.sql);

    dirty.exec(
      "CREATE TABLE publication_switch_history_from_retained_hot_idx(fake INTEGER)",
    );
    expect(() => {
      applyServingRetainedHotPublicationMigration(dirty);
    }).toThrow();
    expect(
      dirty
        .prepare(
          `SELECT schema_version,
             (SELECT count(*) FROM sqlite_master
              WHERE type = 'index' AND name LIKE 'publication_switch_history_%_retained_hot_idx') AS retained_hot_index_count
           FROM serving_schema_metadata WHERE singleton = 1`,
        )
        .get(),
    ).toEqual({ schema_version: "1.7.0", retained_hot_index_count: 0 });
    dirty.exec("DROP TABLE publication_switch_history_from_retained_hot_idx");
    applyServingRetainedHotPublicationMigration(dirty);
    expect(
      dirty
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.8.0" });
  });

  it("rolls back after every migration 0011 statement boundary and remains retryable", () => {
    const migration = readFileSync(
      resolve("migrations", "serving", "0011_retained_hot_publications.sql"),
      "utf8",
    );
    const statements = splitMigrationStatements(migration);
    expect(statements).toHaveLength(7);
    for (let boundary = 1; boundary <= statements.length; boundary += 1) {
      const database = applyMigrations(
        "serving",
        "0010_provider_model_id_exact_projection.sql",
      );
      expect(() => {
        applyAtomicMigration(
          database,
          `${statements.slice(0, boundary).join("\n")}\nSELECT * FROM __injected_migration_failure__;`,
        );
      }).toThrow();
      expect(
        database
          .prepare(
            `SELECT schema_version,
               (SELECT count(*) FROM sqlite_master
                WHERE type = 'index' AND name LIKE 'publication_switch_history_%_retained_hot_idx') AS retained_hot_index_count
             FROM serving_schema_metadata WHERE singleton = 1`,
          )
          .get(),
      ).toEqual({ schema_version: "1.7.0", retained_hot_index_count: 0 });
      applyServingRetainedHotPublicationMigration(database);
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.8.0" });
      database.close();
    }
  });

  it("adds the exact nonunique provider eligibility index in schema 1.9.0", () => {
    const database = applyMigrations("serving");
    expect(
      database
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.9.0" });
    expect(
      database
        .prepare(
          `SELECT "unique" AS is_unique, origin, partial
           FROM pragma_index_list('publication_provider_model_id_search_document')
           WHERE name = 'publication_provider_model_id_eligibility_idx'`,
        )
        .get(),
    ).toEqual({ is_unique: 0, origin: "c", partial: 0 });
    expect(
      database
        .prepare(
          "PRAGMA index_info(publication_provider_model_id_eligibility_idx)",
        )
        .all()
        .map((row) => row.name),
    ).toEqual([
      "publication_id",
      "provider_id",
      "target_resource_type",
      "target_resource_id",
      "offering_id",
    ]);
    const eligibilityGuard = database
      .prepare(
        `SELECT sql FROM sqlite_master
         WHERE type = 'trigger'
           AND name = 'publication_switch_history_provider_eligibility_index_guard'`,
      )
      .get() as { sql: string } | undefined;
    expect(eligibilityGuard?.sql).toContain(
      "target_resource_type = '__queryability_probe__'",
    );
    const plan = database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT offering_id
         FROM publication_provider_model_id_search_document
           INDEXED BY publication_provider_model_id_eligibility_idx
         WHERE publication_id = ?
           AND provider_id = ?
           AND target_resource_type = ?
           AND target_resource_id = ?`,
      )
      .all(
        "pub_ffffffff-ffff-4fff-bfff-ffffffffffff",
        "prv_ffffffff-ffff-4fff-bfff-ffffffffffff",
        "model",
        "mdl_ffffffff-ffff-4fff-bfff-ffffffffffff",
      );
    expect(plan.map((row) => row.detail).join("\n")).toContain(
      "publication_provider_model_id_eligibility_idx",
    );
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });

  it("requires exact clean schema 1.8.0 and rejects provider eligibility object collisions", () => {
    const wrongVersion = applyMigrations(
      "serving",
      "0010_provider_model_id_exact_projection.sql",
    );
    expect(() => {
      applyServingProviderEligibilityMigration(wrongVersion);
    }).toThrow();
    expect(
      wrongVersion
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.7.0" });

    const dirty = applyMigrations(
      "serving",
      "0011_retained_hot_publications.sql",
    );
    dirty.exec("DROP INDEX publication_provider_model_id_raw_exact_idx");
    dirty.exec(`CREATE INDEX publication_provider_model_id_raw_exact_idx
      ON publication_provider_model_id_search_document(publication_id, provider_id, offering_id)`);
    expect(() => {
      applyServingProviderEligibilityMigration(dirty);
    }).toThrow();
    expect(
      dirty
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE name = 'publication_provider_model_id_eligibility_idx'",
        )
        .get(),
    ).toEqual({ count: 0 });
    dirty.close();

    const missingGuard = applyMigrations(
      "serving",
      "0011_retained_hot_publications.sql",
    );
    missingGuard.exec(
      "DROP TRIGGER publication_provider_model_id_search_document_insert_guard",
    );
    expect(() => {
      applyServingProviderEligibilityMigration(missingGuard);
    }).toThrow();
    expect(
      missingGuard
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.8.0" });
    missingGuard.close();

    const malformedForeignKeys = applyMigrations(
      "serving",
      "0011_retained_hot_publications.sql",
    );
    malformedForeignKeys.enableDefensive(false);
    try {
      malformedForeignKeys.exec(`
        PRAGMA writable_schema = ON;
        UPDATE sqlite_schema
        SET sql = replace(
          sql,
          'REFERENCES publication_resource(publication_id, resource_type, resource_id)',
          'REFERENCES publication_resource(resource_id, resource_type, publication_id)'
        )
        WHERE type = 'table'
          AND name = 'publication_provider_model_id_search_document';
        PRAGMA writable_schema = RESET;
      `);
    } finally {
      malformedForeignKeys.enableDefensive(true);
    }
    expect(() => {
      applyServingProviderEligibilityMigration(malformedForeignKeys);
    }).toThrow();
    expect(
      malformedForeignKeys
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.8.0" });
    malformedForeignKeys.close();

    const collision = applyMigrations(
      "serving",
      "0011_retained_hot_publications.sql",
    );
    collision.exec(
      "CREATE TABLE publication_provider_model_id_eligibility_idx(fake INTEGER)",
    );
    expect(() => {
      applyServingProviderEligibilityMigration(collision);
    }).toThrow();
    expect(
      collision
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.8.0" });
    collision.close();

    const triggerCollision = applyMigrations(
      "serving",
      "0011_retained_hot_publications.sql",
    );
    triggerCollision.exec(`CREATE TRIGGER publication_switch_history_provider_eligibility_index_guard
      BEFORE INSERT ON publication_switch_history BEGIN SELECT 1; END`);
    expect(() => {
      applyServingProviderEligibilityMigration(triggerCollision);
    }).toThrow();
    expect(
      triggerCollision
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.8.0" });
    triggerCollision.close();
  });

  it("rolls back after every migration 0012 statement boundary and remains retryable", () => {
    const migration = readFileSync(
      resolve(
        "migrations",
        "serving",
        "0012_provider_model_eligibility_index.sql",
      ),
      "utf8",
    );
    const statements = splitMigrationStatements(migration);
    expect(statements).toHaveLength(8);
    for (let boundary = 1; boundary <= statements.length; boundary += 1) {
      const database = applyMigrations(
        "serving",
        "0011_retained_hot_publications.sql",
      );
      expect(() => {
        applyAtomicMigration(
          database,
          `${statements.slice(0, boundary).join("\n")}\nSELECT * FROM __injected_migration_failure__;`,
        );
      }).toThrow();
      expect(
        database
          .prepare(
            `SELECT schema_version,
               (SELECT count(*) FROM sqlite_master
                WHERE name IN (
                  'publication_provider_model_id_eligibility_idx',
                  'publication_switch_history_provider_eligibility_index_guard'
                )) AS eligibility_object_count
             FROM serving_schema_metadata WHERE singleton = 1`,
          )
          .get(),
      ).toEqual({ schema_version: "1.8.0", eligibility_object_count: 0 });
      applyServingProviderEligibilityMigration(database);
      expect(
        database
          .prepare(
            "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
          )
          .get(),
      ).toEqual({ schema_version: "1.9.0" });
      database.close();
    }
  });

  it("fails switch insertion when the provider eligibility index is missing or malformed", () => {
    for (const replacement of [
      null,
      `CREATE INDEX publication_provider_model_id_eligibility_idx
       ON publication_provider_model_id_search_document(publication_id, offering_id)`,
      `CREATE INDEX publication_provider_model_id_eligibility_idx
       ON publication_provider_model_id_search_document(
         publication_id COLLATE NOCASE DESC,
         provider_id COLLATE NOCASE DESC,
         target_resource_type COLLATE NOCASE DESC,
         target_resource_id COLLATE NOCASE DESC,
         offering_id COLLATE NOCASE DESC
       )`,
    ]) {
      const database = applyMigrations("serving");
      database.exec("DROP INDEX publication_provider_model_id_eligibility_idx");
      if (replacement !== null) database.exec(replacement);
      expect(() => {
        database.exec("INSERT INTO publication_switch_history DEFAULT VALUES");
      }).toThrow(
        replacement === null
          ? "no such index: publication_provider_model_id_eligibility_idx"
          : "switch-time provider eligibility index is missing malformed or unqueryable",
      );
      database.close();
    }
  });

  it("atomically rejects malformed metadata and colliding activation objects", () => {
    const malformed = applyMigrations(
      "serving",
      "0005_readiness_receipt_ledger.sql",
    );
    malformed.exec("DROP TABLE serving_schema_metadata");
    malformed.exec(
      "CREATE TABLE serving_schema_metadata(singleton INTEGER, schema_version TEXT, created_at_ms INTEGER)",
    );
    malformed.exec(
      "INSERT INTO serving_schema_metadata VALUES (1, '1.3.0', 0), (2, '1.3.0', 0)",
    );
    expect(() => {
      applyServingActivationMigration(malformed);
    }).toThrow();
    expect(
      malformed
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE name = 'publication_switch_preflight'",
        )
        .get(),
    ).toEqual({ count: 0 });

    const collision = applyMigrations(
      "serving",
      "0005_readiness_receipt_ledger.sql",
    );
    collision.exec("CREATE TABLE publication_switch_history(fake TEXT)");
    expect(() => {
      applyServingActivationMigration(collision);
    }).toThrow();
    expect(
      collision
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('publication_switch_preflight', 'publication_switch_history') ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: "publication_switch_history" }]);
    expect(
      collision
        .prepare(
          "SELECT schema_version FROM serving_schema_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ schema_version: "1.3.0" });
  });

  it("activates and rolls back only through fresh exact-generation switch events", () => {
    const database = applyMigrations(
      "serving",
      "0006_exact_generation_activation.sql",
    );
    const clockMs = Math.floor(Date.now() / 1_000) * 1_000;
    const firstPublicationId = id("pub", 400);
    const secondPublicationId = id("pub", 410);
    insertAttestedReadyPublication(database, firstPublicationId, 401, clockMs);
    insertAttestedReadyPublication(database, secondPublicationId, 411, clockMs);

    const firstPreflight = switchPreflightValues({
      switchId: "publication-switch|activate|1|first",
      action: "activate",
      expectedGeneration: 0,
      expectedRollbackPublicationId: null,
      expectedSwitchedAtMs: null,
      fromPublicationId: null,
      toPublicationId: firstPublicationId,
      switchedAtMs: clockMs + 1_000,
      observedAtMs: clockMs,
    });
    insertSwitchPreflight(database, firstPreflight);
    const competingFirstPreflight = [...firstPreflight];
    competingFirstPreflight[0] = "publication-switch|activate|1|competing";
    expectConstraint(() => {
      insertSwitchPreflight(database, competingFirstPreflight);
    });
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication_switch_preflight SET vector_queryable = 0 WHERE switch_id = ?",
          )
          .run(String(firstPreflight[0])),
      "switch preflight is immutable",
    );
    insertSwitchHistory(database, {
      switchId: String(firstPreflight[0]),
      eventHash: HASH,
      action: "activate",
      expectedGeneration: 0,
      expectedRollbackPublicationId: null,
      expectedSwitchedAtMs: null,
      fromPublicationId: null,
      toPublicationId: firstPublicationId,
      switchedAtMs: clockMs + 1_000,
    });
    expect(
      database
        .prepare(
          "SELECT active_publication_id, rollback_candidate_publication_id, generation FROM publication_head",
        )
        .get(),
    ).toEqual({
      active_publication_id: firstPublicationId,
      rollback_candidate_publication_id: null,
      generation: 1,
    });
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'superseded' WHERE publication_id = ?",
          )
          .run(firstPublicationId),
      "publication demotion lacks its exact switch event",
    );
    expectConstraint(() => {
      insertSwitchPreflight(
        database,
        switchPreflightValues({
          switchId: "publication-switch|activate|2|wrong-rollback",
          action: "activate",
          expectedGeneration: 1,
          expectedRollbackPublicationId: secondPublicationId,
          expectedSwitchedAtMs: clockMs + 1_000,
          fromPublicationId: firstPublicationId,
          toPublicationId: secondPublicationId,
          switchedAtMs: clockMs + 2_000,
          observedAtMs: clockMs,
        }),
      );
    }, "switch preflight does not match the exact head generation");
    expectConstraint(() => {
      insertSwitchPreflight(
        database,
        switchPreflightValues({
          switchId: "publication-switch|activate|2|wrong-time",
          action: "activate",
          expectedGeneration: 1,
          expectedRollbackPublicationId: null,
          expectedSwitchedAtMs: clockMs,
          fromPublicationId: firstPublicationId,
          toPublicationId: secondPublicationId,
          switchedAtMs: clockMs + 2_000,
          observedAtMs: clockMs,
        }),
      );
    }, "switch preflight does not match the exact head generation");

    const secondPreflight = switchPreflightValues({
      switchId: "publication-switch|activate|2|second",
      action: "activate",
      expectedGeneration: 1,
      expectedRollbackPublicationId: null,
      expectedSwitchedAtMs: clockMs + 1_000,
      fromPublicationId: firstPublicationId,
      toPublicationId: secondPublicationId,
      switchedAtMs: clockMs + 2_000,
      observedAtMs: clockMs,
    });
    insertSwitchPreflight(database, secondPreflight);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'active', activated_at_ms = ? WHERE publication_id = ?",
          )
          .run(clockMs + 2_000, secondPublicationId),
      "publication activation lacks its exact switch event",
    );
    insertSwitchHistory(database, {
      switchId: String(secondPreflight[0]),
      eventHash: OTHER_HASH,
      action: "activate",
      expectedGeneration: 1,
      expectedRollbackPublicationId: null,
      expectedSwitchedAtMs: clockMs + 1_000,
      fromPublicationId: firstPublicationId,
      toPublicationId: secondPublicationId,
      switchedAtMs: clockMs + 2_000,
    });
    expect(
      database
        .prepare(
          "SELECT publication_id, state FROM publication WHERE publication_id IN (?, ?) ORDER BY publication_id",
        )
        .all(firstPublicationId, secondPublicationId),
    ).toEqual([
      { publication_id: firstPublicationId, state: "superseded" },
      { publication_id: secondPublicationId, state: "active" },
    ]);

    const rollbackPreflight = switchPreflightValues({
      switchId: "publication-switch|rollback|3|first",
      action: "rollback",
      expectedGeneration: 2,
      expectedRollbackPublicationId: firstPublicationId,
      expectedSwitchedAtMs: clockMs + 2_000,
      fromPublicationId: secondPublicationId,
      toPublicationId: firstPublicationId,
      switchedAtMs: clockMs + 3_000,
      observedAtMs: clockMs,
    });
    insertSwitchPreflight(database, rollbackPreflight);
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication SET state = 'active' WHERE publication_id = ?",
          )
          .run(firstPublicationId),
      "publication rollback lacks its exact switch event",
    );
    insertSwitchHistory(database, {
      switchId: String(rollbackPreflight[0]),
      eventHash: THIRD_HASH,
      action: "rollback",
      expectedGeneration: 2,
      expectedRollbackPublicationId: firstPublicationId,
      expectedSwitchedAtMs: clockMs + 2_000,
      fromPublicationId: secondPublicationId,
      toPublicationId: firstPublicationId,
      switchedAtMs: clockMs + 3_000,
    });
    expect(
      database
        .prepare(
          "SELECT active_publication_id, rollback_candidate_publication_id, generation FROM publication_head",
        )
        .get(),
    ).toEqual({
      active_publication_id: firstPublicationId,
      rollback_candidate_publication_id: secondPublicationId,
      generation: 3,
    });
    expect(
      database
        .prepare("SELECT state FROM publication WHERE publication_id = ?")
        .get(secondPublicationId),
    ).toEqual({ state: "rolled_back" });

    expectConstraint(() => {
      insertSwitchPreflight(
        database,
        switchPreflightValues({
          switchId: "publication-switch|rollback|4|second",
          action: "rollback",
          expectedGeneration: 3,
          expectedRollbackPublicationId: secondPublicationId,
          expectedSwitchedAtMs: clockMs + 3_000,
          fromPublicationId: firstPublicationId,
          toPublicationId: secondPublicationId,
          switchedAtMs: clockMs + 4_000,
          observedAtMs: clockMs,
        }),
      );
    }, "rollback target is not the immediate superseded publication");
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication_head SET generation = 5 WHERE singleton = 1",
          )
          .run(),
      "publication head update is not the exact next generation",
    );
    expectConstraint(
      () => database.prepare("DELETE FROM publication_head").run(),
      "publication head switching is not implemented",
    );
    expectConstraint(
      () =>
        database
          .prepare(
            "UPDATE publication_switch_history SET authorized_identity_id = 'operator:test' WHERE new_generation = 1",
          )
          .run(),
      "switch history is append-only",
    );
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("rolls a complete switch batch back when late lifecycle application fails", () => {
    const database = applyMigrations(
      "serving",
      "0006_exact_generation_activation.sql",
    );
    const clockMs = Math.floor(Date.now() / 1_000) * 1_000;
    const firstPublicationId = id("pub", 440);
    const secondPublicationId = id("pub", 450);
    insertAttestedReadyPublication(database, firstPublicationId, 441, clockMs);
    insertAttestedReadyPublication(database, secondPublicationId, 451, clockMs);

    const firstPreflight = switchPreflightValues({
      switchId: "publication-switch|activate|1|late-failure-first",
      action: "activate",
      expectedGeneration: 0,
      expectedRollbackPublicationId: null,
      expectedSwitchedAtMs: null,
      fromPublicationId: null,
      toPublicationId: firstPublicationId,
      switchedAtMs: clockMs + 1_000,
      observedAtMs: clockMs,
    });
    insertSwitchPreflight(database, firstPreflight);
    insertSwitchHistory(database, {
      switchId: String(firstPreflight[0]),
      eventHash: HASH,
      action: "activate",
      expectedGeneration: 0,
      expectedRollbackPublicationId: null,
      expectedSwitchedAtMs: null,
      fromPublicationId: null,
      toPublicationId: firstPublicationId,
      switchedAtMs: clockMs + 1_000,
    });

    database.exec(`
      CREATE TRIGGER test_fail_late_demotion
      BEFORE UPDATE OF state ON publication
      WHEN OLD.publication_id = '${firstPublicationId}' AND NEW.state = 'superseded'
      BEGIN SELECT RAISE(ABORT, 'injected late demotion failure'); END
    `);
    const secondSwitchId = "publication-switch|activate|2|late-failure-second";
    database.exec("BEGIN IMMEDIATE");
    try {
      insertSwitchPreflight(
        database,
        switchPreflightValues({
          switchId: secondSwitchId,
          action: "activate",
          expectedGeneration: 1,
          expectedRollbackPublicationId: null,
          expectedSwitchedAtMs: clockMs + 1_000,
          fromPublicationId: firstPublicationId,
          toPublicationId: secondPublicationId,
          switchedAtMs: clockMs + 2_000,
          observedAtMs: clockMs,
        }),
      );
      expectConstraint(() => {
        insertSwitchHistory(database, {
          switchId: secondSwitchId,
          eventHash: OTHER_HASH,
          action: "activate",
          expectedGeneration: 1,
          expectedRollbackPublicationId: null,
          expectedSwitchedAtMs: clockMs + 1_000,
          fromPublicationId: firstPublicationId,
          toPublicationId: secondPublicationId,
          switchedAtMs: clockMs + 2_000,
        });
      }, "injected late demotion failure");
    } finally {
      database.exec("ROLLBACK");
    }

    expect(
      database
        .prepare(
          "SELECT active_publication_id, rollback_candidate_publication_id, switched_at_ms, generation FROM publication_head",
        )
        .get(),
    ).toEqual({
      active_publication_id: firstPublicationId,
      rollback_candidate_publication_id: null,
      switched_at_ms: clockMs + 1_000,
      generation: 1,
    });
    expect(
      database
        .prepare(
          "SELECT publication_id, state, activated_at_ms FROM publication WHERE publication_id IN (?, ?) ORDER BY publication_id",
        )
        .all(firstPublicationId, secondPublicationId),
    ).toEqual([
      {
        publication_id: firstPublicationId,
        state: "active",
        activated_at_ms: clockMs + 1_000,
      },
      {
        publication_id: secondPublicationId,
        state: "ready",
        activated_at_ms: null,
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_switch_preflight WHERE switch_id = ?",
        )
        .get(secondSwitchId),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_switch_history WHERE new_generation = 2",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("rejects stale activation proof and bidirectional FTS drift", () => {
    const database = applyMigrations(
      "serving",
      "0006_exact_generation_activation.sql",
    );
    const clockMs = Math.floor(Date.now() / 1_000) * 1_000;
    const publicationId = id("pub", 430);
    insertAttestedReadyPublication(database, publicationId, 431, clockMs);

    const stale = switchPreflightValues({
      switchId: "publication-switch|activate|1|stale",
      action: "activate",
      expectedGeneration: 0,
      expectedRollbackPublicationId: null,
      expectedSwitchedAtMs: null,
      fromPublicationId: null,
      toPublicationId: publicationId,
      switchedAtMs: clockMs - 60_000,
      observedAtMs: clockMs - 120_000,
    });
    expectConstraint(() => {
      insertSwitchPreflight(database, stale);
    }, "switch preflight is stale or outside the database clock bound");

    database
      .prepare(
        "INSERT INTO publication_search_fts(publication_id, document_id, normalized_name, aliases, publisher_name, provider_model_ids, document_text) VALUES (?, ?, 'extra', '[]', '', '[]', 'extra')",
      )
      .run(publicationId, "f".repeat(64));
    const drifted = switchPreflightValues({
      switchId: "publication-switch|activate|1|drifted",
      action: "activate",
      expectedGeneration: 0,
      expectedRollbackPublicationId: null,
      expectedSwitchedAtMs: null,
      fromPublicationId: null,
      toPublicationId: publicationId,
      switchedAtMs: clockMs + 1_000,
      observedAtMs: clockMs,
    });
    expectConstraint(() => {
      insertSwitchPreflight(database, drifted);
    }, "switch preflight FTS does not exactly match its sealed source");
    expect(
      database.prepare("SELECT count(*) AS count FROM publication_head").get(),
    ).toEqual({ count: 0 });
  });

  it("rechecks FTS parity after preflight and before changing the head", () => {
    const database = applyMigrations(
      "serving",
      "0006_exact_generation_activation.sql",
    );
    const clockMs = Math.floor(Date.now() / 1_000) * 1_000;
    const publicationId = id("pub", 460);
    insertAttestedReadyPublication(database, publicationId, 461, clockMs);
    const preflight = switchPreflightValues({
      switchId: "publication-switch|activate|1|post-preflight-drift",
      action: "activate",
      expectedGeneration: 0,
      expectedRollbackPublicationId: null,
      expectedSwitchedAtMs: null,
      fromPublicationId: null,
      toPublicationId: publicationId,
      switchedAtMs: clockMs + 1_000,
      observedAtMs: clockMs,
    });
    insertSwitchPreflight(database, preflight);
    database
      .prepare("DELETE FROM publication_search_fts WHERE publication_id = ?")
      .run(publicationId);

    expectConstraint(() => {
      insertSwitchHistory(database, {
        switchId: String(preflight[0]),
        eventHash: HASH,
        action: "activate",
        expectedGeneration: 0,
        expectedRollbackPublicationId: null,
        expectedSwitchedAtMs: null,
        fromPublicationId: null,
        toPublicationId: publicationId,
        switchedAtMs: clockMs + 1_000,
      });
    }, "switch-time FTS parity changed after preflight");
    expect(
      database.prepare("SELECT count(*) AS count FROM publication_head").get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          "SELECT state, activated_at_ms FROM publication WHERE publication_id = ?",
        )
        .get(publicationId),
    ).toEqual({ state: "ready", activated_at_ms: null });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_switch_history WHERE switch_id = ?",
        )
        .get(String(preflight[0])),
    ).toEqual({ count: 0 });
  });
});
