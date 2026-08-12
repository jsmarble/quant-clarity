import { Type, type Static } from "@sinclair/typebox";

const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const SHA256 = "^sha256:[0-9a-f]{64}$";
const UTC_MILLISECOND_TIMESTAMP =
  "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\\.[0-9]{3}Z$";
const DNS_HOST =
  "^(?=.{1,253}$)(?:(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\\.)+(?:[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?)$";

const hash = () => Type.String({ pattern: SHA256 });
const timestamp = () =>
  Type.String({ format: "date-time", pattern: UTC_MILLISECOND_TIMESTAMP });

export const AdapterSourceTypeSchema = Type.Union(
  [
    "provider_api",
    "authenticated_catalog",
    "public_static_page",
    "public_rendered_page",
    "publisher_checkpoint_repository",
  ].map((value) => Type.Literal(value)),
);

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
    parameters: Type.Array(AdapterParameterSchema, { maxItems: 64 }),
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
    source_type: AdapterSourceTypeSchema,
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
      { maxItems: 8, uniqueItems: true },
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
    contract_version: Type.String({ pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" }),
    provider_id: Type.String({ pattern: `^prv_${UUID_V4}$` }),
    adapter_version: Type.String({
      pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+\\+sha256\\.[0-9a-f]{64}$",
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

export type AdapterManifest = Static<typeof AdapterManifestSchema>;
