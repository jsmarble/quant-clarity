# ADR 0059: Normalize publication run-plan authority in canonical D1

- Status: Accepted; locally implemented with focused verification
- Date: 2026-08-11
- Decision owners: Product owner, staff engineer, pipeline lead, platform lead, legal/source owner
- Related requirements: `PIPE-001`–`PIPE-004`, `PIPE-045`, `CF-005`–`CF-007`
- Extends: ADRs 0006, 0014, and 0058
- Supersedes: None

## Context

ADR 0058 leaves `PublicationWorkflow` deliberately dormant because no exact,
versioned authority selects a provider scope for a scheduled run. Canonical
Provider, roster, source-compliance, and policy records are facts and
prerequisites; independently querying whichever records appear current would
not prove that one closed set was approved together for one environment and
schedule. A `PipelineRun` also requires a nonempty provider scope, so creating a
run before that authority exists would persist misleading operational state.

The next local boundary must make the authorization object explicit and
auditable without activating the Workflow. It must preserve the accepted
environment-neutral schedule identity `provider-refresh-v1`, keep preview and
production plans distinct, carry exact provider and policy versions, and permit
an append-only revocation. Reads must identify one plan exactly; “latest,”
“active,” or other implicit selection cannot grant execution authority.

This decision does not resolve what durable record is written when a scheduled
event has no eligible plan, how runs and providers become terminal, how a
terminal deadline is interpreted, how overlapping occurrences for one provider
are serialized, or how the final run report maps those outcomes. Those choices
remain coupled and require the next orchestration ADR before any run-ledger
write.

## Decision

### Canonical normalized authority

Canonical-D1 migration `0005_publication_run_plan_authority.sql` adds exactly
these normalized authority objects:

| Object | Authority |
|---|---|
| `publication_run_plan` | Immutable plan header, exact identity, environment, schedule, effective interval, provider count, and root content hash |
| `publication_run_plan_provider` | Exact sorted provider membership, adapter/roster/source versions and hashes, six typed ceilings, and Provider retry hash |
| `publication_run_plan_policy` | Exactly one versioned policy reference for each closed policy role |
| `publication_run_plan_seal` | Immutable closure over the header, complete provider set, and complete policy set through exact contract, count, set-hash, root-hash, and seal-time fields |
| `publication_run_plan_approval` | One immutable approval carrying the exact three owner roles and one static approval artifact path and hash |
| `publication_run_plan_revocation` | Optional append-only revocation of the sealed and approved plan |
| `publication_run_plan_authority_integrity_metadata` | Singleton `capability` marker `publication-run-plan-authority@1` |

The existing canonical schema marker remains `1.0.0`; the dedicated capability
marker advertises this additive authority, following the repository's existing
capability-marker pattern. The migration must preflight its exact predecessor
and every object name before mutation. A collision, malformed predecessor, or
late failure leaves no partial authority.

`run_plan_id` is a required immutable exact identifier, separate from the
content hash. It uses the repository's full lowercase 40-character `rpl_`
UUIDv4-shaped canonical grammar. It is an opaque stable identifier, not a claim
of random UUIDv4 generation. The content hash is an independent lowercase
`sha256:` digest over the canonical closed plan encoding. Neither value may be
generated from a query for the latest row. A caller must supply both and both
must match.

### Closed plan header

Each plan has:

- contract version `publication-run-plan@1`;
- `environment` exactly `preview` or `production`;
- logical schedule name exactly `provider-refresh-v1`;
- schedule expression exactly `0 5 * * 1,4`;
- an effective half-open interval `[effective_from_ms, effective_to_ms)`
  using nonnegative safe-integer Unix milliseconds, with the end strictly after
  the start;
- a provider count from 1 through 16 inclusive;
- exact nonempty `canonical_schema_version` and
  `pipeline_contract_version` values;
- the complete provider-scope and policy-set hashes;
- immutable creation metadata; and
- the independently supplied `plan_hash` root content hash.

The environment is plan content. A preview plan can never become a production
plan through a binding rename, resource rename, or caller assertion. This ADR
does not create a real plan for either environment and does not choose the
future production Workflow resource name.

### Provider membership and ceilings

Provider membership is complete, nonempty, unique, and strictly increasing by
canonical Provider stable ID. There are no implicit or disabled members. Every
member stores exact nonempty:

- `provider_id`;
- `adapter_version`;
- `roster_version`; and
- `source_register_version`.

The Provider row also binds the exact roster content hash, source-register
artifact hash, and Provider retry hash used by the canonical plan encoding.

Every member also stores exactly these six nonnegative safe-integer ceilings:

| Ceiling | Unit |
|---|---|
| `request_ceiling` | Count |
| `byte_ceiling` | Bytes |
| `ai_token_ceiling` | Tokens |
| `browser_millisecond_ceiling` | Milliseconds |
| `elapsed_millisecond_ceiling` | Milliseconds |
| `cost_microusd_ceiling` | Millionths of one USD |

The migration uses foreign keys and guards to require the referenced Provider,
roster, and source-compliance version. The resolver additionally proves the
source-compliance record is approved, permits access, retention, excerpts, and
publication, and has not reached its review deadline at the requested scheduled
instant. Existence alone never grants authority.

Plan membership independently freezes every referenced `provider_roster`, its
`provider_roster_item` set, and its `source_compliance_record`. Authority-specific
insert/update/delete guards reject roster growth, mutation, deletion, or an
`OLD`/`NEW` update that moves a row into or out of a referenced identity from the
moment membership exists, before seal or approval.

### Exact policy roles

Every plan contains exactly three policy rows, one for each role:

1. `run_budget`;
2. `provider_retry`; and
3. `terminal_deadline`.

Each row contains a nonempty version and lowercase `sha256:` content hash.
Additional, missing, or duplicate roles fail closure. Selecting a policy version
does not define the still-unresolved terminal-deadline anchor or terminal-state
behavior; it only freezes which future accepted policy artifact the plan names.

### Seal, approval, and revocation

The seal is append-only and freezes the plan header, complete provider rows, and
complete policy rows. It records the exact `contract_version`, `provider_count`,
`provider_scope_hash`, `policy_count`, `policy_set_hash`, `plan_hash`, and
`sealed_at_ms`. It does not carry an independent header hash. Once sealed, no
plan member may be inserted, updated, or deleted.

Approval is valid only for a matching seal and consists of one immutable row
whose canonical `approval_roles_json` is exactly the closed set:

- `product_owner`;
- `legal_source_owner`; and
- `platform_owner`.

The approval binds one repository-relative static approval artifact path and
lowercase `sha256:` artifact hash. The row is append-only and cannot carry
free-form execution parameters, provider changes, credentials, or secret
values. A missing role, additional role, noncanonical role encoding,
mismatched-artifact, or pre-seal approval fails authorization.

The canonical stored role encoding is exactly
`["legal_source_owner","platform_owner","product_owner"]`.

A plan may have at most one append-only revocation record. Revocation identifies
the exact approved plan, records a nonnegative safe-integer effective instant,
and uses a closed machine-readable reason code. It never deletes or rewrites the
plan. A scheduled instant at or after the revocation instant is ineligible.

### Exact read-only resolver

The local resolver accepts exactly these protected values:

- `run_plan_id`;
- expected root content hash;
- expected environment, exactly `preview` or `production`;
- expected canonical schema version;
- expected pipeline contract version; and
- a 24- or 27-character canonical UTC `scheduledAt` ISO string that represents
  a nonnegative ECMAScript Date-range instant, round-trips exactly through
  ECMAScript ISO formatting, and is Monday or Thursday at exactly
  `05:00:00.000Z`.

It executes fixed, bounded, read-only statements by the exact ID. It never uses
an ordering, maximum, active-row search, fallback, caller-provided SQL, or
selection by environment alone. It requires exactly one header, seal, approval,
and capability marker; 1–16 sorted providers; exactly three policies; the exact
three-role approval encoding; and zero or one revocation.

The resolver losslessly converts `scheduledAt` to a nonnegative safe-integer
Unix-millisecond value for D1 comparisons. It re-encodes and recomputes every
domain-separated hash, verifies the expected root hash and all counts, validates
the scheduled instant against the half-open interval, and evaluates source
approval at that instant. Its frozen output is an
`AuthorizedPublicationRunPlanV1` carrying the exact environment, schedule, plan
identity/hash, provider tuples and ceilings, policy references, approval
artifact identity, and scheduled instant.

The output authorizes only the meaning of that plan. In this phase it has no
run-write or Workflow execution capability. No resolver error may echo plan
content, provider values, artifact content, credentials, or arbitrary database
errors.

### Cloudflare boundary

The local implementation exercises the resolver through the existing test-only
`CANONICAL_DB` D1 binding and actual workerd runtime. The production-generated
`CloudflareEnv`, tracked pipeline Wrangler configuration, and exported
`PublicationWorkflow` remain unchanged and unbound. No D1 or Workflow binding is
added to deployable configuration.

Local SQLite and workerd/D1 evidence can prove migration constraints, fixed
binding-API compatibility, exact reads, and deterministic validation. It cannot
prove deployed D1 consistency, Workflow registration, scheduled delivery, step
persistence, retry, restart, environment isolation, or operational approval.

## Explicit deferrals

This ADR does not authorize or define:

- a real preview or production plan, Provider member, policy artifact, approval,
  source approval, or revocation;
- occurrence, pipeline-run, provider-run, cost, error, report, or other ledger
  writes;
- missing/invalid/revoked-plan admission records or their terminal semantics;
- attempt selection, intentional replay, adjacent-run reconciliation, or
  schedule-delivery hardening;
- run/provider terminal-state mapping, publishable partial success, the
  zero-usable-provider outcome, or final report completeness;
- the terminal-deadline anchor, expiry action, bounded waiting, child polling,
  or every-provider-terminal protocol;
- cross-occurrence same-provider exclusion, leases, locks, or resume behavior;
- changes to `PublicationWorkflow`, its event admission, its preview-name check,
  its step, or its result;
- Workflow/D1 bindings, schedules, secrets, configuration, provisioning,
  migration execution, upload, deployment, observability, or trace advancement;
  or
- source acquisition, evidence, child Workflows, publication, backup, search,
  or rollback.

The next orchestration ADR must close admission, terminality, deadline,
concurrency, report, schedule-hardening, and replay semantics together before a
run-ledger write or Workflow activation is implemented.

## Consequences

- One normalized immutable object can eventually authorize a scheduled provider
  scope without inferring “latest” state.
- Preview and production authority cannot share a plan accidentally.
- Provider versions, source approval, ceilings, policies, ownership approval,
  and revocation become hash-bound and auditable.
- The read-only resolver is implemented and focused-tested locally through
  actual D1 without weakening the predeployment embargo.
- The Workflow remains dormant and no traceability row advances.
- A subsequent ADR still owns the materially harder run-admission and durable
  execution state machine.

## Alternatives considered

- **Select the latest approved plan:** rejected because ordering is not execution
  authority and makes replay dependent on mutable later rows.
- **Infer providers from active Provider, roster, or source rows:** rejected
  because those records do not prove one jointly approved scope.
- **Store the plan as one JSON blob:** rejected because normalized foreign keys,
  exact membership, approval closure, revocation, and independently bounded
  reads would be weaker.
- **Use only a content hash as identity:** rejected because operators and future
  protected configuration need an exact stable plan identifier while the hash
  independently proves bytes.
- **Use a mutable approval/status field:** rejected because authority changes
  would overwrite history instead of producing append-only evidence.
- **Open the run ledger in this slice:** rejected because admission failure,
  terminality, deadline, concurrency, report, schedule, and replay semantics are
  unresolved.
- **Add test or local Workflow bindings now:** rejected because the existing
  test-only D1 seam is sufficient for this resolver and Workflow evidence would
  imply a runtime boundary this phase does not implement.

## Focused local validation

- Prove exact migration predecessor and object-collision checks plus atomic
  rollback for every injected late failure.
- Prove header, provider, policy, seal, approval, and revocation immutability and
  freeze ordering.
- Reject zero, more than 16, duplicate, unsorted, malformed, missing-reference,
  or post-seal Provider rows and every malformed ceiling.
- Require exactly three policy roles and one approval row with the exact
  canonical three-role set and matching static artifact path/hash.
- Prove half-open interval boundaries, revocation boundaries, and source-review
  expiry at the scheduled instant.
- Prove the provider-scope, policy-set, and root hashes against independent
  expected values and reject every count/hash/content mismatch.
- Prove fixed protected-input D1 reads, structurally bounded result rows and
  ASCII fields, and absence of latest/fallback SQL.
- Prove repeated resolution is byte-equivalent and produces a frozen closed
  output with no clock, random, network, log, telemetry, or write effect.
- Run local SQLite migration tests and actual workerd tests against the existing
  test-only `CANONICAL_DB` binding.
- Confirm tracked Worker configuration, generated production types,
  `PublicationWorkflow`, the dormant planner, and traceability statuses are
  unchanged.
