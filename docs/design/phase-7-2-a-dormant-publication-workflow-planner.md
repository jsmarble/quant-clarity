# Phase 7.2-A: Dormant unbound PublicationWorkflow scheduled-occurrence planner

| Attribute | Value |
|---|---|
| Status | Locally implemented and verified on 2026-08-11; no Workflow binding, schedule, persistence, or deployment authority |
| Decision | [ADR 0058](../decisions/0058-dormant-unbound-publication-workflow-planner.md) |
| Requirements | `PIPE-001`–`PIPE-004`, `CF-005`–`CF-007` |

## Objective

Add the real Cloudflare `PublicationWorkflow` class and the smallest useful direct-schedule boundary while keeping the pipeline Worker unbound and incapable of I/O. Validate one exact scheduled event, derive only the deterministic scheduled-occurrence identity, and return one visibly dormant plan through one pure Workflow step.

This phase is a Phase 3 orchestration prerequisite implemented under the Phase 7 deny-by-default delivery boundary. It does not start Phase 3 acquisition or authorize a preview candidate.

## Fixed identity decisions

- Logical schedule identity: `provider-refresh-v1`.
- Schedule: `0 5 * * 1,4`, Monday and Thursday at `05:00 UTC`.
- Preview-only reserved Workflow resource name: `quant-clarity-publication-preview`.
- Entrypoint class: `PublicationWorkflow`.
- Plan version: `dormant-publication-workflow-plan@1`.
- Step name: `dormant-publication-plan-v1`.

The logical name is environment-neutral and is the ADR 0014 schedule-name input to occurrence identity. It is not the preview Workflow resource name. A logical-name change changes deterministic occurrence IDs and requires an explicit migration/compatibility decision.

## Implemented boundary

### Entrypoint and environment

`apps/pipeline/src/index.ts` exports `PublicationWorkflow extends WorkflowEntrypoint<CloudflareEnv, Record<string, never>>`. The class uses the current Wrangler-generated empty `CloudflareEnv`, reads no `this.env` property, and converts closed planner input failures to Cloudflare `NonRetryableError`.

The existing default fetch export remains the fixed private `404` response with `private, no-store` and the existing security headers. The class adds no route or public trigger.

No change is made to:

- `apps/pipeline/wrangler.jsonc`;
- `apps/pipeline/worker-configuration.d.ts`;
- `apps/pipeline/test-env.d.ts`;
- `vitest.pipeline.worker.config.ts`; or
- any GitHub workflow, environment, resource plan, or deployment command.

The pipeline package adds only the existing workspace `@quant-clarity/pipeline-core` dependency and TypeScript project references needed to reuse the accepted deterministic schedule/occurrence kernel.

### Exact event admission

The planner snapshots only exact own data properties and accepts:

| Field | Local rule |
|---|---|
| `payload` | absent-equivalent, null, or exact empty own-data record; no authority fields |
| `timestamp` | valid platform `Date`, not earlier than `scheduledTime` |
| `instanceId` | nonempty printable ASCII, at most 100 characters; never enters output identity |
| `workflowName` | exact preview reservation `quant-clarity-publication-preview`, at most 64 characters |
| `schedule.cron` | exact `0 5 * * 1,4` |
| `schedule.scheduledTime` | nonnegative safe integer, valid ECMAScript date, exact Monday/Thursday `05:00:00.000 UTC` |

The outer event contains exactly `payload`, `timestamp`, `instanceId`, `workflowName`, and `schedule`; the schedule contains exactly `cron` and `scheduledTime`. Missing schedule metadata, manual input, extra/inherited/symbolic fields, accessors, hostile traps, nonempty payloads, or invalid identities/times fail before entering the step. Error messages are fixed machine codes and cannot echo input.

### Closed plan and step

The planner derives the occurrence with `createScheduleOccurrence` and then projects only:

| Member | Meaning |
|---|---|
| `plan_version` | fixed local dormant-plan version |
| `authority` | fixed dormant/unbound/no-I/O marker |
| `execution_authority` | always `false` |
| `occurrence.occurrenceId` | deterministic ADR 0014 `occ_` ID |
| `occurrence.occurrenceKey` | length-prefixed logical schedule name plus canonical scheduled instant |
| `occurrence.scheduleName` | `provider-refresh-v1` |
| `occurrence.scheduleExpression` | `0 5 * * 1,4` |
| `occurrence.scheduledAt` | canonical UTC scheduled instant |

The output omits `createdAt`, run/provider/replay fields, delivery and instance identity, bindings, source data, and operational results. It is frozen and serializes below the 4,096-character application ceiling.

The complete plan is built before one `step.do("dormant-publication-plan-v1", ...)` call. The callback returns only that pure plan. It performs no I/O, binding access, source call, database operation, clock/random read, console call, custom telemetry, retry loop, sleep, child creation, or polling.

## Current Cloudflare compatibility

The implementation follows current official Cloudflare behavior checked on 2026-08-11:

- a Workflow definition extends `WorkflowEntrypoint` and includes at least one step;
- direct recurring execution is configured through `workflows[].schedules`, and scheduled instances receive `event.schedule.cron` plus `event.schedule.scheduledTime`;
- TypeScript event generics do not perform runtime validation;
- ordinary event payloads and non-stream step results are currently limited to 1 MiB; and
- bindings and their `Env` types come from Wrangler configuration and `wrangler types`.

References: [Workers API](https://developers.cloudflare.com/workflows/build/workers-api/), [direct Workflow schedules](https://developers.cloudflare.com/workflows/build/trigger-workflows/), [events and parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/), [Workflow rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/), [limits](https://developers.cloudflare.com/workflows/reference/limits/), and [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#workflows).

Installed Wrangler `4.120.0` accepts the named class export with the unchanged unbound pipeline configuration. Its telemetry-disabled dry-run bundles the Worker and reports `No bindings found.` That proves the class export is permissible without a tracked binding or handwritten production `Env`; it does not register or execute a Workflow.

## Local verification result

| Evidence | Result | Proves | Does not prove |
|---|---|---|---|
| Focused planner unit suite | 27 tests pass | exact admission, deterministic identities, one pure step, replay-stable plan, fixed errors, no fetch/log calls | Workflow-engine persistence or restart |
| Pipeline workerd suite | 3 focused tests pass | real class module compatibility, direct `run` behavior, fixed default `404` | registration, native step caching, scheduling, retries |
| Pipeline test TypeScript check | passes | generated empty `CloudflareEnv` and `WorkflowStep` structural compatibility | deployed binding correctness |
| Wrangler `4.120.0` dry-run | passes; `No bindings found.` | bundle/config compatibility and binding absence | upload, provision, deploy, schedule, or execute |

The workerd test calls `PublicationWorkflow.prototype.run` directly with a fake step. It is deliberately not described as native Workflow evidence. Cloudflare's Vitest Workflow introspection APIs require a Workflow binding; a manual test instance also lacks direct-schedule metadata. Native scheduled execution, durable step reuse, interruption recovery, and restart testing remain pending until a reviewed binding/test topology exists.

## Acceptance matrix

| Case | Required local result |
|---|---|
| Exact Monday or Thursday event | One dormant plan and one fixed step |
| Same logical occurrence, different delivery timestamp/instance ID | Same occurrence key and ID |
| Wrong cron/day/hour/sub-minute instant | Rejected before a step |
| Missing `schedule` or manual empty event | Rejected before a step |
| Payload tries to enable, select providers, set writer, replay, URL, or step | Rejected before a step |
| Extra, inherited, symbolic, accessor, or hostile event value | Rejected without reading an accessor or echoing input |
| Step callback executed repeatedly by a fake replay harness | Identical closed output |
| Pipeline Worker default fetch | Existing fixed private `404` unchanged |
| Wrangler dry-run | Bundles successfully and reports no bindings |
| Tracked pipeline configuration/type generation | No Workflow or data binding added; generated production `Env` remains empty |

## Explicit deferrals

- Workflow binding, schedule configuration, resource creation/ID, preview or production overlay, route, trigger, provisioning, upload, or deployment.
- D1/R2/Vectorize/source/secret/observability bindings or any data mutation.
- Authorized run-plan/provider scope, roster/source-register selection, provider enablement, and controlled writer identity.
- Occurrence/run/provider-run ledger writes, actual run timestamps, attempt/replay persistence, cost/error records, and idempotent transaction reconciliation.
- Child provider Workflow, provider failure isolation, source acquisition, evidence, retry/backoff/`Retry-After`, quarantine, terminal roster outcomes, bounded waits/polls, and publication.
- Mapping `completed_with_provider_failures` and zero-usable-slice outcomes to canonical run-ledger terminal states.
- Native Workflow persistence, cached-step replay, retry, schedule, interruption, restart, and remote evidence.

No traceability row advances. `PIPE-001`–`PIPE-004` remain `Planned` because no configured schedule or durable run exists. `CF-005`–`CF-007` remain `Planned` because absence of local authority is not preview/production isolation, infrastructure-as-code, secret-facility, least-privilege, or deployed evidence.

## Successor entry conditions

A successor may add operational orchestration only after it has an accepted design for:

1. exact versioned run-plan/provider-scope authority that never infers “latest” enablement;
2. canonical occurrence/run/provider-run transaction and replay reconciliation;
3. run-status mapping for full success, publishable partial success, and non-publishable terminal completion;
4. generated least-privilege Workflow/D1 bindings and isolated test/preview/production configuration;
5. bounded child creation, retry, wait/poll, deadline, and every-provider-terminal semantics; and
6. native Workflow-engine persistence/restart tests plus protected preview evidence.

Until then the exported class remains a dormant local planner only.
