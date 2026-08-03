import {
  encodeModelDetailRepresentation,
  MODEL_DETAIL_PUBLIC_MAX_BYTES,
  snapshotModelDetailModel,
} from "@quant-clarity/api-core";
import {
  hashPublicationResourceContent,
  MODEL_SLUG_MAX_MODELS,
  MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES,
} from "@quant-clarity/publication-core";

import { ServingSwitchError } from "./serving-switch.js";

const UTF8 = new TextEncoder();
const PAGE_SIZE = 64;
const PAGE_RESULT_LIMIT = PAGE_SIZE + 1;
const MAXIMUM_PAGES = Math.ceil(MODEL_SLUG_MAX_MODELS / PAGE_SIZE) + 1;
const SCHEMA_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/u;

export const addModelDetailAdmissionBytes = (
  admittedBytes: number,
  resourceBytes: number,
): number => {
  if (
    !Number.isSafeInteger(admittedBytes) ||
    admittedBytes < 0 ||
    !Number.isSafeInteger(resourceBytes) ||
    resourceBytes < 0 ||
    admittedBytes > MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES - resourceBytes
  )
    throw new ServingSwitchError("integrity_failure");
  return admittedBytes + resourceBytes;
};

export const MODEL_DETAIL_ADMISSION_METADATA_SQL = `SELECT schema_version
FROM publication
WHERE publication_id = ?1
LIMIT 2`;

export const MODEL_DETAIL_ADMISSION_PAGE_SQL = `SELECT resource_id,
  content_hash,
  length(CAST(resource_json AS BLOB)) AS resource_json_bytes,
  CASE
    WHEN length(CAST(resource_json AS BLOB)) <= ${String(MODEL_DETAIL_PUBLIC_MAX_BYTES)}
    THEN resource_json
    ELSE NULL
  END AS resource_json
FROM publication_resource INDEXED BY publication_resource_lookup_idx
WHERE publication_id = ?1
  AND resource_type = 'model'
  AND resource_id > ?2
ORDER BY resource_id ASC
LIMIT ${String(PAGE_RESULT_LIMIT)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const snapshotArray = (value: unknown, maximumLength: number): unknown[] => {
  try {
    if (!Array.isArray(value) || value.length > maximumLength)
      throw new ServingSwitchError("integrity_failure");
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor))
        throw new ServingSwitchError("integrity_failure");
      output.push(descriptor.value);
    }
    return output;
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
};

const snapshotOwnRecord = <const Keys extends readonly string[]>(
  value: unknown,
  expectedKeys: Keys,
): Record<Keys[number], unknown> => {
  try {
    if (!isRecord(value)) throw new TypeError("invalid row");
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
    )
      throw new TypeError("invalid row");
    const output = Object.create(null) as Record<Keys[number], unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor))
        throw new TypeError("invalid row");
      output[key as Keys[number]] = descriptor.value as unknown;
    }
    return output;
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
};

const readSingleResult = async (
  session: D1DatabaseSession,
  prepare: () => D1PreparedStatement,
  maximumRows: number,
): Promise<unknown[]> => {
  let value: unknown;
  try {
    value = await session.batch([prepare()]);
  } catch {
    throw new ServingSwitchError("outcome_unknown");
  }
  const batch = snapshotArray(value, 1);
  if (batch.length !== 1) throw new ServingSwitchError("integrity_failure");
  let success: unknown;
  let results: unknown;
  try {
    const envelope = batch[0];
    if (!isRecord(envelope)) throw new TypeError("invalid D1 envelope");
    success = Object.getOwnPropertyDescriptor(envelope, "success")?.value;
    results = Object.getOwnPropertyDescriptor(envelope, "results")?.value;
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
  if (success !== true) throw new ServingSwitchError("integrity_failure");
  return snapshotArray(results, maximumRows);
};

/**
 * Proves every Model in a candidate publication fits the public detail
 * representation before the caller mutates the serving head. The caller must
 * reuse this first-primary session for its atomic switch batch.
 */
export const admitModelDetailPublication = async (
  session: D1DatabaseSession,
  input: Readonly<{ publicationId: string; expectedModelCount: number }>,
): Promise<void> => {
  if (
    !Number.isSafeInteger(input.expectedModelCount) ||
    input.expectedModelCount < 0 ||
    input.expectedModelCount > MODEL_SLUG_MAX_MODELS
  )
    throw new ServingSwitchError("integrity_failure");

  const metadataRows = await readSingleResult(
    session,
    () =>
      session
        .prepare(MODEL_DETAIL_ADMISSION_METADATA_SQL)
        .bind(input.publicationId),
    2,
  );
  if (metadataRows.length !== 1)
    throw new ServingSwitchError("integrity_failure");
  const metadata = snapshotOwnRecord(metadataRows[0], ["schema_version"]);
  if (
    typeof metadata.schema_version !== "string" ||
    !SCHEMA_VERSION.test(metadata.schema_version)
  )
    throw new ServingSwitchError("integrity_failure");

  let admittedCount = 0;
  let admittedBytes = 0;
  let cursor = "";
  for (let page = 0; page < MAXIMUM_PAGES; page += 1) {
    const rows = await readSingleResult(
      session,
      () =>
        session
          .prepare(MODEL_DETAIL_ADMISSION_PAGE_SQL)
          .bind(input.publicationId, cursor),
      PAGE_RESULT_LIMIT,
    );
    const admittedRows = rows.slice(0, PAGE_SIZE);
    for (const value of admittedRows) {
      const row = snapshotOwnRecord(value, [
        "resource_id",
        "content_hash",
        "resource_json_bytes",
        "resource_json",
      ]);
      if (
        typeof row.resource_id !== "string" ||
        row.resource_id <= cursor ||
        typeof row.content_hash !== "string" ||
        typeof row.resource_json_bytes !== "number" ||
        !Number.isSafeInteger(row.resource_json_bytes) ||
        row.resource_json_bytes < 2 ||
        row.resource_json_bytes > MODEL_DETAIL_PUBLIC_MAX_BYTES ||
        typeof row.resource_json !== "string" ||
        UTF8.encode(row.resource_json).byteLength !== row.resource_json_bytes
      )
        throw new ServingSwitchError("integrity_failure");
      admittedBytes = addModelDetailAdmissionBytes(
        admittedBytes,
        row.resource_json_bytes,
      );
      admittedCount += 1;
      if (admittedCount > input.expectedModelCount)
        throw new ServingSwitchError("integrity_failure");

      try {
        const parsed = JSON.parse(row.resource_json) as unknown;
        const computedHash = await hashPublicationResourceContent({
          resourceType: "model",
          resourceId: row.resource_id,
          resourceJson: row.resource_json,
        });
        const model = snapshotModelDetailModel({
          expectedModelId: row.resource_id,
          maxRepresentationBytes: MODEL_DETAIL_PUBLIC_MAX_BYTES,
          model: parsed,
        });
        if (model === null || computedHash !== row.content_hash)
          throw new TypeError("Model admission mismatch");
        encodeModelDetailRepresentation({
          model,
          publicationId: input.publicationId,
          schemaVersion: metadata.schema_version,
        });
      } catch {
        throw new ServingSwitchError("integrity_failure");
      }
      cursor = row.resource_id;
    }
    if (rows.length <= PAGE_SIZE) {
      if (admittedCount !== input.expectedModelCount)
        throw new ServingSwitchError("integrity_failure");
      return;
    }
  }
  throw new ServingSwitchError("integrity_failure");
};
