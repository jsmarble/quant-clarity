import { beforeAll, describe, expect, it } from "vitest";

import {
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  assertModelVariantNameSearchQueryableArtifactProofV3,
  type ModelVariantNameSearchStorageRowV1,
} from "@quant-clarity/publication-core";

import {
  MODEL_VARIANT_NAME_SEARCH_D1_INSERT_BOUND_PARAMETERS,
  MODEL_VARIANT_NAME_SEARCH_D1_MAX_INSERT_CHUNKS,
  MODEL_VARIANT_NAME_SEARCH_D1_MAX_QUERY_COUNT,
  MODEL_VARIANT_NAME_SEARCH_D1_RECOVERY_FIXED_QUERY_COUNT,
  MODEL_VARIANT_NAME_SEARCH_D1_SAFE_PAYLOAD_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS,
  MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_RETAINED_HEAP_BYTES,
  MODEL_VARIANT_NAME_SEARCH_MAX_TOTAL_JSON_BYTES,
  ModelVariantNameSearchStagingError,
  applyModelVariantNameSearchStagingV1,
  planModelVariantNameSearchInsertChunksV1,
} from "./model-variant-name-search-staging.js";
import {
  createModelVariantNameSearchFixture,
  type ModelVariantNameSearchFixture,
} from "../test/model-variant-name-search-fixture.js";

const PUBLICATION_ID = "pub_11111111-1111-4111-8111-111111111111";
let fixture: ModelVariantNameSearchFixture;
let emptyFixture: ModelVariantNameSearchFixture;
let twoDocumentFixture: ModelVariantNameSearchFixture;

const hex = (bytes: readonly number[]): string => {
  let value = "";
  for (const byte of bytes) value += byte.toString(16).padStart(2, "0");
  return value;
};

beforeAll(async () => {
  fixture = await createModelVariantNameSearchFixture(
    PUBLICATION_ID,
    Date.parse("2026-08-02T00:00:00.000Z"),
  );
  emptyFixture = await createModelVariantNameSearchFixture(
    "pub_22222222-2222-4222-8222-222222222222",
    Date.parse("2026-08-02T00:10:00.000Z"),
    null,
  );
  twoDocumentFixture = await createModelVariantNameSearchFixture(
    "pub_33333333-3333-4333-8333-333333333333",
    Date.parse("2026-08-02T00:20:00.000Z"),
    "Älpha Model",
    true,
  );
});

const META = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
} satisfies D1Meta;

const result = (rows: unknown[] = []): D1Result => ({
  success: true,
  meta: META,
  results: rows,
});

type Captured = Readonly<{ sql: string; values: readonly unknown[] }>;
const CAPTURE = Symbol("model/variant name search statement");
type CapturedStatement = D1PreparedStatement & { readonly [CAPTURE]: Captured };

const prepared = (
  sql: string,
  values: readonly unknown[] = [],
): D1PreparedStatement =>
  ({
    [CAPTURE]: { sql, values },
    bind: (...next: unknown[]) => prepared(sql, next),
  }) as CapturedStatement;

type Handler = (statements: readonly Captured[]) => Promise<D1Result[]>;

const fakeDatabase = (...handlers: Handler[]) => {
  const sessions: string[] = [];
  const batches: Captured[][] = [];
  let handlerIndex = 0;
  const database = {
    withSession(constraint?: D1SessionConstraint) {
      sessions.push(String(constraint));
      return {
        prepare: prepared,
        batch(statements: D1PreparedStatement[]) {
          const captured = new Array<Captured>(statements.length);
          for (let index = 0; index < statements.length; index += 1) {
            const statement = statements[index] as
              CapturedStatement | undefined;
            if (statement === undefined) throw new Error("missing statement");
            captured[index] = statement[CAPTURE];
          }
          batches.push(captured);
          const handler = handlers[handlerIndex];
          handlerIndex += 1;
          if (handler === undefined) throw new Error("unexpected D1 batch");
          return handler(captured);
        },
        getBookmark: () => null,
      } as D1DatabaseSession;
    },
  } as D1Database;
  return { database, sessions, batches };
};

const snapshot = (committed: boolean, target = fixture): D1Result[] => [
  result([
    {
      state: "building",
      closure_hash: target.persistence.closureHash,
      staging_revision: target.persistence.stagingRevision,
      sealed: 0,
      eligible_document_count: target.persistence.documentCount,
    },
  ]),
  result(committed ? [...target.persistence.rows] : []),
];

const indexedProbe = (statements: readonly Captured[]): Promise<D1Result[]> => {
  expect(statements).toHaveLength(2);
  for (const statement of statements) {
    expect(statement.sql).toContain(
      "INDEXED BY publication_model_variant_name_exact_idx",
    );
    expect(statement.values[1]).toBeInstanceOf(ArrayBuffer);
  }
  expect((statements[1]?.values[1] as ArrayBuffer).byteLength).toBe(0);
  return Promise.resolve([
    result([{ resource_id: fixture.persistence.rows[0]?.resource_id }]),
    result([]),
  ]);
};

describe("model/variant name BLOB insert planner", () => {
  it("freezes the documented operational ceilings and emits lowercase hex JSON", () => {
    const plan = planModelVariantNameSearchInsertChunksV1(
      fixture.persistence.rows,
    );
    expect(MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS).toBe(2_000);
    expect(MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES).toBe(
      2 * 1_024 * 1_024,
    );
    expect(MODEL_VARIANT_NAME_SEARCH_D1_SAFE_PAYLOAD_BYTES).toBe(1_500_000);
    expect(MODEL_VARIANT_NAME_SEARCH_MAX_TOTAL_JSON_BYTES).toBe(
      8 * 1_024 * 1_024,
    );
    expect(MODEL_VARIANT_NAME_SEARCH_D1_MAX_INSERT_CHUNKS).toBe(40);
    expect(MODEL_VARIANT_NAME_SEARCH_D1_MAX_QUERY_COUNT).toBe(50);
    expect(MODEL_VARIANT_NAME_SEARCH_MAX_RETAINED_HEAP_BYTES).toBe(
      64 * 1_024 * 1_024,
    );
    expect(plan.insertBoundParameterCount).toBe(
      MODEL_VARIANT_NAME_SEARCH_D1_INSERT_BOUND_PARAMETERS,
    );
    expect(MODEL_VARIANT_NAME_SEARCH_D1_RECOVERY_FIXED_QUERY_COUNT).toBe(12);
    expect(plan.queryCount).toBe(13);
    expect(plan.payloadByteLengths[0]).toBeLessThanOrEqual(1_500_000);
    expect(plan.totalJsonBytes).toBe(plan.payloadByteLengths[0]);
    expect(plan.retainedHeapEstimateBytes).toBeLessThanOrEqual(
      MODEL_VARIANT_NAME_SEARCH_MAX_RETAINED_HEAP_BYTES,
    );
    const parsed = JSON.parse(plan.payloads[0] ?? "") as {
      display_name_utf8_hex: string;
      normalized_name_utf8_hex: string;
    }[];
    expect(parsed[0]?.display_name_utf8_hex).toMatch(/^[0-9a-f]+$/u);
    expect(parsed[0]?.normalized_name_utf8_hex).toMatch(/^[0-9a-f]+$/u);
    expect(parsed[0]?.display_name_utf8_hex).toBe(
      hex([...new TextEncoder().encode("Älpha Model")]),
    );
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.payloads)).toBe(true);
  });

  it("fails raw-name, per-value, document, and byte validation before D1", () => {
    const row = fixture.persistence.rows[0];
    if (row === undefined) throw new Error("fixture lacks a storage row");
    expect(() =>
      planModelVariantNameSearchInsertChunksV1(
        Array.from(
          { length: MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS + 1 },
          () => row,
        ),
      ),
    ).toThrow(ModelVariantNameSearchStagingError);
    expect(() =>
      planModelVariantNameSearchInsertChunksV1([
        {
          ...row,
          normalized_name_utf8: new Array(
            MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES + 1,
          ).fill(97),
        },
      ]),
    ).toThrow(ModelVariantNameSearchStagingError);
    const large = {
      ...row,
      normalized_name_utf8: new Array(
        MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
      ).fill(97),
    } satisfies ModelVariantNameSearchStorageRowV1;
    expect(() =>
      planModelVariantNameSearchInsertChunksV1(
        Array.from({ length: 146 }, () => large),
      ),
    ).toThrow(ModelVariantNameSearchStagingError);
    expect(() =>
      planModelVariantNameSearchInsertChunksV1([
        { ...row, display_name_utf8: [256] },
      ]),
    ).toThrow(ModelVariantNameSearchStagingError);
  });

  it("accepts document limit minus one and limit, then rejects limit plus one", () => {
    const row = fixture.persistence.rows[0];
    if (row === undefined) throw new Error("fixture lacks a storage row");
    expect(
      planModelVariantNameSearchInsertChunksV1(
        Array.from(
          { length: MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS - 1 },
          () => row,
        ),
      ).documentCount,
    ).toBe(MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS - 1);
    expect(
      planModelVariantNameSearchInsertChunksV1(
        Array.from(
          { length: MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS },
          () => row,
        ),
      ).documentCount,
    ).toBe(MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS);
    expect(() =>
      planModelVariantNameSearchInsertChunksV1(
        Array.from(
          { length: MODEL_VARIANT_NAME_SEARCH_MAX_DOCUMENTS + 1 },
          () => row,
        ),
      ),
    ).toThrow(ModelVariantNameSearchStagingError);
  });

  it("proves the raw-byte boundary and secondary cap envelope", () => {
    const row = fixture.persistence.rows[0];
    if (row === undefined) throw new Error("fixture lacks a storage row");
    const atRawBytes = (
      total: number,
    ): ModelVariantNameSearchStorageRowV1[] => {
      const rows: ModelVariantNameSearchStorageRowV1[] = [];
      let remaining = total;
      while (remaining > 0) {
        const normalizedLength = Math.min(
          MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
          remaining - 1,
        );
        const displayLength = Math.min(800, remaining - normalizedLength);
        rows.push({
          ...row,
          display_name_utf8: new Array(displayLength).fill(65),
          normalized_name_utf8: new Array(normalizedLength).fill(97),
        });
        remaining -= displayLength + normalizedLength;
      }
      return rows;
    };
    const below = planModelVariantNameSearchInsertChunksV1(
      atRawBytes(MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES - 1),
    );
    const exact = planModelVariantNameSearchInsertChunksV1(
      atRawBytes(MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES),
    );
    expect(below.rawNameByteCount).toBe(
      MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES - 1,
    );
    expect(exact.rawNameByteCount).toBe(
      MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES,
    );
    expect(() =>
      planModelVariantNameSearchInsertChunksV1(
        atRawBytes(MODEL_VARIANT_NAME_SEARCH_MAX_RAW_NAME_BYTES + 1),
      ),
    ).toThrow(ModelVariantNameSearchStagingError);
    expect(Math.max(...exact.payloadByteLengths)).toBeLessThanOrEqual(
      MODEL_VARIANT_NAME_SEARCH_D1_SAFE_PAYLOAD_BYTES,
    );
    expect(exact.totalJsonBytes).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_MAX_TOTAL_JSON_BYTES,
    );
    expect(exact.payloads.length).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_D1_MAX_INSERT_CHUNKS,
    );
    expect(exact.queryCount).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_D1_MAX_QUERY_COUNT,
    );
    expect(
      MODEL_VARIANT_NAME_SEARCH_D1_MAX_QUERY_COUNT -
        MODEL_VARIANT_NAME_SEARCH_D1_RECOVERY_FIXED_QUERY_COUNT,
    ).toBe(38);
    expect(exact.retainedHeapEstimateBytes).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_MAX_RETAINED_HEAP_BYTES,
    );
  });

  it("accepts each BLOB length limit minus one and limit, then rejects limit plus one", () => {
    const row = fixture.persistence.rows[0];
    if (row === undefined) throw new Error("fixture lacks a storage row");
    for (const displayLength of [799, 800])
      expect(() =>
        planModelVariantNameSearchInsertChunksV1([
          { ...row, display_name_utf8: new Array(displayLength).fill(65) },
        ]),
      ).not.toThrow();
    expect(() =>
      planModelVariantNameSearchInsertChunksV1([
        { ...row, display_name_utf8: new Array(801).fill(65) },
      ]),
    ).toThrow(ModelVariantNameSearchStagingError);
    for (const normalizedLength of [
      MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES - 1,
      MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
    ])
      expect(() =>
        planModelVariantNameSearchInsertChunksV1([
          {
            ...row,
            normalized_name_utf8: new Array(normalizedLength).fill(97),
          },
        ]),
      ).not.toThrow();
    expect(() =>
      planModelVariantNameSearchInsertChunksV1([
        {
          ...row,
          normalized_name_utf8: new Array(
            MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES + 1,
          ).fill(97),
        },
      ]),
    ).toThrow(ModelVariantNameSearchStagingError);
  });
});

describe("model/variant name BLOB staging writer", () => {
  it("writes fixed unhex/json_each SQL, reconciles, and proves forced-index queryability", async () => {
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(false)),
      (statements) => {
        expect(statements).toHaveLength(3);
        expect(statements[1]?.sql).toContain("FROM json_each(?1)");
        expect(statements[1]?.sql).toContain(
          "unhex(json_extract(payload.value, '$.display_name_utf8_hex'))",
        );
        expect(statements[1]?.values).toHaveLength(4);
        return Promise.resolve([
          result([{ clean: 1 }]),
          result(),
          result([{ verified: 1 }]),
        ]);
      },
      () => Promise.resolve(snapshot(true)),
      indexedProbe,
    );
    const applied = await applyModelVariantNameSearchStagingV1(
      fake.database,
      fixture.staging,
    );
    expect(applied).toMatchObject({
      outcome: "applied",
      publicationId: PUBLICATION_ID,
      documentCount: 1,
    });
    expect(() => {
      assertModelVariantNameSearchQueryableArtifactProofV3(
        applied.artifactProof,
      );
    }).not.toThrow();
    expect(fake.sessions).toEqual([
      "first-primary",
      "first-primary",
      "first-primary",
      "first-primary",
    ]);
  });

  it("returns idempotent success only after actual indexed match and miss probes", async () => {
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(true)),
      indexedProbe,
    );
    await expect(
      applyModelVariantNameSearchStagingV1(fake.database, fixture.staging),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("treats an exact empty projection as an idempotent assertion", async () => {
    const emptyProbe: Handler = (statements) => {
      expect(statements).toHaveLength(2);
      expect((statements[0]?.values[1] as ArrayBuffer).byteLength).toBe(0);
      expect((statements[1]?.values[1] as ArrayBuffer).byteLength).toBe(0);
      return Promise.resolve([result([]), result([])]);
    };
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(false, emptyFixture)),
      emptyProbe,
      () => Promise.resolve(snapshot(false, emptyFixture)),
      emptyProbe,
    );
    await expect(
      applyModelVariantNameSearchStagingV1(fake.database, emptyFixture.staging),
    ).resolves.toMatchObject({
      outcome: "idempotent_success",
      documentCount: 0,
    });
    await expect(
      applyModelVariantNameSearchStagingV1(fake.database, emptyFixture.staging),
    ).resolves.toMatchObject({
      outcome: "idempotent_success",
      documentCount: 0,
    });
    expect(fake.batches).toHaveLength(4);
  });

  it("fails closed on a bad indexed-match observation", async () => {
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(true)),
      () => Promise.resolve([result([]), result([])]),
    );
    await expect(
      applyModelVariantNameSearchStagingV1(fake.database, fixture.staging),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it("fails closed if the deterministic miss query leaks a row", async () => {
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(true)),
      () =>
        Promise.resolve([
          result([{ resource_id: fixture.persistence.rows[0]?.resource_id }]),
          result([{ resource_id: fixture.persistence.rows[0]?.resource_id }]),
        ]),
    );
    await expect(
      applyModelVariantNameSearchStagingV1(fake.database, fixture.staging),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it("classifies malformed, reordered, duplicate, and wrong-byte storage rows", async () => {
    const expected = twoDocumentFixture.persistence.rows;
    const first = expected[0];
    const second = expected[1];
    if (first === undefined || second === undefined)
      throw new Error("two-document fixture is incomplete");
    const cases: readonly Readonly<{
      rows: readonly unknown[];
      code: "integrity_failure" | "conflict";
    }>[] = [
      { rows: [{ ...first, extra: true }, second], code: "integrity_failure" },
      { rows: [second, first], code: "conflict" },
      { rows: [first, first], code: "conflict" },
      {
        rows: [{ ...first, normalized_name_utf8: [120] }, second],
        code: "conflict",
      },
    ];
    for (const testCase of cases) {
      const fake = fakeDatabase(() =>
        Promise.resolve([
          result([
            {
              state: "building",
              closure_hash: twoDocumentFixture.persistence.closureHash,
              staging_revision: twoDocumentFixture.persistence.stagingRevision,
              sealed: 0,
              eligible_document_count:
                twoDocumentFixture.persistence.documentCount,
            },
          ]),
          result([...testCase.rows]),
        ]),
      );
      await expect(
        applyModelVariantNameSearchStagingV1(
          fake.database,
          twoDocumentFixture.staging,
        ),
      ).rejects.toMatchObject({ code: testCase.code });
    }
  });

  it("reconciles a lost mutation response without repeating writes", async () => {
    const fake = fakeDatabase(
      () => Promise.resolve(snapshot(false)),
      () => Promise.reject(new Error("lost response")),
      () => Promise.resolve(snapshot(true)),
      indexedProbe,
    );
    await expect(
      applyModelVariantNameSearchStagingV1(fake.database, fixture.staging),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    expect(fake.batches).toHaveLength(4);
  });

  it("rejects non-nominal inputs before opening D1", async () => {
    const fake = fakeDatabase();
    await expect(
      applyModelVariantNameSearchStagingV1(fake.database, {}),
    ).rejects.toMatchObject({ code: "integrity_failure" });
    expect(fake.sessions).toEqual([]);
  });
});
