import { describe, expect, it } from "vitest";

import {
  canonicalizePublicationJson,
  hashPublicationResourceContent,
  normalizeExactSearchName,
} from "@quant-clarity/publication-core";

import {
  PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL,
  PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_FAMILY_CANDIDATE_SELECT_SQL,
  PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_CANDIDATE_SELECT_SQL,
  PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_STALE_FAMILY_CANDIDATE_SELECT_SQL,
  PROVIDER_MODEL_ID_EXACT_FAMILY_CANDIDATE_SELECT_SQL,
  PROVIDER_MODEL_ID_EXACT_MAX_QUERY_BYTES,
  PROVIDER_MODEL_ID_EXACT_STALE_CANDIDATE_SELECT_SQL,
  PROVIDER_MODEL_ID_EXACT_TARGET_SELECT_SQL,
  ProviderModelIdExactError,
  readMergedProviderModelIdExactPage,
  readProviderModelIdExactPage,
} from "./provider-model-id-exact.js";

const PUBLICATION_ID = "pub_11111111-1111-4111-8111-111111111111";
const PROVIDER_ID = "prv_00000001-0000-4000-8000-000000000001";
const OFFERING_ID = "off_00000001-0000-4000-8000-000000000001";
const OFFERING_ID_2 = "off_00000002-0000-4000-8000-000000000001";
const MODEL_ID = "mdl_00000001-0000-4000-8000-000000000001";
const MODEL_ID_2 = "mdl_00000002-0000-4000-8000-000000000001";
const VARIANT_ID = "var_00000001-0000-4000-8000-000000000001";
const FAMILY_ID = "fam_00000001-0000-4000-8000-000000000001";
const EVIDENCE_ID = "evd_00000001-0000-4000-8000-000000000001";
const OBSERVED_AT = "2026-08-02T00:00:00.000Z";
const utf8 = new TextEncoder();

const known = (value: unknown) => ({
  evidence_ids: [EVIDENCE_ID],
  observed_at: OBSERVED_AT,
  state: "known",
  value,
});
const unknown = () => ({
  evidence_ids: [],
  observed_at: null,
  state: "unknown",
  value: null,
});
const canonicalJson = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};
const resourceJson = (value: unknown) =>
  canonicalizePublicationJson(canonicalJson(value), "object");
const toBuffer = (value: string): ArrayBuffer => {
  const view = utf8.encode(value);
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
};

const targetCommon = (displayName: string) => ({
  active_parameters: unknown(),
  architecture: unknown(),
  cataloged_provider_count: {
    derivation_version: "cataloged-provider-count@1",
    observed_at: OBSERVED_AT,
    value: 1,
  },
  checkpoints: [],
  context_window_tokens: unknown(),
  display_name: known(displayName),
  family_id: FAMILY_ID,
  last_model_data_refresh: known(OBSERVED_AT),
  license: unknown(),
  maximum_output_tokens: unknown(),
  modalities: unknown(),
  publisher: known("Fixture Publisher"),
  release_date: known("2026-08-02"),
  slug: known("fixture-model"),
  source_quantization: unknown(),
  source_weight_format: unknown(),
  status: known("active"),
  total_parameters: unknown(),
});

const model = (displayName = "Fixture Model", modelId = MODEL_ID) => ({
  ...targetCommon(displayName),
  authoritative_checkpoint_ids: [],
  model_id: modelId,
});

const variant = (displayName = "Fixture Variant", variantId = VARIANT_ID) => ({
  ...targetCommon(displayName),
  checkpoint_ids: [],
  model_id: MODEL_ID,
  selection_evidence: unknown(),
  slug: known("fixture-variant"),
  variant_id: variantId,
  variant_kind: known("publisher_variant"),
});

const offering = (
  providerModelId: string,
  modelId = MODEL_ID,
  offeringId = OFFERING_ID,
  stale = false,
) => ({
  display_name: known("Fixture Offering"),
  endpoint_class: "serverless",
  evidence_ids: [EVIDENCE_ID],
  first_observed_at: OBSERVED_AT,
  last_observed_at: OBSERVED_AT,
  last_successful_refresh: known(OBSERVED_AT),
  material_region_key: "",
  model_resource_id: modelId,
  offering_id: offeringId,
  precision_observation_ids: [],
  price_ids: [],
  provider_id: PROVIDER_ID,
  provider_model_id: providerModelId,
  source_locator: known("https://provider.example/catalog"),
  stale,
  stale_reason: stale ? "source_refresh_failed" : null,
  status: known("active"),
  supported_regions: known(["global"]),
  tier_key: "standard",
});

const candidateSentinel = () => ({
  row_ordinal: 0,
  row_kind: "hot_publication",
  publication_id: PUBLICATION_ID,
  match_mode: null,
  offering_id: null,
  provider_id: null,
  target_resource_type: null,
  target_resource_id: null,
  projection_version: null,
  offering_content_hash: null,
  target_content_hash: null,
  name_projection_version: null,
  name_resource_content_hash: null,
  normalized_name_utf8: null,
  ordering_name_utf8: null,
  display_name_bytes_match: null,
  offering_resource_content_hash: null,
  target_resource_content_hash: null,
  raw_provider_model_id_bytes_match: null,
  offering_json_bytes: 0,
  offering_json: null,
});
const targetSentinel = () => ({
  row_ordinal: 0,
  row_kind: "hot_publication",
  publication_id: PUBLICATION_ID,
  resource_type: null,
  resource_id: null,
  content_hash: null,
  resource_json_bytes: 0,
  resource_json: null,
});

const fixtureResults = async (
  query: string,
  matchMode: 0 | 1 = 0,
  identity: Readonly<{
    displayName: string;
    modelId: string;
    offeringId: string;
    resourceType?: "model" | "variant";
  }> = {
    displayName: "Fixture Model",
    modelId: MODEL_ID,
    offeringId: OFFERING_ID,
  },
  providerModelId = query,
  stableIdOrdering = false,
  offeringStale = false,
) => {
  const resourceType = identity.resourceType ?? "model";
  const offeringJson = resourceJson(
    offering(
      providerModelId,
      identity.modelId,
      identity.offeringId,
      offeringStale,
    ),
  );
  const targetJson = resourceJson(
    resourceType === "model"
      ? model(identity.displayName, identity.modelId)
      : variant(identity.displayName, identity.modelId),
  );
  const offeringHash = await hashPublicationResourceContent({
    resourceType: "offering",
    resourceId: identity.offeringId,
    resourceJson: offeringJson,
  });
  const targetHash = await hashPublicationResourceContent({
    resourceType,
    resourceId: identity.modelId,
    resourceJson: targetJson,
  });
  const normalizedName = normalizeExactSearchName(identity.displayName);
  return [
    {
      success: true,
      results: [
        candidateSentinel(),
        {
          row_ordinal: 1,
          row_kind: "candidate",
          publication_id: PUBLICATION_ID,
          match_mode: matchMode,
          offering_id: identity.offeringId,
          provider_id: PROVIDER_ID,
          target_resource_type: resourceType,
          target_resource_id: identity.modelId,
          projection_version: "provider-model-id@1",
          offering_content_hash: offeringHash,
          target_content_hash: targetHash,
          name_projection_version: "model-variant-name@1",
          name_resource_content_hash: targetHash,
          normalized_name_utf8: toBuffer(normalizedName),
          ordering_name_utf8: toBuffer(stableIdOrdering ? "" : normalizedName),
          display_name_bytes_match: 1,
          offering_resource_content_hash: offeringHash,
          target_resource_content_hash: targetHash,
          raw_provider_model_id_bytes_match: 1,
          offering_json_bytes: utf8.encode(offeringJson).byteLength,
          offering_json: offeringJson,
        },
      ],
    },
    {
      success: true,
      results: [
        targetSentinel(),
        {
          row_ordinal: 1,
          row_kind: "target",
          publication_id: PUBLICATION_ID,
          resource_type: resourceType,
          resource_id: identity.modelId,
          content_hash: targetHash,
          resource_json_bytes: utf8.encode(targetJson).byteLength,
          resource_json: targetJson,
        },
      ],
    },
  ] as const;
};

class FakeDatabase {
  readonly calls: { sql: string; values: readonly unknown[] }[] = [];
  constructor(private readonly replies: readonly unknown[]) {}
  asD1(): D1DatabaseSession {
    let index = 0;
    return {
      prepare: (sql: string) =>
        ({
          bind: (...values: unknown[]) =>
            ({
              all: () => {
                this.calls.push({ sql, values });
                const reply = this.replies[index];
                index += 1;
                return Promise.resolve(reply);
              },
            }) as D1PreparedStatement,
        }) as D1PreparedStatement,
    } as D1DatabaseSession;
  }
}

const input = (query: string) => ({
  publicationId: PUBLICATION_ID,
  query,
  providerId: null,
  recordType: null as "model" | "variant" | null,
  continuation: null,
  limit: 20,
});

describe("provider-model-ID exact reader (SRCH-002, SRCH-006, SRCH-008, SRCH-009)", () => {
  it("uses fixed forced BLOB indexes and two SELECT-only reads", () => {
    expect(PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL).toContain(
      "INDEXED BY publication_provider_model_id_raw_exact_idx",
    );
    expect(PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL).toContain(
      "INDEXED BY publication_provider_model_id_normalized_exact_idx",
    );
    expect(PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL).toContain(
      "row_number() OVER",
    );
    expect(PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL).toContain(
      "json_extract(offering.resource_json, '$.stale') = 0",
    );
    expect(PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL).toContain(
      "json_extract(offering.resource_json, '$.status.value') = 'active'",
    );
    expect(PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL).toContain(
      "json_extract(target.resource_json, '$.status.value') = 'active'",
    );
    expect(PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL).toContain(
      "PARTITION BY target_resource_type, target_resource_id",
    );
    expect(PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL).not.toContain(
      "publication_provider_model_id_eligibility_idx",
    );
    expect(PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_CANDIDATE_SELECT_SQL).toContain(
      "INDEXED BY publication_provider_model_id_eligibility_idx",
    );
    expect(PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_CANDIDATE_SELECT_SQL).toContain(
      "eligibility.offering_content_hash = eligibility_offering.content_hash",
    );
    expect(
      PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_CANDIDATE_SELECT_SQL.match(
        /eligibility\.projection_version = 'provider-model-id@1'/gu,
      ),
    ).toHaveLength(2);
    expect(
      PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_CANDIDATE_SELECT_SQL.match(
        /eligibility\.target_content_hash = document\.target_content_hash/gu,
      ),
    ).toHaveLength(2);
    expect(PROVIDER_MODEL_ID_EXACT_TARGET_SELECT_SQL).toContain(
      "FROM json_each(?2)",
    );
    for (const sql of [
      PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL,
      PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_CANDIDATE_SELECT_SQL,
      PROVIDER_MODEL_ID_EXACT_FAMILY_CANDIDATE_SELECT_SQL,
      PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_FAMILY_CANDIDATE_SELECT_SQL,
      PROVIDER_MODEL_ID_EXACT_TARGET_SELECT_SQL,
    ]) {
      expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MATCH)\b/u);
    }
  });

  it("rehydrates the same Offering witness and canonical target without leaking match/order internals", async () => {
    const replies = await fixtureResults("accounts/p/model\u0000v1");
    const database = new FakeDatabase(replies);
    const page = await readProviderModelIdExactPage(
      database.asD1(),
      input("accounts/p/model\u0000v1"),
    );
    expect(page).toEqual({
      publicationId: PUBLICATION_ID,
      matchModes: ["raw"],
      nextContinuation: null,
      results: [
        {
          tier: 2,
          resourceType: "model",
          resourceId: MODEL_ID,
          matchKind: "provider_model_id",
          displayName: known("Fixture Model"),
          semanticDegraded: "disabled",
        },
      ],
    });
    expect(Object.keys(page.results[0] ?? {})).not.toContain("matchMode");
    expect(Object.keys(page.results[0] ?? {})).not.toContain(
      "normalizedOrderingKey",
    );
    expect(database.calls).toHaveLength(2);
    expect(database.calls[0]?.values[1]).toBeInstanceOf(ArrayBuffer);
    expect(
      Array.from(new Uint8Array(database.calls[0]?.values[1] as ArrayBuffer)),
    ).toEqual(Array.from(utf8.encode("accounts/p/model\u0000v1")));
  });

  it("binds provider and record-type filters to the candidate witness", async () => {
    const replies = await fixtureResults("fixture-id");
    const database = new FakeDatabase(replies);
    await readProviderModelIdExactPage(database.asD1(), {
      ...input("fixture-id"),
      providerId: PROVIDER_ID,
      recordType: "model",
    });
    expect(database.calls[0]?.values.slice(3, 5)).toEqual([
      PROVIDER_ID,
      "model",
    ]);
  });

  it("enables canonical-name overlap exclusion only for merged composition before LIMIT", async () => {
    const standalone = new FakeDatabase(await fixtureResults("fixture-id"));
    await readProviderModelIdExactPage(standalone.asD1(), input("fixture-id"));
    const merged = new FakeDatabase(
      await fixtureResults("fixture-id", 0, undefined, "fixture-id", true),
    );
    await readMergedProviderModelIdExactPage(merged.asD1(), {
      ...input("fixture-id"),
      eligibilityProviderId: null,
    });
    expect(standalone.calls[0]?.sql).toBe(
      PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL,
    );
    expect(merged.calls[0]?.sql).toBe(
      PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL,
    );
    expect(standalone.calls[0]?.values.slice(10, 12)).toEqual([0, 0]);
    expect(merged.calls[0]?.values.slice(10, 12)).toEqual([1, 1]);
    expect(
      PROVIDER_MODEL_ID_EXACT_CANDIDATE_SELECT_SQL.match(
        /name\.normalized_name_utf8 <> \?3/gu,
      ),
    ).toHaveLength(2);
    expect(
      PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_CANDIDATE_SELECT_SQL.match(
        /name\.normalized_name_utf8 <> \?3/gu,
      ),
    ).toHaveLength(2);
  });

  it("binds merged eligibility independently from the matching provider witness", async () => {
    const database = new FakeDatabase(
      await fixtureResults("fixture-id", 0, undefined, "fixture-id", true),
    );
    await readMergedProviderModelIdExactPage(database.asD1(), {
      ...input("fixture-id"),
      eligibilityProviderId: PROVIDER_ID,
    });
    expect(database.calls[0]?.sql).toBe(
      PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_CANDIDATE_SELECT_SQL,
    );
    expect(database.calls[0]?.values[3]).toBeNull();
    expect(database.calls[0]?.values[13]).toBe(PROVIDER_ID);
  });

  it("filters both the matching Offering and target eligibility by explicit stale state", async () => {
    const staleOnly = new FakeDatabase(
      await fixtureResults(
        "fixture-id",
        0,
        undefined,
        "fixture-id",
        true,
        true,
      ),
    );
    await expect(
      readMergedProviderModelIdExactPage(staleOnly.asD1(), {
        ...input("fixture-id"),
        eligibilityProviderId: null,
        eligibilityStale: true,
      }),
    ).resolves.toMatchObject({ results: [{ resourceId: MODEL_ID }] });
    expect(staleOnly.calls[0]?.sql).toBe(
      PROVIDER_MODEL_ID_EXACT_STALE_CANDIDATE_SELECT_SQL,
    );
    expect(staleOnly.calls[0]?.values[13]).toBe(1);
    expect(PROVIDER_MODEL_ID_EXACT_STALE_CANDIDATE_SELECT_SQL).toContain(
      "INDEXED BY publication_provider_model_id_target_eligibility_idx",
    );

    const combined = new FakeDatabase(
      await fixtureResults("fixture-id", 0, undefined, "fixture-id", true),
    );
    await readMergedProviderModelIdExactPage(combined.asD1(), {
      ...input("fixture-id"),
      eligibilityProviderId: PROVIDER_ID,
      eligibilityStale: false,
      familyId: FAMILY_ID,
    });
    expect(combined.calls[0]?.sql).toBe(
      PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_STALE_FAMILY_CANDIDATE_SELECT_SQL,
    );
    expect(combined.calls[0]?.values.slice(13)).toEqual([
      PROVIDER_ID,
      0,
      FAMILY_ID,
    ]);
  });

  it("filters canonical target families before dedupe and LIMIT, including provider conjunction", async () => {
    const familyOnly = new FakeDatabase(
      await fixtureResults("fixture-id", 0, undefined, "fixture-id", true),
    );
    await expect(
      readMergedProviderModelIdExactPage(familyOnly.asD1(), {
        ...input("fixture-id"),
        eligibilityProviderId: null,
        familyId: FAMILY_ID,
      }),
    ).resolves.toMatchObject({ results: [{ resourceId: MODEL_ID }] });
    expect(familyOnly.calls[0]?.sql).toBe(
      PROVIDER_MODEL_ID_EXACT_FAMILY_CANDIDATE_SELECT_SQL,
    );
    expect(familyOnly.calls[0]?.values[13]).toBe(FAMILY_ID);
    expect(PROVIDER_MODEL_ID_EXACT_FAMILY_CANDIDATE_SELECT_SQL).toContain(
      "json_extract(target.resource_json, '$.family_id') = ?14",
    );
    expect(
      PROVIDER_MODEL_ID_EXACT_FAMILY_CANDIDATE_SELECT_SQL.match(
        /json_extract\(target\.resource_json, '\$\.family_id'\) = \?14/gu,
      ),
    ).toHaveLength(2);
    expect(
      PROVIDER_MODEL_ID_EXACT_FAMILY_CANDIDATE_SELECT_SQL.indexOf(
        "'$.family_id'",
      ),
    ).toBeLessThan(
      PROVIDER_MODEL_ID_EXACT_FAMILY_CANDIDATE_SELECT_SQL.indexOf(
        "), deduplicated AS",
      ),
    );
    expect(
      PROVIDER_MODEL_ID_EXACT_FAMILY_CANDIDATE_SELECT_SQL.indexOf(
        "), deduplicated AS",
      ),
    ).toBeLessThan(
      PROVIDER_MODEL_ID_EXACT_FAMILY_CANDIDATE_SELECT_SQL.indexOf("  LIMIT ?9"),
    );

    const combined = new FakeDatabase(
      await fixtureResults("fixture-id", 0, undefined, "fixture-id", true),
    );
    await readMergedProviderModelIdExactPage(combined.asD1(), {
      ...input("fixture-id"),
      eligibilityProviderId: PROVIDER_ID,
      familyId: FAMILY_ID,
    });
    expect(combined.calls[0]?.sql).toBe(
      PROVIDER_MODEL_ID_EXACT_ELIGIBILITY_FAMILY_CANDIDATE_SELECT_SQL,
    );
    expect(combined.calls[0]?.values.slice(13)).toEqual([
      PROVIDER_ID,
      FAMILY_ID,
    ]);

    await expect(
      readMergedProviderModelIdExactPage(
        new FakeDatabase(
          await fixtureResults("fixture-id", 0, undefined, "fixture-id", true),
        ).asD1(),
        {
          ...input("fixture-id"),
          eligibilityProviderId: null,
          familyId: "fam_00000002-0000-4000-8000-000000000001",
        },
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it("validates merged eligibility while preserving the standalone closed input", async () => {
    const merged = new FakeDatabase([]);
    await expect(
      readMergedProviderModelIdExactPage(merged.asD1(), {
        ...input("fixture-id"),
        eligibilityProviderId: "prv_invalid",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      readMergedProviderModelIdExactPage(merged.asD1(), {
        ...input("fixture-id"),
        eligibilityProviderId: null,
        familyId: "fam_invalid",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      readMergedProviderModelIdExactPage(merged.asD1(), {
        ...input("fixture-id"),
        eligibilityProviderId: null,
        eligibilityStale: "true" as never,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    const standalone = new FakeDatabase([]);
    await expect(
      readProviderModelIdExactPage(standalone.asD1(), {
        ...input("fixture-id"),
        eligibilityProviderId: PROVIDER_ID,
      } as never),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(merged.calls).toEqual([]);
    expect(standalone.calls).toEqual([]);
  });

  it("maps a normalized-only Variant witness to its exact canonical Variant", async () => {
    const replies = await fixtureResults(
      "fixture/id",
      1,
      {
        displayName: "Fixture Variant",
        modelId: VARIANT_ID,
        offeringId: OFFERING_ID,
        resourceType: "variant",
      },
      "FIXTURE-ID",
    );
    await expect(
      readProviderModelIdExactPage(new FakeDatabase(replies).asD1(), {
        ...input("fixture/id"),
        recordType: "variant",
      }),
    ).resolves.toMatchObject({
      matchModes: ["normalized"],
      nextContinuation: null,
      results: [
        {
          resourceType: "variant",
          resourceId: VARIANT_ID,
          matchKind: "provider_model_id",
          displayName: { state: "known", value: "Fixture Variant" },
        },
      ],
    });
  });

  it("traverses raw then normalized collisions without duplicate or omission", async () => {
    const query = "collision/id";
    const raw = await fixtureResults(query, 0, {
      displayName: "Zulu Raw Target",
      modelId: MODEL_ID,
      offeringId: OFFERING_ID,
    });
    const normalized = await fixtureResults(
      query,
      1,
      {
        displayName: "Alpha Normalized Target",
        modelId: MODEL_ID_2,
        offeringId: OFFERING_ID_2,
      },
      "COLLISION-ID",
    );
    const rawCandidates = raw[0] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const normalizedCandidates = normalized[0] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const rawTargets = raw[1] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const normalizedTargets = normalized[1] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const first = await readProviderModelIdExactPage(
      new FakeDatabase([
        {
          success: true,
          results: [
            rawCandidates.results[0],
            rawCandidates.results[1],
            normalizedCandidates.results[1],
          ],
        },
        {
          success: true,
          results: [
            rawTargets.results[0],
            rawTargets.results[1],
            normalizedTargets.results[1],
          ],
        },
      ]).asD1(),
      { ...input(query), limit: 1 },
    );
    expect(first).toMatchObject({
      matchModes: ["raw"],
      results: [{ resourceId: MODEL_ID }],
      nextContinuation: { matchMode: "raw", resourceId: MODEL_ID },
    });
    const second = await readProviderModelIdExactPage(
      new FakeDatabase([
        {
          success: true,
          results: [
            normalizedCandidates.results[0],
            normalizedCandidates.results[1],
          ],
        },
        normalized[1],
      ]).asD1(),
      { ...input(query), continuation: first.nextContinuation, limit: 1 },
    );
    expect(second).toMatchObject({
      matchModes: ["normalized"],
      results: [{ resourceId: MODEL_ID_2 }],
      nextContinuation: null,
    });
    expect(
      [...first.results, ...second.results].map((row) => row.resourceId),
    ).toEqual([MODEL_ID, MODEL_ID_2]);
  });

  it("fails the page when the limit-plus-one lookahead is corrupt", async () => {
    const query = "lookahead/id";
    const first = await fixtureResults(query, 0, {
      displayName: "Alpha",
      modelId: MODEL_ID,
      offeringId: OFFERING_ID,
    });
    const lookahead = await fixtureResults(
      query,
      1,
      {
        displayName: "Beta",
        modelId: MODEL_ID_2,
        offeringId: OFFERING_ID_2,
      },
      "LOOKAHEAD-ID",
    );
    const firstRows = first[0] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const lookaheadRows = lookahead[0] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const database = new FakeDatabase([
      {
        success: true,
        results: [
          firstRows.results[0],
          firstRows.results[1],
          { ...lookaheadRows.results[1], display_name_bytes_match: 0 },
        ],
      },
    ]);
    await expect(
      readProviderModelIdExactPage(database.asD1(), {
        ...input(query),
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "integrity_failure" });
    expect(database.calls).toHaveLength(1);
  });

  it("translates the opaque string continuation mode only at the SQL boundary", async () => {
    const replies = await fixtureResults("fixture-id");
    const database = new FakeDatabase(replies);
    await readProviderModelIdExactPage(database.asD1(), {
      ...input("fixture-id"),
      continuation: {
        matchMode: "raw",
        normalizedTargetDisplayName: "aaa",
        resourceId: MODEL_ID,
      },
    });
    expect(database.calls[0]?.values[5]).toBe(0);
    expect(
      new TextDecoder().decode(database.calls[0]?.values[6] as ArrayBuffer),
    ).toBe("aaa");
    expect(database.calls[0]?.values[7]).toBe(MODEL_ID);
  });

  it("mirrors SQLite BLOB order across BMP and supplementary-plane names and continuations", async () => {
    const query = "collision-id";
    const bmp = await fixtureResults(query, 0, {
      displayName: "\uE000",
      modelId: MODEL_ID,
      offeringId: OFFERING_ID,
    });
    const supplementary = await fixtureResults(query, 0, {
      displayName: "\u{10000}",
      modelId: MODEL_ID_2,
      offeringId: OFFERING_ID_2,
    });
    const bmpCandidates = bmp[0] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const supplementaryCandidates = supplementary[0] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const bmpTargets = bmp[1] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const supplementaryTargets = supplementary[1] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const combined = new FakeDatabase([
      {
        success: true,
        results: [
          bmpCandidates.results[0],
          bmpCandidates.results[1],
          supplementaryCandidates.results[1],
        ],
      },
      {
        success: true,
        results: [
          bmpTargets.results[0],
          bmpTargets.results[1],
          supplementaryTargets.results[1],
        ],
      },
    ]);
    await expect(
      readProviderModelIdExactPage(combined.asD1(), input(query)),
    ).resolves.toMatchObject({
      results: [{ resourceId: MODEL_ID }, { resourceId: MODEL_ID_2 }],
    });

    const continued = new FakeDatabase([
      {
        success: true,
        results: [
          supplementaryCandidates.results[0],
          supplementaryCandidates.results[1],
        ],
      },
      supplementary[1],
    ]);
    await expect(
      readProviderModelIdExactPage(continued.asD1(), {
        ...input(query),
        continuation: {
          matchMode: "raw",
          normalizedTargetDisplayName: "\uE000",
          resourceId: MODEL_ID,
        },
      }),
    ).resolves.toMatchObject({ results: [{ resourceId: MODEL_ID_2 }] });
    expect(
      Array.from(new Uint8Array(continued.calls[0]?.values[6] as ArrayBuffer)),
    ).toEqual(Array.from(utf8.encode("\uE000")));
  });

  it("admits literal reserved and NUL characters but enforces the 200-byte canonical query ceiling", async () => {
    const replies = await fixtureResults("?&=/%#\u0000literal");
    await expect(
      readProviderModelIdExactPage(
        new FakeDatabase(replies).asD1(),
        input("?&=/%#\u0000literal"),
      ),
    ).resolves.toMatchObject({ results: [{ resourceId: MODEL_ID }] });
    for (const query of [
      " padded ",
      "e\u0301",
      "x".repeat(PROVIDER_MODEL_ID_EXACT_MAX_QUERY_BYTES + 1),
      "😀".repeat(51),
    ]) {
      const database = new FakeDatabase([]);
      await expect(
        readProviderModelIdExactPage(database.asD1(), input(query)),
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(database.calls).toHaveLength(0);
    }
  });

  it("keeps raw equality available when pinned normalization is empty", async () => {
    const database = new FakeDatabase(await fixtureResults("*"));
    await expect(
      readProviderModelIdExactPage(database.asD1(), input("*")),
    ).resolves.toMatchObject({
      matchModes: ["raw"],
      results: [{ resourceId: MODEL_ID }],
    });
    expect(
      (database.calls[0]?.values[2] as ArrayBuffer | undefined)?.byteLength,
    ).toBe(0);
  });

  it("rejects accessor-bearing input without invoking the getter", async () => {
    let reads = 0;
    const hostile = { ...input("fixture-id") } as Record<string, unknown>;
    Object.defineProperty(hostile, "query", {
      enumerable: true,
      get: () => {
        reads += 1;
        return "fixture-id";
      },
    });
    await expect(
      readProviderModelIdExactPage(
        new FakeDatabase([]).asD1(),
        hostile as never,
      ),
    ).rejects.toBeInstanceOf(ProviderModelIdExactError);
    expect(reads).toBe(0);
  });

  it("rejects symbol-keyed records and non-dense or decorated D1 BLOB arrays", async () => {
    const symbolInput = { ...input("fixture-id"), [Symbol("hidden")]: true };
    await expect(
      readProviderModelIdExactPage(
        new FakeDatabase([]).asD1(),
        symbolInput as never,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });

    const replies = await fixtureResults("fixture-id");
    const first = replies[0] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const original = first.results[1]?.normalized_name_utf8 as ArrayBuffer;
    let accessorReads = 0;
    const malformed = [
      (() => {
        const value = Array.from(new Uint8Array(original));
        Reflect.deleteProperty(value, "0");
        return value;
      })(),
      Object.assign(Array.from(new Uint8Array(original)), { extra: 1 }),
      Object.assign(Array.from(new Uint8Array(original)), {
        [Symbol("hidden")]: 1,
      }),
      (() => {
        const value = Array.from(new Uint8Array(original));
        Object.defineProperty(value, "0", {
          enumerable: true,
          get: () => {
            accessorReads += 1;
            return 1;
          },
        });
        return value;
      })(),
    ];
    for (const blob of malformed) {
      const candidate = {
        ...first.results[1],
        normalized_name_utf8: blob,
      };
      await expect(
        readProviderModelIdExactPage(
          new FakeDatabase([
            { success: true, results: [first.results[0], candidate] },
          ]).asD1(),
          input("fixture-id"),
        ),
      ).rejects.toMatchObject({ code: "integrity_failure" });
    }
    expect(accessorReads).toBe(0);
  });

  it("rejects accessor-bearing D1 result arrays without invoking the accessor", async () => {
    const replies = await fixtureResults("fixture-id");
    const first = replies[0] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const hostile = [first.results[0], first.results[1]];
    let reads = 0;
    Object.defineProperty(hostile, "1", {
      enumerable: true,
      get: () => {
        reads += 1;
        return first.results[1];
      },
    });
    await expect(
      readProviderModelIdExactPage(
        new FakeDatabase([{ success: true, results: hostile }]).asD1(),
        input("fixture-id"),
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });
    expect(reads).toBe(0);
  });

  it("rejects a BOM-prefixed normalized ordering BLOB", async () => {
    const replies = await fixtureResults("fixture-id");
    const first = replies[0] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    const candidate = first.results[1];
    const original = new Uint8Array(
      candidate?.normalized_name_utf8 as ArrayBuffer,
    );
    const prefixed = new Uint8Array(original.byteLength + 3);
    prefixed.set([0xef, 0xbb, 0xbf]);
    prefixed.set(original, 3);
    await expect(
      readProviderModelIdExactPage(
        new FakeDatabase([
          {
            success: true,
            results: [
              first.results[0],
              { ...candidate, normalized_name_utf8: prefixed.buffer },
            ],
          },
        ]).asD1(),
        input("fixture-id"),
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it("rejects a normalized-mode row whose canonical witness was actually raw-equal", async () => {
    const replies = await fixtureResults("Fixture-ID", 1);
    await expect(
      readProviderModelIdExactPage(
        new FakeDatabase(replies).asD1(),
        input("Fixture-ID"),
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it("maps an empty-normalizing normalized witness corruption to the static integrity error", async () => {
    const replies = await fixtureResults("*", 1);
    await expect(
      readProviderModelIdExactPage(
        new FakeDatabase(replies).asD1(),
        input("fixture-id"),
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it("fails closed on broken Offering links and hashes", async () => {
    const replies = await fixtureResults("fixture-id");
    const first = replies[0] as unknown as {
      success: true;
      results: readonly Record<string, unknown>[];
    };
    const damaged = {
      success: true,
      results: [
        first.results[0],
        {
          ...first.results[1],
          provider_id: "prv_00000002-0000-4000-8000-000000000001",
        },
      ],
    };
    await expect(
      readProviderModelIdExactPage(
        new FakeDatabase([damaged, replies[1]]).asD1(),
        input("fixture-id"),
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it("fails closed on name-projection hash or exact display-byte drift", async () => {
    const replies = await fixtureResults("fixture-id");
    const first = replies[0] as unknown as {
      results: readonly Record<string, unknown>[];
    };
    for (const mutation of [
      {
        name_resource_content_hash: `sha256:${"0".repeat(64)}`,
      },
      { display_name_bytes_match: 0 },
    ]) {
      await expect(
        readProviderModelIdExactPage(
          new FakeDatabase([
            {
              success: true,
              results: [first.results[0], { ...first.results[1], ...mutation }],
            },
            replies[1],
          ]).asD1(),
          input("fixture-id"),
        ),
      ).rejects.toMatchObject({ code: "integrity_failure" });
    }
  });
});
