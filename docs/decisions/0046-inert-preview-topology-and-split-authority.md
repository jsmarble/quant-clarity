# ADR 0046: Reserve an inert preview topology with split authority

- Status: Proposed — product-owner, spending, legal, and deployment decisions remain required
- Date: 2026-08-10
- Decision owners: Product owner (pending), staff engineer, platform lead, security and privacy lead
- Related requirements: `CF-005`–`CF-007`, `CF-009`, `CF-020`–`CF-025`, `SEC-002`, `SEC-011`, `PRIV-007`, `PRIV-011`, `OPS-006`, `OPS-008`

## Context

Phase 5P-A prevents the current repository from acquiring deployment authority, but it intentionally leaves the eventual preview topology unnamed. Implementing remote configuration before the names, capability boundaries, identities, and unresolved gates are reviewable would mix design with provisioning and make an accidental authority transition harder to detect.

Wrangler environment bindings and variables are non-inheritable, and a named Wrangler environment creates a distinct Worker whose name incorporates the environment. QuantClarity's tracked local Worker names already end in `-local`, so adding a named preview environment now would reserve misleading `-local-preview` names and introduce privileged bindings into the predeployment embargo. Cloudflare also treats routes, `workers.dev`, preview URLs, observability, and resource bindings as operational configuration rather than harmless documentation.

The project therefore needs one exact proposal that is machine checked but cannot be deployed. It must preserve the approved public/API/query/pipeline capability split, keep visitor-facing observability disabled, separate every future control-plane identity, and expose every unresolved remote choice as `null`, `false`, or `pending`.

Current platform references checked for this proposal are:

- [Cloudflare Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Cloudflare Worker routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Cloudflare workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Cloudflare Worker observability](https://developers.cloudflare.com/workers/observability/)
- [Cloudflare Worker versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Cloudflare Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

## Proposed decision

Adopt [`config/cloudflare-preview-plan.json`](../../config/cloudflare-preview-plan.json) as an inert, closed proposal mirrored exactly by code in `tools/cloudflare-preview-plan-policy.ts`. The proposal itself grants no authority. Its validator rejects any structural drift and independently rejects enabled provisioning, deployment, migration, publication, route, host, schedule, remote identifier, credential, secret value, command, cross-environment reference, created identity, or enabled observability.

Require a dedicated Cloudflare account for preview. Reserve four Worker names, two D1 names, two private R2 names, one Vectorize index name, one Workflow name, and four account-unique Rate Limiting namespace candidates. Reserve public ingress for web and API only, but keep all host and route fields `null` and both `workers_dev` and preview URLs disabled. Query and pipeline remain private. The proposal does not select a zone, domain, Workers subdomain, resource identifier, D1/R2 jurisdiction or location, R2 retention rule, Vectorize dimensions/metric, Workflow schedule, or provider credential.

Separate desired GitHub deployment environments and future Cloudflare identities by operation:

1. read-only plan and drift inspection;
2. preview resource bootstrap without normal delete authority;
3. Worker version deployment without data-write authority;
4. D1/R2/Vectorize migration and controlled data writes without route authority;
5. synthetic public probing without control-plane authority; and
6. separately protected Worker-version rollback/break-glass authority; and
7. a distinct fixed publication-pointer rollback authority.

All seven identities and GitHub environments remain uncreated. No credential reference or effective permission set is stored. The named `automation_action_allowlist` values are desired workflow/tool restrictions, not claims about provider-enforced token granularity. Current Cloudflare write scopes can be broader than those operation allowlists, including destructive capability; exact permission scopes remain a later current-platform validation. Dedicated-account containment, a short-lived bootstrap credential revoked after use, protected fixed-method automation, and independent approval are required wherever provider permissions cannot exclude deletion.

Keep web, API, and query observability disabled under the zero-visitor-data rule. Reserve `DEPLOYMENT_ENV=preview` for web and API, and `DEPLOYMENT_ENVIRONMENT=preview` plus a `null` `PUBLIC_API_ORIGIN` for query. Pipeline has no environment variable reservation because its current code and accepted design require none. The web and API `RATE_LIMIT_HMAC_KEY` binding names are the same, but their eventual secret values must be distinct and independently installed. Keep pipeline observability disabled until a closed non-visitor event schema, DLP canaries, sinks, retention, and access policy are approved and tested. Reserve no AI binding. ADR 0045 remains proposed and `CF-009` remains pending, so the Vectorize index policy is unresolved and no semantic resource may be provisioned from this ADR.

Reserve but do not select two possible future smoke mechanisms: API/web version preview URLs with complete privacy and non-indexing controls, or a separately reviewed private probe Worker. Query and pipeline remain ineligible for public smoke ingress. A successor authority must choose and validate exactly one mechanism. Accepted [ADR 0047](0047-api-query-environment-continuity.md) supplies the local closed API binding, exact forwarding, and actual workerd mismatch prerequisite. Any future preview configuration must reproduce that contract with protected `preview` values and pass a remote crossed-binding probe before it becomes deployable.

## Consequences

- Reviewers can audit the intended preview capability graph without creating a deployable file.
- The code-owned exact mirror makes additions as visible as mutations; a permissive optional field cannot silently become authority.
- Dedicated-account isolation is stronger than name-prefix isolation but adds an account/bootstrap decision and possibly cost.
- Separate preview Wrangler files remain the likely later implementation because they preserve accepted local names, but this ADR does not authorize or add them.
- A later accepted ADR or explicit owner decision must replace `null` and `pending` values with exact remotely verified configuration, add protected workflows, and change the embargo as a reviewed boundary.
- The proposed limiter namespace numbers are reservations only. Cloudflare requires namespace identifiers to be account-unique, so a remote collision audit must pass before they become configuration.
- Worker version rollback cannot roll back D1, R2, or Vectorize state. Later migration design must remain backward compatible, and publication rollback remains an independent protected pointer operation.

## Alternatives considered

- **Add preview Wrangler files now:** rejected because it would introduce privileged, potentially provisionable configuration before identifiers, authority, and gates exist.
- **Use named `env.preview` blocks under the local configurations:** rejected because current top-level names would produce `-local-preview` Workers and bindings/variables must still be repeated exactly.
- **Use one broad deployment identity:** rejected because Worker, route, data, provisioning, probing, Worker rollback, and publication rollback capabilities have different blast radii.
- **Enable workers.dev temporarily:** rejected because even a temporary endpoint is a route decision and a public deployment, not an inert reservation.
- **Share a Cloudflare account and rely only on prefixes:** rejected for the proposal because the approved isolation gate requires stronger preview-to-protected-environment mutation prevention and no remote account inventory exists yet.

## Validation

- `npm run preview-plan:check` parses the checked-in JSON and requires exact equality with the code-owned proposal.
- Hostile tests cover every authority flag plus representative identifiers, jurisdiction/location fields, routes, hosts, schedules, smoke exposure, observability, credentials, secret values, commands, binding classes, limiter reservations, cross-environment access, and GitHub environment state.
- Phase 5P-A continues to reject any new Wrangler configuration, deployment workflow, Cloudflare credential reference, or mutation command.
- No traceability row advances from this proposed topology; remote isolation, protected environment, privacy, legal, cost, rollback, and deployment evidence remain pending.
