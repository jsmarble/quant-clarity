-- QuantClarity canonical D1 schema: identity, lineage, providers, and scopes.
-- Requirements: DATA-001–DATA-025, DATA-051, BE-002, BE-005, BE-006.

CREATE TABLE schema_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version TEXT NOT NULL CHECK (schema_version GLOB '[0-9]*.[0-9]*.[0-9]*'),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0)
);

INSERT INTO schema_metadata (singleton, schema_version, created_at_ms)
VALUES (1, '1.0.0', 0);

CREATE TABLE resource_identity (
  resource_id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL CHECK (resource_type IN (
    'organization', 'model_family', 'model', 'model_variant',
    'checkpoint', 'provider', 'offering'
  )),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  CHECK (length(resource_id) = 40),
  CHECK (resource_id = lower(resource_id)),
  CHECK (substr(resource_id, 13, 1) = '-' AND substr(resource_id, 18, 1) = '-' AND substr(resource_id, 23, 1) = '-' AND substr(resource_id, 28, 1) = '-'),
  CHECK (substr(resource_id, 19, 1) = '4' AND substr(resource_id, 24, 1) IN ('8', '9', 'a', 'b')),
  CHECK (substr(resource_id, 5) NOT GLOB '*[^0-9a-f-]*'),
  CHECK (
    (resource_type = 'organization' AND substr(resource_id, 1, 4) = 'org_') OR
    (resource_type = 'model_family' AND substr(resource_id, 1, 4) = 'fam_') OR
    (resource_type = 'model' AND substr(resource_id, 1, 4) = 'mdl_') OR
    (resource_type = 'model_variant' AND substr(resource_id, 1, 4) = 'var_') OR
    (resource_type = 'checkpoint' AND substr(resource_id, 1, 4) = 'chk_') OR
    (resource_type = 'provider' AND substr(resource_id, 1, 4) = 'prv_') OR
    (resource_type = 'offering' AND substr(resource_id, 1, 4) = 'off_')
  )
);

CREATE TABLE organization (
  organization_id TEXT PRIMARY KEY REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE CHECK (slug <> '' AND slug = lower(slug) AND slug NOT GLOB '*[^a-z0-9-]*'),
  display_name TEXT NOT NULL CHECK (display_name <> ''),
  normalized_name TEXT NOT NULL UNIQUE CHECK (normalized_name <> ''),
  organization_kind TEXT NOT NULL CHECK (organization_kind IN ('publisher', 'provider_operator', 'both', 'other')),
  official_url_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0)
);

CREATE TABLE model_family (
  family_id TEXT PRIMARY KEY REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE CHECK (slug <> '' AND slug = lower(slug) AND slug NOT GLOB '*[^a-z0-9-]*'),
  display_name TEXT NOT NULL CHECK (display_name <> ''),
  normalized_name TEXT NOT NULL UNIQUE CHECK (normalized_name <> ''),
  publisher_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0)
);

CREATE TABLE model (
  model_id TEXT PRIMARY KEY REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  family_id TEXT NOT NULL REFERENCES model_family(family_id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE CHECK (slug <> '' AND slug = lower(slug) AND slug NOT GLOB '*[^a-z0-9-]*'),
  display_name TEXT NOT NULL CHECK (display_name <> ''),
  normalized_name TEXT NOT NULL UNIQUE CHECK (normalized_name <> ''),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'unavailable', 'unknown')),
  publisher_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  release_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  modality_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  context_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  output_limit_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  license_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  architecture_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0)
);

CREATE TABLE model_variant (
  variant_id TEXT PRIMARY KEY REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  model_id TEXT NOT NULL REFERENCES model(model_id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE CHECK (slug <> '' AND slug = lower(slug) AND slug NOT GLOB '*[^a-z0-9-]*'),
  display_name TEXT NOT NULL CHECK (display_name <> ''),
  variant_kind TEXT NOT NULL CHECK (variant_kind <> ''),
  selection_evidence_claim_id TEXT NOT NULL REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  description_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0)
);

CREATE TABLE model_alias (
  alias_id TEXT PRIMARY KEY CHECK (length(alias_id) = 40 AND substr(alias_id, 1, 4) = 'als_' AND alias_id = lower(alias_id)),
  target_resource_id TEXT NOT NULL REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  raw_alias TEXT NOT NULL CHECK (raw_alias <> ''),
  normalized_alias TEXT NOT NULL CHECK (normalized_alias <> ''),
  alias_kind TEXT NOT NULL CHECK (alias_kind IN ('name', 'punctuation', 'separator', 'organization_prefix', 'provider_id', 'explicit_variant_identifier', 'other')),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  retired_at_ms INTEGER CHECK (retired_at_ms IS NULL OR (typeof(retired_at_ms) = 'integer' AND retired_at_ms >= created_at_ms)),
  UNIQUE (target_resource_id, normalized_alias, alias_kind)
);

CREATE TABLE slug_history (
  slug_history_id TEXT PRIMARY KEY CHECK (length(slug_history_id) = 40 AND substr(slug_history_id, 1, 4) = 'slg_' AND slug_history_id = lower(slug_history_id)),
  resource_id TEXT NOT NULL REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  slug TEXT NOT NULL CHECK (slug <> '' AND slug = lower(slug) AND slug NOT GLOB '*[^a-z0-9-]*'),
  valid_from_ms INTEGER NOT NULL CHECK (typeof(valid_from_ms) = 'integer' AND valid_from_ms >= 0),
  valid_to_ms INTEGER CHECK (valid_to_ms IS NULL OR (typeof(valid_to_ms) = 'integer' AND valid_to_ms >= valid_from_ms))
);

CREATE UNIQUE INDEX slug_history_active_slug_uq ON slug_history(slug) WHERE valid_to_ms IS NULL;

CREATE TABLE checkpoint (
  checkpoint_id TEXT PRIMARY KEY REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  publisher_organization_id TEXT NOT NULL REFERENCES organization(organization_id) ON DELETE RESTRICT,
  repository_locator TEXT NOT NULL CHECK (repository_locator <> ''),
  checkpoint_kind TEXT NOT NULL CHECK (checkpoint_kind IN ('publisher_original', 'publisher_quantized_variant', 'third_party_conversion', 'other_evidenced')),
  repository_id_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  revision_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  publication_time_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  declared_weight_format_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  quantization_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  file_format_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0)
);

CREATE TABLE model_checkpoint (
  model_checkpoint_id TEXT PRIMARY KEY CHECK (length(model_checkpoint_id) = 40 AND substr(model_checkpoint_id, 1, 4) = 'mck_' AND model_checkpoint_id = lower(model_checkpoint_id)),
  model_resource_id TEXT NOT NULL REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  checkpoint_id TEXT NOT NULL REFERENCES checkpoint(checkpoint_id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('authoritative_source', 'source_quantized_variant', 'other_evidenced')),
  claim_id TEXT NOT NULL REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  UNIQUE (model_resource_id, checkpoint_id, role)
);

CREATE TABLE checkpoint_edge (
  edge_id TEXT PRIMARY KEY CHECK (length(edge_id) = 40 AND substr(edge_id, 1, 4) = 'edg_' AND edge_id = lower(edge_id)),
  from_checkpoint_id TEXT NOT NULL REFERENCES checkpoint(checkpoint_id) ON DELETE RESTRICT,
  to_checkpoint_id TEXT NOT NULL REFERENCES checkpoint(checkpoint_id) ON DELETE RESTRICT,
  relationship TEXT NOT NULL CHECK (relationship IN ('derived_from', 'quantized_from', 'publisher_variant_of', 'unknown_lineage')),
  claim_id TEXT NOT NULL REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  CHECK (from_checkpoint_id <> to_checkpoint_id),
  UNIQUE (from_checkpoint_id, to_checkpoint_id, relationship)
);

CREATE TABLE provider (
  provider_id TEXT PRIMARY KEY REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  organization_id TEXT REFERENCES organization(organization_id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE CHECK (slug <> '' AND slug = lower(slug) AND slug NOT GLOB '*[^a-z0-9-]*'),
  display_name TEXT NOT NULL CHECK (display_name <> ''),
  normalized_name TEXT NOT NULL UNIQUE CHECK (normalized_name <> ''),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'unavailable', 'unknown')),
  official_url_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  aliases_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aliases_json) AND json_type(aliases_json) = 'array'),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0)
);

CREATE TABLE offering (
  offering_id TEXT PRIMARY KEY REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL REFERENCES provider(provider_id) ON DELETE RESTRICT,
  provider_model_id TEXT NOT NULL CHECK (provider_model_id <> ''),
  normalized_provider_model_id TEXT NOT NULL CHECK (normalized_provider_model_id <> ''),
  tier_key TEXT NOT NULL CHECK (tier_key <> ''),
  endpoint_class TEXT NOT NULL CHECK (endpoint_class <> ''),
  material_region_key TEXT NOT NULL,
  model_resource_id TEXT NOT NULL REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'unavailable', 'unknown')),
  first_observed_at_ms INTEGER NOT NULL CHECK (typeof(first_observed_at_ms) = 'integer' AND first_observed_at_ms >= 0),
  display_name_claim_id TEXT REFERENCES field_claim(claim_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  supported_regions_json TEXT CHECK (supported_regions_json IS NULL OR (json_valid(supported_regions_json) AND json_type(supported_regions_json) = 'array')),
  created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
  UNIQUE (provider_id, normalized_provider_model_id, tier_key, endpoint_class, material_region_key)
);

CREATE TABLE claim_scope (
  scope_id TEXT PRIMARY KEY CHECK (length(scope_id) = 40 AND substr(scope_id, 1, 4) = 'scp_' AND scope_id = lower(scope_id)),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('entity', 'model', 'checkpoint', 'provider', 'offering')),
  subject_resource_id TEXT NOT NULL REFERENCES resource_identity(resource_id) ON DELETE RESTRICT,
  source_object_locator TEXT NOT NULL CHECK (source_object_locator <> '' AND length(source_object_locator) <= 2048),
  observed_from_ms INTEGER NOT NULL CHECK (typeof(observed_from_ms) = 'integer' AND observed_from_ms >= 0),
  observed_to_ms INTEGER CHECK (observed_to_ms IS NULL OR (typeof(observed_to_ms) = 'integer' AND observed_to_ms >= observed_from_ms)),
  complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
  provider_id TEXT REFERENCES provider(provider_id) ON DELETE RESTRICT,
  provider_model_id TEXT,
  tier_key TEXT,
  endpoint_class TEXT,
  material_region_key TEXT,
  component_scope TEXT,
  CHECK (
    (
      scope_kind = 'offering' AND complete = 1 AND
      provider_id IS NOT NULL AND provider_model_id IS NOT NULL AND provider_model_id <> '' AND
      tier_key IS NOT NULL AND tier_key <> '' AND endpoint_class IS NOT NULL AND endpoint_class <> '' AND
      material_region_key IS NOT NULL AND
      lower(provider_model_id) NOT IN ('*', 'all', 'any') AND
      lower(tier_key) NOT IN ('*', 'all', 'any') AND
      lower(endpoint_class) NOT IN ('*', 'all', 'any') AND
      lower(material_region_key) NOT IN ('*', 'all', 'any')
    ) OR
    (
      scope_kind <> 'offering' AND provider_id IS NULL AND provider_model_id IS NULL AND
      tier_key IS NULL AND endpoint_class IS NULL AND material_region_key IS NULL AND component_scope IS NULL
    )
  )
);

CREATE INDEX model_family_idx ON model(family_id, model_id);
CREATE INDEX model_variant_model_idx ON model_variant(model_id, variant_id);
CREATE INDEX model_alias_normalized_idx ON model_alias(normalized_alias, target_resource_id);
CREATE INDEX offering_model_idx ON offering(model_resource_id, status, provider_id, offering_id);
CREATE INDEX offering_provider_idx ON offering(provider_id, status, offering_id);
CREATE INDEX claim_scope_subject_idx ON claim_scope(subject_resource_id, scope_kind, observed_from_ms);
