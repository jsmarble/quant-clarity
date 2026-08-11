import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

interface ForeignKeyTuple {
  table: string;
  from: string[];
  to: string[];
}

function foreignKeyTuples(value: unknown): ForeignKeyTuple[] {
  if (!Array.isArray(value)) throw new Error("invalid foreign-key results");
  const rows = value.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new Error("invalid foreign-key row");
    }
    const row = item as Record<string, unknown>;
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
    return {
      table: group[0]?.table ?? "",
      from: group.map((row) => row.from),
      to: group.map((row) => row.to),
    };
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.CANONICAL_DB, env.CANONICAL_MIGRATIONS);
});

describe("dormant fenced provenance-v2 foundation in workerd", () => {
  it("installs the static capability with no runtime authority", async () => {
    const capability = await env.CANONICAL_DB.prepare(
      `SELECT capability, predecessor_capability, hash_domain,
        vocabulary_version, writer_contract_version
       FROM provenance_v2_integrity_metadata WHERE singleton = 1`,
    ).first();
    expect(capability).toEqual({
      capability: "fenced-provenance-v2@1",
      predecessor_capability: "publication-orchestration-ledger@1",
      hash_domain: "quantclarity:provenance-v2:v1",
      vocabulary_version: "provenance-v2-vocabulary@1",
      writer_contract_version: "provenance-v2-writer@1",
    });
    expect(
      await env.CANONICAL_DB.prepare(
        "SELECT count(*) AS count FROM provenance_v2_installation_identity",
      ).first(),
    ).toEqual({ count: 0 });
  });

  it("enforces runtime blockers and composite foreign keys in D1", async () => {
    await expect(
      env.CANONICAL_DB.prepare(
        "INSERT INTO provenance_v2_installation_identity DEFAULT VALUES",
      ).run(),
    ).rejects.toThrow(/not activated/u);
    await expect(
      env.CANONICAL_DB.prepare(
        "INSERT INTO provenance_v2_acquisition_permit DEFAULT VALUES",
      ).run(),
    ).rejects.toThrow(/not activated/u);
    await expect(
      env.CANONICAL_DB.prepare(
        "INSERT INTO provenance_v2_admitted_response DEFAULT VALUES",
      ).run(),
    ).rejects.toThrow(/not activated/u);

    const bundleForeignKeys = await env.CANONICAL_DB.prepare(
      "PRAGMA foreign_key_list(provenance_v2_provider_bundle)",
    ).all();
    expect(foreignKeyTuples(bundleForeignKeys.results)).toEqual(
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
      ]),
    );
    const permitForeignKeys = await env.CANONICAL_DB.prepare(
      "PRAGMA foreign_key_list(provenance_v2_acquisition_permit)",
    ).all();
    expect(foreignKeyTuples(permitForeignKeys.results)).toEqual(
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
    const responseForeignKeys = await env.CANONICAL_DB.prepare(
      "PRAGMA foreign_key_list(provenance_v2_admitted_response)",
    ).all();
    expect(foreignKeyTuples(responseForeignKeys.results)).toEqual(
      expect.arrayContaining([
        {
          table: "provenance_v2_acquisition_permit",
          from: ["permit_id", "bundle_id"],
          to: ["permit_id", "bundle_id"],
        },
      ]),
    );
  });

  it("leaves the legacy source-backed outcome blocker installed", async () => {
    const blocker = await env.CANONICAL_DB.prepare(
      `SELECT tbl_name, sql FROM sqlite_schema
       WHERE type = 'trigger'
         AND name = 'publication_roster_outcome_source_execution_blocked'`,
    ).first<{ tbl_name: string; sql: string }>();
    expect(blocker?.tbl_name).toBe("publication_roster_operational_outcome");
    expect(blocker?.sql).toContain(
      "source-backed outcomes require provenance-v2 authority",
    );
  });
});
