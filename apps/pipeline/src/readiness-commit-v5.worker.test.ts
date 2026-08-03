import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { archiveModelSlugHistoryCandidate } from "./model-slug-history-archive.js";
import { stageModelSlugHistoryArchive } from "./model-slug-history-staging.js";
import { mintModelSlugLifecycleAuthorityV5 } from "./model-slug-lifecycle-authority.js";
import { applyModelVariantNameSearchStagingV1 } from "./model-variant-name-search-staging.js";
import { applyProviderModelIdSearchStagingV1 } from "./provider-model-id-search-staging.js";
import { applyProviderSearchStagingV2 } from "./provider-search-staging.js";
import {
  ReadinessCommitV5Error,
  applyReadinessCommitV5,
} from "./readiness-commit-v5.js";
import { createModelSlugHistoryCandidateForAssembly } from "../test/model-slug-history-candidate-fixture.js";
import { seedModelVariantNameSearchBuildingPublication } from "../test/model-variant-name-search-fixture.js";
import {
  createServingV5Fixture,
  createZeroModelServingV5Fixture,
  type ServingV5Fixture,
} from "../test/serving-switch-v5-fixture.js";
import { sealServingV4Fixture } from "../test/serving-switch-v4-fixture.js";
import { createProviderModelIdSearchFixture } from "../test/provider-model-id-search-fixture.js";

const archiveBucket = (
  env as typeof env & Readonly<{ MODEL_SLUG_ARCHIVE_BUCKET: R2Bucket }>
).MODEL_SLUG_ARCHIVE_BUCKET;

const prepare = async (
  sequence: number,
  generatedAtMs = Date.now() - 10 * 60_000 + sequence,
  zeroModel = false,
  multipleModels = false,
): Promise<
  Readonly<{
    fixture: ServingV5Fixture;
    authority: ReturnType<typeof mintModelSlugLifecycleAuthorityV5>;
  }>
> => {
  const publicationId =
    `pub_f5000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}` as const;
  const providerFixture = multipleModels
    ? await createProviderModelIdSearchFixture(
        publicationId,
        generatedAtMs,
        undefined,
        false,
        ["Alpha Model", "Beta Model"],
      )
    : undefined;
  const initial = zeroModel
    ? await createZeroModelServingV5Fixture(publicationId, generatedAtMs)
    : await createServingV5Fixture(
        publicationId,
        generatedAtMs,
        undefined,
        providerFixture,
      );
  const candidate = await createModelSlugHistoryCandidateForAssembly(
    {
      manifest: initial.v4.base.manifest,
      resources: initial.v4.base.closureRows.resources.filter(
        (resource) => resource.resource_type === "model",
      ),
    },
    initial.historyRows,
  );
  const operationalArchive = await archiveModelSlugHistoryCandidate(
    archiveBucket,
    candidate,
  );
  const fixture = zeroModel
    ? await createZeroModelServingV5Fixture(
        publicationId,
        generatedAtMs,
        operationalArchive,
      )
    : await createServingV5Fixture(
        publicationId,
        generatedAtMs,
        operationalArchive,
        providerFixture,
      );
  await seedModelVariantNameSearchBuildingPublication(
    env.SERVING_DB,
    fixture.v4.base,
  );
  await applyProviderSearchStagingV2(
    env.SERVING_DB,
    fixture.v4.providerStaging,
  );
  await applyModelVariantNameSearchStagingV1(
    env.SERVING_DB,
    fixture.v4.base.staging,
  );
  await applyProviderModelIdSearchStagingV1(
    env.SERVING_DB,
    fixture.v4.providerModelIdStaging,
  );
  const operationalServing = (
    await stageModelSlugHistoryArchive(env.SERVING_DB, operationalArchive)
  ).proof;
  await sealServingV4Fixture(env.SERVING_DB, fixture.v4);
  return Object.freeze({
    fixture,
    authority: mintModelSlugLifecycleAuthorityV5({
      operationalArchiveProof: operationalArchive,
      operationalServingProof: operationalServing,
      archiveProof: fixture.archiveProof,
      servingProof: fixture.servingProof,
    }),
  });
};

const withLostResponse = (database: D1Database): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          const result = await session.batch(statements);
          if (!injected && statements.length === 16) {
            injected = true;
            throw new Error("simulated lost response");
          }
          return result;
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const withDelayedMutation = (
  database: D1Database,
  delayMs: number,
): D1Database =>
  ({
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          if (statements.length === 16)
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          return session.batch(statements);
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  }) as D1Database;

const withAbortedStatement = (
  database: D1Database,
  ordinal: number,
): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        batch(statements: D1PreparedStatement[]) {
          if (injected || statements.length !== 16)
            return session.batch(statements);
          injected = true;
          return session.batch([
            ...statements.slice(0, ordinal),
            session.prepare("SELECT json('')"),
            ...statements.slice(ordinal + 1),
          ]);
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const withCurrentIndexDriftAtMutation = (database: D1Database): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          if (!injected && statements.length === 16) {
            injected = true;
            await database
              .prepare("DROP INDEX publication_model_slug_current_model_idx")
              .run();
            await database
              .prepare(
                `CREATE UNIQUE INDEX publication_model_slug_current_model_idx
                 ON publication_model_slug_mapping(publication_id, model_id)
                 WHERE resolution = 'current'
                    OR model_id = 'mdl_ffffffff-ffff-4fff-8fff-ffffffffffff'`,
              )
              .run();
          }
          return session.batch(statements);
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

type HostileReadinessSnapshot = (batch: readonly unknown[]) => unknown;
type HostileSnapshotScenario = Readonly<{
  label: string;
  transform: HostileReadinessSnapshot;
}>;

const withHostileReadinessSnapshot = (
  database: D1Database,
  transform: HostileReadinessSnapshot,
): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare: (sql: string) => session.prepare(sql),
        async batch(statements: D1PreparedStatement[]) {
          const result = await session.batch(statements);
          if (!injected && statements.length === 10) {
            injected = true;
            return transform(result) as typeof result;
          }
          return result;
        },
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const withModelSlugVerifierFailure = (database: D1Database): D1Database => {
  let injected = false;
  return {
    withSession(constraint?: D1SessionConstraint) {
      const session = database.withSession(constraint);
      return {
        prepare(sql: string) {
          const prepared = session.prepare(sql);
          if (injected || !sql.startsWith("SELECT schema_version"))
            return prepared;
          injected = true;
          return {
            all: () =>
              Promise.reject(new Error("simulated operational D1 failure")),
          } as D1PreparedStatement;
        },
        batch: (statements: D1PreparedStatement[]) => session.batch(statements),
        getBookmark: () => session.getBookmark(),
      };
    },
  } as D1Database;
};

const replaceFirst = (
  batch: readonly unknown[],
  replacement: unknown,
): unknown[] => [replacement, ...batch.slice(1)];

const resultEnvelope = (value: unknown): Record<string, unknown> => {
  const result = value as D1Result;
  return {
    meta: result.meta,
    results: result.results,
    success: result.success,
  };
};

const withResults = (
  value: unknown,
  results: unknown,
): Record<string, unknown> => ({
  ...resultEnvelope(value),
  results,
});

const firstResultRows = (batch: readonly unknown[]): readonly unknown[] =>
  (batch[0] as D1Result).results;

let poisonedRowGetterCalls = 0;
let poisonedRowGetTrapCalls = 0;

const lifecycleAndHead = async (publicationId: string) => {
  const [publication, head] = await env.SERVING_DB.batch([
    env.SERVING_DB.prepare(
      `SELECT state, ready_at_ms, activated_at_ms, failure_codes_json
       FROM publication WHERE publication_id = ?`,
    ).bind(publicationId),
    env.SERVING_DB.prepare(
      `SELECT active_publication_id, rollback_candidate_publication_id,
        switched_at_ms, generation FROM publication_head WHERE singleton = 1`,
    ),
  ]);
  if (publication === undefined || head === undefined)
    throw new Error("lifecycle snapshot is incomplete");
  return Object.freeze({
    publication: publication.results,
    head: head.results,
  });
};

const hostileSnapshots: readonly Readonly<{
  label: string;
  sequence: number;
  transform: HostileReadinessSnapshot;
}>[] = (
  [
    {
      label: "a batch-array prototype trap",
      transform: (batch) => {
        return new Proxy(batch, {
          get(target, key, receiver) {
            if (key === "then") return undefined;
            return Reflect.get(target, key, receiver) as unknown;
          },
          getPrototypeOf() {
            throw new Error("batch prototype trap");
          },
        });
      },
    },
    {
      label: "a sparse batch array",
      transform: (batch) => {
        const sparse = new Array<unknown>(batch.length);
        for (let index = 0; index < batch.length; index += 1)
          if (index !== 4) sparse[index] = batch[index];
        return sparse;
      },
    },
    {
      label: "an envelope ownKeys trap",
      transform: (batch) =>
        replaceFirst(
          batch,
          new Proxy(resultEnvelope(batch[0]), {
            ownKeys() {
              throw new Error("envelope ownKeys trap");
            },
          }),
        ),
    },
    {
      label: "an envelope descriptor trap",
      transform: (batch) =>
        replaceFirst(
          batch,
          new Proxy(resultEnvelope(batch[0]), {
            getOwnPropertyDescriptor() {
              throw new Error("envelope descriptor trap");
            },
          }),
        ),
    },
    {
      label: "an envelope prototype trap",
      transform: (batch) =>
        replaceFirst(
          batch,
          new Proxy(resultEnvelope(batch[0]), {
            getPrototypeOf() {
              throw new Error("envelope prototype trap");
            },
          }),
        ),
    },
    {
      label: "a revoked results array",
      transform: (batch) => {
        const revoked = Proxy.revocable(firstResultRows(batch), {});
        revoked.revoke();
        return replaceFirst(batch, withResults(batch[0], revoked.proxy));
      },
    },
    {
      label: "a sparse results array",
      transform: (batch) => {
        const rows = firstResultRows(batch);
        const sparse = new Array<unknown>(rows.length);
        for (let index = 1; index < rows.length; index += 1)
          sparse[index] = rows[index];
        return replaceFirst(batch, withResults(batch[0], sparse));
      },
    },
    {
      label: "an accessor row",
      transform: (batch) => {
        const rows = [...firstResultRows(batch)];
        const row = { ...(rows[0] as Record<string, unknown>) };
        Object.defineProperty(row, "state", {
          enumerable: true,
          get() {
            poisonedRowGetterCalls += 1;
            throw new Error("row getter must not run");
          },
        });
        rows[0] = row;
        return replaceFirst(batch, withResults(batch[0], rows));
      },
    },
    {
      label: "a revoked row",
      transform: (batch) => {
        const rows = [...firstResultRows(batch)];
        const revoked = Proxy.revocable(rows[0] as object, {});
        revoked.revoke();
        rows[0] = revoked.proxy;
        return replaceFirst(batch, withResults(batch[0], rows));
      },
    },
    {
      label: "a row get trap with an extra key",
      transform: (batch) => {
        const rows = [...firstResultRows(batch)];
        rows[0] = new Proxy(
          { ...(rows[0] as Record<string, unknown>), unexpected: 1 },
          {
            get() {
              poisonedRowGetTrapCalls += 1;
              throw new Error("row get trap must not run");
            },
          },
        );
        return replaceFirst(batch, withResults(batch[0], rows));
      },
    },
  ] satisfies readonly HostileSnapshotScenario[]
).map((scenario, index) => ({
  ...scenario,
  sequence: 300 + index,
}));

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
});

describe("schema-1.13 archive-bound readiness in pinned workerd", () => {
  it("normalizes revoked and descriptor-trap authority inputs", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => mintModelSlugLifecycleAuthorityV5(revoked.proxy)).toThrow(
      new TypeError("model slug lifecycle authority v5 input is invalid"),
    );
    const descriptorTrap = new Proxy(
      {
        archiveProof: null,
        operationalArchiveProof: null,
        operationalServingProof: null,
        servingProof: null,
      },
      {
        getOwnPropertyDescriptor() {
          throw new Error("descriptor trap");
        },
      },
    );
    expect(() => mintModelSlugLifecycleAuthorityV5(descriptorTrap)).toThrow(
      new TypeError("model slug lifecycle authority v5 input is invalid"),
    );
  });

  it("commits exact v5 evidence, remains idempotent, and rejects a raw core proof", async () => {
    const { fixture, authority } = await prepare(1);
    await expect(
      applyReadinessCommitV5(
        env.SERVING_DB,
        authority,
        fixture.readinessCommit,
      ),
    ).resolves.toMatchObject({ outcome: "applied" });
    await expect(
      applyReadinessCommitV5(
        env.SERVING_DB,
        authority,
        fixture.readinessCommit,
      ),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
    await expect(
      applyReadinessCommitV5(
        env.SERVING_DB,
        fixture.archiveProof,
        fixture.readinessCommit,
      ),
    ).rejects.toEqual(new ReadinessCommitV5Error("integrity_failure"));
    await expect(
      env.SERVING_DB.prepare(
        `SELECT candidate.state, binding.receipt_version,
          archive.model_slug_read_verified, archive.model_slug_immutable,
          serving.model_slug_queryable, serving.model_slug_exact_parity,
          probes.model_slug_lookup_passed, attestation.evaluator_version
         FROM publication AS candidate
         JOIN publication_readiness_receipt AS binding USING (publication_id)
         JOIN publication_archive_receipt AS archive USING (publication_id)
         JOIN publication_serving_receipt AS serving USING (publication_id)
         JOIN publication_probe_receipt AS probes USING (publication_id)
         JOIN publication_readiness_attestation AS attestation USING (publication_id)
         WHERE candidate.publication_id = ? LIMIT 1`,
      )
        .bind(fixture.v4.base.manifest.publicationId)
        .first(),
    ).resolves.toMatchObject({
      state: "ready",
      receipt_version: "5.0.0",
      model_slug_read_verified: 1,
      model_slug_immutable: 1,
      model_slug_queryable: 1,
      model_slug_exact_parity: 1,
      model_slug_lookup_passed: 1,
      evaluator_version: "5.0.0",
    });
  });

  it.each(hostileSnapshots)(
    "fails closed on $label without changing lifecycle or head",
    async ({ sequence, transform }) => {
      const { fixture, authority } = await prepare(sequence);
      const publicationId = fixture.v4.base.manifest.publicationId;
      const before = await lifecycleAndHead(publicationId);
      poisonedRowGetterCalls = 0;
      poisonedRowGetTrapCalls = 0;
      await expect(
        applyReadinessCommitV5(
          withHostileReadinessSnapshot(env.SERVING_DB, transform),
          authority,
          fixture.readinessCommit,
        ),
      ).rejects.toEqual(new ReadinessCommitV5Error("integrity_failure"));
      expect(poisonedRowGetterCalls).toBe(0);
      expect(poisonedRowGetTrapCalls).toBe(0);
      await expect(lifecycleAndHead(publicationId)).resolves.toEqual(before);
    },
  );

  it("preserves operational slug-verifier uncertainty without changing lifecycle or head", async () => {
    const { fixture, authority } = await prepare(399);
    const publicationId = fixture.v4.base.manifest.publicationId;
    const before = await lifecycleAndHead(publicationId);
    await expect(
      applyReadinessCommitV5(
        withModelSlugVerifierFailure(env.SERVING_DB),
        authority,
        fixture.readinessCommit,
      ),
    ).rejects.toEqual(new ReadinessCommitV5Error("outcome_unknown"));
    await expect(lifecycleAndHead(publicationId)).resolves.toEqual(before);
  });

  it("reconciles a lost mutation response", async () => {
    const { fixture, authority } = await prepare(2);
    await expect(
      applyReadinessCommitV5(
        withLostResponse(env.SERVING_DB),
        authority,
        fixture.readinessCommit,
      ),
    ).resolves.toMatchObject({ outcome: "idempotent_success" });
  });

  it("rejects an uncommitted readiness attestation after DB-clock expiry", async () => {
    const { fixture, authority } = await prepare(3, Date.now() - 63 * 60_000);
    await expect(
      applyReadinessCommitV5(
        env.SERVING_DB,
        authority,
        fixture.readinessCommit,
      ),
    ).rejects.toEqual(new ReadinessCommitV5Error("stale"));
    await expect(
      env.SERVING_DB.prepare(
        "SELECT state, ready_at_ms FROM publication WHERE publication_id = ?",
      )
        .bind(fixture.v4.base.manifest.publicationId)
        .first(),
    ).resolves.toMatchObject({ state: "building", ready_at_ms: null });
  });

  it("returns stale when readiness expires between classification and mutation", async () => {
    const { fixture, authority } = await prepare(
      4,
      Date.now() - 62 * 60_000 + 1_000,
    );
    await expect(
      applyReadinessCommitV5(
        withDelayedMutation(env.SERVING_DB, 2_200),
        authority,
        fixture.readinessCommit,
      ),
    ).rejects.toEqual(new ReadinessCommitV5Error("stale"));
    await expect(
      env.SERVING_DB.prepare(
        "SELECT state, ready_at_ms FROM publication WHERE publication_id = ?",
      )
        .bind(fixture.v4.base.manifest.publicationId)
        .first(),
    ).resolves.toMatchObject({ state: "building", ready_at_ms: null });
  });

  it("commits a zero-Model publication through structural and miss-only slug probes", async () => {
    const { fixture, authority } = await prepare(
      5,
      Date.now() - 10 * 60_000,
      true,
    );
    expect(fixture.modelSlugProjection).toMatchObject({
      modelCount: 0,
      mappingCount: 0,
      currentMappingCount: 0,
      historicalMappingCount: 0,
    });
    await expect(
      applyReadinessCommitV5(
        env.SERVING_DB,
        authority,
        fixture.readinessCommit,
      ),
    ).resolves.toMatchObject({ outcome: "applied" });
    await expect(
      env.SERVING_DB.prepare(
        `SELECT candidate.state, proof.model_count, proof.mapping_count
         FROM publication AS candidate
         JOIN publication_model_slug_artifact_proof AS proof USING(publication_id)
         WHERE candidate.publication_id = ?`,
      )
        .bind(fixture.v4.base.manifest.publicationId)
        .first(),
    ).resolves.toMatchObject({
      state: "ready",
      model_count: 0,
      mapping_count: 0,
    });
  });

  it("rejects uppercase current-index predicate drift for an empty Model projection", async () => {
    const { fixture, authority } = await prepare(
      6,
      Date.now() - 10 * 60_000,
      true,
    );
    const publicationId = fixture.v4.base.manifest.publicationId;
    const before = await lifecycleAndHead(publicationId);
    await env.SERVING_DB.prepare(
      "DROP INDEX publication_model_slug_current_model_idx",
    ).run();
    await env.SERVING_DB.prepare(
      `CREATE UNIQUE INDEX publication_model_slug_current_model_idx
       ON publication_model_slug_mapping(publication_id, model_id)
       WHERE resolution = 'CURRENT'`,
    ).run();
    try {
      await expect(
        applyReadinessCommitV5(
          env.SERVING_DB,
          authority,
          fixture.readinessCommit,
        ),
      ).rejects.toEqual(new ReadinessCommitV5Error("integrity_failure"));
      await expect(lifecycleAndHead(publicationId)).resolves.toEqual(before);
    } finally {
      await env.SERVING_DB.prepare(
        "DROP INDEX IF EXISTS publication_model_slug_current_model_idx",
      ).run();
      await env.SERVING_DB.prepare(
        `CREATE UNIQUE INDEX publication_model_slug_current_model_idx
         ON publication_model_slug_mapping(publication_id, model_id)
         WHERE resolution = 'current'`,
      ).run();
    }
  });

  it.each(Array.from({ length: 16 }, (_, index) => index))(
    "rolls back an injected failure at mutation statement %i",
    async (ordinal) => {
      const { fixture, authority } = await prepare(100 + ordinal);
      await expect(
        applyReadinessCommitV5(
          withAbortedStatement(env.SERVING_DB, ordinal),
          authority,
          fixture.readinessCommit,
        ),
      ).rejects.toEqual(new ReadinessCommitV5Error("not_applied"));
      await expect(
        env.SERVING_DB.prepare(
          "SELECT state, ready_at_ms FROM publication WHERE publication_id = ?",
        )
          .bind(fixture.v4.base.manifest.publicationId)
          .first(),
      ).resolves.toMatchObject({ state: "building", ready_at_ms: null });
    },
  );

  it("rejects a partial current index whose predicate excludes a non-first model", async () => {
    const { fixture, authority } = await prepare(
      199,
      Date.now() - 10 * 60_000,
      false,
      true,
    );
    const current = fixture.modelSlugProjection.mappings.filter(
      (mapping) => mapping.resolution === "current",
    );
    const excluded = current[1];
    if (excluded === undefined)
      throw new Error("fixture requires at least two current Model slugs");
    const excludedModelId = excluded.modelId.replaceAll("'", "''");
    await env.SERVING_DB.prepare(
      "DROP INDEX publication_model_slug_current_model_idx",
    ).run();
    await env.SERVING_DB.prepare(
      `CREATE UNIQUE INDEX publication_model_slug_current_model_idx
       ON publication_model_slug_mapping(publication_id, model_id)
       WHERE resolution = 'current' AND model_id <> '${excludedModelId}'`,
    ).run();
    try {
      await expect(
        applyReadinessCommitV5(
          env.SERVING_DB,
          authority,
          fixture.readinessCommit,
        ),
      ).rejects.toEqual(new ReadinessCommitV5Error("integrity_failure"));
      await expect(
        env.SERVING_DB.prepare(
          "SELECT state, ready_at_ms FROM publication WHERE publication_id = ?",
        )
          .bind(fixture.v4.base.manifest.publicationId)
          .first(),
      ).resolves.toMatchObject({ state: "building", ready_at_ms: null });
    } finally {
      await env.SERVING_DB.prepare(
        "DROP INDEX IF EXISTS publication_model_slug_current_model_idx",
      ).run();
      await env.SERVING_DB.prepare(
        `CREATE UNIQUE INDEX publication_model_slug_current_model_idx
         ON publication_model_slug_mapping(publication_id, model_id)
         WHERE resolution = 'current'`,
      ).run();
    }
  });

  it("rejects current-index predicate drift inside the atomic readiness batch", async () => {
    const { fixture, authority } = await prepare(198);
    try {
      await expect(
        applyReadinessCommitV5(
          withCurrentIndexDriftAtMutation(env.SERVING_DB),
          authority,
          fixture.readinessCommit,
        ),
      ).rejects.toBeInstanceOf(ReadinessCommitV5Error);
      await expect(
        env.SERVING_DB.prepare(
          "SELECT state, ready_at_ms FROM publication WHERE publication_id = ?",
        )
          .bind(fixture.v4.base.manifest.publicationId)
          .first(),
      ).resolves.toMatchObject({ state: "building", ready_at_ms: null });
    } finally {
      await env.SERVING_DB.prepare(
        "DROP INDEX IF EXISTS publication_model_slug_current_model_idx",
      ).run();
      await env.SERVING_DB.prepare(
        `CREATE UNIQUE INDEX publication_model_slug_current_model_idx
         ON publication_model_slug_mapping(publication_id, model_id)
         WHERE resolution = 'current'`,
      ).run();
    }
  });

  it("rejects same-count historical mapping substitution on exact operational readback", async () => {
    const { fixture, authority } = await prepare(200);
    expect(fixture.modelSlugProjection.historicalMappingCount).toBeGreaterThan(
      0,
    );
    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_model_slug_mapping_immutable_update",
    ).run();
    try {
      await env.SERVING_DB.prepare(
        `UPDATE publication_model_slug_mapping SET slug = slug || '-tampered'
         WHERE publication_id = ? AND resolution = 'historical'`,
      )
        .bind(fixture.v4.base.manifest.publicationId)
        .run();
      await expect(
        applyReadinessCommitV5(
          env.SERVING_DB,
          authority,
          fixture.readinessCommit,
        ),
      ).rejects.toEqual(new ReadinessCommitV5Error("integrity_failure"));
      await expect(
        env.SERVING_DB.prepare(
          "SELECT state, ready_at_ms FROM publication WHERE publication_id = ?",
        )
          .bind(fixture.v4.base.manifest.publicationId)
          .first(),
      ).resolves.toMatchObject({ state: "building", ready_at_ms: null });
    } finally {
      await env.SERVING_DB.prepare(
        `CREATE TRIGGER publication_model_slug_mapping_immutable_update
         BEFORE UPDATE ON publication_model_slug_mapping
         BEGIN SELECT RAISE(ABORT,
           'publication Model slug mappings are immutable'); END`,
      ).run();
    }
  });
});
