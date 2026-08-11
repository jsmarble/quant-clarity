# ADR 0054: Project exact Model cards from already-read canonical Models

- Status: Accepted for local implementation
- Date: 2026-08-10
- Decision owners: Staff engineer, frontend lead, API lead, data-neutrality reviewer
- Related requirements: `FE-020`, `FE-021`, `FE-023`, `FE-025`, `FE-026`, `FE-027`, `SRCH-006`, `API-003`, `API-007`, `API-010`, `API-013`, `BE-007`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-003`, `QA-004`, `QA-005`, `QA-009`, `QA-014`
- Extends: ADRs 0011, 0012, 0013, 0016, 0030, 0031, 0033, 0037, 0051, 0052, and 0053

## Context

Phase 5V gives the local frontend a publication-pinned exact Model search, but its public-data representation contains only stable identity, display-name Fact, match class, and semantic-degradation state. Calling those results Model cards would violate `FE-020` through `FE-027`. Fetching Model detail once for each result would add as many as 20 service calls and D1 reads to one render, creating the N+1 amplification prohibited by the bounded public-read design.

The exact-name and provider-model-ID query tiers already select the canonical target resource JSON in the same bounded statements used to decide each result. They validate the complete canonical Model, exact target identity and type, publication membership, stored content hash, active status, name projection, and applicable eligibility witness before discarding every Model field except display name. The missing card data therefore does not require another query. It requires a closed internal carrier, a dedicated card projection, and exact response admission.

This decision defines a canonical-Model-only local slice. It does not add Variant cards, new filters, a public API contract, public or remote ingress, another resolver, another search implementation, or deployment authority.

## Decision

### Canonical carrier without additional reads

Add one versioned internal query operation for exact Model-card search. It reuses resolver V2, the selected bookmark, retained-hot availability horizon, exact-tier order, provider-model-ID winner suppression, compact continuation, and fixed Model-only query semantics from Phase 5V. The existing exact readers retain the already parsed and content-hash-verified canonical `Model` long enough to project a compact `ModelCard` alongside each admitted Model result instead of rereading it by stable ID. The dedicated operation returns only that detached projection, tier marker, and match kind through the same bookmark-continuous RPC; it does not carry the complete canonical Model across the service boundary.

The card operation may execute only the SQL statements that the equivalent existing merged exact search would execute. It performs no per-result statement, detail RPC, Cache API read, canonical-database read, provider call, or asynchronous enrichment. Existing thin `SearchCollection` RPC outputs and public contracts remain unchanged. If an exact tier cannot produce the complete canonical Model it already used to validate the result, the entire operation fails integrity validation rather than emitting a partial card.

The API treats the RPC output as hostile. It requires an exact Model-only result shape, validates and detaches the complete compact card, preserves exact page order and continuation authority, and rejects duplicate identities, cross-publication output, accessors, symbols, non-JSON data, malformed Fact states, or extra fields before serialization.

### Dedicated Model-card contract

Add a dedicated `ModelCard` contract rather than expanding `SearchResult` or reusing `ModelDetail`. Its fixed projection contains only:

1. canonical `model_id`;
2. `display_name` Fact;
3. `publisher` Fact;
4. `total_parameters` Fact;
5. `active_parameters` Fact;
6. `source_weight_format` Fact;
7. `source_quantization` Fact;
8. `cataloged_provider_count` with its observation time and derivation version; and
9. `last_model_data_refresh` Fact.

Every Fact is copied from the validated canonical Model without inference, fallback, truncation, state rewriting, evidence selection, or provider enrichment. Known, unknown, unavailable, and not-applicable remain distinct. `source_weight_format` is presented as “Source checkpoint weight format,” and `source_quantization` as “Source-provided quantization,” so neither can be mistaken for provider-serving precision. The cataloged-provider count is the only provider-derived card value and keeps its approved active, non-stale, distinct-provider derivation.

The exact search response uses a separate `ExactModelCardCollection` contract. Each item has the exact shape `{match_kind, model}`: `model` is the `ModelCard` projection and `match_kind` is adjacent search-only provenance (`canonical_name|provider_model_id`). Match kind is not part of `ModelCard`, does not change model projection bytes, and is not represented as a Model Fact. Page state retains limit 20 and optional authenticated next cursor. Metadata fixes resource `exact_model_cards`, the exact selected publication, schema version `1.0.0`, sort `relevance,stable_id`, and filter `record_type=model`; the underlying exact operation remains non-semantic.

`FE-022` optional fields are omitted from this compact first projection. Variant identity and family linkage under `FE-024` are also out of scope because this operation admits canonical Models only. Those omissions are explicit and do not convert missing fields into unknown Facts.

### Exact bytes and bounded failure

The query boundary owns the compact projection type; shared API core owns the local-only collection type, hostile-safe validation, and one encoder. This is deliberately not a new public OpenAPI contract. The encoder recursively detaches input through own enumerable data descriptors, reconstructs the sole fixed property order, validates model/result/publication equality, UTF-8 encodes once, and rejects output above 65,536 bytes. The API serves exactly those bytes. The frontend performs bounded streaming, fatal UTF-8 decoding, closed-contract validation, exact publication and metadata checks, then re-encodes and requires byte equality before rendering.

The response never drops evidence IDs, removes a result, shortens a Fact, changes the cursor, or silently lowers the page limit to fit. Any malformed or oversized page is a generic unavailable result. Publication-time card-page admission and remote worst-case load evidence remain required before public routing; this local slice proves the representation and fail-closed ceiling only.

Every query-bearing response stays `private, no-store` and has no ETag or Cache API use. Query, cursor, result, and card data are not logged, traced, measured, persisted, correlated, or copied into browser storage. The signed frontend-to-API request continues to contain only the canonical query, publication pin, and authentication envelope after frontend transient limiting.

### Presentation and neutrality

The server-rendered result item is labeled “Canonical Model” and links only to the stable-ID Model Facts route. Its compact definition list shows every required card field and the exact Fact state, observation time, and evidence references available in the contract. Parameter values retain raw value, normalized decimal, and approximation state. The provider count shows its observation time and derivation version. Source representation labels explicitly distinguish source facts from serving facts.

Provider names, provider model IDs, provider prices, provider-serving precision, Offering facts, affiliate actions, recommendations, winners, quality/value/fidelity claims, and provider-derived order are absent from `ModelCard`. A provider-model-ID match may be described only as adjacent search provenance without naming the provider or entering card content.

For a fixed publication and Model ID, card projection bytes are a pure function of the canonical Model. Provider eligibility, stale eligibility, match class, Offering witness, affiliate state, and input order cannot enter the projector. Provider filters may change membership only. The existing exact-class and stable-ID continuation owns order; no card field is a secondary sort key.

### Closed environments and deferred platform work

The signed card response replaces only Phase 5V's minimal local exact-match representation. Public API search and test, preview, and production live ingress remain closed. No Wrangler binding, secret, route, host, remote identifier, resource, migration, provisioning, publication, or deployment configuration changes in this slice.

The separately approved scheduled-Workflow architecture also remains deferred. The predeployment embargo currently forbids Workflow and data bindings in tracked local Wrangler configuration, the inert preview plan keeps `PublicationWorkflow` unprovisioned with a null schedule, and no successor authority has approved those binding changes. Model-card implementation must not weaken that embargo or present frontend progress as pipeline/deployment readiness.

## Consequences

- Local exact discovery can render contract-complete canonical Model cards without N+1 reads.
- Model cards remain a compact presentation view over canonical Model resources, not another canonical entity.
- The nested `model` projection boundary makes provider/filter invariance byte-comparable independently of match provenance.
- Whole-page byte admission can make an extreme local page unavailable; it never licenses silent evidence or result loss.
- Variant cards, optional fields, public API evolution, remote card-page admission, pipeline Workflow assembly, deployment, and all release gates remain pending.
- Every mapped traceability row remains `Planned`; proposed and later local implementation evidence cannot by itself verify or accept a requirement.

## Alternatives considered

- **Fetch Model detail for every result:** rejected because it adds up to 20 service/D1 reads and introduces avoidable latency and failure amplification.
- **Expand the existing `SearchResult` in place:** rejected because it changes the prelaunch public search contract and mixes a reusable identity result with one presentation-specific projection.
- **Use full `ModelDetail` objects as cards:** rejected because it duplicates optional and checkpoint-heavy content, weakens the compact-card boundary, and makes the page-size ceiling less predictable.
- **Copy Model fields into search-index rows:** rejected because canonical facts would become duplicated projection authority and could drift from the publication resource.
- **Select a primary evidence ID or omit evidence to fit:** rejected because selection would add an unapproved precedence rule and omission would weaken public-fact provenance.
- **Include provider identity for provider-model-ID matches:** rejected because provider identity is forbidden card content and is unnecessary to explain the exact match class.
- **Open preview/production search with the card change:** rejected because protected cursor secrets, recovery, remote abuse/load/privacy evidence, GDPR acceptance, and deployment authority remain absent.

## Validation

- Contract tests cover all Fact states, exact keys, parameter values, derived count, malformed evidence/timestamps, duplicate/additive keys, hostile descriptors/proxies/symbols, and Model/card identity disagreement.
- Projection tests prove exact copying from canonical Models, no inference, fixed order, exact 65,536-byte acceptance and 65,537-byte rejection, no partial-page fallback, and API/frontend byte identity.
- Query/RPC tests prove the enriched result uses already-read canonical bytes, adds zero SQL statements, retains resolver/bookmark/horizon/cursor continuity, and fails closed on canonical/hash/type/publication corruption.
- Neutrality tests permute provider eligibility, stale state, matching Offering witnesses, affiliate inputs, and source order; qualifying membership may change, but the same Model's card bytes and existing result order do not.
- API/security tests retain signed-query tamper, environment closure, byte/header/status, no-cache, no-telemetry, no-retry, and zero-effect rejection evidence.
- SSR/browser tests cover exact-name and provider-model-ID cards, empty/pagination/unavailable states, explicit unknown/unavailable/not-applicable rendering, source-versus-serving labels, stable-ID navigation, hostile-value escaping, keyboard/axe/320-pixel behavior, and absence of scripts, cookies, browser persistence, and third-party requests.
- Full local verification plus independent frontend/accessibility, API/security/privacy, data-neutrality/correctness, and test review gate merge. These reviews approved the local implementation after their statement-parity, fixture-continuity, field-scoped browser-evidence, and filter-invariance findings were incorporated. This acceptance grants no public, remote, provisioning, publication, or deployment authority.
