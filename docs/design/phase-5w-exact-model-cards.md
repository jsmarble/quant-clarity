# Phase 5W: Canonical exact Model cards without N+1 reads

| Attribute | Value |
|---|---|
| Status | Accepted and locally implemented; no public or remote authority |
| Decision | [ADR 0054](../decisions/0054-canonical-model-card-projection.md) |
| Requirements | `FE-020`, `FE-021`, `FE-023`, `FE-025`, `FE-026`, `FE-027`, `SRCH-006`, `API-003`, `API-007`, `API-010`, `API-013`, `BE-007`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-003`, `QA-004`, `QA-005`, `QA-009`, `QA-014` |

## Objective

Replace Phase 5V's deliberately minimal “Exact Model matches” items with compact, evidence-backed canonical Model cards while preserving its signed publication-pinned local request, exact order, pagination, zero-visitor-data posture, and closed remote/public boundaries. The exact readers already load and verify each canonical Model; the slice projects the compact card before those canonical bytes are discarded instead of performing per-result detail reads or carrying the complete Model over RPC.

## Fixed implementation boundary

- Add a dedicated Model-card exact-search RPC that reuses resolver V2, one bookmark, the existing retained horizon, exact tier order, winner suppression, eligibility semantics, and compact continuation.
- Retain the complete canonical Model already parsed by the exact-name or provider-model-ID tier only long enough to project `ModelCard`; carry only that compact projection over RPC. The operation adds zero SQL statements and performs no detail lookup, Cache API call, provider request, or enrichment.
- Keep the existing thin search RPC and `SearchCollection` contract unchanged.
- Add closed local-only `ModelCard` and `ExactModelCardCollection` types. A card contains only stable Model ID, display name, publisher, total and active parameters, source checkpoint weight format, source-provided quantization, cataloged-provider count, and Model-data refresh. The wire item is exactly `{match_kind, model}`, and metadata resource is `exact_model_cards`; no public OpenAPI surface changes.
- Keep match kind adjacent to, but outside, the card. It may explain canonical-name versus provider-model-ID discovery without becoming card content.
- Use one shared exact-byte encoder with fixed key order and a 65,536-byte whole-response ceiling. API bytes and frontend re-encoding must match exactly; malformed or oversized pages fail unavailable without trimming.
- Render every Fact state, observation time, and evidence reference. Source representation must never be labeled as provider-serving precision.
- For one publication and Model ID, card bytes depend only on the canonical Model. Provider/stale filters and Offering/affiliate permutations may change membership only and cannot change card facts or order.
- Keep query responses `private, no-store` with no ETag, Cache API, analytics, logging, tracing, request correlation, persistence, browser storage, or retry.
- Keep public API search and test/preview/production live ingress closed. Add no Wrangler, secret, route, resource, migration, provisioning, publication, or deployment configuration.

## Contract projection

| Card field | Canonical authority | Presentation constraint |
|---|---|---|
| Stable Model ID | `Model.model_id` | Canonical route identity, not a publisher Fact |
| Display name | `Model.display_name` | Exact Fact state/evidence/time |
| Publisher | `Model.publisher` | Source publisher only |
| Total parameters | `Model.total_parameters` | Preserve raw, normalized, and approximation values |
| Active parameters | `Model.active_parameters` | Preserve raw, normalized, and approximation values |
| Source checkpoint weight format | `Model.source_weight_format` | Explicitly not serving precision |
| Source-provided quantization | `Model.source_quantization` | Explicitly not provider quantization |
| Cataloged-provider count | `Model.cataloged_provider_count` | Sole provider-derived summary; preserve time/version |
| Last Model-data refresh | `Model.last_model_data_refresh` | Exact Fact state/evidence/time |

Optional `FE-022` fields are omitted from this first compact contract. Variant cards and canonical-family links under `FE-024` remain a separate later slice.

## Acceptance matrix

| Case | Required local result |
|---|---|
| Exact canonical Model name | One or more complete canonical Model cards in existing exact order |
| Exact provider model ID resolving to a Model | Complete Model card; adjacent match provenance contains no provider identity |
| Empty exact page | Existing accessible empty/reset state |
| Valid next cursor | Next card page on the cursor-selected publication |
| Same Model under changed provider/stale eligibility | Byte-identical nested `model` projection when still eligible; membership-only change otherwise |
| Canonical/hash/type/publication/card mismatch | Generic unavailable; no partial result |
| Encoded page of 65,536 bytes | Accepted exactly |
| Encoded page of 65,537 bytes | Generic unavailable; no trimming or lower implicit limit |
| Any preview/production or public API attempt | Existing fixed closure with no card query effect |

## Local verification evidence

- Focused contract/projector/encoder tests cover hostile objects and the exact byte boundaries.
- Query and actual-workerd tests exercise canonical-name and provider-model-ID card reads, compare their real-D1 statement arrays with the equivalent generic reads, and prove zero extra SQL.
- Provider, stale-witness, affiliate, Offering, and input-order tests prove membership-only effects and byte-stable surviving Model projections.
- API/frontend tests enforce strict bytes, publication, status, header, timeout, ordering, cursor, and failure admission.
- Three-Worker browser coverage proves semantic cards, field-scoped Fact states and provenance, pagination, stable-ID continuity, escaping, accessibility, 320-pixel reflow, and zero browser storage or third-party requests.
- Independent correctness/data-neutrality, security/privacy, and frontend/accessibility reviewers approved the corrected implementation. The repository gate is required on the final tree before merge.

## Non-claims and deferred work

This phase does not complete Variant cards, `FE-022` optional fields, aliases, prefix/keyword/semantic search, complete filters, public API search, remote cursor rotation, recovery acceptance, publication-time worst-page admission, controlled load, manual/deployed accessibility, GDPR owner acceptance, provisioning, deployment, or any release gate.

`PublicationWorkflow` also remains deferred. The repository embargo currently forbids a Workflow binding in local Wrangler configuration, and the inert preview plan keeps the reserved Workflow unprovisioned and unscheduled. This frontend slice neither changes that authority nor claims pipeline readiness.

Every mapped traceability row remains `Planned`. This completed local implementation supplies prerequisite evidence only; it does not verify, accept, or release any requirement.
