# Phase 5P-B: inert preview topology proposal

| Attribute | Value |
|---|---|
| Status | Proposed topology and local fail-closed checker implemented; no remote or deployment authority |
| Decision | [Proposed ADR 0046](../decisions/0046-inert-preview-topology-and-split-authority.md) |
| Requirements | `CF-005`–`CF-007`, `CF-009`, `CF-020`–`CF-025`, `SEC-002`, `SEC-011`, `PRIV-007`, `PRIV-011` |
| Release gates | Local proposal prerequisite only; no release-gate status advances |

## Purpose and authority boundary

This phase makes the intended preview topology reviewable before any resource, route, identity, credential, protected GitHub environment, or deployment workflow exists. [`config/cloudflare-preview-plan.json`](../../config/cloudflare-preview-plan.json) is a proposal, not Wrangler configuration, infrastructure as code, a resource manifest, or permission to spend, provision, migrate, publish, or deploy.

The code-owned proposal is the only accepted local shape. Its checked-in JSON must match byte-for-structure after parsing, and duplicate decoded JSON properties are rejected before construction. Every field that could identify or activate remote state is closed: authority flags are `false`; account, zone, Workers subdomain, host, route, resource identifiers, D1/R2 jurisdiction and location, credential references/effective permissions, selected smoke mechanism, and Workflow schedule are `null`; created-state and cross-environment-access flags are `false`; and observability is disabled. Phase 5P-A still rejects any deployable preview Wrangler overlay or GitHub deployment workflow.

## Reserved topology

| Class | Reserved name | Binding/capability | Proposal state |
|---|---|---|---|
| Web Worker | `quant-clarity-web-preview` | Static `ASSETS`; `API` service; web limiter pair; protected HMAC binding name; `DEPLOYMENT_ENV=preview` | Unrouted; no storage, AI, or pipeline control |
| API Worker | `quant-clarity-api-preview` | `CATALOG_QUERY` service to `CatalogQueryService`; API limiter pair; protected HMAC binding name; `DEPLOYMENT_ENV=preview` | Unrouted; no storage, AI, or pipeline control |
| Query Worker | `quant-clarity-query-preview` | `SERVING_DB`; `DEPLOYMENT_ENVIRONMENT=preview`; unresolved `PUBLIC_API_ORIGIN` | Private service binding only; API origin remains `null`; no AI until `CF-009` passes |
| Pipeline Worker | `quant-clarity-pipeline-preview` | Canonical/serving D1, evidence/backup R2, Vectorize, reserved Workflow control | Private; no route; Workflow implementation absent |
| Canonical D1 | `quant-clarity-canonical-preview` | `CANONICAL_DB` | Identifier, jurisdiction, and location absent; unprovisioned |
| Serving D1 | `quant-clarity-serving-preview` | `SERVING_DB` | Identifier, jurisdiction, and location absent; unprovisioned |
| Evidence R2 | `quant-clarity-evidence-preview` | `EVIDENCE_BUCKET` | Private; identifier, jurisdiction/location, and retention policy absent |
| Backup R2 | `quant-clarity-backup-preview` | `BACKUP_BUCKET` | Private; identifier, jurisdiction/location, and prefix retention policy absent |
| Vectorize | `quant-clarity-search-preview` | `SEARCH_INDEX`; publication ID reserved as namespace | Identifier, dimensions, metric, and accepted embedding policy absent |
| Workflow | `quant-clarity-publication-preview` | `PUBLICATION_WORKFLOW`; `PublicationWorkflow` class reserved | Identifier and schedule absent; class not implemented |

The two R2 buckets separate evidence retention from backup/recovery prefix rules. Evidence requires at least 24 months of lock coverage; accepted recovery artifacts can require indefinite prefix lock coverage. The proposal deliberately records both policies as pending so no broad lifecycle rule can shorten either requirement.

The four Rate Limiting namespace candidates are reservations only:

- API `READ_LIMITER`: `2101`
- API `ROTATION_LIMITER`: `2102`
- Web `READ_LIMITER`: `2301`
- Web `ROTATION_LIMITER`: `2302`

They require a read-only account-wide collision check before use. The repository cannot prove account uniqueness.

## Ingress, privacy, and observability

Web and API are intended to become the only public Workers, but this proposal selects no host or route. `workers_dev` and preview URLs remain disabled. Query and pipeline have no public ingress. The proposal reserves two mutually exclusive future smoke mechanisms—API/web version preview URLs with full noindex/privacy checks, or a separately reviewed private probe Worker—but selects neither. A successor authority must choose and validate one before an uploaded version can be exercised. A domain/zone decision must establish exact web and API HTTPS origins before `PUBLIC_API_ORIGIN`, CORS, CSP, canonical URL, and non-indexing evidence can be finalized.

Web, API, and query logs, invocation logs, traces, destinations, custom request telemetry, and visitor-derived state remain disabled. Pipeline observability also remains disabled until its closed non-visitor event schema, allowed sinks, retention, access, DLP rules, and silence alert are implemented and reviewed. This phase creates no privacy or GDPR acceptance evidence.

The protected secret binding name `RATE_LIMIT_HMAC_KEY` is inventory only for web and API. The proposal stores no value, secret identifier, alias, credential, or token. Web and API must receive distinct values despite sharing the binding name; neither value may be reused across Workers. Each Worker will require its value to be installed independently through a protected Cloudflare secret facility after authorization.

## Desired identity split

The automation allowlists below are desired tool/workflow constraints, not provider permission claims. Cloudflare write scopes may include delete or broader mutation rights. `cloudflare_permission_granularity_verified` therefore remains `false`, every effective permission set remains `null`, and the dedicated account plus protected fixed-method automation contains the blast radius until current permission evidence is approved.

| Desired GitHub environment | Future automation allowlist | Explicitly excluded operation |
|---|---|---|
| `preview-plan` | Read-only remote inventory and drift | Mutation |
| `preview-bootstrap` | Dedicated-account preview resource creation | Normal destroy and cross-environment access |
| `preview-deploy` | Worker versions/deployments | D1/R2/Vectorize writes and provider secrets |
| `preview-migrate` | Approved migrations and controlled preview data writes | Routes and Worker deployment |
| `preview-synthetic` | Fixed non-personal public probes | Control-plane and data mutation |
| `preview-worker-rollback` | Exact prior Worker-version deployment only | Data and publication mutation |
| `preview-publication-rollback` | One fixed publication-pointer rollback | Worker configuration and general data recovery |

These GitHub environments are desired names only and are all recorded uncreated. GitHub documents environment protection rules, approvals, branch restrictions, and environment-scoped secrets, but their availability and exact enforcement must be verified for the repository plan before implementation. No workflow references an environment or secret today. Storage restore and forward repair remain separately approved migration/recovery operations; no general data-rollback credential is reserved.

## Later deployment and rollback order

The following is design ordering, not executable authority:

1. Read-only inventory proves the dedicated preview account is empty of conflicting names and limiter IDs.
2. After owner/spending authorization, bootstrap creates dedicated D1, private R2, and only accepted search/control resources, records identifiers, and applies approved locks before writes.
3. Migration applies backward-compatible canonical then serving migrations by immutable database name. No provider migration or publication runs implicitly.
4. A successor authority first selects an executable smoke path. Query Worker version is uploaded and exercised only through a private service path; pipeline/Workflow follows only after the Workflow entrypoint exists, with no schedule; API follows after its environment variable is consumed and mismatch-tested; web is last. API/web version probes use only the selected future smoke mechanism.
5. Exact hosts/routes are activated only after all four versions and bindings pass privacy, isolation, non-indexing, contract, accessibility, and failure-path checks.
6. One controlled synthetic publication is a separate authorized operation. A schedule is considered only after the manual run, backup, search rebuild, and rollback pass.

Before a change, record every Worker version/deployment identifier and complete binding/config digest. Code rollback proceeds from web to API, disables pipeline scheduling before pipeline rollback, and rolls query back last after dependents are compatible. Cloudflare Worker rollback does not restore storage. D1 changes must use expand/contract compatibility; R2 objects and bucket locks are never deleted as rollback; Vectorize retains the prior publication namespace; dataset rollback is an independent, protected publication-pointer transaction. Normal automation contains no remote destroy path.

## Pending gates

Every item below blocks conversion of the proposal into provisionable configuration:

- explicit product-owner provisioning/deployment/publication authorization;
- legal/privacy processor review and provider source approval;
- product-owner disposition of proposed ADR 0045 and the resulting Vectorize dimensions/metric/recovery policy;
- preview spending authorization and budget/alert acceptance;
- preview domain, zone, and HTTPS-origin decision;
- D1/R2 jurisdiction and location decision;
- current Cloudflare permission-scope validation and protected automation design;
- exact preview smoke mechanism and its privacy/non-indexing evidence;
- API environment-variable plumbing and preview mismatch integration test;
- separate Worker-version and publication-pointer rollback authority design;
- account-wide limiter namespace collision audit;
- exact R2 bucket/prefix lock and lifecycle policy;
- dedicated account identity, token-scope, GitHub environment, and protection-rule verification;
- implemented Workflow entrypoint and non-visitor pipeline observability schema;
- remote CPU/subrequest/size/cost measurements and fixed Worker ceilings; and
- tested migration, backup, restore, search rebuild, code rollback, and independent publication rollback.

## Local verification and non-claims

`npm run preview-plan:check` rejects malformed or duplicate-key JSON, compares the parsed document to the exact code-owned proposal, and scans for authority transitions. Hostile unit tests cover all authority flags plus representative remote identifiers, jurisdiction/location, hosts, routes, schedules, smoke exposure, Worker exposure, observability, credentials, secret values, commands, cross-environment references, resource/binding drift, limiter drift, and GitHub environment creation. The check is included in `verify`, and Phase 5P-A's manifest digest makes changing or removing that script a reviewed authority event.

This phase does not create a Cloudflare account, GitHub environment, token, secret, Worker, D1 database, R2 bucket, Vectorize index, Workflow, limiter namespace, route, host, schedule, migration, publication, deployment, rollback capability, legal artifact, cost approval, or remote evidence. It does not advance `CF-005`–`CF-007` or any release gate beyond `Planned`.

Current documentation reviewed for the proposal:

- [Wrangler environments and non-inheritable bindings](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Worker routing](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Worker observability](https://developers.cloudflare.com/workers/observability/)
- [Versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [GitHub deployment environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
