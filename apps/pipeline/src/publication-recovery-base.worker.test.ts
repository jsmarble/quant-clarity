import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { checkProviderContract } from "@quant-clarity/contracts";

import { createReadyPublicationFixture } from "../test/serving-switch-fixture.js";
import { createAcceptedBoundPublicationRecoveryFixture } from "../test/publication-recovery-accepted-bound-fixture.js";
import {
  PUBLICATION_RECOVERY_BASE_CONTENT_TYPE,
  PUBLICATION_RECOVERY_BASE_FORMAT,
  PUBLICATION_RECOVERY_BASE_MAX_OBJECTS,
  PUBLICATION_RECOVERY_BASE_MAX_OBJECT_BYTES,
  PUBLICATION_RECOVERY_BASE_MAX_TOTAL_BYTES,
  PUBLICATION_RECOVERY_BASE_MAX_TOTAL_ROWS,
  PUBLICATION_RECOVERY_BASE_RETENTION_CLASS,
  PUBLICATION_RECOVERY_BASE_RETAINED_HEAP_BUDGET,
  PUBLICATION_RECOVERY_CHUNK_CONTENT_TYPE,
  PublicationRecoveryBaseError,
  archivePublicationRecoveryBase,
  assertVerifiedPublicationRecoveryBase,
  publicationRecoveryBaseObjectKey,
  verifyPublicationRecoveryBase,
} from "./publication-recovery-base.js";

const PUBLICATION_ID = "pub_22222222-2222-4222-8222-222222222222" as const;
const GENERATED_AT_MS = Date.parse("2026-08-03T01:00:00.000Z");

describe("publication recovery base on pinned workerd R2", () => {
  it("round-trips the joint worst accepted byte and row shape within the retained-heap budget", async () => {
    const source = await createAcceptedBoundPublicationRecoveryFixture(
      "pub_11111111-1111-4111-8111-111111111111",
      GENERATED_AT_MS,
    );
    const locator = await archivePublicationRecoveryBase(
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      "test",
      source.manifest,
      source.rows,
    );
    const firstInventory = (
      await env.MODEL_SLUG_ARCHIVE_BUCKET.list({
        prefix: `private/publication-recovery-base/v1/test/${locator.publicationId}/`,
      })
    ).objects.map((object) => ({
      etag: object.etag,
      key: object.key,
      size: object.size,
    }));
    const repeatedLocator = await archivePublicationRecoveryBase(
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      "test",
      source.manifest,
      source.rows,
    );
    expect(repeatedLocator).toEqual(locator);
    const repeatedInventory = (
      await env.MODEL_SLUG_ARCHIVE_BUCKET.list({
        prefix: `private/publication-recovery-base/v1/test/${locator.publicationId}/`,
      })
    ).objects.map((object) => ({
      etag: object.etag,
      key: object.key,
      size: object.size,
    }));
    expect(repeatedInventory).toEqual(firstInventory);

    const authority = await verifyPublicationRecoveryBase(
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      repeatedLocator,
    );
    expect(() => {
      assertVerifiedPublicationRecoveryBase(authority);
    }).not.toThrow();
    expect(authority.manifest).toEqual(source.manifest);
    const offeringRows = authority.closureRows.resources.filter(
      (resource) => resource.resource_type === "offering",
    );
    const providerRow = authority.closureRows.resources.find(
      (resource) => resource.resource_type === "provider",
    );
    if (providerRow === undefined)
      throw new Error("accepted-bound retained Provider is missing");
    const provider = JSON.parse(providerRow.resource_json) as unknown;
    if (!checkProviderContract(provider))
      throw new Error("accepted-bound retained Provider is invalid");
    expect(offeringRows).toHaveLength(0);
    expect(provider.active_offering_count.value).toBe(offeringRows.length);
    expect(
      provider.precision_coverage.known_count +
        provider.precision_coverage.unknown_count,
    ).toBe(offeringRows.length);
    expect(provider.precision_coverage.known_proportion_decimal).toBe("0");
    const retainedEvidenceIds = new Set(
      authority.closureRows.resources
        .filter((resource) => resource.resource_type === "evidence_summary")
        .map((resource) => resource.resource_id),
    );
    for (const fact of [
      provider.slug,
      provider.display_name,
      provider.official_site,
      provider.status,
      provider.last_successful_refresh,
    ])
      for (const evidenceId of fact.evidence_ids)
        expect(retainedEvidenceIds.has(evidenceId)).toBe(true);

    const rootKey = publicationRecoveryBaseObjectKey({
      environment: locator.environment,
      publicationId: locator.publicationId,
      relation: "manifest",
      ordinal: 0,
      digest: locator.rootDigest,
    });
    const root = await env.MODEL_SLUG_ARCHIVE_BUCKET.get(rootKey);
    if (root === null) throw new Error("accepted-bound recovery root missing");
    const manifest = await root.json<{
      total_row_count: number;
      total_byte_count: number;
      sources: readonly {
        source: string;
        row_count: number;
        chunk_count: number;
        byte_count: number;
        chunks: readonly {
          ordinal: number;
          row_count: number;
          byte_count: number;
          artifact_digest: string;
          object_key: string;
        }[];
      }[];
    }>();
    const descriptors = manifest.sources.flatMap((sourceDescriptor) =>
      sourceDescriptor.chunks.map((chunk) => ({
        ...chunk,
        source: sourceDescriptor.source,
      })),
    );
    const totalBytes = manifest.total_byte_count + locator.rootByteCount;
    const objectCount = descriptors.length + 1;
    const productionAdmissionEstimate =
      8 * 1_024 * 1_024 +
      manifest.total_byte_count * 2 +
      manifest.total_row_count * 512;
    const includingRootEstimate =
      8 * 1_024 * 1_024 + totalBytes * 2 + manifest.total_row_count * 512;
    expect(manifest.total_row_count).toBe(
      PUBLICATION_RECOVERY_BASE_MAX_TOTAL_ROWS,
    );
    expect(totalBytes).toBeLessThanOrEqual(
      PUBLICATION_RECOVERY_BASE_MAX_TOTAL_BYTES,
    );
    expect(totalBytes).toBe(25_148_376);
    expect(PUBLICATION_RECOVERY_BASE_MAX_TOTAL_BYTES - totalBytes).toBeLessThan(
      64 * 1_024,
    );
    expect(objectCount).toBe(18);
    expect(objectCount).toBeLessThanOrEqual(
      PUBLICATION_RECOVERY_BASE_MAX_OBJECTS,
    );
    expect(productionAdmissionEstimate).toBe(84_267_088);
    expect(productionAdmissionEstimate).toBeLessThanOrEqual(
      PUBLICATION_RECOVERY_BASE_RETAINED_HEAP_BUDGET,
    );
    expect(includingRootEstimate).toBe(84_285_360);
    expect(includingRootEstimate).toBeLessThanOrEqual(
      PUBLICATION_RECOVERY_BASE_RETAINED_HEAP_BUDGET,
    );

    expect(
      manifest.sources.reduce(
        (sum, sourceDescriptor) => sum + sourceDescriptor.row_count,
        0,
      ),
    ).toBe(manifest.total_row_count);
    expect(
      manifest.sources.reduce(
        (sum, sourceDescriptor) => sum + sourceDescriptor.byte_count,
        0,
      ),
    ).toBe(manifest.total_byte_count);
    expect(
      descriptors.reduce((sum, descriptor) => sum + descriptor.byte_count, 0),
    ).toBe(manifest.total_byte_count);
    expect(
      Math.max(...descriptors.map((descriptor) => descriptor.byte_count)),
    ).toBeGreaterThan(PUBLICATION_RECOVERY_BASE_MAX_OBJECT_BYTES - 64 * 1_024);
    expect(
      Math.max(...descriptors.map((descriptor) => descriptor.byte_count)),
    ).toBeLessThanOrEqual(PUBLICATION_RECOVERY_BASE_MAX_OBJECT_BYTES);

    const expectedKeys = [
      rootKey,
      ...descriptors.map((value) => value.object_key),
    ].sort();
    expect(firstInventory.map((value) => value.key).sort()).toEqual(
      expectedKeys,
    );
    expect(root.size).toBe(locator.rootByteCount);
    expect(root.httpMetadata?.contentType).toBe(
      PUBLICATION_RECOVERY_BASE_CONTENT_TYPE,
    );
    expect(root.httpMetadata?.cacheControl).toBe("private, no-store");
    const rootBodyHash = root.customMetadata?.["body-sha256"];
    expect(rootBodyHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(root.customMetadata).toEqual({
      "artifact-digest": locator.rootDigest,
      "artifact-format": PUBLICATION_RECOVERY_BASE_FORMAT,
      "body-sha256": rootBodyHash,
      "byte-count": String(locator.rootByteCount),
      environment: "test",
      "object-kind": "root_manifest",
      ordinal: "0",
      "publication-id": locator.publicationId,
      relation: "manifest",
      "retention-class": PUBLICATION_RECOVERY_BASE_RETENTION_CLASS,
    });
    for (const descriptor of descriptors) {
      const object = await env.MODEL_SLUG_ARCHIVE_BUCKET.get(
        descriptor.object_key,
      );
      if (object === null)
        throw new Error("accepted-bound recovery chunk is missing");
      expect(object.key).toBe(descriptor.object_key);
      expect(object.size).toBe(descriptor.byte_count);
      expect(object.httpMetadata?.contentType).toBe(
        PUBLICATION_RECOVERY_CHUNK_CONTENT_TYPE,
      );
      expect(object.httpMetadata?.cacheControl).toBe("private, no-store");
      const bodyHash = object.customMetadata?.["body-sha256"];
      expect(bodyHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(object.customMetadata).toEqual({
        "artifact-digest": descriptor.artifact_digest,
        "artifact-format": PUBLICATION_RECOVERY_BASE_FORMAT,
        "body-sha256": bodyHash,
        "byte-count": String(descriptor.byte_count),
        environment: "test",
        "object-kind": "source_chunk",
        ordinal: String(descriptor.ordinal),
        "publication-id": locator.publicationId,
        relation: descriptor.source,
        "retention-class": PUBLICATION_RECOVERY_BASE_RETENTION_CLASS,
      });
    }
  }, 120_000);

  it("creates, rereads, frames, and semantically replays the exact source set", async () => {
    const source = await createReadyPublicationFixture(
      PUBLICATION_ID,
      GENERATED_AT_MS,
    );
    const locator = await archivePublicationRecoveryBase(
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      "test",
      source.manifest,
      source.rows,
    );
    const authority = await verifyPublicationRecoveryBase(
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      locator,
    );
    expect(() => {
      assertVerifiedPublicationRecoveryBase(authority);
    }).not.toThrow();
    expect(authority.manifest).toEqual(source.manifest);

    const rootKey = publicationRecoveryBaseObjectKey({
      environment: locator.environment,
      publicationId: locator.publicationId,
      relation: "manifest",
      ordinal: 0,
      digest: locator.rootDigest,
    });
    const root = await env.MODEL_SLUG_ARCHIVE_BUCKET.get(rootKey);
    if (root === null) throw new Error("fixture recovery root is missing");
    const manifest = await root.json<{
      sources: readonly {
        chunks: readonly { object_key: string }[];
      }[];
    }>();
    const chunkKey = manifest.sources
      .flatMap((sourceDescriptor) => sourceDescriptor.chunks)
      .at(0)?.object_key;
    if (chunkKey === undefined)
      throw new Error("fixture recovery chunk is missing");
    const chunk = await env.MODEL_SLUG_ARCHIVE_BUCKET.get(chunkKey);
    if (chunk === null) throw new Error("fixture recovery chunk is missing");
    const bytes = new Uint8Array(await chunk.arrayBuffer());
    const header = new TextEncoder().encode("publication-recovery-chunk@1\n");
    expect(bytes.subarray(0, header.byteLength)).toEqual(header);
  });

  it("rejects an exact-key chunk whose stored body was corrupted", async () => {
    const source = await createReadyPublicationFixture(
      "pub_33333333-3333-4333-8333-333333333333",
      GENERATED_AT_MS,
    );
    const locator = await archivePublicationRecoveryBase(
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      env.MODEL_SLUG_ARCHIVE_BUCKET,
      "test",
      source.manifest,
      source.rows,
    );
    const rootKey = publicationRecoveryBaseObjectKey({
      environment: locator.environment,
      publicationId: locator.publicationId,
      relation: "manifest",
      ordinal: 0,
      digest: locator.rootDigest,
    });
    const root = await env.MODEL_SLUG_ARCHIVE_BUCKET.get(rootKey);
    if (root === null) throw new Error("fixture recovery root is missing");
    const manifest = await root.json<{
      sources: readonly {
        chunks: readonly { object_key: string }[];
      }[];
    }>();
    const chunkKey = manifest.sources
      .flatMap((sourceDescriptor) => sourceDescriptor.chunks)
      .at(0)?.object_key;
    if (chunkKey === undefined)
      throw new Error("fixture recovery chunk is missing");
    const chunk = await env.MODEL_SLUG_ARCHIVE_BUCKET.get(chunkKey);
    if (chunk === null) throw new Error("fixture recovery chunk is missing");
    const bytes = new Uint8Array(await chunk.arrayBuffer());
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    if (chunk.httpMetadata === undefined || chunk.customMetadata === undefined)
      throw new Error("fixture recovery metadata is missing");
    await env.MODEL_SLUG_ARCHIVE_BUCKET.put(chunkKey, bytes, {
      httpMetadata: chunk.httpMetadata,
      customMetadata: chunk.customMetadata,
    });

    await expect(
      verifyPublicationRecoveryBase(env.MODEL_SLUG_ARCHIVE_BUCKET, locator),
    ).rejects.toEqual(new PublicationRecoveryBaseError("integrity_failure"));
  });
});
