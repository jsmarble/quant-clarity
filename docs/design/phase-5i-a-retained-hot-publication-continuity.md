# Phase 5I-A: Retained-hot publication continuity

## Status

Local implementation and SQLite/workerd verification complete under [ADR 0031](../decisions/0031-retained-hot-publication-continuity.md). The completed boundary is a local D1 migration, versioned resolver, exact-reader recheck, and storage-free API seam only; it records no public-route, remote-resource, deployment, operational, or release claim.

## Slice objective

Prevent an authenticated Phase 5H-B2 cursor from being stranded by multiple publication switches while preserving zero visitor data, bounded SELECT-only reads, and one-publication page traversal. Derive availability solely from the current head plus append-only switch history.

## Fixed policy

| Concern | Phase 5I-A decision |
|---|---|
| Current head | Active and current rollback-candidate publications are always eligible. |
| Historical authority | Take the later of the latest active-slot departure and latest rollback-slot departure. |
| Departure fields | `from_publication_id` and `expected_prior_rollback_candidate_publication_id`. |
| Retention | Exactly seven days from the latest qualifying `switched_at_ms`. |
| Fresh horizon | `now_ms + 15 minutes`. |
| Cursor horizon | Authenticated original cursor expiry; never renewed. |
| Admission | Historical cutoff must be strictly greater than horizon plus 30-second skew. |
| Arithmetic safety | A retained reference must be nonnegative and no later than D1 time plus the existing five-minute switch guard; compare the reference to `horizon + skew - seven days` to avoid addition overflow. |
| Persistence | No mutable hot inventory, cursor registry, lease, or visitor-adjacent ledger. |
| Serving schema | `1.8.0` with two partial covering history indexes. |
| RPC versions | `resolvePublicationV2` and `readMergedExactSearchV2`; V1 is compatibility-only. |

## Component boundaries

### Serving migration

- Add only the two ADR 0031 partial covering indexes after exact schema/trigger/table preflight.
- Advance the serving schema marker from `1.7.0` to `1.8.0` atomically.
- Preserve all append-only history guards and switch behavior.
- Add forced-plan proof for both equality/descending/one-row probes.

### Query Worker

- Add a closed V2 resolver request with validated audience, environment, publication selection, and `requiredAvailableUntilMs`.
- Resolve active/current rollback without a historical cutoff; otherwise compute the maximum of the two indexed latest-departure probes.
- Require the historical cutoff to be strictly beyond the required horizon plus 30 seconds and return the bookmark from the same first-primary D1 Session. Fail closed unless the retained reference is nonnegative and no later than D1 time plus the existing five-minute switch guard, and use the algebraically equivalent subtraction-form comparison to avoid addition overflow.
- Carry the validated horizon into one V2 merged exact-search call.
- Update every canonical-name, provider-model-ID candidate/target, and provider-name publication sentinel used by the merged operation to recheck the identical active/rollback-or-retained rule on the bookmarked-or-newer snapshot.
- Keep fixed SELECT-only SQL, one composed operation, one Session, and ADR 0030's at-most-four post-resolution SELECT ceiling.

### API Worker seam

- Authenticate and reconcile a cursor before resolver access.
- Use `now + 15 minutes` for a fresh request and the authenticated original expiry for a continuation.
- Call only V2 for this feature and pass the identical horizon to resolver and merged read.
- Preserve generic non-echoing publication and cursor errors, detached hostile-result validation, original cursor expiry, `private, no-store`, and no public Request/Response integration in this slice.

## Acceptance matrix

| Area | Required cases | Expected result |
|---|---|---|
| Migration | clean `1.7.0`, wrong version, missing/changed history columns or guards, either preexisting index | one atomic `1.8.0` migration or static failure with no partial schema |
| Query plans | both departure probes and missing named index | both named covering indexes are forced; a missing index fails closed |
| Head state | active, current rollback, unknown, never-public, ready/failed but never referenced | current pair selects; all other nonhistorical pins fail generically |
| Switch sequence | `A -> B -> C` with A displaced from rollback; each probe newer than the other | latest departure from either slot establishes the sole historical cutoff |
| Boundaries | cutoff `>`, `=`, and `<` horizon plus 30 seconds; one-millisecond edges; unsafe/overflow times | only strict-greater safe-integer case selects |
| Fresh admission | request just inside/outside ability to cover `now + 15m + 30s` | admit only the complete safe horizon |
| Cursor continuation | original expiry inside/outside cutoff, repeated pages, key overlap, near-expiry request | original expiry is preserved; no extra drain or extension |
| Resolver/read recheck | eligibility history changes after resolver and before read; invalid direct-read horizon | same publication remains eligible or the whole page fails closed |
| Compatibility | existing V1 callers and new V2 caller | V1 retains current-pair semantics; V2 alone provides retained-hot continuity |
| Failure | missing index/schema, wrong-target/weakened history guard, corrupt/future history, inconsistent bookmark result, reader disagreement | static integrity/read error; no fall-forward or partial page |
| Privacy | source and artifact scan plus hostile transport objects | no raw token/query/key/request, durable cursor/horizon, DML, cache, log, trace, metric, analytics, telemetry, or correlation ID |

## Local verification evidence

- `packages/canonical/src/migrations.test.ts` proves exact schema-`1.8.0` index shape, clean-version preflight, semantic history-guard rejection, object collisions, atomic failure boundaries, and retryability.
- `apps/pipeline/src/serving-migration-preflight.worker.test.ts` repeats missing, wrong-target, and weakened-body history-guard failures and exact index installation in workerd D1.
- `apps/query/src/catalog-query-rpc.test.ts` proves the closed V2 resolver envelope, generic unavailable result, fixed indexed SELECT, active/current-rollback/retained classification, hostile inputs, and arithmetic postconditions.
- `apps/query/src/exact-readers-schema17.worker.test.ts` proves current rollback, displaced `A -> B -> C` retention, both latest-reference directions, exact cutoff equality and one-millisecond edges, forced plans, missing-index failure, invalid direct-read horizon, eligibility change between resolver and read, and V1 compatibility in real workerd D1.
- `apps/query/src/catalog-merged-exact-query-rpc.test.ts` proves V2 horizon propagation and hostile/malformed direct-call rejection before D1.
- `apps/api/src/merged-exact-search-query.test.ts` proves fresh `now + 15 minutes`, original cursor-expiry preservation, resolver/read horizon equality, cursor authentication/reconciliation, static errors, and no internal-state echo.

## Deferred public and operational acceptance

Local completion does not claim exhaustive lifecycle or traffic chaos. Explicitly deferred are rollback and reactivation sequences including `A -> B -> C -> A`, repeated departures over long histories and equal-time generation tie cases, an actual switch transaction between resolver and read, and pagination at limits 1 and 20 while switches occur. Those remain public/operational acceptance work alongside multi-PoP, load, remote D1, and retained semantic-namespace evidence.

## Requirement handoff and nonclaims

- `API-003`, `API-007`, `API-013`, `API-015`: contributes publication-consistent deterministic cursor selection, bounded errors, and internal version metadata; the public endpoint remains pending.
- `SRCH-007`, `PIPE-044`, `PIPE-050`–`PIPE-054`, `PIPE-056`: contributes an additive schema gate and immutable-history availability proof; deployed D1, semantic namespaces, and operational rollback remain pending.
- `BE-003`, `BE-007`, `BE-008`, `BE-011`: contributes fixed SELECT-only local reads with no provider calls or mutable visitor state; complete backend and restore evidence remain pending.
- `CF-005`, `CF-006`, `CF-020`, `CF-023`: defines versioned, bounded, environment-scoped implementation targets; current remote limits, bindings, and deployed ceilings remain pending.
- `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`: contributes closed bounds and zero-retention acceptance; deployed privacy/security gates remain pending.
- `QA-004`–`QA-006`: defines migration, cursor, switching, publication, and failure-path cases; full public conformance and release evidence remain pending.

No traceability status advances in this slice. It does not claim a public route, Worker binding or secret, preview/production resource, deployment, semantic or Vectorize retained namespace, physical pruning/deletion, operational restore/rollback, multi-PoP continuity, load result, privacy/legal approval, or release readiness.
