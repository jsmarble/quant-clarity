# ADR 0058: Export a dormant unbound PublicationWorkflow planner

- Status: Accepted for local implementation
- Date: 2026-08-11
- Decision owners: Staff engineer, Cloudflare workflow architect, pipeline lead, security and privacy lead
- Related requirements: `PIPE-001`–`PIPE-004`, `CF-005`–`CF-007`
- Extends: ADRs 0006, 0014, and 0046
- Supersedes: None

## Context

ADR 0006 selects a directly scheduled Cloudflare Workflow as the eventual global pipeline coordinator, while ADR 0014 makes the schedule name plus scheduled UTC instant the durable input to occurrence identity. The accepted predeployment embargo still forbids Workflow, D1, R2, source, and deployment authority in the pipeline Worker's tracked Wrangler configuration. The inert preview topology reserves `PublicationWorkflow` and the preview resource name `quant-clarity-publication-preview`, but leaves that resource unprovisioned, unbound, and unscheduled.

The next safe local increment needs to prove that the real Cloudflare `WorkflowEntrypoint` class shape, direct-schedule event boundary, and deterministic occurrence planning can exist in the pipeline Worker without silently activating the pipeline. It must not invent provider enablement, open a canonical run, write the run ledger, launch child Workflows, acquire a source, or imply that Workflow persistence and restart behavior have been exercised.

Current canonical storage and runtime-neutral control logic also expose boundaries that this increment cannot resolve safely:

- a `PipelineRun` requires a nonempty authorized provider scope, but no closed production/preview run-plan authority exists;
- canonical `provider_run` insertion requires approved roster and source-register state;
- the runtime-neutral coordinator's `completed_with_provider_failures` result does not map directly to the canonical run-ledger status vocabulary in every publishable and non-publishable case; and
- a child Workflow binding, D1 binding, retry policy, terminal-outcome protocol, and bounded coordinator wait strategy remain absent.

Implementing any of those behind casts, handwritten environment types, inferred “latest” rows, or dormant configuration would create authority not granted by the repository policy.

## Decision

### Stable logical schedule identity

Approve `provider-refresh-v1` as the environment-neutral logical schedule name for deterministic occurrence identity. It is distinct from every Cloudflare Workflow resource name, Worker name, binding name, environment name, deployment version, and platform instance ID.

`provider-refresh-v1` is a durable, migration-sensitive identity input under ADR 0014. Changing it changes the occurrence key and deterministic `occ_` identifier for the same scheduled UTC instant. Any replacement therefore requires an explicit compatibility/migration decision and tests; it is not an ordinary configuration rename.

The preview-only reserved Cloudflare Workflow resource name remains `quant-clarity-publication-preview`. It is validated by this local preview-shaped planner but is not the logical schedule identity. A future production resource name must be chosen through protected production configuration and a successor decision; it must not replace or silently redefine `provider-refresh-v1`.

The accepted schedule expression remains `0 5 * * 1,4`, meaning Monday and Thursday at `05:00 UTC`. This increment validates that expression but does not place it in Wrangler configuration or cause it to run.

### Actual class without activation authority

Export a named `PublicationWorkflow` class from the pipeline Worker. It extends `WorkflowEntrypoint<CloudflareEnv, Record<string, never>>` using the Wrangler-generated empty production `CloudflareEnv`. It does not read `this.env`, cast an absent capability, or introduce a handwritten production environment interface.

The existing default pipeline fetch handler remains the fixed private `404` control-plane response. No public route or trigger is added.

A class export is not treated as Workflow registration or provisioning. Current Cloudflare configuration requires a `workflows` entry containing a binding, resource name, and matching exported `class_name`; recurring execution additionally requires `schedules`. The tracked pipeline Wrangler configuration contains none of those fields, so the class has no production, preview, or local Workflow binding and no schedule. See Cloudflare's current [Workflow Workers API](https://developers.cloudflare.com/workflows/build/workers-api/), [Wrangler Workflow configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#workflows), and [direct schedule guide](https://developers.cloudflare.com/workflows/build/trigger-workflows/).

`wrangler types` remains the only production binding-type authority. This ADR does not permit editing generated binding declarations by hand.

### Closed scheduled-event admission

The planner treats the Workflow event as runtime-untrusted despite its TypeScript generic. Cloudflare documents that a type parameter does not validate incoming event data. The local boundary therefore accepts only an exact own-data event with:

- `payload`, `timestamp`, `instanceId`, `workflowName`, and `schedule` and no additional, inherited, symbolic, or accessor properties;
- an absent, null, or exact empty own-data payload;
- bounded printable-ASCII platform instance and Workflow identities;
- exact preview Workflow name `quant-clarity-publication-preview`;
- a valid platform `Date` not preceding the scheduled instant;
- an exact schedule object containing only `cron` and `scheduledTime`;
- exact cron `0 5 * * 1,4`; and
- a nonnegative, safe-integer, ECMAScript-Date-representable scheduled time that resolves exactly to Monday or Thursday at `05:00:00.000 UTC`.

Missing schedule metadata rejects manual invocation. Payload fields cannot enable execution, supply an environment, choose providers, set a writer, request a replay, provide a URL, or select a step.

Validation failures use a closed non-sensitive error-code vocabulary. The actual entrypoint converts those failures to Cloudflare `NonRetryableError`; it never interpolates event, payload, source, credential, or provider values into the error.

### One pure durable step

The planner derives one non-authoritative occurrence plan with the existing runtime-neutral pipeline core. Planning uses only the approved logical schedule and scheduled UTC instant. Platform delivery time and platform instance ID cannot change the occurrence key or `occ_` ID.

The output contains exactly:

- `plan_version = "dormant-publication-workflow-plan@1"`;
- fixed dormant/no-I/O authority and `execution_authority = false`; and
- occurrence ID, occurrence key, logical schedule name, schedule expression, and canonical scheduled time.

It intentionally omits occurrence creation time rather than inventing an observed timestamp, and it contains no run ID, provider scope, writer, attempt, replay, cost, source, credential, error detail, binding state, or platform instance identity.

The complete plan is validated and built before entering one step named `dormant-publication-plan-v1`. Invalid scheduled events enter no step. The step callback returns only the already closed pure plan, giving the Workflow engine one small serializable result while performing no binding, network, storage, clock, random, logging, telemetry, or other side effect. Cloudflare requires a Workflow definition to contain at least one step and requires durable state to be returned from a step; see the current [Workers API](https://developers.cloudflare.com/workflows/build/workers-api/), [events and parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/), and [Workflow rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/).

### Application limits and current platform constraints

The application accepts exactly one step and caps the serialized plan below 4,096 characters. It does not use event parameters for authority, streaming step output, sleeps, retries, child creation, polling, or subrequests.

As verified against official documentation and installed Wrangler `4.120.0` on 2026-08-11, Cloudflare currently documents a 1 MiB event-payload limit, a 1 MiB ordinary non-stream step-result limit, and 10,000 default configurable Workflow steps with a documented paid-plan maximum of 25,000. The local planner remains far below those ceilings. These are observations, not permanent product assumptions; a successor binding or activation decision must recheck the [current Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/) and installed Wrangler schema.

The slice does not rely on undocumented batch idempotency, Workflow completed-state retention as an audit store, or a remote Workflow binding. It makes no cost or production-capacity claim.

### Evidence boundary

Local verification may prove:

- deterministic Monday/Thursday occurrence identity and duplicate-delivery invariance;
- hostile event/payload rejection before a step;
- one fixed step name, replay-stable callback output, sub-4-KiB serialization, and absence of source/network/log calls;
- the real entrypoint class and fixed default `404` executing inside workerd through a direct method invocation; and
- a telemetry-disabled Wrangler dry-run bundling the exported class while reporting no bindings.

Directly invoking `PublicationWorkflow.prototype.run` inside workerd with a fake step is not native Workflow-engine evidence. It does not prove registration, step persistence, cached replay, retry behavior, interruption recovery, scheduling, instance lifecycle, or restart semantics. Likewise, `wrangler deploy --dry-run` proves bundle/config compatibility and absence of bindings; it does not provision, upload, deploy, schedule, or run a Workflow.

Native Workflow tests require a Workflow binding. A test-only Miniflare binding is technically possible under Cloudflare's current [Vitest configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/) and [Workflow test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/), but programmatic creation is a manual event and does not reproduce direct-schedule metadata. Native scheduled execution, durable step reuse, and restart evidence therefore remain successor acceptance criteria after a reviewed binding and test topology exist.

### Explicit deferrals

This ADR does not authorize or define:

- a tracked Workflow binding, direct schedule, local/preview/production overlay, resource ID, route, trigger, deployment, or provisioning command;
- a D1, R2, Vectorize, service, source, secret, credential, observability, log, trace, metric, or alert binding;
- provider enablement, an expected roster, source-register selection, provider scope, run-plan storage, or “latest approved” inference;
- occurrence/run-ledger persistence, actual start/end time, run attempt/replay admission, provider-run insertion, writer identity, cost, or error-summary storage;
- parent/child Workflow creation, provider execution, source retrieval, evidence handling, retries, `Retry-After`, polling/events, deadline handling, terminal coordination, or publication;
- the canonical mapping for `completed_with_provider_failures`, including the zero-usable-slice case; or
- native Workflow persistence/restart evidence, preview deployment, production observation, or any traceability-status advancement.

## Consequences

- The actual platform class and scheduled-occurrence boundary become locally reviewable without weakening the predeployment embargo.
- The logical schedule identity is stable across environments and cannot be confused with a preview-only Cloudflare resource name.
- Invalid/manual input fails closed, while a valid scheduled event can produce only a visibly dormant, non-authoritative plan.
- The generated production environment stays empty and no hidden capability can be reached.
- The next platform slice has explicit blockers instead of a partial run-ledger or provider implementation that could be mistaken for durable orchestration.
- Every related traceability row remains `Planned` because no schedule, binding, durable run, provider isolation, deployment, or remote evidence exists.

## Alternatives considered

- **Add the Workflow binding and schedule now:** rejected because current predeployment policy forbids them and protected environment/resource/deployment authority is absent.
- **Implement D1 occurrence/run writes behind an injected port:** rejected because provider-scope/run-plan authority and canonical terminal-status mapping are unresolved; a partial ledger write could create misleading operational state.
- **Export only a runtime-neutral function:** rejected because it would not prove that the actual `WorkflowEntrypoint` class can coexist with the unbound Worker and generated environment.
- **Handwrite an `Env` with future bindings:** rejected because it would conceal configuration drift and violate the generated-type rule.
- **Use the preview Workflow resource name as occurrence identity:** rejected because resource names are environment-specific while ADR 0014 requires a durable logical identity independent of deployment topology.
- **Use `provider-refresh` from an existing test fixture:** rejected because an unversioned fixture name was not an approved durable identity input.
- **Create an empty `PipelineRun`:** rejected because pipeline-core correctly requires a nonempty authorized provider scope.
- **Infer enabled providers from active/provider/roster/source rows:** rejected because those tables do not constitute a closed versioned run-plan authority.
- **Claim native durability from workerd invocation or dry-run:** rejected because neither exercise passes execution through the Workflow engine.

## Validation

- Prove the stable `provider-refresh-v1` Monday and Thursday golden occurrence IDs and invariance to platform delivery time and instance ID.
- Reject missing/manual schedule metadata, wrong cron/day/hour/sub-minute time, invalid dates, early platform timestamps, nonempty payloads, unapproved Workflow names, additional/symbolic/inherited fields, accessors, and hostile object traps before a step.
- Prove fixed non-sensitive error codes and `NonRetryableError` conversion at the real entrypoint boundary.
- Prove exactly one deterministic step, replay-identical output, a closed frozen plan below 4,096 serialized characters, and no fetch/log/binding/storage/clock/random effect.
- Run the planner unit suite, pipeline workerd suite, strict type-check, privacy/configuration checks, generated-type drift check, and telemetry-disabled Wrangler dry-run.
- Confirm the tracked pipeline Wrangler configuration and generated `CloudflareEnv` contain no Workflow or data binding and the dry-run reports no bindings.
- Document that direct workerd invocation and dry-run are not native Workflow persistence, retry, scheduling, or restart evidence.
- Keep `PIPE-001`–`PIPE-004` and `CF-005`–`CF-007` at `Planned`; implementation is a local prerequisite only.
