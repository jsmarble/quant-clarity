import {
  projectDatasetMetadataSummary,
  verifyDatasetMetadataSummaryHash,
  type DatasetMetadataSummaryProjection,
  type ServingClosureRows,
} from "@quant-clarity/publication-core";

const INSERT_SQL = `INSERT INTO publication_dataset_metadata_summary (
  publication_id, summary_version, closure_hash, source_resource_count,
  provider_slice_count, provider_slice_hash, active_model_count,
  active_offering_count, active_provider_count, has_stale_provider_slices,
  has_unavailable_provider_slices, summary_hash
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`;

const SELECT_SQL = `SELECT publication_id, summary_version, closure_hash,
  source_resource_count, provider_slice_count, provider_slice_hash,
  active_model_count, active_offering_count, active_provider_count,
  has_stale_provider_slices, has_unavailable_provider_slices, summary_hash
FROM publication_dataset_metadata_summary WHERE publication_id = ?1`;

export class DatasetMetadataSummaryWriteError extends Error {
  constructor() {
    super(
      "The publication dataset metadata summary could not be persisted safely.",
    );
    this.name = "DatasetMetadataSummaryWriteError";
  }
}

const ownRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const record: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || descriptor.enumerable !== true) return null;
    record[key] = descriptor.value;
  }
  return record;
};

const readSingleton = (
  value: unknown,
): DatasetMetadataSummaryProjection | null => {
  const result = ownRecord(value);
  if (result?.success !== true || !Array.isArray(result.results)) return null;
  const rows = result.results;
  if (rows.length !== 1) return null;
  const row = ownRecord(rows[0]);
  if (row === null) return null;
  const expectedKeys = [
    "active_model_count",
    "active_offering_count",
    "active_provider_count",
    "closure_hash",
    "has_stale_provider_slices",
    "has_unavailable_provider_slices",
    "provider_slice_count",
    "provider_slice_hash",
    "publication_id",
    "source_resource_count",
    "summary_hash",
    "summary_version",
  ];
  if (Object.keys(row).sort().join("\u0000") !== expectedKeys.join("\u0000"))
    return null;
  return Object.freeze({ ...row }) as DatasetMetadataSummaryProjection;
};

const sameSummary = (
  left: DatasetMetadataSummaryProjection,
  right: DatasetMetadataSummaryProjection,
): boolean => {
  for (const key of Object.keys(
    left,
  ) as (keyof DatasetMetadataSummaryProjection)[])
    if (left[key] !== right[key]) return false;
  return Object.keys(left).length === Object.keys(right).length;
};

/**
 * Projects, inserts, and rereads the immutable summary after the closure seal
 * is durable and before readiness. D1's insert guard independently rederives
 * the aggregates from the sealed canonical rows.
 */
export const applyDatasetMetadataSummary = async (
  database: D1Database,
  closureRows: ServingClosureRows,
): Promise<DatasetMetadataSummaryProjection> => {
  const summary = await projectDatasetMetadataSummary(closureRows);
  try {
    const session = database.withSession("first-primary");
    const results = await session.batch([
      session
        .prepare(INSERT_SQL)
        .bind(
          summary.publication_id,
          summary.summary_version,
          summary.closure_hash,
          summary.source_resource_count,
          summary.provider_slice_count,
          summary.provider_slice_hash,
          summary.active_model_count,
          summary.active_offering_count,
          summary.active_provider_count,
          summary.has_stale_provider_slices,
          summary.has_unavailable_provider_slices,
          summary.summary_hash,
        ),
      session.prepare(SELECT_SQL).bind(summary.publication_id),
    ]);
    if (!Array.isArray(results) || results.length !== 2)
      throw new DatasetMetadataSummaryWriteError();
    const persisted = readSingleton(results[1]);
    if (
      persisted === null ||
      !(await verifyDatasetMetadataSummaryHash(persisted)) ||
      !sameSummary(summary, persisted)
    )
      throw new DatasetMetadataSummaryWriteError();
    return summary;
  } catch (error) {
    if (error instanceof DatasetMetadataSummaryWriteError) throw error;
    throw new DatasetMetadataSummaryWriteError();
  }
};
