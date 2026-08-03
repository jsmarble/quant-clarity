import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  projectServingSwitchPreflightProofV5,
  projectServingSwitchV5,
  readProviderModelIdSearchStagingPersistenceV1,
  readProviderSearchStagingPersistenceV2,
  readServingReadinessCommitPersistenceV5,
  type PublicationRecord,
  type StoredPublicationHead,
} from "@quant-clarity/publication-core";

import {
  archiveModelSlugHistoryCandidate,
  type TrustedModelSlugHistoryArchiveProof,
} from "../../pipeline/src/model-slug-history-archive.js";
import { stageModelSlugHistoryArchive } from "../../pipeline/src/model-slug-history-staging.js";
import { mintModelSlugLifecycleAuthorityV5 } from "../../pipeline/src/model-slug-lifecycle-authority.js";
import { applyModelVariantNameSearchStagingV1 } from "../../pipeline/src/model-variant-name-search-staging.js";
import { applyProviderModelIdSearchStagingV1 } from "../../pipeline/src/provider-model-id-search-staging.js";
import { applyProviderSearchStagingV2 } from "../../pipeline/src/provider-search-staging.js";
import { applyReadinessCommitV5 } from "../../pipeline/src/readiness-commit-v5.js";
import { applyServingSwitchV5 } from "../../pipeline/src/serving-switch-v5.js";
import { createModelSlugHistoryCandidateForAssembly } from "../../pipeline/test/model-slug-history-candidate-fixture.js";
import { seedModelVariantNameSearchBuildingPublication } from "../../pipeline/test/model-variant-name-search-fixture.js";
import { sealServingV4Fixture } from "../../pipeline/test/serving-switch-v4-fixture.js";
import {
  createServingV5Fixture,
  type ServingV5Fixture,
} from "../../pipeline/test/serving-switch-v5-fixture.js";
import { resolvePublicationV2 } from "./catalog-query-rpc.js";
import {
  readModelDetailV2,
  type ReadModelDetailV2Input,
} from "./model-detail.js";
import {
  RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS,
  RETAINED_HOT_PUBLICATION_WINDOW_MS,
} from "./retained-hot-publication.js";

type StoredObject = Readonly<{
  bytes: Uint8Array<ArrayBuffer>;
  checksum: ArrayBuffer;
  customMetadata: Record<string, string>;
  httpMetadata: Readonly<{
    cacheControl: string;
    cacheExpiry: undefined;
    contentDisposition: undefined;
    contentEncoding: undefined;
    contentLanguage: undefined;
    contentType: string;
  }>;
}>;

const bytes = (value: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(
    ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : new Uint8Array(value),
  );

class MemoryArchiveBucket {
  readonly objects = new Map<string, StoredObject>();

  readonly binding = {
    put: (
      key: string,
      value: ArrayBuffer | ArrayBufferView,
      options?: R2PutOptions,
    ): Promise<R2Object | null> => {
      if (
        options?.onlyIf instanceof Headers ||
        options?.onlyIf?.etagDoesNotMatch !== "*" ||
        options.sha256 === undefined ||
        typeof options.sha256 === "string" ||
        options.httpMetadata instanceof Headers ||
        options.httpMetadata?.cacheControl === undefined ||
        options.httpMetadata.contentType === undefined
      )
        return Promise.reject(new Error("unexpected archive write"));
      if (this.objects.has(key)) return Promise.resolve(null);
      const stored = {
        bytes: bytes(value),
        checksum: bytes(options.sha256).buffer,
        customMetadata: { ...options.customMetadata },
        httpMetadata: {
          cacheControl: options.httpMetadata.cacheControl,
          cacheExpiry: undefined,
          contentDisposition: undefined,
          contentEncoding: undefined,
          contentLanguage: undefined,
          contentType: options.httpMetadata.contentType,
        },
      };
      this.objects.set(key, stored);
      return Promise.resolve(this.metadata(key, stored));
    },
    get: (key: string): Promise<R2ObjectBody | null> => {
      const stored = this.objects.get(key);
      if (stored === undefined) return Promise.resolve(null);
      const metadata = this.metadata(key, stored);
      const body = Uint8Array.from(stored.bytes);
      return Promise.resolve({
        key: metadata.key,
        version: metadata.version,
        size: metadata.size,
        etag: metadata.etag,
        httpEtag: metadata.httpEtag,
        checksums: metadata.checksums,
        uploaded: metadata.uploaded,
        httpMetadata: stored.httpMetadata as unknown as R2HTTPMetadata,
        customMetadata: stored.customMetadata,
        storageClass: metadata.storageClass,
        writeHttpMetadata: metadata.writeHttpMetadata.bind(metadata),
        body: new ReadableStream<Uint8Array<ArrayBuffer>>({
          start(controller) {
            controller.enqueue(body);
            controller.close();
          },
        }),
        bodyUsed: false,
        arrayBuffer: () => Promise.resolve(body.buffer),
        bytes: () => Promise.resolve(body),
        text: () => Promise.resolve(new TextDecoder().decode(body)),
        json: <T>() =>
          Promise.resolve(JSON.parse(new TextDecoder().decode(body)) as T),
        blob: () => Promise.resolve(new Blob([body])),
      });
    },
  } as unknown as R2Bucket;

  private metadata(key: string, stored: StoredObject): R2Object {
    return {
      key,
      version: "memory-version",
      size: stored.bytes.byteLength,
      etag: "memory-etag",
      httpEtag: '"memory-etag"',
      checksums: {
        sha256: stored.checksum,
        toJSON: () => ({ sha256: "memory-sha256" }),
      },
      uploaded: new Date(0),
      httpMetadata: stored.httpMetadata as unknown as R2HTTPMetadata,
      customMetadata: stored.customMetadata,
      storageClass: "Standard",
      writeHttpMetadata(headers: Headers) {
        void headers;
      },
    };
  }
}

type Prepared = Readonly<{
  archive: TrustedModelSlugHistoryArchiveProof;
  authority: ReturnType<typeof mintModelSlugLifecycleAuthorityV5>;
  fixture: ServingV5Fixture;
}>;

const NOW = Math.floor(Date.now() / 1_000) * 1_000;
const ACTIVATED_A = NOW - 180_000;
const ACTIVATED_B = NOW - 120_000;
const ACTIVATED_C = NOW - 60_000;
const REQUIRED_UNTIL = NOW + 60_000;
const bucket = new MemoryArchiveBucket();

const prepare = async (sequence: number): Promise<Prepared> => {
  const publicationId =
    `pub_c3000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}` as const;
  const generatedAtMs = NOW - 20 * 60_000 + sequence;
  const initial = await createServingV5Fixture(publicationId, generatedAtMs);
  const candidate = await createModelSlugHistoryCandidateForAssembly(
    {
      manifest: initial.v4.base.manifest,
      resources: initial.v4.base.closureRows.resources.filter(
        (resource) => resource.resource_type === "model",
      ),
    },
    initial.historyRows,
  );
  const archive = await archiveModelSlugHistoryCandidate(
    bucket.binding,
    candidate,
  );
  const fixture = await createServingV5Fixture(
    publicationId,
    generatedAtMs,
    archive,
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
  const serving = (await stageModelSlugHistoryArchive(env.SERVING_DB, archive))
    .proof;
  await sealServingV4Fixture(env.SERVING_DB, fixture.v4);
  const authority = mintModelSlugLifecycleAuthorityV5({
    archiveProof: fixture.archiveProof,
    operationalArchiveProof: archive,
    operationalServingProof: serving,
    servingProof: fixture.servingProof,
  });
  await applyReadinessCommitV5(
    env.SERVING_DB,
    authority,
    fixture.readinessCommit,
  );
  return { archive, authority, fixture };
};

const readyRecord = (prepared: Prepared): PublicationRecord => {
  const readiness = readServingReadinessCommitPersistenceV5(
    prepared.fixture.readinessCommit,
  );
  return {
    publicationId: prepared.fixture.v4.base.manifest.publicationId,
    closureHash: prepared.fixture.v4.base.manifest.closureHash,
    state: "ready",
    generatedAt: prepared.fixture.v4.base.manifest.generatedAt,
    readyAt: new Date(readiness.transition.ready_at_ms).toISOString(),
    firstActivatedAt: null,
    lastHeadReferencedAt: null,
  };
};

const lifecycleRecord = (
  prepared: Prepared,
  state: "active" | "superseded",
  firstActivatedAtMs: number,
): PublicationRecord => ({
  ...readyRecord(prepared),
  state,
  firstActivatedAt: new Date(firstActivatedAtMs).toISOString(),
  lastHeadReferencedAt: new Date(firstActivatedAtMs).toISOString(),
});

const head = (
  active: Prepared,
  rollback: Prepared | null,
  switchedAtMs: number,
  generation: number,
): StoredPublicationHead => ({
  activePublicationId: active.fixture.v4.base.manifest.publicationId,
  rollbackCandidatePublicationId:
    rollback?.fixture.v4.base.manifest.publicationId ?? null,
  switchedAt: new Date(switchedAtMs).toISOString(),
  generation,
});

const activation = async (
  prepared: Prepared,
  switchedAtMs: number,
  currentHead: StoredPublicationHead | null,
  currentActive: PublicationRecord | null,
) => {
  const { fixture } = prepared;
  const readiness = readServingReadinessCommitPersistenceV5(
    fixture.readinessCommit,
  );
  const provider = readProviderSearchStagingPersistenceV2(
    fixture.v4.providerStaging,
  );
  const providerModels = readProviderModelIdSearchStagingPersistenceV1(
    fixture.v4.providerModelIdStaging,
  );
  const generation = (currentHead?.generation ?? 0) + 1;
  const preflight = await projectServingSwitchPreflightProofV5({
    manifest: fixture.v4.base.manifest,
    providerProof: fixture.v4.providerProof,
    modelVariantNameProof: fixture.v4.modelProof,
    providerModelIdProof: fixture.v4.providerModelIdProof,
    modelSlugArchiveProof: fixture.archiveProof,
    modelSlugServingProof: fixture.servingProof,
    readinessProof: fixture.readinessProof,
    rollbackArchiveReceiptHash: null,
    context: {
      switchId: `publication-switch|activate|${String(generation)}|${fixture.v4.base.manifest.publicationId}|${fixture.v4.base.manifest.closureHash}`,
      action: "activate",
      expectedPriorGeneration: currentHead?.generation ?? 0,
      expectedPriorRollbackCandidatePublicationId:
        currentHead?.rollbackCandidatePublicationId ?? null,
      expectedPriorSwitchedAtMs:
        currentHead === null ? null : Date.parse(currentHead.switchedAt),
      newGeneration: generation,
      fromPublicationId: currentActive?.publicationId ?? null,
      fromClosureHash: currentActive?.closureHash ?? null,
      toPublicationId: fixture.v4.base.manifest.publicationId,
      toClosureHash: fixture.v4.base.manifest.closureHash,
      switchedAtMs,
    },
    artifactProof: {
      environment: "local",
      observedAtMs: switchedAtMs - 1_000,
      maximumAgeMs: 60 * 60_000,
      ftsBuildVersion: "fts5-unicode61@1",
      ftsSourceDocumentCount: fixture.v4.base.manifest.searchDocuments.length,
      ftsIndexDocumentCount: fixture.v4.base.manifest.searchDocuments.length,
      ftsSourceInventoryHash: fixture.v4.base.manifest.exactSearchInventoryHash,
      ftsExactParity: true,
      archiveBundleHash: fixture.v4.base.manifest.bundleHash,
      archiveImmutable: true,
      vectorNamespace: fixture.v4.base.manifest.publicationId,
      vectorDocumentCount: fixture.v4.base.manifest.vectors.length,
      vectorVerifiedDocumentCount: fixture.v4.base.manifest.vectors.length,
      vectorInventoryHash: fixture.v4.base.manifest.vectorInventoryHash,
      vectorVisibilityProbeVersion: "vector-visibility@1",
      vectorMutationId: `retained-v5-${fixture.v4.base.manifest.publicationId}`,
      vectorAllIdsPresent: true,
      vectorAllNamespacesMatch: true,
      vectorQueryable: true,
      probeSetVersion: "search-gold@5",
      integrityPassed: true,
      exactSearchPassed: true,
      semanticSearchPassed: true,
      structuredFilterPassed: true,
      neutralityPassed: true,
      versionIsolationPassed: true,
      modelSlugLookupPassed: true,
    },
  });
  return projectServingSwitchV5({
    preflight,
    target: readyRecord(prepared),
    currentHead,
    currentActive,
    authorizedBy: { kind: "pipeline", identityId: "pipeline.retained-v5" },
    closureRows: fixture.v4.base.closureRows,
    persistedSeal: fixture.v4.seal,
    persistedProviderSearchDocuments: provider.documents,
    persistedProviderSearchFtsRows: provider.ftsRows,
    persistedModelVariantNameRows: fixture.v4.base.persistence.rows,
    persistedProviderModelIdRows: providerModels.rows,
    persistedModelSlugArtifactProof: fixture.modelSlugArtifactProof,
    persistedModelSlugMappings: fixture.modelSlugMappings,
    persistedReceiptRows: readiness.receiptRows,
    persistedAttestation: readiness.attestation,
  });
};

const detailInput = (
  prepared: Prepared,
  modelId: string,
  bookmark: string,
): ReadModelDetailV2Input => ({
  audience: "quantclarity-catalog-query-v1",
  bookmark,
  environment: "local",
  envelope: {
    audience: "quantclarity-catalog-query-v1",
    continuation: null,
    environment: "local",
    filters: {},
    limit: 25,
    operation: { identifier: modelId, kind: "detail", resourceType: "model" },
    publicationId: prepared.fixture.v4.base.manifest.publicationId,
    searchPlan: null,
    sort: ["name", "stable_id"],
    version: 1,
  },
  lookup: { kind: "stable_id", value: modelId },
  requiredAvailableUntilMs: REQUIRED_UNTIL,
  version: 2,
});

let publications: readonly [Prepared, Prepared, Prepared];

beforeAll(async () => {
  await applyD1Migrations(env.SERVING_DB, env.TEST_MIGRATIONS);
  publications = await Promise.all([prepare(1), prepare(2), prepare(3)]);
});

describe("official V5 retained-hot Model detail continuity", () => {
  it("reads displaced A with a pre-C bookmark and enforces the strict cutoff", async () => {
    const [publicationA, publicationB, publicationC] = publications;
    const projectionA = await activation(publicationA, ACTIVATED_A, null, null);
    await applyServingSwitchV5(
      env.SERVING_DB,
      publicationA.authority,
      null,
      projectionA,
    );

    const headA = head(publicationA, null, ACTIVATED_A, 1);
    const activeA = lifecycleRecord(publicationA, "active", ACTIVATED_A);
    const projectionB = await activation(
      publicationB,
      ACTIVATED_B,
      headA,
      activeA,
    );
    await applyServingSwitchV5(
      env.SERVING_DB,
      publicationB.authority,
      null,
      projectionB,
    );

    const selectedA = await resolvePublicationV2(env.SERVING_DB, "local", {
      audience: "quantclarity-catalog-query-v1",
      environment: "local",
      requestedPublicationId:
        publicationA.fixture.v4.base.manifest.publicationId,
      requiredAvailableUntilMs: REQUIRED_UNTIL,
      version: 2,
    });
    if (selectedA.outcome !== "selected")
      throw new Error("A was not selected before C activation");

    const headB = head(publicationB, publicationA, ACTIVATED_B, 2);
    const activeB = lifecycleRecord(publicationB, "active", ACTIVATED_B);
    const projectionC = await activation(
      publicationC,
      ACTIVATED_C,
      headB,
      activeB,
    );
    await applyServingSwitchV5(
      env.SERVING_DB,
      publicationC.authority,
      null,
      projectionC,
    );

    const model = publicationA.fixture.v4.base.manifest.resources.find(
      (resource) => resource.resourceType === "model",
    );
    if (model === undefined) throw new Error("A fixture Model is missing");
    const input = detailInput(
      publicationA,
      model.resourceId,
      selectedA.bookmark,
    );
    await expect(
      readModelDetailV2(env.SERVING_DB, "local", input),
    ).resolves.toMatchObject({
      outcome: "model",
      publicationId: publicationA.fixture.v4.base.manifest.publicationId,
      model: { model_id: model.resourceId },
    });

    const trigger = await env.SERVING_DB.prepare(
      `SELECT sql FROM sqlite_schema WHERE type = 'trigger'
       AND name = 'publication_switch_history_immutable_update'`,
    ).first<{ sql: string }>();
    if (trigger === null) throw new Error("switch-history guard is missing");
    const originals = await env.SERVING_DB.prepare(
      `SELECT new_generation, switched_at_ms FROM publication_switch_history
       WHERE new_generation IN (2, 3) ORDER BY new_generation`,
    ).all<{ new_generation: number; switched_at_ms: number }>();
    const cutoff =
      REQUIRED_UNTIL +
      RETAINED_HOT_PUBLICATION_CLOCK_SKEW_MS -
      RETAINED_HOT_PUBLICATION_WINDOW_MS;
    await env.SERVING_DB.prepare(
      "DROP TRIGGER publication_switch_history_immutable_update",
    ).run();
    try {
      await env.SERVING_DB.prepare(
        `UPDATE publication_switch_history SET switched_at_ms = ?1
         WHERE new_generation IN (2, 3)`,
      )
        .bind(cutoff)
        .run();
      await expect(
        readModelDetailV2(env.SERVING_DB, "local", input),
      ).resolves.toEqual({ outcome: "integrity_failure" });

      await env.SERVING_DB.prepare(
        `UPDATE publication_switch_history SET switched_at_ms = CASE
           WHEN new_generation = 2 THEN ?1 ELSE ?2 END
         WHERE new_generation IN (2, 3)`,
      )
        .bind(cutoff - 1, cutoff + 1)
        .run();
      await expect(
        readModelDetailV2(env.SERVING_DB, "local", input),
      ).resolves.toMatchObject({ outcome: "model" });
    } finally {
      for (const original of originals.results)
        await env.SERVING_DB.prepare(
          `UPDATE publication_switch_history SET switched_at_ms = ?1
           WHERE new_generation = ?2`,
        )
          .bind(original.switched_at_ms, original.new_generation)
          .run();
      await env.SERVING_DB.prepare(trigger.sql).run();
    }
    await expect(
      env.SERVING_DB.prepare(
        `UPDATE publication_switch_history SET switched_at_ms = switched_at_ms
         WHERE new_generation = 2`,
      ).run(),
    ).rejects.toThrow("switch history is append-only");
  });
});
