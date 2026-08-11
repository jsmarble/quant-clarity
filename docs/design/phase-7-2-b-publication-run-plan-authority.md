# Phase 7.2-B: Normalized publication run-plan authority

| Attribute | Value |
|---|---|
| Status | Locally implemented and focused-verified on 2026-08-11; no real plan, binding, Workflow activation, preview/production migration execution, or deployment authority |
| Decision | [ADR 0059](../decisions/0059-normalized-publication-run-plan-authority.md) |
| Requirements | `PIPE-001`–`PIPE-004`, `PIPE-045`, `CF-005`–`CF-007` |

## Objective

Define the exact normalized canonical-D1 authority and read-only resolver that a
future scheduled `PublicationWorkflow` must use before it may create a run.
Close provider-scope, version, ceiling, policy, approval, and revocation meaning
without writing an occurrence/run ledger or changing the dormant Workflow.

This is the first successor prerequisite from Phase 7.2-A. It is not Workflow
activation and does not make a preview candidate deployable.

## Fixed identities and limits

| Concern | Fixed value |
|---|---|
| Plan contract | `publication-run-plan@1` |
| Capability marker | `publication-run-plan-authority@1` |
| Logical schedule | `provider-refresh-v1` |
| Cron | `0 5 * * 1,4` — Monday and Thursday at `05:00 UTC` |
| Environments | Exactly `preview` or `production` |
| Effective time | Half-open `[effective_from_ms, effective_to_ms)` |
| Provider scope | 1–16 unique Provider stable IDs in strict ascending order |
| Policy roles | `run_budget`, `provider_retry`, `terminal_deadline` |
| Approval roles | `product_owner`, `legal_source_owner`, `platform_owner` |
| Resolver authority | Exact ID/hash, expected environment, expected canonical-schema and pipeline-contract versions, and canonical scheduled instant |

`run_plan_id` and the content hash are independent immutable identifiers. The ID
uses the full lowercase 40-character `rpl_` UUIDv4-shaped canonical grammar and
is treated as an opaque stable identifier. The resolver never derives either
value and never searches for a latest plan.

## Implemented local migration boundary

Canonical migration `0005_publication_run_plan_authority.sql` adds only:

1. `publication_run_plan`;
2. `publication_run_plan_provider`;
3. `publication_run_plan_policy`;
4. `publication_run_plan_seal`;
5. `publication_run_plan_approval`;
6. `publication_run_plan_revocation`; and
7. singleton `publication_run_plan_authority_integrity_metadata(singleton, capability)`.

The global canonical schema marker remains `1.0.0`; the exact capability marker
advertises the additive boundary. The migration must preflight the predecessor
and all object names and roll back atomically on any failure. It does not alter
`schedule_occurrence`, `pipeline_run`, `provider_run`, or any publication table.

### Plan header

The immutable header carries contract version, exact plan ID, canonical schema
version, pipeline contract version, environment, logical schedule, cron,
effective interval, provider count, provider-scope hash, policy-set hash,
creation metadata, and root `plan_hash`. Preview and production are distinct
plan content; no runtime resource rename may cross that boundary.

### Provider rows

Every strictly sorted member carries exact Provider ID, adapter version, roster
version, source-register version, and these six nonnegative safe-integer
ceilings:

| Field | Unit |
|---|---|
| `request_ceiling` | Count |
| `byte_ceiling` | Bytes |
| `ai_token_ceiling` | Tokens |
| `browser_millisecond_ceiling` | Milliseconds |
| `elapsed_millisecond_ceiling` | Milliseconds |
| `cost_microusd_ceiling` | Millionths of one USD |

Provider/roster/source foreign keys establish identity only. Resolution must
also prove that the referenced source record is approved, allows access,
retention, excerpts, and publication, and remains unexpired at the requested
scheduled instant. Each Provider row also binds the exact roster content hash,
source artifact hash, and Provider retry hash admitted by the plan.
Authority-specific guards freeze the referenced `provider_roster`, its complete
`provider_roster_item` set, and its `source_compliance_record` as soon as plan
membership exists. Insert/update/delete and `OLD`/`NEW` move-in or move-out paths
cannot alter that authority before or after seal and approval.

### Policies, seal, approval, and revocation

The policy table has exactly one version/hash row for each of the three fixed
roles and rejects every additional or missing role. The seal records exactly
`contract_version`, `provider_count`, `provider_scope_hash`, `policy_count`,
`policy_set_hash`, `plan_hash`, and `sealed_at_ms`; it has no independent header
hash. Sealing freezes the plan and its members.

Approval is one append-only row whose canonical role JSON contains exactly the
three fixed owner roles. It binds one static repository-relative approval
artifact path and hash. Approval cannot introduce execution parameters.
The canonical stored role encoding is exactly
`["legal_source_owner","platform_owner","product_owner"]`.

An optional append-only revocation binds the exact approved plan, one effective
instant, and a closed machine reason. The plan is ineligible at and after that
instant; no row is deleted or rewritten.

## Derived authority state

```text
absent
  -> declared
  -> sealed
  -> approved
  -> eligible_at(scheduled instant)

approved -> revoked
approved -> expired
incomplete or hash-invalid -> rejected
```

These are derived states, not a mutable authority-status column. Eligibility
exists only for the exact supplied identity/hash and requested scheduled
instant.

## Exact resolver

The local resolver input contains exactly these protected values:

- exact `run_plan_id`;
- exact expected root content hash;
- expected environment, exactly `preview` or `production`;
- expected canonical schema version;
- expected pipeline contract version; and
- a 24- or 27-character canonical UTC `scheduledAt` ISO string representing a
  nonnegative ECMAScript Date-range instant that round-trips exactly through
  ECMAScript ISO formatting and is Monday or Thursday at exactly
  `05:00:00.000Z`.

Fixed, bounded, read-only D1 statements retrieve the capability marker and one
exact plan family. The resolver requires one header, seal, and approval; 1–16
sorted providers; exactly three policies; the exact canonical three-role
approval set; and zero or one revocation. It validates the half-open interval
and source approvals at the scheduled instant, losslessly converts `scheduledAt`
to a nonnegative safe-integer Unix-millisecond value for D1 comparisons, and
independently recomputes every count and hash.

The frozen `AuthorizedPublicationRunPlanV1` output contains only the exact plan
identity/hash, environment, schedule, scheduled instant, provider tuples and
ceilings, policy references, and approval artifact identity. It contains no
credentials, source payload, arbitrary prose, D1 metadata, run ID, provider-run
ID, attempt, replay, mutable status, actual start/end time, cost usage, error, or
publication authority.

The following query behavior is forbidden:

- `ORDER BY ... DESC`, `MAX`, or any equivalent latest selection;
- selection by environment, schedule, approval, or effective time without the
  exact ID and hash;
- fallback to another plan;
- caller-provided SQL, table, column, ordering, or limit; and
- reads outside the fixed header/capability, 17-row Provider, and four-row policy
  query bounds. Accepted output remains structurally bounded by 16 Providers,
  three policies, and the schema/validator's fixed ASCII field lengths.

## Cloudflare-native local seam

The local implementation uses the existing workerd test environment's test-only
`CANONICAL_DB` binding. This supplies actual D1 prepared-statement and migration
evidence without adding a production or local Wrangler binding. The resolver is
read-only and does not need a Workflow binding.

No change is permitted in this phase to:

- `apps/pipeline/src/index.ts` or the dormant Workflow planner;
- `apps/pipeline/wrangler.jsonc`;
- generated production `CloudflareEnv`;
- Workflow, D1, R2, Vectorize, source, secret, or observability bindings;
- schedules, routes, GitHub workflows, environment inventory, or preview-plan
  authority; or
- deployment, provisioning, or migration commands.

Local SQLite/workerd evidence does not prove remote D1 behavior, native Workflow
step persistence, retry, restart, scheduling, or environment isolation.

## Focused local implementation evidence

| Evidence | Required proof | Explicit non-claim |
|---|---|---|
| Migration structure tests | Exact predecessor/collision checks, capability marker, complete objects, rollback on every late failure | Remote migration execution |
| Constraint/trigger tests | Append-only header/members/seal/approvals/revocation and post-seal freeze | Owner approval of a real plan |
| Hash-oracle tests | Independent expected provider-scope, policy-set, and root hashes plus mismatch rejection | Cryptographic signing |
| Resolver unit tests | Exact input, bounds, interval/revocation/source-approval behavior, closed errors, frozen deterministic output | D1 binding compatibility |
| Actual workerd+D1 tests | Migration applied to test-only `CANONICAL_DB`; fixed exact reads, rejected post-seal mutation, exact revocation boundary, and no run writes | Native Workflow persistence/restart |
| Architecture/privacy checks | No latest/fallback SQL, writes, network, logging, telemetry, secrets, or visitor data | Deployed privacy acceptance |
| Focused gates | Migration, resolver unit, actual workerd/D1, formatting, lint, type-check, privacy, and architecture checks passed in this increment | Full repository, preview, or production acceptance |

Implementation must use redacted synthetic Providers and approval artifacts in
tests. It must not add a real plan, real source approval, or authenticated
payload.

## Explicitly unresolved next-ADR work

The next orchestration ADR must decide these together before any ledger write:

1. what durable record a valid scheduled firing creates when its exact plan is
   absent, invalid, expired, or revoked;
2. the attempt/replay state machine and adjacent-prior reconciliation;
3. exact mapping among run coordination, canonical run/provider statuses,
   publishable partial success, and zero usable Providers;
4. the `terminal_deadline` anchor, bounded wait/poll behavior, and deadline
   terminal action;
5. same-provider concurrency across distinct occurrences, duplicate delivery,
   lease/lock/resume behavior, and ambiguous D1 outcomes;
6. the complete `PIPE-003`/`PIPE-045` machine report, including scheduled time,
   provider scope, top-level error summary, costs, and admission failures; and
7. production Workflow resource-name admission, schedule-delivery hardening,
   native step/restart evidence, and protected environment continuity.

Until that ADR is accepted, no occurrence, pipeline-run, or provider-run row may
be created by `PublicationWorkflow`.

## Traceability effect

This local implementation advances no traceability status. `PIPE-001`–`PIPE-004`
and `PIPE-045` remain `Planned` until the
configured schedule, durable ledger, provider concurrency, complete report, and
native Workflow evidence exist. `CF-005`–`CF-007` remain `Planned` until protected
environment isolation, reproducible deployable bindings, and least-privilege
secret/identity evidence exist.
