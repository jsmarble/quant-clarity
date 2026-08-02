import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, expectTypeOf, it } from "vitest";

import { Type, type Static } from "@sinclair/typebox";

import {
  AdapterBatchSchema,
  AdapterManifestSchema,
  CandidateFactSchema,
  derivePublicationVectorId,
  EvidenceIdSchema,
  FactSchema,
  type AdapterManifest,
  type FactState,
  type IdPrefix,
  MethodologyDetailSchema,
  ModelFamilySchema,
  PriceSchema,
  PrecisionFormatSchema,
  PROVIDER_DISPLAY_NAME_MAX_UNICODE_SCALARS,
  ProviderSchema,
  type PublicationManifest,
  type PublicationHead,
  PublicationHeadSchema,
  PublicationManifestSchema,
  SearchResultSchema,
  validateAdapterBatchSemantics,
  validateAdapterManifestSemantics,
  validatePublicationActivation,
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

  it("counts provider display-name maxLength in Unicode scalars", () => {
    const validate = standaloneValidator(ProviderSchema);
    const provider = {
      provider_id: `prv_${UUID}`,
      slug: knownFact("astral-provider"),
      display_name: knownFact(
        "\u{1f642}".repeat(PROVIDER_DISPLAY_NAME_MAX_UNICODE_SCALARS),
      ),
      official_site: knownFact("https://provider.example"),
      status: knownFact("active"),
      active_offering_count: {
        value: 0,
        observed_at: "2026-08-01T00:00:00.000Z",
        derivation_version: "provider-count@1",
      },
      precision_coverage: {
        known_count: 0,
        unknown_count: 0,
        known_proportion_decimal: "0",
        derivation_version: "precision-coverage@1",
      },
      last_successful_refresh: knownFact("2026-08-01T00:00:00.000Z"),
      affiliate_relationship_present: false,
    };
    expect(PROVIDER_DISPLAY_NAME_MAX_UNICODE_SCALARS).toBe(200);
    expect(validate(provider)).toBe(true);
    expect(
      validate({
        ...provider,
        display_name: knownFact("\u{1f642}".repeat(201)),
      }),
    ).toBe(false);
    expect(validate({ ...provider, display_name: knownFact("") })).toBe(false);
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

  it("keeps versioned methodology metadata distinct from canonical facts", () => {
    const validate = standaloneValidator(MethodologyDetailSchema);
    const detail = {
      data: {
        methodology_version: "1.0.0",
        methodology_effective_at: "2026-08-01T00:00:00.000Z",
        methodology_url: "https://example.invalid/methodology/1.0.0",
      },
      meta: {
        resource: "methodologies",
        publication_id: `pub_${UUID}`,
        schema_version: "1.0.0",
        sort: ["version"],
        filters: {},
      },
    };
    expect(validate(detail)).toBe(true);
    expect(
      validate({
        ...detail,
        data: { ...detail.data, content: "duplicate methodology body" },
      }),
    ).toBe(false);
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
          safe_locator_template: "/models",
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
          credential_handle: "PROVIDER_API_KEY",
          credential_injection: "header",
          credential_header: "x-api-key",
          allowed_headers: ["accept", "x-api-key"],
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
        register_path: "docs/compliance/sources/example.md",
        register_hash: `sha256:${"c".repeat(64)}`,
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
        enabled_environments: ["production"],
      } as AdapterManifest),
    ).toContain("production compliance validation requires a valid asOf time");
    expect(
      validateAdapterManifestSemantics({
        ...manifest,
        sources: [
          {
            ...manifest.sources[0],
            credential_handle: "UNDECLARED_KEY",
          },
        ],
      } as AdapterManifest),
    ).toContain(
      "catalog: authenticated source lacks an exact credential handle",
    );
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
            path_template: "//169.254.169.254/latest/meta-data",
            parameters: [],
          },
        ],
      } as AdapterManifest),
    ).toContain("catalog: unsafe path template");
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
          safe_locator_template: "/models",
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
    expect(
      validateAdapterBatchSemantics(
        {
          ...batch,
          observations: [
            {
              ...batch.observations[0]!,
              safe_locator:
                "https://api.example.invalid/models?access_token=secret",
            },
          ],
        },
        { manifest, rosterItemIds: ["item-1"] },
      ),
    ).toContain(
      `obs_${UUID}: source locator must not retain query or fragment data`,
    );
    expect(
      validateAdapterBatchSemantics(
        {
          ...batch,
          observations: [
            {
              ...batch.observations[0]!,
              safe_locator:
                "https://api.example.invalid/accounts/real-customer/models",
            },
          ],
        },
        { manifest, rosterItemIds: ["item-1"] },
      ),
    ).toContain(
      `obs_${UUID}: source locator does not match its redacted template`,
    );
  });
});

describe("atomic publication contract (PIPE-050–PIPE-056)", () => {
  it("requires versioned provider slices, search readiness, and closure hash", async () => {
    const validate = standaloneValidator(PublicationManifestSchema);
    const manifest = {
      publication_id: `pub_${UUID}`,
      state: "ready",
      schema_version: "1.0.0",
      methodology_version: "methodology@1",
      precision_normalization_version: "precision@1",
      precision_display_order_version: "display@1",
      price_policy_version: "price@1",
      source_policy_version: "source@1",
      embedding_version: "embedding@1",
      build_commit: "commit",
      generated_at: "2026-08-01T00:00:00.000Z",
      ready_at: "2026-08-01T00:01:00.000Z",
      activated_at: null,
      source_run_id: `run_${UUID}`,
      parent_publication_id: null,
      enabled_provider_scope_version: "providers@1",
      enabled_provider_ids: [`prv_${UUID}`],
      provider_slices: [
        {
          provider_id: `prv_${UUID}`,
          provider_slice_id: `prn_${UUID}`,
          provider_run_id: `pvr_${UUID}`,
          adapter_version: "adapter@1",
          roster_version: "roster@1",
          source_register_version: "register@1",
          carried_forward: false,
          freshness_state: "fresh",
        },
      ],
      provider_attributions: [],
      resources: [],
      search_index: {
        vector_namespace: `pub_${UUID}`,
        exact_document_count: 0,
        vector_document_count: 0,
        exact_index_hash: `sha256:${"d".repeat(64)}`,
        vector_index_version: "vector@1",
        vectors: [],
        queryable: true,
      },
      closure_hash: `sha256:${"e".repeat(64)}`,
      failure_codes: [],
    };
    expect(validate(manifest)).toBe(true);
    expect(validate({ ...manifest, closure_hash: "not-a-hash" })).toBe(false);
    expect(validate({ ...manifest, build_commit: "" })).toBe(false);
    expect(
      validate({ ...manifest, enabled_provider_scope_version: "scope\n2" }),
    ).toBe(false);
    expect(validate({ ...manifest, source_run_id: `pub_${UUID}` })).toBe(false);
    expect(
      validate({
        ...manifest,
        provider_slices: manifest.provider_slices.map((slice) =>
          Object.fromEntries(
            Object.entries(slice).filter(
              ([fieldName]) => fieldName !== "provider_slice_id",
            ),
          ),
        ),
      }),
    ).toBe(false);
    expect(validate({ ...manifest, state: "active", activated_at: null })).toBe(
      false,
    );
    expect(
      await validatePublicationManifestSemantics(
        manifest as PublicationManifest,
      ),
    ).toEqual([]);
    expect(
      await validatePublicationManifestSemantics({
        ...manifest,
        provider_slices: [
          {
            ...manifest.provider_slices[0],
            carried_forward: false,
            freshness_state: "stale",
          },
        ],
      } as PublicationManifest),
    ).toContain(
      `provider slice carry-forward and freshness disagree: prv_${UUID}`,
    );
    expect(
      await validatePublicationManifestSemantics({
        ...manifest,
        provider_slices: [
          {
            ...manifest.provider_slices[0],
            provider_slice_id: null,
          },
        ],
      } as PublicationManifest),
    ).toContain(`provider slice identity and freshness disagree: prv_${UUID}`);
    expect(
      await validatePublicationManifestSemantics({
        ...manifest,
        enabled_provider_ids: [`prv_00000000-0000-4000-8000-000000000002`],
      } as PublicationManifest),
    ).toContain("provider slices do not exactly cover enabled provider scope");
    const unavailable = {
      ...manifest,
      provider_slices: [
        {
          ...manifest.provider_slices[0],
          provider_slice_id: null,
          carried_forward: false,
          freshness_state: "unavailable",
        },
      ],
    } as PublicationManifest;
    expect(validate(unavailable)).toBe(true);
    expect(await validatePublicationManifestSemantics(unavailable)).toEqual([]);
    expect(
      await validatePublicationManifestSemantics({
        ...unavailable,
        provider_slices: [
          {
            ...unavailable.provider_slices[0],
            provider_slice_id: `prn_${UUID}`,
          },
        ],
      } as PublicationManifest),
    ).toContain(`provider slice identity and freshness disagree: prv_${UUID}`);
    expect(
      await validatePublicationManifestSemantics({
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
      await validatePublicationManifestSemantics({
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

    const providerResource = {
      resource_type: "provider" as const,
      resource_id: `prv_${UUID}`,
      content_hash: `sha256:${"4".repeat(64)}`,
    };
    const providerAttribution = {
      resource_type: "provider" as const,
      resource_id: providerResource.resource_id,
      provider_id: `prv_${UUID}`,
    };
    const providerManifest = {
      ...manifest,
      resources: [providerResource],
      provider_attributions: [providerAttribution],
    } as PublicationManifest;
    expect(validate(providerManifest)).toBe(true);
    expect(
      await validatePublicationManifestSemantics(providerManifest),
    ).toEqual([]);
    expect(
      await validatePublicationManifestSemantics({
        ...providerManifest,
        provider_attributions: [],
      }),
    ).toContain("provider attribution inventory does not close over resources");
    expect(
      await validatePublicationManifestSemantics({
        ...providerManifest,
        provider_slices: [
          {
            ...providerManifest.provider_slices[0]!,
            provider_slice_id: null,
            freshness_state: "unavailable",
          },
        ],
      }),
    ).toContain(
      `unavailable provider owns attributed public resource: provider:prv_${UUID}`,
    );

    const modelResource = {
      resource_type: "model" as const,
      resource_id: `mdl_${UUID}`,
      content_hash: `sha256:${"f".repeat(64)}`,
    };
    const vectorId = await derivePublicationVectorId(
      manifest.publication_id,
      "model",
      modelResource.resource_id,
    );
    const vector = {
      vector_id: vectorId,
      resource_type: "model" as const,
      resource_id: `mdl_${UUID}`,
      search_document_content_hash: `sha256:${"2".repeat(64)}`,
      embedding_input_hash: `sha256:${"3".repeat(64)}`,
    };
    const indexedManifest = {
      ...manifest,
      resources: [modelResource],
      search_index: {
        ...manifest.search_index,
        exact_document_count: 1,
        vector_document_count: 1,
        vectors: [vector],
      },
    } as PublicationManifest;
    expect(validate(indexedManifest)).toBe(true);
    expect(
      validate({
        ...indexedManifest,
        search_index: {
          ...indexedManifest.search_index,
          vectors: [{ ...vector, vector_id: "G".repeat(64) }],
        },
      }),
    ).toBe(false);
    expect(await validatePublicationManifestSemantics(indexedManifest)).toEqual(
      [],
    );
    expect(
      await validatePublicationManifestSemantics({
        ...indexedManifest,
        search_index: {
          ...indexedManifest.search_index,
          vectors: [{ ...vector, vector_id: "1".repeat(64) }],
        },
      }),
    ).toContain(
      `publication vector ID does not match ADR 0013 identity: model:mdl_${UUID}`,
    );
    expect(
      await validatePublicationManifestSemantics({
        ...indexedManifest,
        search_index: {
          ...indexedManifest.search_index,
          vector_namespace: `pub_00000000-0000-4000-8000-000000000002`,
          vectors: [vector, vector],
          vector_document_count: 2,
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "vector namespace does not match publication",
        `duplicate publication vector: ${vectorId}`,
        `duplicate publication vector resource: model:mdl_${UUID}`,
      ]),
    );

    const activeManifest = {
      ...indexedManifest,
      state: "active",
      activated_at: "2026-08-01T00:02:00.000Z",
    } as PublicationManifest;
    const head = {
      active_publication_id: activeManifest.publication_id,
      vector_namespace: activeManifest.publication_id,
      manifest_hash: activeManifest.closure_hash,
      published_at: activeManifest.activated_at,
      rollback_candidate_publication_id: null,
      switched_at: "2026-08-01T00:02:00.000Z",
      generation: 1,
    } as PublicationHead;
    expect(standaloneValidator(PublicationHeadSchema)(head)).toBe(true);
    expect(await validatePublicationActivation(activeManifest, head)).toEqual(
      [],
    );
    expect(
      await validatePublicationActivation(activeManifest, {
        ...head,
        vector_namespace: `pub_00000000-0000-4000-8000-000000000002`,
        manifest_hash: `sha256:${"0".repeat(64)}`,
        published_at: "2026-08-01T00:03:00.000Z",
      }),
    ).toEqual(
      expect.arrayContaining([
        "publication head namespace does not select manifest",
        "publication head hash does not match manifest closure",
        "publication head time does not match manifest activation",
      ]),
    );
  });
});
