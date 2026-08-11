# Phase 5X: Publication-pinned exact Variant cards

| Attribute | Value |
|---|---|
| Status | Locally implemented and verified; no public or remote authority |
| Decision | [ADR 0055](../decisions/0055-publication-pinned-exact-variant-cards.md) |
| Requirements | `DATA-003`, `DATA-005`–`DATA-008`, `DATA-010`–`DATA-015`, `RULE-002`–`RULE-004`, `FE-020`–`FE-027`, `SRCH-002`, `SRCH-006`, `SRCH-008`–`SRCH-010`, `API-003`–`API-005`, `API-007`, `API-009`–`API-013`, `API-016`, `BE-007`–`BE-009`, `SEC-001`, `SEC-005`, `SEC-007`, `SEC-008`, `SEC-011`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-003`–`QA-005`, `QA-007`, `QA-009`, `QA-010` |

## Objective

Extend exact local discovery to explicit Variants while preserving their own canonical facts and structural relationship to a canonical Model. Reuse the complete Variant already read and verified by exact tiers, add zero SQL, and keep Model discovery, public API contracts, remote environments, and deployment closed.

## Fixed boundary

- Dedicated `VariantCard` projection and `ExactVariantCardCollection`; never widen Model cards or generic search results.
- Card fields: Variant ID, canonical Model ID, family ID, display name, variant kind, publisher, total/active parameters, source weight format, source quantization, cataloged-provider count, and Variant data refresh.
- No fact inheritance from the canonical Model and no provider/Offering/price/serving-precision/affiliate inputs.
- Exact canonical-name and provider-model-ID target classes only, fixed `record_type=variant`, limit 20, existing exact ordering, one resolver bookmark, retained-hot horizon, and compact cursor with a distinct purpose/key.
- Query RPC `readExactVariantCardSearchV1`; internal signed local/test path `/v1/variant-search`; exact item `{match_kind, variant}`; metadata resource `exact_variant_cards`.
- Fixed-order hostile-safe encoding with a 65,536-byte whole-page ceiling and no trimming.
- SSR `/variants` page with explicit Variant labeling, structural family identity, canonical Model Facts link, source labels, visible Fact states/evidence/times, and no invented Variant detail link.
- Every query response remains `private, no-store`; no ETag, Cache API, telemetry, log, trace, cookie, storage, third-party request, or retry.
- Test, preview, and production live ingress remain closed. No configuration, migration, resource, provisioning, publication, or deployment changes.

## Acceptance matrix

| Case | Required local result |
|---|---|
| Exact canonical Variant name | Complete explicit Variant card from that canonical Variant |
| Exact provider model ID targeting a Variant | Same canonical Variant card with adjacent provider-model-ID match provenance only |
| Canonical Model result | Ineligible for the Variant-card operation |
| Variant with unavailable/unknown/not-applicable Fact | Exact state remains visible; no Model fallback |
| Canonical Model relationship | Stable link to `/models/{model_id}` and visible `family_id`; no invented family/Variant route |
| Provider/stale/Offering/affiliate permutation | Membership may change; surviving Variant bytes and existing order do not |
| Corrupt hash/identity/family/type/attachment | Entire page unavailable; no partial result |
| Encoded 65,536 bytes | Accepted exactly |
| Encoded 65,537 bytes | Rejected without trimming |
| Preview/production or public API attempt | Existing fixed closure; no Variant query effect |

## Verification target

- projector and encoder contract/property tests;
- actual-workerd canonical-name/provider-model-ID paths and statement parity;
- hostile RPC/API/frontend admission and signed pre-auth capability ordering;
- browser raw-HTML, state, pagination, stable Model link, escaping, accessibility, zoom/reflow, and zero-storage/network checks;
- full repository verification; and
- independent correctness/data-neutrality, security/privacy, and frontend/accessibility review.

## Deferred work

Variant detail/slug history, Model/Variant bidirectional detail navigation, Offering comparison, Offering Facts, full filters/sorts, prefix/keyword/semantic search, public API routing, publication-time remote worst-page admission, source/provider data, remote configuration, deployment, and release acceptance remain pending.

Provider-offering comparison must not use the existing provider-model-ID search witness as fact authority. Its prerequisite sequence is complete Offering/Provider/target/Price/PrecisionObservation/EvidenceSummary relationship closure and bounded capacity, then an accepted deterministic current-comparison projection policy, then neutral collection transport and presentation.

Every mapped traceability row remains `Planned`; this local slice can supply prerequisite evidence only.
