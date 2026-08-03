# ADR 0031: Resolve retained-hot publications from immutable head history

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Product owner, staff engineer, API lead, query lead, pipeline lead, security and privacy lead
- Related requirements: `API-003`, `API-007`, `API-013`, `API-015`, `SRCH-007`, `PIPE-044`, `PIPE-050`–`PIPE-054`, `PIPE-056`, `BE-003`, `BE-007`, `BE-008`, `BE-011`, `CF-005`, `CF-006`, `CF-020`, `CF-023`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`–`QA-006`
- Extends: ADRs 0007, 0013, 0015, 0016, 0020, 0023, and 0030

## Context

ADR 0030 authenticates a publication-pinned search cursor but its resolver recognizes only the active publication and current rollback candidate. Multiple head changes inside the cursor lifetime can therefore reject a publication that is still required to be hot. The approved design also says hot publications remain available for seven days, but does not define when that clock starts when a publication moves between the active and rollback-candidate head slots.

The serving database already records every head transition in append-only `publication_switch_history`. A switch row identifies both publications that leave their prior head slots: `from_publication_id` leaves the active slot, and `expected_prior_rollback_candidate_publication_id` leaves the rollback-candidate slot. That immutable history can establish retention without a mutable publication-inventory row, cursor registry, visitor-adjacent ledger, or switch-transaction change.

This decision covers the local retained-hot D1 resolver and exact-reader continuity boundary. It does not expose a public route or establish semantic-index retention, physical pruning, remote-resource, deployment, or release evidence.

The requirement language leaves two implementation details open: the start of the seven-day clock after repeated head-slot movement, and how a near-cutoff fresh page can receive a cursor that remains usable for its authenticated lifetime. This ADR resolves them as latest departure from either head slot and horizon-aware admission. “Exactly seven days” satisfies the approved minimum while preventing an unstated extra drain interval. No product requirement or decision-log amendment is needed.

## Decision

### Retention authority

For a publication that is neither the current active publication nor the current rollback candidate, its latest head-reference event is the later history row, ordered by `(switched_at_ms DESC, new_generation DESC)`, from these two immutable probes:

1. the latest row whose `from_publication_id` equals the publication, meaning it left the active slot; and
2. the latest row whose `expected_prior_rollback_candidate_publication_id` equals the publication, meaning it left the rollback-candidate slot.

The publication's retention cutoff is exactly:

```text
retention_cutoff_ms = latest_head_reference.switched_at_ms + 7 days
```

Leaving either slot restarts the seven-day clock. A later reactivation, rollback, or replacement can therefore establish a later cutoff. The current active publication and current rollback candidate are always eligible and need no history-derived cutoff. A publication with no current head membership and no qualifying immutable history is unavailable; activation time, publication state alone, cursor issuance, and request arrival are not retention authority.

The seven-day policy is an availability rule, not a physical-deletion instruction. ADR 0015's separate pruning decision remains in force.

### Serving schema 1.8.0

Serving schema `1.8.0` adds exactly two partial covering indexes over immutable history:

```sql
CREATE INDEX publication_switch_history_from_retained_hot_idx
ON publication_switch_history(
  from_publication_id,
  switched_at_ms DESC,
  new_generation DESC
)
WHERE from_publication_id IS NOT NULL;

CREATE INDEX publication_switch_history_prior_rollback_retained_hot_idx
ON publication_switch_history(
  expected_prior_rollback_candidate_publication_id,
  switched_at_ms DESC,
  new_generation DESC
)
WHERE expected_prior_rollback_candidate_publication_id IS NOT NULL;
```

The resolver uses both equality probes with descending order and one-row limits. Query-plan evidence must prove the named indexes are used and that no unbounded switch-history scan is accepted. The migration is additive: it does not mutate history, add a hot-inventory table, or alter activation and rollback transactions.

### Horizon-aware resolver V2

`resolvePublicationV2` adds a required safe-integer `requiredAvailableUntilMs`. The API computes it; the query Worker never derives it from a raw request:

- a fresh request uses `now_ms + 15 minutes`; and
- a cursor continuation uses the authenticated cursor's original expiry, converted exactly to milliseconds.

The cursor chain retains its original expiry under ADRs 0016 and 0030. It does not receive a new 15-minute window on continuation.

The resolver selects the current active or rollback-candidate publication unconditionally. Any other requested publication is selected only when its latest retained reference is nonnegative, is no later than D1 time plus the existing five-minute switch guard allowance, and its history-derived cutoff is strictly greater than:

```text
requiredAvailableUntilMs + 30 seconds
```

The strict comparison reserves the accepted clock-skew budget and prevents admitting work at an equality boundary that cannot be guaranteed through the required horizon. SQL evaluates the equivalent overflow-safe form `latest_head_reference_ms > requiredAvailableUntilMs + 30 seconds - 7 days`; it does not add seven days to an untrusted stored timestamp. The nonnegative/future-reference checks are fail-closed implementation safety around the existing switch-time guard, not a change to the retention policy. The API rejects an unavailable, unknown, never-public, or insufficient-horizon pin with the same generic `409 publication_expired` response and current publication header. Malformed pins remain `400 invalid_parameter`; cursor authentication, expiry, and parameter-reconciliation failures remain `400 invalid_cursor` before publication resolution.

The V2 selected result returns the publication, D1 bookmark, and the validated required horizon. The API passes that same `requiredAvailableUntilMs` to `readMergedExactSearchV2`; the merged operation and every exact reader recheck publication eligibility inside their fixed SELECT-only SQL. A selected publication is acceptable at read time only if it is then active/current rollback or its latest history-derived cutoff remains strictly beyond the same horizon plus skew. This closes the switch-between-resolution-and-read race while retaining ADR 0023 bookmark continuity.

No raw cursor, query, request header, HMAC key, or source-address material enters the query Worker. The horizon is transient request-control data, is not visitor identity, and is never persisted, cached, logged, traced, metered, or included in a public response.

### Compatibility and rollout

The schema/index migration lands before V2 callers. Resolver V2 and merged-read V2 are additive closed RPC operations. Resolver V1 remains available only for compatibility with existing local seams and retains its active/current-rollback behavior; no new feature may adopt V1. The later API integration must use V2 for fresh and cursor-pinned search.

Missing schema `1.8.0`, either required index, malformed history, impossible time arithmetic, a changed query plan, publication-integrity failure, or disagreement between resolver and reader is a static fail-closed integrity/read error. It never falls forward to another publication or returns a partial page.

## Consequences

- Authenticated exact-search cursors can traverse multiple activation and rollback switches without mutable visitor state.
- A publication is retained exactly seven days from the latest time it leaves either head slot; current head members remain eligible for as long as they occupy a slot.
- Fresh work is admitted only when its complete maximum cursor lifetime plus skew fits inside the known hot interval.
- Two bounded immutable-history probes replace an ever-growing scan and avoid coupling visitor traffic to publication writes.
- Resolver and reader use the same horizon, so a head switch between them cannot silently mix publications.
- Serving schema `1.8.0`, resolver V2, and merged-reader V2 must ship as one compatible implementation boundary after the additive migration.

## Alternatives considered

- Mutable retained-hot inventory or lease ledger: rejected because switch history already contains the authority and a mutable ledger adds reconciliation, visitor-adjacent state, and write-path coupling.
- A cursor-specific 15-minute drain after seven days: rejected because horizon-aware admission already guarantees the original cursor lifetime; an extra window would extend the approved exact seven-day rule.
- Retain from activation time: rejected because a publication can be reactivated or remain in a head slot long after activation.
- Inspect only `from_publication_id`: rejected because it misses a publication leaving the rollback-candidate slot after a later switch.
- Inspect only the current rollback candidate: rejected because rapid or repeated switches can strand a valid cursor.
- Scan all switch history without indexes: rejected because public query work must remain explicitly bounded.
- Change existing switch transactions to maintain a mutable cutoff: rejected because the two immutable departure facts are already recorded atomically.

## Validation

- Prove schema `1.8.0` migration preflight, both exact index definitions, legacy V1 compatibility, idempotent rejection, and fail-closed missing-index/schema behavior.
- Force each history probe's named index and prove bounded one-row results for long histories, equal timestamps resolved by generation, and no qualifying row.
- Cover activation, rollback, reactivation, rollback-candidate replacement, and repeated `A -> B -> C -> A` sequences; the later departure from either slot must win.
- Cover exact boundaries: current head membership; cutoff strictly greater than horizon plus 30 seconds; equality rejection; one millisecond on either side; negative or more-than-five-minutes-future references; overflow and unsafe inputs.
- Prove fresh requests use `now + 15 minutes`, continuations preserve and use the original cursor expiry, and a cursor never extends its chain.
- Switch between resolution and merged read and prove the page remains wholly on the selected publication or fails closed, with no duplicate, omission, publication change, or lower-tier partial result.
- Prove all exact-reader hot-publication sentinels use the same V2 rule without increasing ADR 0030's post-resolution statement ceiling.
- Scan code and artifacts for a mutable retention ledger, cursor persistence, raw request/cursor/query/key transport, DML in public reads, logging, tracing, metrics, analytics, telemetry, correlation IDs, and visitor-derived durable keys.
- Keep public routing, service bindings, secrets, remote D1, semantic/Vectorize namespace retention, physical pruning, multi-PoP, load, deployment, and release acceptance explicitly unclaimed.
