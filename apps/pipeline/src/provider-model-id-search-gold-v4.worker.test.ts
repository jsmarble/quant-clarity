import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import type { ProviderModelIdSearchStorageRowV1 } from "@quant-clarity/publication-core";

import {
  PROVIDER_MODEL_ID_SEARCH_ATOMIC_ASSERTION_STATEMENT_COUNT,
  PROVIDER_MODEL_ID_SEARCH_D1_MAX_INSERT_CHUNKS,
  PROVIDER_MODEL_ID_SEARCH_D1_MAX_QUERY_COUNT,
  PROVIDER_MODEL_ID_SEARCH_D1_RECOVERY_FIXED_QUERY_COUNT,
  PROVIDER_MODEL_ID_SEARCH_D1_SAFE_PAYLOAD_BYTES,
  PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS,
  PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES,
  PROVIDER_MODEL_ID_SEARCH_MAX_RETAINED_HEAP_BYTES,
  PROVIDER_MODEL_ID_SEARCH_MAX_TOTAL_JSON_BYTES,
  applyProviderModelIdSearchStagingV1,
  planProviderModelIdSearchInsertChunksV1,
  prepareProviderModelIdSearchAtomicAssertionsV4,
} from "./provider-model-id-search-staging.js";
import {
  createProviderModelIdSearchFixture,
  seedProviderModelIdSearchBuildingPublication,
  type ProviderModelIdOfferingFixture,
} from "../test/provider-model-id-search-fixture.js";

const PUBLICATION_NUL = "pub_daaaaaaa-0000-4000-8000-000000000001" as const;
const PUBLICATION_COLLISIONS =
  "pub_daaaaaaa-0000-4000-8000-000000000002" as const;
const PUBLICATION_CORRUPT = "pub_daaaaaaa-0000-4000-8000-000000000003" as const;
const PUBLICATION_ENVELOPE =
  "pub_daaaaaaa-0000-4000-8000-000000000004" as const;
const ACTUAL_STAGING_WALL_TIME_CEILING_MS = 30_000;
const ACTUAL_ATOMIC_ASSERTION_WALL_TIME_CEILING_MS = 30_000;

const bytesBuffer = (bytes: readonly number[]): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.length);
  const view = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) throw new Error("fixture bytes are incomplete");
    view[index] = byte;
  }
  return buffer;
};

const byteKey = (bytes: readonly number[]): string => JSON.stringify(bytes);

const insertStorageRow = (
  row: ProviderModelIdSearchStorageRowV1,
  rawBytes: readonly number[] = row.raw_provider_model_id_utf8,
  normalizedBytes: readonly number[] = row.normalized_provider_model_id_utf8,
  offeringContentHash = row.offering_content_hash,
  targetContentHash = row.target_content_hash,
): Promise<D1Result> =>
  env.SERVING_DB.prepare(
    `INSERT INTO publication_provider_model_id_search_document (
      publication_id, offering_id, provider_id, target_resource_type,
      target_resource_id, projection_version, raw_provider_model_id_utf8,
      normalized_provider_model_id_utf8, offering_content_hash,
      target_content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.publication_id,
      row.offering_id,
      row.provider_id,
      row.target_resource_type,
      row.target_resource_id,
      row.projection_version,
      bytesBuffer(rawBytes),
      bytesBuffer(normalizedBytes),
      offeringContentHash,
      targetContentHash,
    )
    .run();

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
});

describe("search-gold@4 provider-model-ID BLOB acceptance in pinned workerd", () => {
  it("round-trips leading/interior/trailing U+0000 and valid empty normalized X''", async () => {
    const fixture = await createProviderModelIdSearchFixture(
      PUBLICATION_NUL,
      Date.parse("2026-08-02T09:00:00.000Z"),
      [
        { rawProviderModelId: "\u0000leading" },
        { rawProviderModelId: "interior\u0000value" },
        { rawProviderModelId: "trailing\u0000" },
        { rawProviderModelId: "\u00ad" },
      ],
    );
    await seedProviderModelIdSearchBuildingPublication(env.SERVING_DB, fixture);
    await expect(
      applyProviderModelIdSearchStagingV1(env.SERVING_DB, fixture.staging),
    ).resolves.toMatchObject({ outcome: "applied", documentCount: 4 });
    const rows = await env.SERVING_DB.prepare(
      `SELECT offering_id, lower(hex(raw_provider_model_id_utf8)) AS raw_hex,
        lower(hex(normalized_provider_model_id_utf8)) AS normalized_hex,
        length(normalized_provider_model_id_utf8) AS normalized_bytes
      FROM publication_provider_model_id_search_document
      WHERE publication_id = ? ORDER BY offering_id`,
    )
      .bind(PUBLICATION_NUL)
      .all<{
        offering_id: string;
        raw_hex: string;
        normalized_hex: string;
        normalized_bytes: number;
      }>();
    expect(rows.results).toHaveLength(4);
    expect(
      fixture.persistence.rows
        .slice(0, 3)
        .every((row) => row.raw_provider_model_id_utf8.includes(0)),
    ).toBe(true);
    const empty = fixture.persistence.rows[3];
    if (empty === undefined)
      throw new Error("fixture lacks empty normalized row");
    expect(empty.normalized_provider_model_id_utf8).toEqual([]);
    expect(rows.results[3]).toMatchObject({
      offering_id: empty.offering_id,
      normalized_hex: "",
      normalized_bytes: 0,
    });
  });

  it("preserves raw duplicates, normalized collisions, repeated targets/providers, and every status/stale row", async () => {
    const fixture = await createProviderModelIdSearchFixture(
      PUBLICATION_COLLISIONS,
      Date.parse("2026-08-02T09:10:00.000Z"),
      [
        { rawProviderModelId: "Provider/ID", status: "active" },
        { rawProviderModelId: "provider/id", status: "inactive" },
        { rawProviderModelId: "Provider/ID", status: "unavailable" },
        { rawProviderModelId: "PROVIDER/ID", status: null, stale: true },
      ],
    );
    await seedProviderModelIdSearchBuildingPublication(env.SERVING_DB, fixture);
    await applyProviderModelIdSearchStagingV1(env.SERVING_DB, fixture.staging);
    const first = fixture.persistence.rows[0];
    if (first === undefined) throw new Error("fixture lacks collision row");
    const rawExpected = fixture.persistence.rows
      .filter(
        (row) =>
          byteKey(row.raw_provider_model_id_utf8) ===
          byteKey(first.raw_provider_model_id_utf8),
      )
      .map((row) => row.offering_id)
      .sort();
    const normalizedExpected = fixture.persistence.rows
      .map((row) => row.offering_id)
      .sort();
    const raw = await env.SERVING_DB.prepare(
      `SELECT offering_id FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_raw_exact_idx
      WHERE publication_id = ?1 AND raw_provider_model_id_utf8 = ?2
      ORDER BY offering_id`,
    )
      .bind(
        PUBLICATION_COLLISIONS,
        bytesBuffer(first.raw_provider_model_id_utf8),
      )
      .all<{ offering_id: string }>();
    const normalized = await env.SERVING_DB.prepare(
      `SELECT offering_id FROM publication_provider_model_id_search_document
      INDEXED BY publication_provider_model_id_normalized_exact_idx
      WHERE publication_id = ?1 AND normalized_provider_model_id_utf8 = ?2
      ORDER BY offering_id`,
    )
      .bind(
        PUBLICATION_COLLISIONS,
        bytesBuffer(first.normalized_provider_model_id_utf8),
      )
      .all<{ offering_id: string }>();
    expect(raw.results.map((row) => row.offering_id)).toEqual(rawExpected);
    expect(normalized.results.map((row) => row.offering_id)).toEqual(
      normalizedExpected,
    );
    expect(
      new Set(fixture.persistence.rows.map((row) => row.provider_id)).size,
    ).toBe(1);
    expect(
      new Set(fixture.persistence.rows.map((row) => row.target_resource_id))
        .size,
    ).toBe(1);
    const indexes = await env.SERVING_DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND name IN (
          'publication_provider_model_id_raw_exact_idx',
          'publication_provider_model_id_normalized_exact_idx'
        ) ORDER BY name`,
    ).all<{ name: string }>();
    expect(indexes.results.map((row) => row.name)).toEqual([
      "publication_provider_model_id_normalized_exact_idx",
      "publication_provider_model_id_raw_exact_idx",
    ]);
  });

  it("fails closed on malformed UTF-8 and wrong canonical hashes before durable storage", async () => {
    const fixture = await createProviderModelIdSearchFixture(
      PUBLICATION_CORRUPT,
      Date.parse("2026-08-02T09:20:00.000Z"),
    );
    await seedProviderModelIdSearchBuildingPublication(env.SERVING_DB, fixture);
    const row = fixture.persistence.rows[0];
    if (row === undefined) throw new Error("fixture lacks corrupt row");
    await expect(insertStorageRow(row, [0x80])).rejects.toThrow(
      "raw provider model ID must be strict UTF-8",
    );
    await expect(
      insertStorageRow(row, row.raw_provider_model_id_utf8, [0x80]),
    ).rejects.toThrow("normalized provider model ID must be strict UTF-8");
    await expect(
      insertStorageRow(
        row,
        row.raw_provider_model_id_utf8,
        row.normalized_provider_model_id_utf8,
        `sha256:${"0".repeat(64)}`,
      ),
    ).rejects.toThrow(
      "provider model ID search document does not match canonical offering and target content",
    );
    await expect(
      insertStorageRow(
        row,
        row.raw_provider_model_id_utf8,
        row.normalized_provider_model_id_utf8,
        row.offering_content_hash,
        `sha256:${"0".repeat(64)}`,
      ),
    ).rejects.toThrow(
      "provider model ID search document does not match canonical offering and target content",
    );
    await expect(
      env.SERVING_DB.prepare(
        "SELECT count(*) AS count FROM publication_provider_model_id_search_document WHERE publication_id = ?",
      )
        .bind(PUBLICATION_CORRUPT)
        .first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("stages and atomically reasserts the actual 2,000-row/2MiB nominal envelope", async () => {
    const ordinary = `${"\ufdfa".repeat(29)}aa`;
    const remainder = `${"\ufdfa".repeat(60)}${"a".repeat(20)}`;
    const offerings: ProviderModelIdOfferingFixture[] = Array.from(
      { length: PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS },
      (_, index) => ({
        rawProviderModelId:
          index === PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS - 1
            ? remainder
            : ordinary,
        status:
          index % 3 === 0
            ? "inactive"
            : index % 3 === 1
              ? "unavailable"
              : "active",
        stale: index % 5 === 0,
      }),
    );
    const fixture = await createProviderModelIdSearchFixture(
      PUBLICATION_ENVELOPE,
      Date.parse("2026-08-02T09:30:00.000Z"),
      offerings,
    );
    const plan = planProviderModelIdSearchInsertChunksV1(
      fixture.persistence.rows,
    );
    expect(plan.documentCount).toBe(PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS);
    expect(plan.rawProviderModelIdByteCount).toBe(
      PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES,
    );
    expect(plan.maximumPayloadBytes).toBeLessThanOrEqual(
      PROVIDER_MODEL_ID_SEARCH_D1_SAFE_PAYLOAD_BYTES,
    );
    expect(plan.totalJsonBytes).toBeLessThanOrEqual(
      PROVIDER_MODEL_ID_SEARCH_MAX_TOTAL_JSON_BYTES,
    );
    expect(plan.payloads.length).toBeLessThanOrEqual(
      PROVIDER_MODEL_ID_SEARCH_D1_MAX_INSERT_CHUNKS,
    );
    expect(plan.payloads).toHaveLength(4);
    expect(plan.queryCount).toBeLessThanOrEqual(
      PROVIDER_MODEL_ID_SEARCH_D1_MAX_QUERY_COUNT,
    );
    expect(plan.queryCount).toBe(
      PROVIDER_MODEL_ID_SEARCH_D1_RECOVERY_FIXED_QUERY_COUNT +
        plan.payloads.length,
    );
    expect(plan.queryCount).toBe(20);
    expect(plan.totalJsonBytes).toBe(5_368_308);
    expect(plan.maximumPayloadBytes).toBe(1_499_798);
    expect(plan.retainedHeapEstimateBytes).toBeLessThanOrEqual(
      PROVIDER_MODEL_ID_SEARCH_MAX_RETAINED_HEAP_BYTES,
    );
    expect(plan.retainedHeapEstimateBytes).toBe(39_450_238);
    await seedProviderModelIdSearchBuildingPublication(env.SERVING_DB, fixture);
    const stagingStartedAtMs = Date.now();
    const staged = await applyProviderModelIdSearchStagingV1(
      env.SERVING_DB,
      fixture.staging,
    );
    expect(staged).toMatchObject({ outcome: "applied", documentCount: 2_000 });
    expect(Date.now() - stagingStartedAtMs).toBeLessThan(
      ACTUAL_STAGING_WALL_TIME_CEILING_MS,
    );
    expect(PROVIDER_MODEL_ID_SEARCH_ATOMIC_ASSERTION_STATEMENT_COUNT).toBe(2);
    const atomicStartedAtMs = Date.now();
    const atomicSession = env.SERVING_DB.withSession("first-primary");
    const atomicStatements = prepareProviderModelIdSearchAtomicAssertionsV4(
      atomicSession,
      staged.artifactProof,
    );
    expect(atomicStatements).toHaveLength(
      PROVIDER_MODEL_ID_SEARCH_ATOMIC_ASSERTION_STATEMENT_COUNT,
    );
    const atomicResults = await atomicSession.batch([...atomicStatements]);
    expect(Date.now() - atomicStartedAtMs).toBeLessThan(
      ACTUAL_ATOMIC_ASSERTION_WALL_TIME_CEILING_MS,
    );
    expect(atomicResults).toHaveLength(2);
    expect(atomicResults[0]?.results).toEqual([
      { provider_model_id_parity: 1 },
    ]);
    expect(atomicResults[1]?.results).toEqual([
      { provider_model_id_indexes: 1 },
    ]);
    await expect(
      env.SERVING_DB.prepare(
        `SELECT count(*) AS document_count,
            sum(length(raw_provider_model_id_utf8) +
                length(normalized_provider_model_id_utf8)) AS raw_bytes
          FROM publication_provider_model_id_search_document
          WHERE publication_id = ?`,
      )
        .bind(PUBLICATION_ENVELOPE)
        .first(),
    ).resolves.toEqual({
      document_count: PROVIDER_MODEL_ID_SEARCH_MAX_DOCUMENTS,
      raw_bytes: PROVIDER_MODEL_ID_SEARCH_MAX_RAW_NAME_BYTES,
    });
  }, 60_000);
});
