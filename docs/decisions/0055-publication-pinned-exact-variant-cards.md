# ADR 0055: Add publication-pinned local exact Variant cards

- Status: Accepted; local implementation complete
- Date: 2026-08-11
- Decision owners: Staff engineer, frontend lead, API lead, data-neutrality reviewer
- Related requirements: `DATA-003`, `DATA-005`–`DATA-008`, `DATA-010`–`DATA-015`, `RULE-002`–`RULE-004`, `FE-020`–`FE-027`, `SRCH-002`, `SRCH-006`, `SRCH-008`–`SRCH-010`, `API-003`–`API-005`, `API-007`, `API-009`–`API-013`, `API-016`, `BE-007`–`BE-009`, `SEC-001`, `SEC-005`, `SEC-007`, `SEC-008`, `SEC-011`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-003`–`QA-005`, `QA-007`, `QA-009`, `QA-010`
- Extends: ADRs 0011, 0012, 0013, 0030, 0031, 0033, 0034, 0037, 0051, 0053, and 0054

## Context

The generic exact-search operation already retrieves canonical Models and explicit Variants by exact canonical name or exact provider model ID. Both target readers validate the complete canonical resource, its stored content hash, publication membership, status, identity, family relationship, and any applicable active Offering witness before emitting a thin exact result. Phase 5W retains the already-read canonical Model long enough to project a compact Model card with zero extra SQL, but deliberately rejects Variant scope.

The PRD requires explicit Variants to remain distinct, visibly differentiated, and linked to their canonical family without inheriting canonical Model facts. A Variant-detail slug lifecycle does not yet exist, so inventing a Variant detail URL would create false routing authority. The safe next boundary is a dedicated local exact-Variant discovery surface whose cards are derived only from verified canonical Variant bytes and whose canonical-Model relationship uses the existing structural `model_id`.

Provider-offering comparison remains the higher-value subsequent product journey, but it is not safe to assemble from the existing search witness alone. Complete Offering-to-Provider/target, Price, PrecisionObservation, and EvidenceSummary closure plus a deterministic current-comparison selection policy must precede public comparison facts.

## Decision

### Canonical Variant projection

Add a closed `VariantCard` presentation view containing only:

1. canonical `variant_id`;
2. structural canonical `model_id` and `family_id`;
3. `display_name` Fact;
4. `variant_kind` Fact;
5. `publisher` Fact;
6. `total_parameters` Fact;
7. `active_parameters` Fact;
8. `source_weight_format` Fact;
9. `source_quantization` Fact;
10. `cataloged_provider_count` with observation time and derivation version; and
11. `last_model_data_refresh` Fact.

Every Fact is copied from the exact verified Variant. The projector accepts no Model, Provider, Offering, Price, PrecisionObservation, affiliate, search-score, or ordering input. It never fills a Variant field from its canonical Model. The structural `model_id` supplies the stable existing link to canonical Model Facts, while `family_id` is displayed as relationship identity without inventing a family route.

The exact readers attach the projection internally only after complete Variant validation. The generic exact result remains byte-for-shape unchanged. A dedicated Model-inapplicable operation requires `record_type=variant`, maps only exact canonical-name or provider-model-ID results, and executes exactly the same SQL statements as the equivalent generic Variant search. Missing or mismatched canonical attachment fails the whole page integrity check; it never falls back to Model facts or a partial card.

### Dedicated signed representation

Use a dedicated local/test-only query RPC `readExactVariantCardSearchV1` and signed internal API path `/v1/variant-search`. The canonical query fixes NFC-trimmed `q`, `record_type=variant`, limit 20, and an optional authenticated compact cursor. It reuses resolver V2, one bookmark, retained-hot availability, exact-tier ordering, winner suppression, and the explicit results-publication pin, but uses a purpose-separated cursor key and representation contract.

The exact wire item is `{match_kind, variant}`. Metadata fixes resource `exact_variant_cards`, schema `1.0.0`, sort `relevance,stable_id`, and filter `record_type=variant`. One hostile-safe encoder reconstructs the fixed property order and rejects a complete response above 65,536 UTF-8 bytes. It never trims facts, evidence, or results to fit. The frontend performs bounded streaming, fatal UTF-8 decoding, exact closed-contract validation, publication checking, re-encoding, and byte equality before rendering.

Authentication and cursor reconciliation occur before any request-derived limiter, resolver, query, cache, or other data capability. Every query-bearing response is `private, no-store` with no ETag, Cache API, request log, trace, metric, correlation ID, retry, cookie, browser persistence, analytics, or third-party request. Preview and production ingress remain fixed closed.

### Presentation

Add an SSR `/variants` exact-discovery page. Cards are labeled “Explicit variant,” preserve every Fact state, observation time, and evidence reference, show their structural family ID, and link “Canonical Model Facts” to `/models/{model_id}`. The Variant title is not linked because no Variant-detail route is authoritative. Source weight and quantization labels explicitly describe source representation, never provider-serving precision.

Provider names, provider IDs, provider prices, serving precision, Offering facts, affiliate actions, winners, recommendations, quality/value claims, and provider-derived ordering are absent. The cataloged-provider count remains the sole allowed provider-derived summary. Provider/stale filters may alter membership only; the same Variant projection bytes and exact result order remain unchanged when the Variant still qualifies.

The page remains usable as raw HTML without JavaScript and includes accessible empty, invalid, unavailable, pagination, keyboard, focus, 320-pixel, zoom, and zero-storage states. Model discovery remains unchanged.

### Authority boundary

This phase creates no public OpenAPI route, Variant detail route, family route, Offering comparison, Offering Facts view, prefix/keyword/semantic search, remote binding, Wrangler overlay, resource, migration, source access, provision, publication, or deployment authority. All mapped traceability rows remain `Planned`.

## Consequences

- Exact discovery can now preserve explicit Variant identity instead of hiding it behind Model-only cards.
- Canonical family navigation becomes useful before a separate Variant slug/detail lifecycle exists.
- The implementation reuses canonical bytes already required for exact eligibility, so it adds no D1 statement or N+1 detail read.
- The separate contract and cursor purpose prevent Model/Variant representation confusion.
- Offering comparison still requires canonical relationship closure and current-value policy before implementation.

## Alternatives considered

- **Treat a Variant as a Model card:** rejected because structural identifiers and variant-specific facts differ, and it could hide the explicit selectable precision identity.
- **Fill missing Variant facts from the canonical Model:** rejected because the PRD requires Variant facts for that page/card and forbids unsupported inference.
- **Link to `/variants/{slug}` now:** rejected because Variant slug history, retained-hot resolution, recovery, redirects, and route authority are not implemented.
- **Implement provider-offering comparison directly from search projection rows:** rejected because the search witness does not establish complete Price, PrecisionObservation, EvidenceSummary, or current-value authority.
- **Open public/remote search with this change:** rejected because remote admission, release gates, and deployment authority remain pending.

## Validation

- Projector tests cover exact keys, all Fact states, structural identities, detachment, and rejection of Model/provider/Offering/affiliate contamination.
- Unit and actual-workerd tests cover canonical-name and provider-model-ID Variant cards, generic/card SQL statement identity, cursor/order/publication continuity, corruption, and zero extra reads.
- Encoder/API/frontend tests cover hostile objects, exact bytes, identity disagreement, duplicate/order/cursor failures, 65,536/65,537-byte boundaries, signed ingress, environment closure, and zero visitor state.
- Browser tests cover raw SSR, explicit differentiation, canonical Model link, Fact provenance, empty/invalid/unavailable/pagination states, hostile escaping, keyboard, axe, 320-pixel/zoom behavior, and absence of scripts, storage, cookies, and third-party requests.
- Full repository verification and independent correctness/data-neutrality, security/privacy, and frontend/accessibility review are required before acceptance.
