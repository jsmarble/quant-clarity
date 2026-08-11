# ADR 0056: Validate persisted Offering relationship closure

- Status: Accepted; implemented locally
- Date: 2026-08-11
- Decision owners: Staff engineer, data architecture lead, pipeline lead, data-neutrality reviewer, security and privacy lead
- Related requirements: `DATA-003`, `DATA-020`, `DATA-021`, `DATA-025`, `DATA-030`–`DATA-035`, `DATA-040`–`DATA-046`, `DATA-051`, `DATA-055`, `DATA-060`, `DATA-061`, `DATA-065`, `BE-005`, `BE-011`, `QA-006`, `QA-010`, `QA-012`
- Extends: ADRs 0004, 0010, 0015, 0018, 0027, 0035, and 0055
- Supersedes: None

## Context

The persisted publication manifest commits canonical Provider, Offering, Model, Variant, Price, PrecisionObservation, and EvidenceSummary bytes. Existing descriptor closure proves identities, content hashes, inventories, and provider attribution. The provider-model-ID search projection also rehydrates one Offering as an eligibility witness and verifies its Provider/target identity. Neither boundary proves that every Offering's complete Price and PrecisionObservation child sets agree in both directions, that every precision applicability tuple belongs to that exact Offering, or that every referenced EvidenceSummary exists for the resource that cites it.

That gap prevents Offering comparison and Offering Facts from treating sealed publication bytes as complete relationship authority. A provider-model-ID search witness is intentionally insufficient: it is selected for exact search eligibility, not for Price, PrecisionObservation, EvidenceSummary, history, or comparison semantics.

The next safe increment is a pre-release persisted-content hard cutover parallel to ADR 0035. It establishes structural closure and bounded capacity only. It does not decide which historical observation is current, construct a comparison row, or expose data through a reader, API, or page.

## Decision

### Relevant-resource contracts and identities

A persisted publication is Offering-relationship closed only when every relevant `provider`, `offering`, `model`, `variant`, `price`, `precision_observation`, and `evidence_summary` resource required by the rules below is present in the same publication, passes its complete public canonical contract, and has an embedded stable identity equal to its outer publication resource ID.

Each Offering must resolve exactly one Provider through `provider_id` and exactly one target through `model_resource_id`. A `mdl_` target must be a Model and a `var_` target must be a Variant. The Provider and target resources are contract-validated even if another closure rule already validated them. Provider attribution for the Offering, every Price, and every PrecisionObservation must equal the Offering's Provider. Lifecycle state does not relax structural integrity: active, inactive, unavailable, stale, historical, unknown, and conditional records obey the same closure rules.

This decision does not add an Offering-to-Model/Variant reverse array. The complete Offering inventory is the canonical source for reverse target navigation.

### Exact Offering child sets

For each Offering:

1. `price_ids`, treated as an unordered unique set, must equal exactly the set of every Price resource whose `offering_id` equals that Offering ID.
2. `precision_observation_ids`, treated as an unordered unique set, must equal exactly the set of every PrecisionObservation resource whose `offering_id` equals that Offering ID.
3. Every listed Price and PrecisionObservation must resolve, pass its contract, match its outer identity, and point back to the same Offering.
4. Every Price and PrecisionObservation in the relevant publication inventory must be listed by exactly its owning Offering. Orphaned, extra, cross-Offering, and multiply owned children fail closure.

Array order has no semantic or presentation meaning. Permuting resources or either child-ID array cannot change acceptance.

### Precision applicability

Every PrecisionObservation's applicability must equal its owning Offering on all of:

- `provider_id`;
- exact `provider_model_id` bytes;
- exact `tier_key` bytes;
- exact `endpoint_class` bytes; and
- exact `material_region_key` bytes.

`component_scope` remains contract-validated but is deliberately excluded from equality with the Offering because the Offering identity has no component member. This closure does not interpret component names, combine observations, infer missing precision, or select a serving-precision summary.

### Evidence-reference closure

Every evidence ID in an Offering, Price, or PrecisionObservation contract must resolve exactly one contract-valid EvidenceSummary in the same publication, and the EvidenceSummary's embedded `evidence_id` must equal its outer resource ID. This includes the Offering's top-level inventory and Fact fields, the Price's top-level inventory, and the PrecisionObservation's top-level inventory, Fact fields, and component Facts.

The EvidenceSummary `subject_resource_id` must equal the stable identity of the enclosing Offering, Price, or PrecisionObservation. A reference contained by a PrecisionObservation component remains owned by the enclosing `precision_id`, because the public component contract has no independent resource identity. The implementation must enumerate these contract-defined evidence-reference locations; it must not recursively accept arbitrary properties named `evidence_ids`.

Provider, Model, Variant, ModelFamily, and embedded Checkpoint fact-evidence completeness are not asserted by this comparison-prerequisite slice. Their existing contracts and content hashes remain mandatory; extending content-aware evidence closure to those resource families is separate work.

Evidence existence and subject identity are the entire evidence-semantic boundary of this decision. It does not compare EvidenceSummary `field` or `value` text with the referencing field/value, establish source precedence, verify entailment, or reinterpret source applicability.

### Time-order invariants

Each Offering must satisfy `first_observed_at <= last_observed_at` by canonical timestamp order. Each Price with both `effective_from` and `effective_to` non-null must satisfy `effective_from <= effective_to`. Null interval endpoints retain their existing contract meaning; this decision does not infer them or evaluate whether a Price is current at a publication time.

### Bounds and algorithm

The Offering-relationship validator is runtime-neutral and bounded before any relevant JSON is parsed:

- at most 100,000 relevant Provider, Offering, Model, Variant, Price, PrecisionObservation, and EvidenceSummary resources in aggregate;
- at most 32 MiB of aggregate UTF-8 bytes across those relevant `resource_json` strings;
- the existing 1,000,000-byte per-resource persisted-content ceiling remains in force; and
- at most 500,000 counted relationship edges across Provider/target references, forward child IDs, reverse child ownership, precision applicability ownership, evidence references, and EvidenceSummary subjects.

After the global snapshot bounds, the implementation validates every persisted resource's outer type/ID prefix, content-hash shape, and unique descriptor key. It then identifies relevant resources from those minimally validated descriptors, counts resources, measures each string with UTF-8 encoding, and rejects aggregate overflow before any canonicalization or content-hash operation can parse relevant `resource_json`. Canonical content-hash verification and the complete manifest descriptor validation follow capacity admission; semantic family and Offering closure run only after both succeed. The edge counter is checked before retaining an over-limit relationship. Error collection remains bounded and non-sensitive.

For `R` relevant resources and `E` counted edges, validation must be `O(R + E)` time and `O(R + E)` worst-case space. It may use bounded additional passes to reduce retained state, but it may not use an input-dependent query, network call, clock, or unbounded diagnostic accumulator.

### Persisted-content hard cutover

`buildImmutableManifestFromPersistedContent` remains the sole integration seam. It snapshots globally bounded input, validates basic outer resource descriptors, applies the Offering-specific pre-parse capacity admission, verifies canonical resource hashes, and completes full immutable-manifest descriptor validation before invoking ADR 0035 family closure and this Offering semantic closure. No trusted manifest escapes until every content-aware closure succeeds.

This is a pre-release hard cutover. Every seal, readiness, switch, retained-publication verification, backup/restore projection, and fixture path that uses the persisted-content builder inherits the new failure boundary. There is no legacy compatibility mode and no grandfathered relationship-invalid publication.

The descriptor-only manifest builder remains unchanged because descriptors cannot prove these relationships. Serving schema `1.13.0`, manifest contract `1.0.0`, closure hashes, seal/readiness/switch proof shapes, backup formats, and public contracts remain unchanged. Existing closure hashes already commit the validated bytes, and the build commit identifies the validating implementation.

### Explicit deferrals

This decision does not define or implement:

- EvidenceSummary field/value semantic equivalence, provenance precedence, or factual entailment;
- current Price or PrecisionObservation selection, overlap resolution, supersession, or publication-time evaluation;
- comparison rows, default display order, currency scope, sorting, filtering, pagination, or side-by-side selection;
- Offering Facts, provider comparison, provider pages, Model/Variant reverse-link presentation, or any web surface;
- query RPC, API route, OpenAPI response, cursor, cache, public ingress, or remote binding;
- provider acquisition, source access, fixtures derived from authenticated data, or pipeline execution; or
- migration, provisioning, publication, preview, production deployment, or release authority.

All mapped traceability statuses remain unchanged.

## Consequences

- A content-aware publication cannot become trusted with a dangling or contradictory Offering relationship graph.
- Later current-value policy and comparison projection work can start from one complete, bounded canonical graph instead of search eligibility witnesses.
- Reverse Offering-to-target navigation remains derived from the complete Offering inventory and cannot drift from a duplicated target list.
- Evidence subject mix-ups fail before publication trust, while deeper evidence semantics remain an explicit later gate.
- Existing relationship-invalid development fixtures must be corrected and their deterministic hashes regenerated.
- No public behavior, visitor-data surface, schema version, remote resource, or deployment authority changes.

## Alternatives considered

- **Build comparison rows directly from provider-model-ID search witnesses:** rejected because those witnesses do not prove complete child or evidence closure.
- **Validate only forward Offering arrays:** rejected because orphaned Price or PrecisionObservation resources could remain silently unreachable.
- **Validate only child back-references:** rejected because an Offering could omit canonical children and create incomplete public facts.
- **Compare `component_scope` with Offering identity:** rejected because the Offering identity has no component member and component scope deliberately narrows a PrecisionObservation.
- **Validate evidence `field` and `value` semantics now:** rejected because that is a separate factual-policy decision and cannot be inferred from structural identity.
- **Select the latest observation while validating closure:** rejected because recency is not accepted current-value authority and could hide conflicts or effective intervals.
- **Add D1 triggers or a new durable proof:** rejected because the common persisted-content boundary already authenticates the bytes and covers non-D1 reconstruction paths.
- **Grandfather existing fixtures or publications:** rejected because there is no production publication and one pre-release validity rule is safer than compatibility modes.

## Validation

- Contract and identity cases for every relevant resource type, including malformed JSON, invalid Unicode/timestamps, excess properties, wrong type, and outer/inner ID disagreement.
- Exact forward/reverse child-set cases for empty, one, and many Price/PrecisionObservation children; array/resource permutations; missing, extra, duplicate, orphaned, cross-Offering, and multiply owned children.
- Provider and Model/Variant target existence, type, identity, attribution, lifecycle-independence, and canonical relationship cases.
- Precision applicability equality and one-field-at-a-time mismatch cases, including the explicit `component_scope` non-comparison.
- Evidence existence, EvidenceSummary identity, exact enclosing-resource ownership, shared evidence for the same subject, cross-subject rejection, and PrecisionObservation component ownership.
- Offering and Price time-order equality, valid ranges, reversed ranges, and null Price endpoints.
- Exported resource/edge/UTF-8 capacity arithmetic at `limit - 1`, `limit`, and `limit + 1`; an actual aggregate-byte build-path rejection before invalid JSON parsing; and incremental evidence-edge accounting without merged hostile arrays. Full 100,000-resource and 500,000-edge canonical fixture construction is intentionally not required in routine unit tests because the pure admission function is the same checked boundary invoked by the builder.
- Persisted-content ordering: basic outer descriptor failures precede Offering capacity admission; capacity admission precedes parsing content hashes; hash/full-descriptor and ADR 0035 failures precede Offering semantic closure; any failure prevents a trusted manifest from escaping.
- Seal/readiness/switch/retained/backup/restore call-path inheritance with prior known-good head preservation and no schema/proof drift.
- Full documentation, contract, publication-core, worker-runtime, privacy, format, lint, type, build, and verification gates before implementation acceptance.
