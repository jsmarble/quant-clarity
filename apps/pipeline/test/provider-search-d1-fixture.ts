import type { ReadyPublicationFixture } from "./serving-switch-fixture.js";

const statement = (
  database: D1Database,
  sql: string,
  values: readonly unknown[],
): D1PreparedStatement => database.prepare(sql).bind(...values);

export const seedBuildingPublicationV2 = async (
  database: D1Database,
  fixture: ReadyPublicationFixture,
): Promise<void> => {
  const { rows, manifest } = fixture;
  await database.batch([
    statement(
      database,
      "INSERT INTO publication VALUES (?, 'building', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, 'vector@1', ?, '[]', ?)",
      [
        manifest.publicationId,
        manifest.versions.schema,
        manifest.versions.methodology,
        manifest.versions.precisionNormalization,
        manifest.versions.precisionDisplayOrder,
        manifest.versions.pricePolicy,
        manifest.versions.sourcePolicy,
        manifest.versions.embedding,
        manifest.versions.buildCommit,
        manifest.sourceRunId,
        Date.parse(manifest.generatedAt),
        manifest.resources.length,
        manifest.searchDocuments.length,
        manifest.vectors.length,
        manifest.exactSearchInventoryHash,
        manifest.closureHash,
        Date.parse(manifest.generatedAt),
      ],
    ),
    ...rows.providerSlices.flatMap((row) => [
      statement(
        database,
        "INSERT INTO publication_provider_slice VALUES (?, ?, ?, ?, ?, ?)",
        [
          row.provider_slice_id,
          manifest.publicationId,
          row.provider_id,
          row.provider_run_id,
          row.carried_forward,
          row.freshness_state,
        ],
      ),
      statement(
        database,
        "INSERT INTO publication_provider_slice_metadata VALUES (?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.provider_id,
          row.adapter_version,
          row.roster_version,
          row.source_register_version,
        ],
      ),
    ]),
    ...rows.resources.map((row) =>
      statement(
        database,
        "INSERT INTO publication_resource VALUES (?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.resource_type,
          row.resource_id,
          row.resource_json,
          row.content_hash,
        ],
      ),
    ),
    ...rows.providerAttributions.map((row) =>
      statement(
        database,
        "INSERT INTO publication_provider_attribution VALUES (?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.resource_type,
          row.resource_id,
          row.provider_id,
        ],
      ),
    ),
    ...rows.searchDocuments.map((row) =>
      statement(
        database,
        "INSERT INTO publication_search_document VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.document_id,
          row.resource_type,
          row.resource_id,
          row.normalized_name,
          row.aliases_json,
          row.publisher_name,
          row.provider_model_ids_json,
          row.document_text,
          row.content_hash,
        ],
      ),
    ),
    ...rows.vectors.map((row) =>
      statement(
        database,
        "INSERT INTO publication_vector_inventory VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.vector_namespace,
          row.vector_id,
          row.resource_type,
          row.resource_id,
          row.search_document_content_hash,
          row.embedding_input_hash,
        ],
      ),
    ),
    ...rows.chunks.map((row) =>
      statement(
        database,
        "INSERT INTO publication_inventory_chunk VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          manifest.publicationId,
          row.kind,
          row.ordinal,
          row.first_key,
          row.last_key,
          row.item_count,
          row.content_hash,
        ],
      ),
    ),
  ]);
};

export const sealPublicationV2 = async (
  database: D1Database,
  fixture: ReadyPublicationFixture,
): Promise<void> => {
  const seal = fixture.seal;
  await database
    .prepare(
      "INSERT INTO publication_closure_seal VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      seal.publication_id,
      seal.staging_revision,
      seal.manifest_contract_version,
      seal.hash_domain,
      seal.hash_encoding_version,
      seal.enabled_provider_scope_version,
      seal.enabled_provider_count,
      seal.provider_slice_count,
      seal.provider_attribution_count,
      seal.resource_count,
      seal.exact_document_count,
      seal.vector_document_count,
      seal.chunk_count,
      seal.bundle_hash,
      seal.enabled_provider_scope_hash,
      seal.provider_slice_hash,
      seal.provider_attribution_hash,
      seal.resource_inventory_hash,
      seal.exact_search_inventory_hash,
      seal.vector_inventory_hash,
      seal.chunk_root_hash,
      seal.closure_hash,
      seal.sealed_at_ms,
    )
    .run();
};
