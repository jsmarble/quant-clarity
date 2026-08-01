import { Type, type Static, type TSchema } from "@sinclair/typebox";

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
    "^(org|fam|mdl|var|als|slg|chk|mck|edg|par|prv|off|scp|aff|src|obs|evd|clm|cfl|prc|cmp|pcs|occ|run|pvr|out|anm|qrn|pol|prn|pub)_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});

export const EvidenceIdSchema = Type.String({
  $id: "EvidenceId",
  pattern:
    "^evd_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});

export const PublicationIdSchema = Type.String({
  $id: "PublicationId",
  pattern:
    "^pub_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});

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
  const evidenceIdReference = () =>
    Type.Unsafe<Static<typeof EvidenceIdSchema>>(Type.Ref("EvidenceId"));
  return Type.Union(
    [
      Type.Object(
        {
          state: Type.Literal("known"),
          value,
          observed_at: Type.String({ format: "date-time" }),
          evidence_ids: Type.Array(evidenceIdReference(), { minItems: 1 }),
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
          observed_at: Type.Union([
            Type.String({ format: "date-time" }),
            Type.Null(),
          ]),
          evidence_ids: Type.Array(evidenceIdReference()),
        },
        { additionalProperties: false },
      ),
    ],
    { $id: schemaId },
  );
}

export const DatasetMetadataSchema = Type.Object(
  {
    publication_id: PublicationIdSchema,
    schema_version: Type.String({ pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" }),
    api_version: Type.Literal("1"),
    methodology_version: Type.String({ minLength: 1, maxLength: 64 }),
    methodology_effective_at: Type.String({ format: "date-time" }),
    methodology_url: Type.String({ format: "uri", maxLength: 2048 }),
    precision_vocabulary_version: Type.String({ minLength: 1, maxLength: 64 }),
    price_policy_version: Type.String({ minLength: 1, maxLength: 64 }),
    published_at: Type.String({ format: "date-time" }),
    generated_at: Type.String({ format: "date-time" }),
    next_refresh_window: Type.Object(
      {
        starts_at: Type.String({ format: "date-time" }),
        ends_at: Type.String({ format: "date-time" }),
      },
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
    degradation_notices: Type.Array(Type.String({ maxLength: 200 })),
  },
  { $id: "DatasetMetadata", additionalProperties: false },
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

export type DatasetMetadata = Static<typeof DatasetMetadataSchema>;
export type ErrorEnvelope = Static<typeof ErrorEnvelopeSchema>;
export type FactState = Static<typeof FactStateSchema>;
export type IdPrefix = Static<typeof IdPrefixSchema>;
export type ResourceId = Static<typeof ResourceIdSchema>;

export const GENERATED_SCHEMAS = {
  DatasetMetadata: DatasetMetadataSchema,
  EvidenceId: EvidenceIdSchema,
  ErrorEnvelope: ErrorEnvelopeSchema,
  FactState: FactStateSchema,
  IdPrefix: IdPrefixSchema,
  PublicationId: PublicationIdSchema,
  ResourceId: ResourceIdSchema,
} as const;
