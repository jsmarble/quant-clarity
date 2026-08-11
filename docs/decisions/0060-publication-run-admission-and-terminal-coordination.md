# ADR 0060: Define publication run admission and terminal coordination

- Status: Accepted; local runtime-neutral implementation fully verified
- Date: 2026-08-11
- Decision owners: Product owner, staff engineer, pipeline lead, platform lead, legal/source owner
- Related requirements: `PIPE-001`–`PIPE-008`, `PIPE-019`, `PIPE-037`, `PIPE-043`–`PIPE-045`, `BE-003`–`BE-006`, `CF-005`–`CF-007`, `OPS-007`, `SM-01`
- Extends: ADRs 0006, 0014, 0058, and 0059
- Supersedes: None

## Context

ADR 0059 intentionally forbids run-ledger writes until admission, replay,
deadline, same-Provider concurrency, terminal status, reporting, production
schedule hardening, and ambiguous-write reconciliation have one coherent
meaning. These choices cannot be made independently. In particular, the
existing canonical ledger cannot truthfully record a timeout before source
evidence exists, and its run status vocabulary does not distinguish a
publishable partial refresh from a failed refresh.

This decision closes the runtime-neutral contract. It does not alter the
canonical schema or activate the dormant Workflow. A successor migration must
encode this contract and prove it with SQLite and workerd before any operational
run row may be written.

## Decision

### Scheduled admission and duplicate delivery

Only the exact scheduled-event shape accepted by ADR 0058 may request
admission. Plan ID/hash, environment, canonical-schema version, pipeline
contract version, and policy identities are protected configuration; they never
come from the event payload, Workflow instance ID, or public input.

The deterministic schedule occurrence is distinct from an admitted run. Exact
plan resolution produces one of two closed results:

- `admitted`: run attempt 1 may be created from the exact resolved authority;
- `rejected`: the firing receives an immutable admission receipt and report,
  but creates no `pipeline_run`.

Rejection reasons are closed machine codes: plan absent, invalid, ineffective,
revoked, source authority invalid, runtime version mismatch, policy mismatch,
budget exceeded, expensive-work breaker, or deadline elapsed. Invalid platform
event shape, Workflow name, cron, or scheduled instant fails before durable
admission. A rejected firing is not a run for `PIPE-003`; inventing an empty
run would misstate its Provider scope and execution history.

Duplicate platform delivery resolves the same occurrence, admission receipt,
run, and Provider identities. It exact-compares all protected fields and then
resumes or no-ops. It never creates attempt 2. No path selects the latest plan,
occurrence, attempt, or report.

### Explicit replay

Workflow engine retry, cached-step replay, and instance restart remain the same
domain attempt. Domain attempt `N + 1` requires a protected operator replay
authorization that names the exact terminal adjacent attempt `N`, the same
occurrence, and the same plan identity/hash. Gaps, branching, cross-occurrence
links, plan changes, and replays of nonterminal or successful attempts are
rejected. This phase defines no operator endpoint and grants no replay
capability.

### Executable policy authority and deadline

The three plan policy references identify typed, canonical policy artifacts:

- `run_budget@1` fixes the accepted USD 25 monthly control target, 50%/75%
  alerts, the 100% expensive-work breaker, a 16-Provider maximum, summation of
  the six per-Provider plan ceilings, and rejection before work on overflow.
  The summed run ceilings are 10,000 requests, 750,000,000 bytes, 1,000,000 AI
  tokens, 7,200,000 browser milliseconds, 172,800,000 summed Provider elapsed
  milliseconds, and 25,000,000 micro-USD;
- `provider-retry@1` fixes four total attempts, 1-second base delay, 8-second
  maximum exponential backoff, 500-millisecond Provider minimum delay,
  5-minute maximum accepted `Retry-After`, and Provider quarantine for a
  permanent error; and
- `terminal-deadline@1` fixes the scheduled-time anchor, 12-hour duration, and
  blocked publication after elapsed time.

The resolver recomputes each domain-separated artifact hash and rejects unknown
fields, noncanonical order, unsafe integers, role/version/hash mismatch, or an
unsupported contract version. Policy values are never supplied by a scheduled
event.

Admission consumes the complete Phase 7.2-B authority projection, exact-matches
its scheduled instant and protected runtime versions, safely sums all six
Provider ceilings, and binds the existing Phase 7.2-B Provider-scope and policy-
set hash encodings. Non-visitor monthly used and reserved cost plus the static
breaker state are protected control-plane inputs. Overflow, projected cost above
USD 25, or a tripped breaker rejects before a run; crossing 50% or 75% returns a
closed non-visitor alert threshold.

`deadline_at` is immutable and equals canonical `scheduled_at` plus the sealed
deadline duration. Delayed delivery never receives a fresh window. Admission
at or after the deadline is rejected. At the deadline, no new Provider work or
retry may start. Durable fencing must precede best-effort Workflow termination;
Workflow status is not terminal authority.

### Same-Provider concurrency and fencing

Execution exclusion is keyed by `(environment, provider_id)`, across schedule
occurrences. The exact same Provider-run identity resumes or no-ops. A distinct
Provider run waits only within its parent deadline.

Future persistence must atomically grant one active claim with a monotonically
increasing fencing generation. Lease expiry alone never authorizes takeover.
Takeover requires exact reconciliation of the prior owner followed by an atomic
generation advance. Every source-effect receipt and canonical mutation must
verify the current generation in the same transaction, so a late Workflow
cannot commit after losing its claim.

### Terminal mapping and publication disposition

Provider terminal mapping is exact: runtime-neutral `ready` maps to durable
`succeeded`, while `failed` and `quarantined` retain their names. Run outcome
and publication disposition are separate:

| Provider result | Run outcome | Publication disposition |
|---|---|---|
| Every Provider ready | `succeeded` | `publish_new` |
| At least one new ready slice and at least one Provider failure | `completed_with_provider_failures` | `publish_new` |
| No new slice, but a complete current publication can be retained | `completed_with_provider_failures` | `retain_current` |
| No usable complete publication | `failed` | `blocked` |
| Run-wide integrity quarantine | `quarantined` | `blocked` |

Last-known-good data permits continuity; it does not turn a failed refresh into
new publication work. `retain_current` must not create a byte-identical
publication merely to advance an identifier. A replacement may be composed
only after every expected Provider and every frozen roster item has a terminal
machine outcome.

The existing canonical `roster_outcome.evidence_id` cannot honestly represent
pre-acquisition timeout, admission, or lock failure. The successor migration
must add separate immutable operational terminal evidence; it must never invent
canonical source evidence.

### Closed report contract

`publication-run-report@2` is a sealed tagged union:

- admission rejection: schedule, occurrence, protected plan request, rejection
  reason, observed time, and report hash; or
- admitted terminal run: schedule and actual times, occurrence/run/attempt and
  optional replay authority, exact plan/environment/runtime versions, deadline,
exact sorted Provider scope, run outcome, publication disposition, aggregate
  six-field cost, closed top-level errors, and exact per-Provider versions,
  terminal state, roster closure, disposition, six-field cost, and errors.

The terminal builder accepts the immutable admitted-firing authority rather
than caller-supplied plan, environment, runtime, scope, or Provider-version
fields. It derives those report fields from that authority, derives the exact
protected Git revision and replay metadata from the initial/replay run
authority, accepts only canonical operational identifier grammars, and
derives all top-level terminal codes from validated run and Provider state. A
ready Provider cannot carry a terminal error code or exceed any admitted cost
ceiling. Terminal report verification requires the exact admitted authority
and initial/replay run authority and re-applies the same cost ceilings; the
SHA-256 seal alone is integrity framing, not authentication.

Provider run identities use `pvr_`; selected publication Provider-slice
identities use the separately registered `prn_` grammar. Any carried-forward
slice additionally requires a `retained-publication-head@1` authority naming
the same environment, current publication ID, and closure hash. A slice ID by
itself is not proof that the current publication is complete. The structural
authority becomes trusted only when a fixed serving-head resolver mints it in
the same runtime; arbitrary serialized objects are never authority.

The canonical encoding is bounded, key-ordered, and domain-separated before
SHA-256 hashing. Reports contain no raw exceptions, stacks, source bodies,
credentials, URLs, headers, addresses, queries, cookies, user agents,
referrers, public request identifiers, or arbitrary strings. Durable D1 state,
not Workflow retention or logging, will be report authority.

Malformed event, payload, Workflow, cron, or scheduled-time envelopes stop
before durable admission. Their in-memory rejection codes cannot create an
occurrence or durable rejected-firing receipt. Only the exported closed
post-envelope durable rejection subset may be persisted.

### Ambiguous D1 outcomes

The future write adapter will use fixed prepared statements, deterministic IDs,
exact conflict targets, and one atomic D1 batch. It must not use replace or
ignore semantics. After a thrown or otherwise ambiguous result, a fresh
`first-primary` session reads the deterministic identity and exact-compares the
complete protected closure:

- exact committed closure: success;
- complete absence: retry the same idempotent attempt within policy;
- partial or mismatched state: permanent integrity failure.

Ambiguity never creates a replay or a new domain attempt.

### Production identity hardening

The logical schedule remains `provider-refresh-v1` with cron
`0 5 * * 1,4`. Preview remains `quant-clarity-publication-preview`; the future
production Workflow resource name is `quant-clarity-publication-production`.
Each environment must explicitly map its exact resource name, environment,
plan authority, and runtime versions. No environment is inferred from a name.

## Consequences and implementation boundary

Phase 7.2-C implements only pure policy/admission/replay/deadline/concurrency/
terminal/report oracles and tests. It changes no canonical migration, Worker,
Wrangler configuration, generated binding, schedule, route, remote resource,
source access, or deployment state.

Phase 7.2-D must separately review an additive canonical migration and fixed D1
adapter. It must close occurrence immutability, admission receipts, exact replay
adjacency, run-plan binding, operational terminal evidence, fenced Provider
claims, report closure, and ambiguous-write tests. Phase 7.2-E may then add
protected bindings and native Workflow restart evidence under separate
authorization.

## Rejected alternatives

- **Write the existing ledger now:** rejected because missing Provider rows and
  synthetic source evidence could satisfy its current terminal guards.
- **Treat any last-known-good slice as a new publishable run:** rejected because
  continuity is not a refresh and must not mint an identical publication.
- **Use Workflow instance IDs or retention as audit authority:** rejected because
  platform retention is bounded and engine retries are not domain replays.
- **Use lease expiry without fencing:** rejected because a stale Workflow may
  resume and commit after takeover.
- **Store arbitrary JSON reports or raw errors:** rejected because they are not
  contract-complete and create privacy, secret, and unbounded-data sinks.
