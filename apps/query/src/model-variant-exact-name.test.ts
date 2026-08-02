import { describe, expect, it } from "vitest";

import {
  canonicalizePublicationJson,
  hashPublicationResourceContent,
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UNICODE_SCALARS,
  MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
  normalizeExactSearchName,
} from "@quant-clarity/publication-core";

import {
  MODEL_VARIANT_EXACT_NAME_MAX_PAGE_SIZE,
  MODEL_VARIANT_EXACT_NAME_MAX_QUERY_BYTES,
  MODEL_VARIANT_EXACT_NAME_MAX_QUERY_UNICODE_SCALARS,
  MODEL_VARIANT_EXACT_NAME_MAX_RESOURCE_BYTES,
  MODEL_VARIANT_EXACT_NAME_MAX_TRANSFER_BYTES,
  MODEL_VARIANT_EXACT_NAME_SELECT_SQL,
  ModelVariantExactNameError,
  readModelVariantExactNamePage,
} from "./model-variant-exact-name.js";

const PUBLICATION_ID = "pub_11111111-1111-4111-8111-111111111111" as const;
const MODEL_ID = "mdl_00000001-0000-4000-8000-000000000001";
const VARIANT_ID = "var_00000001-0000-4000-8000-000000000001";
const FAMILY_ID = "fam_00000001-0000-4000-8000-000000000001";
const EVIDENCE_ID = "evd_00000001-0000-4000-8000-000000000001";
const GENERATED_AT = Date.parse("2026-08-02T12:00:00.000Z");
const OBSERVED_AT = new Date(GENERATED_AT).toISOString();
const utf8 = new TextEncoder();

const known = (value: unknown) => ({
  evidence_ids: [EVIDENCE_ID],
  observed_at: OBSERVED_AT,
  state: "known",
  value,
});

const unknown = () => ({
  evidence_ids: [],
  observed_at: null,
  state: "unknown",
  value: null,
});

const canonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const hotPublication = (publicationId: string = PUBLICATION_ID) => ({
  row_ordinal: 0,
  row_kind: "hot_publication",
  publication_id: publicationId,
  resource_type: null,
  resource_id: null,
  projection_version: null,
  projection_resource_content_hash: null,
  resource_content_hash: null,
  display_name_bytes_match: null,
  resource_json_bytes: 0,
  resource_json: null,
});

const fixtureRows = async (displayName: string, includeVariant = false) => {
  const common = {
    active_parameters: unknown(),
    architecture: unknown(),
    cataloged_provider_count: {
      derivation_version: "cataloged-provider-count@1",
      observed_at: OBSERVED_AT,
      value: 0,
    },
    checkpoints: [],
    context_window_tokens: unknown(),
    family_id: FAMILY_ID,
    last_model_data_refresh: known(OBSERVED_AT),
    license: unknown(),
    maximum_output_tokens: unknown(),
    modalities: unknown(),
    publisher: known("Fixture Publisher"),
    release_date: known("2026-08-02"),
    source_quantization: unknown(),
    source_weight_format: unknown(),
    status: known("active"),
    total_parameters: unknown(),
  };
  const resources = [
    {
      resourceType: "model" as const,
      resourceId: MODEL_ID,
      value: {
        ...common,
        authoritative_checkpoint_ids: [],
        display_name: known(displayName),
        model_id: MODEL_ID,
        slug: known("fixture-model"),
      },
    },
    ...(includeVariant
      ? [
          {
            resourceType: "variant" as const,
            resourceId: VARIANT_ID,
            value: {
              ...common,
              checkpoint_ids: [],
              display_name: known("Beta Variant"),
              model_id: MODEL_ID,
              selection_evidence: unknown(),
              slug: known("beta-variant"),
              variant_id: VARIANT_ID,
              variant_kind: known("publisher_variant"),
            },
          },
        ]
      : []),
  ];
  return Promise.all(
    resources.map(async (resource) => {
      const resourceJson = canonicalizePublicationJson(
        canonicalJson(resource.value),
        "object",
      );
      const contentHash = await hashPublicationResourceContent({
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        resourceJson,
      });
      return {
        row_ordinal: 1,
        row_kind: "candidate",
        publication_id: PUBLICATION_ID,
        resource_type: resource.resourceType,
        resource_id: resource.resourceId,
        projection_version: "model-variant-name@1" as const,
        projection_resource_content_hash: contentHash,
        resource_content_hash: contentHash,
        display_name_bytes_match: 1,
        resource_json_bytes: utf8.encode(resourceJson).byteLength,
        resource_json: resourceJson,
      };
    }),
  );
};

const sequencedId = (prefix: "evd" | "mdl", sequence: number): string =>
  `${prefix}_${sequence.toString(16).padStart(8, "0")}-0000-4000-8000-${sequence
    .toString(16)
    .padStart(12, "0")}`;

const rowFromResourceJson = async (
  resourceType: "model" | "variant",
  resourceId: string,
  resourceJson: string,
) => {
  const contentHash = await hashPublicationResourceContent({
    resourceType,
    resourceId,
    resourceJson,
  });
  return {
    row_ordinal: 1,
    row_kind: "candidate",
    publication_id: PUBLICATION_ID,
    resource_type: resourceType,
    resource_id: resourceId,
    projection_version: "model-variant-name@1" as const,
    projection_resource_content_hash: contentHash,
    resource_content_hash: contentHash,
    display_name_bytes_match: 1,
    resource_json_bytes: utf8.encode(resourceJson).byteLength,
    resource_json: resourceJson,
  };
};

const cloneModelRowIdentity = async (
  row: Awaited<ReturnType<typeof rowFromResourceJson>>,
  resourceId: string,
) => {
  const parsed = JSON.parse(row.resource_json) as Record<string, unknown>;
  return rowFromResourceJson(
    "model",
    resourceId,
    canonicalizePublicationJson(
      canonicalJson({ ...parsed, model_id: resourceId }),
      "object",
    ),
  );
};

const exactSizedModelRow = async (
  targetBytes: number,
): Promise<Awaited<ReturnType<typeof rowFromResourceJson>>> => {
  const [base] = await fixtureRows("Capacity Model");
  if (base === undefined) throw new Error("fixture row missing");
  const parsed = JSON.parse(base.resource_json) as Record<string, unknown>;
  const displayName = parsed.display_name as Record<string, unknown>;
  const publisher = parsed.publisher as Record<string, unknown>;
  const build = (evidenceCount: number, publisherLength: number): string =>
    canonicalJson({
      ...parsed,
      display_name: {
        ...displayName,
        evidence_ids: Array.from({ length: evidenceCount }, (_, index) =>
          sequencedId("evd", index + 1),
        ),
      },
      publisher: { ...publisher, value: "p".repeat(publisherLength) },
    });
  const minimum = build(1, 1);
  let evidenceCount = Math.max(
    1,
    Math.floor((targetBytes - utf8.encode(minimum).byteLength) / 43) + 1,
  );
  let resourceJson = build(evidenceCount, 1);
  while (utf8.encode(resourceJson).byteLength > targetBytes) {
    evidenceCount -= 1;
    resourceJson = build(evidenceCount, 1);
  }
  while (targetBytes - utf8.encode(resourceJson).byteLength > 199) {
    evidenceCount += 1;
    resourceJson = build(evidenceCount, 1);
  }
  const padding = targetBytes - utf8.encode(resourceJson).byteLength;
  resourceJson = build(evidenceCount, padding + 1);
  if (utf8.encode(resourceJson).byteLength !== targetBytes)
    throw new Error("exact-size fixture construction failed");
  return rowFromResourceJson("model", MODEL_ID, resourceJson);
};

class FakeDatabase {
  readonly calls: Readonly<{ sql: string; values: readonly unknown[] }>[] = [];

  constructor(private readonly result: unknown) {}

  asD1(): D1Database {
    return {
      prepare: (sql: string) =>
        ({
          bind: (...values: unknown[]) =>
            ({
              all: () => {
                this.calls.push({ sql, values });
                return Promise.resolve(this.result);
              },
            }) as D1PreparedStatement,
        }) as D1PreparedStatement,
    } as D1Database;
  }
}

const databaseWithRows = (rows: readonly unknown[]) =>
  new FakeDatabase({ success: true, results: rows, meta: {} });

const input = (
  query: string,
  overrides: Readonly<Record<string, unknown>> = {},
) => ({
  publicationId: PUBLICATION_ID,
  query,
  recordType: null,
  afterResourceId: null,
  limit: 20,
  ...overrides,
});

const expectIntegrityFailure = async (
  row: Readonly<Record<string, unknown>>,
  query: string,
) => {
  await expect(
    readModelVariantExactNamePage(
      databaseWithRows([hotPublication(), row]).asD1(),
      input(query),
    ),
  ).rejects.toMatchObject({ code: "integrity_failure" });
};

describe("model/variant exact-name D1 reader (SRCH-002, SRCH-006, SRCH-008, SRCH-009)", () => {
  it("binds normalized UTF-8 as a BLOB and rehydrates NUL-bearing canonical facts", async () => {
    const displayName = "Alpha\u0000Model";
    const rows = await fixtureRows(displayName);
    const database = databaseWithRows([hotPublication(), ...rows]);

    const page = await readModelVariantExactNamePage(
      database.asD1(),
      input(" ALPHA\u0000MODEL ", { limit: 5 }),
    );

    expect(page).toMatchObject({
      publicationId: PUBLICATION_ID,
      nextAfterResourceId: null,
      results: [
        {
          tier: 1,
          resourceType: "model",
          matchKind: "canonical_name",
          displayName: { state: "known", value: displayName },
          semanticDegraded: "disabled",
        },
      ],
    });
    const values = database.calls[0]?.values;
    expect(database.calls[0]?.sql).toBe(MODEL_VARIANT_EXACT_NAME_SELECT_SQL);
    expect(values?.[0]).toBe(PUBLICATION_ID);
    expect(values?.[1]).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(values?.[1] as ArrayBuffer))).toEqual(
      Array.from(utf8.encode(normalizeExactSearchName(" ALPHA\u0000MODEL "))),
    );
    expect(values?.slice(2)).toEqual([null, "", 1_000_000, 6]);
    expect(Object.keys(page.results[0] ?? {})).not.toContain(
      "display_name_utf8",
    );
    expect(Object.keys(page.results[0] ?? {})).not.toContain(
      "normalized_name_utf8",
    );
  });

  it("enforces raw scalar/UTF-8 ceilings and reaches the derived normalization scalar cap", async () => {
    const scalarCases = ["x".repeat(199), "x".repeat(200)];
    for (const query of scalarCases) {
      const rows = await fixtureRows(query);
      await expect(
        readModelVariantExactNamePage(
          databaseWithRows([hotPublication(), ...rows]).asD1(),
          input(query),
        ),
      ).resolves.toMatchObject({
        results: [{ displayName: { value: query } }],
      });
    }

    const belowByteLimit = `${"😀".repeat(199)}\u0800`;
    const atByteLimit = "😀".repeat(200);
    expect(utf8.encode(belowByteLimit)).toHaveLength(
      MODEL_VARIANT_EXACT_NAME_MAX_QUERY_BYTES - 1,
    );
    expect(utf8.encode(atByteLimit)).toHaveLength(
      MODEL_VARIANT_EXACT_NAME_MAX_QUERY_BYTES,
    );
    for (const query of [belowByteLimit, atByteLimit]) {
      const rows = await fixtureRows(query);
      await expect(
        readModelVariantExactNamePage(
          databaseWithRows([hotPublication(), ...rows]).asD1(),
          input(query),
        ),
      ).resolves.toMatchObject({
        results: [{ displayName: { value: query } }],
      });
    }

    const database = databaseWithRows([]);
    for (const query of [
      "x".repeat(MODEL_VARIANT_EXACT_NAME_MAX_QUERY_UNICODE_SCALARS + 1),
      `${atByteLimit}x`,
    ])
      await expect(
        readModelVariantExactNamePage(database.asD1(), input(query)),
      ).rejects.toMatchObject({ code: "invalid_input" });
    expect(database.calls).toEqual([]);

    const maximumExpansion = "\uFDFA".repeat(200);
    const normalized = normalizeExactSearchName(maximumExpansion);
    expect(Array.from(normalized)).toHaveLength(
      MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UNICODE_SCALARS,
    );
    expect(utf8.encode(normalized).byteLength).toBe(6_600);
    expect(utf8.encode(normalized).byteLength).toBeLessThan(
      MODEL_VARIANT_NAME_SEARCH_MAX_NORMALIZED_NAME_UTF8_BYTES,
    );
    const expansionRows = await fixtureRows(maximumExpansion);
    await expect(
      readModelVariantExactNamePage(
        databaseWithRows([hotPublication(), ...expansionRows]).asD1(),
        input(maximumExpansion),
      ),
    ).resolves.toMatchObject({ results: [{ resourceId: MODEL_ID }] });
  });

  it("retains model/variant collisions with stable resource-ID pagination", async () => {
    const rows = await fixtureRows("Beta Variant", true);
    expect(rows.map((row) => row.resource_type)).toEqual(["model", "variant"]);
    const firstDatabase = databaseWithRows([hotPublication(), ...rows]);
    const first = await readModelVariantExactNamePage(
      firstDatabase.asD1(),
      input("beta variant", { limit: 1 }),
    );
    expect(first.results.map((result) => result.resourceType)).toEqual([
      "model",
    ]);
    expect(first.nextAfterResourceId).toBe(rows[0]?.resource_id);

    const secondDatabase = databaseWithRows([hotPublication(), rows[1]]);
    const second = await readModelVariantExactNamePage(
      secondDatabase.asD1(),
      input("beta variant", {
        afterResourceId: first.nextAfterResourceId,
        limit: 1,
      }),
    );
    expect(second.results).toMatchObject([
      { resourceType: "variant", matchKind: "canonical_name" },
    ]);
    expect(second.nextAfterResourceId).toBeNull();
    expect(secondDatabase.calls[0]?.values[3]).toBe(rows[0]?.resource_id);
  });

  it("paginates every row without duplicate or omission", async () => {
    const [base] = await fixtureRows("Paged Model");
    if (base === undefined) throw new Error("fixture row missing");
    const rows = [base];
    for (let sequence = 2; sequence <= 5; sequence += 1)
      rows.push(
        await cloneModelRowIdentity(base, sequencedId("mdl", sequence)),
      );

    const observed: string[] = [];
    let afterResourceId: string | null = null;
    do {
      const start =
        afterResourceId === null
          ? 0
          : rows.findIndex((row) => row.resource_id === afterResourceId) + 1;
      const database = databaseWithRows([
        hotPublication(),
        ...rows.slice(start, start + 3),
      ]);
      const page = await readModelVariantExactNamePage(
        database.asD1(),
        input("Paged Model", { afterResourceId, limit: 2 }),
      );
      observed.push(...page.results.map((result) => result.resourceId));
      expect(database.calls[0]?.values[3]).toBe(afterResourceId ?? "");
      afterResourceId = page.nextAfterResourceId;
    } while (afterResourceId !== null);

    const expected = rows.map((row) => row.resource_id);
    expect(observed).toEqual(expected);
    expect(new Set(observed).size).toBe(expected.length);
  });

  it("applies the closed all/model/variant selector without changing tier order", async () => {
    const rows = await fixtureRows("Beta Variant", true);
    for (const [recordType, selectedRows, expectedTypes] of [
      [null, rows, ["model", "variant"]],
      ["model", [rows[0]], ["model"]],
      ["variant", [rows[1]], ["variant"]],
    ] as const) {
      const database = databaseWithRows([
        hotPublication(),
        ...selectedRows.filter((row) => row !== undefined),
      ]);
      const page = await readModelVariantExactNamePage(
        database.asD1(),
        input("Beta Variant", { recordType }),
      );
      expect(page.results.map((result) => result.resourceType)).toEqual(
        expectedTypes,
      );
      expect(database.calls[0]?.values[2]).toBe(recordType);
    }

    const contradictoryDatabase = databaseWithRows([hotPublication(), rows[1]]);
    await expect(
      readModelVariantExactNamePage(
        contradictoryDatabase.asD1(),
        input("Beta Variant", { recordType: "model" }),
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it("rejects invalid and unbounded inputs before acquiring D1", async () => {
    const database = databaseWithRows([]);
    const invalidInputs: unknown[] = [
      input("alpha", { publicationId: "pub_invalid" }),
      input(" "),
      input("x".repeat(MODEL_VARIANT_EXACT_NAME_MAX_QUERY_UNICODE_SCALARS + 1)),
      input("\ud800"),
      input("alpha", { extra: true }),
      input("alpha", { afterResourceId: "mdl_invalid" }),
      input("alpha", {
        recordType: "model",
        afterResourceId: "var_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      input("alpha", {
        recordType: "variant",
        afterResourceId: "mdl_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      input("alpha", { recordType: "provider" }),
      input("alpha", { limit: 0 }),
      input("alpha", {
        limit: MODEL_VARIANT_EXACT_NAME_MAX_PAGE_SIZE + 1,
      }),
      { publicationId: PUBLICATION_ID, query: "alpha" },
      Object.assign(Object.create({ inherited: true }), input("alpha")),
    ];
    for (const input of invalidInputs)
      await expect(
        readModelVariantExactNamePage(database.asD1(), input as never),
      ).rejects.toEqual(new ModelVariantExactNameError("invalid_input"));
    expect(database.calls).toEqual([]);
  });

  it("fails closed on malformed D1 envelopes, sentinels, rows, and ordering", async () => {
    const [validRow] = await fixtureRows("Alpha Model");
    if (validRow === undefined) throw new Error("fixture row missing");
    for (const result of [
      { success: false, results: [] },
      { success: true, results: null },
      null,
    ])
      await expect(
        readModelVariantExactNamePage(
          new FakeDatabase(result).asD1(),
          input("Alpha Model"),
        ),
      ).rejects.toMatchObject({ code: "read_failure" });
    await expect(
      readModelVariantExactNamePage(
        databaseWithRows(new Array(24).fill(validRow)).asD1(),
        input("Alpha Model"),
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    for (const rows of [
      [validRow],
      [hotPublication(), hotPublication(), validRow],
      [hotPublication("pub_22222222-2222-4222-8222-222222222222"), validRow],
      [hotPublication(), { ...validRow, extra: true }],
      [hotPublication(), validRow, validRow],
      [
        hotPublication(),
        {
          ...validRow,
          resource_id: "var_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      ],
    ])
      await expect(
        readModelVariantExactNamePage(
          databaseWithRows(rows).asD1(),
          input("Alpha Model"),
        ),
      ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it("rejects corrupt lookahead and wrong candidate publication/projection metadata", async () => {
    const rows = await fixtureRows("Beta Variant", true);
    const first = rows[0];
    const lookahead = rows[1];
    if (first === undefined || lookahead === undefined)
      throw new Error("collision fixture is incomplete");
    await expect(
      readModelVariantExactNamePage(
        databaseWithRows([
          hotPublication(),
          first,
          { ...lookahead, display_name_bytes_match: 0 },
        ]).asD1(),
        input("Beta Variant", { limit: 1 }),
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    for (const row of [
      { ...first, projection_version: "model-variant-name@2" },
      {
        ...first,
        publication_id: "pub_22222222-2222-4222-8222-222222222222",
      },
    ])
      await expectIntegrityFailure(row, "Beta Variant");
  });

  it("enforces the canonical-resource and aggregate-transfer byte ceilings", async () => {
    const belowResourceLimit = await exactSizedModelRow(
      MODEL_VARIANT_EXACT_NAME_MAX_RESOURCE_BYTES - 1,
    );
    const atResourceLimit = await exactSizedModelRow(
      MODEL_VARIANT_EXACT_NAME_MAX_RESOURCE_BYTES,
    );
    for (const row of [belowResourceLimit, atResourceLimit])
      await expect(
        readModelVariantExactNamePage(
          databaseWithRows([hotPublication(), row]).asD1(),
          input("Capacity Model"),
        ),
      ).resolves.toMatchObject({ results: [{ resourceId: MODEL_ID }] });

    await expectIntegrityFailure(
      {
        ...atResourceLimit,
        resource_json_bytes: MODEL_VARIANT_EXACT_NAME_MAX_RESOURCE_BYTES + 1,
        resource_json: `${atResourceLimit.resource_json} `,
      },
      "Capacity Model",
    );

    const atTransferLimit = [];
    for (let sequence = 1; sequence <= 21; sequence += 1)
      atTransferLimit.push(
        sequence === 1
          ? atResourceLimit
          : await cloneModelRowIdentity(
              atResourceLimit,
              sequencedId("mdl", sequence),
            ),
      );
    const belowTransferLimit = [
      ...atTransferLimit.slice(0, -1),
      await cloneModelRowIdentity(
        belowResourceLimit,
        sequencedId("mdl", atTransferLimit.length),
      ),
    ];
    expect(
      belowTransferLimit.reduce(
        (total, row) => total + row.resource_json_bytes,
        0,
      ),
    ).toBe(MODEL_VARIANT_EXACT_NAME_MAX_TRANSFER_BYTES - 1);
    expect(
      atTransferLimit.reduce(
        (total, row) => total + row.resource_json_bytes,
        0,
      ),
    ).toBe(MODEL_VARIANT_EXACT_NAME_MAX_TRANSFER_BYTES);
    for (const rows of [belowTransferLimit, atTransferLimit]) {
      const page = await readModelVariantExactNamePage(
        databaseWithRows([hotPublication(), ...rows]).asD1(),
        input("Capacity Model"),
      );
      expect(page.results.map((result) => result.resourceId)).toContain(
        MODEL_ID,
      );
      expect(page.nextAfterResourceId).toBe(sequencedId("mdl", 20));
    }

    const oversizedLookahead = atTransferLimit.at(-1);
    if (oversizedLookahead === undefined)
      throw new Error("aggregate fixture lacks lookahead");
    await expect(
      readModelVariantExactNamePage(
        databaseWithRows([
          hotPublication(),
          ...atTransferLimit.slice(0, -1),
          {
            ...oversizedLookahead,
            resource_json_bytes: oversizedLookahead.resource_json_bytes + 1,
            resource_json: `${oversizedLookahead.resource_json} `,
          },
        ]).asD1(),
        input("Capacity Model"),
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  }, 30_000);

  it("snapshots hostile top-level, row, and result-array properties once", async () => {
    const [validRow] = await fixtureRows("Alpha Model");
    if (validRow === undefined) throw new Error("fixture row missing");
    let inputReads = 0;
    const hostileInput = input("Alpha Model");
    Object.defineProperty(hostileInput, "query", {
      enumerable: true,
      get: () => {
        inputReads += 1;
        return inputReads === 1 ? "Alpha Model" : "Different Model";
      },
    });
    let rowReads = 0;
    const hostileRow = new Proxy(validRow, {
      get(target, property, receiver) {
        if (property === "resource_json") rowReads += 1;
        return rowReads <= 1 || property !== "resource_json"
          ? (Reflect.get(target, property, receiver) as unknown)
          : "{";
      },
    });
    let lengthReads = 0;
    const hostileResults = new Proxy([hotPublication(), hostileRow], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 2 : 10_000;
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    await expect(
      readModelVariantExactNamePage(
        new FakeDatabase({ success: true, results: hostileResults }).asD1(),
        hostileInput,
      ),
    ).resolves.toMatchObject({ results: [{ resourceId: MODEL_ID }] });
    expect({ inputReads, rowReads, lengthReads }).toEqual({
      inputReads: 1,
      rowReads: 1,
      lengthReads: 1,
    });
  });

  it("rejects canonical identity, display-byte, byte-count, and hash drift", async () => {
    const [validRow] = await fixtureRows("Alpha Model");
    if (validRow === undefined) throw new Error("fixture row missing");
    await expectIntegrityFailure(
      { ...validRow, display_name_bytes_match: 0 },
      "Alpha Model",
    );
    await expectIntegrityFailure(
      {
        ...validRow,
        projection_resource_content_hash: `sha256:${"0".repeat(64)}`,
      },
      "Alpha Model",
    );
    await expectIntegrityFailure(
      { ...validRow, resource_json_bytes: validRow.resource_json_bytes + 1 },
      "Alpha Model",
    );
    await expectIntegrityFailure(
      { ...validRow, resource_json: "{" },
      "Alpha Model",
    );
    const parsed = JSON.parse(validRow.resource_json) as Record<
      string,
      unknown
    >;
    const changedJson = canonicalizePublicationJson(
      canonicalJson({
        ...parsed,
        model_id: "mdl_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      "object",
    );
    const changedHash = await hashPublicationResourceContent({
      resourceType: "model",
      resourceId: "mdl_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      resourceJson: changedJson,
    });
    await expectIntegrityFailure(
      {
        ...validRow,
        projection_resource_content_hash: changedHash,
        resource_content_hash: changedHash,
        resource_json_bytes: utf8.encode(changedJson).byteLength,
        resource_json: changedJson,
      },
      "Alpha Model",
    );
  });

  it("rejects invalid Model/Variant facts, timestamps, evidence, and recomputed hashes", async () => {
    const [modelRow] = await fixtureRows("Alpha Model");
    const variantRows = await fixtureRows("Beta Variant", true);
    const variantRow = variantRows.find(
      (row) => row.resource_type === "variant",
    );
    if (modelRow === undefined || variantRow === undefined)
      throw new Error("contract fixture is incomplete");

    const model = JSON.parse(modelRow.resource_json) as Record<string, unknown>;
    const displayName = model.display_name as Record<string, unknown>;
    for (const replacement of [
      {
        display_name: {
          ...displayName,
          observed_at: "2026-02-31T00:00:00.000Z",
        },
      },
      { display_name: { ...displayName, evidence_ids: [] } },
    ]) {
      const resourceJson = canonicalizePublicationJson(
        canonicalJson({ ...model, ...replacement }),
        "object",
      );
      await expectIntegrityFailure(
        await rowFromResourceJson("model", MODEL_ID, resourceJson),
        "Alpha Model",
      );
    }

    await expectIntegrityFailure(
      {
        ...modelRow,
        resource_content_hash: `sha256:${"g".repeat(64)}`,
      },
      "Alpha Model",
    );
    const changedJson = canonicalizePublicationJson(
      canonicalJson({ ...model, publisher: known("Changed Publisher") }),
      "object",
    );
    await expectIntegrityFailure(
      {
        ...modelRow,
        resource_json_bytes: utf8.encode(changedJson).byteLength,
        resource_json: changedJson,
      },
      "Alpha Model",
    );

    const variant = JSON.parse(variantRow.resource_json) as Record<
      string,
      unknown
    >;
    const { variant_kind: omittedVariantKind, ...invalidVariant } = variant;
    expect(omittedVariantKind).toBeDefined();
    const invalidVariantJson = canonicalizePublicationJson(
      canonicalJson(invalidVariant),
      "object",
    );
    await expectIntegrityFailure(
      await rowFromResourceJson("variant", VARIANT_ID, invalidVariantJson),
      "Beta Variant",
    );
  });

  it("revalidates default active and known-display eligibility from canonical JSON", async () => {
    const [validRow] = await fixtureRows("Alpha Model");
    if (validRow === undefined) throw new Error("fixture row missing");
    const parsed = JSON.parse(validRow.resource_json) as Record<
      string,
      unknown
    >;
    for (const replacement of [
      {
        status: {
          ...(parsed.status as Record<string, unknown>),
          value: "inactive",
        },
      },
      {
        display_name: {
          evidence_ids: [],
          observed_at: null,
          state: "unknown",
          value: null,
        },
      },
    ]) {
      const resourceJson = canonicalizePublicationJson(
        canonicalJson({ ...parsed, ...replacement }),
        "object",
      );
      const contentHash = await hashPublicationResourceContent({
        resourceType: "model",
        resourceId: validRow.resource_id,
        resourceJson,
      });
      await expectIntegrityFailure(
        {
          ...validRow,
          projection_resource_content_hash: contentHash,
          resource_content_hash: contentHash,
          resource_json_bytes: utf8.encode(resourceJson).byteLength,
          resource_json: resourceJson,
        },
        "Alpha Model",
      );
    }
  });

  it("uses one fixed bounded SELECT with the exact named index and no mutation surface", () => {
    expect(MODEL_VARIANT_EXACT_NAME_SELECT_SQL).toMatch(/^\s*WITH\b/u);
    expect(MODEL_VARIANT_EXACT_NAME_SELECT_SQL).toContain(
      "INDEXED BY publication_model_variant_name_exact_idx",
    );
    expect(MODEL_VARIANT_EXACT_NAME_SELECT_SQL).toContain(
      "document.normalized_name_utf8 = ?2",
    );
    expect(MODEL_VARIANT_EXACT_NAME_SELECT_SQL).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH)\b/iu,
    );
    expect(MODEL_VARIANT_EXACT_NAME_SELECT_SQL).not.toContain("console.");
  });
});
