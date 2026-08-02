import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { assertModelVariantNameSearchQueryableArtifactProofV3 } from "@quant-clarity/publication-core";

import {
  ModelVariantNameSearchStagingError,
  applyModelVariantNameSearchStagingV1,
} from "./model-variant-name-search-staging.js";
import {
  createModelVariantNameSearchFixture,
  seedModelVariantNameSearchBuildingPublication,
} from "../test/model-variant-name-search-fixture.js";

const PUBLICATION_A = "pub_bbbbbbbb-0000-4000-8000-000000000001" as const;
const PUBLICATION_B = "pub_bbbbbbbb-0000-4000-8000-000000000002" as const;
const PUBLICATION_C = "pub_bbbbbbbb-0000-4000-8000-000000000003" as const;

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
          injected = true;
          return session.batch([
            statements[0]!,
            statements[1]!,
            session.prepare("SELECT json('')"),
            statements[2]!,
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

describe("schema-1.6 model/variant BLOB staging in pinned workerd", () => {
  it("persists actual BLOB bytes and proves forced-index match plus empty-BLOB miss", async () => {
    const fixture = await createModelVariantNameSearchFixture(
      PUBLICATION_A,
      Date.parse("2026-08-02T01:00:00.000Z"),
    );
    await seedModelVariantNameSearchBuildingPublication(
      env.SERVING_DB,
      fixture,
    );
    const applied = await applyModelVariantNameSearchStagingV1(
      env.SERVING_DB,
      fixture.staging,
    );
    expect(applied).toMatchObject({ outcome: "applied", documentCount: 1 });
    expect(() => {
      assertModelVariantNameSearchQueryableArtifactProofV3(
        applied.artifactProof,
      );
    }).not.toThrow();

    const row = await one<{
      display_type: string;
      normalized_type: string;
      display_hex: string;
      normalized_hex: string;
    }>(
      env.SERVING_DB,
      `SELECT typeof(display_name_utf8) AS display_type,
        typeof(normalized_name_utf8) AS normalized_type,
        lower(hex(display_name_utf8)) AS display_hex,
        lower(hex(normalized_name_utf8)) AS normalized_hex
      FROM publication_model_variant_name_search_document
      WHERE publication_id = ?`,
      PUBLICATION_A,
    );
    const expected = fixture.persistence.rows[0];
    if (expected === undefined) throw new Error("fixture lacks a storage row");
    expect(row).toEqual({
      display_type: "blob",
      normalized_type: "blob",
      display_hex: hex(expected.display_name_utf8),
      normalized_hex: hex(expected.normalized_name_utf8),
    });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT count(*) AS count
        FROM publication_model_variant_name_search_document
        INDEXED BY publication_model_variant_name_exact_idx
        WHERE publication_id = ?1 AND normalized_name_utf8 = ?2`,
      )
        .bind(PUBLICATION_A, new ArrayBuffer(0))
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 0 });

    await expect(
      applyModelVariantNameSearchStagingV1(env.SERVING_DB, fixture.staging),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("reconciles a committed batch after its response is lost", async () => {
    const fixture = await createModelVariantNameSearchFixture(
      PUBLICATION_B,
      Date.parse("2026-08-02T02:00:00.000Z"),
    );
    await seedModelVariantNameSearchBuildingPublication(
      env.SERVING_DB,
      fixture,
    );
    await expect(
      applyModelVariantNameSearchStagingV1(
        withLostMutationResponse(env.SERVING_DB),
        fixture.staging,
      ),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("observes a transactional rollback as safely not applied", async () => {
    const fixture = await createModelVariantNameSearchFixture(
      PUBLICATION_C,
      Date.parse("2026-08-02T03:00:00.000Z"),
    );
    await seedModelVariantNameSearchBuildingPublication(
      env.SERVING_DB,
      fixture,
    );
    await expect(
      applyModelVariantNameSearchStagingV1(
        withAbortedMutation(env.SERVING_DB),
        fixture.staging,
      ),
    ).rejects.toEqual(new ModelVariantNameSearchStagingError("not_applied"));
    await expect(
      one<{ count: number }>(
        env.SERVING_DB,
        "SELECT count(*) AS count FROM publication_model_variant_name_search_document WHERE publication_id = ?",
        PUBLICATION_C,
      ),
    ).resolves.toEqual({ count: 0 });
  });
});
