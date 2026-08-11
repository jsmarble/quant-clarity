import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

const MIGRATION = "0008_dormant_fenced_provenance_v2.sql";

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

function objectCount(database: DatabaseSync, prefix = "provenance_v2_") {
  return database
    .prepare(
      "SELECT count(*) AS count FROM sqlite_schema WHERE name GLOB ? || '*'",
    )
    .get(prefix) as { count: number };
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
  const rawRows = database
    .prepare(`PRAGMA foreign_key_list(${tableName})`)
    .all() as unknown[];
  const rows = rawRows.map((value) => {
    if (typeof value !== "object" || value === null) {
      throw new Error("invalid foreign-key row");
    }
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

function expectTamperedPredecessorRejected(
  tamper: (database: DatabaseSync) => void,
): void {
  const database = predecessor();
  tamper(database);
  expect(() => {
    applyAtomic(database, migrationSql());
  }).toThrow();
  expect(objectCount(database)).toEqual({ count: 0 });
}

describe("dormant fenced provenance-v2 foundation migration", () => {
  it("installs only one static capability over the exact pristine predecessor", () => {
    const database = predecessor();

    applyAtomic(database, migrationSql());

    expect(
      database.prepare("SELECT * FROM provenance_v2_integrity_metadata").all(),
    ).toEqual([
      {
        singleton: 1,
        capability: "fenced-provenance-v2@1",
        predecessor_capability: "publication-orchestration-ledger@1",
        hash_domain: "quantclarity:provenance-v2:v1",
        vocabulary_version: "provenance-v2-vocabulary@1",
        writer_contract_version: "provenance-v2-writer@1",
      },
    ]);
    expect(database.prepare("SELECT * FROM schema_metadata").get()).toEqual({
      singleton: 1,
      schema_version: "1.0.0",
      created_at_ms: 0,
    });
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM provenance_v2_installation_identity",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("also installs dormant after exact orchestration initialization", () => {
    const database = predecessor();
    database
      .prepare(
        `INSERT INTO publication_orchestration_environment(
          singleton, environment, monthly_allocation_microusd, initialized_at_ms
        ) VALUES (1, 'preview', 25000000, 1)`,
      )
      .run();

    applyAtomic(database, migrationSql());

    expect(
      database
        .prepare("SELECT capability FROM provenance_v2_integrity_metadata")
        .get(),
    ).toEqual({ capability: "fenced-provenance-v2@1" });
    expect(
      database
        .prepare("SELECT count(*) AS count FROM provenance_v2_provider_bundle")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("keeps every runtime insert path unconditionally blocked", () => {
    const database = predecessor();
    applyAtomic(database, migrationSql());
    const blockedTables = [
      "provenance_v2_installation_identity",
      "provenance_v2_authority_plan",
      "provenance_v2_authority_plan_seal",
      "provenance_v2_authority_plan_approval",
      "provenance_v2_source_endpoint",
      "provenance_v2_provider_bundle",
      "provenance_v2_acquisition_permit",
      "provenance_v2_admitted_response",
    ];

    for (const table of blockedTables) {
      expect(() => {
        database.exec(`INSERT INTO ${table} DEFAULT VALUES`);
      }).toThrow(/not activated/u);
      expect(
        database.prepare(`SELECT count(*) AS count FROM ${table}`).get(),
      ).toEqual({ count: 0 });
    }
  });

  it("keeps the static capability immutable and non-replaceable", () => {
    const database = predecessor();
    applyAtomic(database, migrationSql());

    expect(() => {
      database.exec(
        "UPDATE provenance_v2_integrity_metadata SET capability = capability",
      );
    }).toThrow(/immutable/u);
    expect(() => {
      database.exec("DELETE FROM provenance_v2_integrity_metadata");
    }).toThrow(/cannot be deleted/u);
    expect(() => {
      database.exec(
        `INSERT OR REPLACE INTO provenance_v2_integrity_metadata VALUES (
          1, 'fenced-provenance-v2@1', 'publication-orchestration-ledger@1',
          'quantclarity:provenance-v2:v1', 'provenance-v2-vocabulary@1',
          'provenance-v2-writer@1'
        )`,
      );
    }).toThrow(/cannot be replaced/u);
  });

  it("fails atomically when a required legacy freeze guard is missing", () => {
    const database = predecessor();
    database.exec("DROP TRIGGER legacy_observation_disabled");

    expect(() => {
      applyAtomic(database, migrationSql());
    }).toThrow();

    expect(objectCount(database)).toEqual({ count: 0 });
  });

  it("fails atomically when a legacy freeze guard definition is weakened", () => {
    const database = predecessor();
    database.exec("DROP TRIGGER legacy_evidence_disabled");
    database.exec(`CREATE TRIGGER legacy_evidence_disabled
      BEFORE INSERT ON evidence BEGIN SELECT RAISE(ABORT, 'disabled'); END`);

    expect(() => {
      applyAtomic(database, migrationSql());
    }).toThrow();

    expect(objectCount(database)).toEqual({ count: 0 });
  });

  it("rejects logically disabled and wrong-target legacy freeze guards", () => {
    expectTamperedPredecessorRejected((database) => {
      database.exec("DROP TRIGGER legacy_evidence_disabled");
      database.exec(`CREATE TRIGGER legacy_evidence_disabled
        BEFORE INSERT ON evidence
        WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment) AND 0
        BEGIN SELECT RAISE(ABORT, 'legacy evidence requires provenance-v2 authority'); END`);
    });
    expectTamperedPredecessorRejected((database) => {
      database.exec("DROP TRIGGER legacy_evidence_disabled");
      database.exec(`CREATE TRIGGER legacy_evidence_disabled
        BEFORE INSERT ON observation
        WHEN EXISTS (SELECT 1 FROM publication_orchestration_environment)
        BEGIN SELECT RAISE(ABORT, 'legacy evidence requires provenance-v2 authority'); END`);
    });
  });

  it("rejects disabled admitted-history and fence guards", () => {
    expectTamperedPredecessorRejected((database) => {
      database.exec(
        "DROP TRIGGER publication_run_plan_revocation_admitted_history_guard",
      );
      database.exec(`CREATE TRIGGER publication_run_plan_revocation_admitted_history_guard
        BEFORE INSERT ON publication_run_plan_revocation WHEN 0
        BEGIN SELECT CASE WHEN NEW.effective_at_ms <= (
          SELECT scheduled_at_ms FROM schedule_occurrence LIMIT 1
        ) THEN RAISE(ABORT, 'publication run-plan revocation cannot rewrite resolved scheduled history') END; END`);
    });
    expectTamperedPredecessorRejected((database) => {
      database.exec(
        "DROP TRIGGER publication_provider_fence_claim_insert_guard",
      );
      database.exec(`CREATE TRIGGER publication_provider_fence_claim_insert_guard
        BEFORE INSERT ON publication_provider_fence_claim
        BEGIN SELECT CASE WHEN 0 THEN RAISE(
          ABORT,
          'Provider fence claim does not match admitted Provider authority'
        ) END; END`);
    });
    expectTamperedPredecessorRejected((database) => {
      database.exec(
        "DROP TRIGGER publication_provider_fence_claim_immutable_update",
      );
    });
    expectTamperedPredecessorRejected((database) => {
      database.exec(
        "DROP TRIGGER publication_provider_fence_claim_insert_guard",
      );
      database.exec(`CREATE TRIGGER publication_provider_fence_claim_insert_guard
        BEFORE INSERT ON publication_provider_fence_claim WHEN 0
        BEGIN SELECT RAISE(ABORT, 'Provider fence claim does not match admitted Provider authority'); END`);
    });
  }, 20_000);

  it("rejects a disabled source-backed outcome blocker", () => {
    expectTamperedPredecessorRejected((database) => {
      database.exec(
        "DROP TRIGGER publication_roster_outcome_source_execution_blocked",
      );
      database.exec(`CREATE TRIGGER publication_roster_outcome_source_execution_blocked
        BEFORE INSERT ON publication_roster_operational_outcome WHEN 0
        BEGIN SELECT RAISE(ABORT, 'source-backed outcomes require provenance-v2 authority'); END`);
    });
  });

  it("rejects a missing source-compliance run-plan freeze guard", () => {
    expectTamperedPredecessorRejected((database) => {
      database.exec("DROP TRIGGER source_compliance_run_plan_frozen_update");
    });
  });

  it("rejects initialized state with a reintroduced active legacy owner", () => {
    const database = predecessor();
    database
      .prepare(
        `INSERT INTO publication_orchestration_environment(
          singleton, environment, monthly_allocation_microusd, initialized_at_ms
        ) VALUES (1, 'preview', 25000000, 1)`,
      )
      .run();
    const trigger = database
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE name = 'legacy_pipeline_run_disabled'",
      )
      .get() as { sql: string };
    database.exec("DROP TRIGGER legacy_pipeline_run_disabled");
    database.exec(`INSERT INTO schedule_occurrence VALUES (
      'occ_00000000-0000-4000-8000-000000000001', 2,
      '0 5 * * 1,4', 'legacy-fixture', 2
    )`);
    database.exec(`INSERT INTO pipeline_run VALUES (
      'run_00000000-0000-4000-8000-000000000001',
      'occ_00000000-0000-4000-8000-000000000001', 1,
      'git:test', '1.0.0', '[]', 'running', 2,
      NULL, NULL, NULL, NULL, 2
    )`);
    database.exec(trigger.sql);

    expect(() => {
      applyAtomic(database, migrationSql());
    }).toThrow();
    expect(objectCount(database)).toEqual({ count: 0 });
  });

  it("rejects same-name collisions of any SQLite object kind atomically", () => {
    const database = predecessor();
    database.exec(
      "CREATE VIEW provenance_v2_provider_bundle AS SELECT 1 AS collision",
    );

    expect(() => {
      applyAtomic(database, migrationSql());
    }).toThrow();

    expect(objectCount(database)).toEqual({ count: 1 });
    expect(
      database
        .prepare(
          "SELECT type FROM sqlite_schema WHERE name = 'provenance_v2_provider_bundle'",
        )
        .get(),
    ).toEqual({ type: "view" });
  });

  it("preserves the legacy source-backed roster-outcome blocker", () => {
    const database = predecessor();
    applyAtomic(database, migrationSql());

    const blocker = database
      .prepare(
        `SELECT tbl_name, sql FROM sqlite_schema
         WHERE type = 'trigger'
           AND name = 'publication_roster_outcome_source_execution_blocked'`,
      )
      .get() as unknown;
    if (typeof blocker !== "object" || blocker === null) {
      throw new Error("missing source-backed outcome blocker");
    }
    const row = blocker as Record<string, unknown>;
    expect(row.tbl_name).toBe("publication_roster_operational_outcome");
    expect(row.sql).toBeTypeOf("string");
    expect(row.sql).toContain(
      "source-backed outcomes require provenance-v2 authority",
    );
  });

  it("installs exact composite dependencies before any runtime data", () => {
    const database = predecessor();
    applyAtomic(database, migrationSql());

    const sourceForeignKeys = foreignKeyTuples(
      database,
      "provenance_v2_source_endpoint",
    );
    expect(sourceForeignKeys).toEqual(
      expect.arrayContaining([
        {
          table: "source_compliance_record",
          from: [
            "provider_id",
            "source_register_version",
            "source_register_artifact_hash",
          ],
          to: ["provider_id", "register_version", "artifact_hash"],
        },
        {
          table: "organization",
          from: ["source_owner_organization_id"],
          to: ["organization_id"],
        },
      ]),
    );
    const bundleForeignKeys = foreignKeyTuples(
      database,
      "provenance_v2_provider_bundle",
    );
    expect(bundleForeignKeys).toEqual(
      expect.arrayContaining([
        {
          table: "publication_provider_fence_claim",
          from: [
            "environment",
            "provider_id",
            "fence_generation",
            "provider_run_id",
          ],
          to: ["environment", "provider_id", "generation", "provider_run_id"],
        },
        {
          table: "publication_coordination_provider_run",
          from: ["provider_run_id", "run_id", "provider_id"],
          to: ["provider_run_id", "run_id", "provider_id"],
        },
        {
          table: "publication_coordination_run",
          from: ["run_id", "occurrence_id", "attempt_number"],
          to: ["run_id", "occurrence_id", "attempt_number"],
        },
        {
          table: "provenance_v2_authority_plan",
          from: ["authority_plan_id", "installation_id"],
          to: ["authority_plan_id", "installation_id"],
        },
        {
          table: "provenance_v2_installation_identity",
          from: ["installation_id", "environment"],
          to: ["installation_id", "environment"],
        },
      ]),
    );
    const permitForeignKeys = foreignKeyTuples(
      database,
      "provenance_v2_acquisition_permit",
    );
    expect(permitForeignKeys).toEqual(
      expect.arrayContaining([
        {
          table: "provenance_v2_source_endpoint",
          from: ["authority_plan_id", "endpoint_id"],
          to: ["authority_plan_id", "endpoint_id"],
        },
        {
          table: "provenance_v2_provider_bundle",
          from: ["bundle_id", "authority_plan_id"],
          to: ["bundle_id", "authority_plan_id"],
        },
      ]),
    );
    const responseForeignKeys = foreignKeyTuples(
      database,
      "provenance_v2_admitted_response",
    );
    expect(responseForeignKeys).toEqual(
      expect.arrayContaining([
        {
          table: "provenance_v2_acquisition_permit",
          from: ["permit_id", "bundle_id"],
          to: ["permit_id", "bundle_id"],
        },
      ]),
    );
    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type = 'index' AND name IN (
             'provenance_v2_environment_exact_uq',
             'provenance_v2_run_plan_exact_uq',
             'provenance_v2_coordination_run_exact_uq',
             'provenance_v2_provider_run_exact_uq',
             'provenance_v2_fence_claim_exact_uq',
             'provenance_v2_source_register_exact_uq'
           ) ORDER BY name`,
        )
        .all(),
    ).toHaveLength(6);
  });

  it("pins dormant physical ceilings to approved upstream limits", () => {
    const sql = migrationSql();
    expect(sql).toContain(
      "endpoint_count) = 'integer' AND endpoint_count BETWEEN 1 AND 512",
    );
    expect(sql).toContain(
      "adapter_manifest_count) = 'integer' AND adapter_manifest_count BETWEEN 1 AND 16",
    );
    expect(sql).toContain("ordinal BETWEEN 0 AND 9999");
    expect(sql).toContain("retained_byte_count BETWEEN 0 AND 1000000000");
  });
});
