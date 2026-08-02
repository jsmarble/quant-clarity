# Phase 5E: Search-collection semantic degradation contract

| Attribute | Value |
|---|---|
| Status | Implemented contract slice; public integration and acceptance remain planned |
| Decision | [ADR 0024](../decisions/0024-search-collection-semantic-degradation.md) |
| Requirements | `API-004`, `API-010`, `API-014`, `API-016`, `API-017`, `SRCH-001`, `SRCH-003`, `SRCH-010`, `NFR-006`, `PRIV-006`, `QA-004`, `QA-005` |
| Public route | Unchanged and unavailable |

## Scope

Phase 5E resolves only the empty-result representation blocker identified by Phase 5D. `SearchCollection.meta.semantic_degraded` is required, non-null, bounded, extensible, and authoritative for the complete response. The existing `SearchResult.semantic_degraded` remains a required `/v1` mirror, and producer semantics require every item to equal the collection value.

The four known states are:

| Value | Meaning |
|---|---|
| `none` | The applicable semantic plan completed without degradation. |
| `disabled` | Applicable semantic work was intentionally not attempted under an approved disablement decision; exact/structured discovery is the fallback. |
| `eligibility_limit` | Complete eligibility exceeded the approved bounded semantic plan; no incomplete semantic subset was queried, and exact/structured discovery is the fallback. |
| `temporarily_unavailable` | An applicable semantic dependency failed transiently; partial semantic candidates are discarded and exact/structured discovery is the fallback. |

There is no default. A producer must serialize a state even when `data` is empty. An empty degraded collection means exact/structured fallback completed with no matching records; it does not mean semantic retrieval found no matches. When exact/structured fallback cannot safely complete, the bounded error contract applies instead.

Both the authoritative metadata field and item mirror use one bounded extensible-string definition. Consumers recursively ignore additive unknown fields and tolerate bounded unknown enum values. The prelaunch additive change keeps OpenAPI version `1.0.0`; removing the item mirror or changing meanings remains subject to `API-017`.

## Verification boundary

The contract and generated OpenAPI checks cover:

1. required empty-result state, all four known values, and bounded future values;
2. rejection of missing, null, empty, overlong, or structurally invalid states;
3. rejection of any producer item/collection mismatch;
4. rejection of semantic result items under each known fallback-only state;
5. Unicode-scalar parity between generated JSON Schema and the Worker-safe validator at every bounded free-text field;
6. validation of a human-readable empty `disabled` OpenAPI response example and published `API-016` client compatibility rule; and
7. a generated `private, no-store` query-response header constraint without query, bookmark, request-ID, visitor-key, cookie, persistence, or telemetry response fields.

This evidence is contract-local. Future consumers must still prove that they recursively ignore additive unknown fields; runtime cache/privacy behavior remains a public-integration gate. This slice does not complete `ACT-API-010`, `ACT-API-014`, `SAT-SRCH-001`, `SAT-SRCH-003`, `SAT-SRCH-010`, `PRT-NFR-006`, `PVT-PRIV-006`, `QGA-QA-004`, or `QGA-QA-005`.

## Deferred decisions and non-claims

- Provider-only semantic applicability remains unresolved. Phase 5E does not add `not_applicable`; that state and its acceptance cases require the complete search-composition decision.
- The merged exact/structured/semantic cursor tuple remains unresolved. The Phase 5D RPC stays first-page-only and neither issues nor consumes a public cursor.
- Model, variant, provider-model-ID, alias, prefix/keyword, complete structured-filter, deterministic global tier merge, and semantic retrieval remain incomplete.
- Public semantic processing remains disabled pending `GATE-public-query-ai-privacy`; this slice sends no visitor query to Workers AI, AI Gateway, Vectorize embedding, or another processor.
- The public API request handler remains unchanged and unavailable for catalog search.
- No service binding, remote resource ID, production ceiling, limiter threshold, environment inventory, Cloudflare mutation, deployment, or provisioning is selected or authorized.
- No cookies, browser persistence, application request logs/traces, analytics, beacons, custom telemetry, correlation IDs, click tracking, query retention, or visitor-derived durable cache keys are introduced.
- All linked traceability rows remain `Planned`; no release or deployment gate advances.

## Product status

ADR 0024 and Phase 5E clarify how approved fallback behavior is represented. They do not change a product requirement, amend the PRD, or add a product-owner decision-log entry.
