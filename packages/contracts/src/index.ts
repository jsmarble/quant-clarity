import { Type, type Static, type TSchema } from "@sinclair/typebox";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const SEMVER = "^[0-9]+\\.[0-9]+\\.[0-9]+$";
const SHA256 = "^sha256:[0-9a-f]{64}$";
const DECIMAL = "^(0|[1-9][0-9]{0,23})(\\.[0-9]{1,18})?$";
const UTC_MILLISECOND_TIMESTAMP =
  "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$";

function prefixedId(prefix: string, schemaId?: string) {
  return Type.String({
    ...(schemaId === undefined ? {} : { $id: schemaId }),
    pattern: `^${prefix}_${UUID_V4}$`,
  });
}

const resourceId = () =>
  Type.String({
    pattern:
      "^(org|fam|mdl|var|als|slg|chk|mck|edg|par|prv|off|scp|aff|src|obs|evd|clm|cfl|prc|cmp|pcs|occ|run|pvr|out|anm|qrn|pol|prn|pub)_" +
      UUID_V4 +
      "$",
  });
const evidenceId = () => prefixedId("evd");
const publicationId = () => prefixedId("pub");
const timestamp = () =>
  Type.String({ format: "date-time", pattern: UTC_MILLISECOND_TIMESTAMP });
const slug = () =>
  Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 128 });
const hash = () => Type.String({ pattern: SHA256 });
const decimal = () => Type.String({ pattern: DECIMAL, maxLength: 64 });
const nullableString = (maxLength = 512) =>
  Type.Union([Type.String({ maxLength }), Type.Null()]);

function extensibleString(
  knownValues: readonly string[],
  options: { forbiddenValues?: readonly string[]; maxLength?: number } = {},
) {
  return Type.Unsafe<string>({
    type: "string",
    minLength: 1,
    maxLength: options.maxLength ?? 128,
    "x-extensible-enum": knownValues,
    ...(options.forbiddenValues === undefined
      ? {}
      : {
          not: {
            enum: options.forbiddenValues,
          },
        }),
  });
}

export const IdPrefixSchema = Type.Union(
  [
    Type.Literal("org"),
    Type.Literal("fam"),
    Type.Literal("mdl"),
    Type.Literal("var"),
    Type.Literal("als"),
    Type.Literal("slg"),
    Type.Literal("chk"),
    Type.Literal("mck"),
    Type.Literal("edg"),
    Type.Literal("par"),
    Type.Literal("prv"),
    Type.Literal("off"),
    Type.Literal("scp"),
    Type.Literal("aff"),
    Type.Literal("src"),
    Type.Literal("obs"),
    Type.Literal("evd"),
    Type.Literal("clm"),
    Type.Literal("cfl"),
    Type.Literal("prc"),
    Type.Literal("cmp"),
    Type.Literal("pcs"),
    Type.Literal("occ"),
    Type.Literal("run"),
    Type.Literal("pvr"),
    Type.Literal("out"),
    Type.Literal("anm"),
    Type.Literal("qrn"),
    Type.Literal("pol"),
    Type.Literal("prn"),
    Type.Literal("pub"),
  ],
  { $id: "IdPrefix" },
);

export const ResourceIdSchema = Type.String({
  $id: "ResourceId",
  pattern:
    "^(org|fam|mdl|var|als|slg|chk|mck|edg|par|prv|off|scp|aff|src|obs|evd|clm|cfl|prc|cmp|pcs|occ|run|pvr|out|anm|qrn|pol|prn|pub)_" +
    UUID_V4 +
    "$",
});

export const OrganizationIdSchema = prefixedId("org", "OrganizationId");
export const ModelFamilyIdSchema = prefixedId("fam", "ModelFamilyId");
export const ModelIdSchema = prefixedId("mdl", "ModelId");
export const VariantIdSchema = prefixedId("var", "VariantId");
export const CheckpointIdSchema = prefixedId("chk", "CheckpointId");
export const ProviderIdSchema = prefixedId("prv", "ProviderId");
export const OfferingIdSchema = prefixedId("off", "OfferingId");
export const ObservationIdSchema = prefixedId("obs", "ObservationId");
export const EvidenceIdSchema = prefixedId("evd", "EvidenceId");
export const PrecisionIdSchema = prefixedId("prc", "PrecisionId");
export const PriceIdSchema = prefixedId("pcs", "PriceId");
export const PublicationIdSchema = prefixedId("pub", "PublicationId");

export const FactStateSchema = Type.Union(
  [
    Type.Literal("known"),
    Type.Literal("unknown"),
    Type.Literal("not_applicable"),
    Type.Literal("unavailable"),
  ],
  { $id: "FactState" },
);

export function FactSchema<T extends TSchema>(value: T, schemaId: string) {
  if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(schemaId))
    throw new TypeError(
      "Fact schema ID must be a stable alphanumeric identifier.",
    );
  return Type.Union(
    [
      Type.Object(
        {
          state: Type.Literal("known"),
          value,
          observed_at: timestamp(),
          evidence_ids: Type.Array(evidenceId(), {
            minItems: 1,
            uniqueItems: true,
          }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          state: Type.Union([
            Type.Literal("unknown"),
            Type.Literal("not_applicable"),
            Type.Literal("unavailable"),
          ]),
          value: Type.Null(),
          observed_at: Type.Union([timestamp(), Type.Null()]),
          evidence_ids: Type.Array(evidenceId(), { uniqueItems: true }),
        },
        { additionalProperties: false },
      ),
    ],
    { $id: schemaId },
  );
}

const StringFact = (id: string, maxLength = 512) =>
  FactSchema(Type.String({ maxLength }), id);
const DateFact = (id: string) => FactSchema(timestamp(), id);
const StringArrayFact = (id: string) =>
  FactSchema(
    Type.Array(Type.String({ maxLength: 128 }), {
      maxItems: 64,
      uniqueItems: true,
    }),
    id,
  );

const DerivedCountSchema = Type.Object(
  {
    value: Type.Integer({ minimum: 0 }),
    observed_at: timestamp(),
    derivation_version: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);

const ParameterValueSchema = Type.Object(
  {
    raw_value: Type.String({ minLength: 1, maxLength: 128 }),
    normalized_decimal: Type.Union([decimal(), Type.Null()]),
    approximation: extensibleString(["exact", "approximate", "unknown"]),
  },
  { additionalProperties: false },
);

export const CheckpointSchema = Type.Object(
  {
    checkpoint_id: prefixedId("chk"),
    publisher_organization_id: prefixedId("org"),
    checkpoint_kind: StringFact("CheckpointKindFact", 128),
    repository_locator: StringFact("CheckpointRepositoryLocatorFact", 2048),
    repository_id: StringFact("CheckpointRepositoryIdFact", 256),
    revision: StringFact("CheckpointRevisionFact", 256),
    published_at: DateFact("CheckpointPublishedAtFact"),
    declared_weight_format: StringFact(
      "CheckpointDeclaredWeightFormatFact",
      128,
    ),
    quantization: StringFact("CheckpointQuantizationFact", 128),
    file_format: StringFact("CheckpointFileFormatFact", 128),
    role: FactSchema(
      extensibleString([
        "authoritative_source",
        "source_quantized_variant",
        "other_evidenced",
      ]),
      "CheckpointRoleFact",
    ),
    lineage_edges: Type.Array(
      Type.Object(
        {
          from_checkpoint_id: prefixedId("chk"),
          to_checkpoint_id: prefixedId("chk"),
          relationship: extensibleString([
            "derived_from",
            "quantized_from",
            "publisher_variant_of",
            "unknown_lineage",
          ]),
          observed_at: timestamp(),
          evidence_ids: Type.Array(evidenceId(), {
            minItems: 1,
            uniqueItems: true,
          }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 128 },
    ),
  },
  { $id: "Checkpoint", additionalProperties: false },
);

export const DatasetMetadataSchema = Type.Object(
  {
    publication_id: publicationId(),
    schema_version: Type.String({ pattern: SEMVER }),
    api_version: Type.Literal("1"),
    methodology_version: Type.String({ minLength: 1, maxLength: 64 }),
    methodology_effective_at: timestamp(),
    methodology_url: Type.String({ format: "uri", maxLength: 2048 }),
    precision_vocabulary_version: Type.String({ minLength: 1, maxLength: 64 }),
    price_policy_version: Type.String({ minLength: 1, maxLength: 64 }),
    published_at: timestamp(),
    generated_at: timestamp(),
    next_refresh_window: Type.Object(
      { starts_at: timestamp(), ends_at: timestamp() },
      { additionalProperties: false },
    ),
    counts: Type.Object(
      {
        active_models: Type.Integer({ minimum: 0 }),
        active_offerings: Type.Integer({ minimum: 0 }),
        active_providers: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    degradation_notices: Type.Array(Type.String({ maxLength: 200 }), {
      maxItems: 50,
    }),
  },
  { $id: "DatasetMetadata", additionalProperties: false },
);

export const ModelFamilySchema = Type.Object(
  {
    family_id: prefixedId("fam"),
    slug: FactSchema(slug(), "FamilySlugFact"),
    display_name: StringFact("FamilyDisplayNameFact", 200),
    publisher: StringFact("FamilyPublisherFact", 200),
    model_ids: Type.Array(prefixedId("mdl"), { uniqueItems: true }),
    last_model_data_refresh: DateFact("FamilyRefreshFact"),
  },
  { $id: "ModelFamily", additionalProperties: false },
);

export const ModelSchema = Type.Object(
  {
    model_id: prefixedId("mdl"),
    family_id: prefixedId("fam"),
    slug: FactSchema(slug(), "ModelSlugFact"),
    display_name: StringFact("ModelDisplayNameFact", 200),
    publisher: StringFact("ModelPublisherFact", 200),
    release_date: FactSchema(
      Type.String({ format: "date" }),
      "ModelReleaseDateFact",
    ),
    modalities: StringArrayFact("ModelModalitiesFact"),
    context_window_tokens: FactSchema(decimal(), "ModelContextWindowFact"),
    maximum_output_tokens: FactSchema(decimal(), "ModelOutputLimitFact"),
    license: StringFact("ModelLicenseFact", 256),
    architecture: StringFact("ModelArchitectureFact", 256),
    total_parameters: FactSchema(
      ParameterValueSchema,
      "ModelTotalParametersFact",
    ),
    active_parameters: FactSchema(
      ParameterValueSchema,
      "ModelActiveParametersFact",
    ),
    authoritative_checkpoint_ids: Type.Array(prefixedId("chk"), {
      uniqueItems: true,
    }),
    checkpoints: Type.Array(CheckpointSchema, { maxItems: 128 }),
    source_weight_format: StringFact("ModelSourceWeightFormatFact", 128),
    source_quantization: StringFact("ModelSourceQuantizationFact", 128),
    status: StringFact("ModelStatusFact", 64),
    cataloged_provider_count: DerivedCountSchema,
    last_model_data_refresh: DateFact("ModelRefreshFact"),
  },
  { $id: "Model", additionalProperties: false },
);

export const VariantSchema = Type.Object(
  {
    variant_id: prefixedId("var"),
    model_id: prefixedId("mdl"),
    family_id: prefixedId("fam"),
    slug: FactSchema(slug(), "VariantSlugFact"),
    display_name: StringFact("VariantDisplayNameFact", 200),
    variant_kind: StringFact("VariantKindFact", 128),
    selection_evidence: StringFact("VariantSelectionFact", 512),
    publisher: StringFact("VariantPublisherFact", 200),
    release_date: FactSchema(
      Type.String({ format: "date" }),
      "VariantReleaseDateFact",
    ),
    modalities: StringArrayFact("VariantModalitiesFact"),
    context_window_tokens: FactSchema(decimal(), "VariantContextWindowFact"),
    maximum_output_tokens: FactSchema(decimal(), "VariantOutputLimitFact"),
    license: StringFact("VariantLicenseFact", 256),
    architecture: StringFact("VariantArchitectureFact", 256),
    total_parameters: FactSchema(
      ParameterValueSchema,
      "VariantTotalParametersFact",
    ),
    active_parameters: FactSchema(
      ParameterValueSchema,
      "VariantActiveParametersFact",
    ),
    source_weight_format: StringFact("VariantSourceWeightFormatFact", 128),
    source_quantization: StringFact("VariantSourceQuantizationFact", 128),
    checkpoint_ids: Type.Array(prefixedId("chk"), { uniqueItems: true }),
    checkpoints: Type.Array(CheckpointSchema, { maxItems: 128 }),
    status: StringFact("VariantStatusFact", 64),
    cataloged_provider_count: DerivedCountSchema,
    last_model_data_refresh: DateFact("VariantRefreshFact"),
  },
  { $id: "Variant", additionalProperties: false },
);

export const ProviderSchema = Type.Object(
  {
    provider_id: prefixedId("prv"),
    slug: FactSchema(slug(), "ProviderSlugFact"),
    display_name: StringFact("ProviderDisplayNameFact", 200),
    official_site: StringFact("ProviderOfficialSiteFact", 2048),
    status: StringFact("ProviderStatusFact", 64),
    active_offering_count: DerivedCountSchema,
    precision_coverage: Type.Object(
      {
        known_count: Type.Integer({ minimum: 0 }),
        unknown_count: Type.Integer({ minimum: 0 }),
        known_proportion_decimal: decimal(),
        derivation_version: Type.String({ minLength: 1, maxLength: 64 }),
      },
      { additionalProperties: false },
    ),
    last_successful_refresh: DateFact("ProviderRefreshFact"),
    affiliate_relationship_present: Type.Boolean(),
  },
  { $id: "Provider", additionalProperties: false },
);

const OfferingStatusSchema = extensibleString(
  ["active", "inactive", "unavailable"],
  { forbiddenValues: ["unknown"] },
);

export const OfferingApplicabilitySchema = Type.Object(
  {
    provider_id: prefixedId("prv"),
    provider_model_id: Type.String({ minLength: 1, maxLength: 256 }),
    tier_key: Type.String({ minLength: 1, maxLength: 128 }),
    endpoint_class: Type.String({ minLength: 1, maxLength: 128 }),
    material_region_key: Type.String({ maxLength: 128 }),
    component_scope: Type.Union([
      Type.String({ minLength: 1, maxLength: 128 }),
      Type.Null(),
    ]),
  },
  { $id: "OfferingApplicability", additionalProperties: false },
);

export const OfferingSchema = Type.Object(
  {
    offering_id: prefixedId("off"),
    provider_id: prefixedId("prv"),
    model_resource_id: Type.Union([prefixedId("mdl"), prefixedId("var")]),
    provider_model_id: Type.String({ minLength: 1, maxLength: 256 }),
    display_name: StringFact("OfferingDisplayNameFact", 256),
    tier_key: Type.String({ minLength: 1, maxLength: 128 }),
    endpoint_class: Type.String({ minLength: 1, maxLength: 128 }),
    material_region_key: Type.String({ maxLength: 128 }),
    supported_regions: StringArrayFact("OfferingRegionsFact"),
    status: FactSchema(OfferingStatusSchema, "OfferingStatusFact"),
    stale: Type.Boolean(),
    stale_reason: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    first_observed_at: timestamp(),
    last_observed_at: timestamp(),
    last_successful_refresh: DateFact("OfferingLastSuccessfulRefreshFact"),
    source_locator: StringFact("OfferingSourceLocatorFact", 2048),
    precision_observation_ids: Type.Array(prefixedId("prc"), {
      uniqueItems: true,
    }),
    price_ids: Type.Array(prefixedId("pcs"), { uniqueItems: true }),
    evidence_ids: Type.Array(evidenceId(), {
      minItems: 1,
      uniqueItems: true,
    }),
  },
  { $id: "Offering", additionalProperties: false },
);

const PriceRoleSchema = extensibleString(["input", "output", "cached_input"]);
const PriceClassSchema = extensibleString([
  "standard",
  "promotional",
  "batch",
  "subscription",
  "committed",
  "volume",
  "dedicated",
  "region_tiered",
  "context_tiered",
  "other_conditional",
]);

export const PriceSchema = Type.Object(
  {
    price_id: prefixedId("pcs"),
    offering_id: prefixedId("off"),
    role: PriceRoleSchema,
    price_class: PriceClassSchema,
    amount_decimal: decimal(),
    currency: Type.String({ pattern: "^[A-Z]{3}$" }),
    currency_provenance: extensibleString([
      "provider_stated",
      "system_default",
    ]),
    unit: extensibleString(["per_million_tokens"]),
    conditions: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 32 }),
    is_standard_comparable: Type.Boolean(),
    effective_from: Type.Union([timestamp(), Type.Null()]),
    effective_to: Type.Union([timestamp(), Type.Null()]),
    observed_at: timestamp(),
    evidence_ids: Type.Array(evidenceId(), {
      minItems: 1,
      uniqueItems: true,
    }),
  },
  { $id: "Price", additionalProperties: false },
);

export const PrecisionFormatSchema = extensibleString(
  [
    "BF16",
    "FP16",
    "FP8",
    "FP6",
    "FP4",
    "NVFP4",
    "MXFP4",
    "INT8",
    "INT4",
    "mixed",
    "other",
  ],
  { forbiddenValues: ["unknown"] },
);

const PrecisionComponentSchema = Type.Object(
  {
    component: Type.String({ minLength: 1, maxLength: 128 }),
    normalized_format: FactSchema(
      PrecisionFormatSchema,
      "PrecisionComponentFormatFact",
    ),
    raw_precision: StringFact("PrecisionComponentRawFact", 256),
  },
  { additionalProperties: false },
);

export const PrecisionObservationSchema = Type.Object(
  {
    precision_id: prefixedId("prc"),
    offering_id: prefixedId("off"),
    normalized_format: FactSchema(
      PrecisionFormatSchema,
      "PrecisionNormalizedFormatFact",
    ),
    summary_format: StringFact("PrecisionSummaryFormatFact", 128),
    raw_field_name: Type.String({ minLength: 1, maxLength: 256 }),
    raw_precision: StringFact("PrecisionRawValueFact", 256),
    provider_definition: StringFact("PrecisionDefinitionFact", 1000),
    format_variant: StringFact("PrecisionVariantFact", 128),
    components: Type.Array(PrecisionComponentSchema, { maxItems: 64 }),
    applicability: OfferingApplicabilitySchema,
    observed_at: timestamp(),
    evidence_ids: Type.Array(evidenceId(), {
      minItems: 1,
      uniqueItems: true,
    }),
  },
  { $id: "PrecisionObservation", additionalProperties: false },
);

export const EvidenceSummarySchema = Type.Object(
  {
    evidence_id: evidenceId(),
    subject_resource_id: resourceId(),
    field: Type.String({ pattern: "^[a-z][a-z0-9_]{0,127}$" }),
    value: Type.String({ maxLength: 1000 }),
    source_type: Type.String({ minLength: 1, maxLength: 64 }),
    source_owner: Type.String({ minLength: 1, maxLength: 200 }),
    source_url: Type.Union([
      Type.String({ format: "uri", maxLength: 2048 }),
      Type.Null(),
    ]),
    source_locator: Type.String({ minLength: 1, maxLength: 2048 }),
    authenticated_only: Type.Boolean(),
    observed_at: timestamp(),
    extraction_method: Type.String({ minLength: 1, maxLength: 64 }),
    extraction_version: Type.String({ minLength: 1, maxLength: 128 }),
    integrity_hash: hash(),
  },
  { $id: "EvidenceSummary", additionalProperties: false },
);

export const ApiPageSchema = Type.Object(
  {
    next_cursor: Type.Union([
      Type.String({ minLength: 1, maxLength: 4096 }),
      Type.Null(),
    ]),
    limit: Type.Integer({ minimum: 1, maximum: 100 }),
  },
  { $id: "ApiPage", additionalProperties: false },
);

export const API_ROUTE_POLICIES = {
  modelFamilies: {
    filters: ["publisher", "updated_since"],
    sorts: ["name", "model_refresh", "stable_id"],
    defaultSort: ["name", "stable_id"],
  },
  models: {
    filters: [
      "family",
      "publisher",
      "provider",
      "normalized_source_precision",
      "status",
      "stale_offering",
      "updated_since",
    ],
    sorts: ["name", "release_date", "model_refresh", "stable_id"],
    defaultSort: ["name", "stable_id"],
  },
  variants: {
    filters: [
      "family",
      "publisher",
      "provider",
      "normalized_source_precision",
      "status",
      "stale_offering",
      "updated_since",
    ],
    sorts: ["name", "release_date", "model_refresh", "stable_id"],
    defaultSort: ["name", "stable_id"],
  },
  providers: {
    filters: ["status", "updated_since"],
    sorts: ["display_name", "refresh", "stable_id"],
    defaultSort: ["display_name", "stable_id"],
  },
  offerings: {
    filters: [
      "model",
      "variant",
      "family",
      "provider",
      "normalized_precision",
      "currency",
      "status",
      "stale",
      "observed_since",
      "tier",
      "endpoint_class",
      "material_region",
      "price_class",
    ],
    sorts: [
      "provider",
      "precision_display",
      "input_price",
      "output_price",
      "cached_input_price",
      "freshness",
      "status",
      "stable_id",
    ],
    defaultSort: ["provider", "stable_id"],
    currencyScoped: true,
  },
  prices: {
    filters: [
      "offering",
      "model",
      "provider",
      "role",
      "currency",
      "price_class",
      "standard_comparable",
      "promotional",
      "effective_since",
      "observed_since",
    ],
    sorts: ["amount", "observed_at", "stable_id"],
    defaultSort: ["observed_at", "stable_id"],
    currencyScoped: true,
  },
  precisionObservations: {
    filters: [
      "offering",
      "model",
      "provider",
      "normalized_format",
      "component",
      "observed_since",
    ],
    sorts: ["display_label", "observed_at", "stable_id"],
    defaultSort: ["display_label", "stable_id"],
  },
  evidence: {
    filters: [
      "entity",
      "field",
      "source_type",
      "source_owner",
      "observed_since",
    ],
    sorts: ["observed_at", "stable_id"],
    defaultSort: ["observed_at", "stable_id"],
  },
  search: {
    filters: [
      "record_type",
      "model",
      "family",
      "provider",
      "normalized_precision",
      "currency",
      "status",
      "stale",
      "price_role",
      "price_class",
      "price_min",
      "price_max",
    ],
    sorts: ["relevance", "stable_id"],
    defaultSort: ["relevance", "stable_id"],
  },
} as const;

type ApiRoutePolicy =
  (typeof API_ROUTE_POLICIES)[keyof typeof API_ROUTE_POLICIES];

const ApiFilterValueSchema = Type.Union([
  Type.String({ maxLength: 512 }),
  Type.Boolean(),
]);

function ApiMetaFor(
  resource: string,
  policy: ApiRoutePolicy,
  schemaId: string,
) {
  const filterProperties = Object.fromEntries(
    policy.filters.map((name) => [name, Type.Optional(ApiFilterValueSchema)]),
  );
  return Type.Object(
    {
      resource: Type.Literal(resource),
      publication_id: publicationId(),
      schema_version: Type.String({ pattern: SEMVER }),
      sort: Type.Array(
        Type.Union(policy.sorts.map((value) => Type.Literal(value))),
        { minItems: 1, maxItems: 8 },
      ),
      filters: Type.Object(filterProperties, { additionalProperties: false }),
      ...("currencyScoped" in policy
        ? {
            currency_scope: Type.String({ pattern: "^[A-Z]{3}$" }),
          }
        : {}),
    },
    { $id: schemaId, additionalProperties: false },
  );
}

export const ApiMetaSchema = ApiMetaFor(
  "models",
  API_ROUTE_POLICIES.models,
  "ApiMeta",
);

function CollectionSchema<T extends TSchema>(
  item: T,
  id: string,
  resource: string,
  policy: ApiRoutePolicy,
  maximum = 100,
) {
  return Type.Object(
    {
      data: Type.Array(item, { maxItems: maximum }),
      page: Type.Object(
        {
          next_cursor: Type.Union([
            Type.String({ minLength: 1, maxLength: 4096 }),
            Type.Null(),
          ]),
          limit: Type.Integer({ minimum: 1, maximum }),
        },
        { additionalProperties: false },
      ),
      meta: ApiMetaFor(resource, policy, `${id}Meta`),
    },
    { $id: id, additionalProperties: false },
  );
}

function DetailSchema<T extends TSchema>(
  item: T,
  id: string,
  resource: string,
  policy: ApiRoutePolicy,
) {
  return Type.Object(
    { data: item, meta: ApiMetaFor(resource, policy, `${id}Meta`) },
    { $id: id, additionalProperties: false },
  );
}

export const ModelFamilyCollectionSchema = CollectionSchema(
  ModelFamilySchema,
  "ModelFamilyCollection",
  "model_families",
  API_ROUTE_POLICIES.modelFamilies,
);
export const ModelFamilyDetailSchema = DetailSchema(
  ModelFamilySchema,
  "ModelFamilyDetail",
  "model_families",
  API_ROUTE_POLICIES.modelFamilies,
);
export const ModelCollectionSchema = CollectionSchema(
  ModelSchema,
  "ModelCollection",
  "models",
  API_ROUTE_POLICIES.models,
);
export const ModelDetailSchema = DetailSchema(
  ModelSchema,
  "ModelDetail",
  "models",
  API_ROUTE_POLICIES.models,
);
export const VariantCollectionSchema = CollectionSchema(
  VariantSchema,
  "VariantCollection",
  "variants",
  API_ROUTE_POLICIES.variants,
);
export const VariantDetailSchema = DetailSchema(
  VariantSchema,
  "VariantDetail",
  "variants",
  API_ROUTE_POLICIES.variants,
);
export const ProviderCollectionSchema = CollectionSchema(
  ProviderSchema,
  "ProviderCollection",
  "providers",
  API_ROUTE_POLICIES.providers,
);
export const ProviderDetailSchema = DetailSchema(
  ProviderSchema,
  "ProviderDetail",
  "providers",
  API_ROUTE_POLICIES.providers,
);
export const OfferingCollectionSchema = CollectionSchema(
  OfferingSchema,
  "OfferingCollection",
  "offerings",
  API_ROUTE_POLICIES.offerings,
);
export const OfferingDetailSchema = DetailSchema(
  OfferingSchema,
  "OfferingDetail",
  "offerings",
  API_ROUTE_POLICIES.offerings,
);
export const PriceCollectionSchema = CollectionSchema(
  PriceSchema,
  "PriceCollection",
  "prices",
  API_ROUTE_POLICIES.prices,
);
export const PriceDetailSchema = DetailSchema(
  PriceSchema,
  "PriceDetail",
  "prices",
  API_ROUTE_POLICIES.prices,
);
export const PrecisionObservationCollectionSchema = CollectionSchema(
  PrecisionObservationSchema,
  "PrecisionObservationCollection",
  "precision_observations",
  API_ROUTE_POLICIES.precisionObservations,
);
export const PrecisionObservationDetailSchema = DetailSchema(
  PrecisionObservationSchema,
  "PrecisionObservationDetail",
  "precision_observations",
  API_ROUTE_POLICIES.precisionObservations,
);
export const EvidenceSummaryCollectionSchema = CollectionSchema(
  EvidenceSummarySchema,
  "EvidenceSummaryCollection",
  "evidence",
  API_ROUTE_POLICIES.evidence,
);
export const EvidenceSummaryDetailSchema = DetailSchema(
  EvidenceSummarySchema,
  "EvidenceSummaryDetail",
  "evidence",
  API_ROUTE_POLICIES.evidence,
);

const SearchResultProperties = {
  display_name: StringFact("SearchResultDisplayNameFact", 200),
  match_kind: extensibleString([
    "canonical_name",
    "alias",
    "publisher_name",
    "provider_name",
    "provider_model_id",
    "semantic",
  ]),
  semantic_degraded: extensibleString([
    "none",
    "disabled",
    "eligibility_limit",
    "temporarily_unavailable",
  ]),
};

export const SearchResultSchema = Type.Union([
  Type.Object(
    {
      resource_type: Type.Literal("model"),
      resource_id: prefixedId("mdl"),
      ...SearchResultProperties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      resource_type: Type.Literal("variant"),
      resource_id: prefixedId("var"),
      ...SearchResultProperties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      resource_type: Type.Literal("provider"),
      resource_id: prefixedId("prv"),
      ...SearchResultProperties,
    },
    { additionalProperties: false },
  ),
]);
export const SearchCollectionSchema = CollectionSchema(
  SearchResultSchema,
  "SearchCollection",
  "search",
  API_ROUTE_POLICIES.search,
  20,
);

const ScopeBase = {
  subject_resource_id: resourceId(),
  source_object_locator: Type.String({ minLength: 1, maxLength: 2048 }),
  observed_from: timestamp(),
  observed_to: Type.Union([timestamp(), Type.Null()]),
};

export const ClaimScopeSchema = Type.Union(
  [
    ...["entity", "model", "checkpoint", "provider"].map((kind) =>
      Type.Object(
        { scope_kind: Type.Literal(kind), ...ScopeBase },
        { additionalProperties: false },
      ),
    ),
    Type.Object(
      {
        scope_kind: Type.Literal("offering"),
        ...ScopeBase,
        applicability: OfferingApplicabilitySchema,
      },
      { additionalProperties: false },
    ),
  ],
  { $id: "ClaimScope" },
);

const BoundedJsonScalarSchema = Type.Union([
  Type.String({ maxLength: 4096 }),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);
const BoundedJsonValueSchema = Type.Union([
  BoundedJsonScalarSchema,
  Type.Array(BoundedJsonScalarSchema, { maxItems: 128 }),
  Type.Record(
    Type.String({ pattern: "^[A-Za-z0-9_.:-]{1,128}$" }),
    Type.Union([
      BoundedJsonScalarSchema,
      Type.Array(BoundedJsonScalarSchema, { maxItems: 128 }),
    ]),
    { maxProperties: 128 },
  ),
]);
const CandidateQualifiersSchema = Type.Record(
  Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }),
  BoundedJsonValueSchema,
  { maxProperties: 32 },
);

export const CandidateFactSchema = Type.Union(
  [
    Type.Object(
      {
        state: Type.Literal("known"),
        raw_value: BoundedJsonValueSchema,
        normalized_value: BoundedJsonValueSchema,
        observation_id: prefixedId("obs"),
        evidence_span_locator: Type.String({ minLength: 1, maxLength: 2048 }),
        scope: ClaimScopeSchema,
        extraction_method: Type.String({ minLength: 1, maxLength: 64 }),
        extraction_version: Type.String({ minLength: 1, maxLength: 128 }),
        source_policy_version: Type.String({ minLength: 1, maxLength: 128 }),
        qualifiers: CandidateQualifiersSchema,
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        state: Type.Union([
          Type.Literal("unknown"),
          Type.Literal("not_applicable"),
          Type.Literal("unavailable"),
        ]),
        raw_value: Type.Null(),
        normalized_value: Type.Null(),
        observation_id: Type.Union([prefixedId("obs"), Type.Null()]),
        evidence_span_locator: Type.Union([
          Type.String({ minLength: 1, maxLength: 2048 }),
          Type.Null(),
        ]),
        scope: ClaimScopeSchema,
        extraction_method: Type.String({ minLength: 1, maxLength: 64 }),
        extraction_version: Type.String({ minLength: 1, maxLength: 128 }),
        source_policy_version: Type.String({ minLength: 1, maxLength: 128 }),
        qualifiers: CandidateQualifiersSchema,
      },
      { additionalProperties: false },
    ),
  ],
  { $id: "CandidateFact" },
);

const SourceTypeSchema = Type.Union(
  [
    "provider_api",
    "authenticated_catalog",
    "public_static_page",
    "public_rendered_page",
    "publisher_checkpoint_repository",
  ].map((value) => Type.Literal(value)),
);

const DNS_HOST =
  "^(?=.{1,253}$)(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\\.)+(?:[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)$";

const AdapterParameterSchema = Type.Object(
  {
    name: Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }),
    location: Type.Union([Type.Literal("path"), Type.Literal("query")]),
    value_type: Type.Union([
      Type.Literal("string"),
      Type.Literal("integer"),
      Type.Literal("boolean"),
    ]),
    required: Type.Boolean(),
    enum_values: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      maxItems: 128,
      uniqueItems: true,
    }),
    pattern: Type.Union([
      Type.String({ minLength: 1, maxLength: 256 }),
      Type.Null(),
    ]),
    maximum_length: Type.Union([
      Type.Integer({ minimum: 1, maximum: 4096 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

const AdapterSourceSchema = Type.Object(
  {
    source_id: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,63}$" }),
    scheme: Type.Literal("https"),
    host: Type.String({ pattern: DNS_HOST, maxLength: 253 }),
    path_template: Type.String({ pattern: "^/(?!/)", maxLength: 1024 }),
    safe_locator_template: Type.String({
      pattern: "^/(?!/)",
      maxLength: 1024,
    }),
    parameters: Type.Array(AdapterParameterSchema, {
      maxItems: 64,
    }),
    method: Type.Literal("GET"),
    authentication_class: Type.Union([
      Type.Literal("none"),
      Type.Literal("api_key"),
      Type.Literal("bearer"),
    ]),
    credential_handle: Type.Union([
      Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,127}$" }),
      Type.Null(),
    ]),
    credential_injection: Type.Union([
      Type.Literal("authorization_bearer"),
      Type.Literal("header"),
      Type.Null(),
    ]),
    credential_header: Type.Union([
      Type.String({ minLength: 1, maxLength: 64 }),
      Type.Null(),
    ]),
    allowed_headers: Type.Array(Type.String({ maxLength: 64 }), {
      maxItems: 16,
      uniqueItems: true,
    }),
    source_type: SourceTypeSchema,
    pagination: Type.String({ minLength: 1, maxLength: 128 }),
    content_types: Type.Array(Type.String({ maxLength: 128 }), {
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
    }),
    compressed_byte_limit: Type.Integer({ minimum: 1 }),
    uncompressed_byte_limit: Type.Integer({ minimum: 1 }),
    timeout_ms: Type.Integer({ minimum: 1 }),
    redirect_limit: Type.Integer({ minimum: 0, maximum: 3 }),
    redirect_hosts: Type.Array(
      Type.String({ pattern: DNS_HOST, maxLength: 253 }),
      {
        maxItems: 8,
        uniqueItems: true,
      },
    ),
    provider_rate_limit: Type.String({ minLength: 1, maxLength: 128 }),
    crawl_purpose: Type.String({ minLength: 1, maxLength: 128 }),
    robots_policy: Type.String({ minLength: 1, maxLength: 128 }),
    content_signals_policy: Type.String({ minLength: 1, maxLength: 128 }),
    retention_permitted: Type.Boolean(),
    publication_permitted: Type.Boolean(),
    expected_precision_fields: Type.Array(Type.String({ maxLength: 256 }), {
      maxItems: 64,
    }),
    expected_price_fields: Type.Array(Type.String({ maxLength: 256 }), {
      maxItems: 64,
    }),
    browser_session_approved: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const AdapterManifestSchema = Type.Object(
  {
    contract_version: Type.String({ pattern: SEMVER }),
    provider_id: prefixedId("prv"),
    adapter_version: Type.String({
      pattern: `^[0-9]+\\.[0-9]+\\.[0-9]+\\+sha256\\.[0-9a-f]{64}$`,
    }),
    enabled_environments: Type.Array(
      Type.Union([
        Type.Literal("local"),
        Type.Literal("test"),
        Type.Literal("preview"),
        Type.Literal("production"),
      ]),
      { uniqueItems: true },
    ),
    source_policy_version: Type.String({ minLength: 1, maxLength: 128 }),
    sources: Type.Array(AdapterSourceSchema, { minItems: 1, maxItems: 32 }),
    credential_handles: Type.Array(
      Type.Object(
        {
          binding_name: Type.String({ pattern: "^[A-Z][A-Z0-9_]{0,127}$" }),
          purpose: Type.String({ minLength: 1, maxLength: 256 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 16 },
    ),
    roster_path: Type.String({ pattern: "^fixtures/", maxLength: 512 }),
    roster_version: Type.String({ minLength: 1, maxLength: 128 }),
    roster_hash: hash(),
    parser_version: Type.String({ minLength: 1, maxLength: 128 }),
    extraction_policy_version: Type.Union([
      Type.String({ minLength: 1, maxLength: 128 }),
      Type.Null(),
    ]),
    budgets: Type.Object(
      {
        requests_per_run: Type.Integer({ minimum: 1, maximum: 10_000 }),
        pages_per_source: Type.Integer({ minimum: 1, maximum: 10_000 }),
        bytes_per_run: Type.Integer({ minimum: 1, maximum: 1_000_000_000 }),
        duration_ms: Type.Integer({ minimum: 1, maximum: 43_200_000 }),
        retry_attempts: Type.Integer({ minimum: 0, maximum: 10 }),
        browser_sessions: Type.Integer({ minimum: 0, maximum: 1_000 }),
        ai_tokens: Type.Integer({ minimum: 0, maximum: 10_000_000 }),
        items_per_run: Type.Integer({ minimum: 1, maximum: 100_000 }),
      },
      { additionalProperties: false },
    ),
    compliance_review: Type.Object(
      {
        register_path: Type.String({
          pattern: "^docs/compliance/sources/[a-z0-9-]+\\.md$",
          maxLength: 256,
        }),
        register_hash: hash(),
        reviewer_role: Type.String({ minLength: 1, maxLength: 128 }),
        reviewed_at: timestamp(),
        terms_version: Type.String({ minLength: 1, maxLength: 128 }),
        robots_version: Type.String({ minLength: 1, maxLength: 128 }),
        content_signals_version: Type.String({ minLength: 1, maxLength: 128 }),
        access_permitted: Type.Boolean(),
        retention_permitted: Type.Boolean(),
        publication_permitted: Type.Boolean(),
        next_review_at: timestamp(),
      },
      { additionalProperties: false },
    ),
  },
  { $id: "AdapterManifest", additionalProperties: false },
);

export const AdapterRosterSchema = Type.Object(
  {
    fixture_kind: Type.Union([
      Type.Literal("redacted_source"),
      Type.Literal("synthetic_non_publishable"),
    ]),
    provider_id: prefixedId("prv"),
    roster_version: Type.String({ minLength: 1, maxLength: 128 }),
    items: Type.Array(
      Type.Object(
        {
          roster_item_id: Type.String({ minLength: 1, maxLength: 256 }),
          provider_model_id: Type.String({ minLength: 1, maxLength: 512 }),
          tier_key: Type.String({ maxLength: 128 }),
          endpoint_class: Type.String({ minLength: 1, maxLength: 128 }),
          material_region_key: Type.String({ maxLength: 128 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 100_000 },
    ),
  },
  { $id: "AdapterRoster", additionalProperties: false },
);

export const FixtureMetadataSchema = Type.Object(
  {
    fixture_kind: Type.Union([
      Type.Literal("redacted_source"),
      Type.Literal("synthetic_non_publishable"),
    ]),
    provider_id: prefixedId("prv"),
    source_types: Type.Array(SourceTypeSchema, {
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
    }),
    lawful_capture_method: Type.String({ minLength: 1, maxLength: 1000 }),
    observed_at: timestamp(),
    redaction_notes: Type.String({ minLength: 1, maxLength: 2000 }),
    retention_permission: Type.Union([
      Type.Literal("synthetic_only"),
      Type.Literal("approved_minimized_excerpt"),
      Type.Literal("pending"),
    ]),
    publication_permission: Type.Boolean(),
    parser_version: Type.String({ minLength: 1, maxLength: 128 }),
    source_policy_version: Type.String({ minLength: 1, maxLength: 128 }),
    content_hash: hash(),
    contains_authenticated_content: Type.Boolean(),
    approval_reference: Type.Union([
      Type.String({ minLength: 1, maxLength: 512 }),
      Type.Null(),
    ]),
  },
  { $id: "FixtureMetadata", additionalProperties: false },
);

const CandidateEntitySchema = Type.Object(
  {
    candidate_id: Type.String({ minLength: 1, maxLength: 256 }),
    facts: Type.Record(
      Type.String({ pattern: "^[a-z][a-z0-9_]{0,127}$" }),
      CandidateFactSchema,
      { maxProperties: 128 },
    ),
  },
  { additionalProperties: false },
);

export const AdapterBatchSchema = Type.Object(
  {
    contract_version: Type.String({ pattern: SEMVER }),
    provider_id: prefixedId("prv"),
    adapter_version: Type.String({ minLength: 1, maxLength: 128 }),
    roster_version: Type.String({ minLength: 1, maxLength: 128 }),
    observations: Type.Array(
      Type.Object(
        {
          observation_id: prefixedId("obs"),
          source_id: Type.String({ pattern: "^[a-z][a-z0-9_-]{0,63}$" }),
          source_type: SourceTypeSchema,
          safe_locator: Type.String({ minLength: 1, maxLength: 2048 }),
          retrieved_at: timestamp(),
          extraction_method: Type.String({ minLength: 1, maxLength: 64 }),
          extraction_version: Type.String({ minLength: 1, maxLength: 128 }),
          source_policy_version: Type.String({ minLength: 1, maxLength: 128 }),
          redacted_hash: hash(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 10_000 },
    ),
    model_candidates: Type.Array(CandidateEntitySchema, { maxItems: 100_000 }),
    variant_candidates: Type.Array(CandidateEntitySchema, {
      maxItems: 100_000,
    }),
    checkpoint_candidates: Type.Array(CandidateEntitySchema, {
      maxItems: 100_000,
    }),
    lineage_edge_candidates: Type.Array(CandidateEntitySchema, {
      maxItems: 100_000,
    }),
    offering_candidates: Type.Array(CandidateEntitySchema, {
      maxItems: 100_000,
    }),
    precision_candidates: Type.Array(CandidateEntitySchema, {
      maxItems: 100_000,
    }),
    precision_component_candidates: Type.Array(CandidateEntitySchema, {
      maxItems: 100_000,
    }),
    price_candidates: Type.Array(CandidateEntitySchema, { maxItems: 100_000 }),
    roster_outcomes: Type.Array(
      Type.Object(
        {
          roster_item_id: Type.String({ minLength: 1, maxLength: 256 }),
          outcome: Type.Union(
            [
              "published_candidate",
              "published_candidate_with_unknowns",
              "unavailable",
              "failed",
              "quarantined",
            ].map((value) => Type.Literal(value)),
          ),
          reason_code: Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }),
          observation_ids: Type.Array(prefixedId("obs"), { uniqueItems: true }),
          evidence_span_locators: Type.Array(
            Type.String({ minLength: 1, maxLength: 2048 }),
          ),
          attempt_count: Type.Integer({ minimum: 1 }),
          last_response_class: Type.String({ minLength: 1, maxLength: 64 }),
          candidate_offering_id: Type.Union([
            Type.String({ minLength: 1, maxLength: 256 }),
            Type.Null(),
          ]),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 100_000 },
    ),
    diagnostics: Type.Array(
      Type.Object(
        {
          severity: Type.Union([
            Type.Literal("info"),
            Type.Literal("warning"),
            Type.Literal("error"),
          ]),
          code: Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }),
          message: Type.String({ maxLength: 500 }),
          roster_item_id: nullableString(256),
        },
        { additionalProperties: false },
      ),
      { maxItems: 1000 },
    ),
  },
  { $id: "AdapterBatch", additionalProperties: false },
);

const PublicationCommonFields = {
  publication_id: publicationId(),
  schema_version: Type.String({ pattern: SEMVER }),
  generated_at: timestamp(),
  source_run_id: prefixedId("run"),
  parent_publication_id: Type.Union([publicationId(), Type.Null()]),
  provider_slices: Type.Array(
    Type.Object(
      {
        provider_id: prefixedId("prv"),
        provider_run_id: prefixedId("pvr"),
        carried_forward: Type.Boolean(),
        freshness_state: Type.Union([
          Type.Literal("fresh"),
          Type.Literal("stale"),
          Type.Literal("unavailable"),
        ]),
      },
      { additionalProperties: false },
    ),
    { maxItems: 1_000 },
  ),
  resources: Type.Array(
    Type.Object(
      {
        resource_type: Type.Union(
          [
            "model_family",
            "model",
            "variant",
            "provider",
            "offering",
            "price",
            "precision_observation",
            "evidence_summary",
          ].map((value) => Type.Literal(value)),
        ),
        resource_id: resourceId(),
        content_hash: hash(),
      },
      { additionalProperties: false },
    ),
    { maxItems: 1_000_000 },
  ),
  closure_hash: hash(),
  failure_codes: Type.Array(
    Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }),
    { maxItems: 1_000, uniqueItems: true },
  ),
};

function PublicationSearchIndexSchema(queryable: boolean) {
  return Type.Object(
    {
      exact_document_count: Type.Integer({ minimum: 0 }),
      vector_document_count: Type.Integer({ minimum: 0 }),
      exact_index_hash: hash(),
      vector_index_version: Type.String({ minLength: 1, maxLength: 128 }),
      queryable: Type.Literal(queryable),
    },
    { additionalProperties: false },
  );
}

export const PublicationManifestSchema = Type.Union(
  [
    ...["building", "failed"].map((state) =>
      Type.Object(
        {
          ...PublicationCommonFields,
          state: Type.Literal(state),
          ready_at: Type.Null(),
          activated_at: Type.Null(),
          search_index: PublicationSearchIndexSchema(false),
        },
        { additionalProperties: false },
      ),
    ),
    Type.Object(
      {
        ...PublicationCommonFields,
        state: Type.Literal("ready"),
        ready_at: timestamp(),
        activated_at: Type.Null(),
        search_index: PublicationSearchIndexSchema(true),
      },
      { additionalProperties: false },
    ),
    ...["active", "superseded", "rolled_back"].map((state) =>
      Type.Object(
        {
          ...PublicationCommonFields,
          state: Type.Literal(state),
          ready_at: timestamp(),
          activated_at: timestamp(),
          search_index: PublicationSearchIndexSchema(true),
        },
        { additionalProperties: false },
      ),
    ),
  ],
  { $id: "PublicationManifest" },
);

export const PublicationHeadSchema = Type.Object(
  {
    active_publication_id: publicationId(),
    rollback_candidate_publication_id: Type.Union([
      publicationId(),
      Type.Null(),
    ]),
    switched_at: timestamp(),
    generation: Type.Integer({ minimum: 1 }),
  },
  { $id: "PublicationHead", additionalProperties: false },
);

export const ErrorDetailSchema = Type.Object(
  {
    parameter: Type.String({ maxLength: 64 }),
    reason: Type.String({ maxLength: 200 }),
  },
  { additionalProperties: false },
);

export const ErrorEnvelopeSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }),
        message: Type.String({ maxLength: 200 }),
        details: Type.Optional(Type.Array(ErrorDetailSchema, { maxItems: 10 })),
      },
      { additionalProperties: false },
    ),
  },
  { $id: "ErrorEnvelope", additionalProperties: false },
);

export type AdapterBatch = Static<typeof AdapterBatchSchema>;
export type AdapterManifest = Static<typeof AdapterManifestSchema>;
export type AdapterRoster = Static<typeof AdapterRosterSchema>;
export type DatasetMetadata = Static<typeof DatasetMetadataSchema>;
export type ErrorEnvelope = Static<typeof ErrorEnvelopeSchema>;
export type FactState = Static<typeof FactStateSchema>;
export type FixtureMetadata = Static<typeof FixtureMetadataSchema>;
export type IdPrefix = Static<typeof IdPrefixSchema>;
export type PublicationManifest = Static<typeof PublicationManifestSchema>;
export type PublicationHead = Static<typeof PublicationHeadSchema>;
export type ResourceId = Static<typeof ResourceIdSchema>;

export interface AdapterManifestValidationOptions {
  asOf?: string;
}

export function validateAdapterManifestSemantics(
  manifest: AdapterManifest,
  options: AdapterManifestValidationOptions = {},
): string[] {
  const errors: string[] = [];
  const sourceIds = new Set<string>();
  const credentialHandles = new Set(
    manifest.credential_handles.map((credential) => credential.binding_name),
  );
  if (credentialHandles.size !== manifest.credential_handles.length)
    errors.push("duplicate credential handle declaration");
  const productionEnabled =
    manifest.enabled_environments.includes("production");
  const browserSources = manifest.sources.filter(
    (source) => source.source_type === "public_rendered_page",
  );

  for (const source of manifest.sources) {
    if (sourceIds.has(source.source_id))
      errors.push(`duplicate source_id: ${source.source_id}`);
    sourceIds.add(source.source_id);

    if (source.compressed_byte_limit > source.uncompressed_byte_limit)
      errors.push(
        `${source.source_id}: compressed limit exceeds uncompressed limit`,
      );
    if (source.uncompressed_byte_limit > manifest.budgets.bytes_per_run)
      errors.push(`${source.source_id}: source byte limit exceeds run budget`);

    const placeholders = [
      ...source.path_template.matchAll(/\{([a-z][a-z0-9_]*)\}/gu),
    ].map((match) => match[1] ?? "");
    const pathWithoutPlaceholders = source.path_template.replaceAll(
      /\{[a-z][a-z0-9_]*\}/gu,
      "",
    );
    if (
      source.path_template.startsWith("//") ||
      /[\\?#@]/u.test(source.path_template) ||
      /%(?:2e|2f|5c)/iu.test(source.path_template) ||
      /(?:^|\/)\.{1,2}(?:\/|$)/u.test(source.path_template)
    )
      errors.push(`${source.source_id}: unsafe path template`);
    if (
      /[{}\\?#@]/u.test(source.safe_locator_template) ||
      /%(?:2e|2f|5c)/iu.test(source.safe_locator_template) ||
      /(?:^|\/)\.{1,2}(?:\/|$)/u.test(source.safe_locator_template)
    )
      errors.push(`${source.source_id}: unsafe safe-locator template`);
    const declaredPathParameters = source.parameters
      .filter((parameter) => parameter.location === "path")
      .map((parameter) => parameter.name);
    const duplicateParameters = source.parameters.filter(
      (parameter, index) =>
        source.parameters.findIndex(
          (other) => other.name === parameter.name,
        ) !== index,
    );
    if (duplicateParameters.length > 0)
      errors.push(`${source.source_id}: duplicate parameter declaration`);
    if (
      new Set(placeholders).size !== placeholders.length ||
      placeholders.some((name) => !declaredPathParameters.includes(name)) ||
      declaredPathParameters.some(
        (name) =>
          !placeholders.includes(name) ||
          source.parameters.find((parameter) => parameter.name === name)
            ?.required !== true,
      ) ||
      /[{}]/u.test(pathWithoutPlaceholders)
    )
      errors.push(`${source.source_id}: path template parameters do not match`);

    for (const parameter of source.parameters) {
      if (parameter.pattern === null) continue;
      try {
        new RegExp(parameter.pattern, "u");
      } catch {
        errors.push(
          `${source.source_id}: parameter ${parameter.name} has an invalid pattern`,
        );
      }
    }

    if (
      source.source_type === "public_rendered_page" &&
      !source.browser_session_approved
    )
      errors.push(
        `${source.source_id}: rendered source lacks browser approval`,
      );
    if (
      source.source_type !== "public_rendered_page" &&
      source.browser_session_approved
    )
      errors.push(`${source.source_id}: browser approval exceeds source type`);
    if (
      productionEnabled &&
      (!source.retention_permitted || !source.publication_permitted)
    )
      errors.push(`${source.source_id}: source is not production-cleared`);

    if (source.authentication_class === "none") {
      if (
        source.credential_handle !== null ||
        source.credential_injection !== null ||
        source.credential_header !== null
      )
        errors.push(
          `${source.source_id}: unauthenticated source declares credential injection`,
        );
    } else {
      if (
        source.credential_handle === null ||
        !credentialHandles.has(source.credential_handle)
      )
        errors.push(
          `${source.source_id}: authenticated source lacks an exact credential handle`,
        );
      if (
        source.authentication_class === "bearer" &&
        (source.credential_injection !== "authorization_bearer" ||
          source.credential_header !== "Authorization" ||
          !source.allowed_headers.includes("Authorization"))
      )
        errors.push(
          `${source.source_id}: bearer source must use the Authorization header`,
        );
      if (
        source.authentication_class === "api_key" &&
        (source.credential_injection !== "header" ||
          source.credential_header === null ||
          !source.allowed_headers.includes(source.credential_header))
      )
        errors.push(
          `${source.source_id}: API key source lacks an allowlisted injection header`,
        );
    }
  }

  if (browserSources.length > 0 && manifest.budgets.browser_sessions === 0)
    errors.push("rendered sources require a non-zero browser session budget");
  if (browserSources.length === 0 && manifest.budgets.browser_sessions !== 0)
    errors.push(
      "browser session budget exists without an approved rendered source",
    );
  if (
    manifest.extraction_policy_version === null &&
    manifest.budgets.ai_tokens !== 0
  )
    errors.push("AI token budget exists without an extraction policy");

  if (productionEnabled) {
    const review = manifest.compliance_review;
    if (
      !review.access_permitted ||
      !review.retention_permitted ||
      !review.publication_permitted
    )
      errors.push(
        "production requires affirmative compliance review decisions",
      );
    const asOfTime =
      options.asOf === undefined ? Number.NaN : Date.parse(options.asOf);
    if (!Number.isFinite(asOfTime))
      errors.push(
        "production compliance validation requires a valid asOf time",
      );
    else if (Date.parse(review.next_review_at) <= asOfTime)
      errors.push("production compliance review is expired");
  }

  return errors;
}

export interface AdapterBatchValidationContext {
  manifest: AdapterManifest;
  rosterItemIds: readonly string[];
}

export function validateAdapterBatchSemantics(
  batch: AdapterBatch,
  context: AdapterBatchValidationContext,
): string[] {
  const errors: string[] = [];
  const { manifest } = context;
  if (batch.contract_version !== manifest.contract_version)
    errors.push("batch contract_version does not match manifest");
  if (batch.provider_id !== manifest.provider_id)
    errors.push("batch provider_id does not match manifest");
  if (batch.adapter_version !== manifest.adapter_version)
    errors.push("batch adapter_version does not match manifest");
  if (batch.roster_version !== manifest.roster_version)
    errors.push("batch roster_version does not match manifest");

  const sourceById = new Map(
    manifest.sources.map((source) => [source.source_id, source]),
  );
  const observationIds = new Set<string>();
  for (const observation of batch.observations) {
    if (observationIds.has(observation.observation_id))
      errors.push(`duplicate observation_id: ${observation.observation_id}`);
    observationIds.add(observation.observation_id);
    const source = sourceById.get(observation.source_id);
    if (source === undefined)
      errors.push(`unknown observation source_id: ${observation.source_id}`);
    else {
      if (source.source_type !== observation.source_type)
        errors.push(`${observation.observation_id}: source_type mismatch`);
      const locatorMatch =
        /^https:\/\/([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(\/[^?#]*)$/u.exec(
          observation.safe_locator,
        );
      if (locatorMatch === null) {
        errors.push(`${observation.observation_id}: invalid source locator`);
      } else {
        const allowedHosts = new Set([source.host, ...source.redirect_hosts]);
        if (!allowedHosts.has(locatorMatch[1] ?? ""))
          errors.push(`${observation.observation_id}: unsafe source locator`);
        if ((locatorMatch[2] ?? "") !== source.safe_locator_template)
          errors.push(
            `${observation.observation_id}: source locator does not match its redacted template`,
          );
      }
      if (/[?#]/u.test(observation.safe_locator))
        errors.push(
          `${observation.observation_id}: source locator must not retain query or fragment data`,
        );
    }
    if (observation.source_policy_version !== manifest.source_policy_version)
      errors.push(`${observation.observation_id}: source policy mismatch`);
  }

  if (batch.observations.length > manifest.budgets.requests_per_run)
    errors.push("observation count exceeds request budget");

  const candidateGroups = [
    batch.model_candidates,
    batch.variant_candidates,
    batch.checkpoint_candidates,
    batch.lineage_edge_candidates,
    batch.offering_candidates,
    batch.precision_candidates,
    batch.precision_component_candidates,
    batch.price_candidates,
  ] as const;
  const candidateCount = candidateGroups.reduce(
    (total, candidates) => total + candidates.length,
    0,
  );
  if (candidateCount > manifest.budgets.items_per_run)
    errors.push("candidate count exceeds item budget");

  const offeringScopeKeys = new Map<string, string>();
  type OfferingScope = Extract<
    Static<typeof ClaimScopeSchema>,
    { applicability: unknown }
  >;
  const isOfferingScope = (
    scope: Static<typeof ClaimScopeSchema>,
  ): scope is OfferingScope => "applicability" in scope;
  const offeringScopeKey = (scope: OfferingScope): string =>
    JSON.stringify([
      scope.applicability.provider_id,
      scope.applicability.provider_model_id,
      scope.applicability.tier_key,
      scope.applicability.endpoint_class,
      scope.applicability.material_region_key,
    ]);

  for (const [groupIndex, candidates] of candidateGroups.entries()) {
    const candidateIds = new Set<string>();
    for (const candidate of candidates) {
      if (candidateIds.has(candidate.candidate_id))
        errors.push(
          `duplicate candidate_id in group: ${candidate.candidate_id}`,
        );
      candidateIds.add(candidate.candidate_id);
      for (const fact of Object.values(candidate.facts)) {
        if (
          fact.observation_id !== null &&
          !observationIds.has(fact.observation_id)
        )
          errors.push(`${candidate.candidate_id}: unknown fact observation`);
        if (fact.source_policy_version !== manifest.source_policy_version)
          errors.push(`${candidate.candidate_id}: source policy mismatch`);
        if (
          (groupIndex === 5 || groupIndex === 6 || groupIndex === 7) &&
          !isOfferingScope(fact.scope)
        )
          errors.push(
            `${candidate.candidate_id}: price/precision fact lacks exact offering scope`,
          );
        if (groupIndex === 4) {
          if (
            !isOfferingScope(fact.scope) ||
            fact.scope.subject_resource_id !== candidate.candidate_id
          ) {
            errors.push(
              `${candidate.candidate_id}: offering fact lacks its exact offering scope`,
            );
          } else {
            const key = offeringScopeKey(fact.scope);
            const existing = offeringScopeKeys.get(candidate.candidate_id);
            if (existing !== undefined && existing !== key)
              errors.push(
                `${candidate.candidate_id}: offering facts disagree on applicability`,
              );
            offeringScopeKeys.set(candidate.candidate_id, key);
          }
        }
        if (
          (groupIndex === 5 || groupIndex === 6 || groupIndex === 7) &&
          isOfferingScope(fact.scope)
        ) {
          const expected = offeringScopeKeys.get(
            fact.scope.subject_resource_id,
          );
          if (
            expected === undefined ||
            expected !== offeringScopeKey(fact.scope) ||
            fact.scope.applicability.provider_id !== batch.provider_id
          )
            errors.push(
              `${candidate.candidate_id}: price/precision scope does not match a candidate offering`,
            );
        }
      }
    }
  }

  const expectedRoster = new Set(context.rosterItemIds);
  if (expectedRoster.size !== context.rosterItemIds.length)
    errors.push("expected roster contains duplicate item IDs");
  const actualRoster = new Set<string>();
  for (const outcome of batch.roster_outcomes) {
    if (actualRoster.has(outcome.roster_item_id))
      errors.push(`duplicate roster outcome: ${outcome.roster_item_id}`);
    actualRoster.add(outcome.roster_item_id);
    if (!expectedRoster.has(outcome.roster_item_id))
      errors.push(
        `outcome references unknown roster item: ${outcome.roster_item_id}`,
      );
    if (outcome.attempt_count > manifest.budgets.retry_attempts + 1)
      errors.push(
        `${outcome.roster_item_id}: attempt count exceeds retry budget`,
      );
    if (
      outcome.observation_ids.some(
        (observationId) => !observationIds.has(observationId),
      )
    )
      errors.push(
        `${outcome.roster_item_id}: outcome references unknown observation`,
      );
    if (
      (outcome.outcome === "published_candidate" ||
        outcome.outcome === "published_candidate_with_unknowns") &&
      outcome.candidate_offering_id === null
    )
      errors.push(
        `${outcome.roster_item_id}: published outcome lacks candidate`,
      );
    if (
      outcome.candidate_offering_id !== null &&
      !offeringScopeKeys.has(outcome.candidate_offering_id)
    )
      errors.push(
        `${outcome.roster_item_id}: outcome candidate does not exist in offering candidates`,
      );
  }
  for (const rosterItemId of expectedRoster)
    if (!actualRoster.has(rosterItemId))
      errors.push(`missing roster outcome: ${rosterItemId}`);
  return errors;
}

const PUBLICATION_RESOURCE_PREFIX = {
  model_family: "fam_",
  model: "mdl_",
  variant: "var_",
  provider: "prv_",
  offering: "off_",
  price: "pcs_",
  precision_observation: "prc_",
  evidence_summary: "evd_",
} as const;

export function validatePublicationManifestSemantics(
  manifest: PublicationManifest,
): string[] {
  const errors: string[] = [];
  const providers = new Set<string>();
  for (const slice of manifest.provider_slices) {
    if (providers.has(slice.provider_id))
      errors.push(`duplicate provider slice: ${slice.provider_id}`);
    providers.add(slice.provider_id);
  }
  const resources = new Set<string>();
  for (const resource of manifest.resources) {
    const identity = `${resource.resource_type}:${resource.resource_id}`;
    if (resources.has(identity))
      errors.push(`duplicate publication resource: ${identity}`);
    resources.add(identity);
    const prefix =
      PUBLICATION_RESOURCE_PREFIX[
        resource.resource_type as keyof typeof PUBLICATION_RESOURCE_PREFIX
      ];
    if (!resource.resource_id.startsWith(prefix))
      errors.push(`${identity}: resource type and ID prefix disagree`);
  }
  if (manifest.parent_publication_id === manifest.publication_id)
    errors.push("publication cannot be its own parent");
  if (manifest.ready_at !== null) {
    if (Date.parse(manifest.ready_at) < Date.parse(manifest.generated_at))
      errors.push("ready_at precedes generated_at");
  }
  if (manifest.activated_at !== null) {
    if (Date.parse(manifest.activated_at) < Date.parse(manifest.ready_at))
      errors.push("activated_at precedes readiness");
  }
  const searchableResources = manifest.resources.filter(
    (resource) =>
      resource.resource_type === "model" ||
      resource.resource_type === "variant",
  ).length;
  if (manifest.search_index.queryable) {
    if (
      manifest.search_index.exact_document_count !== searchableResources ||
      manifest.search_index.vector_document_count !== searchableResources
    )
      errors.push("search index counts do not match model/variant closure");
  } else if (
    manifest.search_index.exact_document_count !== 0 ||
    manifest.search_index.vector_document_count !== 0
  )
    errors.push("non-queryable search index must have zero documents");
  if (
    ["ready", "active", "superseded", "rolled_back"].includes(manifest.state)
  ) {
    if (manifest.provider_slices.length === 0)
      errors.push("ready publication has no provider slices");
    if (manifest.failure_codes.length !== 0)
      errors.push("ready publication retains failure codes");
  }
  if (manifest.state === "failed" && manifest.failure_codes.length === 0)
    errors.push("failed publication requires a failure code");
  return errors;
}

export function validatePublicationActivation(
  manifest: PublicationManifest,
  head: PublicationHead,
): string[] {
  const errors = validatePublicationManifestSemantics(manifest);
  if (manifest.state !== "active") errors.push("publication is not active");
  if (head.active_publication_id !== manifest.publication_id)
    errors.push("publication head does not select manifest");
  if (head.rollback_candidate_publication_id === head.active_publication_id)
    errors.push("rollback candidate equals active publication");
  if (
    manifest.activated_at !== null &&
    Date.parse(head.switched_at) < Date.parse(manifest.activated_at)
  )
    errors.push("publication head switch predates activation");
  return errors;
}

export const GENERATED_SCHEMAS = {
  AdapterBatch: AdapterBatchSchema,
  AdapterManifest: AdapterManifestSchema,
  AdapterRoster: AdapterRosterSchema,
  ApiMeta: ApiMetaSchema,
  ApiPage: ApiPageSchema,
  CandidateFact: CandidateFactSchema,
  Checkpoint: CheckpointSchema,
  ClaimScope: ClaimScopeSchema,
  DatasetMetadata: DatasetMetadataSchema,
  EvidenceId: EvidenceIdSchema,
  EvidenceSummary: EvidenceSummarySchema,
  EvidenceSummaryCollection: EvidenceSummaryCollectionSchema,
  EvidenceSummaryDetail: EvidenceSummaryDetailSchema,
  ErrorEnvelope: ErrorEnvelopeSchema,
  FactState: FactStateSchema,
  FixtureMetadata: FixtureMetadataSchema,
  IdPrefix: IdPrefixSchema,
  Model: ModelSchema,
  ModelCollection: ModelCollectionSchema,
  ModelDetail: ModelDetailSchema,
  ModelFamily: ModelFamilySchema,
  ModelFamilyCollection: ModelFamilyCollectionSchema,
  ModelFamilyDetail: ModelFamilyDetailSchema,
  Offering: OfferingSchema,
  OfferingApplicability: OfferingApplicabilitySchema,
  OfferingCollection: OfferingCollectionSchema,
  OfferingDetail: OfferingDetailSchema,
  Price: PriceSchema,
  PriceCollection: PriceCollectionSchema,
  PriceDetail: PriceDetailSchema,
  PrecisionFormat: PrecisionFormatSchema,
  PrecisionObservation: PrecisionObservationSchema,
  PrecisionObservationCollection: PrecisionObservationCollectionSchema,
  PrecisionObservationDetail: PrecisionObservationDetailSchema,
  Provider: ProviderSchema,
  ProviderCollection: ProviderCollectionSchema,
  ProviderDetail: ProviderDetailSchema,
  PublicationHead: PublicationHeadSchema,
  PublicationId: PublicationIdSchema,
  PublicationManifest: PublicationManifestSchema,
  ResourceId: ResourceIdSchema,
  SearchCollection: SearchCollectionSchema,
  Variant: VariantSchema,
  VariantCollection: VariantCollectionSchema,
  VariantDetail: VariantDetailSchema,
} as const;
