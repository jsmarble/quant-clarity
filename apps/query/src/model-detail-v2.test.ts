import { describe, expect, it } from "vitest";

import {
  canonicalizePublicationJson,
  hashPublicationResourceContent,
} from "@quant-clarity/publication-core";

import {
  MODEL_DETAIL_MAX_RESOURCE_BYTES,
  MODEL_DETAIL_V2_SELECT_SQL,
  readModelDetailV2,
} from "./model-detail.js";

const PUBLICATION_ID = "pub_11111111-1111-4111-8111-111111111111";
const MODEL_ID = "mdl_00000001-0000-4000-8000-000000000001";
const OTHER_MODEL_ID = "mdl_00000002-0000-4000-8000-000000000002";
const FAMILY_ID = "fam_00000001-0000-4000-8000-000000000001";
const EVIDENCE_ID = "evd_00000001-0000-4000-8000-000000000001";
const OBSERVED_AT = "2026-08-03T12:00:00.000Z";
const HORIZON = Date.parse("2026-08-03T12:15:00.000Z");
const CANONICAL_SLUG = "current-model-slug";
const HISTORICAL_SLUG = "retired-secret-looking-slug";
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

const modelJson = (
  modelId = MODEL_ID,
  canonicalSlug = CANONICAL_SLUG,
): string =>
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
      display_name: known("V2 Fixture Model"),
      family_id: FAMILY_ID,
      last_model_data_refresh: known(OBSERVED_AT),
      license: unknown(),
      maximum_output_tokens: unknown(),
      modalities: unknown(),
      model_id: modelId,
      publisher: known("Fixture Publisher"),
      release_date: known("2026-08-03"),
      slug: known(canonicalSlug),
      source_quantization: unknown(),
      source_weight_format: unknown(),
      status: known("inactive"),
      total_parameters: unknown(),
    }),
    "object",
  );

const authority = (
  matchedMappingCount: 0 | 1,
  requestedModelCount: 0 | 1,
  overrides: Readonly<Record<string, unknown>> = {},
) => ({
  canonical_slug: null,
  content_hash: null,
  matched_mapping_count: matchedMappingCount,
  matched_resolution: null,
  matched_slug: null,
  model_id: null,
  projection_version: null,
  publication_id: PUBLICATION_ID,
  requested_model_count: requestedModelCount,
  resource_json: null,
  resource_json_bytes: 0,
  row_kind: "slug_authority",
  row_ordinal: 0,
  schema_version: "1.6.0",
  serving_schema_version: "1.13.0",
  ...overrides,
});

const modelRow = async (
  resolution: "current" | "historical" = "current",
  overrides: Readonly<Record<string, unknown>> = {},
  json = modelJson(),
) => ({
  canonical_slug: CANONICAL_SLUG,
  content_hash: await hashPublicationResourceContent({
    resourceType: "model",
    resourceId: MODEL_ID,
    resourceJson: json,
  }),
  matched_mapping_count: null,
  matched_resolution: resolution,
  matched_slug: resolution === "historical" ? HISTORICAL_SLUG : CANONICAL_SLUG,
  model_id: MODEL_ID,
  projection_version: "model-slug@1",
  publication_id: PUBLICATION_ID,
  requested_model_count: null,
  resource_json: json,
  resource_json_bytes: UTF8.encode(json).byteLength,
  row_kind: "model",
  row_ordinal: 1,
  schema_version: "1.6.0",
  serving_schema_version: "1.13.0",
  ...overrides,
});

const input = (
  identifier = MODEL_ID,
  lookup: Readonly<{ kind: "slug" | "stable_id"; value: string }> = {
    kind: identifier === MODEL_ID ? "stable_id" : "slug",
    value: identifier,
  },
) => ({
  audience: "quantclarity-catalog-query-v1",
  bookmark: "bookmark-after-v2-resolution",
  environment: "local",
  lookup,
  envelope: {
    audience: "quantclarity-catalog-query-v1",
    continuation: null,
    environment: "local",
    filters: {},
    limit: 25,
    operation: { identifier, kind: "detail", resourceType: "model" },
    publicationId: PUBLICATION_ID,
    searchPlan: null,
    sort: ["name", "stable_id"],
    version: 1,
  },
  requiredAvailableUntilMs: HORIZON,
  version: 2,
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

describe("schema-1.13 Model stable-ID and slug detail reader", () => {
  it.each([
    {
      identifier: MODEL_ID,
      identifierKind: "stable_id",
      matchedBy: "stable_id",
      resolution: "current" as const,
      requestedModelCount: 1 as const,
    },
    {
      identifier: CANONICAL_SLUG,
      identifierKind: "slug",
      matchedBy: "current_slug",
      resolution: "current" as const,
      requestedModelCount: 0 as const,
    },
    {
      identifier: HISTORICAL_SLUG,
      identifierKind: "slug",
      matchedBy: "historical_slug",
      resolution: "historical" as const,
      requestedModelCount: 0 as const,
    },
  ])(
    "returns canonical Model provenance for $matchedBy",
    async ({
      identifier,
      identifierKind,
      matchedBy,
      resolution,
      requestedModelCount,
    }) => {
      const database = new FakeDatabase([
        authority(1, requestedModelCount),
        await modelRow(resolution),
      ]);

      const outcome = await readModelDetailV2(
        database.asD1(),
        "local",
        input(identifier),
      );

      expect(outcome).toMatchObject({
        outcome: "model",
        lookupProvenance: {
          matchedBy,
          canonicalSlug: CANONICAL_SLUG,
          projectionVersion: "model-slug@1",
        },
        model: { model_id: MODEL_ID, slug: { value: CANONICAL_SLUG } },
        publicationId: PUBLICATION_ID,
        schemaVersion: "1.6.0",
      });
      expect(JSON.stringify(outcome)).not.toContain(
        identifier === HISTORICAL_SLUG ? HISTORICAL_SLUG : "never-present",
      );
      expect(database.calls).toEqual([
        {
          bookmark: "bookmark-after-v2-resolution",
          sql: MODEL_DETAIL_V2_SELECT_SQL,
          values: [
            PUBLICATION_ID,
            HORIZON,
            identifierKind,
            identifier,
            MODEL_DETAIL_MAX_RESOURCE_BYTES,
          ],
        },
      ]);
    },
  );

  it("uses one fixed SELECT-only authority query and both forced slug indexes", () => {
    expect(MODEL_DETAIL_V2_SELECT_SQL).toContain(
      "INDEXED BY publication_model_slug_exact_idx",
    );
    expect(MODEL_DETAIL_V2_SELECT_SQL).toContain(
      "INDEXED BY publication_model_slug_current_model_idx",
    );
    expect(MODEL_DETAIL_V2_SELECT_SQL).toContain(
      "INDEXED BY publication_resource_lookup_idx",
    );
    expect(MODEL_DETAIL_V2_SELECT_SQL).toContain(
      "proof.staging_revision = seal.staging_revision",
    );
    expect(MODEL_DETAIL_V2_SELECT_SQL).toContain(
      "proof.base_bundle_hash = seal.bundle_hash",
    );
    expect(MODEL_DETAIL_V2_SELECT_SQL).toContain(
      "schema.schema_version = '1.13.0'",
    );
    expect(MODEL_DETAIL_V2_SELECT_SQL).toMatch(/LIMIT 2\s*$/u);
    expect(MODEL_DETAIL_V2_SELECT_SQL).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|UPSERT|PRAGMA|CREATE|DROP|ALTER)\b/iu,
    );
  });

  it.each([MODEL_ID, CANONICAL_SLUG])(
    "returns not-found only behind an intact independent authority sentinel",
    async (identifier) => {
      const database = new FakeDatabase([authority(0, 0)]);
      await expect(
        readModelDetailV2(database.asD1(), "local", input(identifier)),
      ).resolves.toEqual({
        outcome: "not_found",
        publicationId: PUBLICATION_ID,
        schemaVersion: "1.6.0",
      });
    },
  );

  it("fails closed when authority, cardinality, or mapping/resource parity is lost", async () => {
    const row = await modelRow();
    for (const rows of [
      [],
      [row],
      [authority(0, 0), row],
      [authority(1, 1)],
      [authority(1, 0), row],
      [authority(1, 1), row, row],
      [authority(0, 0), authority(0, 0)],
      [authority(0, 0, { serving_schema_version: "1.12.0" })],
      [
        authority(0, 0, {
          publication_id: "pub_22222222-2222-4222-8222-222222222222",
        }),
      ],
      [authority(0, 0, { matched_mapping_count: 2 })],
    ]) {
      await expect(
        readModelDetailV2(new FakeDatabase(rows).asD1(), "local", input()),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    }
  });

  it("rejects mismatched, malformed, oversized, and noncanonical Model rows", async () => {
    const otherJson = modelJson(OTHER_MODEL_ID);
    const other = await modelRow("current", {}, otherJson);
    const wrongSlugJson = modelJson(MODEL_ID, "other-current-slug");
    for (const row of [
      await modelRow("historical"),
      await modelRow("current", { resource_json: "{" }),
      await modelRow("current", {
        resource_json: null,
        resource_json_bytes: MODEL_DETAIL_MAX_RESOURCE_BYTES + 1,
      }),
      await modelRow("current", { content_hash: `sha256:${"0".repeat(64)}` }),
      await modelRow("current", { canonical_slug: "other-current-slug" }),
      await modelRow("current", {}, wrongSlugJson),
      await modelRow("current", { projection_version: "model-slug@2" }),
      await modelRow("current", {
        publication_id: "pub_22222222-2222-4222-8222-222222222222",
      }),
      await modelRow("current", { serving_schema_version: "1.12.0" }),
      other,
    ]) {
      await expect(
        readModelDetailV2(
          new FakeDatabase([authority(1, 1), row]).asD1(),
          "local",
          input(),
        ),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    }

    await expect(
      readModelDetailV2(
        new FakeDatabase([
          authority(1, 0),
          await modelRow("current", {
            matched_slug: "different-valid-slug",
          }),
        ]).asD1(),
        "local",
        input(CANONICAL_SLUG),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });
  });

  it("rejects malformed identifiers and hostile inputs before touching D1", async () => {
    const identifiers = [
      "mdl_00000001-0000-4000-8000-000000000001 ",
      "UPPER-SLUG",
      "double--dash",
      "-leading",
      "a".repeat(129),
      "slug%20encoded",
      "var_00000001-0000-4000-8000-000000000001",
    ];
    for (const identifier of identifiers) {
      const database = new FakeDatabase([]);
      await expect(
        readModelDetailV2(database.asD1(), "local", input(identifier)),
      ).resolves.toEqual({ outcome: "integrity_failure" });
      expect(database.calls).toEqual([]);
    }

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
      readModelDetailV2(database.asD1(), "local", hostile),
    ).resolves.toEqual({ outcome: "integrity_failure" });
    expect(invoked).toBe(false);
    expect(database.calls).toEqual([]);
  });

  it("rejects hostile row accessors without invoking them", async () => {
    let invoked = false;
    const hostile = await modelRow();
    Object.defineProperty(hostile, "canonical_slug", {
      enumerable: true,
      get() {
        invoked = true;
        return "hostile";
      },
    });
    await expect(
      readModelDetailV2(
        new FakeDatabase([authority(1, 1), hostile]).asD1(),
        "local",
        input(),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });
    expect(invoked).toBe(false);
  });

  it("closes wrong outer/envelope values and unconstrained bookmarks", async () => {
    const cases = [
      { ...input(), version: 1 },
      { ...input(), audience: "other" },
      { ...input(), environment: "preview" },
      { ...input(), bookmark: "first-primary" },
      { ...input(), requiredAvailableUntilMs: -1 },
      {
        ...input(),
        lookup: { kind: "slug", value: MODEL_ID },
      },
      {
        ...input(),
        lookup: { kind: "stable_id", value: OTHER_MODEL_ID },
      },
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
      { ...input(), envelope: { ...input().envelope, filters: { x: "y" } } },
    ];
    for (const value of cases) {
      const database = new FakeDatabase([]);
      await expect(
        readModelDetailV2(database.asD1(), "local", value),
      ).resolves.toEqual({ outcome: "integrity_failure" });
      expect(database.calls).toEqual([]);
    }
  });

  it("maps D1 rejection and malformed result envelopes to static read failures", async () => {
    await expect(
      readModelDetailV2(new FakeDatabase([], false).asD1(), "local", input()),
    ).resolves.toEqual({ outcome: "read_failure" });
    await expect(
      readModelDetailV2(
        new FakeDatabase([], true, true).asD1(),
        "local",
        input(HISTORICAL_SLUG),
      ),
    ).resolves.toEqual({ outcome: "read_failure" });
  });
});
