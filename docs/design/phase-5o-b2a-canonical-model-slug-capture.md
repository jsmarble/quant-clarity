# Phase 5O-B2A: Canonical Model-slug history capture

## Status

Design is accepted under [ADR 0040](../decisions/0040-canonical-model-slug-history-capture.md). Implementation and verification evidence must be recorded only after the migration, acquisition adapter, and applicable repository gates pass. B2A remains a controlled, local pipeline boundary: its capture is not readiness authority, serving schema stays `1.11.0`, and no public route, remote resource, provisioning, or deployment is authorized.

## Slice objective

Replace ADR 0039's arbitrary caller-supplied history boundary with one fixed, primary-anchored acquisition of the exact trusted-manifest Model set while the canonical single-writer drain remains continuously held from manifest/resource assembly through acquisition. Harden canonical Model history so invalid future mutations fail at storage. Return the exact boundary-adjusted rows, canonical current-slug census, unchanged `model-slug@1` roots/counts/mappings, and a private D1 bookmark as a candidate capture for B2B archival.

## Trust and authority boundary

The trusted inputs are:

1. one already validated immutable publication manifest;
2. its exact complete validated canonical Model resources and hashes;
3. a controlled canonical D1 binding; and
4. the publication coordinator's externally enforced continuously held canonical single-writer drain.

The manifest supplies both the exact Model-ID set and the only time boundary through `generatedAt`. The acquisition API does not accept a second Model scope or timestamp. A flag, token-shaped string, or result field cannot prove the coordinator still holds the drain, so the adapter never promotes its result to `ready`.

The result is a **candidate canonical capture**. Its D1 rows and `model-slug@1` roots are authoritative about what the fixed statement observed under the stated coordinator precondition, but are not durable readiness authority. That boundary is crossed only in B2B after an immutable content-addressed private R2 artifact is written and read-verified. B2C must use that artifact for lifecycle and restore; it must not query present-day canonical D1 to reconstruct an old publication.

## Canonical migration contract

The next canonical migration must preflight existing Model-target rows and then install Model-only constraints. The global canonical schema marker stays `1.0.0`; an immutable singleton `model_slug_history_integrity_metadata` row instead advertises the exact capability `model-slug-history-guard@1`. The fixed acquisition statement must reject a missing, duplicate, malformed, or different marker. The migration may add indexes and triggers required to enforce:

- strict 1–128-byte ASCII route grammar;
- `valid_to_ms > valid_from_ms` when closed;
- no interval overlap and no more than one open interval for one Model;
- permanent exact-slug ownership by one Model across all of that Model route history;
- no deletion of Model history;
- no update except one null-to-non-null close with all other fields unchanged; and
- the same overlap, ownership, and grammar checks on insert and close.

Membership is established by `resource_identity.resource_type = 'model'`, not merely an ID prefix. Existing invalid Model history aborts the migration without repair. The migration does not alter the semantics of non-Model history rows. The current `model.slug`/history/publication-resource three-way agreement remains a capture-time invariant.

## Fixed acquisition protocol

The adapter performs this closed sequence:

1. Validate the trusted manifest, exact Model resources, contracts, hashes, IDs, counts, bytes, and sole time boundary before D1 work.
2. Derive the exact sorted manifest Model-ID set; reject duplicate, missing, extra, malformed, or non-Model resource authority.
3. Open one canonical D1 `first-primary` Session.
4. Prepare and execute one fixed bounded statement with validated values bound as data. The SQL text is invariant with respect to IDs and slugs.
5. Validate the exact `model-slug-history-guard@1` capability, requested/canonical Model census, canonical current-slug census, every returned history row, deterministic order, exact source-row count, and overflow detection.
6. Exclude rows beginning after `manifest.generatedAt`; represent an end later than that boundary as null. Preserve all exact canonical identifiers, slug bytes, and starts; perform no normalization, inference, or winner selection.
7. Pass those exact boundary rows and the already validated manifest resources to `model-slug@1`. Verify three-way current-slug agreement among each trusted Model resource, the canonical `model.slug` returned by the same statement, and its boundary-current mapping. Retain both roots, all counts, and sorted mappings unchanged.
8. Obtain the D1 bookmark from the same Session and return it only in the private controlled result.

The fixed statement must make omission detectable within the exact manifest Model scope. A separate count query and data query, per-ID query loop, dynamic SQL interpolation, replica-first session, best-effort partial result, or projection from `model.slug` alone is outside the contract.

## Candidate capture contract

The closed result contains at least:

- capture-format and projection versions;
- publication ID, closure identity needed by later archive binding, and `manifest.generatedAt` boundary;
- exact sorted manifest Model IDs and canonical current-slug census;
- exact boundary-adjusted Model history rows for the manifest Model scope;
- Model, history, mapping, current, and historical counts;
- ADR 0039 source-history and resolved-mapping roots;
- exact sorted `model-slug@1` mappings; and
- the private canonical D1 bookmark.

No field may imply `archived`, `read_verified`, `staged`, `ready`, `active`, or `restorable`. The bookmark is excluded from public contracts and public projection roots. Static bounded failures must not disclose SQL, database internals, a full candidate payload, or the bookmark.

## B2B and B2C handoff

B2B must define the canonical serialization and content-address for a private R2 artifact, write it once, read it back, validate its digest and closed schema, rerun/reconcile the projector, and only then stage exact rows under serving schema `1.12.0`. A retry with identical bytes is idempotent; a different object at the same address is corruption and fails closed.

B2C must extend closure/readiness/switch proof families with the artifact digest plus both ADR 0039 roots and counts, add exact indexed internal lookup, and include the immutable artifact in backup and isolated restore. Canonical capture, R2 archival, serving staging, readiness, and head selection are saga steps. Each step may leave an unreachable immutable candidate for reconciliation, but none may partially replace the active publication.

## Resource, security, and privacy limits

- Preserve ADR 0039's `25,000` Model, `50,000` history-row, `1,000,000`-byte per-resource, `16 MiB` retained-resource, and `8 MiB` per-inventory ceilings.
- Detect an over-limit SQL result with an explicit overflow sentinel; do not rely on truncation.
- Use fixed prepared SQL and validated bound data only. No public input or provider-controlled identifier becomes SQL syntax.
- Keep the canonical binding on the controlled pipeline only. The public API and query Workers receive no canonical D1 or private R2 capability.
- Do not log or export the D1 bookmark, SQL values, complete capture, or raw failure detail.
- Accept no visitor request, path, query, address, cookie, storage key, correlation ID, telemetry, analytics, or click data.

## Failure and retry semantics

- Preflight or migration failure preserves the pre-migration canonical database.
- Any acquisition validation or D1 failure discards the candidate and releases no readiness evidence.
- Loss of the writer drain before acquisition completes invalidates the candidate; restart from manifest/resource assembly.
- An ambiguous acquisition outcome is safe to retry under a fresh continuous drain because B2A performs no serving mutation and no readiness transition.
- B2B archive failure may leave no object or an unreachable object, never an active projection.
- B2C must reconcile later side effects by immutable publication/artifact identities; no cross-D1 rollback fiction is allowed.

## Acceptance matrix

| Requirement evidence | B2A acceptance | Deferred boundary |
|---|---|---|
| `DATA-001`, `BE-002`, `BE-005`, `BE-006` | Model-only grammar, half-open interval, immutability, non-overlap, one-open-row, and permanent ownership migration tests | Remote canonical migration and operational writer evidence |
| `PIPE-044`, `PIPE-050`–`PIPE-052`, `QA-006` | Continuous-drain contract, one-statement candidate acquisition, all-or-nothing validation, no active-head mutation | R2 read verification, serving `1.12.0`, readiness/switch failure injection |
| `PIPE-054`, `PIPE-055`, `BE-010`–`BE-012` | Candidate binds publication/boundary and returns exact history roots plus a private bookmark | Durable artifact, backup, restore, RPO/RTO exercise |
| `API-002`–`API-004`, `BE-007` | No public or internal read claim in B2A | Indexed internal lookup in B2C; HTTP semantics in B3 |
| `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011` | Controlled publication data only; bookmark private; no visitor surface or telemetry | Deployed privacy and infrastructure evidence |
| `QA-001`, `QA-004`, `QA-007` | Unit, migration, pinned-workerd, hostile-result, boundary, deterministic-root, and unchanged-surface checks | Remote capacity/load and full release acceptance |

Every affected traceability row remains at its existing status. B2A is prerequisite evidence, not complete API, pipeline, backup, restore, or release acceptance.

## Explicit non-goals

- private R2 artifact serialization or writes;
- serving schema `1.12.0`, staging, indexes, or proof suffixes;
- readiness, switch, rollback, backup, or restore changes;
- an internal query RPC or exact slug lookup;
- deciding redirect versus direct `200` behavior;
- public Request/Response, CORS, ETag, HEAD/OPTIONS, Cache API, or rate-limit work;
- remote binding configuration, resource provisioning, migration execution, or deployment.
