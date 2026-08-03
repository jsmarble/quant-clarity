import { beforeAll, describe, expect, it } from "vitest";

import { createModelSlugHistoryCandidateFixture } from "../test/model-slug-history-candidate-fixture.js";
import { archiveModelSlugHistoryCandidate } from "./model-slug-history-archive.js";
import type { TrustedModelSlugHistoryArchiveProof } from "./model-slug-history-archive.js";
import {
  MODEL_SLUG_HISTORY_D1_MAX_CHUNKS,
  MODEL_SLUG_HISTORY_D1_MAX_PAYLOAD_BYTES,
  MODEL_SLUG_HISTORY_D1_MAX_TOTAL_PAYLOAD_BYTES,
  MODEL_SLUG_HISTORY_STAGING_MAX_RETAINED_HEAP_BYTES,
  ModelSlugHistoryStagingError,
  assertModelSlugServingProof,
  estimateModelSlugHistoryStagingRetainedHeapBytes,
  planModelSlugMappingChunks,
  stageModelSlugHistoryArchive,
} from "./model-slug-history-staging.js";

type StoredObject = Readonly<{
  bytes: Uint8Array<ArrayBuffer>;
  checksum: ArrayBuffer;
  customMetadata: Record<string, string>;
  httpMetadata: R2HTTPMetadata;
}>;

class FixtureArchiveBucket {
  private stored: StoredObject | undefined;
  private key: string | undefined;

  readonly binding = {
    put: (
      key: string,
      value:
        ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
      options?: R2PutOptions,
    ): Promise<R2Object | null> => {
      if (this.stored !== undefined) return Promise.resolve(null);
      if (!ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer))
        throw new Error("fixture requires byte input");
      if (options?.sha256 === undefined || typeof options.sha256 === "string")
        throw new Error("fixture requires checksum bytes");
      const view = ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(value);
      const checksumView = ArrayBuffer.isView(options.sha256)
        ? new Uint8Array(
            options.sha256.buffer,
            options.sha256.byteOffset,
            options.sha256.byteLength,
          )
        : new Uint8Array(options.sha256);
      const httpMetadata =
        options.httpMetadata instanceof Headers
          ? undefined
          : options.httpMetadata;
      if (
        typeof httpMetadata?.contentType !== "string" ||
        typeof httpMetadata.cacheControl !== "string"
      )
        throw new Error("fixture requires HTTP metadata");
      this.key = key;
      const stored: StoredObject = {
        bytes: Uint8Array.from(view),
        checksum: Uint8Array.from(checksumView).buffer,
        customMetadata: { ...options.customMetadata },
        httpMetadata: {
          contentType: httpMetadata.contentType,
          contentLanguage: undefined,
          contentDisposition: undefined,
          contentEncoding: undefined,
          cacheControl: httpMetadata.cacheControl,
          cacheExpiry: undefined,
        } as unknown as R2HTTPMetadata,
      };
      this.stored = stored;
      return Promise.resolve(this.metadata(key, stored));
    },
    get: (key: string): Promise<R2ObjectBody | null> => {
      if (this.key !== key || this.stored === undefined)
        return Promise.resolve(null);
      const bytes = Uint8Array.from(this.stored.bytes);
      return Promise.resolve(
        Object.assign(this.metadata(key, this.stored), {
          body: new ReadableStream<Uint8Array<ArrayBuffer>>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
          bodyUsed: false,
          arrayBuffer: () => Promise.resolve(bytes.buffer),
          bytes: () => Promise.resolve(bytes),
          text: () => Promise.resolve(new TextDecoder().decode(bytes)),
          json: <T>() =>
            Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)) as T),
          blob: () => Promise.resolve(new Blob([bytes])),
        }),
      );
    },
  } as unknown as R2Bucket;

  private metadata(key: string, stored: StoredObject): R2Object {
    return {
      key,
      version: "fixture-version",
      size: stored.bytes.byteLength,
      etag: "fixture-etag",
      httpEtag: '"fixture-etag"',
      checksums: {
        sha256: stored.checksum,
        toJSON: () => ({ sha256: "unused" }),
      },
      uploaded: new Date(0),
      httpMetadata: stored.httpMetadata,
      customMetadata: stored.customMetadata,
      storageClass: "Standard",
      writeHttpMetadata(headers: Headers) {
        void headers;
      },
    };
  }
}

type CapturedStatement = Readonly<{
  sql: string;
  values: readonly unknown[];
}>;

const d1Result = (results: readonly unknown[] = []): D1Result => ({
  success: true,
  results: [...results],
  meta: {} as D1Meta & Record<string, unknown>,
});

class FixtureServingDatabase {
  readonly mappings = new Map<string, Record<string, unknown>>();
  proof: Record<string, unknown> | undefined;
  loseNextMappingResponse = false;
  nextBatch?: unknown;
  sessionFailure?: Error;
  reconciliationFailure?: Error;
  readonly sql: string[] = [];

  constructor(private readonly archive: TrustedModelSlugHistoryArchiveProof) {}

  readonly binding = {
    withSession: (constraint?: D1SessionConstraint) => {
      void constraint;
      if (this.sessionFailure !== undefined) throw this.sessionFailure;
      return {
        prepare: (sql: string) => this.statement({ sql, values: [] }),
        batch: (statements: D1PreparedStatement[]) =>
          this.batch(statements as unknown as CapturedStatement[]),
        getBookmark: () => "fixture-bookmark",
      };
    },
  } as unknown as D1Database;

  private statement(captured: CapturedStatement): D1PreparedStatement {
    return {
      sql: captured.sql,
      values: captured.values,
      bind: (...values: unknown[]) =>
        this.statement({ sql: captured.sql, values }),
      all: () => this.all(captured),
      run: () => this.run(captured),
    } as unknown as D1PreparedStatement;
  }

  private batch(statements: readonly CapturedStatement[]): Promise<D1Result[]> {
    this.sql.push(...statements.map((statement) => statement.sql));
    if (
      this.reconciliationFailure !== undefined &&
      this.mappings.size > 0 &&
      this.proof === undefined
    )
      return Promise.reject(this.reconciliationFailure);
    if (this.nextBatch !== undefined) {
      const result = this.nextBatch;
      this.nextBatch = undefined;
      return Promise.resolve(result as D1Result[]);
    }
    if (statements[0]?.sql.startsWith("SELECT\n  candidate.state")) {
      return Promise.resolve([
        d1Result([
          {
            state: "building",
            closure_hash: this.archive.closureHash,
            generated_at_ms: this.archive.publicationBoundaryMs,
            staging_revision: 0,
            sealed: 0,
          },
        ]),
        d1Result(this.proof === undefined ? [] : [this.proof]),
      ]);
    }
    return Promise.resolve(
      statements.map((statement) => {
        const slug = String(statement.values[1]);
        const row = this.mappings.get(slug);
        return d1Result(row === undefined ? [] : [row]);
      }),
    );
  }

  private all(statement: CapturedStatement): Promise<D1Result> {
    this.sql.push(statement.sql);
    const cursor = String(statement.values[1]);
    const rows = [...this.mappings.values()]
      .filter((row) => String(row.slug) > cursor)
      .sort((left, right) =>
        String(left.slug).localeCompare(String(right.slug)),
      )
      .slice(0, 257);
    return Promise.resolve(d1Result(rows));
  }

  private run(statement: CapturedStatement): Promise<D1Result> {
    this.sql.push(statement.sql);
    if (
      statement.sql.startsWith("INSERT INTO publication_model_slug_mapping")
    ) {
      const payload = JSON.parse(String(statement.values[0])) as Record<
        string,
        unknown
      >[];
      for (const row of payload)
        if (!this.mappings.has(String(row.slug))) {
          this.mappings.set(String(row.slug), {
            slug: row.slug,
            model_id: row.model_id,
            projection_version: row.projection_version,
            resolution: row.resolution,
            target_content_hash: row.target_content_hash,
          });
        }
      if (this.loseNextMappingResponse) {
        this.loseNextMappingResponse = false;
        return Promise.reject(new Error("TOP-SECRET lost mapping response"));
      }
      return Promise.resolve(d1Result());
    }
    const value = statement.values;
    this.proof = {
      publication_id: value[0],
      staging_revision: value[1],
      artifact_version: value[2],
      acquisition_version: value[3],
      projection_version: value[4],
      base_bundle_hash: value[5],
      closure_hash: value[6],
      publication_boundary_ms: value[7],
      artifact_digest: value[8],
      artifact_byte_count: value[9],
      model_count: value[10],
      source_history_count: value[11],
      source_history_hash: value[12],
      mapping_count: value[13],
      current_mapping_count: value[14],
      historical_mapping_count: value[15],
      mapping_inventory_hash: value[16],
    };
    return Promise.resolve(d1Result());
  }
}

let archive: TrustedModelSlugHistoryArchiveProof;

beforeAll(async () => {
  const candidate = await createModelSlugHistoryCandidateFixture();
  archive = await archiveModelSlugHistoryCandidate(
    new FixtureArchiveBucket().binding,
    candidate,
  );
});

const expectStaticError = async (
  operation: Promise<unknown>,
  code: ModelSlugHistoryStagingError["code"],
): Promise<void> => {
  const error = await operation.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ModelSlugHistoryStagingError);
  expect(error).toMatchObject({
    code,
    message: "Archived Model slug history could not be staged safely.",
  });
  expect(String(error)).not.toContain("TOP-SECRET");
  expect(String(error)).not.toContain(archive.publicationId);
};

describe("Model slug-history serving staging", () => {
  it("applies exact rows, proves forced-index hit/miss, and retries idempotently", async () => {
    const database = new FixtureServingDatabase(archive);
    const applied = await stageModelSlugHistoryArchive(
      database.binding,
      archive,
    );
    expect(applied.outcome).toBe("applied");
    expect(() => {
      assertModelSlugServingProof(applied.proof);
    }).not.toThrow();
    expect(database.mappings.size).toBe(archive.projection.mappingCount);
    expect(database.proof?.base_bundle_hash).toBe(archive.baseBundleHash);
    expect(database.sql.some((sql) => sql.includes("INDEXED BY"))).toBe(true);
    expect(
      database.sql.some(
        (sql) =>
          sql.includes("slug > ?2") &&
          sql.includes("ORDER BY slug, model_id") &&
          sql.includes("LIMIT 257"),
      ),
    ).toBe(true);
    const mappingWrites = database.sql.filter((sql) =>
      sql.startsWith("INSERT INTO publication_model_slug_mapping"),
    ).length;
    await expect(
      stageModelSlugHistoryArchive(database.binding, archive),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    expect(
      database.sql.filter((sql) =>
        sql.startsWith("INSERT INTO publication_model_slug_mapping"),
      ),
    ).toHaveLength(mappingWrites);
  });

  it("reports a committed mapping chunk without its final proof as safely retryable", async () => {
    const database = new FixtureServingDatabase(archive);
    database.loseNextMappingResponse = true;
    await expectStaticError(
      stageModelSlugHistoryArchive(database.binding, archive),
      "not_applied",
    );
    expect(database.mappings.size).toBe(archive.projection.mappingCount);
    expect(database.proof).toBeUndefined();
    await expect(
      stageModelSlugHistoryArchive(database.binding, archive),
    ).resolves.toMatchObject({ outcome: "applied" });
  });

  it("rejects a conflicting partial mapping and never writes a proof", async () => {
    const database = new FixtureServingDatabase(archive);
    const expected = archive.projection.mappings[0];
    if (expected === undefined) throw new Error("fixture lacks a mapping");
    database.mappings.set(expected.slug, {
      slug: expected.slug,
      model_id: expected.modelId,
      projection_version: expected.projectionVersion,
      resolution: expected.resolution,
      target_content_hash: `sha256:${"f".repeat(64)}`,
    });
    await expectStaticError(
      stageModelSlugHistoryArchive(database.binding, archive),
      "conflict",
    );
    expect(database.proof).toBeUndefined();
  });

  it("rejects accessors, prototypes, symbols, sparse arrays, and inexact success without executing getters", async () => {
    let getterCalls = 0;
    const accessorResult = { success: true, meta: {} };
    Object.defineProperty(accessorResult, "results", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return [];
      },
    });
    const inheritedResult = Object.create({ visitor: "TOP-SECRET" }) as Record<
      string,
      unknown
    >;
    Object.assign(inheritedResult, d1Result());
    const symbolResult = d1Result();
    Object.defineProperty(symbolResult, Symbol("visitor"), {
      enumerable: true,
      value: "TOP-SECRET",
    });
    const sparseResults = new Array(1);
    for (const hostile of [
      accessorResult,
      inheritedResult,
      symbolResult,
      { success: 1, results: [], meta: {} },
      { success: true, results: sparseResults, meta: {} },
    ]) {
      const database = new FixtureServingDatabase(archive);
      database.nextBatch = [hostile, d1Result()];
      await expectStaticError(
        stageModelSlugHistoryArchive(database.binding, archive),
        "outcome_unknown",
      );
    }
    expect(getterCalls).toBe(0);
  });

  it("does not trust forged exported errors and classifies unreadable reconciliation as unknown", async () => {
    const forged = new ModelSlugHistoryStagingError("conflict");
    forged.message = `TOP-SECRET ${archive.publicationId}`;
    const forgedDatabase = new FixtureServingDatabase(archive);
    forgedDatabase.sessionFailure = forged;
    await expectStaticError(
      stageModelSlugHistoryArchive(forgedDatabase.binding, archive),
      "outcome_unknown",
    );

    const ambiguousDatabase = new FixtureServingDatabase(archive);
    ambiguousDatabase.loseNextMappingResponse = true;
    ambiguousDatabase.reconciliationFailure = new Error(
      `TOP-SECRET ${archive.publicationId}`,
    );
    await expectStaticError(
      stageModelSlugHistoryArchive(ambiguousDatabase.binding, archive),
      "outcome_unknown",
    );
  });

  it("keeps chunk plans within fixed request/total/count bounds and rejects non-nominal inputs", async () => {
    const plan = planModelSlugMappingChunks(archive);
    expect(Object.keys(plan)).toEqual([
      "chunkCount",
      "maximumPayloadBytes",
      "retainedHeapEstimateBytes",
      "totalBytes",
    ]);
    expect(plan.chunkCount).toBeLessThanOrEqual(
      MODEL_SLUG_HISTORY_D1_MAX_CHUNKS,
    );
    expect(plan.maximumPayloadBytes).toBeLessThanOrEqual(
      MODEL_SLUG_HISTORY_D1_MAX_PAYLOAD_BYTES,
    );
    expect(plan.totalBytes).toBeLessThanOrEqual(
      MODEL_SLUG_HISTORY_D1_MAX_TOTAL_PAYLOAD_BYTES,
    );
    expect(plan.retainedHeapEstimateBytes).toBe(
      estimateModelSlugHistoryStagingRetainedHeapBytes(
        archive.projection.mappings,
      ),
    );
    expect(plan.retainedHeapEstimateBytes).toBeLessThanOrEqual(
      MODEL_SLUG_HISTORY_STAGING_MAX_RETAINED_HEAP_BYTES,
    );
    await expectStaticError(
      stageModelSlugHistoryArchive(
        new FixtureServingDatabase(archive).binding,
        {
          ...archive,
          artifactByteCount: Number.MAX_SAFE_INTEGER,
        },
      ),
      "integrity_failure",
    );
  });
});
