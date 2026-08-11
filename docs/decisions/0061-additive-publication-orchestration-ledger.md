# ADR 0061: Add a closed publication orchestration ledger

- Status: Accepted for local implementation; remote migration and runtime activation prohibited
- Date: 2026-08-11
- Decision owners: Staff engineer, pipeline lead, data-integrity lead, platform lead, security/privacy lead
- Related requirements: `PIPE-001`–`PIPE-008`, `PIPE-019`, `PIPE-037`, `PIPE-043`–`PIPE-045`, `BE-003`–`BE-006`, `CF-005`–`CF-007`, `OPS-001`–`OPS-007`, `QA-006`, `SM-01`
- Extends: ADRs 0006, 0014, 0058, 0059, and 0060
- Supersedes: None

## Context

ADR 0060 closes the runtime-neutral publication admission, replay, deadline,
fencing, terminal, and report contract. The canonical database still contains
an older `pipeline_run`/`provider_run` ledger. Its terminal vocabulary cannot
represent `completed_with_provider_failures`, its run rows do not bind the
approved plan or environment, and `roster_outcome.evidence_id` is mandatory.
Using those columns for a pre-acquisition timeout, lock failure, or admission
rejection would either lose required authority or invent source evidence.

Cloudflare documents that D1 `batch()` executes prepared statements
sequentially as one SQL transaction and rolls the sequence back when a
statement fails. D1 Sessions with `first-primary` begin from the primary and
provide sequential consistency. Those are the only platform guarantees this
adapter relies on. A thrown mutation response remains ambiguous and must be
reconciled from a fresh `first-primary` session.

## Decision

### Additive successor authority

Migration `0006_publication_orchestration_ledger.sql` adds a closed parallel
coordination authority without changing the meaning of legacy provenance
facts. The existing `pipeline_run`, `provider_run`, and `roster_outcome` tables
remain readable historical schema but are never shadow-written by the new
adapter. Once an exact database environment is initialized, guards reject new
legacy run-graph writes. Initialization itself requires the old pipeline,
Provider, and acquisition graph to have no pending or running owner, so cutover
cannot strand work or overlap an unfenced legacy owner. The initialized
database also freezes the legacy observation, evidence, claim, and downstream
fact append paths. A later provenance-v2 migration must make acquisition,
observation, evidence, and canonical effects carry the new fenced run authority
before any source execution can be activated.

The successor ledger contains:

1. one immutable exact schedule occurrence;
2. a disjoint immutable rejected-firing shape carrying its complete sealed
   `publication-run-report@2`, with activation blocked pending an atomic D1
   admission resolver;
3. immutable coordination run authority rows, where attempt 1 is the admitted
   firing receipt and the later-attempt shape is blocked pending a protected
   replay resolver with a fresh attempt timestamp;
4. immutable, plan-derived coordination Provider-run authority rows;
5. an immutable per-run cost reservation and terminal actual cost;
6. environment-wide Provider fence claim/release history plus one guarded head;
7. per-roster-item terminal operational outcomes that permit a null source
   evidence link only for source-free unavailable, failed, or quarantined
   outcomes; and
8. a dormant retained-publication authority shape for the later fixed
   serving-head resolver; and
9. immutable Provider terminal rows and one complete sealed terminal report.

All authority tables are `STRICT`, bounded, append-oriented, and guarded
against update/delete. IDs, versions, hashes, times, states, error codes,
budgets, ordering, and JSON shape are closed. There is no arbitrary error,
metadata, request, header, URL, actor, or telemetry column.

### Admission and replay

The schema makes a durable rejection and an attempt-1 run mutually exclusive
for one occurrence. Malformed event, payload, Workflow, cron, or scheduled-time
envelopes stop before durable admission and cannot create either record. A
rejected report and nominal in-process decision are structural output, not
proof that the plan or budget snapshot came from D1. Local security review
therefore added an unconditional rejection-insert blocker, and the fixed
adapter returns `authority_missing` without opening a D1 session. A later
atomic D1 admission resolver must derive the reason and insert the receipt in
one reviewed authority boundary before this blocker may be removed.

Attempt 1 exact-binds the occurrence, approved plan ID/hash, environment,
canonical-schema and pipeline-contract versions, policy-set and Provider-scope
hashes, sorted Provider scope, scheduled-time deadline, protected Git revision,
six run ceilings, projected monthly cost, alert threshold, and observed/start
times. Occurrence, run-attempt, and Provider-run IDs are recomputed from the
Phase 3 deterministic tuple derivations; caller-selected UUID-shaped IDs are
not authority. Every Provider row exact-matches its frozen plan membership,
roster hash, and source-compliance artifact, approval, permissions, and review
window at the canonical scheduled instant. Plan revocation is evaluated at
that same scheduled instant.

The schema can express attempt `N + 1` adjacency, but a caller-supplied
`protected_operator` string is not authorization. Phase 7.2-D therefore blocks
every attempt above 1 and every replay field in both the fixed adapter and D1.
A later protected resolver must prove the exact terminal non-successful prior
attempt, same occurrence and plan, adjacent number, prior run ID, and a fresh
admission/reservation timestamp. Branches, gaps, cross-occurrence replays, plan
changes, and replay of success remain invalid.

### Cost admission

Each UTC budget month requires an explicit protected global allocation and
breaker generation; absence is not inferred as safe. Admission uses a fresh
primary read of terminal actual cost plus still-active reservations. The
mutation batch exact-compares that state and breaker generation before
inserting the run reservation. Concurrent stale admissions therefore roll back
instead of oversubscribing the allocation. Terminal report cost replaces the
reservation in later budget reads; history is never overwritten.

The approved USD 25 target is platform-wide, not USD 25 per environment. This
local slice therefore permits only one initialized environment database and
one checked-in allocation at a time. Preview may receive at most the full USD
25 while production remains disabled with zero authority. Phase 7.2-E must
either supply one protected global budget authority or owner-approved static
environment allocations whose checked-in sum is at most USD 25 before a second
environment can execute. Separate databases may not each infer the full
ceiling.

### Provider fencing

An immutable claim names `(environment, provider_id, generation)`, exact holder
run/occurrence/Provider-run, and deadline. A claim may be created only when no
head exists at generation 1 or the exact previous generation is durably
released. The guarded head advances monotonically and has at most one active
owner per environment and Provider. Generation advance additionally requires
an immutable exact reconciliation record for the prior owner followed by its
exact release; Provider terminality alone is insufficient takeover authority.

The plan-derived Provider row records admission time, not a fictional work
start. The successful fence claim is the actual Provider start authority and
may occur at any instant from run start until the immutable deadline, including
after waiting for a previous occurrence to reconcile and release. Roster and
terminal timelines begin at that claim.

Expiry does not release or transfer ownership. A release names the exact claim
and may occur only after the holder has a terminal Provider record. Operational
roster outcomes and Provider terminal writes verify the current active head and
generation in their transaction. Future source-effect receipts and canonical
mutations must perform the same check; this phase grants neither effect.

### Operational roster closure

Every frozen roster item receives exactly one successor outcome. Published
candidate states require an Offering and real evidence. Source-free
`unavailable`, `failed`, and `quarantined` states require a closed machine code
and must not carry evidence or an Offering; they record zero source attempts
rather than inventing work that never began. Provider terminal insertion fails
unless the exact frozen roster is complete. This supplies honest operational
evidence without weakening canonical evidence requirements.

### Report closure and ambiguous writes

The fixed adapter accepts only reports that the Phase 7.2-C verifier rebuilds
from the admitted and attempt-1 run authorities. It persists a deterministic
canonical encoding, normalized closure columns, and the report content hash.
Provider count, scope, versions, terminal states, costs, error codes, and fence
release must match before the run report can close.

SQLite also requires the compact JSON normalization it can verify and exact
closed field/value projections. SQLite cannot independently sort arbitrary
nested object keys or recompute SHA-256, so the fixed adapter's canonical
encoder remains the byte-order and digest authority; direct SQL is not an
approved write path.

Any `carried_forward` Provider requires an exact
`retained-publication-head@1` authority naming the matching environment,
current publication ID, and closure hash. A `retain_current` report cannot
close without it and cannot create a new publication. This structural record
must be minted by a later fixed serving-head resolver; caller assertion or a
slice ID alone is not current-publication proof. Phase 7.2-D therefore blocks
every retained-authority insert and every carried-forward closure. A later
reviewed migration may remove that blocker only when the resolver proves the
exact protected serving head in the same transaction.

Every mutation uses fixed prepared statements and exact conflict targets; no
`REPLACE` or `IGNORE` form is permitted. After a thrown or malformed response,
a fresh `first-primary` session reads the complete deterministic closure:

- exact closure is idempotent success;
- complete absence permits one retry of the same domain attempt, followed by
  one more exact reconciliation; and
- partial, extra, or mismatched closure is a permanent integrity failure.

Raw D1 messages never enter returned results, persisted rows, or reports.

## Consequences and implementation boundary

Phase 7.2-D may add only the checked-in local migration, fixed adapter, tests,
and traceability/design notes. It does not add a D1 or Workflow binding,
schedule, source call, route, secret, operator surface, remote migration,
resource, deployment, or production authority. Mapped requirements remain
`Planned` because native Workflow restart/concurrency, remote isolation,
operational backup, and deployed-run evidence are still absent.

Phase 7.2-E may add reviewed atomic admission, protected replay, and
serving-head resolver migrations and bind the already dormant Workflow to an
environment-isolated coordination D1 database to prove native restart behavior
only after protected configuration, global budget authority, and predeployment
gates permit it. Source work remains blocked until the later provenance-v2
fenced acquisition graph exists.

## Rejected alternatives

- **Shadow-write legacy run rows:** rejected because pre-acquisition failure
  cannot satisfy mandatory legacy source evidence, and mapping
  `completed_with_provider_failures` to legacy `succeeded` would record a false
  historical fact.
- **Store one arbitrary JSON run document:** rejected because it cannot enforce
  Provider fencing, roster completeness, replay adjacency, or bounded fields.
- **Treat a missing breaker row as false:** rejected because absent protected
  control state is not execution authority.
- **Release a claim at deadline:** rejected because time alone cannot fence a
  late owner.
- **Use `INSERT OR REPLACE`/`IGNORE`:** rejected because either can destroy
  authority or hide mismatched duplicates.
- **Trust a report seal without authority:** rejected because a hash is
  integrity framing, not authorization.
