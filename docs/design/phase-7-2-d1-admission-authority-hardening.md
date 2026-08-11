# Phase 7.2-D1: Admission authority monotonicity hardening

| Attribute | Value |
|---|---|
| Status | Locally implemented; rejection activation, bindings, remote migration, runtime activation, and deployment remain prohibited |
| Decision | [ADR 0062](../decisions/0062-admission-authority-monotonicity.md) |
| Requirements | `PIPE-001`–`PIPE-004`, `BE-003`–`BE-006`, `QA-006` |

## Objective

Remove two blockers discovered during atomic-admission design review without
activating the resolver: distinguish true plan absence from existing invalid
identity, and prevent late backdated revocation from contradicting an
immutable admitted firing.

## Implementation boundary

- the fixed run-plan header query reads by ID only with left-joined closure;
- canonical migration `0007_admitted_plan_revocation_history.sql` preflights
  exact predecessor state and adds one append guard;
- SQLite, resolver, and actual workerd/D1 tests cover wrong hash, incomplete
  identity, migration collision/rollback, historical contradiction, and late
  revocation refusal; and
- documentation records that all rejection writes remain fail-closed.

## Acceptance evidence

1. a truly absent plan ID remains `plan_not_found`;
2. an existing ID with a wrong hash or incomplete closure is invalid, not
   unavailable;
3. migration installation is atomic, collision-safe, and refuses existing
   admitted/revocation contradiction;
4. revocation effective at an admitted scheduled instant is rejected while a
   later effective instant remains valid;
5. actual workerd/D1 exercises the new query and trigger; and
6. the full repository verification gate passes.

## Explicit non-goals

No admission-rejection write, reason precedence, protected runtime resolver,
replay, retained-head resolver, source effect, binding, schedule, public route,
remote migration, resource provisioning, telemetry, or deployment belongs to
this slice.
