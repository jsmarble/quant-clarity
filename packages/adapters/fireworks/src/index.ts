import type {
  AdapterBatch,
  AdapterManifest,
  AdapterRoster,
} from "@quant-clarity/contracts";

const PROVIDER_ID = "prv_e234a657-a08e-46e9-8bd6-d08dfb7a6079";
const MODEL_ID = "mdl_747d7648-9ee9-474c-823f-df87c07e5757";
const OFFERING_ID = "off_50241801-ea55-48e6-aee9-ab6fb85f67e1";
const CATALOG_OBSERVATION_ID = "obs_c54f90e2-c507-44ca-959a-5f76d011ef28";
const PRICING_OBSERVATION_ID = "obs_12e96ec2-3e17-4b37-82b3-dd3498545f0e";
const OBSERVED_AT = "2026-08-01T00:00:00.000Z";
const SOURCE_POLICY_VERSION = "source-precedence-1.0.0";
const EXTRACTION_VERSION = "fireworks-structured-1.0.0";

export const manifest = {
  contract_version: "1.0.0",
  provider_id: PROVIDER_ID,
  adapter_version:
    "1.0.0+sha256.6e9c588818767a666d5a014e794d7f6f716128135fee1bd2f61b1b10b02466db",
  enabled_environments: ["local", "test"],
  source_policy_version: SOURCE_POLICY_VERSION,
  sources: [
    {
      source_id: "model_catalog",
      scheme: "https",
      host: "api.fireworks.ai",
      path_template: "/v1/accounts/{account_id}/models",
      safe_locator_template: "/v1/accounts/redacted/models",
      parameters: [
        {
          name: "account_id",
          location: "path",
          value_type: "string",
          required: true,
          enum_values: [],
          pattern: "^[a-zA-Z0-9_-]{1,128}$",
          maximum_length: 128,
        },
        {
          name: "page_token",
          location: "query",
          value_type: "string",
          required: false,
          enum_values: [],
          pattern: "^[A-Za-z0-9._~-]{1,512}$",
          maximum_length: 512,
        },
      ],
      method: "GET",
      authentication_class: "bearer",
      credential_handle: "FIREWORKS_CATALOG_TOKEN",
      credential_injection: "authorization_bearer",
      credential_header: "Authorization",
      allowed_headers: ["Accept", "Authorization"],
      source_type: "authenticated_catalog",
      pagination: "nextPageToken; page size fixed at 200",
      content_types: ["application/json"],
      compressed_byte_limit: 1_000_000,
      uncompressed_byte_limit: 4_000_000,
      timeout_ms: 10_000,
      redirect_limit: 0,
      redirect_hosts: [],
      provider_rate_limit: "operator-configured below documented account limit",
      crawl_purpose: "structured API retrieval",
      robots_policy:
        "not applicable to authenticated API; legal review required",
      content_signals_policy:
        "not applicable to authenticated API; legal review required",
      retention_permitted: false,
      publication_permitted: false,
      expected_precision_fields: ["baseModelDetails.defaultPrecision"],
      expected_price_fields: [],
      browser_session_approved: false,
    },
    {
      source_id: "serverless_pricing",
      scheme: "https",
      host: "docs.fireworks.ai",
      path_template: "/serverless/pricing",
      safe_locator_template: "/serverless/pricing",
      parameters: [],
      method: "GET",
      authentication_class: "none",
      credential_handle: null,
      credential_injection: null,
      credential_header: null,
      allowed_headers: ["Accept"],
      source_type: "public_static_page",
      pagination: "none",
      content_types: ["text/html", "text/markdown"],
      compressed_byte_limit: 500_000,
      uncompressed_byte_limit: 2_000_000,
      timeout_ms: 10_000,
      redirect_limit: 0,
      redirect_hosts: [],
      provider_rate_limit: "one request per scheduled provider run",
      crawl_purpose: "public factual pricing retrieval",
      robots_policy: "pending source-compliance review",
      content_signals_policy: "pending source-compliance review",
      retention_permitted: false,
      publication_permitted: false,
      expected_precision_fields: [],
      expected_price_fields: [
        "input",
        "cached input",
        "output",
        "currency",
        "unit",
      ],
      browser_session_approved: false,
    },
  ],
  credential_handles: [
    {
      binding_name: "FIREWORKS_CATALOG_TOKEN",
      purpose: "read-only model catalog access after compliance approval",
    },
  ],
  roster_path: "fixtures/providers/fireworks/roster.json",
  roster_version: "synthetic-1.0.0",
  roster_hash:
    "sha256:42a4555464507cb2424ffd71e3e1c6a7352ca61cac4568abc25f3974b39e9fea",
  parser_version: EXTRACTION_VERSION,
  extraction_policy_version: null,
  budgets: {
    requests_per_run: 8,
    pages_per_source: 4,
    bytes_per_run: 8_000_000,
    duration_ms: 60_000,
    retry_attempts: 2,
    browser_sessions: 0,
    ai_tokens: 0,
    items_per_run: 1_000,
  },
  compliance_review: {
    register_path: "docs/compliance/sources/fireworks.md",
    register_hash:
      "sha256:7fb76f02cb08d003ca6c9453534dac90f928cf0b72df32f52a469ea7b3a95613",
    reviewer_role: "authorized owner or legal reviewer (pending)",
    reviewed_at: OBSERVED_AT,
    terms_version: "pending",
    robots_version: "pending",
    content_signals_version: "pending",
    access_permitted: false,
    retention_permitted: false,
    publication_permitted: false,
    next_review_at: "2026-08-02T00:00:00.000Z",
  },
} as const satisfies AdapterManifest;

export const roster = {
  fixture_kind: "synthetic_non_publishable",
  provider_id: PROVIDER_ID,
  roster_version: "synthetic-1.0.0",
  items: [
    {
      roster_item_id: "fireworks-example-8b-standard",
      provider_model_id: "accounts/fireworks/models/example-8b",
      tier_key: "standard",
      endpoint_class: "serverless",
      material_region_key: "",
    },
  ],
} as const satisfies AdapterRoster;

export const retrieve = {
  sources: manifest.sources.map((source) => ({
    source_id: source.source_id,
    host: source.host,
    path_template: source.path_template,
    redirect_mode: "manual" as const,
    maximum_pages: manifest.budgets.pages_per_source,
    timeout_ms: source.timeout_ms,
  })),
  production_enabled: false,
} as const;

interface SyntheticCatalogFixture {
  readonly models: readonly [
    {
      readonly name: string;
      readonly displayName: string;
      readonly state: string;
      readonly supportsServerless: boolean;
      readonly baseModelDetails: {
        readonly parameterCount: string;
        readonly checkpointFormat: string;
        readonly defaultPrecision: string;
      };
    },
  ];
  readonly nextPageToken: string;
}

interface SyntheticPricingFixture {
  readonly rows: readonly [
    {
      readonly providerModelId: string;
      readonly tier: string;
      readonly currency: string;
      readonly unit: string;
      readonly input: string;
      readonly cachedInput: string;
      readonly output: string;
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 512)
    throw new TypeError(`Invalid fixture field: ${key}`);
  return value;
}

export const parse = (
  catalogInput: unknown,
  pricingInput: unknown,
): {
  catalog: SyntheticCatalogFixture;
  pricing: SyntheticPricingFixture;
} => {
  const pages = Array.isArray(catalogInput) ? catalogInput : [catalogInput];
  if (pages.length === 0 || pages.length > manifest.budgets.pages_per_source)
    throw new TypeError("Catalog fixture exceeds the page budget.");
  const parsedModels: SyntheticCatalogFixture["models"][number][] = [];
  const pageTokens = new Set<string>();
  for (const [pageIndex, page] of pages.entries()) {
    if (!isRecord(page) || !Array.isArray(page.models))
      throw new TypeError("Catalog fixture must contain models.");
    if (page.models.length > 200)
      throw new TypeError("Catalog page exceeds the item ceiling.");
    const nextPageToken =
      typeof page.nextPageToken === "string" ? page.nextPageToken : "";
    if (nextPageToken.length > 512 || /[^A-Za-z0-9._~-]/u.test(nextPageToken))
      throw new TypeError("Catalog page token is invalid.");
    const isFinalPage = pageIndex === pages.length - 1;
    if (
      (!isFinalPage && nextPageToken === "") ||
      (isFinalPage && nextPageToken !== "")
    )
      throw new TypeError("Catalog pagination is incomplete.");
    if (nextPageToken !== "" && pageTokens.has(nextPageToken))
      throw new TypeError("Catalog pagination token loop detected.");
    pageTokens.add(nextPageToken);

    for (const item of page.models) {
      if (!isRecord(item) || !isRecord(item.baseModelDetails))
        throw new TypeError("Catalog model must contain baseModelDetails.");
      const supportsServerless = item.supportsServerless;
      if (typeof supportsServerless !== "boolean")
        throw new TypeError("Invalid fixture field: supportsServerless");
      parsedModels.push({
        name: requiredString(item, "name"),
        displayName: requiredString(item, "displayName"),
        state: requiredString(item, "state"),
        supportsServerless,
        baseModelDetails: {
          parameterCount: requiredString(
            item.baseModelDetails,
            "parameterCount",
          ),
          checkpointFormat: requiredString(
            item.baseModelDetails,
            "checkpointFormat",
          ),
          defaultPrecision: requiredString(
            item.baseModelDetails,
            "defaultPrecision",
          ),
        },
      });
    }
  }
  const [parsedModel] = parsedModels;
  if (parsedModels.length !== 1 || parsedModel === undefined)
    throw new TypeError(
      "Synthetic catalog fixture must resolve exactly one rostered model.",
    );
  if (!isRecord(pricingInput) || !Array.isArray(pricingInput.rows))
    throw new TypeError("Pricing fixture must contain rows.");
  if (pricingInput.rows.length !== 1 || !isRecord(pricingInput.rows[0]))
    throw new TypeError(
      "Synthetic pricing fixture must contain exactly one row.",
    );
  const price = pricingInput.rows[0];

  return {
    catalog: {
      models: [parsedModel],
      nextPageToken: "",
    },
    pricing: {
      rows: [
        {
          providerModelId: requiredString(price, "providerModelId"),
          tier: requiredString(price, "tier"),
          currency: requiredString(price, "currency"),
          unit: requiredString(price, "unit"),
          input: requiredString(price, "input"),
          cachedInput: requiredString(price, "cachedInput"),
          output: requiredString(price, "output"),
        },
      ],
    },
  };
};

const modelScope = {
  scope_kind: "model" as const,
  subject_resource_id: MODEL_ID,
  source_object_locator: "$.models[0].baseModelDetails",
  observed_from: OBSERVED_AT,
  observed_to: null,
};

const offeringScope = {
  scope_kind: "offering" as const,
  subject_resource_id: OFFERING_ID,
  source_object_locator: "$.rows[0]",
  observed_from: OBSERVED_AT,
  observed_to: null,
  applicability: {
    provider_id: PROVIDER_ID,
    provider_model_id: "accounts/fireworks/models/example-8b",
    tier_key: "standard",
    endpoint_class: "serverless",
    material_region_key: "",
    component_scope: null,
  },
};

function knownFact(
  rawValue: string | boolean,
  normalizedValue: string | boolean,
  observationId: typeof CATALOG_OBSERVATION_ID | typeof PRICING_OBSERVATION_ID,
  locator: string,
  scope: typeof modelScope | typeof offeringScope,
) {
  return {
    state: "known" as const,
    raw_value: rawValue,
    normalized_value: normalizedValue,
    observation_id: observationId,
    evidence_span_locator: locator,
    scope,
    extraction_method: "deterministic_structured",
    extraction_version: EXTRACTION_VERSION,
    source_policy_version: SOURCE_POLICY_VERSION,
    qualifiers: {},
  };
}

function unknownOfferingFact(locator: string) {
  return {
    state: "unknown" as const,
    raw_value: null,
    normalized_value: null,
    observation_id: CATALOG_OBSERVATION_ID,
    evidence_span_locator: locator,
    scope: offeringScope,
    extraction_method: "deterministic_structured",
    extraction_version: EXTRACTION_VERSION,
    source_policy_version: SOURCE_POLICY_VERSION,
    qualifiers: { reason: "base_object_not_exact_offering" },
  };
}

export const map = (parsed: ReturnType<typeof parse>): AdapterBatch => {
  const model = parsed.catalog.models[0];
  const price = parsed.pricing.rows[0];
  if (
    model.name !== roster.items[0].provider_model_id ||
    price.providerModelId !== roster.items[0].provider_model_id ||
    price.tier !== roster.items[0].tier_key
  )
    throw new TypeError(
      "Fixture identities do not match the versioned roster.",
    );

  const priceFacts = (["input", "cachedInput", "output"] as const).map(
    (role) => ({
      candidate_id: `price:${role}`,
      facts: {
        role: knownFact(
          role,
          role === "cachedInput" ? "cached_input" : role,
          PRICING_OBSERVATION_ID,
          `row[0].${role}`,
          offeringScope,
        ),
        amount_decimal: knownFact(
          price[role],
          price[role],
          PRICING_OBSERVATION_ID,
          `row[0].${role}`,
          offeringScope,
        ),
        currency: knownFact(
          price.currency,
          price.currency,
          PRICING_OBSERVATION_ID,
          "row[0].currency",
          offeringScope,
        ),
        currency_presence: knownFact(
          "provider_stated",
          "provider_stated",
          PRICING_OBSERVATION_ID,
          "row[0].currency",
          offeringScope,
        ),
        unit: knownFact(
          price.unit,
          price.unit,
          PRICING_OBSERVATION_ID,
          "pricing units",
          offeringScope,
        ),
      },
    }),
  );

  return {
    contract_version: manifest.contract_version,
    provider_id: PROVIDER_ID,
    adapter_version: manifest.adapter_version,
    roster_version: manifest.roster_version,
    observations: [
      {
        observation_id: CATALOG_OBSERVATION_ID,
        source_id: "model_catalog",
        source_type: "authenticated_catalog",
        safe_locator: "https://api.fireworks.ai/v1/accounts/redacted/models",
        retrieved_at: OBSERVED_AT,
        extraction_method: "deterministic_structured",
        extraction_version: EXTRACTION_VERSION,
        source_policy_version: SOURCE_POLICY_VERSION,
        redacted_hash:
          "sha256:89e12f3bdb62d722199539b16a78e96d0226ee87e4f891894ba47a48e27da0b1",
      },
      {
        observation_id: PRICING_OBSERVATION_ID,
        source_id: "serverless_pricing",
        source_type: "public_static_page",
        safe_locator: "https://docs.fireworks.ai/serverless/pricing",
        retrieved_at: OBSERVED_AT,
        extraction_method: "deterministic_structured",
        extraction_version: EXTRACTION_VERSION,
        source_policy_version: SOURCE_POLICY_VERSION,
        redacted_hash:
          "sha256:e2ce0eb9fc9068c782af71e90c1457e97c6d3018d926648f107686f6db5021b5",
      },
    ],
    model_candidates: [
      {
        candidate_id: MODEL_ID,
        facts: {
          display_name: knownFact(
            model.displayName,
            model.displayName,
            CATALOG_OBSERVATION_ID,
            "models[0].displayName",
            modelScope,
          ),
          parameter_count: knownFact(
            model.baseModelDetails.parameterCount,
            model.baseModelDetails.parameterCount,
            CATALOG_OBSERVATION_ID,
            "models[0].baseModelDetails.parameterCount",
            modelScope,
          ),
          source_default_precision: knownFact(
            model.baseModelDetails.defaultPrecision,
            model.baseModelDetails.defaultPrecision,
            CATALOG_OBSERVATION_ID,
            "models[0].baseModelDetails.defaultPrecision",
            modelScope,
          ),
        },
      },
    ],
    variant_candidates: [],
    checkpoint_candidates: [],
    lineage_edge_candidates: [],
    offering_candidates: [
      {
        candidate_id: OFFERING_ID,
        facts: {
          provider_model_id: knownFact(
            model.name,
            model.name,
            CATALOG_OBSERVATION_ID,
            "models[0].name",
            offeringScope,
          ),
          status: knownFact(
            model.state,
            model.supportsServerless ? "active" : "unavailable",
            CATALOG_OBSERVATION_ID,
            "models[0].supportsServerless",
            offeringScope,
          ),
        },
      },
    ],
    precision_candidates: [
      {
        candidate_id: `precision:${OFFERING_ID}`,
        facts: {
          normalized_format: unknownOfferingFact(
            "models[0].baseModelDetails.defaultPrecision",
          ),
        },
      },
    ],
    precision_component_candidates: [],
    price_candidates: priceFacts,
    roster_outcomes: [
      {
        roster_item_id: roster.items[0].roster_item_id,
        outcome: "published_candidate_with_unknowns",
        reason_code: "exact_precision_unknown",
        observation_ids: [CATALOG_OBSERVATION_ID, PRICING_OBSERVATION_ID],
        evidence_span_locators: ["models[0]", "serverless pricing row[0]"],
        attempt_count: 1,
        last_response_class: "synthetic_fixture",
        candidate_offering_id: OFFERING_ID,
      },
    ],
    diagnostics: [
      {
        severity: "info",
        code: "base_precision_not_promoted",
        message:
          "Catalog base-model default precision remains model-scoped and does not become serving precision.",
        roster_item_id: roster.items[0].roster_item_id,
      },
    ],
  };
};

export const fixtures = {
  catalog: {
    models: [
      {
        name: "accounts/fireworks/models/example-8b",
        displayName: "Synthetic Example 8B",
        state: "READY",
        supportsServerless: true,
        baseModelDetails: {
          parameterCount: "8000000000",
          checkpointFormat: "CHECKPOINT_FORMAT_HUGGINGFACE",
          defaultPrecision: "PRECISION_FP8",
        },
      },
    ],
    nextPageToken: "",
  },
  pricing: {
    rows: [
      {
        providerModelId: "accounts/fireworks/models/example-8b",
        tier: "standard",
        currency: "USD",
        unit: "per_million_tokens",
        input: "0.20",
        cachedInput: "0.10",
        output: "0.20",
      },
    ],
  },
} as const;
