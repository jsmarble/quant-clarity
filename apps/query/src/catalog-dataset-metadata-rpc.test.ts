import { describe, expect, it } from "vitest";

import {
  DATASET_METADATA_SELECT_SQL,
  nextRefreshWindow,
  readDatasetMetadataV1,
} from "./catalog-query-rpc.js";
import {
  RETAINED_HOT_FROM_INDEX,
  RETAINED_HOT_ROLLBACK_INDEX,
} from "./retained-hot-publication.js";

const PUBLICATION = "pub_11111111-1111-4111-8111-111111111111";
const BOOKMARK = "bookmark-metadata-test-only";
const HORIZON_MS = Date.parse("2026-08-03T06:15:00.000Z");
const NOW_MS = Date.parse("2026-08-03T06:00:00.000Z");
const CLOSURE_HASH = `sha256:${"a".repeat(64)}`;
const PROVIDER_SLICE_HASH = `sha256:${"b".repeat(64)}`;
const SUMMARY_HASH =
  "sha256:4a643a7ee84505615120d2fe73d0f989c19a81c0eee495c4fe4078003aba81a3";

const input = () => ({
  version: 1,
  audience: "quantclarity-catalog-query-v1",
  environment: "test",
  bookmark: BOOKMARK,
  requiredAvailableUntilMs: HORIZON_MS,
  envelope: {
    version: 1,
    audience: "quantclarity-catalog-query-v1",
    environment: "test",
    operation: { kind: "metadata" },
    publicationId: PUBLICATION,
    filters: {},
    sort: [],
    limit: 25,
    continuation: null,
    searchPlan: null,
  },
});

const productionInput = () => {
  const value = input();
  return {
    ...value,
    environment: "production",
    envelope: { ...value.envelope, environment: "production" },
  };
};

const previewInput = () => {
  const value = input();
  return {
    ...value,
    environment: "preview",
    envelope: { ...value.envelope, environment: "preview" },
  };
};

const row = () => ({
  publication_id: PUBLICATION,
  schema_version: "1.9.0",
  methodology_version: "1.0.0",
  precision_normalization_version: "precision-normalization@1",
  precision_display_order_version: "precision-display-order@1",
  price_policy_version: "price-policy@1",
  generated_at_ms: Date.parse("2026-08-01T01:00:00.000Z"),
  activated_at_ms: Date.parse("2026-08-01T02:00:00.000Z"),
  publication_closure_hash: CLOSURE_HASH,
  sealed_closure_hash: CLOSURE_HASH,
  sealed_resource_count: 9,
  sealed_provider_slice_count: 2,
  sealed_provider_slice_hash: PROVIDER_SLICE_HASH,
  summary_version: "1.0.0",
  summary_closure_hash: CLOSURE_HASH,
  source_resource_count: 9,
  summary_provider_slice_count: 2,
  summary_provider_slice_hash: PROVIDER_SLICE_HASH,
  active_models: 3,
  active_offerings: 2,
  active_providers: 1,
  has_stale_provider_slices: 1,
  has_unavailable_provider_slices: 1,
  summary_hash: SUMMARY_HASH,
});

class FakeDatabase {
  readonly sessionInputs: string[] = [];
  readonly binds: unknown[][] = [];
  prepareCalls = 0;

  constructor(
    private readonly rows: readonly unknown[],
    private readonly success = true,
  ) {}

  asD1(): D1Database {
    return {
      withSession: (bookmark: string) => {
        this.sessionInputs.push(bookmark);
        return {
          getBookmark: () => bookmark,
          prepare: (sql: string) => {
            this.prepareCalls += 1;
            if (sql !== DATASET_METADATA_SELECT_SQL)
              throw new Error("unexpected query");
            return {
              bind: (...values: unknown[]) => {
                this.binds.push(values);
                return {
                  all: () =>
                    Promise.resolve({
                      success: this.success,
                      results: this.rows.map((value) => structuredClone(value)),
                      meta: {},
                    }),
                } as D1PreparedStatement;
              },
            } as D1PreparedStatement;
          },
        } as D1DatabaseSession;
      },
    } as D1Database;
  }
}

describe("dataset metadata query RPC (API-015, DATA-012, PRIV-006)", () => {
  it("returns sealed publication metadata and static degradation notices", async () => {
    const database = new FakeDatabase([row()]);

    await expect(
      readDatasetMetadataV1(
        database.asD1(),
        "test",
        "https://api.example.test",
        NOW_MS,
        input(),
      ),
    ).resolves.toEqual({
      outcome: "metadata",
      metadata: {
        publication_id: PUBLICATION,
        schema_version: "1.9.0",
        api_version: "1",
        methodology_version: "1.0.0",
        methodology_effective_at: "2026-08-01T00:00:00.000Z",
        methodology_url: "https://api.example.test/v1/methodologies/1.0.0",
        precision_normalization_version: "precision-normalization@1",
        precision_display_order_version: "precision-display-order@1",
        price_policy_version: "price-policy@1",
        published_at: "2026-08-01T02:00:00.000Z",
        generated_at: "2026-08-01T01:00:00.000Z",
        next_refresh_window: {
          starts_at: "2026-08-03T05:00:00.000Z",
          ends_at: "2026-08-03T17:00:00.000Z",
        },
        counts: {
          active_models: 3,
          active_offerings: 2,
          active_providers: 1,
        },
        degradation_notices: [
          "One or more enabled provider slices are stale.",
          "One or more enabled provider slices are unavailable.",
        ],
      },
    });
    expect(database.sessionInputs).toEqual([BOOKMARK]);
    expect(database.binds).toEqual([[PUBLICATION, HORIZON_MS]]);
    expect(database.prepareCalls).toBe(1);
  });

  it("computes inclusive Monday/Thursday windows with a 17:00 UTC cutoff", () => {
    expect(nextRefreshWindow(Date.parse("2026-08-03T04:59:59.999Z"))).toEqual({
      starts_at: "2026-08-03T05:00:00.000Z",
      ends_at: "2026-08-03T17:00:00.000Z",
    });
    expect(nextRefreshWindow(Date.parse("2026-08-03T16:59:59.999Z"))).toEqual({
      starts_at: "2026-08-03T05:00:00.000Z",
      ends_at: "2026-08-03T17:00:00.000Z",
    });
    expect(nextRefreshWindow(Date.parse("2026-08-03T17:00:00.000Z"))).toEqual({
      starts_at: "2026-08-06T05:00:00.000Z",
      ends_at: "2026-08-06T17:00:00.000Z",
    });
    expect(nextRefreshWindow(Date.parse("2026-08-07T00:00:00.000Z"))).toEqual({
      starts_at: "2026-08-10T05:00:00.000Z",
      ends_at: "2026-08-10T17:00:00.000Z",
    });
  });

  it("fails closed before D1 for malformed inputs, origins, and environments", async () => {
    const database = new FakeDatabase([row()]);
    const accessor = input();
    Object.defineProperty(accessor, "bookmark", {
      enumerable: true,
      get: () => {
        throw new Error("must not execute");
      },
    });
    for (const [environment, origin, value] of [
      ["test", "http://api.example.invalid", input()],
      ["production", "https://api.example.invalid", input()],
      ["preview", "https://api.example.com", input()],
      ["test", "https://api.example.invalid", accessor],
    ] as const) {
      await expect(
        readDatasetMetadataV1(
          database.asD1(),
          environment,
          origin,
          NOW_MS,
          value,
        ),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    }
    expect(database.prepareCalls).toBe(0);
  });

  it.each([
    "https://api.example.invalid",
    "https://api.example.test",
    "https://api.example",
    "https://api.example.com",
    "https://localhost",
    "https://catalog.internal",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.0.1",
    "https://169.254.1.1",
    "https://[::1]",
    "https://[fd00::1]",
  ])("rejects reserved production API origin %s", async (origin) => {
    const database = new FakeDatabase([row()]);
    await expect(
      readDatasetMetadataV1(
        database.asD1(),
        "production",
        origin,
        NOW_MS,
        productionInput(),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });
    expect(database.prepareCalls).toBe(0);
  });

  it("accepts an exact public production origin", async () => {
    await expect(
      readDatasetMetadataV1(
        new FakeDatabase([row()]).asD1(),
        "production",
        "https://api.quantclarity.org",
        NOW_MS,
        productionInput(),
      ),
    ).resolves.toMatchObject({
      outcome: "metadata",
      metadata: {
        methodology_url: "https://api.quantclarity.org/v1/methodologies/1.0.0",
      },
    });
  });

  it("rejects a reserved preview origin before D1", async () => {
    const database = new FakeDatabase([row()]);
    await expect(
      readDatasetMetadataV1(
        database.asD1(),
        "preview",
        "https://api.example.test",
        NOW_MS,
        previewInput(),
      ),
    ).resolves.toEqual({ outcome: "integrity_failure" });
    expect(database.prepareCalls).toBe(0);
  });

  it("fails closed on unknown methodology, closure drift, malformed rows, and D1 failure", async () => {
    for (const value of [
      { ...row(), methodology_version: "2.0.0" },
      { ...row(), summary_closure_hash: `sha256:${"d".repeat(64)}` },
      { ...row(), source_resource_count: 8 },
      { ...row(), summary_provider_slice_count: 1 },
      { ...row(), summary_provider_slice_hash: `sha256:${"d".repeat(64)}` },
      { ...row(), summary_version: "2.0.0" },
      { ...row(), summary_hash: "malformed" },
      { ...row(), active_models: 2 },
      { ...row(), summary_hash: `sha256:${"d".repeat(64)}` },
      { ...row(), has_stale_provider_slices: 2 },
      { ...row(), generated_at_ms: row().activated_at_ms + 1 },
      { ...row(), unexpected: "field" },
    ]) {
      await expect(
        readDatasetMetadataV1(
          new FakeDatabase([value]).asD1(),
          "test",
          "https://api.example.test",
          NOW_MS,
          input(),
        ),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    }
    for (const rows of [[], [row(), row()]]) {
      await expect(
        readDatasetMetadataV1(
          new FakeDatabase(rows).asD1(),
          "test",
          "https://api.example.test",
          NOW_MS,
          input(),
        ),
      ).resolves.toEqual({ outcome: "integrity_failure" });
    }
    await expect(
      readDatasetMetadataV1(
        new FakeDatabase([row()], false).asD1(),
        "test",
        "https://api.example.test",
        NOW_MS,
        input(),
      ),
    ).resolves.toEqual({ outcome: "read_failure" });
  });

  it("uses one O(1) summary SELECT with both retained-publication indexes", () => {
    expect(DATASET_METADATA_SELECT_SQL.trimStart()).toMatch(/^WITH /u);
    expect(DATASET_METADATA_SELECT_SQL).toContain(
      `INDEXED BY ${RETAINED_HOT_FROM_INDEX}`,
    );
    expect(DATASET_METADATA_SELECT_SQL).toContain(
      `INDEXED BY ${RETAINED_HOT_ROLLBACK_INDEX}`,
    );
    expect(DATASET_METADATA_SELECT_SQL).toContain(
      "JOIN publication_dataset_metadata_summary AS summary",
    );
    for (const authorityBinding of [
      "summary.closure_hash = publication.closure_hash",
      "summary.closure_hash = seal.closure_hash",
      "summary.source_resource_count = publication.resource_count",
      "summary.source_resource_count = seal.resource_count",
      "summary.provider_slice_count = seal.provider_slice_count",
      "summary.provider_slice_hash = seal.provider_slice_hash",
    ])
      expect(DATASET_METADATA_SELECT_SQL).toContain(authorityBinding);
    expect(DATASET_METADATA_SELECT_SQL).not.toContain("publication_resource");
    expect(DATASET_METADATA_SELECT_SQL).not.toContain(
      "publication_provider_slice AS",
    );
    expect(DATASET_METADATA_SELECT_SQL).not.toContain("json_extract");
    expect(DATASET_METADATA_SELECT_SQL).toMatch(/LIMIT 2\s*$/u);
    expect(DATASET_METADATA_SELECT_SQL).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|PRAGMA|ATTACH|DETACH)\b/iu,
    );
  });
});
