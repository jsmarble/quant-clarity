import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

const MIGRATION = "0009_dormant_provenance_v2_registration.sql";

function migrationSql(filename = MIGRATION): string {
  return readFileSync(resolve("migrations", "canonical", filename), "utf8");
}

function applyAtomic(database: DatabaseSync, sql: string): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(sql);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function predecessor(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const filename of readdirSync(
    resolve("migrations", "canonical"),
  ).sort()) {
    if (filename >= MIGRATION) continue;
    applyAtomic(database, migrationSql(filename));
  }
  return database;
}

interface ForeignKeyTuple {
  table: string;
  from: string[];
  to: string[];
}

function foreignKeyTuples(
  database: DatabaseSync,
  tableName: string,
): ForeignKeyTuple[] {
  if (!/^[a-z][a-z0-9_]*$/u.test(tableName)) {
    throw new Error("invalid table name");
  }
  const rows = database
    .prepare(`PRAGMA foreign_key_list(${tableName})`)
    .all()
    .map((value) => {
      const row = value as Record<string, unknown>;
      if (
        typeof row.id !== "number" ||
        typeof row.seq !== "number" ||
        typeof row.table !== "string" ||
        typeof row.from !== "string" ||
        typeof row.to !== "string"
      ) {
        throw new Error("invalid foreign-key row");
      }
      return {
        id: row.id,
        seq: row.seq,
        table: row.table,
        from: row.from,
        to: row.to,
      };
    });
  const groups = new Map<number, typeof rows>();
  for (const row of rows) {
    const group = groups.get(row.id) ?? [];
    group.push(row);
    groups.set(row.id, group);
  }
  return [...groups.values()].map((group) => {
    group.sort((left, right) => left.seq - right.seq);
    if (group.some((row) => row.table !== group[0]?.table)) {
      throw new Error("foreign-key table changed within tuple");
    }
    return {
      table: group[0]?.table ?? "",
      from: group.map((row) => row.from),
      to: group.map((row) => row.to),
    };
  });
}

const NEW_DATA_TABLES = [
  "provenance_v2_source_owner_receipt",
  "provenance_v2_source_register_receipt",
  "provenance_v2_source_register_member",
  "provenance_v2_adapter_manifest_receipt",
  "provenance_v2_adapter_manifest_environment",
  "provenance_v2_adapter_manifest_credential",
  "provenance_v2_adapter_manifest_source",
  "provenance_v2_source_endpoint_registration",
  "provenance_v2_source_endpoint_request",
  "provenance_v2_source_endpoint_parameter",
  "provenance_v2_source_endpoint_parameter_enum",
  "provenance_v2_source_endpoint_allowed_header",
  "provenance_v2_source_endpoint_redirect_host",
  "provenance_v2_source_endpoint_content_type",
  "provenance_v2_source_endpoint_expected_field",
  "provenance_v2_source_endpoint_approval",
  "provenance_v2_source_endpoint_revocation",
  "provenance_v2_field_path_vocabulary",
  "provenance_v2_field_policy",
  "provenance_v2_field_policy_precedence_class",
  "provenance_v2_field_policy_precedence_edge",
  "provenance_v2_field_policy_endpoint_admission",
  "provenance_v2_verifier_implementation",
  "provenance_v2_verifier_policy",
  "provenance_v2_verifier_policy_member",
  "provenance_v2_authority_plan_registration_close",
  "provenance_v2_authority_plan_oracle_receipt",
  "provenance_v2_authority_plan_approval_intent",
  "provenance_v2_authority_plan_revocation",
] as const;

const V2_BLOCKERS = [
  "provenance_v2_installation_identity_activation_blocked",
  "provenance_v2_authority_plan_activation_blocked",
  "provenance_v2_authority_plan_seal_activation_blocked",
  "provenance_v2_authority_plan_approval_activation_blocked",
  "provenance_v2_source_endpoint_activation_blocked",
  "provenance_v2_provider_bundle_activation_blocked",
  "provenance_v2_acquisition_permit_activation_blocked",
  "provenance_v2_admitted_response_activation_blocked",
] as const;

function expectPredecessorRejected(database: DatabaseSync): void {
  expect(() => {
    applyAtomic(database, migrationSql());
  }).toThrow();
  expect(
    database
      .prepare(
        "SELECT count(*) AS count FROM sqlite_schema WHERE name = 'provenance_v2_registration_integrity_metadata'",
      )
      .get(),
  ).toEqual({ count: 0 });
}

describe(
  "dormant provenance-v2 registration migration",
  // The tamper cases intentionally replay the entire migration chain several
  // times. Shared CI runners can take substantially longer than local runs,
  // so this is a test-harness budget rather than a weaker integrity check.
  { timeout: 60_000 },
  () => {
    it("installs one immutable capability and empty normalized tables", () => {
      const database = predecessor();
      applyAtomic(database, migrationSql());

      expect(
        database
          .prepare(
            "SELECT * FROM provenance_v2_registration_integrity_metadata",
          )
          .all(),
      ).toEqual([
        {
          singleton: 1,
          capability: "fenced-provenance-v2-registration@1",
          predecessor_capability: "fenced-provenance-v2@1",
          adapter_receipt_contract: "provenance-v2-adapter-receipt@1",
          endpoint_contract: "provenance-v2-endpoint@1",
          field_policy_contract: "provenance-v2-field-policy@1",
          verifier_policy_contract: "provenance-v2-verifier-policy@1",
          root_contract: "provenance-v2-authority-root@1",
        },
      ]);
      for (const table of NEW_DATA_TABLES) {
        expect(
          database.prepare(`SELECT count(*) AS count FROM ${table}`).get(),
        ).toEqual({ count: 0 });
      }
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    }, 20_000);

    it("keeps every new registration and lifecycle insert dormant", () => {
      const database = predecessor();
      applyAtomic(database, migrationSql());

      for (const table of NEW_DATA_TABLES) {
        expect(() => {
          database.exec(`INSERT INTO ${table} DEFAULT VALUES`);
        }).toThrow(/not activated/u);
      }
    });

    it("keeps the capability immutable and non-replaceable", () => {
      const database = predecessor();
      applyAtomic(database, migrationSql());

      expect(() => {
        database.exec(
          "UPDATE provenance_v2_registration_integrity_metadata SET capability = capability",
        );
      }).toThrow(/immutable/u);
      expect(() => {
        database.exec(
          "DELETE FROM provenance_v2_registration_integrity_metadata",
        );
      }).toThrow(/cannot be deleted/u);
      expect(() => {
        database.exec(
          "INSERT OR REPLACE INTO provenance_v2_registration_integrity_metadata SELECT * FROM provenance_v2_registration_integrity_metadata",
        );
      }).toThrow(/cannot be replaced/u);
    });

    it("preserves every migration-0008 activation blocker byte-for-byte", () => {
      const database = predecessor();
      const before = database
        .prepare(
          `SELECT name, tbl_name, sql FROM sqlite_schema
         WHERE type = 'trigger' AND name IN (${V2_BLOCKERS.map(() => "?").join(",")})
         ORDER BY name`,
        )
        .all(...V2_BLOCKERS);

      applyAtomic(database, migrationSql());

      const after = database
        .prepare(
          `SELECT name, tbl_name, sql FROM sqlite_schema
         WHERE type = 'trigger' AND name IN (${V2_BLOCKERS.map(() => "?").join(",")})
         ORDER BY name`,
        )
        .all(...V2_BLOCKERS);
      expect(after).toEqual(before);
      expect(after).toHaveLength(8);
    });

    it("rejects a missing or logically disabled migration-0008 blocker atomically", () => {
      const missing = predecessor();
      missing.exec(
        "DROP TRIGGER provenance_v2_provider_bundle_activation_blocked",
      );
      expect(() => {
        applyAtomic(missing, migrationSql());
      }).toThrow();
      expect(
        missing
          .prepare(
            "SELECT count(*) AS count FROM sqlite_schema WHERE name = 'provenance_v2_registration_integrity_metadata'",
          )
          .get(),
      ).toEqual({ count: 0 });

      const disabled = predecessor();
      disabled.exec(
        "DROP TRIGGER provenance_v2_provider_bundle_activation_blocked",
      );
      disabled.exec(`CREATE TRIGGER provenance_v2_provider_bundle_activation_blocked
      BEFORE INSERT ON provenance_v2_provider_bundle WHEN 0
      BEGIN SELECT RAISE(ABORT, 'provenance-v2 bundle opening is not activated'); END`);
      expect(() => {
        applyAtomic(disabled, migrationSql());
      }).toThrow();
      expect(
        disabled
          .prepare(
            "SELECT count(*) AS count FROM sqlite_schema WHERE name = 'provenance_v2_registration_integrity_metadata'",
          )
          .get(),
      ).toEqual({ count: 0 });
    });

    it("rejects tampered migration-0008 table, index, and non-blocker trigger SQL", () => {
      const table = predecessor();
      const tableSql = table
        .prepare(
          `SELECT sql FROM sqlite_schema
           WHERE type = 'table' AND name = 'provenance_v2_integrity_metadata'`,
        )
        .get() as { sql: string };
      const triggerSql = table
        .prepare(
          `SELECT sql FROM sqlite_schema
           WHERE type = 'trigger' AND tbl_name = 'provenance_v2_integrity_metadata'
           ORDER BY name`,
        )
        .all() as unknown as { sql: string }[];
      table.exec("DROP TABLE provenance_v2_integrity_metadata");
      table.exec(
        tableSql.sql.replace("capability = 'fenced-provenance-v2@1'", "1"),
      );
      table.exec(`INSERT INTO provenance_v2_integrity_metadata VALUES (
        1, 'fenced-provenance-v2@1', 'publication-orchestration-ledger@1',
        'quantclarity:provenance-v2:v1', 'provenance-v2-vocabulary@1',
        'provenance-v2-writer@1'
      )`);
      for (const row of triggerSql) table.exec(row.sql);
      expectPredecessorRejected(table);

      const index = predecessor();
      index.exec("DROP INDEX provenance_v2_source_register_exact_uq");
      index.exec(`CREATE UNIQUE INDEX provenance_v2_source_register_exact_uq
        ON source_compliance_record(provider_id, register_version)`);
      expectPredecessorRejected(index);

      const trigger = predecessor();
      trigger.exec(
        "DROP TRIGGER provenance_v2_source_endpoint_immutable_update",
      );
      trigger.exec(`CREATE TRIGGER provenance_v2_source_endpoint_immutable_update
        BEFORE UPDATE ON provenance_v2_source_endpoint WHEN 0
        BEGIN SELECT RAISE(ABORT, 'provenance-v2 source endpoint is immutable'); END`);
      expectPredecessorRejected(trigger);
    }, 15_000);

    it("rejects a tampered migration-0008 predecessor trigger atomically", () => {
      const database = predecessor();
      database.exec("DROP TRIGGER source_compliance_run_plan_frozen_update");

      expectPredecessorRejected(database);
    });

    it("rejects a preseeded migration-0008 runtime row atomically", () => {
      const database = predecessor();
      database.exec(`INSERT INTO publication_orchestration_environment(
      singleton, environment, monthly_allocation_microusd, initialized_at_ms
    ) VALUES (1, 'preview', 25000000, 1)`);
      const blocker = database
        .prepare(
          `SELECT sql FROM sqlite_schema
         WHERE type = 'trigger'
           AND name = 'provenance_v2_installation_identity_activation_blocked'`,
        )
        .get() as { sql: string };
      database.exec(
        "DROP TRIGGER provenance_v2_installation_identity_activation_blocked",
      );
      database.exec(`INSERT INTO provenance_v2_installation_identity(
      singleton, installation_id, environment, initialized_at_ms
    ) VALUES (1, 'pvi_00000000-0000-4000-8000-000000000001', 'preview', 1)`);
      database.exec(blocker.sql);

      expectPredecessorRejected(database);
    });

    it("rejects same-name collisions before creating any registration object", () => {
      const database = predecessor();
      database.exec(
        "CREATE VIEW provenance_v2_verifier_policy AS SELECT 1 AS collision",
      );

      expect(() => {
        applyAtomic(database, migrationSql());
      }).toThrow();
      expect(
        database
          .prepare(
            "SELECT type FROM sqlite_schema WHERE name = 'provenance_v2_verifier_policy'",
          )
          .get(),
      ).toEqual({ type: "view" });
      expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_schema WHERE name = 'provenance_v2_registration_integrity_metadata'",
          )
          .get(),
      ).toEqual({ count: 0 });
    });

    it("installs grouped exact authority dependencies", () => {
      const database = predecessor();
      applyAtomic(database, migrationSql());

      expect(
        foreignKeyTuples(database, "provenance_v2_adapter_manifest_receipt"),
      ).toEqual(
        expect.arrayContaining([
          {
            table: "provenance_v2_authority_plan",
            from: ["authority_plan_id", "run_plan_id", "installation_id"],
            to: ["authority_plan_id", "run_plan_id", "installation_id"],
          },
          {
            table: "publication_run_plan_provider",
            from: [
              "run_plan_id",
              "provider_id",
              "adapter_version",
              "roster_version",
              "roster_content_hash",
              "source_register_version",
              "source_artifact_hash",
              "request_ceiling",
              "byte_ceiling",
              "ai_token_ceiling",
              "browser_millisecond_ceiling",
              "elapsed_millisecond_ceiling",
              "cost_microusd_ceiling",
            ],
            to: [
              "run_plan_id",
              "provider_id",
              "adapter_version",
              "roster_version",
              "roster_content_hash",
              "source_register_version",
              "source_artifact_hash",
              "request_ceiling",
              "byte_ceiling",
              "ai_token_ceiling",
              "browser_millisecond_ceiling",
              "elapsed_millisecond_ceiling",
              "cost_microusd_ceiling",
            ],
          },
        ]),
      );
      expect(
        foreignKeyTuples(database, "provenance_v2_source_register_receipt"),
      ).toEqual(
        expect.arrayContaining([
          {
            table: "source_compliance_record",
            from: [
              "provider_id",
              "register_version",
              "artifact_hash",
              "approval_state",
              "reviewed_at_ms",
              "next_review_at_ms",
              "access_permitted",
              "retention_permitted",
              "excerpt_permitted",
              "publication_permitted",
            ],
            to: [
              "provider_id",
              "register_version",
              "artifact_hash",
              "approval_state",
              "reviewed_at_ms",
              "next_review_at_ms",
              "access_permitted",
              "retention_permitted",
              "excerpt_permitted",
              "publication_permitted",
            ],
          },
        ]),
      );
      expect(
        foreignKeyTuples(database, "provenance_v2_adapter_manifest_source"),
      ).toEqual(
        expect.arrayContaining([
          {
            table: "provenance_v2_source_owner_receipt",
            from: [
              "authority_plan_id",
              "provider_id",
              "provider_organization_id",
              "owner_organization_id",
              "provider_owner_relationship",
              "owner_kind",
            ],
            to: [
              "authority_plan_id",
              "provider_id",
              "provider_organization_id",
              "owner_organization_id",
              "provider_owner_relationship",
              "owner_kind",
            ],
          },
        ]),
      );
      expect(
        foreignKeyTuples(
          database,
          "provenance_v2_source_endpoint_registration",
        ),
      ).toEqual(
        expect.arrayContaining([
          {
            table: "provenance_v2_source_register_member",
            from: [
              "authority_plan_id",
              "provider_id",
              "source_register_version",
              "source_register_artifact_hash",
              "source_id",
            ],
            to: [
              "authority_plan_id",
              "provider_id",
              "register_version",
              "artifact_hash",
              "source_id",
            ],
          },
          {
            table: "provenance_v2_source_endpoint",
            from: [
              "authority_plan_id",
              "endpoint_id",
              "provider_id",
              "source_register_version",
              "source_register_artifact_hash",
              "source_id",
              "adapter_source_type",
              "source_owner_organization_id",
              "provider_owner_relationship",
              "host_ascii",
              "path_template_hash",
              "adapter_manifest_hash",
              "endpoint_content_hash",
            ],
            to: [
              "authority_plan_id",
              "endpoint_id",
              "provider_id",
              "source_register_version",
              "source_register_artifact_hash",
              "source_id",
              "adapter_source_type",
              "source_owner_organization_id",
              "provider_owner_relationship",
              "host_ascii",
              "path_template_hash",
              "adapter_manifest_hash",
              "endpoint_content_hash",
            ],
          },
          {
            table: "provenance_v2_adapter_manifest_source",
            from: [
              "authority_plan_id",
              "provider_id",
              "source_id",
              "adapter_source_type",
              "provider_organization_id",
              "source_owner_organization_id",
              "source_owner_kind",
              "provider_owner_relationship",
              "authority_source_class",
              "host_ascii",
              "path_template_hash",
              "manifest_source_hash",
            ],
            to: [
              "authority_plan_id",
              "provider_id",
              "source_id",
              "adapter_source_type",
              "provider_organization_id",
              "owner_organization_id",
              "owner_kind",
              "provider_owner_relationship",
              "authority_source_class",
              "host_ascii",
              "path_template_hash",
              "manifest_source_hash",
            ],
          },
          {
            table: "provenance_v2_source_owner_receipt",
            from: [
              "authority_plan_id",
              "provider_id",
              "provider_organization_id",
              "source_owner_organization_id",
              "provider_owner_relationship",
              "source_owner_kind",
            ],
            to: [
              "authority_plan_id",
              "provider_id",
              "provider_organization_id",
              "owner_organization_id",
              "provider_owner_relationship",
              "owner_kind",
            ],
          },
        ]),
      );
      expect(
        foreignKeyTuples(
          database,
          "provenance_v2_field_policy_endpoint_admission",
        ),
      ).toEqual(
        expect.arrayContaining([
          {
            table: "provenance_v2_field_policy_precedence_class",
            from: [
              "authority_plan_id",
              "field_path",
              "class_key",
              "authority_source_class",
            ],
            to: [
              "authority_plan_id",
              "field_path",
              "class_key",
              "authority_source_class",
            ],
          },
          {
            table: "provenance_v2_source_endpoint_registration",
            from: [
              "authority_plan_id",
              "endpoint_id",
              "authority_source_class",
            ],
            to: ["authority_plan_id", "endpoint_id", "authority_source_class"],
          },
        ]),
      );
      expect(
        foreignKeyTuples(
          database,
          "provenance_v2_authority_plan_oracle_receipt",
        ),
      ).toEqual(
        expect.arrayContaining([
          {
            table: "provenance_v2_authority_plan_registration_close",
            from: [
              "authority_plan_id",
              "endpoint_count",
              "field_policy_count",
              "verifier_policy_count",
              "adapter_manifest_count",
              "authority_root",
            ],
            to: [
              "authority_plan_id",
              "endpoint_count",
              "field_policy_count",
              "verifier_policy_count",
              "adapter_manifest_count",
              "claimed_authority_root",
            ],
          },
        ]),
      );
    });

    it("keeps all accepted physical ceilings explicit", () => {
      const sql = migrationSql();
      expect(sql).toContain("source_count BETWEEN 1 AND 32");
      expect(sql).toContain("endpoint_count BETWEEN 1 AND 512");
      expect(sql).toContain("adapter_manifest_count BETWEEN 1 AND 16");
      expect(sql).toContain("parameter_count BETWEEN 0 AND 64");
      expect(sql).toContain("enum_count BETWEEN 0 AND 128");
      expect(sql).toContain("precedence_edge_count BETWEEN 0 AND 4096");
      expect(sql).toContain("minimum_confidence_ppm BETWEEN 0 AND 1000000");
      expect(sql).toContain("ordinal BETWEEN 0 AND 511");
      expect(sql).toContain("exact_price_tuple");
      expect(sql).not.toContain("decimal_value_and_unit");
      expect(sql).toContain("authority_source_class = 'provider_exact_api'");
      expect(sql).toContain(
        "authority_source_class = 'provider_exact_authenticated_catalog'",
      );
      expect(sql).toContain(
        "authority_source_class = 'independent_structured_catalog'",
      );
    });
  },
);
