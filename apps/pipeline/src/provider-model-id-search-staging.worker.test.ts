import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { assertProviderModelIdSearchQueryableArtifactProofV4 } from "@quant-clarity/publication-core";

import {
  ProviderModelIdSearchStagingError,
  applyProviderModelIdSearchStagingV1,
  verifyProviderModelIdSearchStorageV4,
} from "./provider-model-id-search-staging.js";
import {
  createProviderModelIdSearchFixture,
  seedProviderModelIdSearchBuildingPublication,
} from "../test/provider-model-id-search-fixture.js";

const PUBLICATION_A = "pub_caaaaaaa-0000-4000-8000-000000000001" as const;
const PUBLICATION_B = "pub_caaaaaaa-0000-4000-8000-000000000002" as const;
const PUBLICATION_C = "pub_caaaaaaa-0000-4000-8000-000000000003" as const;

const hex = (bytes: readonly number[]): string => {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
};

const one = async <Row>(
  database: D1Database,
  sql: string,
  value?: unknown,
): Promise<Row> => {
  const prepared = database.prepare(sql);
  const row = await (
    value === undefined ? prepared : prepared.bind(value)
  ).first<Row>();
  if (row === null) throw new Error("expected one D1 row");
  return row;
};

const withLostMutationResponse = (database: D1Database): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          const result = await session.batch(statements);
          if (!injected && statements.length === 3) {
            injected = true;
            throw new Error("simulated lost response");
          }
          return result;
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const withAbortedMutation = (database: D1Database): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        batch(statements: D1PreparedStatement[]) {
          if (injected || statements.length !== 3)
            return session.batch(statements);
          const first = statements[0];
          const insert = statements[1];
          const last = statements[2];
          if (first === undefined || insert === undefined || last === undefined)
            throw new Error("mutation batch is incomplete");
          injected = true;
          return session.batch([
            first,
            insert,
            session.prepare("SELECT json('')"),
            last,
          ]);
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
});

describe("schema-1.7 provider-model-ID BLOB staging in pinned workerd", () => {
  it("persists U+0000 and empty normalized BLOBs through both forced indexes", async () => {
    const fixture = await createProviderModelIdSearchFixture(
      PUBLICATION_A,
      Date.parse("2026-08-02T01:00:00.000Z"),
      [{ rawProviderModelId: "\u0000Provider/Model\u0000" }],
    );
    await seedProviderModelIdSearchBuildingPublication(env.SERVING_DB, fixture);
    const applied = await applyProviderModelIdSearchStagingV1(
      env.SERVING_DB,
      fixture.staging,
    );
    expect(applied).toMatchObject({ outcome: "applied", documentCount: 1 });
    expect(() => {
      assertProviderModelIdSearchQueryableArtifactProofV4(
        applied.artifactProof,
      );
    }).not.toThrow();
    await expect(
      verifyProviderModelIdSearchStorageV4(
        env.SERVING_DB,
        applied.artifactProof,
      ),
    ).resolves.toBeUndefined();

    const row = await one<{
      raw_type: string;
      normalized_type: string;
      raw_hex: string;
      normalized_hex: string;
    }>(
      env.SERVING_DB,
      `SELECT typeof(raw_provider_model_id_utf8) AS raw_type,
        typeof(normalized_provider_model_id_utf8) AS normalized_type,
        lower(hex(raw_provider_model_id_utf8)) AS raw_hex,
        lower(hex(normalized_provider_model_id_utf8)) AS normalized_hex
      FROM publication_provider_model_id_search_document
      WHERE publication_id = ?`,
      PUBLICATION_A,
    );
    const expected = fixture.persistence.rows[0];
    if (expected === undefined) throw new Error("fixture lacks a storage row");
    expect(row).toEqual({
      raw_type: "blob",
      normalized_type: "blob",
      raw_hex: hex(expected.raw_provider_model_id_utf8),
      normalized_hex: hex(expected.normalized_provider_model_id_utf8),
    });
    for (const index of [
      "publication_provider_model_id_raw_exact_idx",
      "publication_provider_model_id_normalized_exact_idx",
    ])
      await expect(
        env.SERVING_DB.prepare(
          `SELECT count(*) AS count
          FROM publication_provider_model_id_search_document
          INDEXED BY ${index}
          WHERE publication_id = ?1 AND ${
            index.includes("raw")
              ? "raw_provider_model_id_utf8"
              : "normalized_provider_model_id_utf8"
          } = X'FF'`,
        )
          .bind(PUBLICATION_A)
          .first<{ count: number }>(),
      ).resolves.toEqual({ count: 0 });
  });

  it("reconciles a committed atomic batch after its response is lost", async () => {
    const fixture = await createProviderModelIdSearchFixture(
      PUBLICATION_B,
      Date.parse("2026-08-02T02:00:00.000Z"),
    );
    await seedProviderModelIdSearchBuildingPublication(env.SERVING_DB, fixture);
    await expect(
      applyProviderModelIdSearchStagingV1(
        withLostMutationResponse(env.SERVING_DB),
        fixture.staging,
      ),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("classifies a real transactional rollback as safely not applied", async () => {
    const fixture = await createProviderModelIdSearchFixture(
      PUBLICATION_C,
      Date.parse("2026-08-02T03:00:00.000Z"),
    );
    await seedProviderModelIdSearchBuildingPublication(env.SERVING_DB, fixture);
    await expect(
      applyProviderModelIdSearchStagingV1(
        withAbortedMutation(env.SERVING_DB),
        fixture.staging,
      ),
    ).rejects.toEqual(new ProviderModelIdSearchStagingError("not_applied"));
    await expect(
      one<{ count: number }>(
        env.SERVING_DB,
        "SELECT count(*) AS count FROM publication_provider_model_id_search_document WHERE publication_id = ?",
        PUBLICATION_C,
      ),
    ).resolves.toEqual({ count: 0 });
  });
});
