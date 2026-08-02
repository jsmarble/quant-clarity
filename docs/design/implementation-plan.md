# QuantClarity implementation and release plan

| Attribute | Value |
|---|---|
| Status | Approved and in progress; product-owner approval recorded 2026-08-01 |
| Authority | Approved PRD, approved system design, and accepted ADRs |
| Traceability | [`traceability.md`](traceability.md), [`verification-plan.md`](verification-plan.md) |
| Scope | Vertical slice through four-provider production release |

This plan is a delivery sequence, not approval to scaffold code, provision resources, or publish data. A phase advances only when its exit evidence exists. Unknown provider facts and failed gates remain explicit; schedule pressure never weakens evidence, neutrality, privacy, accessibility, security, cost, or atomic-publication controls.

## Non-delegable approvals

Agent execution and technical review cannot grant legal, product, spending, or public-release authority. The named authorized owner must record approval before: accepting a source/legal register; selecting code or dataset/API terms; clearing a name/domain; creating paid Cloudflare resources beyond an already accepted budget; enabling a provider in production; deploying production; or making the first public publication. Design approval authorizes implementation only to the extent explicitly stated by the owner; it does not silently grant those later decisions.

## Phase 0 — governance transition

Status: complete on 2026-08-01. The approved privacy amendment added ADR 0011 and its release gates before runtime scaffolding; the approved frontend amendment added ADR 0012. The governance baseline is committed separately from the runtime foundation. Preview, migration, and deployment commands remain intentionally gated until their corresponding resource inventory and protected environments exist.

Trigger: satisfied by explicit product-owner approval of the design and Section 2.4 defaults on 2026-08-01.

1. Record the accepted defaults in `docs/product/decision-log.md` without changing PRD semantics.
2. Mark the system design `Approved`, mark ADRs `Accepted`, and record the approval date/owner.
3. Update `AGENTS.md` and `README.md` from system-design to implementation phase.
4. Add the exact supported setup, format, lint, type-check, unit, integration, build, preview, migration, dry-run, and deployment commands to `AGENTS.md` after the installed toolchain proves them.
5. Commit the approved design separately from runtime scaffolding so the governance boundary is reviewable.

Exit evidence: approved design state is internally consistent, `git diff --check` passes, and no trace row advances beyond `designed`.

## Phase 1 — reproducible foundation and machine contracts

Status: complete on 2026-08-01. PR #1 established the pinned workspace, strict checks, generated contracts, privacy/docs checks, CI, Worker dry-run surfaces, and guarded frontend shell. The Phase 2 branch preserves those gates.

1. Pin Node/npm, create the npm-workspace layout from ADR 0001, install only approved production/development dependencies, and commit one lockfile.
2. Establish strict TypeScript, formatting/linting, deterministic test configuration, dependency/license/secret scanning, and Wrangler 4 JSONC/type generation.
3. Generate versioned JSON Schemas and OpenAPI 3.1 from the approved canonical/API/adapter/publication contracts; examples must validate against the generated schemas.
4. Create environment inventories for local, test, preview, and production with distinct names/IDs and no secret values.
5. Add CI jobs for clean install, static checks, contract generation drift, tests, build, scans, and Cloudflare dry-run validation.

Exit evidence: reproducible clean build, generated-contract diff is empty, preview/production inventory isolation is machine-checked, and `GATE-api-contract` has an executable skeleton without claiming conformance yet.

## Phase 2 — canonical core and first lawful fixture

Status: in progress. Canonical and serving D1 migrations, constraint/property tests, adapter roster/fixture contracts, a production-disabled Fireworks adapter, synthetic non-publishable fixture, pending source register, and publication-pin ADR 0013 exist locally. Real provider acquisition and Phase 2 exit remain blocked on authorized source-register approval.

1. Implement stable IDs, resource registry/type triggers, organizations/publishers, models/variants/checkpoints/parameters, providers/offerings, typed claim scopes, observations/evidence, claims/conflicts, precision components, exact-decimal prices, schedules/runs, policies, and publication metadata.
2. Add D1 migrations plus schema/constraint/property tests for identity, typed applicability, precedence, supersession, null/unknown behavior, decimal ordering, staleness, and neutrality.
3. Prepare the Fireworks source-compliance register and credential/access review for approval by the authorized owner/legal reviewer. If approval is denied, propose the first approvable structured launch candidate without weakening the adapter contract.
4. Retain only minimal legally retainable redacted fixtures with provenance notes; seed malicious, missing, drift, pagination, conflict, price, precision, and base-object applicability cases.
5. Implement the deterministic adapter boundary with no storage access and prove every roster item reaches a terminal result.

Exit evidence: canonical and adapter contract suites pass; the local inputs of `GATE-applicability-integrity`, canonical/fixture portions of `GATE-evidence-dlp`, and provider-fixture portions of `GATE-legal-source-register` have retained partial artifacts. The composite gates remain pending until their preview/other declared inputs and approvals exist.

## Phase 3 — durable acquisition and evidence pipeline

Status: in progress. Runtime-neutral pipeline and acquisition-security kernels now implement locally testable scheduling, idempotency, retry, anomaly, destination, policy, budget, and pre-retention evidence decisions. They perform no I/O. Workflow/D1 integration, live source access, D1/R2 writes, DNS/fetch/browser execution, deployed canaries, and preview resources remain pending their existing approval and environment gates.

1. After explicit budget/resource authorization, provision only the bounded preview frontend/API/query/pipeline Workers, D1, R2, Vectorize, Workflow, limiter, AI, and observability resources required by the vertical slice from checked-in inventory. Apply deletion protection and run preliminary preview/production-identity isolation checks; no production data/resource may exist yet.
2. Implement the directly scheduled parent Workflow and independently identified provider child instances with occurrence/run/attempt identities and bounded idempotent steps.
3. Implement exact-host acquisition, manual redirects, byte/time/page ceilings, DNS defense-in-depth, deployed SSRF canaries, robots/Content Signals policy evaluation, and Browser Sessions only when an approved source requires them.
4. Apply streaming/in-memory minimization, DLP, and redaction before any durable state, hash, log, fixture, or AI input; promote only verified redacted evidence to locked R2 retention.
5. Implement deterministic extraction/validation first, anomaly re-fetch, quarantine, last-known-good carry-forward, cost admission control, and complete machine-readable run reports.
6. Keep generative extraction disabled until a separately accepted Workers AI gold-set policy requires it; external AI remains an ADR amendment and `CF-009` exception.

Exit evidence: restart/retry/idempotency/failure-isolation tests pass; `GATE-source-egress-security`, `GATE-extraction-adversarial`, and pipeline portions of `GATE-evidence-dlp` pass in isolated preview.

## Phase 4 — atomic publication, backup, and search

Status: in progress. A runtime-neutral publication kernel now provides locally testable immutable-closure hashing, provider-slice/search/vector inventory, readiness, activation/rollback, switch-history, backup-manifest, and no-pruning decisions under [ADR 0015](../decisions/0015-publication-closure-and-lifecycle.md). [Phase 4B](phase-4b-serving-dispositions.md) adds local serving-D1 persistence for null unavailable dispositions and stable carried-forward lineage under [ADR 0017](../decisions/0017-provider-disposition-persistence.md). [Phase 4C](phase-4c-sealed-closure.md) and [ADR 0018](../decisions/0018-sealed-serving-closure-persistence.md) add exact persisted closure projection. [Phase 4D1](phase-4d1-readiness-ledger.md) and [ADR 0019](../decisions/0019-seal-bound-readiness-ledger.md) add local publication-scoped FTS, four typed receipt projections, complete-vector evidence fields, one immutable readiness attestation, and a seal-bound `building` to `ready` gate while head switching remains closed. Phase 4D2 switch history, deployed D1 batches, R2 archive proof, Cloudflare Vectorize visibility, the provider-name search projection, populated-cache chaos, writer-drained backup, isolated restore, physical pruning, preview resources, and all composite gates remain pending.

1. Build immutable serving projections and FTS documents from one validated provider slice.
2. Create exactly one Vectorize vector per model/explicit variant and implement D1 eligibility, bounded semantic batches, deterministic merge, degradation, and provider-count neutrality.
3. Implement candidate readiness probes and the single transactional publication-head switch; API and SSR caches resolve the head before selecting publication-keyed entries.
4. Implement pointer rollback, hot generation retention, canonical writer-drained consistent backup, logical serving export, FTS/Vectorize reconstruction, integrity manifests, and isolated restore.
5. Exercise failure injection at every publication phase and with populated multi-PoP caches.

Exit evidence: local decision evidence is recorded in [`phase-4-local-kernel.md`](phase-4-local-kernel.md), [`phase-4b-serving-dispositions.md`](phase-4b-serving-dispositions.md), [`phase-4c-sealed-closure.md`](phase-4c-sealed-closure.md), and [`phase-4d1-readiness-ledger.md`](phase-4d1-readiness-ledger.md). Phase 4D2 must follow the attested-ready boundary with immutable switch history and exact-generation activation/rollback. `GATE-publication-chaos`, `GATE-search-acceptance`, and `GATE-restore-and-rebuild` still must pass for the deployed vertical slice before Phase 4 exits.

## Phase 5 — public API and bounded edge

Phase 5A first implements the pure, storage-free decision boundary in [ADR 0016](../decisions/0016-bounded-local-api-read-protocol.md): bounded validation before limiter effects, versioned authenticated cursors, closed live-only service envelopes, publication-aware conditional responses, fixed trusted cache origin, injected ceilings, and exact/structured search with public semantic processing disabled. Its scope and non-claims are recorded in [`phase-5a-local-api-kernel.md`](phase-5a-local-api-kernel.md). This local work does not advance any traceability row beyond `Planned` or replace the runtime steps below.

1. Implement the non-routable SELECT-only query Worker and storage-free public API Worker with typed service-binding operations.
2. Implement every collection/detail route, `Fact<T>` provenance, metadata/next-refresh, exact decimals, filters/sorts, authenticated cursors, CORS, ETags, publication pinning, stable errors, and OpenAPI examples.
3. Enforce method/query/filter/cursor/result/response/CPU/subrequest/semantic-call bounds and rate-limit every request before head/cache resolution.
4. Disable automatic invocation logs/traces, Tail/Logpush export, Analytics Engine request events, Web Analytics, and custom telemetry Worker-wide; enforce no retained request ID, no public query embedding until processor approval, no visitor-derived cache keys, and validate seeded privacy canaries against every allowed sink.

Exit evidence: API conformance, abuse/load, cache/version, privacy, and no-mutation penetration suites pass; `GATE-api-contract`, `GATE-api-abuse`, and API portions of `GATE-cost-fail-safe` pass.

## Phase 6 — accessible model-first web product

1. Build Astro SSR/static surfaces for home/search, model/variant/family/provider/detail, Model Facts, Offering Facts, methodology/history/change log, API docs, privacy/legal/non-affiliation/API/dataset terms, sitemap, and robots.
2. Keep model cards limited to model facts plus the distinct active non-stale provider count; pass provider eligibility separately and never provider-rank cards.
3. Implement neutral offering tables with explicit currency scopes, URL state, progressive enhancement, unknown/stale/inactive states, and no recommendation/winner language.
4. Apply SSR/static security headers with no third-party analytics/connect origins, global `no-referrer`, preview `noindex`, zero visitor telemetry/browser storage, safe source rendering, and direct static referral-link isolation/disclosures when that feature is later enabled.
5. Test raw HTML without JavaScript, keyboard/focus/screen readers, 320-pixel layout, 200%/400% zoom, contrast/reduced motion, and versioned performance profiles.

Exit evidence: primary journeys pass the preview-applicable inputs of `GATE-manual-a11y`, `GATE-performance`, and `GATE-neutrality-invariance`. Preview rehearsals exercise `GATE-zero-visitor-data`, `GATE-referral-zero-tracking`, `GATE-gdpr-accountability`, and `GATE-environment-isolation`, but production/legal-owner inputs remain pending until Phase 9.

## Phase 7 — CI/CD, operations, and first preview candidate

1. Make every automated trace ID resolve to a test/report artifact and fail CI on missing/orphan/duplicate mappings.
2. Reconcile the already bounded preview resources only through checked-in inventory and idempotent commands; run drift detection and protect production destructive operations.
3. Add protected GitHub deployment environments, resource-scoped rotatable Cloudflare credentials, approval gates, artifact/SBOM retention, dry runs, migrations, and independent code/data rollback.
4. Exercise alerts, cost breakers, secret rotation, source drift, quarantine, erroneous mass publication, backup/restore, search rebuild, and rollback runbooks.
5. Ask independent requirements, architecture, security/privacy, data-neutrality, accessibility, and operations reviewers to audit the preview; incorporate every blocking finding.

Exit evidence: every vertical-slice composite gate whose declared inputs/environments exist passes, all production-only gates remain explicitly pending, and one reviewed preview candidate is reproducibly deployable.

## Phase 8 — four-provider launch dataset

For each remaining provider independently:

1. Obtain authorized approval of the dated legal/source register and exact expected roster.
2. Add minimal redacted fixtures and deterministic parsing before considering AI/browser use.
3. Run adapter, applicability, DLP, egress, drift, cost, and failure-isolation gates.
4. Publish only to preview, compare all neutral invariants, and keep the adapter disabled in production even when every preview roster item is terminal and evidence-backed.

Exit evidence: exactly four production-ready but production-disabled provider adapters form a reviewed preview candidate. Each has at least the default 20 active non-stale offerings or an explicit documented product-owner amendment; `GATE-provider-launch` remains pending production runs.

## Phase 9 — production observation and release

1. Obtain authorized brand/domain clearance or choose an authorized cleared replacement; obtain product/legal approval for distinct code license and dataset/API terms.
2. After explicit spending/deployment authorization, provision production from inventory, verify no preview identity can mutate it, deploy read services, then enable approved providers and run the first controlled pipeline/publication independently.
3. Keep the release under manual approval while `GATE-provider-launch` obtains current production-run evidence and Monday/Thursday production runs complete successfully for two consecutive weeks; a failed or quarantined occurrence is not success.
4. Gather the signed release-manifest inputs for all 24 `RGA-REL-AC-*` coordinators, execute final restore/rollback/search rebuild, security/privacy, accessibility, performance, cost, legal, repository, and operational checks.
5. Publish only when every release coordinator and required composite gate passes with current artifacts and no unapproved exception.

Exit evidence: the production URL/API, Cloudflare resources, GitHub settings/actions, signed release manifest, four-provider dataset, two-week run history, and monitoring prove every `REL-AC-01`–`REL-AC-24` item. Only then may the project be described as live and production-ready.

## Stop conditions

Stop the affected workstream and preserve last known good when any of these occurs:

- PRD ambiguity or semantic contradiction requiring product-owner interpretation.
- Missing/expired source permission, terms/robots prohibition, credential leak, failed SSRF/DLP canary, or unretainable evidence.
- Claim applicability conflict, unsupported fact, schema drift, or anomaly that cannot be resolved deterministically.
- Publication/search/version probe failure, backup inconsistency, restore failure, or rollback-target loss.
- Neutrality, accessibility, privacy, security, performance, cost, or environment-isolation gate failure.
- Budget breaker, provider roster shortfall, name/domain failure, or missing two-week production evidence.

These conditions block only the unsafe publication/provider/workstream where isolation is possible; they do not authorize silent omission, inference, or weakening a gate.
