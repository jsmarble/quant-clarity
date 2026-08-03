import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { applyModelVariantNameSearchStagingV1 } from "./model-variant-name-search-staging.js";
import {
  createModelVariantNameSearchFixture,
  seedModelVariantNameSearchBuildingPublication,
} from "../test/model-variant-name-search-fixture.js";

const MIGRATION_0016 = "0016_model_slug_lifecycle.sql";
const PUBLICATION_ID = "pub_97979797-0000-4000-8000-000000000001";
const GENERATED_AT_MS = Date.UTC(2026, 7, 3, 4);
const through = (name: string) =>
  env.TEST_MIGRATIONS.filter((migration) => migration.name <= name);

describe("schema-1.13 seal authority in pinned workerd", () => {
  it("refuses a complete base seal when the sidecar proof is absent", async () => {
    await applyD1Migrations(env.SERVING_DB, through(MIGRATION_0016));
    const fixture = await createModelVariantNameSearchFixture(
      PUBLICATION_ID,
      GENERATED_AT_MS,
      "Unproven Model",
    );
    await seedModelVariantNameSearchBuildingPublication(
      env.SERVING_DB,
      fixture,
    );
    await applyModelVariantNameSearchStagingV1(env.SERVING_DB, fixture.staging);
    const seal = fixture.closureRows;
    await expect(
      env.SERVING_DB.prepare(
        `INSERT INTO publication_closure_seal VALUES (
          ?, ?, ?, 'publication-closure', '1', ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`,
      )
        .bind(
          fixture.manifest.publicationId,
          seal.stagingRevision,
          seal.manifestContractVersion,
          seal.enabledProviderScopeVersion,
          fixture.manifest.enabledProviderIds.length,
          seal.providerSlices.length,
          seal.providerAttributions.length,
          fixture.manifest.resources.length,
          fixture.manifest.searchDocuments.length,
          fixture.manifest.vectors.length,
          fixture.manifest.chunks.length,
          seal.bundleHash,
          fixture.manifest.enabledProviderScopeHash,
          fixture.manifest.providerSliceHash,
          fixture.manifest.providerAttributionHash,
          fixture.manifest.resourceInventoryHash,
          fixture.manifest.exactSearchInventoryHash,
          fixture.manifest.vectorInventoryHash,
          fixture.manifest.chunkRootHash,
          fixture.manifest.closureHash,
          seal.sealedAtMs,
        )
        .run(),
    ).rejects.toThrow(
      "seal lacks an exact archive-bound Model slug projection",
    );
  });
});
