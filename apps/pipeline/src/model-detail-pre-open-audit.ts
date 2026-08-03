import {
  MODEL_SLUG_MAX_MODELS,
  MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES,
  RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS,
  RETAINED_HOT_PUBLICATION_WINDOW_MS,
} from "@quant-clarity/publication-core";

import { admitModelDetailPublication } from "./model-detail-admission.js";
import { ServingSwitchError } from "./serving-switch.js";

const PUBLICATION_ID =
  /^pub_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SCHEMA_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ALLOWED_RETAINED_STATES = new Set(["rolled_back", "superseded"]);

export const MODEL_DETAIL_PRE_OPEN_MAX_PUBLICATIONS = 64;
export const MODEL_DETAIL_PRE_OPEN_MAX_RECENT_SWITCHES = 1_024;
export const MODEL_DETAIL_PRE_OPEN_MAX_MODELS = 50_000;
export const MODEL_DETAIL_PRE_OPEN_MAX_RESOURCE_BYTES = 64 * 1_024 * 1_024;
export const MODEL_DETAIL_PRE_OPEN_MAX_D1_STATEMENTS = 900;
const MODEL_DETAIL_ADMISSION_PAGE_SIZE = 64;

export const MODEL_DETAIL_PRE_OPEN_HEAD_SQL = `SELECT
  head.active_publication_id,
  head.rollback_candidate_publication_id,
  head.generation,
  active.state AS active_state,
  rollback.state AS rollback_state,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000 AS database_now_ms
FROM publication_head AS head
LEFT JOIN publication AS active
  ON active.publication_id = head.active_publication_id
LEFT JOIN publication AS rollback
  ON rollback.publication_id = head.rollback_candidate_publication_id
WHERE head.singleton = 1
LIMIT 2`;

export const MODEL_DETAIL_PRE_OPEN_HISTORY_SQL = `SELECT new_generation,
  switched_at_ms, from_publication_id,
  expected_prior_rollback_candidate_publication_id
FROM publication_switch_history
WHERE new_generation <= ?1
ORDER BY new_generation DESC
LIMIT ${String(MODEL_DETAIL_PRE_OPEN_MAX_RECENT_SWITCHES + 1)}`;

export const MODEL_DETAIL_PRE_OPEN_METADATA_SQL = `WITH candidate AS (
  SELECT value AS publication_id FROM json_each(?1)
)
SELECT candidate.publication_id,
  publication.state,
  publication.schema_version,
  publication.closure_hash,
  seal.closure_hash AS seal_closure_hash,
  proof.closure_hash AS proof_closure_hash,
  proof.model_count
FROM candidate
LEFT JOIN publication
  ON publication.publication_id = candidate.publication_id
LEFT JOIN publication_closure_seal AS seal
  ON seal.publication_id = candidate.publication_id
LEFT JOIN publication_model_slug_artifact_proof AS proof
  ON proof.publication_id = candidate.publication_id
ORDER BY candidate.publication_id ASC
LIMIT ${String(MODEL_DETAIL_PRE_OPEN_MAX_PUBLICATIONS + 1)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const denseArray = (value: unknown, maximum: number): unknown[] => {
  try {
    if (!Array.isArray(value) || value.length > maximum) throw new TypeError();
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor))
        throw new TypeError();
      output.push(descriptor.value as unknown);
    }
    return output;
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
};

const exactRecord = <const Keys extends readonly string[]>(
  value: unknown,
  expected: Keys,
): Record<Keys[number], unknown> => {
  try {
    if (!isRecord(value)) throw new TypeError();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expected.length ||
      keys.some((key) => typeof key !== "string" || !expected.includes(key))
    )
      throw new TypeError();
    const output = Object.create(null) as Record<Keys[number], unknown>;
    for (const key of expected) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor))
        throw new TypeError();
      output[key as Keys[number]] = descriptor.value as unknown;
    }
    return output;
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
};

const readRows = async (
  session: D1DatabaseSession,
  prepare: () => D1PreparedStatement,
  maximum: number,
): Promise<unknown[]> => {
  let value: unknown;
  try {
    value = await session.batch([prepare()]);
  } catch {
    throw new ServingSwitchError("outcome_unknown");
  }
  const batch = denseArray(value, 1);
  if (batch.length !== 1) throw new ServingSwitchError("integrity_failure");
  let success: unknown;
  let results: unknown;
  try {
    const envelope = batch[0];
    if (!isRecord(envelope)) throw new TypeError();
    success = Object.getOwnPropertyDescriptor(envelope, "success")?.value;
    results = Object.getOwnPropertyDescriptor(envelope, "results")?.value;
  } catch {
    throw new ServingSwitchError("integrity_failure");
  }
  if (success !== true) throw new ServingSwitchError("integrity_failure");
  return denseArray(results, maximum);
};

const safeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

type Head = Readonly<{
  activePublicationId: string;
  databaseNowMs: number;
  generation: number;
  rollbackPublicationId: string | null;
}>;

const readHead = async (session: D1DatabaseSession): Promise<Head> => {
  const rows = await readRows(
    session,
    () => session.prepare(MODEL_DETAIL_PRE_OPEN_HEAD_SQL),
    2,
  );
  if (rows.length !== 1) throw new ServingSwitchError("integrity_failure");
  const row = exactRecord(rows[0], [
    "active_publication_id",
    "rollback_candidate_publication_id",
    "generation",
    "active_state",
    "rollback_state",
    "database_now_ms",
  ]);
  if (
    typeof row.active_publication_id !== "string" ||
    !PUBLICATION_ID.test(row.active_publication_id) ||
    row.active_state !== "active" ||
    !safeInteger(row.generation) ||
    row.generation < 1 ||
    !safeInteger(row.database_now_ms) ||
    row.database_now_ms >
      Number.MAX_SAFE_INTEGER - RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS ||
    (row.rollback_candidate_publication_id !== null &&
      (typeof row.rollback_candidate_publication_id !== "string" ||
        !PUBLICATION_ID.test(row.rollback_candidate_publication_id) ||
        row.rollback_candidate_publication_id === row.active_publication_id ||
        !ALLOWED_RETAINED_STATES.has(String(row.rollback_state)))) ||
    (row.rollback_candidate_publication_id === null &&
      row.rollback_state !== null)
  )
    throw new ServingSwitchError("integrity_failure");
  return Object.freeze({
    activePublicationId: row.active_publication_id,
    databaseNowMs: row.database_now_ms,
    generation: row.generation,
    rollbackPublicationId: row.rollback_candidate_publication_id,
  });
};

const sameHead = (left: Head, right: Head): boolean =>
  left.activePublicationId === right.activePublicationId &&
  left.rollbackPublicationId === right.rollbackPublicationId &&
  left.generation === right.generation;

/** Audits the complete active, rollback, and retained-hot Model detail set. */
export const auditServeableModelDetailPublications = async (
  database: D1Database,
): Promise<
  Readonly<{
    modelCount: number;
    outcome: "passed";
    publicationCount: number;
    resourceBytes: number;
  }>
> => {
  const session = database.withSession("first-primary");
  const initialHead = await readHead(session);
  const historyRows = await readRows(
    session,
    () =>
      session
        .prepare(MODEL_DETAIL_PRE_OPEN_HISTORY_SQL)
        .bind(initialHead.generation),
    MODEL_DETAIL_PRE_OPEN_MAX_RECENT_SWITCHES + 1,
  );
  if (historyRows.length === 0)
    throw new ServingSwitchError("integrity_failure");

  // Include the literal retained-hot set at captured D1 time. This is broader
  // than a fresh-work horizon and covers still-valid continuation horizons.
  const cutoffMs =
    initialHead.databaseNowMs - RETAINED_HOT_PUBLICATION_WINDOW_MS;
  const latestReference = new Map<string, number>();
  let expectedGeneration = initialHead.generation;
  let previousSwitchedAtMs = Number.MAX_SAFE_INTEGER;
  for (const value of historyRows) {
    const row = exactRecord(value, [
      "new_generation",
      "switched_at_ms",
      "from_publication_id",
      "expected_prior_rollback_candidate_publication_id",
    ]);
    if (
      row.new_generation !== expectedGeneration ||
      !safeInteger(row.switched_at_ms) ||
      row.switched_at_ms >= previousSwitchedAtMs ||
      (row.from_publication_id !== null &&
        (typeof row.from_publication_id !== "string" ||
          !PUBLICATION_ID.test(row.from_publication_id))) ||
      (row.expected_prior_rollback_candidate_publication_id !== null &&
        (typeof row.expected_prior_rollback_candidate_publication_id !==
          "string" ||
          !PUBLICATION_ID.test(
            row.expected_prior_rollback_candidate_publication_id,
          )))
    )
      throw new ServingSwitchError("integrity_failure");
    for (const publicationId of [
      row.from_publication_id,
      row.expected_prior_rollback_candidate_publication_id,
    ])
      if (
        typeof publicationId === "string" &&
        !latestReference.has(publicationId)
      )
        latestReference.set(publicationId, row.switched_at_ms);
    previousSwitchedAtMs = row.switched_at_ms;
    expectedGeneration -= 1;
  }
  const overflow = historyRows[MODEL_DETAIL_PRE_OPEN_MAX_RECENT_SWITCHES];
  if (overflow !== undefined) {
    const row = exactRecord(overflow, [
      "new_generation",
      "switched_at_ms",
      "from_publication_id",
      "expected_prior_rollback_candidate_publication_id",
    ]);
    if (!safeInteger(row.switched_at_ms) || row.switched_at_ms > cutoffMs)
      throw new ServingSwitchError("integrity_failure");
  } else if (expectedGeneration !== 0)
    throw new ServingSwitchError("integrity_failure");

  const publicationIds = new Set<string>([initialHead.activePublicationId]);
  if (initialHead.rollbackPublicationId !== null)
    publicationIds.add(initialHead.rollbackPublicationId);
  for (const [publicationId, switchedAtMs] of latestReference)
    if (
      switchedAtMs > cutoffMs &&
      switchedAtMs <=
        initialHead.databaseNowMs +
          RETAINED_HOT_PUBLICATION_MAX_SWITCH_FUTURE_MS
    )
      publicationIds.add(publicationId);
  const orderedIds = [...publicationIds].sort();
  if (orderedIds.length > MODEL_DETAIL_PRE_OPEN_MAX_PUBLICATIONS)
    throw new ServingSwitchError("integrity_failure");

  const metadataRows = await readRows(
    session,
    () =>
      session
        .prepare(MODEL_DETAIL_PRE_OPEN_METADATA_SQL)
        .bind(JSON.stringify(orderedIds)),
    MODEL_DETAIL_PRE_OPEN_MAX_PUBLICATIONS + 1,
  );
  if (metadataRows.length !== orderedIds.length)
    throw new ServingSwitchError("integrity_failure");

  const metadata = metadataRows.map((value, index) => {
    const row = exactRecord(value, [
      "publication_id",
      "state",
      "schema_version",
      "closure_hash",
      "seal_closure_hash",
      "proof_closure_hash",
      "model_count",
    ]);
    const expectedState =
      row.publication_id === initialHead.activePublicationId
        ? "active"
        : ALLOWED_RETAINED_STATES.has(String(row.state))
          ? row.state
          : null;
    if (
      typeof row.publication_id !== "string" ||
      row.publication_id !== orderedIds[index] ||
      expectedState === null ||
      row.state !== expectedState ||
      typeof row.schema_version !== "string" ||
      !SCHEMA_VERSION.test(row.schema_version) ||
      typeof row.closure_hash !== "string" ||
      !SHA256.test(row.closure_hash) ||
      row.seal_closure_hash !== row.closure_hash ||
      row.proof_closure_hash !== row.closure_hash ||
      !safeInteger(row.model_count) ||
      row.model_count > MODEL_SLUG_MAX_MODELS
    )
      throw new ServingSwitchError("integrity_failure");
    return Object.freeze({
      modelCount: row.model_count,
      publicationId: row.publication_id,
    });
  });

  const plannedModels = metadata.reduce((sum, row) => sum + row.modelCount, 0);
  const plannedStatements =
    4 +
    metadata.reduce(
      (sum, row) =>
        sum +
        1 +
        Math.max(
          1,
          Math.ceil(row.modelCount / MODEL_DETAIL_ADMISSION_PAGE_SIZE),
        ),
      0,
    );
  if (
    plannedModels > MODEL_DETAIL_PRE_OPEN_MAX_MODELS ||
    plannedStatements > MODEL_DETAIL_PRE_OPEN_MAX_D1_STATEMENTS
  )
    throw new ServingSwitchError("integrity_failure");

  let admittedModels = 0;
  let admittedBytes = 0;
  for (const row of metadata) {
    const admitted = await admitModelDetailPublication(session, {
      publicationId: row.publicationId,
      expectedModelCount: row.modelCount,
      maximumResourceBytes: Math.min(
        MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES,
        MODEL_DETAIL_PRE_OPEN_MAX_RESOURCE_BYTES - admittedBytes,
      ),
    });
    if (admitted.modelCount !== row.modelCount)
      throw new ServingSwitchError("integrity_failure");
    admittedModels += admitted.modelCount;
    admittedBytes += admitted.resourceBytes;
  }
  const finalHead = await readHead(session);
  if (!sameHead(initialHead, finalHead))
    throw new ServingSwitchError("integrity_failure");
  return Object.freeze({
    modelCount: admittedModels,
    outcome: "passed" as const,
    publicationCount: metadata.length,
    resourceBytes: admittedBytes,
  });
};
