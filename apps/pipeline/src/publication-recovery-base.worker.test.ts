import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createReadyPublicationFixture } from "../test/serving-switch-fixture.js";
import {
  PublicationRecoveryBaseError,
  archivePublicationRecoveryBase,
  assertVerifiedPublicationRecoveryBase,
  publicationRecoveryBaseObjectKey,
  verifyPublicationRecoveryBase,
} from "./publication-recovery-base.js";

const PUBLICATION_ID = "pub_22222222-2222-4222-8222-222222222222" as const;
const GENERATED_AT_MS = Date.parse("2026-08-03T01:00:00.000Z");

describe("publication recovery base on pinned workerd R2", () => {
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
