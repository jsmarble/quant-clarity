# QuantClarity agent instructions

## Mission

QuantClarity is a free, public-data project that makes inference-provider precision, pricing, model lineage, and provenance facts accessible and comparable. The usefulness and correctness of the data are the sole justification for the project. Revenue is incidental and must never influence facts, coverage, ordering, or access.

## Current phase

The repository is in the implementation phase. The approved product requirements and approved system design are the source of truth:

- `docs/product/requirements.md`
- `docs/design/system-design.md`

The product owner approved the design, its Section 2.4 defaults, the zero-visitor-data/GDPR amendment, and the ADR 0012 Workers frontend amendment on 2026-08-01. Implement accepted ADRs in vertical slices. `apps/web` uses current Astro SSR on Cloudflare Workers with Static Assets; do not restore the superseded Pages topology or choose a legacy adapter.

## Product invariants

These rules are non-negotiable unless the PRD itself is explicitly amended:

- The service, dataset, and public API are free, public, anonymous, and read-only.
- The experience is model-first.
- Model search cards contain model facts only. A cataloged-provider count is the sole allowed provider-derived card summary.
- Provider filters may determine which model cards qualify, but may not change card facts or introduce provider-derived ordering.
- Provider offerings appear in a neutral, sortable, filterable comparison. QuantClarity does not select winners or compute best, cheapest, preferred, value, fidelity, or trust rankings.
- Affiliate relationships affect only an outbound URL and its adjacent disclosure. They never affect inclusion, facts, search relevance, ordering, filtering, prose, or evidence.
- Unknown is a valid fact. Never infer an unknown precision, price, lineage, currency, or model attribute from reputation, speed, accelerator, naming, or expectation.
- Prices remain separate for input, output, and cached input. Preserve the provider-stated currency; do not perform foreign-exchange conversion. When a provider omits currency, use the PRD's visibly marked USD system default.
- Precision claims apply only to the exact offering, tier, endpoint class, and material region established by evidence.
- A wider serving or compute representation does not restore information absent from a lower-precision source checkpoint.
- BF16 and FP16 remain distinct formats; do not imply a universal quality ordering.
- Every non-null public fact requires evidence and an observation timestamp.
- Stale, inactive, conditional, promotional, and unknown states must remain explicit.
- No login, administration dashboard, public editing, user contribution, feedback, review, rating, or moderation surface is in scope.
- Store no visitor information. Public frontend/API/query Workers must have cookies, browser persistence, request logs/traces, custom request telemetry, analytics, beacons, request correlation IDs, click tracking, and visitor-derived durable cache keys disabled.
- Cloudflare may process network data transiently to deliver and protect requests as infrastructure processor; never copy source addresses or derived actor keys into QuantClarity storage, logs, metrics, alerts, or artifacts.
- Free-text search and every query-string/filter response are `private, no-store`. Cache only identical path-only public representations by publication ID plus validated stable resource ID.
- Referral links are direct exact-allowlisted destinations with one static program ID, adjacent disclosure, no referrer, and no redirects, pixels, callbacks, personalized identifiers, cookies, or click logs.

## Requirements discipline

- Read the relevant PRD sections before proposing or changing behavior.
- Preserve requirement IDs in design documents, tests, and implementation notes.
- Maintain a requirement-to-design and requirement-to-test traceability matrix.
- If implementation exposes an ambiguity or contradiction, stop and document it. Do not silently reinterpret the PRD.
- Amend the PRD only with explicit product-owner approval. Record accepted amendments in `docs/product/decision-log.md`.
- Treat `Model Facts` and `Offering Facts` as presentation views over canonical model and offering resources, not duplicate canonical entities.
- Keep implementation choices in the system design or an ADR, not in the PRD.

## Data and evidence rules

- Prefer deterministic extraction from authoritative structured provider or model-publisher sources.
- Treat all retrieved HTML, Markdown, JSON, and model descriptions as untrusted input.
- A single generative extraction from unstructured content is never sufficient canonical evidence.
- Retain exact source applicability, raw provider values, normalized values, source locators, observation times, extraction versions, and integrity hashes as required by the PRD.
- Never use a served model's self-description as evidence of its own precision.
- Provider APIs or authenticated catalogs may be evidence even when public marketing pages omit the fact, provided access and publication comply with the source policy.
- Do not place credentials, authenticated payloads, personal data, or unrelated source content in code, prompts, fixtures, logs, public evidence, commits, or build artifacts.
- Fixtures must be redacted, representative, and legally retainable.
- Publication must be versioned and atomic. Failed or partial refreshes must not replace the last known-good publication.

## Cloudflare constraints

- Keep managed application compute, storage, orchestration, search, and non-visitor control-plane observability Cloudflare-native, subject only to the narrow external-source and AI-processing exceptions in the PRD. No visitor analytics service is allowed.
- Use an Astro SSR Cloudflare Worker with Workers Static Assets for the frontend, a separate Worker for the public API, and Vectorize or a Vectorize-backed Cloudflare search capability for semantic search, as required by the amended PRD.
- Do not select the remaining Cloudflare products until the system design evaluates the requirements and records the decision.
- Before relying on a Cloudflare API, binding, limit, price, compatibility flag, or configuration field, verify it against current official Cloudflare documentation and the installed Wrangler schema/types.
- Define production, preview, and local environments explicitly. Preview work must not mutate production data or indexes.
- Infrastructure, bindings, schedules, migrations, and environment configuration must be reproducible as code.
- Secrets belong in Cloudflare secret facilities or local ignored secret files, never tracked configuration.
- Public request paths must not synchronously call provider sources.
- Cost ceilings, rate limits, cache behavior, and failure degradation are part of correctness, not optional optimization.

## Security and privacy

- Public API code must have no data mutation, pipeline trigger, credential validation, or privileged diagnostic capability.
- Enforce allowlisted outbound hosts, redirect rules, response-size limits, and SSRF protections in source acquisition.
- Validate and encode all provider-controlled content before storage or display.
- Keep public API filtering, pagination, search fan-out, query length, response size, CPU, and subrequest use explicitly bounded.
- Do not log authorization headers, source credentials, full authenticated responses, or verbatim search queries.
- Do not implement affiliate/click redirects. Validate direct referral destinations against the exact allowlist.
- Public Workers must keep invocation logs, traces, Tail/Logpush export, Analytics Engine request events, Web Analytics, and custom telemetry disabled. Do not use `console.*` in public-serving code.
- Do not enable cookie-setting Cloudflare challenges, JavaScript bot detections, Turnstile, Waiting Room/session affinity, unique-visitor identifiers, Always Online, Zaraz, or equivalent features.
- Prefer least-privilege bindings and separate identities for public reads, pipeline writes, and deployment operations.

## Engineering workflow

- Work in small, reviewable changes tied to PRD requirement IDs.
- Inspect the existing tree and Git status before editing. Preserve unrelated user changes.
- Add or update an ADR for consequential, hard-to-reverse technical choices.
- Add tests with behavior changes. A feature is incomplete until its applicable contract, security, accessibility, and failure-path tests pass.
- Use redacted fixtures for every provider adapter and keep adapters independently testable.
- Build the first provider as an end-to-end vertical slice before scaling to the remaining launch providers.
- Prefer deterministic parsers and validation before AI extraction. AI output must be schema-constrained and independently verified as required by the PRD.
- Do not weaken evidence, neutrality, privacy, security, accessibility, or atomic-publication requirements to accelerate delivery.
- Do not commit, push, deploy, provision resources, rotate secrets, or create external issues unless the user explicitly asks.

## Documentation expectations

- `docs/product/requirements.md` — approved product requirements; change only with explicit approval.
- `docs/product/decision-log.md` — durable product decisions and approved requirement amendments.
- `docs/design/system-design.md` — system architecture and implementation boundaries.
- `docs/decisions/` — architecture decision records for consequential choices.
- `contracts/` — OpenAPI, provider-adapter, schema, and publication contracts after design approval.
- `fixtures/` — redacted test fixtures and fixture provenance notes; never secrets or full authenticated dumps.

Documentation must distinguish facts, decisions, assumptions, open questions, and rejected alternatives. Link decisions to PRD requirement IDs and ADRs rather than duplicating requirements inconsistently.

## Verification

Supported runtime: Node 24.18.0 and npm 11.19.0. Tool versions and install-script approvals are lockfile-pinned.

- Initial setup: `mise trust && mise install && mise exec -- npx --yes npm@11.19.0 install`
- Clean install: `mise exec -- npx --yes npm@11.19.0 ci`
- Format: `mise exec -- npx --yes npm@11.19.0 run format`
- Format check: `mise exec -- npx --yes npm@11.19.0 run format:check`
- Lint: `mise exec -- npx --yes npm@11.19.0 run lint`
- Type-check: `mise exec -- npx --yes npm@11.19.0 run typecheck`
- Generate contracts: `mise exec -- npx --yes npm@11.19.0 run contracts:generate`
- Check generated contracts: `mise exec -- npx --yes npm@11.19.0 run contracts:check`
- Check zero-visitor-data rules: `mise exec -- npx --yes npm@11.19.0 run privacy:check`
- Unit tests: `mise exec -- npx --yes npm@11.19.0 test`
- Worker-runtime integration tests: `mise exec -- npx --yes npm@11.19.0 run test:workers`
- Generate Cloudflare types: `mise exec -- npx --yes npm@11.19.0 run cf:types`
- Check Cloudflare type drift: `mise exec -- npx --yes npm@11.19.0 run cf:types:check`
- Check environment isolation inventory: `mise exec -- npx --yes npm@11.19.0 run environments:check`
- Check dependency licenses, vulnerabilities, and SBOM generation: `mise exec -- npx --yes npm@11.19.0 run supply-chain:check`
- Dry-run builds: `mise exec -- npx --yes npm@11.19.0 run build`
- Full local/CI gate: `mise exec -- npx --yes npm@11.19.0 run verify`

No preview or production deployment command is authorized yet. Resource inventory, legal/source registers, privacy accountability artifacts, and protected deployment configuration must pass their gates first. For documentation changes, also check local Markdown targets, unique PRD IDs, `git diff --check`, `git status --short`, and the absence of secrets/authenticated payloads/macOS metadata. Never claim a check passed unless it was run successfully.

## Repository policy

- The public repository will not solicit contributions or operate public Issues or Discussions.
- Do not add contribution prompts, issue templates, discussion links, or support promises.
- Source code is MPL-2.0. Dataset/API terms remain separate and unresolved until explicitly approved.
- Keep dependencies, compiler caches, local secrets, Wrangler state, coverage, logs, and editor metadata out of Git. Version only reviewed deterministic generated contracts under `contracts/generated/` and Wrangler binding declarations; CI must prove they are current.
