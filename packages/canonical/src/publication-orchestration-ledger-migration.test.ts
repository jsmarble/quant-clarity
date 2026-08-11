import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

const MIGRATION = "0006_publication_orchestration_ledger.sql";
const HARDENING_MIGRATION = "0007_admitted_plan_revocation_history.sql";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const HASH_D = `sha256:${"d".repeat(64)}`;
const SCHEDULED_AT = Date.parse("2026-08-10T05:00:00.000Z");
const OBSERVED_AT = SCHEDULED_AT + 100;
const STARTED_AT = SCHEDULED_AT + 200;
const DEADLINE_AT = SCHEDULED_AT + 43_200_000;
const APPROVAL_ROLES =
  '["legal_source_owner","platform_owner","product_owner"]';

function id(prefix: string, sequence: number): string {
  return `${prefix}_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;
}

function sql(filename = MIGRATION): string {
  return readFileSync(resolve("migrations", "canonical", filename), "utf8");
}

function applyAtomic(database: DatabaseSync, migration: string): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(migration);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function predecessor(through = "0005_publication_run_plan_authority.sql") {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const filename of readdirSync(
    resolve("migrations", "canonical"),
  ).sort()) {
    if (filename > through) continue;
    applyAtomic(database, sql(filename));
  }
  return database;
}

function initializedDatabase() {
  const database = predecessor();
  applyAtomic(database, sql());
  database
    .prepare(
      `INSERT INTO publication_orchestration_environment(
        singleton, environment, monthly_allocation_microusd, initialized_at_ms
      ) VALUES (1, 'preview', 25000000, ?)`,
    )
    .run(SCHEDULED_AT - 10_000);
  return database;
}

function hardenedDatabase() {
  const database = initializedDatabase();
  applyAtomic(database, sql(HARDENING_MIGRATION));
  return database;
}

function expectConstraint(action: () => unknown, message?: string): void {
  expect(action).toThrow(
    message ??
      /constraint|immutable|cannot|lacks|mismatch|disabled|already|exact|no such|malformed/iu,
  );
}

function seedApprovedPlan(
  database: DatabaseSync,
  options: {
    costMicrousd?: number;
    approvalState?: "approved" | "pending";
    excerptPermitted?: 0 | 1;
    reviewedAt?: number;
    nextReviewAt?: number;
    rosterItemCount?: number;
  } = {},
) {
  const costMicrousd = options.costMicrousd ?? 1_000_000;
  const approvalState = options.approvalState ?? "approved";
  const approvedPermission = approvalState === "approved" ? 1 : 0;
  const providerId = id("prv", 1);
  const runPlanId = id("rpl", 1);
  const rosterVersion = "roster@1";
  const sourceRegisterVersion = "sources@1";
  database
    .prepare(
      "INSERT INTO resource_identity(resource_id, resource_type, created_at_ms) VALUES (?, 'provider', 1)",
    )
    .run(providerId);
  database
    .prepare(
      "INSERT INTO provider(provider_id, slug, display_name, normalized_name, status, aliases_json, created_at_ms) VALUES (?, 'provider-one', 'Provider One', 'provider one', 'active', '[]', 1)",
    )
    .run(providerId);
  database
    .prepare(
      "INSERT INTO provider_roster(provider_id, roster_version, content_hash, created_at_ms) VALUES (?, ?, ?, 1)",
    )
    .run(providerId, rosterVersion, HASH_A);
  const rosterItem = database.prepare(
    `INSERT INTO provider_roster_item(
        provider_id, roster_version, roster_item_id, provider_model_id,
        tier_key, endpoint_class, material_region_key
      ) VALUES (?, ?, ?, ?, 'standard', 'chat', 'global')`,
  );
  for (
    let ordinal = 1;
    ordinal <= (options.rosterItemCount ?? 1);
    ordinal += 1
  ) {
    rosterItem.run(
      providerId,
      rosterVersion,
      `item-${String(ordinal)}`,
      `model-${String(ordinal)}`,
    );
  }
  database
    .prepare(
      `INSERT INTO source_compliance_record(
        provider_id, register_version, artifact_path, artifact_hash,
        source_ids_json, reviewer_role, reviewed_at_ms, next_review_at_ms,
        approval_state, access_permitted, retention_permitted,
        excerpt_permitted, publication_permitted,
        attribution_requirements, restrictions, created_at_ms
      ) VALUES (?, ?, 'docs/compliance/sources/provider-one.md', ?,
        '["catalog"]', 'legal_source_owner', ?, ?, ?, ?, ?, ?, ?, '', '', 1)`,
    )
    .run(
      providerId,
      sourceRegisterVersion,
      HASH_B,
      options.reviewedAt ?? 1,
      options.nextReviewAt ?? SCHEDULED_AT + 86_400_000,
      approvalState,
      approvedPermission,
      approvedPermission,
      options.excerptPermitted ?? approvedPermission,
      approvedPermission,
    );
  database
    .prepare(
      `INSERT INTO publication_run_plan(
        run_plan_id, contract_version, canonical_schema_version,
        pipeline_contract_version, environment, schedule_name,
        schedule_expression, effective_from_ms, effective_to_ms,
        provider_count, provider_scope_hash, policy_set_hash, plan_hash,
        created_at_ms
      ) VALUES (?, 'publication-run-plan@1', '1.0.0', 'pipeline-contract@1',
        'preview', 'provider-refresh-v1', '0 5 * * 1,4', ?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(
      runPlanId,
      SCHEDULED_AT - 1_000,
      SCHEDULED_AT + 86_400_000,
      HASH_A,
      HASH_B,
      HASH_C,
      SCHEDULED_AT - 2_000,
    );
  database
    .prepare(
      `INSERT INTO publication_run_plan_provider(
        run_plan_id, ordinal, provider_id, adapter_version, roster_version,
        roster_content_hash, source_register_version, source_artifact_hash,
        request_ceiling, byte_ceiling, ai_token_ceiling,
        browser_millisecond_ceiling, elapsed_millisecond_ceiling,
        cost_microusd_ceiling, retry_policy_hash
      ) VALUES (?, 0, ?, 'adapter@1', ?, ?, ?, ?, 10, 100, 2, 3, 4, ?, ?)`,
    )
    .run(
      runPlanId,
      providerId,
      rosterVersion,
      HASH_A,
      sourceRegisterVersion,
      HASH_B,
      costMicrousd,
      HASH_D,
    );
  const policy = database.prepare(
    "INSERT INTO publication_run_plan_policy(run_plan_id, role, policy_version, policy_hash) VALUES (?, ?, ?, ?)",
  );
  policy.run(runPlanId, "run_budget", "budget@1", HASH_A);
  policy.run(runPlanId, "provider_retry", "retry@1", HASH_D);
  policy.run(runPlanId, "terminal_deadline", "deadline@1", HASH_C);
  database
    .prepare(
      `INSERT INTO publication_run_plan_seal(
        run_plan_id, contract_version, provider_count, provider_scope_hash,
        policy_count, policy_set_hash, plan_hash, sealed_at_ms
      ) VALUES (?, 'publication-run-plan@1', 1, ?, 3, ?, ?, ?)`,
    )
    .run(runPlanId, HASH_A, HASH_B, HASH_C, SCHEDULED_AT - 1_500);
  database
    .prepare(
      `INSERT INTO publication_run_plan_approval(
        run_plan_id, approval_roles_json, artifact_path, artifact_hash,
        approved_at_ms
      ) VALUES (?, ?, 'docs/compliance/run-plans/preview-plan.md', ?, ?)`,
    )
    .run(runPlanId, APPROVAL_ROLES, HASH_D, SCHEDULED_AT - 1_200);
  return {
    providerId,
    runPlanId,
    rosterVersion,
    sourceRegisterVersion,
    costMicrousd,
  };
}

function insertOccurrence(
  database: DatabaseSync,
  runPlanId: string,
  sequence = 1,
) {
  const occurrenceId = id("occ", sequence);
  database
    .prepare(
      `INSERT INTO schedule_occurrence(
        occurrence_id, scheduled_at_ms, schedule_expression, schedule_name,
        created_at_ms
      ) VALUES (?, ?, '0 5 * * 1,4', 'provider-refresh-v1', ?)`,
    )
    .run(occurrenceId, SCHEDULED_AT, SCHEDULED_AT);
  database
    .prepare(
      `INSERT INTO publication_orchestration_occurrence(
        occurrence_id, environment, requested_run_plan_id,
        requested_run_plan_hash, observed_at_ms, created_at_ms
      ) VALUES (?, 'preview', ?, ?, ?, ?)`,
    )
    .run(occurrenceId, runPlanId, HASH_C, OBSERVED_AT, OBSERVED_AT);
  return occurrenceId;
}

function insertRun(
  database: DatabaseSync,
  occurrenceId: string,
  runPlanId: string,
  input: {
    sequence?: number;
    attempt?: number;
    replayOf?: string;
    projected?: number;
    alertPercent?: 50 | 75;
    startedAt?: number;
    costCeiling?: number;
  } = {},
) {
  const runId = id("run", input.sequence ?? 1);
  const attempt = input.attempt ?? 1;
  database
    .prepare(
      `INSERT INTO publication_coordination_run(
        run_id, occurrence_id, attempt_number, replay_of_run_id,
        replay_authority, replay_authorization_hash, run_plan_id,
        run_plan_hash, environment, code_version, canonical_schema_version,
        pipeline_contract_version, provider_count, provider_scope_hash,
        policy_set_hash, deadline_at_ms, observed_at_ms, started_at_ms,
        request_ceiling, byte_ceiling, ai_token_ceiling,
        browser_millisecond_ceiling, elapsed_millisecond_ceiling,
        cost_microusd_ceiling, projected_monthly_cost_microusd,
        budget_alert_percent, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'preview', 'git:abcdef', '1.0.0',
        'pipeline-contract@1', 1, ?, ?, ?, ?, ?, 10, 100, 2, 3, 4,
        ?, ?, ?, ?)`,
    )
    .run(
      runId,
      occurrenceId,
      attempt,
      input.replayOf ?? null,
      attempt === 1 ? null : "protected_operator",
      attempt === 1 ? null : HASH_D,
      runPlanId,
      HASH_C,
      HASH_A,
      HASH_B,
      DEADLINE_AT,
      OBSERVED_AT,
      input.startedAt ?? STARTED_AT,
      input.costCeiling ?? 1_000_000,
      input.projected ?? 1_000_000,
      input.alertPercent ?? null,
      OBSERVED_AT,
    );
  return runId;
}

function insertReservation(
  database: DatabaseSync,
  runId: string,
  costMicrousd = 1_000_000,
) {
  database
    .prepare(
      `INSERT INTO publication_run_budget_reservation(
        run_id, environment, budget_month, breaker_generation,
        monthly_used_snapshot_microusd, monthly_reserved_snapshot_microusd,
        reserved_cost_microusd, reserved_at_ms
      ) VALUES (?, 'preview', '2026-08', 1, 0, 0, ?, ?)`,
    )
    .run(runId, costMicrousd, STARTED_AT);
}

function insertProviderRun(
  database: DatabaseSync,
  runId: string,
  plan: ReturnType<typeof seedApprovedPlan>,
  sequence = 1,
  admittedAt = OBSERVED_AT,
) {
  const providerRunId = id("pvr", sequence);
  database
    .prepare(
      `INSERT INTO publication_coordination_provider_run(
        provider_run_id, run_id, provider_id, ordinal, adapter_version,
        roster_version, roster_content_hash, source_register_version,
        source_artifact_hash, request_ceiling, byte_ceiling, ai_token_ceiling,
        browser_millisecond_ceiling, elapsed_millisecond_ceiling,
        cost_microusd_ceiling, retry_policy_hash, admitted_at_ms, created_at_ms
      ) VALUES (?, ?, ?, 0, 'adapter@1', ?, ?, ?, ?, 10, 100, 2, 3, 4,
        1000000, ?, ?, ?)`,
    )
    .run(
      providerRunId,
      runId,
      plan.providerId,
      plan.rosterVersion,
      HASH_A,
      plan.sourceRegisterVersion,
      HASH_B,
      HASH_D,
      admittedAt,
      admittedAt,
    );
  return providerRunId;
}

function insertSyntheticRejection(
  database: DatabaseSync,
  occurrenceId: string,
  runPlanId: string,
) {
  const report = JSON.stringify({
    reportSchemaVersion: "publication-run-report@2",
    kind: "rejected_firing",
    scheduleName: "provider-refresh-v1",
    scheduleExpression: "0 5 * * 1,4",
    occurrenceId,
    scheduledAt: new Date(SCHEDULED_AT).toISOString(),
    observedAt: new Date(OBSERVED_AT).toISOString(),
    rejectionCode: "runtime_version_mismatch",
    requestedPlan: {
      runPlanId,
      runPlanHash: HASH_C,
      environment: "preview",
    },
    seal: { algorithm: "sha256", contentHash: HASH_D },
  });
  database
    .prepare(
      `INSERT INTO publication_admission_rejection(
        occurrence_id, rejection_code, report_schema_version, report_text,
        report_hash, created_at_ms
      ) VALUES (?, 'runtime_version_mismatch',
        'publication-run-report@2', ?, ?, ?)`,
    )
    .run(occurrenceId, report, HASH_D, OBSERVED_AT);
}

describe("canonical parallel publication-orchestration migration (PIPE-001–PIPE-008, PIPE-043–PIPE-045)", () => {
  it("installs atomically only over the exact predecessor and leaves environment uninitialized", () => {
    const database = predecessor();
    applyAtomic(database, sql());
    expect(
      database
        .prepare(
          "SELECT capability FROM publication_orchestration_integrity_metadata WHERE singleton = 1",
        )
        .get(),
    ).toEqual({ capability: "publication-orchestration-ledger@1" });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_orchestration_environment",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare(
          `SELECT count(*) AS count FROM sqlite_schema
           WHERE type = 'table' AND name IN (
             'publication_orchestration_integrity_metadata',
             'publication_orchestration_environment',
             'publication_orchestration_occurrence',
             'publication_admission_rejection',
             'publication_coordination_run',
             'publication_coordination_provider_run',
             'publication_budget_breaker_event',
             'publication_run_budget_reservation',
             'publication_provider_fence_claim',
             'publication_provider_fence_reconciliation',
             'publication_provider_fence_release',
             'publication_provider_fence_head',
             'publication_roster_operational_outcome',
             'publication_retained_publication_authority',
             'publication_provider_terminal',
             'publication_run_terminal'
           ) AND sql NOT LIKE '%STRICT%'`,
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const missing = predecessor("0004_model_slug_history_integrity.sql");
    expectConstraint(() => {
      applyAtomic(missing, sql());
    });
    expect(
      missing
        .prepare(
          "SELECT count(*) AS count FROM sqlite_schema WHERE name = 'publication_orchestration_integrity_metadata'",
        )
        .get(),
    ).toEqual({ count: 0 });

    const collision = predecessor();
    collision.exec(
      "CREATE VIEW publication_coordination_run AS SELECT 1 AS value",
    );
    expectConstraint(() => {
      applyAtomic(collision, sql());
    });
    expect(
      collision
        .prepare(
          "SELECT count(*) AS count FROM sqlite_schema WHERE name = 'publication_orchestration_integrity_metadata'",
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("binds one immutable physical environment and closes the legacy run graph", () => {
    const database = initializedDatabase();
    expectConstraint(() => {
      database.exec(
        "INSERT INTO publication_orchestration_environment VALUES (1, 'production', 0, 1)",
      );
    });
    expectConstraint(() => {
      database.exec(
        "UPDATE publication_orchestration_environment SET monthly_allocation_microusd = 1",
      );
    }, "publication orchestration environment is immutable");
    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO pipeline_run(
            run_id, occurrence_id, attempt_number, code_version,
            schema_version, provider_scope_json, status, started_at_ms,
            created_at_ms
          ) VALUES (?, ?, 1, 'legacy', '1', '[]', 'pending', 1, 1)`,
        )
        .run(id("run", 99), id("occ", 99));
    }, "legacy pipeline run graph is disabled");
    expect(
      database.prepare("SELECT count(*) AS count FROM pipeline_run").get(),
    ).toEqual({
      count: 0,
    });

    const activeLegacy = predecessor();
    applyAtomic(activeLegacy, sql());
    const legacyOccurrenceId = id("occ", 77);
    const legacyRunId = id("run", 77);
    const legacyAcquisitionId = id("src", 77);
    const legacyOrganizationId = id("org", 77);
    const legacyProviderId = id("prv", 78);
    const legacyProviderRunId = id("pvr", 78);
    const legacyAnomalyId = id("anm", 78);
    const legacyQuarantineId = id("qrn", 78);
    const legacyPolicyId = id("pol", 77);
    const legacyObservationId = id("obs", 77);
    const legacyEvidenceId = id("evd", 77);
    const legacyModelId = id("mdl", 77);
    const legacyScopeId = id("scp", 77);
    const legacyClaimId = id("clm", 77);
    const legacyParameterFactId = id("par", 77);
    activeLegacy
      .prepare(
        `INSERT INTO schedule_occurrence(
          occurrence_id, scheduled_at_ms, schedule_expression, schedule_name,
          created_at_ms
        ) VALUES (?, ?, 'legacy', 'legacy', ?)`,
      )
      .run(legacyOccurrenceId, SCHEDULED_AT, SCHEDULED_AT);
    activeLegacy
      .prepare(
        `INSERT INTO pipeline_run(
          run_id, occurrence_id, attempt_number, code_version,
          schema_version, provider_scope_json, status, started_at_ms,
          created_at_ms
        ) VALUES (?, ?, 1, 'legacy', '1', '[]', 'pending', ?, ?)`,
      )
      .run(legacyRunId, legacyOccurrenceId, SCHEDULED_AT, SCHEDULED_AT);
    activeLegacy
      .prepare(
        "INSERT INTO resource_identity(resource_id, resource_type, created_at_ms) VALUES (?, 'organization', 1)",
      )
      .run(legacyOrganizationId);
    activeLegacy
      .prepare(
        `INSERT INTO organization(
          organization_id, slug, display_name, normalized_name,
          organization_kind, created_at_ms
        ) VALUES (?, 'legacy-owner', 'Legacy Owner', 'legacy owner', 'other', 1)`,
      )
      .run(legacyOrganizationId);
    activeLegacy
      .prepare(
        `INSERT INTO acquisition_run(
          acquisition_run_id, run_id, source_owner_organization_id,
          source_type, status, started_at_ms, created_at_ms
        ) VALUES (?, ?, ?, 'public_static_page', 'pending', ?, ?)`,
      )
      .run(
        legacyAcquisitionId,
        legacyRunId,
        legacyOrganizationId,
        SCHEDULED_AT,
        SCHEDULED_AT,
      );
    activeLegacy
      .prepare(
        "INSERT INTO resource_identity(resource_id, resource_type, created_at_ms) VALUES (?, 'provider', 1)",
      )
      .run(legacyProviderId);
    activeLegacy
      .prepare(
        `INSERT INTO provider(
          provider_id, slug, display_name, normalized_name, status,
          aliases_json, created_at_ms
        ) VALUES (?, 'legacy-provider', 'Legacy Provider', 'legacy provider',
          'active', '[]', 1)`,
      )
      .run(legacyProviderId);
    activeLegacy
      .prepare(
        "INSERT INTO provider_roster(provider_id, roster_version, content_hash, created_at_ms) VALUES (?, 'legacy-roster', ?, 1)",
      )
      .run(legacyProviderId, HASH_A);
    activeLegacy
      .prepare(
        `INSERT INTO source_compliance_record(
          provider_id, register_version, artifact_path, artifact_hash,
          source_ids_json, reviewer_role, reviewed_at_ms, next_review_at_ms,
          approval_state, access_permitted, retention_permitted,
          excerpt_permitted, publication_permitted,
          attribution_requirements, restrictions, created_at_ms
        ) VALUES (?, 'legacy-sources',
          'docs/compliance/sources/legacy-provider.md', ?, '["legacy"]',
          'legal_source_owner', 1, ?, 'approved', 1, 1, 1, 1, '', '', 1)`,
      )
      .run(legacyProviderId, HASH_B, SCHEDULED_AT + 86_400_000);
    activeLegacy
      .prepare(
        `INSERT INTO provider_run(
          provider_run_id, run_id, provider_id, adapter_version,
          roster_version, source_register_version, status, started_at_ms,
          created_at_ms
        ) VALUES (?, ?, ?, 'legacy-adapter', 'legacy-roster',
          'legacy-sources', 'pending', ?, ?)`,
      )
      .run(
        legacyProviderRunId,
        legacyRunId,
        legacyProviderId,
        SCHEDULED_AT,
        SCHEDULED_AT,
      );
    activeLegacy
      .prepare(
        `INSERT INTO policy_version(
          policy_id, kind, version, effective_at_ms, content_hash, status
        ) VALUES (?, 'normalization', 'legacy@1', 1, ?, 'active')`,
      )
      .run(legacyPolicyId, HASH_C);
    activeLegacy
      .prepare(
        "INSERT INTO resource_identity(resource_id, resource_type, created_at_ms) VALUES (?, 'model', 1)",
      )
      .run(legacyModelId);
    activeLegacy
      .prepare(
        `INSERT INTO claim_scope(
          scope_id, scope_kind, subject_resource_id, source_object_locator,
          observed_from_ms, complete
        ) VALUES (?, 'model', ?, 'legacy:model', 1, 1)`,
      )
      .run(legacyScopeId, legacyModelId);
    activeLegacy
      .prepare(
        `INSERT INTO observation(
          observation_id, acquisition_run_id, source_id, source_type,
          source_owner, safe_locator, retrieved_at_ms, extraction_method,
          extraction_version, policy_id, redacted_hash, authenticated_only,
          created_at_ms
        ) VALUES (?, ?, 'legacy-source', 'public_static_page', 'Legacy Owner',
          'https://example.com', ?, 'deterministic', 'v1', ?, ?, 0, ?)`,
      )
      .run(
        legacyObservationId,
        legacyAcquisitionId,
        SCHEDULED_AT,
        legacyPolicyId,
        HASH_A,
        SCHEDULED_AT,
      );
    activeLegacy
      .prepare(
        `INSERT INTO evidence(
          evidence_id, observation_id, private_r2_key, public_summary_json,
          source_span_locator, integrity_hash, retention_class, created_at_ms
        ) VALUES (?, ?, 'private/legacy', '{}', 'body', ?,
          'private_24_month_minimum', ?)`,
      )
      .run(legacyEvidenceId, legacyObservationId, HASH_B, SCHEDULED_AT);
    activeLegacy
      .prepare(
        `INSERT INTO field_claim(
          claim_id, subject_resource_id, field_name, raw_value_json,
          normalized_value_json, value_state, observation_id, evidence_id,
          scope_id, precedence_class, verification_state, policy_id,
          valid_from_ms, qualifiers_json, created_at_ms
        ) VALUES (?, ?, 'total_parameters', '1', '1', 'known', ?, ?, ?,
          'publisher', 'verified', ?, 1, '{}', ?)`,
      )
      .run(
        legacyClaimId,
        legacyModelId,
        legacyObservationId,
        legacyEvidenceId,
        legacyScopeId,
        legacyPolicyId,
        SCHEDULED_AT,
      );
    activeLegacy
      .prepare(
        `INSERT INTO parameter_fact(
          parameter_fact_id, model_resource_id, parameter_kind, raw_value,
          normalized_decimal, approximation_state, claim_id, created_at_ms
        ) VALUES (?, ?, 'total', '1', '1', 'exact', ?, ?)`,
      )
      .run(legacyParameterFactId, legacyModelId, legacyClaimId, SCHEDULED_AT);
    activeLegacy
      .prepare(
        `INSERT INTO anomaly(
          anomaly_id, provider_run_id, subject_resource_id, kind, status,
          created_at_ms
        ) VALUES (?, ?, ?, 'legacy-conflict', 'detected', ?)`,
      )
      .run(
        legacyAnomalyId,
        legacyProviderRunId,
        legacyProviderId,
        SCHEDULED_AT,
      );
    activeLegacy
      .prepare(
        `INSERT INTO quarantine(
          quarantine_id, provider_run_id, subject_resource_id, reason_code,
          created_at_ms
        ) VALUES (?, ?, ?, 'legacy-integrity', ?)`,
      )
      .run(
        legacyQuarantineId,
        legacyProviderRunId,
        legacyProviderId,
        SCHEDULED_AT,
      );
    expectConstraint(() => {
      activeLegacy.exec(
        `INSERT INTO publication_orchestration_environment VALUES (
          1, 'preview', 25000000, ${String(SCHEDULED_AT)}
        )`,
      );
    }, "legacy run graph must be quiescent before orchestration initialization");
    activeLegacy
      .prepare(
        "UPDATE acquisition_run SET status = 'failed', ended_at_ms = ? WHERE acquisition_run_id = ?",
      )
      .run(SCHEDULED_AT + 1, legacyAcquisitionId);
    activeLegacy
      .prepare(
        "UPDATE provider_run SET status = 'failed', ended_at_ms = ? WHERE provider_run_id = ?",
      )
      .run(SCHEDULED_AT + 2, legacyProviderRunId);
    activeLegacy
      .prepare(
        "UPDATE pipeline_run SET status = 'failed', ended_at_ms = ? WHERE run_id = ?",
      )
      .run(SCHEDULED_AT + 3, legacyRunId);
    activeLegacy.exec(
      `INSERT INTO publication_orchestration_environment VALUES (
        1, 'preview', 25000000, ${String(SCHEDULED_AT + 4)}
      )`,
    );
    const blockedLegacyInserts = [
      ["pipeline_run", "legacy pipeline run graph is disabled"],
      ["provider_run", "legacy provider run graph is disabled"],
      ["acquisition_run", "legacy acquisition graph is disabled"],
      ["roster_outcome", "legacy roster outcomes are disabled"],
      ["observation", "legacy observations require provenance-v2 authority"],
      ["evidence", "legacy evidence requires provenance-v2 authority"],
      ["field_claim", "legacy field claims require provenance-v2 authority"],
      [
        "claim_conflict",
        "legacy claim conflicts require provenance-v2 authority",
      ],
      [
        "parameter_fact",
        "legacy parameter facts require provenance-v2 authority",
      ],
      [
        "precision_observation",
        "legacy precision observations require provenance-v2 authority",
      ],
      [
        "precision_component",
        "legacy precision components require provenance-v2 authority",
      ],
      [
        "price_schedule",
        "legacy price schedules require provenance-v2 authority",
      ],
      ["anomaly", "legacy anomalies require provenance-v2 authority"],
      ["quarantine", "legacy quarantines require provenance-v2 authority"],
    ] as const;
    for (const [table, message] of blockedLegacyInserts) {
      expectConstraint(() => {
        activeLegacy.exec(`INSERT INTO ${table} DEFAULT VALUES`);
      }, message);
    }

    const blockedMutableLegacyRows = [
      [
        "parameter_fact",
        "parameter_fact_id",
        legacyParameterFactId,
        "legacy parameter facts require provenance-v2 authority",
      ],
      [
        "anomaly",
        "anomaly_id",
        legacyAnomalyId,
        "legacy anomalies require provenance-v2 authority",
      ],
      [
        "quarantine",
        "quarantine_id",
        legacyQuarantineId,
        "legacy quarantines require provenance-v2 authority",
      ],
    ] as const;
    for (const [table, key, value, message] of blockedMutableLegacyRows) {
      expectConstraint(() => {
        activeLegacy
          .prepare(
            `UPDATE ${table} SET created_at_ms = created_at_ms WHERE ${key} = ?`,
          )
          .run(value);
      }, message);
      expectConstraint(() => {
        activeLegacy
          .prepare(`DELETE FROM ${table} WHERE ${key} = ?`)
          .run(value);
      }, message);
    }
  });

  it("rejects legacy-prefix lookalikes that are not registered UUID-v4 identifiers", () => {
    const database = initializedDatabase();
    const plan = seedApprovedPlan(database);
    const malformedOccurrence = "occ_00000001-0000-5000-8000-000000000001";
    database
      .prepare(
        `INSERT INTO schedule_occurrence(
          occurrence_id, scheduled_at_ms, schedule_expression, schedule_name,
          created_at_ms
        ) VALUES (?, ?, '0 5 * * 1,4', 'provider-refresh-v1', ?)`,
      )
      .run(malformedOccurrence, SCHEDULED_AT, SCHEDULED_AT);
    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO publication_orchestration_occurrence(
            occurrence_id, environment, requested_run_plan_id,
            requested_run_plan_hash, observed_at_ms, created_at_ms
          ) VALUES (?, 'preview', ?, ?, ?, ?)`,
        )
        .run(
          malformedOccurrence,
          plan.runPlanId,
          HASH_C,
          OBSERVED_AT,
          OBSERVED_AT,
        );
    });
  });

  it("denies caller-supplied durable rejection truth until the atomic D1 resolver exists", () => {
    const database = initializedDatabase();
    const plan = seedApprovedPlan(database);
    const occurrenceId = insertOccurrence(database, plan.runPlanId);
    const reportHash = HASH_D;
    const report = JSON.stringify({
      reportSchemaVersion: "publication-run-report@2",
      kind: "rejected_firing",
      scheduleName: "provider-refresh-v1",
      scheduleExpression: "0 5 * * 1,4",
      occurrenceId,
      scheduledAt: new Date(SCHEDULED_AT).toISOString(),
      observedAt: new Date(OBSERVED_AT).toISOString(),
      rejectionCode: "budget_exceeded",
      requestedPlan: {
        runPlanId: plan.runPlanId,
        runPlanHash: HASH_C,
        environment: "preview",
      },
      seal: { algorithm: "sha256", contentHash: reportHash },
    });
    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO publication_admission_rejection(
            occurrence_id, rejection_code, report_schema_version, report_text,
            report_hash, created_at_ms
          ) VALUES (?, 'budget_exceeded', 'publication-run-report@2', ?, ?, ?)`,
        )
        .run(occurrenceId, report, reportHash, OBSERVED_AT);
    }, "publication admission rejection requires the atomic D1 admission resolver");
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_admission_rejection",
        )
        .get(),
    ).toEqual({ count: 0 });
    insertRun(database, occurrenceId, plan.runPlanId);
  });

  it("rechecks exact roster, source review, permission, and scheduled-instant revocation authority", () => {
    const hostileSources = [
      { approvalState: "pending" as const },
      { excerptPermitted: 0 as const },
      { reviewedAt: SCHEDULED_AT + 1 },
      { nextReviewAt: SCHEDULED_AT },
    ];
    for (const [index, options] of hostileSources.entries()) {
      const database = initializedDatabase();
      const plan = seedApprovedPlan(database, options);
      const occurrenceId = insertOccurrence(
        database,
        plan.runPlanId,
        index + 20,
      );
      expectConstraint(() => {
        insertRun(database, occurrenceId, plan.runPlanId, {
          sequence: index + 20,
        });
      }, "publication coordination run lacks exact admitted plan authority");
    }

    const corruptedAuthority = [
      `DROP TRIGGER provider_roster_immutable_update;
       DROP TRIGGER provider_roster_run_plan_frozen_update;
       UPDATE provider_roster SET content_hash = '${HASH_D}'`,
      `DROP TRIGGER source_compliance_immutable_update;
       DROP TRIGGER source_compliance_run_plan_frozen_update;
       UPDATE source_compliance_record SET artifact_hash = '${HASH_D}'`,
      `DROP TRIGGER provider_roster_item_immutable_delete;
       DROP TRIGGER provider_roster_item_run_plan_frozen_delete;
       DELETE FROM provider_roster_item`,
    ];
    for (const [index, corruption] of corruptedAuthority.entries()) {
      const database = initializedDatabase();
      const plan = seedApprovedPlan(database);
      database.exec(corruption);
      const occurrenceId = insertOccurrence(
        database,
        plan.runPlanId,
        index + 40,
      );
      expectConstraint(() => {
        insertRun(database, occurrenceId, plan.runPlanId, {
          sequence: index + 40,
        });
      }, "publication coordination run lacks exact admitted plan authority");
    }

    const revokedDatabase = initializedDatabase();
    const revokedPlan = seedApprovedPlan(revokedDatabase);
    revokedDatabase
      .prepare(
        `INSERT INTO publication_run_plan_revocation(
          run_plan_id, reason_code, effective_at_ms
        ) VALUES (?, 'integrity_failure', ?)`,
      )
      .run(revokedPlan.runPlanId, SCHEDULED_AT);
    const revokedOccurrenceId = insertOccurrence(
      revokedDatabase,
      revokedPlan.runPlanId,
      30,
    );
    expectConstraint(() => {
      insertRun(revokedDatabase, revokedOccurrenceId, revokedPlan.runPlanId, {
        sequence: 30,
      });
    }, "publication coordination run lacks exact admitted plan authority");
  });

  it("reserves the exact global UTC-month snapshot and rejects stale or over-allocation admission", () => {
    const database = initializedDatabase();
    const plan = seedApprovedPlan(database);
    const occurrenceId = insertOccurrence(database, plan.runPlanId);
    database.exec(
      `INSERT INTO publication_budget_breaker_event(
        environment, budget_month, generation, tripped, observed_at_ms
      ) VALUES ('preview', '2026-08', 1, 0, ${String(OBSERVED_AT)})`,
    );
    expectConstraint(() => {
      insertRun(database, occurrenceId, plan.runPlanId, {
        sequence: 99,
        replayOf: id("run", 98),
      });
    }, "protected publication replay resolver is unavailable");
    const runId = insertRun(database, occurrenceId, plan.runPlanId);
    insertReservation(database, runId);
    expect(
      database
        .prepare(
          "SELECT budget_month, monthly_used_snapshot_microusd, monthly_reserved_snapshot_microusd, reserved_cost_microusd FROM publication_run_budget_reservation",
        )
        .get(),
    ).toEqual({
      budget_month: "2026-08",
      monthly_used_snapshot_microusd: 0,
      monthly_reserved_snapshot_microusd: 0,
      reserved_cost_microusd: 1_000_000,
    });

    const staleDatabase = initializedDatabase();
    const stalePlan = seedApprovedPlan(staleDatabase);
    const staleOccurrenceId = insertOccurrence(
      staleDatabase,
      stalePlan.runPlanId,
    );
    staleDatabase.exec(
      `INSERT INTO publication_budget_breaker_event(
        environment, budget_month, generation, tripped, observed_at_ms
      ) VALUES ('preview', '2026-08', 1, 0, ${String(OBSERVED_AT)})`,
    );
    const staleRunId = insertRun(
      staleDatabase,
      staleOccurrenceId,
      stalePlan.runPlanId,
      { alertPercent: 50 },
    );
    expectConstraint(() => {
      staleDatabase
        .prepare(
          `INSERT INTO publication_run_budget_reservation(
            run_id, environment, budget_month, breaker_generation,
            monthly_used_snapshot_microusd, monthly_reserved_snapshot_microusd,
            reserved_cost_microusd, reserved_at_ms
          ) VALUES (?, 'preview', '2026-08', 1, 0, 0, 1000000, ?)`,
        )
        .run(staleRunId, STARTED_AT);
    }, "publication budget reservation does not match run authority");
  });

  it("requires exact plan Provider rows and reconciled fenced takeover", () => {
    const database = initializedDatabase();
    const plan = seedApprovedPlan(database);
    const occurrenceId = insertOccurrence(database, plan.runPlanId);
    database.exec(
      `INSERT INTO publication_budget_breaker_event(
        environment, budget_month, generation, tripped, observed_at_ms
      ) VALUES ('preview', '2026-08', 1, 0, ${String(OBSERVED_AT)})`,
    );
    const runId = insertRun(database, occurrenceId, plan.runPlanId);
    insertReservation(database, runId);
    const providerRunId = insertProviderRun(database, runId, plan);
    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO publication_provider_fence_claim(
            environment, provider_id, generation, provider_run_id, run_id,
            occurrence_id, deadline_at_ms, claimed_at_ms
          ) VALUES ('preview', ?, 1, ?, ?, ?, ?, ?)`,
        )
        .run(
          plan.providerId,
          providerRunId,
          runId,
          occurrenceId,
          DEADLINE_AT,
          STARTED_AT - 1,
        );
    }, "Provider fence claim does not match admitted Provider authority");
    database
      .prepare(
        `INSERT INTO publication_provider_fence_claim(
          environment, provider_id, generation, provider_run_id, run_id,
          occurrence_id, deadline_at_ms, claimed_at_ms
        ) VALUES ('preview', ?, 1, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.providerId,
        providerRunId,
        runId,
        occurrenceId,
        DEADLINE_AT,
        STARTED_AT + 1,
      );
    database
      .prepare(
        "INSERT INTO publication_provider_fence_head(environment, provider_id, generation, provider_run_id) VALUES ('preview', ?, 1, ?)",
      )
      .run(plan.providerId, providerRunId);
    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO publication_roster_operational_outcome(
            provider_run_id, roster_item_id, status, evidence_id, offering_id,
            error_code, attempt_count, created_at_ms
          ) VALUES (?, 'item-1', 'published_candidate', ?, ?, NULL, 1, ?)`,
        )
        .run(providerRunId, id("evd", 90), id("off", 90), STARTED_AT + 2);
    }, "source-backed outcomes require provenance-v2 authority");
    database
      .prepare(
        `INSERT INTO publication_roster_operational_outcome(
          provider_run_id, roster_item_id, status, error_code, attempt_count,
          created_at_ms
        ) VALUES (?, 'item-1', 'failed', 'provider_failed', 0, ?)`,
      )
      .run(providerRunId, STARTED_AT + 3);
    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO publication_provider_terminal(
            provider_run_id, fence_generation, state, roster_complete,
            publication_disposition, slice_id, requests, bytes, ai_tokens,
            browser_milliseconds, elapsed_milliseconds, cost_microusd,
            error_codes_json, ended_at_ms
          ) VALUES (?, 1, 'failed', 1, 'unavailable', NULL, 1, 2, 0, 0, 3,
            100, '["provider_failed","provider_quarantined","provider_unavailable"]', ?)`,
        )
        .run(providerRunId, STARTED_AT + 4);
    }, "Provider terminal error codes lack exact roster and terminal justification");
    const runDerivedProviderCodes = [
      [
        "partial_provider_refresh",
        ["partial_provider_refresh", "provider_failed", "provider_unavailable"],
      ],
      [
        "last_known_good_only",
        ["last_known_good_only", "provider_failed", "provider_unavailable"],
      ],
      [
        "zero_usable_providers",
        ["provider_failed", "provider_unavailable", "zero_usable_providers"],
      ],
      [
        "run_wide_quarantine",
        ["provider_failed", "provider_unavailable", "run_wide_quarantine"],
      ],
    ] as const;
    for (const [, errorCodes] of runDerivedProviderCodes) {
      expectConstraint(() => {
        database
          .prepare(
            `INSERT INTO publication_provider_terminal(
              provider_run_id, fence_generation, state, roster_complete,
              publication_disposition, slice_id, requests, bytes, ai_tokens,
              browser_milliseconds, elapsed_milliseconds, cost_microusd,
              error_codes_json, ended_at_ms
            ) VALUES (?, 1, 'failed', 1, 'unavailable', NULL, 1, 2, 0, 0, 3,
              100, ?, ?)`,
          )
          .run(providerRunId, JSON.stringify(errorCodes), STARTED_AT + 4);
      }, "Provider terminal error codes are not closed, unique, and sorted");
    }
    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO publication_provider_terminal(
            provider_run_id, fence_generation, state, roster_complete,
            publication_disposition, slice_id, requests, bytes, ai_tokens,
            browser_milliseconds, elapsed_milliseconds, cost_microusd,
            error_codes_json, ended_at_ms
          ) VALUES (?, 1, 'failed', 1, 'unavailable', NULL, 1, 2, 0, 0, 3,
            100, '["provider_failed","provider_unavailable"]', ?)`,
        )
        .run(providerRunId, STARTED_AT + 2);
    }, "Provider terminal lacks exact roster, fence, or cost closure");
    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO publication_retained_publication_authority(
            run_id, authority_schema, environment, publication_id, closure_hash,
            observed_at_ms
          ) VALUES (?, 'retained-publication-head@1', 'preview', ?, ?, ?)`,
        )
        .run(runId, id("pub", 1), HASH_A, STARTED_AT + 3);
    }, "retained publication authority requires the serving-head resolver");
    database
      .prepare(
        `INSERT INTO publication_provider_terminal(
          provider_run_id, fence_generation, state, roster_complete,
          publication_disposition, slice_id, requests, bytes, ai_tokens,
          browser_milliseconds, elapsed_milliseconds, cost_microusd,
          error_codes_json, ended_at_ms
        ) VALUES (?, 1, 'failed', 1, 'unavailable', NULL, 1, 2, 0, 0, 3,
          100, '["provider_failed","provider_unavailable"]', ?)`,
      )
      .run(providerRunId, STARTED_AT + 4);

    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO publication_provider_fence_claim(
            environment, provider_id, generation, provider_run_id, run_id,
            occurrence_id, deadline_at_ms, claimed_at_ms
          ) VALUES ('preview', ?, 2, ?, ?, ?, ?, ?)`,
        )
        .run(
          plan.providerId,
          id("pvr", 2),
          id("run", 2),
          occurrenceId,
          DEADLINE_AT,
          STARTED_AT + 5,
        );
    }, "Provider fence claim does not match admitted Provider authority");

    database
      .prepare(
        `INSERT INTO publication_provider_fence_reconciliation(
          environment, provider_id, generation, provider_run_id, result,
          reconciled_at_ms
        ) VALUES ('preview', ?, 1, ?, 'terminal_confirmed', ?)`,
      )
      .run(plan.providerId, providerRunId, STARTED_AT + 5);
    database
      .prepare(
        `INSERT INTO publication_provider_fence_release(
          environment, provider_id, generation, provider_run_id, released_at_ms
        ) VALUES ('preview', ?, 1, ?, ?)`,
      )
      .run(plan.providerId, providerRunId, STARTED_AT + 6);

    expectConstraint(() => {
      database.exec(
        "UPDATE publication_provider_fence_head SET generation = 2",
      );
    }, "Provider fence head advance lacks closed history");
    expect(
      database.prepare("SELECT count(*) AS count FROM provider_run").get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT count(*) AS count FROM roster_outcome").get(),
    ).toEqual({ count: 0 });
  });

  it("derives mixed Provider state and complete errors from exact roster outcomes", () => {
    const database = initializedDatabase();
    const plan = seedApprovedPlan(database, { rosterItemCount: 2 });
    const occurrenceId = insertOccurrence(database, plan.runPlanId);
    database.exec(
      `INSERT INTO publication_budget_breaker_event(
        environment, budget_month, generation, tripped, observed_at_ms
      ) VALUES ('preview', '2026-08', 1, 0, ${String(OBSERVED_AT)})`,
    );
    const runId = insertRun(database, occurrenceId, plan.runPlanId);
    insertReservation(database, runId);
    const providerRunId = insertProviderRun(database, runId, plan);
    database
      .prepare(
        `INSERT INTO publication_provider_fence_claim(
          environment, provider_id, generation, provider_run_id, run_id,
          occurrence_id, deadline_at_ms, claimed_at_ms
        ) VALUES ('preview', ?, 1, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.providerId,
        providerRunId,
        runId,
        occurrenceId,
        DEADLINE_AT,
        STARTED_AT + 1,
      );
    database
      .prepare(
        "INSERT INTO publication_provider_fence_head VALUES ('preview', ?, 1, ?)",
      )
      .run(plan.providerId, providerRunId);
    const outcome = database.prepare(
      `INSERT INTO publication_roster_operational_outcome(
        provider_run_id, roster_item_id, status, error_code, attempt_count,
        created_at_ms
      ) VALUES (?, ?, ?, ?, 0, ?)`,
    );
    outcome.run(
      providerRunId,
      "item-1",
      "failed",
      "provider_failed",
      STARTED_AT + 2,
    );
    outcome.run(
      providerRunId,
      "item-2",
      "quarantined",
      "provider_quarantined",
      STARTED_AT + 3,
    );
    const terminal = database.prepare(
      `INSERT INTO publication_provider_terminal(
        provider_run_id, fence_generation, state, roster_complete,
        publication_disposition, slice_id, requests, bytes, ai_tokens,
        browser_milliseconds, elapsed_milliseconds, cost_microusd,
        error_codes_json, ended_at_ms
      ) VALUES (?, 1, ?, 1, 'unavailable', NULL, 1, 2, 0, 0, 3, 100, ?, ?)`,
    );
    expectConstraint(() => {
      terminal.run(
        providerRunId,
        "failed",
        '["provider_failed","provider_quarantined","provider_unavailable"]',
        STARTED_AT + 4,
      );
    }, "quarantined roster outcome requires quarantined Provider state");
    expectConstraint(() => {
      terminal.run(
        providerRunId,
        "quarantined",
        '["provider_quarantined","provider_unavailable"]',
        STARTED_AT + 4,
      );
    }, "Provider terminal error codes lack exact roster and terminal justification");
    terminal.run(
      providerRunId,
      "quarantined",
      '["provider_failed","provider_quarantined","provider_unavailable"]',
      STARTED_AT + 4,
    );
  });

  it("closes a blocked terminal report, settles actual cost, and denies caller-supplied replay", () => {
    const database = initializedDatabase();
    const plan = seedApprovedPlan(database);
    const occurrenceId = insertOccurrence(database, plan.runPlanId);
    database.exec(
      `INSERT INTO publication_budget_breaker_event(
        environment, budget_month, generation, tripped, observed_at_ms
      ) VALUES ('preview', '2026-08', 1, 0, ${String(OBSERVED_AT)})`,
    );
    const runId = insertRun(database, occurrenceId, plan.runPlanId);
    insertReservation(database, runId);
    const providerRunId = insertProviderRun(database, runId, plan);
    database
      .prepare(
        `INSERT INTO publication_provider_fence_claim(
          environment, provider_id, generation, provider_run_id, run_id,
          occurrence_id, deadline_at_ms, claimed_at_ms
        ) VALUES ('preview', ?, 1, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.providerId,
        providerRunId,
        runId,
        occurrenceId,
        DEADLINE_AT,
        STARTED_AT + 1,
      );
    database
      .prepare(
        "INSERT INTO publication_provider_fence_head VALUES ('preview', ?, 1, ?)",
      )
      .run(plan.providerId, providerRunId);
    database
      .prepare(
        `INSERT INTO publication_roster_operational_outcome(
          provider_run_id, roster_item_id, status, error_code, attempt_count,
          created_at_ms
        ) VALUES (?, 'item-1', 'failed', 'provider_failed', 0, ?)`,
      )
      .run(providerRunId, STARTED_AT + 3);
    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO publication_retained_publication_authority VALUES (
            ?, 'retained-publication-head@1', 'preview', ?, ?, ?
          )`,
        )
        .run(runId, id("pub", 1), HASH_A, STARTED_AT + 3);
    }, "retained publication authority requires the serving-head resolver");
    const providerEndedAt = STARTED_AT + 4;
    database
      .prepare(
        `INSERT INTO publication_provider_terminal VALUES (
          ?, 1, 'failed', 1, 'unavailable', NULL, 1, 2, 0, 0, 3, 100,
          '["provider_failed","provider_unavailable"]', ?
        )`,
      )
      .run(providerRunId, providerEndedAt);
    database
      .prepare(
        `INSERT INTO publication_provider_fence_reconciliation VALUES (
          'preview', ?, 1, ?, 'terminal_confirmed', ?
        )`,
      )
      .run(plan.providerId, providerRunId, providerEndedAt + 1);
    database
      .prepare(
        `INSERT INTO publication_provider_fence_release VALUES (
          'preview', ?, 1, ?, ?
        )`,
      )
      .run(plan.providerId, providerRunId, providerEndedAt + 2);
    const endedAt = providerEndedAt + 3;
    const reportHash = HASH_D;
    const errorCodes = [
      "provider_failed",
      "provider_unavailable",
      "zero_usable_providers",
    ];
    const report = JSON.stringify({
      reportSchemaVersion: "publication-run-report@2",
      kind: "terminal_run",
      scheduleName: "provider-refresh-v1",
      scheduleExpression: "0 5 * * 1,4",
      environment: "preview",
      occurrenceId,
      runId,
      attemptNumber: 1,
      runPlanId: plan.runPlanId,
      runPlanHash: HASH_C,
      policySetHash: HASH_B,
      codeVersion: "git:abcdef",
      canonicalSchemaVersion: "1.0.0",
      pipelineContractVersion: "pipeline-contract@1",
      providerScope: [plan.providerId],
      scheduledAt: new Date(SCHEDULED_AT).toISOString(),
      startedAt: new Date(STARTED_AT).toISOString(),
      terminalDeadlineAt: new Date(DEADLINE_AT).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      runOutcome: "failed",
      publicationDisposition: "blocked",
      cost: {
        requests: 1,
        bytes: 2,
        aiTokens: 0,
        browserMilliseconds: 0,
        elapsedMilliseconds: 3,
        costMicrousd: 100,
      },
      errorCodes,
      providers: [
        {
          providerId: plan.providerId,
          adapterVersion: "adapter@1",
          rosterVersion: plan.rosterVersion,
          sourceRegisterVersion: plan.sourceRegisterVersion,
          state: "failed",
          rosterComplete: true,
          publicationDisposition: "unavailable",
          cost: {
            requests: 1,
            bytes: 2,
            aiTokens: 0,
            browserMilliseconds: 0,
            elapsedMilliseconds: 3,
            costMicrousd: 100,
          },
          errorCodes: ["provider_failed", "provider_unavailable"],
        },
      ],
      seal: { algorithm: "sha256", contentHash: reportHash },
    });
    const missingProviderCodeReport = JSON.stringify({
      ...JSON.parse(report),
      errorCodes: ["zero_usable_providers"],
      seal: { algorithm: "sha256", contentHash: HASH_A },
    });
    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO publication_run_terminal(
            run_id, run_outcome, publication_disposition, run_wide_quarantine,
            requests, bytes, ai_tokens, browser_milliseconds,
            elapsed_milliseconds, cost_microusd, error_codes_json, ended_at_ms,
            report_schema_version, report_text, report_hash
          ) VALUES (?, 'failed', 'blocked', 0, 1, 2, 0, 0, 3, 100,
            ?, ?, 'publication-run-report@2', ?, ?)`,
        )
        .run(
          runId,
          JSON.stringify(errorCodes),
          endedAt,
          ` ${report}`,
          reportHash,
        );
    });
    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO publication_run_terminal(
            run_id, run_outcome, publication_disposition, run_wide_quarantine,
            requests, bytes, ai_tokens, browser_milliseconds,
            elapsed_milliseconds, cost_microusd, error_codes_json, ended_at_ms,
            report_schema_version, report_text, report_hash
          ) VALUES (?, 'failed', 'blocked', 0, 1, 2, 0, 0, 3, 100,
            '["zero_usable_providers"]', ?, 'publication-run-report@2', ?, ?)`,
        )
        .run(runId, endedAt, missingProviderCodeReport, HASH_A);
    }, "run terminal error codes do not equal Provider union plus decision reason");
    database
      .prepare(
        `INSERT INTO publication_run_terminal(
          run_id, run_outcome, publication_disposition, run_wide_quarantine,
          requests, bytes, ai_tokens, browser_milliseconds,
          elapsed_milliseconds, cost_microusd, error_codes_json, ended_at_ms,
          report_schema_version, report_text, report_hash
        ) VALUES (?, 'failed', 'blocked', 0,
          1, 2, 0, 0, 3, 100, ?, ?, 'publication-run-report@2', ?, ?)`,
      )
      .run(runId, JSON.stringify(errorCodes), endedAt, report, reportHash);
    expect(
      database
        .prepare(
          "SELECT run_outcome, publication_disposition, cost_microusd FROM publication_run_terminal",
        )
        .get(),
    ).toEqual({
      run_outcome: "failed",
      publication_disposition: "blocked",
      cost_microusd: 100,
    });
    expectConstraint(() => {
      database.exec("UPDATE publication_run_terminal SET cost_microusd = 101");
    }, "publication run terminal is immutable");
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    expectConstraint(() => {
      insertRun(database, occurrenceId, plan.runPlanId, {
        sequence: 2,
        attempt: 2,
        replayOf: runId,
        projected: 1_000_100,
        startedAt: endedAt + 1,
      });
    }, "protected publication replay resolver is unavailable");
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_coordination_run WHERE occurrence_id = ?",
        )
        .get(occurrenceId),
    ).toEqual({ count: 1 });
  });
});

describe("admitted publication plan-revocation history hardening (PIPE-001–PIPE-004, BE-003–BE-006, QA-006)", () => {
  it("installs only over the exact orchestration predecessor and rejects object collisions", () => {
    const database = initializedDatabase();
    applyAtomic(database, sql(HARDENING_MIGRATION));
    expect(
      database
        .prepare(
          `SELECT type FROM sqlite_schema
           WHERE name = 'publication_run_plan_revocation_admitted_history_guard'`,
        )
        .get(),
    ).toEqual({ type: "trigger" });

    const missingPredecessor = initializedDatabase();
    missingPredecessor.exec(
      "DROP TRIGGER publication_admission_rejection_activation_blocked",
    );
    expectConstraint(() => {
      applyAtomic(missingPredecessor, sql(HARDENING_MIGRATION));
    });

    const missingImmutability = initializedDatabase();
    missingImmutability.exec(
      "DROP TRIGGER publication_coordination_run_immutable_delete",
    );
    expectConstraint(() => {
      applyAtomic(missingImmutability, sql(HARDENING_MIGRATION));
    });
    expect(
      missingImmutability
        .prepare(
          `SELECT count(*) AS count FROM sqlite_schema
           WHERE name = 'publication_run_plan_revocation_admitted_history_guard'`,
        )
        .get(),
    ).toEqual({ count: 0 });

    const missingAuthorityTable = initializedDatabase();
    missingAuthorityTable.exec("DROP TABLE publication_run_plan_approval");
    expectConstraint(() => {
      applyAtomic(missingAuthorityTable, sql(HARDENING_MIGRATION));
    });

    const collision = initializedDatabase();
    collision.exec(
      "CREATE VIEW publication_run_plan_revocation_admitted_history_guard AS SELECT 1 AS value",
    );
    expectConstraint(() => {
      applyAtomic(collision, sql(HARDENING_MIGRATION));
    });
    expect(
      collision
        .prepare(
          `SELECT type FROM sqlite_schema
           WHERE name = 'publication_run_plan_revocation_admitted_history_guard'`,
        )
        .get(),
    ).toEqual({ type: "view" });
  });

  it("rolls back a late migration failure and remains retryable", () => {
    const database = initializedDatabase();
    expectConstraint(() => {
      applyAtomic(
        database,
        `${sql(HARDENING_MIGRATION)}\nSELECT * FROM __injected_late_failure__;`,
      );
    });
    expect(
      database
        .prepare(
          `SELECT count(*) AS count FROM sqlite_schema
           WHERE name = 'publication_run_plan_revocation_admitted_history_guard'`,
        )
        .get(),
    ).toEqual({ count: 0 });
    applyAtomic(database, sql(HARDENING_MIGRATION));
  });

  it("refuses to bless pre-existing revocation history that contradicts an admitted firing", () => {
    const database = initializedDatabase();
    const plan = seedApprovedPlan(database);
    const occurrenceId = insertOccurrence(database, plan.runPlanId);
    insertRun(database, occurrenceId, plan.runPlanId);
    database
      .prepare(
        `INSERT INTO publication_run_plan_revocation(
          run_plan_id, reason_code, effective_at_ms
        ) VALUES (?, 'integrity_failure', ?)`,
      )
      .run(plan.runPlanId, SCHEDULED_AT);

    expectConstraint(() => {
      applyAtomic(database, sql(HARDENING_MIGRATION));
    });
    expect(
      database
        .prepare(
          `SELECT count(*) AS count FROM sqlite_schema
           WHERE name = 'publication_run_plan_revocation_admitted_history_guard'`,
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("prevents a late revocation from rewriting an admitted scheduled instant", () => {
    const database = hardenedDatabase();
    const plan = seedApprovedPlan(database);
    const occurrenceId = insertOccurrence(database, plan.runPlanId);
    insertRun(database, occurrenceId, plan.runPlanId);

    for (const effectiveAt of [SCHEDULED_AT - 1, SCHEDULED_AT]) {
      expectConstraint(() => {
        database
          .prepare(
            `INSERT INTO publication_run_plan_revocation(
              run_plan_id, reason_code, effective_at_ms
            ) VALUES (?, 'integrity_failure', ?)`,
          )
          .run(plan.runPlanId, effectiveAt);
      }, "publication run-plan revocation cannot rewrite resolved scheduled history");
    }
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM publication_run_plan_revocation",
        )
        .get(),
    ).toEqual({ count: 0 });

    database
      .prepare(
        `INSERT INTO publication_run_plan_revocation(
          run_plan_id, reason_code, effective_at_ms
        ) VALUES (?, 'integrity_failure', ?)`,
      )
      .run(plan.runPlanId, SCHEDULED_AT + 1);
    expect(
      database
        .prepare("SELECT effective_at_ms FROM publication_run_plan_revocation")
        .get(),
    ).toEqual({ effective_at_ms: SCHEDULED_AT + 1 });
  });

  it("protects the dormant rejection branch from a later backdated revocation", () => {
    const database = hardenedDatabase();
    const plan = seedApprovedPlan(database);
    const occurrenceId = insertOccurrence(database, plan.runPlanId);
    database.exec(
      "DROP TRIGGER publication_admission_rejection_activation_blocked",
    );
    insertSyntheticRejection(database, occurrenceId, plan.runPlanId);

    expectConstraint(() => {
      database
        .prepare(
          `INSERT INTO publication_run_plan_revocation(
            run_plan_id, reason_code, effective_at_ms
          ) VALUES (?, 'integrity_failure', ?)`,
        )
        .run(plan.runPlanId, SCHEDULED_AT);
    }, "publication run-plan revocation cannot rewrite resolved scheduled history");
    expect(
      database
        .prepare(
          `SELECT
            (SELECT count(*) FROM publication_admission_rejection) AS rejections,
            (SELECT count(*) FROM publication_coordination_run) AS runs,
            (SELECT count(*) FROM publication_run_plan_revocation) AS revocations`,
        )
        .get(),
    ).toEqual({ rejections: 1, runs: 0, revocations: 0 });
  });
});
