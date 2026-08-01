# ADR 0004: Use stable opaque IDs, field claims, and exact-offering applicability

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, data lead
- Related requirements: DATA-001–DATA-015, DATA-020–DATA-039, DATA-051–DATA-054, DATA-060–DATA-064, RULE-001–RULE-004, BE-001–BE-006, QA-010–QA-012
- Supersedes: None

## Context

Provider identifiers, display names, URLs, prices, and source descriptions change over time. The system must preserve stable public resources while attaching each fact to exact timestamped evidence and preventing a catalog-level precision claim from leaking onto a materially different live offering. Model Facts and Offering Facts are presentation views, not duplicate canonical entities.

## Decision

Assign each canonical entity an opaque, prefixed UUID generated once with cryptographic randomness and persisted permanently. Public slugs are separate mutable attributes with a redirect history. Do not derive canonical model IDs from a provider model ID or display name.

Represent canonical information with explicit entities for publisher/developer organizations, model families, models, variants, checkpoints, model-checkpoint associations/relationships, parameter facts, providers, offerings, acquisition runs, observations, evidence, precision observations/components, prices/conditions, policies, and publications. Publisher identity is independent of inference-provider identity.

Represent each publishable non-null fact as a field claim containing:

- stable subject resource ID backed by a common resource registry and type-check triggers;
- field path and normalized value;
- raw source value when applicable;
- observation and evidence IDs;
- observation and applicability timestamps;
- extraction, normalization, and source-policy versions;
- source class, typed claim scope, status, and supersession link.

Use typed `entity`, `model`, `checkpoint`, `provider`, and `offering` claim scopes. Model/checkpoint facts retain publisher/source applicability without an invented provider. Define offering identity and serving-precision/price applicability with provider ID, exact provider model ID, material tier, endpoint/availability class, and material region. A uniqueness constraint applies to the normalized identity tuple. Catalog/base-model metadata may be linked as discovery evidence but cannot satisfy an offering claim unless the adapter produces an explicit, validated applicability link to that exact tuple.

Canonical-versus-explicit-variant classification is a versioned deterministic policy. Serving precision alone never creates a variant; an intentionally selectable provider/publisher identity may do so.

## Consequences

- Provider renames and URL changes do not break public IDs.
- Field-level provenance and supersession are queryable rather than embedded in prose.
- Unsupported or conflicting facts can become unknown without deleting identity or history.
- Exact applicability becomes enforceable by schema and contract tests.
- Canonical matching requires a durable alias/identity registry and conservative conflict handling.
- Slug changes require redirect records and uniqueness checks.
- Field-claim volume is higher than storing one mutable JSON document per entity.

## Alternatives considered

- Natural keys or slugs as IDs: rejected because publisher/provider naming is mutable and collision-prone.
- Deterministic IDs derived from normalized names: rejected because later identity corrections could change IDs or collapse distinct releases.
- One JSON evidence blob per entity: rejected because it cannot reliably enforce field-level evidence, precedence, and supersession.
- Provider precision stored directly on models: rejected because it violates offering identity and source-lineage rules.
- Separate Model Facts and Offering Facts tables: rejected because those are presentation views over canonical resources.

## Validation

- Golden tests cover canonical names, explicit variants, aliases, provider-ID punctuation changes, and non-collapsing distinct releases.
- Constraint tests reject exact-offering claims whose evidence applicability tuple does not match.
- Constraint tests reject resource-registry type mismatches and provider-scoped model/checkpoint facts.
- QA-012 proves `default_precision` on a base catalog object is not attributed to a live offering without an applicability link.
- Rename and source-URL migration tests prove IDs remain stable and old slugs redirect.
- Every non-null field in a generated publication must resolve to at least one valid field claim and timestamped evidence record.
