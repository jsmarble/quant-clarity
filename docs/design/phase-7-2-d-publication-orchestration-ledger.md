# Phase 7.2-D: Additive publication orchestration ledger

| Attribute | Value |
|---|---|
| Status | Locally implemented and verified with admission-rejection, replay, retention, and source-effect activation blockers; no binding, remote migration, runtime activation, or deployment authority |
| Decision | [ADR 0061](../decisions/0061-additive-publication-orchestration-ledger.md) |
| Requirements | `PIPE-001`–`PIPE-008`, `PIPE-019`, `PIPE-037`, `PIPE-043`–`PIPE-045`, `BE-003`–`BE-006`, `CF-005`–`CF-007`, `OPS-001`–`OPS-007`, `QA-006`, `SM-01` |

## Objective

Encode ADR 0060 in additive canonical D1 state and a fixed prepared-statement
adapter. Prove exact idempotency, atomic rollback, response-loss
reconciliation, fail-closed replay scaffolding, cross-occurrence fencing,
honest source-free terminal outcomes, roster closure, budget reservation, and
sealed reports in SQLite and actual workerd/D1 without activating the Workflow.

## Planned implementation boundary

- `migrations/canonical/0006_publication_orchestration_ledger.sql`
- `packages/canonical/src/publication-orchestration-ledger-migration.test.ts`
- `apps/pipeline/src/publication-orchestration-ledger.ts`
- focused adapter unit tests and actual workerd/D1 integration tests
- ADR/design/index/traceability updates

The adapter exposes closed operations for budget-state reads, admitted initial
run persistence, Provider claim, bounded roster-outcome persistence, Provider
terminal/release, and terminal run report closure. Rejected-firing and replay
shapes remain in the contract/schema, but both adapter and D1 activation fail
closed until atomic admission and protected replay resolvers exist. Each active
operation reconciles only its deterministic complete closure through a fresh
`first-primary` session.

The retained-publication table is shape-only dormant schema in this slice.
Its insert blocker remains active because no fixed serving-head resolver yet
exists; the adapter exposes no retained-authority writer, and carried-forward
or `retain_current` closure fails closed.

## Acceptance evidence

The slice is complete only when tests prove:

1. exact predecessor/collision migration guards and all-or-nothing install;
2. immutable occurrences, dormant rejection/replay shapes, parallel
   attempt-1 run/Provider authority,
   reservations, claims/releases, roster outcomes, terminals, and reports;
3. quiescent cutover with no pending/running legacy owner, followed by a
   fail-closed legacy provenance/fact append boundary;
4. fail-closed rejection activation with no D1 mutation until an atomic
   resolver exists, while the dormant schema preserves rejection/run mutual
   exclusion;
5. deterministic occurrence/run/Provider identities, exact attempt-1
   plan/source binding at scheduled time, and fail-closed replay activation
   until protected adjacent replay authority and fresh attempt timing exist;
6. atomic monthly reservation against the exact breaker/snapshot;
7. one active Provider owner across occurrences, no expiry takeover, monotone
   generation, delayed claim after prior release, stale-owner refusal, and
   terminal-before-release;
8. complete frozen-roster closure without synthetic evidence;
9. terminal Provider/report cost and state closure against admission ceilings,
   plus fail-closed retained-authority insertion until the serving-head
   resolver exists;
10. exact idempotent duplicate behavior, all-statement rollback, lost-response
   reconciliation, absence retry, and mismatch/partial permanent failure;
11. closed error surfaces and privacy canaries that cannot enter persistence;
12. focused format, lint, type, SQLite, and workerd tests; and
13. the full repository verification gate.

Source acquisition is deliberately not executable after this slice. The
legacy provenance graph remains unchanged and receives no new run rows after
environment initialization; a later provenance-v2 migration must bind actual
acquisition, evidence, and canonical effects to the current Provider fence.

## Explicit non-goals

No tracked Wrangler binding or schedule, generated binding type, source access,
Workflow execution, child Workflow, operator replay endpoint, remote database,
migration execution, telemetry, secret, route, GitHub environment, Cloudflare
resource, preview deployment, or production deployment belongs to this slice.
