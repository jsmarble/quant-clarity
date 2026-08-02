import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, expectTypeOf, it } from "vitest";

import { Type, type Static } from "@sinclair/typebox";

import {
  AdapterBatchSchema,
  AdapterManifestSchema,
  CandidateFactSchema,
  EvidenceIdSchema,
  FactSchema,
  type AdapterManifest,
  type FactState,
  type IdPrefix,
  ModelFamilySchema,
  PriceSchema,
  PrecisionFormatSchema,
  type PublicationManifest,
  PublicationManifestSchema,
  SearchResultSchema,
  validateAdapterBatchSemantics,
  validateAdapterManifestSemantics,
  validatePublicationManifestSemantics,
} from "./index.js";

const UUID = "00000000-0000-4000-8000-000000000001";
const StringFactSchema = FactSchema(
  Type.String({ $id: "StringValue" }),
  "StringFact",
);
type StringFact = Static<typeof StringFactSchema>;

function validator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addKeyword({
    keyword: "x-extensible-enum",
    schemaType: "array",
    valid: true,
  });
  ajv.addSchema(EvidenceIdSchema);
  return ajv.compile(StringFactSchema);
}

function standaloneValidator(schema: object) {
  const sanitized = JSON.parse(
    JSON.stringify(schema, (key, value: unknown) =>
      key === "$id" ? undefined : value,
    ),
  ) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addKeyword({
    keyword: "x-extensible-enum",
    schemaType: "array",
    valid: true,
  });
  return ajv.compile(sanitized);
}

describe("public fact contract (API-005, DATA-060)", () => {
  it("preserves literal state and prefix types", () => {
    expectTypeOf<FactState>().toEqualTypeOf<
      "known" | "unknown" | "not_applicable" | "unavailable"
    >();
    expectTypeOf<IdPrefix>().not.toEqualTypeOf<string>();
    expectTypeOf<StringFact["state"]>().toEqualTypeOf<FactState>();
  });

  it("requires an explicit stable schema identifier", () => {
    expect(() => FactSchema(Type.String(), "invalid fact id")).toThrow(
      TypeError,
    );
    expect(FactSchema(Type.String(), "AnotherStringFact").$id).toBe(
      "AnotherStringFact",
    );
  });

  it("requires value, timestamp, and evidence for known facts", () => {
    const validate = validator();
    expect(
      validate({
        state: "known",
        value: "FP8",
        observed_at: "2026-08-01T00:00:00.000Z",
        evidence_ids: [`evd_${UUID}`],
      }),
    ).toBe(true);
    expect(
      validate({
        state: "known",
        value: null,
        observed_at: null,
        evidence_ids: [],
      }),
    ).toBe(false);
    expect(
      validate({
        state: "known",
        value: "FP8",
        observed_at: "2026-08-01T00:00:00.000Z",
        evidence_ids: [`mdl_${UUID}`],
      }),
    ).toBe(false);
  });

  it("requires null values for non-known facts while retaining optional provenance", () => {
    const validate = validator();
    expect(
      validate({
        state: "unknown",
        value: null,
        observed_at: "2026-08-01T00:00:00.000Z",
        evidence_ids: [`evd_${UUID}`],
      }),
    ).toBe(true);
    expect(
      validate({
        state: "unavailable",
        value: "guessed",
        observed_at: null,
        evidence_ids: [],
      }),
    ).toBe(false);
  });
});

describe("canonical public contracts (DATA-040–DATA-061, API-002–API-006)", () => {
  const knownFact = (value: unknown) => ({
    state: "known",
    value,
    observed_at: "2026-08-01T00:00:00.000Z",
    evidence_ids: [`evd_${UUID}`],
  });

  it("requires evidence for public identity names and slugs", () => {
    const validate = standaloneValidator(ModelFamilySchema);
    const family = {
      family_id: `fam_${UUID}`,
      slug: knownFact("example-family"),
      display_name: knownFact("Example Family"),
      publisher: knownFact("Example Publisher"),
      model_ids: [],
      last_model_data_refresh: knownFact("2026-08-01T00:00:00.000Z"),
    };
    expect(validate(family)).toBe(true);
    expect(validate({ ...family, display_name: "Example Family" })).toBe(false);
    expect(validate({ ...family, slug: "example-family" })).toBe(false);
  });

  it("accepts future public enum values but never known unknown", () => {
    const validateFormat = standaloneValidator(PrecisionFormatSchema);
    expect(validateFormat("FP3_FUTURE")).toBe(true);
    expect(validateFormat("unknown")).toBe(false);
    const validateFact = standaloneValidator(
      FactSchema(PrecisionFormatSchema, "TestPrecisionFact"),
    );
    expect(validateFact(knownFact("FP3_FUTURE"))).toBe(true);
    expect(validateFact(knownFact("unknown"))).toBe(false);
  });

  it("enforces UTC millisecond timestamps and bounded exact decimals", () => {
    const validate = standaloneValidator(PriceSchema);
    const base = {
      price_id: `pcs_${UUID}`,
      offering_id: `off_${UUID}`,
      role: "input",
      price_class: "future_conditional_class",
      amount_decimal: "123456789012345678901234.123456789012345678",
      currency: "USD",
      currency_provenance: "provider_stated",
      unit: "per_million_tokens",
      conditions: [],
      is_standard_comparable: false,
      effective_from: null,
      effective_to: null,
      observed_at: "2026-08-01T00:00:00.000Z",
      evidence_ids: [`evd_${UUID}`],
    };
    expect(validate(base)).toBe(true);
    expect(validate({ ...base, observed_at: "2026-08-01T00:00:00Z" })).toBe(
      false,
    );
    expect(
      validate({ ...base, amount_decimal: "1234567890123456789012345" }),
    ).toBe(false);
  });

  it("keeps search result kinds strict and provider suggestions evidence-backed", () => {
    const validate = standaloneValidator(SearchResultSchema);
    const providerResult = {
      resource_type: "provider",
      resource_id: `prv_${UUID}`,
      display_name: knownFact("Example Provider"),
      match_kind: "provider_name",
      semantic_degraded: "none",
    };
    expect(validate(providerResult)).toBe(true);
    expect(validate({ ...providerResult, score: 0.99 })).toBe(false);
    expect(validate({ ...providerResult, resource_id: `mdl_${UUID}` })).toBe(
      false,
    );
  });

  it("requires exact decimal price provenance and evidence", () => {
    const validate = standaloneValidator(PriceSchema);
    const price = {
      price_id: `pcs_${UUID}`,
      offering_id: `off_${UUID}`,
      role: "cached_input",
      price_class: "standard",
      amount_decimal: "0",
      currency: "USD",
      currency_provenance: "system_default",
      unit: "per_million_tokens",
      conditions: [],
      is_standard_comparable: true,
      effective_from: null,
      effective_to: null,
      observed_at: "2026-08-01T00:00:00.000Z",
      evidence_ids: [`evd_${UUID}`],
    };
    expect(validate(price)).toBe(true);
    expect(validate({ ...price, amount_decimal: 0 })).toBe(false);
    expect(validate({ ...price, evidence_ids: [] })).toBe(false);
    expect(validate({ ...price, currency: "usd" })).toBe(false);
  });
});

describe("provider adapter contract (PIPE-010–PIPE-019, SEC-003–SEC-006)", () => {
  it("requires exact typed scope and provenance on known candidates", () => {
    const validate = standaloneValidator(CandidateFactSchema);
    const known = {
      state: "known",
      raw_value: "FP8",
      normalized_value: "FP8",
      observation_id: `obs_${UUID}`,
      evidence_span_locator: "/models/0/precision",
      scope: {
        scope_kind: "offering",
        subject_resource_id: `off_${UUID}`,
        source_object_locator: "/models/0",
        observed_from: "2026-08-01T00:00:00.000Z",
        observed_to: null,
        applicability: {
          provider_id: `prv_${UUID}`,
          provider_model_id: "publisher/model",
          tier_key: "standard",
          endpoint_class: "serverless",
          material_region_key: "",
          component_scope: "weights",
        },
      },
      extraction_method: "deterministic_json",
      extraction_version: "adapter@1.0.0",
      source_policy_version: "policy@1.0.0",
      qualifiers: {},
    };
    expect(validate(known)).toBe(true);
    expect(
      validate({ ...known, observation_id: null, evidence_span_locator: null }),
    ).toBe(false);
    expect(
      validate({
        ...known,
        scope: {
          ...known.scope,
          applicability: { provider_id: `prv_${UUID}` },
        },
      }),
    ).toBe(false);
  });

  it("declares handles and bounded acquisition policy without secret values", () => {
    const validate = standaloneValidator(AdapterManifestSchema);
    const manifest = {
      contract_version: "1.0.0",
      provider_id: `prv_${UUID}`,
      adapter_version: `1.0.0+sha256.${"a".repeat(64)}`,
      enabled_environments: ["local", "test"],
      source_policy_version: "policy@1.0.0",
      sources: [
        {
          source_id: "catalog",
          scheme: "https",
          host: "api.example.invalid",
          path_template: "/models/{cursor}",
          parameters: [
            {
              name: "cursor",
              location: "path",
              value_type: "string",
              required: true,
              enum_values: [],
              pattern: null,
              maximum_length: 256,
            },
          ],
          method: "GET",
          authentication_class: "api_key",
          allowed_headers: ["accept"],
          source_type: "provider_api",
          pagination: "cursor",
          content_types: ["application/json"],
          compressed_byte_limit: 1_000_000,
          uncompressed_byte_limit: 2_000_000,
          timeout_ms: 10_000,
          redirect_limit: 0,
          redirect_hosts: [],
          provider_rate_limit: "60/minute",
          crawl_purpose: "search",
          robots_policy: "required",
          content_signals_policy: "required",
          retention_permitted: true,
          publication_permitted: true,
          expected_precision_fields: ["precision"],
          expected_price_fields: ["input_price"],
          browser_session_approved: false,
        },
      ],
      credential_handles: [
        { binding_name: "PROVIDER_API_KEY", purpose: "catalog read" },
      ],
      roster_path: "fixtures/roster.json",
      roster_version: "roster@1",
      roster_hash: `sha256:${"b".repeat(64)}`,
      parser_version: "parser@1",
      extraction_policy_version: null,
      budgets: {
        requests_per_run: 20,
        pages_per_source: 10,
        bytes_per_run: 10_000_000,
        duration_ms: 60_000,
        retry_attempts: 2,
        browser_sessions: 0,
        ai_tokens: 0,
        items_per_run: 1_000,
      },
      compliance_review: {
        reviewer_role: "source compliance owner",
        reviewed_at: "2026-08-01T00:00:00.000Z",
        terms_version: "terms@2026-08-01",
        robots_version: "robots@2026-08-01",
        content_signals_version: "signals@2026-08-01",
        access_permitted: true,
        retention_permitted: true,
        publication_permitted: true,
        next_review_at: "2026-11-01T00:00:00.000Z",
      },
    };
    expect(validate(manifest)).toBe(true);
    expect(validate({ ...manifest, api_key: "secret" })).toBe(false);
    expect(
      validate({
        ...manifest,
        sources: [{ ...manifest.sources[0], redirect_limit: 99 }],
      }),
    ).toBe(false);
    expect(
      validate({
        ...manifest,
        sources: [{ ...manifest.sources[0], host: "127.0.0.1" }],
      }),
    ).toBe(false);
    expect(
      validateAdapterManifestSemantics(manifest as AdapterManifest, {
        asOf: "2026-08-01T00:00:00.000Z",
      }),
    ).toEqual([]);
    expect(
      validateAdapterManifestSemantics(
        {
          ...manifest,
          enabled_environments: ["production"],
          compliance_review: {
            ...manifest.compliance_review,
            publication_permitted: false,
          },
        } as AdapterManifest,
        { asOf: "2026-08-01T00:00:00.000Z" },
      ),
    ).toContain("production requires affirmative compliance review decisions");
    expect(
      validateAdapterManifestSemantics({
        ...manifest,
        enabled_environments: ["production"],
        sources: [
          {
            ...manifest.sources[0],
            publication_permitted: false,
          },
        ],
      } as AdapterManifest),
    ).toContain("catalog: source is not production-cleared");
    expect(
      validateAdapterManifestSemantics({
        ...manifest,
        sources: [
          {
            ...manifest.sources[0],
            source_type: "public_rendered_page",
            browser_session_approved: false,
          },
        ],
      } as AdapterManifest),
    ).toContain("catalog: rendered source lacks browser approval");
    expect(
      validateAdapterManifestSemantics({
        ...manifest,
        sources: [
          {
            ...manifest.sources[0],
            path_template: "/models/{Cursor}",
          },
        ],
      } as AdapterManifest),
    ).toContain("catalog: path template parameters do not match");
    expect(
      validateAdapterManifestSemantics({
        ...manifest,
        sources: [
          {
            ...manifest.sources[0],
            parameters: [
              {
                ...manifest.sources[0]!.parameters[0],
                pattern: "[",
              },
            ],
          },
        ],
      } as AdapterManifest),
    ).toContain("catalog: parameter cursor has an invalid pattern");
  });

  it("forbids silent roster omission from adapter batches", () => {
    const validate = standaloneValidator(AdapterBatchSchema);
    expect(
      validate({
        contract_version: "1.0.0",
        provider_id: `prv_${UUID}`,
        adapter_version: "adapter@1",
        roster_version: "roster@1",
        observations: [
          {
            observation_id: `obs_${UUID}`,
            source_id: "catalog",
            source_type: "provider_api",
            safe_locator: "https://api.example.invalid/models",
            retrieved_at: "2026-08-01T00:00:00.000Z",
            extraction_method: "deterministic_json",
            extraction_version: "parser@1",
            source_policy_version: "policy@1",
            redacted_hash: `sha256:${"c".repeat(64)}`,
          },
        ],
        model_candidates: [],
        variant_candidates: [],
        checkpoint_candidates: [],
        lineage_edge_candidates: [],
        offering_candidates: [],
        precision_candidates: [],
        precision_component_candidates: [],
        price_candidates: [],
        roster_outcomes: [],
        diagnostics: [],
      }),
    ).toBe(false);
  });

  it("enforces batch versions, references, budgets, and exact roster coverage", () => {
    const manifest = {
      contract_version: "1.0.0",
      provider_id: `prv_${UUID}`,
      adapter_version: `1.0.0+sha256.${"a".repeat(64)}`,
      enabled_environments: ["test"],
      source_policy_version: "policy@1",
      sources: [
        {
          source_id: "catalog",
          source_type: "provider_api",
          host: "api.example.invalid",
          redirect_hosts: [],
        },
      ],
      roster_version: "roster@1",
      budgets: { requests_per_run: 2, retry_attempts: 1, items_per_run: 2 },
    } as unknown as AdapterManifest;
    const batch = {
      contract_version: "1.0.0",
      provider_id: `prv_${UUID}`,
      adapter_version: manifest.adapter_version,
      roster_version: "roster@1",
      observations: [
        {
          observation_id: `obs_${UUID}`,
          source_id: "catalog",
          source_type: "provider_api",
          safe_locator: "https://api.example.invalid/models",
          source_policy_version: "policy@1",
        },
      ],
      model_candidates: [],
      variant_candidates: [],
      checkpoint_candidates: [],
      lineage_edge_candidates: [],
      offering_candidates: [],
      precision_candidates: [],
      precision_component_candidates: [],
      price_candidates: [],
      roster_outcomes: [
        {
          roster_item_id: "item-1",
          outcome: "failed",
          observation_ids: [`obs_${UUID}`],
          attempt_count: 1,
          candidate_offering_id: null,
        },
      ],
    } as unknown as Parameters<typeof validateAdapterBatchSemantics>[0];
    expect(
      validateAdapterBatchSemantics(batch, {
        manifest,
        rosterItemIds: ["item-1"],
      }),
    ).toEqual([]);
    expect(
      validateAdapterBatchSemantics(
        {
          ...batch,
          roster_outcomes: [
            ...batch.roster_outcomes,
            batch.roster_outcomes[0]!,
          ],
        },
        { manifest, rosterItemIds: ["item-1", "item-2"] },
      ),
    ).toEqual(
      expect.arrayContaining([
        "duplicate roster outcome: item-1",
        "missing roster outcome: item-2",
      ]),
    );
    expect(
      validateAdapterBatchSemantics(
        {
          ...batch,
          price_candidates: [
            {
              candidate_id: "price-1",
              facts: {
                amount: {
                  state: "known",
                  raw_value: "1.00",
                  normalized_value: "1",
                  observation_id: `obs_${UUID}`,
                  evidence_span_locator: "/price",
                  scope: {
                    scope_kind: "provider",
                    subject_resource_id: `prv_${UUID}`,
                    source_object_locator: "/models",
                    observed_from: "2026-08-01T00:00:00.000Z",
                    observed_to: null,
                  },
                  extraction_method: "deterministic_json",
                  extraction_version: "parser@1",
                  source_policy_version: "policy@1",
                  qualifiers: {},
                },
              },
            },
          ],
        },
        { manifest, rosterItemIds: ["item-1"] },
      ),
    ).toContain("price-1: price/precision fact lacks exact offering scope");
  });
});

describe("atomic publication contract (PIPE-050–PIPE-056)", () => {
  it("requires versioned provider slices, search readiness, and closure hash", () => {
    const validate = standaloneValidator(PublicationManifestSchema);
    const manifest = {
      publication_id: `pub_${UUID}`,
      state: "ready",
      schema_version: "1.0.0",
      generated_at: "2026-08-01T00:00:00.000Z",
      ready_at: "2026-08-01T00:01:00.000Z",
      activated_at: null,
      source_run_id: `run_${UUID}`,
      parent_publication_id: null,
      provider_slices: [
        {
          provider_id: `prv_${UUID}`,
          provider_run_id: `pvr_${UUID}`,
          carried_forward: false,
          freshness_state: "fresh",
        },
      ],
      resources: [],
      search_index: {
        exact_document_count: 0,
        vector_document_count: 0,
        exact_index_hash: `sha256:${"d".repeat(64)}`,
        vector_index_version: "vector@1",
        queryable: true,
      },
      closure_hash: `sha256:${"e".repeat(64)}`,
      failure_codes: [],
    };
    expect(validate(manifest)).toBe(true);
    expect(validate({ ...manifest, closure_hash: "not-a-hash" })).toBe(false);
    expect(validate({ ...manifest, source_run_id: `pub_${UUID}` })).toBe(false);
    expect(validate({ ...manifest, state: "active", activated_at: null })).toBe(
      false,
    );
    expect(
      validatePublicationManifestSemantics(manifest as PublicationManifest),
    ).toEqual([]);
    expect(
      validatePublicationManifestSemantics({
        ...manifest,
        provider_slices: [
          ...manifest.provider_slices,
          { ...manifest.provider_slices[0], carried_forward: true },
        ],
        resources: [
          {
            resource_type: "model",
            resource_id: `prv_${UUID}`,
            content_hash: `sha256:${"f".repeat(64)}`,
          },
        ],
        search_index: {
          ...manifest.search_index,
          exact_document_count: 1,
          vector_document_count: 1,
        },
      } as PublicationManifest),
    ).toEqual(
      expect.arrayContaining([
        `duplicate provider slice: prv_${UUID}`,
        `model:prv_${UUID}: resource type and ID prefix disagree`,
      ]),
    );
    expect(
      validatePublicationManifestSemantics({
        ...manifest,
        resources: [
          {
            resource_type: "model",
            resource_id: `mdl_${UUID}`,
            content_hash: `sha256:${"f".repeat(64)}`,
          },
          {
            resource_type: "model",
            resource_id: `mdl_${UUID}`,
            content_hash: `sha256:${"0".repeat(64)}`,
          },
        ],
        search_index: {
          ...manifest.search_index,
          exact_document_count: 1,
          vector_document_count: 1,
        },
      } as PublicationManifest),
    ).toContain(`duplicate publication resource: model:mdl_${UUID}`);
  });
});
