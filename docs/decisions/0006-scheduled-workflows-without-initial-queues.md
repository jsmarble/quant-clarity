# ADR 0006: Use scheduled Workflows without initial Queues

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, pipeline lead
- Related requirements: G-06, SM-01, SM-11, PIPE-001–PIPE-019, PIPE-040–PIPE-045, CF-004–CF-007, CF-021–CF-024, NFR-009, OPS-002–OPS-006
- Supersedes: None

## Context

Provider refreshes start twice weekly, may exceed an ordinary Worker invocation, require durable bounded retries, and must isolate one provider's failure from the others. Initial scale is four providers and approximately 80 offerings. Adding both Workflows and Queues before measured backpressure exists would introduce two delivery and retry state machines.

## Decision

Use a directly scheduled Cloudflare Workflow as the global run coordinator. Configure the Monday and Thursday UTC expressions on the Workflow binding as code. Derive an immutable occurrence ID from the schedule name and scheduled time, independent of code deployments. Each execution records its own run ID, occurrence ID, attempt number, scheduled and actual timestamps, code/schema/policy versions, expected provider roster, status, and cost counters; an intentional replay links to the prior attempt without changing the occurrence.

The coordinator creates one independently identified provider Workflow instance per enabled provider. Each provider Workflow uses named durable steps for:

1. source-policy and roster loading;
2. allowlisted retrieval;
3. evidence redaction and retention;
4. deterministic or AI-assisted extraction;
5. exact-applicability and schema validation;
6. anomaly re-retrieval;
7. canonical idempotent writes;
8. terminal run reporting.

Use bounded exponential retries with provider-specific limits and `Retry-After` handling. Step bodies and writes are idempotent by occurrence, attempt, provider, offering, observation, and evidence IDs. Permanent errors and exhausted retries create machine-readable quarantine or failure outcomes. The coordinator waits or polls for every provider's terminal outcome and may build a publication from successful providers while retaining failed providers' last-known-good stale records.

Do not provision Cloudflare Queues for the initial vertical slice or launch scale. Add Queues through a later ADR only when load tests show that Workflow concurrency, provider rate pacing, large-catalog fan-out, or downstream backpressure cannot be handled cleanly by Workflow steps.

Official references:

- [Trigger and schedule Workflows](https://developers.cloudflare.com/workflows/build/trigger-workflows/)
- [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [Workflow sleeping and retries](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)

## Consequences

- Durable step state, retries, and provider isolation are handled by one orchestration primitive.
- Scheduled pipeline code has no public HTTP trigger.
- Each provider can be enabled, disabled, retried, or quarantined independently.
- Workflow step names, return sizes, CPU, subrequests, and retry semantics require explicit budgets.
- The coordinator must avoid unbounded polling and record terminal outcomes even when a child instance fails unexpectedly.
- Future very large catalogs may justify Queue-based fan-out, but that complexity is deferred until evidence exists.

## Alternatives considered

- A Cron Trigger calling an ordinary Worker: rejected because durable work, retries, and restarts would require a custom state machine.
- Cron Trigger that starts Workflows: viable, but direct Workflow schedules remove an unnecessary trigger Worker.
- Queues for every adapter item at launch: rejected as premature operational complexity at the stated scale.
- One Workflow containing all providers: rejected because provider failure isolation, independent replay, and per-provider observability would be weaker.
- Durable Objects as the orchestration engine: rejected because Workflows directly provide durable steps, retries, and schedules.

## Validation

- Simulate transient, permanent, rate-limited, timeout, schema-drift, and platform-restart failures.
- Prove duplicate schedule delivery and manual replay do not duplicate observations or facts.
- Prove one failed provider cannot block successful providers from reaching a publishable state.
- Verify every roster item reaches a machine-readable terminal outcome and no item disappears silently.
- Load-test initial and tenfold catalog sizes against current Workflow limits, CPU, subrequests, duration, and cost.
- Confirm schedule expressions, UTC interpretation, bindings, and environment isolation from version-controlled configuration.
