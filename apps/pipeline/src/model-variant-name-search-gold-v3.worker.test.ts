import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  MODEL_VARIANT_NAME_SEARCH_MAX_DISPLAY_NAME_UTF8_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
  projectModelVariantNameSearchArtifactProofV1,
  type ModelVariantNameSearchStorageRowV1,
} from "@quant-clarity/publication-core";

import {
  MODEL_VARIANT_NAME_SEARCH_D1_MAX_INSERT_CHUNKS,
  MODEL_VARIANT_NAME_SEARCH_D1_MAX_QUERY_COUNT,
  MODEL_VARIANT_NAME_SEARCH_D1_SAFE_PAYLOAD_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS,
  MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_RETAINED_HEAP_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_TOTAL_JSON_BYTES,
  applyModelVariantNameSearchStagingV1,
  planModelVariantNameSearchInsertChunksV1,
} from "./model-variant-name-search-staging.js";
import {
  createModelVariantNameSearchFixture,
  seedModelVariantNameSearchBuildingPublication,
} from "../test/model-variant-name-search-fixture.js";

const PUBLICATION_LEADING = "pub_dddddddd-0000-4000-8000-000000000001" as const;
const PUBLICATION_INTERIOR =
  "pub_dddddddd-0000-4000-8000-000000000002" as const;
const PUBLICATION_TRAILING =
  "pub_dddddddd-0000-4000-8000-000000000003" as const;
const PUBLICATION_COLLISION =
  "pub_dddddddd-0000-4000-8000-000000000004" as const;
const PUBLICATION_UNKNOWN = "pub_dddddddd-0000-4000-8000-000000000005" as const;
const PUBLICATION_INVALID = "pub_dddddddd-0000-4000-8000-000000000006" as const;
const PUBLICATION_ENVELOPE =
  "pub_dddddddd-0000-4000-8000-000000000007" as const;
const PUBLICATION_MALFORMED_STORED =
  "pub_dddddddd-0000-4000-8000-000000000008" as const;
const PUBLICATION_WRONG_STORED =
  "pub_dddddddd-0000-4000-8000-000000000009" as const;
const PUBLICATION_OMISSION =
  "pub_dddddddd-0000-4000-8000-00000000000a" as const;
const PUBLICATION_EXTRA = "pub_dddddddd-0000-4000-8000-00000000000b" as const;
const ACTUAL_STAGING_WALL_TIME_CEILING_MS = 30_000;

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

const hex = (bytes: readonly number[]): string => {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
};

const insertStorageRow = (
  row: ModelVariantNameSearchStorageRowV1,
  normalizedBytes = row.normalized_name_utf8,
  resourceContentHash = row.resource_content_hash,
): Promise<D1Result> =>
  env.SERVING_DB.prepare(
    `INSERT INTO publication_model_variant_name_search_document (
      publication_id, resource_type, resource_id, projection_version,
      display_name_utf8, normalized_name_utf8, resource_content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.publication_id,
      row.resource_type,
      row.resource_id,
      row.projection_version,
      bytesBuffer(row.display_name_utf8),
      bytesBuffer(normalizedBytes),
      resourceContentHash,
    )
    .run();

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
});

describe("search-gold@3 model/variant BLOB acceptance in pinned workerd", () => {
  it("round-trips leading, interior, and trailing U+0000 exact UTF-8 bytes", async () => {
    const cases = [
      [PUBLICATION_LEADING, "\u0000Leading"],
      [PUBLICATION_INTERIOR, "Interior\u0000Name"],
      [PUBLICATION_TRAILING, "Trailing\u0000"],
    ] as const;
    for (const [index, [publicationId, displayName]] of cases.entries()) {
      const fixture = await createModelVariantNameSearchFixture(
        publicationId,
        Date.parse("2026-08-02T09:00:00.000Z") + index * 60_000,
        displayName,
      );
      await seedModelVariantNameSearchBuildingPublication(
        env.SERVING_DB,
        fixture,
      );
      await expect(
        applyModelVariantNameSearchStagingV1(env.SERVING_DB, fixture.staging),
      ).resolves.toMatchObject({ outcome: "applied", documentCount: 1 });
      const expected = fixture.persistence.rows[0];
      if (expected === undefined) throw new Error("fixture lacks storage row");
      await expect(
        env.SERVING_DB.prepare(
          `SELECT typeof(display_name_utf8) AS display_type,
            typeof(normalized_name_utf8) AS normalized_type,
            lower(hex(display_name_utf8)) AS display_hex,
            lower(hex(normalized_name_utf8)) AS normalized_hex
          FROM publication_model_variant_name_search_document
          WHERE publication_id = ?`,
        )
          .bind(publicationId)
          .first(),
      ).resolves.toEqual({
        display_type: "blob",
        normalized_type: "blob",
        display_hex: hex(expected.display_name_utf8),
        normalized_hex: hex(expected.normalized_name_utf8),
      });
      expect(expected.display_name_utf8).toContain(0);
    }
  });

  it("returns every normalized collision in stable ASCII resource-id order", async () => {
    const fixture = await createModelVariantNameSearchFixture(
      PUBLICATION_COLLISION,
      Date.parse("2026-08-02T09:10:00.000Z"),
      "BETA VARIANT",
      true,
    );
    await seedModelVariantNameSearchBuildingPublication(
      env.SERVING_DB,
      fixture,
    );
    await applyModelVariantNameSearchStagingV1(env.SERVING_DB, fixture.staging);
    const first = fixture.persistence.rows[0];
    if (first === undefined) throw new Error("fixture lacks collision row");
    const expectedIds = fixture.persistence.rows
      .map((row) => row.resource_id)
      .sort();
    const match = await env.SERVING_DB.prepare(
      `SELECT resource_id
      FROM publication_model_variant_name_search_document
      INDEXED BY publication_model_variant_name_exact_idx
      WHERE publication_id = ?1 AND normalized_name_utf8 = ?2
      ORDER BY resource_id`,
    )
      .bind(PUBLICATION_COLLISION, bytesBuffer(first.normalized_name_utf8))
      .all<{ resource_id: string }>();
    expect(match.results.map((row) => row.resource_id)).toEqual(expectedIds);
    expect(match.results).toHaveLength(2);

    const miss = await env.SERVING_DB.prepare(
      `SELECT resource_id
      FROM publication_model_variant_name_search_document
      INDEXED BY publication_model_variant_name_exact_idx
      WHERE publication_id = ?1 AND normalized_name_utf8 = ?2
      ORDER BY resource_id`,
    )
      .bind(PUBLICATION_COLLISION, new ArrayBuffer(0))
      .all<{ resource_id: string }>();
    expect(miss.results).toEqual([]);
  });

  it("omits unknown display names without creating sentinel rows", async () => {
    const fixture = await createModelVariantNameSearchFixture(
      PUBLICATION_UNKNOWN,
      Date.parse("2026-08-02T09:20:00.000Z"),
      null,
    );
    await seedModelVariantNameSearchBuildingPublication(
      env.SERVING_DB,
      fixture,
    );
    await expect(
      applyModelVariantNameSearchStagingV1(env.SERVING_DB, fixture.staging),
    ).resolves.toMatchObject({ documentCount: 0 });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT count(*) AS row_count,
          count(CASE WHEN length(display_name_utf8) = 0
            OR length(normalized_name_utf8) = 0 THEN 1 END) AS sentinel_count
        FROM publication_model_variant_name_search_document
        WHERE publication_id = ?`,
      )
        .bind(PUBLICATION_UNKNOWN)
        .first(),
    ).resolves.toEqual({ row_count: 0, sentinel_count: 0 });
  });

  it("proves dominant planner limits make secondary caps unreachable and stages the largest practical canonical expansion within its wall-time ceiling", async () => {
    const maximumDisplayName = "\ufdfa".repeat(200);
    const maximumDisplayNameRawBytes = 7_200;
    const fullNameCount = Math.floor(
      MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES / maximumDisplayNameRawBytes,
    );
    const remainderDisplayName = `${"\ufdfa".repeat(46)}${"a".repeat(148)}`;
    const fixture = await createModelVariantNameSearchFixture(
      PUBLICATION_ENVELOPE,
      Date.parse("2026-08-02T09:25:00.000Z"),
      [
        ...new Array<string>(fullNameCount).fill(maximumDisplayName),
        remainderDisplayName,
      ],
    );
    const prototype = fixture.persistence.rows[0];
    if (prototype === undefined) throw new Error("fixture lacks envelope row");
    const maximumRowRawBytes =
      MODEL_VARIANT_NAME_SEARCH_MAX_DISPLAY_NAME_UTF8_BYTES +
      MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES;
    const fullRows = Math.floor(
      MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES / maximumRowRawBytes,
    );
    let remaining =
      MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES -
      fullRows * maximumRowRawBytes;
    const envelope: ModelVariantNameSearchStorageRowV1[] = [];
    for (let index = 0; index < fullRows; index += 1)
      envelope.push({
        ...prototype,
        resource_id: `mdl_${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`,
        display_name_utf8: new Array(
          MODEL_VARIANT_NAME_SEARCH_MAX_DISPLAY_NAME_UTF8_BYTES,
        ).fill(65),
        normalized_name_utf8: new Array(
          MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
        ).fill(97),
      });
    if (remaining > 0) {
      const normalizedBytes = Math.min(
        MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
        remaining - 1,
      );
      const displayBytes = remaining - normalizedBytes;
      envelope.push({
        ...prototype,
        resource_id: `mdl_${fullRows.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`,
        display_name_utf8: new Array(displayBytes).fill(65),
        normalized_name_utf8: new Array(normalizedBytes).fill(97),
      });
      remaining -= displayBytes + normalizedBytes;
    }
    expect(remaining).toBe(0);
    const plan = planModelVariantNameSearchInsertChunksV1(envelope);
    expect(plan.rawNameByteCount).toBe(
      MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES,
    );
    expect(plan.documentCount).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS,
    );
    expect(Math.max(...plan.payloadByteLengths)).toBeLessThanOrEqual(
      MODEL_VARIANT_NAME_SEARCH_D1_SAFE_PAYLOAD_BYTES,
    );
    expect(plan.totalJsonBytes).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_MAX_TOTAL_JSON_BYTES,
    );
    expect(plan.payloads.length).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_D1_MAX_INSERT_CHUNKS,
    );
    expect(plan.queryCount).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_D1_MAX_QUERY_COUNT,
    );
    expect(plan.retainedHeapEstimateBytes).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_MAX_RETAINED_HEAP_BYTES,
    );

    const fixedRowBytes = new TextEncoder().encode(
      JSON.stringify({
        publication_id: prototype.publication_id,
        resource_type: "variant",
        resource_id: "var_ffffffff-ffff-4fff-bfff-ffffffffffff",
        projection_version: prototype.projection_version,
        display_name_utf8_hex: "",
        normalized_name_utf8_hex: "",
        resource_content_hash: prototype.resource_content_hash,
      }),
    ).byteLength;
    const totalJsonUpperBound =
      2 +
      MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS * fixedRowBytes +
      (MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS - 1) +
      MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES * 2;
    const maximumSerializedRowBytes = fixedRowBytes + maximumRowRawBytes * 2;
    const minimumNonfinalChunkBytes =
      MODEL_VARIANT_NAME_SEARCH_D1_SAFE_PAYLOAD_BYTES -
      maximumSerializedRowBytes -
      1;
    const derivedChunkUpperBound =
      Math.floor(totalJsonUpperBound / minimumNonfinalChunkBytes) + 1;
    const recoveryQueryUpperBound = 12 + derivedChunkUpperBound;
    const retainedHeapUpperBound =
      MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES * 8 +
      MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES * 2 * 2 +
      totalJsonUpperBound * 2 +
      MODEL_VARIANT_NAME_SEARCH_D1_SAFE_PAYLOAD_BYTES +
      MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS * 1_024;
    expect(totalJsonUpperBound).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_MAX_TOTAL_JSON_BYTES,
    );
    expect(derivedChunkUpperBound).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_D1_MAX_INSERT_CHUNKS,
    );
    expect(recoveryQueryUpperBound).toBeLessThanOrEqual(
      MODEL_VARIANT_NAME_SEARCH_D1_MAX_QUERY_COUNT,
    );
    expect(retainedHeapUpperBound).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_MAX_RETAINED_HEAP_BYTES,
    );

    await seedModelVariantNameSearchBuildingPublication(
      env.SERVING_DB,
      fixture,
    );
    const actualPlan = planModelVariantNameSearchInsertChunksV1(
      fixture.persistence.rows,
    );
    expect(actualPlan.rawNameByteCount).toBe(
      MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES,
    );
    expect(actualPlan.documentCount).toBe(fullNameCount + 1);
    expect(actualPlan.payloadByteLengths).toEqual([
      1_488_943, 1_488_943, 1_316_285,
    ]);
    expect(actualPlan.totalJsonBytes).toBe(4_294_171);
    expect(actualPlan.maximumPayloadBytes).toBe(1_488_943);
    expect(actualPlan.retainedHeapEstimateBytes).toBe(35_542_117);
    expect(actualPlan.queryCount).toBe(15);
    const startedAtMs = Date.now();
    await expect(
      applyModelVariantNameSearchStagingV1(env.SERVING_DB, fixture.staging),
    ).resolves.toMatchObject({
      outcome: "applied",
      documentCount: fullNameCount + 1,
    });
    expect(Date.now() - startedAtMs).toBeLessThan(
      ACTUAL_STAGING_WALL_TIME_CEILING_MS,
    );
    await expect(
      env.SERVING_DB.prepare(
        `SELECT count(*) AS document_count,
          sum(length(display_name_utf8) + length(normalized_name_utf8)) AS raw_name_bytes
        FROM publication_model_variant_name_search_document
        WHERE publication_id = ?`,
      )
        .bind(PUBLICATION_ENVELOPE)
        .first(),
    ).resolves.toEqual({
      document_count: fullNameCount + 1,
      raw_name_bytes: MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES,
    });
  });

  it("rejects persisted malformed and wrong normalized bytes during staging reconciliation", async () => {
    const cases = [
      [PUBLICATION_MALFORMED_STORED, true],
      [PUBLICATION_WRONG_STORED, false],
    ] as const;
    for (const [index, [publicationId, malformed]] of cases.entries()) {
      const fixture = await createModelVariantNameSearchFixture(
        publicationId,
        Date.parse("2026-08-02T09:40:00.000Z") + index * 60_000,
      );
      await seedModelVariantNameSearchBuildingPublication(
        env.SERVING_DB,
        fixture,
      );
      const row = fixture.persistence.rows[0];
      if (row === undefined) throw new Error("fixture lacks corrupt row");
      const normalized = [...row.normalized_name_utf8];
      normalized[0] = malformed ? 0xc3 : 0x78;
      normalized[1] = malformed ? 0x28 : (normalized[1] ?? 0x79);
      await expect(insertStorageRow(row, normalized)).resolves.toBeDefined();
      await expect(
        applyModelVariantNameSearchStagingV1(env.SERVING_DB, fixture.staging),
      ).rejects.toMatchObject({ code: "conflict" });
    }
  });

  it("treats partial omission as conflict while canonical guards reject wrong-hash and extra rows", async () => {
    const omission = await createModelVariantNameSearchFixture(
      PUBLICATION_OMISSION,
      Date.parse("2026-08-02T09:50:00.000Z"),
      "BETA VARIANT",
      true,
    );
    await seedModelVariantNameSearchBuildingPublication(
      env.SERVING_DB,
      omission,
    );
    const first = omission.persistence.rows[0];
    if (first === undefined) throw new Error("fixture lacks omission row");
    await insertStorageRow(first);
    await expect(
      applyModelVariantNameSearchStagingV1(env.SERVING_DB, omission.staging),
    ).rejects.toMatchObject({ code: "conflict" });

    const extra = await createModelVariantNameSearchFixture(
      PUBLICATION_EXTRA,
      Date.parse("2026-08-02T09:55:00.000Z"),
    );
    await seedModelVariantNameSearchBuildingPublication(env.SERVING_DB, extra);
    const row = extra.persistence.rows[0];
    if (row === undefined) throw new Error("fixture lacks guarded row");
    await expect(
      insertStorageRow(
        row,
        row.normalized_name_utf8,
        `sha256:${"0".repeat(64)}`,
      ),
    ).rejects.toThrow();
    await expect(
      insertStorageRow({
        ...row,
        resource_id: "mdl_ffffffff-ffff-4fff-bfff-ffffffffffff",
      }),
    ).rejects.toThrow();
    await expect(
      env.SERVING_DB.prepare(
        `SELECT count(*) AS count
        FROM publication_model_variant_name_search_document
        WHERE publication_id = ?`,
      )
        .bind(PUBLICATION_EXTRA)
        .first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("rejects malformed UTF-8 and wrong bytes at trusted proof boundaries", async () => {
    const fixture = await createModelVariantNameSearchFixture(
      PUBLICATION_INVALID,
      Date.parse("2026-08-02T09:30:00.000Z"),
    );
    const row = fixture.persistence.rows[0];
    if (row === undefined) throw new Error("fixture lacks storage row");
    const malformedNormalized = [...row.normalized_name_utf8];
    malformedNormalized[0] = 0xc3;
    malformedNormalized[1] = 0x28;
    expect(() =>
      projectModelVariantNameSearchArtifactProofV1({
        staging: fixture.staging,
        observation: {
          storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
          rows: [{ ...row, normalized_name_utf8: malformedNormalized }],
        },
      }),
    ).toThrow("normalized-name UTF-8 bytes is invalid");
    expect(() =>
      projectModelVariantNameSearchArtifactProofV1({
        staging: fixture.staging,
        observation: {
          storageVersion: MODEL_VARIANT_NAME_SEARCH_STORAGE_VERSION,
          rows: [{ ...row, display_name_utf8: [120] }],
        },
      }),
    ).toThrow("does not exactly match trusted storage");

    await seedModelVariantNameSearchBuildingPublication(
      env.SERVING_DB,
      fixture,
    );
    await expect(
      env.SERVING_DB.prepare(
        `INSERT INTO publication_model_variant_name_search_document (
          publication_id, resource_type, resource_id, projection_version,
          display_name_utf8, normalized_name_utf8, resource_content_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          row.publication_id,
          row.resource_type,
          row.resource_id,
          row.projection_version,
          bytesBuffer([0xc3, 0x28]),
          bytesBuffer(row.normalized_name_utf8),
          row.resource_content_hash,
        )
        .run(),
    ).rejects.toThrow();
    await expect(
      env.SERVING_DB.prepare(
        `SELECT count(*) AS count
        FROM publication_model_variant_name_search_document
        WHERE publication_id = ?`,
      )
        .bind(PUBLICATION_INVALID)
        .first(),
    ).resolves.toEqual({ count: 0 });
  });
});
