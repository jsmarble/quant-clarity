# Phase 7.2-C: Publication run admission and terminal coordination

| Attribute | Value |
|---|---|
| Status | Locally implemented and full-repository verified on 2026-08-11; no ledger migration, binding, schedule, run, source call, or deployment authority |
| Decision | [ADR 0060](../decisions/0060-publication-run-admission-and-terminal-coordination.md) |
| Requirements | `PIPE-001`–`PIPE-008`, `PIPE-019`, `PIPE-037`, `PIPE-043`–`PIPE-045`, `BE-003`–`BE-006`, `OPS-007`, `SM-01` |

## Objective

Close the coupled semantic contract that ADR 0059 requires before the first
publication run-ledger write. Supply deterministic, runtime-neutral decision
oracles and hostile tests without changing the dormant Workflow or the
canonical database.

## Implemented boundary

The pure contract covers:

1. exact typed and hash-verified run-budget, Provider-retry, and terminal-
   deadline policy artifacts;
2. exact Phase 7.2-B plan/schedule/runtime/provider-scope authority plus safely
   summed six-field ceilings, fixed aggregate run maxima, monthly used/reserved
   cost, alerts, and breaker;
3. admitted versus rejected scheduled firings, with rejected firings creating
   no run;
4. duplicate delivery versus protected adjacent operator replay;
5. cross-occurrence same-Provider wait/resume/no-op decisions and future
   generation-fence requirements;
6. an immutable deadline anchored to scheduled time;
7. run outcome independent from `publish_new`, `retain_current`, or `blocked`;
8. full success, partial new publication, last-known-good-only retention,
   zero-usable failure, and run-wide quarantine; and
9. bounded, closed, deterministic `publication-run-report@2` projections with
   admitted-plan-derived runtime and Provider authority, derived terminal error
   codes, canonical `prn_` selected-slice identities, explicit same-environment
   retained-publication head authority for carried data, and no arbitrary error
   or visitor-derived fields.

The oracles perform no I/O and create no authority. They are inputs to the next
canonical migration and D1 adapter review.

## Failure-closed invariants

- Platform retry/restart never increments the domain attempt.
- Attempt `N + 1` names the exact terminal adjacent attempt `N`, same occurrence,
  and same plan; terminal reports consume that replay decision rather than
  loose attempt metadata, and no replay surface exists in this phase.
- Deadline is `scheduled_at + sealed duration`, never `started_at + duration`.
- A distinct active Provider owner waits; expiry without exact reconciliation
  and a higher fence cannot take ownership.
- Late owners cannot commit after fencing changes.
- Parent terminality requires the exact Provider scope and complete frozen
  roster outcomes.
- Last-known-good-only continuity retains the current publication; it does not
  publish a new identical snapshot.
- Reports accept only closed states/codes, bounded integers, canonical times,
  exact sorted identifiers, and fixed fields.
- `pvr_` Provider-run and `prn_` Provider-slice identities remain distinct;
  carried data requires an exact retained head publication ID and closure hash.
- Malformed platform-envelope failures remain in-memory only and are excluded
  from the durable admission-rejection subset.
- Report callers cannot independently supply plan, environment, runtime,
  Provider-version, scope, or derived top-level error fields.
- Terminal report verification requires the matching admitted and run/replay
  authorities, exact-compares plan, Provider versions, scope, identity,
  protected Git revision, schedule, and deadline, and re-applies admitted cost
  ceilings; seal-only structural validation cannot grant authority.
- No report or decision accepts request headers, addresses, cookies, queries,
  user agents, referrers, raw exceptions, source payloads, URLs, or credentials.

## Verification

Focused unit tests cover golden policy encodings and hash mismatch, unknown and
out-of-range policy fields, exact Phase 7.2-B hash compatibility, delayed and
wrong-schedule admission, budget/breaker rejection, duplicate and adjacent replay,
cross-occurrence Provider contention, stale fencing, each terminal/publication
mapping, exact roster closure, report determinism, six-dimensional aggregate
budget overflow, Phase B-to-C resolved-plan compatibility, contradictory error
rejection, cost overflow, and privacy canaries.

The full `npm run verify` repository gate passes, including 2,003 unit tests,
222 Worker-runtime tests, build/browser states, supply-chain, documentation,
GDPR-accountability, and zero-visitor-data checks. This local evidence is not
D1 transaction, Workflow persistence/restart, environment isolation, or
deployment evidence; mapped traceability rows remain `Planned`.

## Explicit deferrals

Phase 7.2-D must add the reviewed canonical schema and fixed D1 adapter for
immutable admission receipts, exact run authority, adjacent replay, operational
terminal evidence, fenced claims, closed reports, and response-loss
reconciliation. Phase 7.2-E must separately add protected Cloudflare bindings,
native Workflow evidence, and preview/production infrastructure.

This phase adds no migration, real plan, run/provider row, source call, child
Workflow, operator endpoint, Wrangler binding, schedule, route, secret,
telemetry, remote resource, migration execution, or deployment.
