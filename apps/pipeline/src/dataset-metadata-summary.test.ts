import { beforeAll, describe, expect, it } from "vitest";

import {
  projectDatasetMetadataSummary,
  verifyDatasetMetadataSummaryHash,
  type DatasetMetadataSummaryProjection,
} from "@quant-clarity/publication-core";

import { createServingV4Fixture } from "../test/serving-switch-v4-fixture.js";
import {
  DatasetMetadataSummaryWriteError,
  applyDatasetMetadataSummary,
} from "./dataset-metadata-summary.js";

const PUBLICATION_ID = "pub_77777777-7777-4777-8777-777777777777" as const;
let summary: DatasetMetadataSummaryProjection;
let closureRows: Awaited<
  ReturnType<typeof createServingV4Fixture>
>["base"]["closureRows"];

beforeAll(async () => {
  const fixture = await createServingV4Fixture(
    PUBLICATION_ID,
    Date.parse("2026-08-02T10:00:00.000Z"),
    [
      { rawProviderModelId: "active-a" },
      { rawProviderModelId: "inactive", status: "inactive" },
      { rawProviderModelId: "stale", stale: true },
      { rawProviderModelId: "active-b" },
      { rawProviderModelId: "unavailable", status: "unavailable" },
    ],
    true,
  );
  closureRows = fixture.base.closureRows;
  summary = await projectDatasetMetadataSummary(closureRows);
});

const result = (results: unknown[]) => ({
  success: true,
  results,
  meta: {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: 0,
    last_row_id: 0,
    changed_db: false,
    changes: 0,
  },
});

describe("publication dataset metadata summary", () => {
  it("counts canonical active resources and excludes Variants and stale Offerings", async () => {
    expect(summary).toMatchObject({
      publication_id: PUBLICATION_ID,
      summary_version: "1.0.0",
      source_resource_count: closureRows.resources.length,
      provider_slice_count: closureRows.providerSlices.length,
      active_model_count: 1,
      active_offering_count: 2,
      active_provider_count: 1,
      has_stale_provider_slices: 0,
      has_unavailable_provider_slices: 0,
    });
    expect(
      closureRows.resources.filter(
        (resource) => resource.resource_type === "variant",
      ),
    ).toHaveLength(1);
    await expect(verifyDatasetMetadataSummaryHash(summary)).resolves.toBe(true);
  });

  it("binds every authority field and rejects copied, extra, or accessor state", async () => {
    for (const candidate of [
      { ...summary, active_model_count: summary.active_model_count + 1 },
      { ...summary, provider_slice_hash: `sha256:${"0".repeat(64)}` },
      { ...summary, extra: true },
    ])
      await expect(verifyDatasetMetadataSummaryHash(candidate)).resolves.toBe(
        false,
      );

    let reads = 0;
    const hostile = { ...summary } as Record<string, unknown>;
    Object.defineProperty(hostile, "summary_hash", {
      enumerable: true,
      get() {
        reads += 1;
        return summary.summary_hash;
      },
    });
    await expect(verifyDatasetMetadataSummaryHash(hostile)).resolves.toBe(
      false,
    );
    expect(reads).toBe(0);
  });

  it("uses one fixed insert and bookmark-continuous reread", async () => {
    const captured: Readonly<{ sql: string; values: unknown[] }>[] = [];
    const prepared = (sql: string, values: unknown[] = []) => ({
      bind: (...next: unknown[]) => prepared(sql, next),
      sql,
      values,
    });
    const database = {
      withSession(constraint?: D1SessionConstraint) {
        expect(constraint).toBe("first-primary");
        return {
          prepare: prepared,
          batch(statements: D1PreparedStatement[]) {
            const values = statements as unknown as readonly {
              sql: string;
              values: unknown[];
            }[];
            captured.push(...values);
            return Promise.resolve([result([]), result([{ ...summary }])]);
          },
          getBookmark: () => null,
        } as unknown as D1DatabaseSession;
      },
    } as D1Database;

    await expect(
      applyDatasetMetadataSummary(database, closureRows),
    ).resolves.toEqual(summary);
    expect(captured).toHaveLength(2);
    expect(captured[0]?.sql).toContain(
      "INSERT INTO publication_dataset_metadata_summary",
    );
    expect(captured[0]?.values).toHaveLength(12);
    expect(captured[1]?.sql).toContain(
      "FROM publication_dataset_metadata_summary WHERE publication_id = ?1",
    );
  });

  it("fails closed when the durable reread disagrees", async () => {
    const prepared = (sql: string) => ({
      bind: () => prepared(sql),
    });
    const database = {
      withSession() {
        return {
          prepare: prepared,
          batch: () =>
            Promise.resolve([
              result([]),
              result([{ ...summary, active_provider_count: 9 }]),
            ]),
          getBookmark: () => null,
        } as unknown as D1DatabaseSession;
      },
    } as D1Database;
    await expect(
      applyDatasetMetadataSummary(database, closureRows),
    ).rejects.toEqual(new DatasetMetadataSummaryWriteError());
  });
});
