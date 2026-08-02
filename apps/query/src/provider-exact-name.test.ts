import { describe, expect, it } from "vitest";

import {
  canonicalizePublicationJson,
  hashPublicationResourceContent,
  normalizeExactSearchName,
} from "@quant-clarity/publication-core";

import {
  PROVIDER_EXACT_NAME_MAX_QUERY_BYTES,
  PROVIDER_EXACT_NAME_MAX_QUERY_UNICODE_SCALARS,
  PROVIDER_EXACT_NAME_MAX_RESOURCE_BYTES,
  PROVIDER_EXACT_NAME_MAX_TRANSFER_BYTES,
  PROVIDER_EXACT_NAME_SELECT_SQL,
  ProviderExactNameError,
  readProviderExactNamePage,
} from "./provider-exact-name.js";

const PUBLICATION_ID = "pub_11111111-1111-4111-8111-111111111111";
const PROVIDER_A = "prv_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROVIDER_B = "prv_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROVIDER_C = "prv_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVIDENCE_ID = "evd_dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OBSERVED_AT = "2026-08-01T00:00:00.000Z";

const fact = (
  value: string,
  evidenceIds: readonly string[] = [EVIDENCE_ID],
) => ({
  evidence_ids: evidenceIds,
  observed_at: OBSERVED_AT,
  state: "known",
  value,
});

const providerJson = (
  providerId: string,
  displayName = "Fixture Provider",
  status = "active",
  displayEvidenceIds: readonly string[] = [EVIDENCE_ID],
): string =>
  canonicalizePublicationJson(
    JSON.stringify({
      active_offering_count: {
        derivation_version: "provider-count@1",
        observed_at: OBSERVED_AT,
        value: 1,
      },
      affiliate_relationship_present: false,
      display_name: fact(displayName, displayEvidenceIds),
      last_successful_refresh: fact(OBSERVED_AT),
      official_site: fact("https://provider.example"),
      precision_coverage: {
        derivation_version: "precision-coverage@1",
        known_count: 0,
        known_proportion_decimal: "0",
        unknown_count: 1,
      },
      provider_id: providerId,
      slug: fact(`provider-${providerId.slice(4, 12)}`),
      status: fact(status),
    }),
    "object",
  );

const row = async (
  providerId: string,
  displayName = "Fixture Provider",
  overrides: Readonly<Record<string, unknown>> = {},
  displayEvidenceIds: readonly string[] = [EVIDENCE_ID],
) => {
  const resourceJson = providerJson(
    providerId,
    displayName,
    "active",
    displayEvidenceIds,
  );
  const contentHash = await hashPublicationResourceContent({
    resourceType: "provider",
    resourceId: providerId,
    resourceJson,
  });
  return {
    row_ordinal: 1,
    row_kind: "candidate",
    publication_id: PUBLICATION_ID,
    provider_id: providerId,
    projection_version: "provider-name@1",
    display_name: displayName,
    normalized_name: normalizeExactSearchName(displayName),
    provider_resource_content_hash: contentHash,
    resource_content_hash: contentHash,
    resource_json_bytes: new TextEncoder().encode(resourceJson).length,
    resource_json: resourceJson,
    ...overrides,
  };
};

const hotPublication = (publicationId = PUBLICATION_ID) => ({
  row_ordinal: 0,
  row_kind: "hot_publication",
  publication_id: publicationId,
  provider_id: null,
  projection_version: null,
  display_name: null,
  normalized_name: null,
  provider_resource_content_hash: null,
  resource_content_hash: null,
  resource_json_bytes: 0,
  resource_json: null,
});

class FakeDatabase {
  readonly calls: Readonly<{ sql: string; values: readonly unknown[] }>[] = [];

  constructor(
    private readonly returnedRows: readonly unknown[],
    private readonly success = true,
  ) {}

  asD1(): D1Database {
    return {
      prepare: (sql: string) =>
        ({
          bind: (...values: unknown[]) =>
            ({
              all: () => {
                this.calls.push({ sql, values });
                return Promise.resolve({
                  success: this.success,
                  results: this.returnedRows.map((value) =>
                    structuredClone(value),
                  ),
                  meta: {},
                });
              },
            }) as D1PreparedStatement,
        }) as D1PreparedStatement,
    } as D1Database;
  }
}

describe("provider exact-name D1 reader (SRCH-002, SRCH-006, SRCH-008)", () => {
  it("uses bound Unicode-normalized equality and rehydrates canonical provider facts", async () => {
    const expectedRow = await row(PROVIDER_A, "Fixture—Provider");
    const database = new FakeDatabase([hotPublication(), expectedRow]);

    const page = await readProviderExactNamePage(database.asD1(), {
      publicationId: PUBLICATION_ID,
      query: "  FIXTURE provider ",
      limit: 5,
    });

    expect(page).toMatchObject({
      publicationId: PUBLICATION_ID,
      nextAfterProviderId: null,
      results: [
        {
          matchKind: "provider_name",
          tier: 3,
          resourceType: "provider",
          resourceId: PROVIDER_A,
          displayName: { value: "Fixture—Provider" },
          semanticDegraded: "disabled",
          normalizedOrderingKey: "fixture provider",
        },
      ],
    });
    expect(database.calls).toEqual([
      {
        sql: PROVIDER_EXACT_NAME_SELECT_SQL,
        values: [PUBLICATION_ID, "fixture provider", "", 1_000_000, 6],
      },
    ]);
  });

  it("retains normalized-name collisions with stable provider-ID pagination", async () => {
    const database = new FakeDatabase([
      hotPublication(),
      await row(PROVIDER_A),
      await row(PROVIDER_B),
      await row(PROVIDER_C),
    ]);
    const first = await readProviderExactNamePage(database.asD1(), {
      publicationId: PUBLICATION_ID,
      query: "Fixture Provider",
      limit: 2,
    });
    expect(first.results.map((result) => result.resourceId)).toEqual([
      PROVIDER_A,
      PROVIDER_B,
    ]);
    expect(first.nextAfterProviderId).toBe(PROVIDER_B);

    const secondDatabase = new FakeDatabase([
      hotPublication(),
      await row(PROVIDER_C),
    ]);
    const second = await readProviderExactNamePage(secondDatabase.asD1(), {
      publicationId: PUBLICATION_ID,
      query: "Fixture Provider",
      afterProviderId: first.nextAfterProviderId,
      limit: 2,
    });
    expect(second.results.map((result) => result.resourceId)).toEqual([
      PROVIDER_C,
    ]);
    expect(secondDatabase.calls[0]?.values[2]).toBe(PROVIDER_B);
  });

  it("rejects invalid input before acquiring D1 and never echoes visitor text", async () => {
    const hostile = '" OR publication_id = publication_id --';
    const database = new FakeDatabase([]);
    await expect(
      readProviderExactNamePage(database.asD1(), {
        publicationId: "pub_invalid",
        query: hostile,
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: "The provider-name query is invalid.",
    });
    await expect(
      readProviderExactNamePage(database.asD1(), {
        publicationId: PUBLICATION_ID,
        query: " ",
      }),
    ).rejects.toBeInstanceOf(ProviderExactNameError);
    await expect(
      readProviderExactNamePage(database.asD1(), {
        publicationId: PUBLICATION_ID,
        query: "x".repeat(PROVIDER_EXACT_NAME_MAX_QUERY_UNICODE_SCALARS + 1),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    for (const nulQuery of [
      "\u0000Leading",
      "Embedded\u0000Query",
      "Trailing\u0000",
    ]) {
      await expect(
        readProviderExactNamePage(database.asD1(), {
          publicationId: PUBLICATION_ID,
          query: nulQuery,
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    await expect(
      readProviderExactNamePage(database.asD1(), {
        publicationId: PUBLICATION_ID,
        query: "\u0800".repeat(267),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      readProviderExactNamePage(database.asD1(), {
        publicationId: PUBLICATION_ID,
        query: "Fixture Provider",
        status: "all",
      } as never),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(
      new TextEncoder().encode("\u0800".repeat(267)).length,
    ).toBeGreaterThan(PROVIDER_EXACT_NAME_MAX_QUERY_BYTES);
    expect(database.calls).toEqual([]);
    expect(new ProviderExactNameError("invalid_input").message).not.toContain(
      hostile,
    );
  });

  it("distinguishes a hot no-match from a non-hot publication pin", async () => {
    await expect(
      readProviderExactNamePage(new FakeDatabase([hotPublication()]).asD1(), {
        publicationId: PUBLICATION_ID,
        query: "No Such Provider",
      }),
    ).resolves.toEqual({
      publicationId: PUBLICATION_ID,
      results: [],
      nextAfterProviderId: null,
    });
    await expect(
      readProviderExactNamePage(new FakeDatabase([]).asD1(), {
        publicationId: PUBLICATION_ID,
        query: "No Such Provider",
      }),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it("fails closed when D1 reports an unsuccessful read", async () => {
    await expect(
      readProviderExactNamePage(
        new FakeDatabase(
          [hotPublication(), await row(PROVIDER_A)],
          false,
        ).asD1(),
        {
          publicationId: PUBLICATION_ID,
          query: "Fixture Provider",
        },
      ),
    ).rejects.toMatchObject({ code: "read_failure" });
  });

  it("validates the lookahead row and strict continuation order", async () => {
    await expect(
      readProviderExactNamePage(
        new FakeDatabase([
          hotPublication(),
          await row(PROVIDER_A),
          await row(PROVIDER_B, "Fixture Provider", {
            resource_json: null,
            resource_json_bytes: 1_000_001,
          }),
        ]).asD1(),
        {
          publicationId: PUBLICATION_ID,
          query: "Fixture Provider",
          limit: 1,
        },
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });

    await expect(
      readProviderExactNamePage(
        new FakeDatabase([
          hotPublication(),
          await row(PROVIDER_B),
          await row(PROVIDER_A),
        ]).asD1(),
        {
          publicationId: PUBLICATION_ID,
          query: "Fixture Provider",
        },
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it("accepts canonical provider resources above 48KB", async () => {
    const evidenceIds = Array.from(
      { length: 1_400 },
      (_, ordinal) =>
        `evd_12345678-1234-4123-8123-${ordinal.toString(16).padStart(12, "0")}`,
    );
    const largeRow = await row(PROVIDER_A, "Fixture Provider", {}, evidenceIds);
    expect(largeRow.resource_json_bytes).toBeGreaterThan(48_000);
    expect(largeRow.resource_json_bytes).toBeLessThanOrEqual(
      PROVIDER_EXACT_NAME_MAX_RESOURCE_BYTES,
    );
    await expect(
      readProviderExactNamePage(
        new FakeDatabase([hotPublication(), largeRow]).asD1(),
        {
          publicationId: PUBLICATION_ID,
          query: "Fixture Provider",
        },
      ),
    ).resolves.toMatchObject({
      results: [{ resourceId: PROVIDER_A }],
    });
  });

  it("rejects a self-consistent hash-valid Provider with invalid evidence", async () => {
    const resourceJson = providerJson(
      PROVIDER_A,
      "Fixture Provider",
      "active",
      [],
    );
    const contentHash = await hashPublicationResourceContent({
      resourceType: "provider",
      resourceId: PROVIDER_A,
      resourceJson,
    });
    const forged = await row(PROVIDER_A, "Fixture Provider", {
      provider_resource_content_hash: contentHash,
      resource_content_hash: contentHash,
      resource_json: resourceJson,
      resource_json_bytes: new TextEncoder().encode(resourceJson).length,
    });
    await expect(
      readProviderExactNamePage(
        new FakeDatabase([hotPublication(), forged]).asD1(),
        {
          publicationId: PUBLICATION_ID,
          query: "Fixture Provider",
        },
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it("keeps affiliate, count, coverage, and site facts out of exact candidate identity and order", async () => {
    const baseline = await row(PROVIDER_A);
    const changedProvider = JSON.parse(baseline.resource_json) as Record<
      string,
      unknown
    >;
    changedProvider.affiliate_relationship_present = true;
    changedProvider.active_offering_count = {
      derivation_version: "provider-count@2",
      observed_at: OBSERVED_AT,
      value: 999,
    };
    changedProvider.precision_coverage = {
      derivation_version: "precision-coverage@2",
      known_count: 99,
      known_proportion_decimal: "0.99",
      unknown_count: 1,
    };
    changedProvider.official_site = fact("https://changed.example");
    const changedJson = canonicalizePublicationJson(
      JSON.stringify(changedProvider),
      "object",
    );
    const changedHash = await hashPublicationResourceContent({
      resourceType: "provider",
      resourceId: PROVIDER_A,
      resourceJson: changedJson,
    });
    const changed = {
      ...baseline,
      provider_resource_content_hash: changedHash,
      resource_content_hash: changedHash,
      resource_json: changedJson,
      resource_json_bytes: new TextEncoder().encode(changedJson).length,
    };
    const baselineResult = await readProviderExactNamePage(
      new FakeDatabase([hotPublication(), baseline]).asD1(),
      { publicationId: PUBLICATION_ID, query: "Fixture Provider" },
    );
    const changedResult = await readProviderExactNamePage(
      new FakeDatabase([hotPublication(), changed]).asD1(),
      { publicationId: PUBLICATION_ID, query: "Fixture Provider" },
    );
    expect(changedResult.results).toEqual(baselineResult.results);
  });

  it("fails closed if a D1 result exceeds the aggregate transfer bound", async () => {
    const base = await row(PROVIDER_A);
    const candidates = Array.from({ length: 21 }, (_, ordinal) => {
      const providerId = `prv_${ordinal.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
      const resourceJson = "x".repeat(
        ordinal === 20
          ? PROVIDER_EXACT_NAME_MAX_RESOURCE_BYTES + 1
          : PROVIDER_EXACT_NAME_MAX_RESOURCE_BYTES,
      );
      return {
        ...base,
        provider_id: providerId,
        resource_json: resourceJson,
        resource_json_bytes: resourceJson.length,
      };
    });
    expect(PROVIDER_EXACT_NAME_MAX_TRANSFER_BYTES).toBe(21_000_000);
    await expect(
      readProviderExactNamePage(
        new FakeDatabase([hotPublication(), ...candidates]).asD1(),
        {
          publicationId: PUBLICATION_ID,
          query: "Fixture Provider",
        },
      ),
    ).rejects.toMatchObject({ code: "integrity_failure" });
  });

  it.each([
    [
      "projection source hash",
      { provider_resource_content_hash: `sha256:${"0".repeat(64)}` },
    ],
    ["normalized name", { normalized_name: "different" }],
    ["display name", { display_name: "Different" }],
    [
      "oversized sentinel",
      { resource_json: null, resource_json_bytes: 1_000_001 },
    ],
  ])("fails closed on corrupt %s", async (_label, overrides) => {
    const database = new FakeDatabase([
      hotPublication(),
      await row(PROVIDER_A, "Fixture Provider", overrides),
    ]);
    await expect(
      readProviderExactNamePage(database.asD1(), {
        publicationId: PUBLICATION_ID,
        query: "Fixture Provider",
      }),
    ).rejects.toMatchObject({
      code: "integrity_failure",
      message: "Published provider data failed integrity verification.",
    });
  });

  it("returns detached provider objects on every read", async () => {
    const expectedRow = await row(PROVIDER_A);
    const database = new FakeDatabase([hotPublication(), expectedRow]);
    const first = await readProviderExactNamePage(database.asD1(), {
      publicationId: PUBLICATION_ID,
      query: "Fixture Provider",
    });
    const mutable = first.results[0]?.displayName as {
      value: string | null;
    };
    expect(() => {
      mutable.value = "Mutated";
    }).toThrow(TypeError);
    const second = await readProviderExactNamePage(database.asD1(), {
      publicationId: PUBLICATION_ID,
      query: "Fixture Provider",
    });
    expect(second.results[0]?.displayName).toMatchObject({
      value: "Fixture Provider",
    });
  });

  it("contains only a fixed SELECT path with hot-head proof and indexed equality", () => {
    expect(PROVIDER_EXACT_NAME_SELECT_SQL).toMatch(
      /publication\.publication_id = \?1/u,
    );
    expect(PROVIDER_EXACT_NAME_SELECT_SQL).toMatch(
      /publication\.state = 'active'/u,
    );
    expect(PROVIDER_EXACT_NAME_SELECT_SQL).toMatch(
      /head\.rollback_candidate_publication_id = publication\.publication_id/u,
    );
    expect(PROVIDER_EXACT_NAME_SELECT_SQL).toMatch(
      /publication\.state IN \('superseded', 'rolled_back'\)/u,
    );
    expect(PROVIDER_EXACT_NAME_SELECT_SQL).toMatch(
      /document\.normalized_name = \?2/u,
    );
    expect(PROVIDER_EXACT_NAME_SELECT_SQL).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|MATCH)\b/iu,
    );
    expect(PROVIDER_EXACT_NAME_SELECT_SQL).not.toContain("${");
  });
});
