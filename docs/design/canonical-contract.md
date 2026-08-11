# Canonical and publication contract design

| Attribute | Value |
|---|---|
| Status | Approved design baseline; machine-readable schemas and D1 migrations are implementation tasks |
| Parent design | [`system-design.md`](system-design.md) |
| Related requirements | `DATA-*`, `RULE-*`, `BE-*`, `PIPE-020`–`PIPE-056`, `QA-001`, `QA-006`, `QA-010`–`QA-012` |

## Conventions

- IDs are immutable lowercase prefixed UUIDv4 values stored as text. Every independently ID-bearing table has one registered prefix: `org_` organization/publisher, `fam_` family, `mdl_` model, `var_` variant, `als_` alias, `slg_` slug history, `chk_` checkpoint, `mck_` model-checkpoint link, `edg_` checkpoint edge, `par_` parameter fact, `prv_` provider, `off_` offering, `scp_` claim scope, `aff_` affiliate destination, `src_` acquisition run, `obs_` observation, `evd_` evidence, `clm_` claim, `cfl_` conflict, `prc_` precision, `cmp_` precision component, `pcs_` price, `occ_` schedule occurrence, `run_` pipeline run, `pvr_` provider run, `out_` roster outcome, `anm_` anomaly, `qrn_` quarantine, `pol_` policy, `prn_` provider slice, and `pub_` publication. `resource_identity.resource_id` intentionally reuses the registered entity ID rather than minting a second identity.
- Timestamps are required UTC RFC 3339 strings with millisecond precision in contracts and integer Unix milliseconds in D1 indexed columns.
- `created_at` is immutable. Corrections create superseding records; they do not rewrite audit history.
- Public decimal values are canonical non-negative decimal strings. Empty strings, `NaN`, infinity, exponents, and binary floats are invalid.
- JSON columns contain canonical JSON with sorted keys and schema-versioned objects. Frequently filtered values have typed columns.
- Foreign keys are enabled in every D1 migration. Deleting canonical audit rows is prohibited; retention jobs may delete only explicitly reconstructible public projections after backup checks.

## Operational tables

The field lists below are normative for the first schema version. Machine-readable JSON Schemas and SQL migrations must implement the stated nullability and constraints.

### Identity and lineage

| Table | Required fields | Optional fields | Constraints and cardinality |
|---|---|---|---|
| `resource_identity` | `resource_id`, `resource_type`, `created_at` | none | Common FK target for addressable canonical entities; type-specific triggers enforce a matching row and make polymorphic references enforceable in D1 |
| `organization` | `organization_id`, `slug`, `display_name`, `normalized_name`, `organization_kind`, `created_at` | official URL claim ID | Publisher/developer identity is independent of inference-provider identity; a provider may optionally reference the same organization |
| `model_family` | `family_id`, `slug`, `display_name`, `normalized_name`, `created_at` | `publisher_claim_id` | Unique current slug and normalized identity; one-to-many models |
| `model` | `model_id`, `family_id`, `slug`, `display_name`, `normalized_name`, `status`, `created_at` | publisher/release/modality/context/output/license/architecture claim IDs | One canonical model per stable identity; unique current slug |
| `model_variant` | `variant_id`, `model_id`, `slug`, `display_name`, `variant_kind`, `selection_evidence_claim_id`, `created_at` | `description_claim_id` | Variant requires evidence that it is explicitly named/selectable; unique slug; many-to-one canonical model |
| `model_alias` | `alias_id`, `target_resource_id`, `raw_alias`, `normalized_alias`, `alias_kind`, `created_at` | `retired_at` | FK to `resource_identity`; trigger permits only model/variant targets; explicit-variant aliases cannot target a canonical model |
| `slug_history` | `slug_history_id`, `resource_id`, `slug`, `valid_from` | `valid_to` | FK to `resource_identity`; historical slugs resolve to one stable resource; active slug unique |
| `checkpoint` | `checkpoint_id`, `publisher_organization_id`, `repository_locator`, `checkpoint_kind`, `created_at` | repository ID, revision/commit, publication time, declared weight format, quantization, file/checkpoint format claim IDs | Publisher checkpoint and third-party conversion are distinct records; publisher is not inferred from an inference provider |
| `model_checkpoint` | `model_checkpoint_id`, `model_resource_id`, `checkpoint_id`, `role`, `claim_id`, `created_at` | none | Model target is a model or explicit variant; role is `authoritative_source`, `source_quantized_variant`, or `other_evidenced`; unique target/checkpoint/role |
| `checkpoint_edge` | `edge_id`, `from_checkpoint_id`, `to_checkpoint_id`, `relationship`, `claim_id` | none | Relationship enum: `derived_from`, `quantized_from`, `publisher_variant_of`, `unknown_lineage`; no self-edge |
| `parameter_fact` | `parameter_fact_id`, `model_resource_id`, `parameter_kind`, `raw_value`, `normalized_decimal`, `approximation_state`, `claim_id`, `created_at` | qualifier | Kind is `total` or `active`; approximation is `exact`, `approximate`, or `unknown`; no derivation from reputation/name |

Every public entity is registered in `resource_identity` in the same transactional D1 batch. Foreign keys target that registry; type-check triggers and contract tests reject mismatches. Application code never accepts an arbitrary resource type plus ID without registry validation.

### Providers and offerings

| Table | Required fields | Optional fields | Constraints and cardinality |
|---|---|---|---|
| `provider` | `provider_id`, `slug`, `display_name`, `normalized_name`, `status`, `created_at` | organization ID, official URL claim ID, aliases | Stable across rename; current slug unique; optional organization link does not merge provider and publisher roles |
| `offering` | `offering_id`, `provider_id`, `provider_model_id`, `normalized_provider_model_id`, `tier_key`, `endpoint_class`, `material_region_key`, `model_resource_id`, `status`, `first_observed_at`, `created_at` | display-name claim ID, supported regions | Model resource FK plus trigger permits only model/variant; unique exact identity tuple `(provider_id, normalized_provider_model_id, tier_key, endpoint_class, material_region_key)` |
| `claim_scope` | `scope_id`, `scope_kind`, `subject_resource_id`, `source_object_locator`, `observed_from`, `complete` | provider ID, provider model ID, tier key, endpoint class, material region key, component scope, `observed_to` | Immutable typed union. `entity`, `model`, `checkpoint`, and `provider` scopes forbid offering tuple fields. `offering` scope requires the complete exact tuple and forbids wildcard values; empty region means evidence proves no material distinction |
| `affiliate_destination` | `affiliate_id`, `provider_id`, `destination_url`, `allowed_host`, `disclosure_text`, `enabled`, `created_at` | program metadata | Physically excluded from fact/search tables; one or more destinations per provider; never a sort field |

Offering status enum is `active`, `inactive`, `unavailable`, or `unknown`. Freshness is computed separately and never encoded by status.

### Observation, evidence, and claims

| Table | Required fields | Optional fields | Constraints and cardinality |
|---|---|---|---|
| `acquisition_run` | `acquisition_run_id`, `run_id`, `source_owner_organization_id`, `source_type`, `status`, `started_at`, `created_at` | provider run ID, ended at | General publisher/provider source run; provider association is optional |
| `observation` | `observation_id`, `acquisition_run_id`, `source_type`, `source_owner`, `safe_locator`, `retrieved_at`, `extraction_method`, `extraction_version`, `policy_version`, `redacted_hash`, `created_at` | HTTP metadata, authenticated-only label | One observation has one or more evidence records and zero or more claims |
| `evidence` | `evidence_id`, `observation_id`, `private_r2_key`, `public_summary`, `source_span_locator`, `integrity_hash`, `retention_class`, `created_at` | public source URL | `private_r2_key` never enters public projections; retention class minimum is 24 months |
| `field_claim` | `claim_id`, `subject_resource_id`, `field_name`, `raw_value_json`, `normalized_value_json`, `value_state`, `observation_id`, `evidence_id`, `scope_id`, `precedence_class`, `verification_state`, `policy_version`, `valid_from`, `created_at` | `valid_to`, `supersedes_claim_id`, qualifier JSON | Value state: `known`, `unknown`, `not_applicable`, `unavailable`; known requires evidence and observation; scope kind must be valid for subject/field; supersession chain is acyclic |
| `claim_conflict` | `conflict_id`, `subject_resource_id`, `field_name`, `left_claim_id`, `right_claim_id`, `resolution`, `created_at` | resolved claim ID | Subject FK uses resource registry; equal-authority unresolved conflicts force public unknown |

`verification_state` is `candidate`, `verified`, `quarantined`, or `rejected`. Only `verified` claims may publish. A known unstructured claim requires entailment plus an independent verification path. A deterministic structured claim may be verified under `PIPE-039A` after schema, typed-scope applicability, provenance, and anomaly checks. Offering price/serving/component precision requires `scope_kind=offering` whose tuple equals the offering; model/checkpoint facts require their own non-offering scope and never acquire a fictitious provider tuple.

### Precision and price claims

| Table | Required fields | Optional fields | Constraints and cardinality |
|---|---|---|---|
| `precision_observation` | `precision_id`, `offering_id`, `claim_id`, `normalized_format`, `summary_format`, `raw_field_name`, `raw_precision`, `scope_id`, `created_at` | provider definition, format variant | Stable detail ID; normalized enum is extensible; offering and claim scopes must match |
| `precision_component` | `precision_component_id`, `precision_id`, `component`, `normalized_format`, `claim_id` | format variant | Unknown components stay unknown; component enum has extensible `other` label |
| `price_schedule` | `price_id`, `offering_id`, `role`, `price_class`, `amount_decimal`, `amount_sort_key`, `currency`, `currency_provenance`, `unit`, `condition_hash`, `is_standard_comparable`, `claim_id`, `observed_at`, `created_at` | effective interval, condition JSON | Stable detail ID; unique `(offering_id, role, price_class, currency, condition_hash, effective_from)`; amount and sort key round-trip exactly |

Price role is `input`, `output`, or `cached_input`. Price class is `standard`, `promotional`, `batch`, `subscription`, `committed`, `volume`, `dedicated`, `region_tiered`, `context_tiered`, or `other_conditional`.

The initial normalized precision vocabulary is `BF16`, `FP16`, `FP8`, `FP6`, `FP4`, `NVFP4`, `MXFP4`, `INT8`, `INT4`, `mixed`, `other`, and `unknown`. Additive values are allowed by metadata/version negotiation; BF16 and FP16 remain distinct and the display order is not a quality order.

`is_standard_comparable=true` only when all are true: class is `standard`; generally available; on-demand pay-as-you-go; non-batch; non-promotional; no subscription, commitment, volume minimum, dedicated deployment, region restriction, or context threshold; and the displayed amount is not merely `from`. The policy version that derives this flag is retained. Conditional prices remain visible but are excluded from default standard-price sorts.

Currency is ISO 4217 when defined. `currency_provenance=provider_stated` requires source evidence. Omitted currency becomes `USD` with `currency_provenance=system_default`. Prices in different currencies never share a numeric sort scope.

The sort key is a 43-character unsigned fixed-width representation: 24 integer digits, a separator, and 18 fractional digits. Values outside that range are quarantined. It exists only for exact same-currency ordering; the API returns `amount_decimal`.

### Pipeline and policy

| Table | Required fields | Optional fields | Constraints and cardinality |
|---|---|---|---|
| `schedule_occurrence` | `occurrence_id`, `scheduled_at`, `schedule_expression`, `created_at` | none | Deterministic from schedule name and scheduled time; independent of code version |
| `pipeline_run` | `run_id`, `occurrence_id`, `attempt_number`, `code_version`, `schema_version`, `status`, `started_at`, `created_at` | replay_of_run_id, ended_at, cost summary, error summary | Unique `(occurrence_id, attempt_number)`; replay links to prior attempt |
| `provider_run` | `provider_run_id`, `run_id`, `provider_id`, `adapter_version`, `status`, `started_at`, `created_at` | ended_at, error summary | Unique `(run_id, provider_id)`; terminal status required |
| `roster_outcome` | `outcome_id`, `provider_run_id`, `roster_item_id`, `status`, `evidence_id`, `created_at` | offering ID, error code | Exactly one terminal outcome per roster item |
| `anomaly` | `anomaly_id`, `provider_run_id`, `subject_resource_id`, `kind`, `status`, `created_at` | first/second claim IDs | Subject FK uses resource registry; unresolved anomaly blocks only affected record/field |
| `quarantine` | `quarantine_id`, `provider_run_id`, `subject_resource_id`, `reason_code`, `created_at` | released_at, release evidence | Subject FK uses resource registry; release is append-audited and never automatic after a hard budget trip |
| `policy_version` | `policy_id`, `kind`, `version`, `effective_at`, `content_hash`, `status` | supersedes version | Kind includes source precedence, normalization, display order, extraction, price comparison, and staleness |

This table describes the current pre-orchestration ledger, not the final
admission contract. [ADR 0060](../decisions/0060-publication-run-admission-and-terminal-coordination.md)
requires Phase 7.2-D to add immutable admission/run-plan authority, exact
adjacent replay, scheduled-time deadline, environment-wide fenced Provider
claims, sealed reports, and separate machine operational terminal evidence.
Until that reviewed migration exists, `roster_outcome.evidence_id` cannot be
used to invent source evidence for a pre-acquisition timeout or lock failure,
and no operational run write is permitted.

## Current-claim selection

The `source_precedence` policy is versioned by field group. Within one class, recency applies only after applicability and verification; equal-authority conflicts publish unknown unless the policy names a deterministic resolver.

| Field group | Ordered authority | Required conflict behavior |
|---|---|---|
| Canonical identity, publisher/developer, release, license | Publisher structured source; publisher page/artifact; approved independent registry; provider catalog | Missing publisher evidence uses the highest available class, labels that class/time publicly, and passes the unstructured verification gate; equal-class conflict is unknown |
| Architecture, modality, context/output limits, total/active parameters | Publisher artifact/schema; publisher documentation; approved technical paper; provider catalog | Never infer; preserve raw/normalized/approximation; equal-class conflict is unknown |
| Checkpoint identity, revision, declared weight/source format, lineage | Publisher repository/artifact; evidenced conversion publisher; publisher documentation | Third-party conversion never becomes publisher-original; unknown edge remains explicit |
| Provider identity and official URL | Provider-controlled structured source; provider page; approved registry | Provider and publisher roles remain separate; conflict blocks the affected identity fact |
| Offering identity, availability, tier, endpoint class, region | Exact provider API/catalog; exact provider endpoint documentation | Exact offering scope required; broader/base object cannot win |
| Serving and component precision | Exact offering API field; exact offering catalog field; exact offering documentation | Exact offering/component scope required; silence/conflict is unknown; no sibling fill |
| Input, output, cached-input price and currency | Exact offering billing/API field; exact offering pricing table | Each role selected independently; provider-omitted currency alone invokes marked USD default; conditional classes never replace standard |

Every row is materialized in a hashed `policy_version` artifact. Adding a source class or changing order/recency is a policy change that replays affected claims before publication.

For each entity field and candidate publication time:

1. Select verified claims whose validity and exact applicability include the target.
2. Apply the versioned field-specific precedence policy; a publisher leads model architecture/checkpoint facts, while an exact provider source leads offering price/serving facts.
3. Prefer a currently valid claim within the winning source class only under that field's deterministic recency rule.
4. If equally authoritative current claims conflict and no deterministic policy resolves them, publish unknown and retain the conflict.
5. Never fill a missing component from a sibling component or broaden a scope.
6. Produce a derived display label only from selected claims and record its deterministic derivation version.

## Staleness

An enabled provider has scheduled opportunities at each configured Monday/Thursday occurrence. A delayed run still belongs to its original occurrence. A successful exact-offering observation satisfies that opportunity; failed, unavailable, or quarantined acquisition does not. An active offering is stale when either:

- its provider has two consecutive completed scheduled opportunities without a successful observation for that offering; or
- more than eight elapsed days have passed since its last successful observation.

The earlier condition wins. A run still in progress does not count as missed until its 12-hour terminal deadline. Carried-forward last-known-good offerings preserve their original observation time and compute staleness against the new publication time. Default public tables require `status=active AND stale=false`.

## Publication snapshot composition

| Table | Purpose | Key constraints |
|---|---|---|
| `publication` | Immutable manifest metadata | `publication_id` primary key; state `building`, `ready`, `active`, `superseded`, `rolled_back`, or `failed` |
| `publication_provider_slice` | Exact provider run and selected-content disposition, or explicit unavailable disposition | Primary key `(publication_id, provider_id)`; unavailable requires null slice/non-carried state; selected content requires `prn_`; carried reuse preserves provider/run lineage under ADR 0017 |
| `publication_resource` | Versioned JSON projection for each public resource | Unique `(publication_id, resource_type, resource_id)`; content hash required |
| `publication_search_document` | Reconstructible exact/keyword document source | Unique `(publication_id, document_id)`; canonical resource ID required |
| `publication_head` | Singleton active and rollback-candidate pointers | One row, changed only in a D1 transactional batch after readiness |
| `publication_switch_preflight` | Fresh generation-bound archive/search/vector authorization | Immutable typed proof; activation binds the exact readiness attestation; rollback targets only the immediate `superseded` publication |
| `publication_switch_history` | Append-only activation and rollback audit ledger | One immutable event per generation; exact from/to closures, resulting candidate, and bounded control-plane authorization reference |

Snapshot construction fails if any known public field lacks a selected claim, evidence summary, and timestamp; any reference is orphaned; any offering identity tuple collides; any roster item lacks a terminal outcome; or model-card projection contains forbidden provider data beyond the provider count.

Readiness also fails when every provider is unavailable or the candidate contains no public resource. The last known-good head remains authoritative; an intentionally empty first public publication is not defined by the approved product requirements.

The public FTS5 index is reconstructible, not a backup source. Portable migration-away inventory contains ordinary base tables, readiness/seal ledgers, switch preflights, switch history, the singleton head, and `publication_search_document` rows. Accepted ADR 0043 governs current restore truth; proposed ADR 0045 would add product-owner-approved canonical publication recovery data for exact document-vector values. If accepted, restore creates a fresh D1 database, imports verified base rows, creates and deterministically repopulates FTS virtual tables, then restores exact publication-time document-vector bytes from the independently verified embedding artifact into a clean Vectorize index. An export path never depends on D1's unsupported export of a database that contains virtual tables or on current Vectorize as its own backup.

Each backup has one declared consistency boundary. The backup coordinator acquires the single pipeline-writer lease, drains in-flight canonical writes, records a D1 Time Travel bookmark plus an immutable high-water mark, and holds new writes while exporting canonical ordinary tables. Public serving data is already immutable by publication ID; its logical export selects exactly one ready/active publication closure and records that manifest ID. Every table/chunk has row count, byte count, range, and SHA-256 in the backup manifest. The coordinator verifies foreign keys, closure counts, ending bookmark/high-water mark, and manifest hashes before releasing the writer; any change or mismatch discards and retries the backup. Public reads continue because they use the separate serving database. Restore must prove the recovered canonical state equals that bookmark/high-water mark and the serving state equals the declared publication.

At least active and rollback-candidate publications remain queryable until every cursor that references them has expired. Cursor TTL is 15 minutes; hot rollback retention is at least seven days. Code releases must read both current and immediately prior schema versions during a rolling deployment.

## Retention and pruning

- Redacted private evidence is retained for at least 24 months after observation.
- Normalized price and precision observations are retained for the life of the service.
- Publication manifests and current-claim audit linkage are retained for the life of the service.
- Retrieved bytes pass through bounded streaming/in-memory DLP, relevance minimization, and redaction before any durable R2 object, Workflow state, log, fixture, hash, or AI input is written. Failed pre-retention input is discarded. Only verified redacted bytes enter the locked evidence prefix; it has the 24-month minimum. A legal/security exception requires a documented break-glass process supported by the platform rather than a normal application delete.
- No backup, compaction, or pruning job may shorten these periods. Tests seed boundary-dated records and verify retention decisions.

## Scale and partition triggers

Public serving D1 must remain below 60% of the current 10 GB per-database limit at the 100,000-offering profile, including active, rollback, indexes, and 30% migration headroom. Warning is 50%; at 60%, new publication is blocked pending an approved partition/migration. Canonical operational data moves large immutable observation payloads to R2 and partitions metadata by provider/year before any D1 database reaches 60%. Publication load tests measure single-threaded D1 write contention and require public reads to stay within NFR targets during logical backup and candidate staging.
