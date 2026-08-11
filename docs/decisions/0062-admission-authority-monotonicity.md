# ADR 0062: Preserve publication admission authority monotonicity

- Status: Accepted for local implementation; admission-rejection activation, remote migration, and deployment prohibited
- Date: 2026-08-11
- Decision owners: Staff engineer, pipeline lead, data-integrity lead, security/privacy lead
- Related requirements: `PIPE-001`–`PIPE-004`, `BE-003`–`BE-006`, `QA-006`
- Extends: ADRs 0059 and 0061
- Supersedes: None

## Context

The Phase 7.2-B resolver selected an approved plan header by both requested ID
and requested hash. An existing ID with the wrong hash, or an existing but
incomplete plan, therefore produced the same `plan_not_found` result as a
truly absent ID. That distinction must be closed before a future resolver can
make `plan_unavailable` durable.

The additive Phase 7.2-D ledger also validates revocation at the canonical
scheduled instant when admitting attempt 1. Revocation is append-only, but its
effective instant could previously be backdated at or before an already
admitted firing. A later read would then contradict the immutable admission
receipt.

## Decision

The run-plan header query selects by exact run-plan ID only and uses left joins
for seal, approval, and revocation. No row now means exactly that the requested
ID is absent. An existing ID with a wrong requested hash, missing seal, missing
approval, or malformed closure reaches the existing closed invalid/error
classification instead of becoming `plan_not_found`. The resolver still
recomputes and verifies every cryptographic closure before authorization.

Additive canonical migration
`0007_admitted_plan_revocation_history.sql` requires the exact Phase 7.2-D
predecessor and refuses installation over already contradictory history. Its
new insert guard rejects a revocation whose effective instant is at or before
an already resolved exact scheduled occurrence for that plan. Resolved means
an immutable attempt-1 run or admission-rejection row; exact means the
occurrence's requested ID and hash equal the canonical plan. A revocation
effective after every prior resolved occurrence remains permitted and the
existing admission guard applies it to later firings.

The unconditional admission-rejection activation blocker remains installed.
The nominal in-process rejected decision remains insufficient persistence
authority. A future atomic resolver must independently derive a single reason
from current D1 authority, define multi-fault precedence and protected runtime
inputs, and make negative plan facts monotone before enabling any rejection
write.

## Consequences

- `plan_not_found` is no longer a hash-mismatch or incomplete-plan result.
- Later authority cannot rewrite the scheduled-time revocation truth of an
  immutable admission.
- Migration preflight exposes existing contradictory history instead of
  blessing it.
- No schedule, binding, route, source call, replay, rejection receipt, remote
  migration, resource, telemetry, or deployment is activated.
- Requirement statuses remain unchanged because this is local prerequisite
  evidence only.

## Rejected alternatives

- **Enable only `plan_unavailable` rejection persistence:** rejected because a
  negative lookup is not monotone until later plan creation/completion and
  admitted-versus-rejected race semantics are fully closed.
- **Continue filtering the header by hash:** rejected because it converts an
  existing but mismatched identity into false absence.
- **Permit retroactive revocation and reinterpret old admission receipts:**
  rejected because immutable authority cannot change meaning after commit.
- **Edit migration 0006:** rejected because forward-only migration history is
  part of the audit boundary.
