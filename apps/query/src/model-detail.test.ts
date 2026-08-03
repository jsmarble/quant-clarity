import { describe, expect, it } from "vitest";

import {
  canonicalizePublicationJson,
  hashPublicationResourceContent,
} from "@quant-clarity/publication-core";

import {
  MODEL_DETAIL_MAX_RESOURCE_BYTES,
  MODEL_DETAIL_SELECT_SQL,
  readModelDetailV1,
} from "./model-detail.js";

const PUBLICATION_ID = "pub_11111111-1111-4111-8111-111111111111";
const MODEL_ID = "mdl_00000001-0000-4000-8000-000000000001";
const OTHER_MODEL_ID = "mdl_00000002-0000-4000-8000-000000000002";
const FAMILY_ID = "fam_00000001-0000-4000-8000-000000000001";
const EVIDENCE_ID = "evd_00000001-0000-4000-8000-000000000001";
const OBSERVED_AT = "2026-08-02T12:00:00.000Z";
const SCHEMA_VERSION = "1.11.0";
const HORIZON = Date.parse("2026-08-02T12:15:00.000Z");
const UTF8 = new TextEncoder();

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

const canonicalJsonValue = (value: unknown): string => {
  if (value === null) return "null";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJsonValue(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(record[key])}`)
    .join(",")}}`;
};

const modelJson = (modelId = MODEL_ID, status = "inactive"): string =>
  canonicalizePublicationJson(
    canonicalJsonValue({
      active_parameters: unknown(),
      architecture: unknown(),
      authoritative_checkpoint_ids: [],
      cataloged_provider_count: {
        derivation_version: "cataloged-provider-count@1",
        observed_at: OBSERVED_AT,
        value: 0,
      },
      checkpoints: [],
      context_window_tokens: unknown(),
      display_name: known("Retained Fixture Model"),
      family_id: FAMILY_ID,
      last_model_data_refresh: known(OBSERVED_AT),
      license: unknown(),
      maximum_output_tokens: unknown(),
      modalities: unknown(),
      model_id: modelId,
      publisher: known("Fixture Publisher"),
      release_date: known("2026-08-02"),
      slug: known("retained-fixture-model"),
      source_quantization: unknown(),
      source_weight_format: unknown(),
      status: known(status),
      total_parameters: unknown(),
    }),
    "object",
  );

const sentinel = (
  publicationId = PUBLICATION_ID,
  schemaVersion = SCHEMA_VERSION,
) => ({
  content_hash: null,
  model_id: null,
  publication_id: publicationId,
  resource_json: null,
  resource_json_bytes: 0,
  row_kind: "hot_publication",
  row_ordinal: 0,
  schema_version: schemaVersion,
});

const modelRow = async (
  overrides: Readonly<Record<string, unknown>> = {},
  json = modelJson(),
) => ({
  content_hash: await hashPublicationResourceContent({
    resourceType: "model",
    resourceId: MODEL_ID,
    resourceJson: json,
  }),
  model_id: MODEL_ID,
  publication_id: PUBLICATION_ID,
  resource_json: json,
  resource_json_bytes: UTF8.encode(json).byteLength,
  row_kind: "model",
  row_ordinal: 1,
  schema_version: SCHEMA_VERSION,
  ...overrides,
});

const input = () => ({
  audience: "quantclarity-catalog-query-v1",
  bookmark: "bookmark-after-v2-resolution",
  environment: "local",
  envelope: {
    audience: "quantclarity-catalog-query-v1",
    continuation: null,
    environment: "local",
    filters: {},
    limit: 25,
    operation: {
      identifier: MODEL_ID,
      kind: "detail",
      resourceType: "model",
    },
    publicationId: PUBLICATION_ID,
    searchPlan: null,
    sort: ["name", "stable_id"],
    version: 1,
  },
  requiredAvailableUntilMs: HORIZON,
  version: 1,
});

class FakeDatabase {
  readonly calls: { bookmark: string; sql: string; values: unknown[] }[] = [];

  constructor(
    private readonly rows: readonly unknown[],
    private readonly success = true,
    private readonly rejects = false,
  ) {}

  asD1(): D1Database {
    return {
      withSession: (bookmark: string) =>
        ({
          prepare: (sql: string) =>
            ({
              bind: (...values: unknown[]) =>
                ({
                  all: () => {
                    this.calls.push({ bookmark, sql, values });
                    if (this.rejects) return Promise.reject(new Error("D1"));
                    return Promise.resolve({
                      meta: {},
                      results: this.rows,
                      success: this.success,
                    });
                  },
                }) as D1PreparedStatement,
            }) as D1PreparedStatement,
        }) as D1DatabaseSession,
    } as D1Database;
  }
}

describe("bounded stable-ID Model detail reader", () => {
  it("uses one bookmark-continuous fixed PK read and returns inactive canonical Models", async () => {
    const row = await modelRow();
    const database = new FakeDatabase([sentinel(), row]);

    const outcome = await readModelDetailV1(database.asD1(), "local", input());

    expect(outcome).toMatchObject({
      outcome: "model",
      model: { model_id: MODEL_ID, status: { value: "inactive" } },
      publicationId: PUBLICATION_ID,
      schemaVersion: SCHEMA_VERSION,
    });
    expect(database.calls).toEqual([
      {
        bookmark: "bookmark-after-v2-resolution",
        sql: MODEL_DETAIL_SELECT_SQL,
        values: [
          PUBLICATION_ID,
          HORIZON,
          MODEL_ID,
          MODEL_DETAIL_MAX_RESOURCE_BYTES,
        ],
      },
    ]);
    expect(MODEL_DETAIL_SELECT_SQL).toContain(
      "resource.publication_id = eligible.publication_id",
    );
    expect(MODEL_DETAIL_SELECT_SQL).toContain(
      "seal.closure_hash = publication.closure_hash",
    );
    expect(MODEL_DETAIL_SELECT_SQL).toContain(
      "resource.resource_type = 'model'",
    );
    expect(MODEL_DETAIL_SELECT_SQL).toContain("resource.resource_id = ?3");
    expect(MODEL_DETAIL_SELECT_SQL).toMatch(/LIMIT 2\s*$/u);
    expect(MODEL_DETAIL_SELECT_SQL).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|UPSERT|PRAGMA|CREATE|DROP|ALTER)\b/iu,
    );
  });

  it("returns a closed absence only when the retained-hot sentinel remains", async () => {
    const database = new FakeDatabase([sentinel()]);
    await expect(
      readModelDetailV1(database.asD1(), "local", input()),
    ).resolves.toEqual({
      outcome: "not_found",
      publicationId: PUBLICATION_ID,
      schemaVersion: SCHEMA_VERSION,
    });
  });

  it("fails closed when publication eligibility or row cardinality changes", async () => {
    for (const rows of [
      [],
      [await modelRow()],
      [sentinel("pub_22222222-2222-4222-8222-222222222222")],
      [sentinel(PUBLICATION_ID, "1.11.0-rc.1")],
      [sentinel(PUBLICATION_ID, "1.11.0+build")],
      [sentinel(), sentinel()],
      [sentinel(), await modelRow(), await modelRow()],
    ]) {
      await expect(
        readModelDetailV1(new FakeDatabase(rows).asD1(), "local", input()),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    }
  });

  it("rejects malformed, oversized, mismatched, and hash-invalid resources", async () => {
    const mismatchedJson = modelJson(OTHER_MODEL_ID);
    const mismatched = await modelRow({}, mismatchedJson);
    for (const row of [
      await modelRow({ resource_json: "{" }),
      await modelRow({
        resource_json: null,
        resource_json_bytes: MODEL_DETAIL_MAX_RESOURCE_BYTES + 1,
      }),
      await modelRow({ content_hash: `sha256:${"0".repeat(64)}` }),
      mismatched,
      await modelRow({ model_id: OTHER_MODEL_ID }),
      await modelRow({
        publication_id: "pub_22222222-2222-4222-8222-222222222222",
      }),
      await modelRow({ schema_version: "not-semver" }),
      await modelRow({ schema_version: "1.10.0" }),
    ]) {
      await expect(
        readModelDetailV1(
          new FakeDatabase([sentinel(), row]).asD1(),
          "local",
          input(),
        ),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    }
  });

  it("rejects hostile input shapes without invoking accessors or touching D1", async () => {
    let invoked = false;
    const hostile = input() as Record<string, unknown>;
    Object.defineProperty(hostile, "bookmark", {
      enumerable: true,
      get() {
        invoked = true;
        return "bookmark-after-v2-resolution";
      },
    });
    const database = new FakeDatabase([]);

    await expect(
      readModelDetailV1(database.asD1(), "local", hostile),
    ).resolves.toEqual({ outcome: "integrity_failure" });
    expect(invoked).toBe(false);
    expect(database.calls).toEqual([]);
  });

  it("rejects hostile D1 row accessors without invoking them", async () => {
    let invoked = false;
    const hostile = await modelRow();
    Object.defineProperty(hostile, "content_hash", {
      enumerable: true,
      get() {
        invoked = true;
        return `sha256:${"0".repeat(64)}`;
      },
    });

    await expect(
      readModelDetailV1(
        new FakeDatabase([sentinel(), hostile]).asD1(),
        "local",
        input(),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });
    expect(invoked).toBe(false);
  });

  it("closes wrong audience, environment, envelope, and unconstrained bookmarks", async () => {
    const cases = [
      { ...input(), audience: "other" },
      { ...input(), environment: "preview" },
      { ...input(), bookmark: "first-primary" },
      {
        ...input(),
        envelope: {
          ...input().envelope,
          operation: {
            identifier: MODEL_ID,
            kind: "detail",
            resourceType: "provider",
          },
        },
      },
      { ...input(), requiredAvailableUntilMs: -1 },
    ];
    for (const value of cases) {
      const database = new FakeDatabase([]);
      await expect(
        readModelDetailV1(database.asD1(), "local", value),
      ).resolves.toEqual({ outcome: "integrity_failure" });
      expect(database.calls).toEqual([]);
    }
  });

  it("maps D1 failures and malformed D1 result envelopes to read failure", async () => {
    await expect(
      readModelDetailV1(new FakeDatabase([], false).asD1(), "local", input()),
    ).resolves.toEqual({ outcome: "read_failure" });
    await expect(
      readModelDetailV1(
        new FakeDatabase([], true, true).asD1(),
        "local",
        input(),
      ),
    ).resolves.toEqual({ outcome: "read_failure" });
  });
});
