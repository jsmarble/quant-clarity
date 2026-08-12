import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  acquireModelSlugHistoryCandidate,
  assertModelSlugHistoryCandidateCapture,
  type ModelSlugHistoryAcquisitionPorts,
  type ModelSlugHistoryPublicationAssembly,
} from "./model-slug-history-acquisition.js";
import { createModelVariantNameSearchFixture } from "../test/model-variant-name-search-fixture.js";

const PUBLICATION_ID = "pub_82222222-2222-4222-8222-222222222222";
const BOUNDARY_MS = Date.parse("2026-08-03T02:00:00.000Z");
const MODEL_ID = "mdl_00000001-0000-4000-8000-000000000001";
const FAMILY_ID = "fam_00000001-0000-4000-8000-000000000001";
const PROVIDER_ID = "prv_00000001-0000-4000-8000-000000000001";
const CURRENT_HISTORY_ID = "slg_00000001-0000-4000-8000-000000000001";
const FUTURE_HISTORY_ID = "slg_00000002-0000-4000-8000-000000000001";

let assembly: ModelSlugHistoryPublicationAssembly;

const statement = (
  database: D1Database,
  sql: string,
  values: readonly unknown[] = [],
): D1PreparedStatement => database.prepare(sql).bind(...values);

const ports = (): ModelSlugHistoryAcquisitionPorts => ({
  async withWriterDrain<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  },
  assemblePublication() {
    return Promise.resolve(assembly);
  },
});

const observedSessionConstraints: D1SessionConstraint[] = [];
const observedDatabase = {
  withSession(constraint?: D1SessionConstraint) {
    if (constraint !== undefined) observedSessionConstraints.push(constraint);
    return env.CANONICAL_DB.withSession(constraint);
  },
} as D1Database;

beforeAll(async () => {
  await applyD1Migrations(env.CANONICAL_DB, env.CANONICAL_MIGRATIONS);
  const fixture = await createModelVariantNameSearchFixture(
    PUBLICATION_ID,
    BOUNDARY_MS,
    "Alpha Model",
  );
  assembly = Object.freeze({
    manifest: fixture.manifest,
    resources: fixture.closureRows.resources.filter(
      (resource) => resource.resource_type === "model",
    ),
  });
  expect(
    assembly.manifest.resources
      .filter((resource) => resource.resourceType === "model")
      .map((resource) => resource.resourceId),
  ).toEqual([MODEL_ID]);

  await env.CANONICAL_DB.batch([
    statement(
      env.CANONICAL_DB,
      "INSERT INTO resource_identity (resource_id, resource_type, created_at_ms) VALUES (?, 'model_family', 0)",
      [FAMILY_ID],
    ),
    statement(
      env.CANONICAL_DB,
      "INSERT INTO resource_identity (resource_id, resource_type, created_at_ms) VALUES (?, 'model', 0)",
      [MODEL_ID],
    ),
    statement(
      env.CANONICAL_DB,
      "INSERT INTO resource_identity (resource_id, resource_type, created_at_ms) VALUES (?, 'provider', 0)",
      [PROVIDER_ID],
    ),
    statement(
      env.CANONICAL_DB,
      `INSERT INTO model_family
        (family_id, slug, display_name, normalized_name, created_at_ms)
       VALUES (?, 'alpha-family', 'Alpha Family', 'alpha family', 0)`,
      [FAMILY_ID],
    ),
    statement(
      env.CANONICAL_DB,
      `INSERT INTO model
        (model_id, family_id, slug, display_name, normalized_name, status,
         created_at_ms)
       VALUES (?, ?, 'alpha-model', 'Alpha Model', 'alpha model', 'active', 0)`,
      [MODEL_ID, FAMILY_ID],
    ),
    statement(
      env.CANONICAL_DB,
      `INSERT INTO slug_history
        (slug_history_id, resource_id, slug, valid_from_ms, valid_to_ms)
       VALUES (?, ?, 'alpha-model', 0, ?)`,
      [CURRENT_HISTORY_ID, MODEL_ID, BOUNDARY_MS + 1_000],
    ),
    statement(
      env.CANONICAL_DB,
      `INSERT INTO slug_history
        (slug_history_id, resource_id, slug, valid_from_ms, valid_to_ms)
       VALUES (?, ?, 'future-alpha-model', ?, NULL)`,
      [FUTURE_HISTORY_ID, MODEL_ID, BOUNDARY_MS + 1_000],
    ),
  ]);
}, 30_000);

describe("canonical Model slug-history acquisition in pinned workerd", () => {
  it("uses the guarded canonical D1 boundary and fails closed on later disagreement", async () => {
    await expect(
      env.CANONICAL_DB.prepare(
        `INSERT INTO slug_history
          (slug_history_id, resource_id, slug, valid_from_ms, valid_to_ms)
         VALUES ('slg_00000003-0000-4000-8000-000000000001', ?, ?, 0, 1)`,
      )
        .bind(MODEL_ID, "alpha\u0000hidden")
        .run(),
    ).rejects.toThrow("model slug history row is invalid");
    await expect(
      env.CANONICAL_DB.prepare(
        `INSERT OR REPLACE INTO slug_history
          (slug_history_id, resource_id, slug, valid_from_ms, valid_to_ms)
         VALUES (?, ?, 'replacement', 0, NULL)`,
      )
        .bind(CURRENT_HISTORY_ID, PROVIDER_ID)
        .run(),
    ).rejects.toThrow("model slug history cannot be replaced");

    const capture = await acquireModelSlugHistoryCandidate(
      observedDatabase,
      ports(),
    );

    expect(() => {
      assertModelSlugHistoryCandidateCapture(capture);
    }).not.toThrow();
    expect(observedSessionConstraints).toEqual(["first-primary"]);
    expect(capture.publicationBoundaryMs).toBe(BOUNDARY_MS);
    expect(capture.canonicalModels).toEqual([
      {
        resource_id: MODEL_ID,
        resource_type: "model",
        slug: "alpha-model",
      },
    ]);
    expect(capture.historyRows).toEqual([
      {
        slug_history_id: CURRENT_HISTORY_ID,
        resource_id: MODEL_ID,
        resource_type: "model",
        slug: "alpha-model",
        valid_from_ms: 0,
        valid_to_ms: null,
      },
    ]);
    expect(capture.historyRows).not.toContainEqual(
      expect.objectContaining({ slug_history_id: FUTURE_HISTORY_ID }),
    );
    expect(capture.privateSessionBookmark).toEqual(expect.any(String));
    expect(capture.privateSessionBookmark.length).toBeGreaterThan(0);
    expect(Object.keys(capture)).not.toContain("privateSessionBookmark");
    expect(JSON.stringify(capture)).not.toContain(
      capture.privateSessionBookmark,
    );

    await env.CANONICAL_DB.prepare(
      "UPDATE model SET slug = ? WHERE model_id = ?",
    )
      .bind("a".repeat(129), MODEL_ID)
      .run();
    await expect(
      acquireModelSlugHistoryCandidate(observedDatabase, ports()),
    ).rejects.toMatchObject({ code: "integrity_failure" });
    await env.CANONICAL_DB.prepare(
      "UPDATE model SET slug = 'alpha-model' WHERE model_id = ?",
    )
      .bind(MODEL_ID)
      .run();

    await env.CANONICAL_DB.prepare(
      "UPDATE model SET slug = 'canonical-disagreement' WHERE model_id = ?",
    )
      .bind(MODEL_ID)
      .run();
    await expect(
      acquireModelSlugHistoryCandidate(observedDatabase, ports()),
    ).rejects.toMatchObject({ code: "integrity_failure" });
    await env.CANONICAL_DB.prepare(
      "UPDATE model SET slug = 'alpha-model' WHERE model_id = ?",
    )
      .bind(MODEL_ID)
      .run();

    await env.CANONICAL_DB.batch([
      env.CANONICAL_DB.prepare(
        "DROP TRIGGER model_slug_history_integrity_metadata_immutable_delete",
      ),
      env.CANONICAL_DB.prepare(
        "DELETE FROM model_slug_history_integrity_metadata WHERE singleton = 1",
      ),
    ]);
    await expect(
      acquireModelSlugHistoryCandidate(observedDatabase, ports()),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });
});
