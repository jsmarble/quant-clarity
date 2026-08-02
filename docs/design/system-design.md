# QuantClarity system design

| Attribute | Value |
|---|---|
| Status | Approved — product-owner approval recorded 2026-08-01 |
| Requirements baseline | `docs/product/requirements.md` (approved baseline) |
| Product decisions | `docs/product/decision-log.md` |
| Design date | 2026-08-01 |
| Decision owners | Staff Engineer, Product Owner |
| Detailed traceability | `docs/design/traceability.md` |
| Detailed contracts | `docs/design/canonical-contract.md`, `docs/design/api-contract.md`, `docs/design/adapter-contract.md` |
| Verification and cost | `docs/design/verification-plan.md`, `docs/design/cost-model.md` |
| Independent review | `docs/design/review-record.md` |
| Implementation sequence | `docs/design/implementation-plan.md` |

## 1. Executive summary

QuantClarity will be a TypeScript monorepo with four deployable surfaces: an Astro server-rendered frontend Worker with Cloudflare Workers Static Assets, an anonymous edge Cloudflare Worker API, a non-routable query Worker reachable only through a service binding, and a private Cloudflare Worker containing scheduled Workflows for acquisition, validation, publication, backup, and search maintenance. Shared domain code and machine-readable contracts prevent the frontend, API, and pipeline from inventing separate meanings for the same facts.

Cloudflare D1 holds normalized operational metadata and immutable public snapshots. Private, redacted evidence and portable backups live in R2. Exact and keyword retrieval use publication-scoped D1 tables and FTS5; semantic retrieval uses Workers AI embeddings and a Vectorize namespace dedicated to each publication version. A publication becomes visible only after its D1 snapshot, exact-search documents, Vectorize namespace, integrity checks, and acceptance probes all pass. One transactional D1 pointer then selects the active version. Public readers therefore see one complete version, and rollback changes only that pointer. The internet-routable edge Worker owns protocol and abuse controls but has no D1 or Vectorize binding; the query Worker contains allowlisted read operations and has no public route.

The public API and frontend application Worker have no provider credentials, pipeline trigger, raw-evidence binding, or mutation route. Provider acquisition occurs only in durable Workflows through adapter-declared HTTPS allowlists. Exact-offering applicability is an immutable composite scope, not a loose model join. Missing or ambiguous claims publish as unknown.

This design deliberately starts with one deterministic structured-source adapter as a complete vertical slice. It does not enable any provider until its source-compliance register is approved. Four-provider rollout, AI extraction, browser acquisition, referral links, and production branding remain release-gated capabilities rather than shortcuts around evidence or legal review. QuantClarity stores no visitor information and enables no visitor analytics, public-request logs/traces, or request telemetry; operator-generated synthetic probes and non-visitor control-plane records provide the allowed operational evidence.

Related requirements: all goals, with emphasis on `G-01`–`G-11`, `BE-001`–`BE-012`, `CF-001`–`CF-025`, and `PIPE-001`–`PIPE-056`.

## 2. Scope, constraints, assumptions, and traceability

### 2.1 In scope

- Model-first web discovery, model/variant/provider detail pages, Model Facts and Offering Facts presentation views, evidence summaries, methodology, API documentation, privacy, legal, sitemap, and robots surfaces.
- A versioned anonymous read-only API for canonical resources, observations, evidence summaries, metadata, and search.
- Four independently enabled provider adapters, each with an explicit roster and legal/source register.
- Monday/Thursday acquisition through atomic public publication, semantic indexing, rollback, backup, monitoring, and cost controls.
- Production, preview, local, and test environments with no preview-to-production write path.

### 2.2 Explicit exclusions

The PRD non-goals remain excluded. In particular, there are no accounts, dashboards, public or private record editors, user submissions, provider rankings, currency conversion, inference routing, outside analytics, or synchronous provider calls from public requests.

### 2.3 Design interpretations

- `FE-032` and `DATA-067`: status and staleness are orthogonal. The default table is `status=active AND stale=false`; stale active and historical records are available through explicit filters.
- The release count is distinct active, non-stale offerings, not merely model names.
- A global publication may combine newly successful provider slices with a failed provider's prior known-good slice. The carried-forward slice is marked stale when the schedule rule requires it.
- Cursors bind to a publication version, canonical filter/sort state, and expiry so a pointer change cannot duplicate or skip records.
- Model-search relevance and provider-table order are separate algorithms. Search relevance never orders offerings inside a model comparison.

### 2.4 Approval-time defaults

The product owner accepted these implementation defaults on 2026-08-01:

| Decision | Recommended default | Release consequence |
|---|---|---|
| Schedule | 05:00 UTC each Monday and Thursday | Document as UTC and operator-local time |
| Monthly platform budget | USD 25, with 50%/75% alerts and an app-enforced expensive-work breaker at 100% | Public last-known-good reads remain available when tripped |
| Code license | MPL-2.0 | Dataset/API terms remain separate |
| First adapter | Fireworks AI structured catalog, only if source review and credentials permit | Otherwise use the first approved structured provider |
| Launch candidates | Fireworks AI, Together AI, DeepInfra, and Groq | Each remains disabled until `LEG-001` review; replace any rejected or under-roster candidate |
| Working brand | QuantClarity in non-production previews only | Public production branding waits for `LEG-007` clearance |

The complete mapping of the 317 normative requirements, 13 success measures, and 24 derived release gates (`REL-AC-01`–`REL-AC-24`) is maintained in `docs/design/traceability.md`. Executable composite gates, inputs, assertions, owners, and retained artifacts are defined in `docs/design/verification-plan.md`.

## 3. System context and trust boundaries

```text
Public browser / API client (untrusted)
        | HTTPS
        +--> Cloudflare Worker / Astro SSR + Static Assets (public, no source credentials)
        |          | signed internal page-read request
        |          v
        +--> Public API Worker (public protocol/abuse code only)
                   | service binding
                   v
             Internal query Worker (no public route, allowlisted reads)
                   | publication-scoped reads
                   +--> Public D1 snapshot
                   +--> Vectorize (search only)
                   +--> Workers AI (query embedding only, budgeted)

Cloudflare scheduled Workflow (private control plane)
        | adapter-declared outbound HTTPS only
        +--> Provider/publisher sources (untrusted content)
        +--> Browser Run (only approved sources that require rendering)
        +--> Workers AI / approved AI Gateway exception
        +--> Canonical D1 (writes/history/run state)
        +--> Private R2 (redacted evidence/backups)
        +--> Public D1 staging rows + Vectorize version namespace

Operator identity (trusted, audited)
        +--> Cloudflare deployment, secrets, rollback, evidence access
        +--> GitHub protected deployment environment
```

Trust boundaries are public ingress, frontend-to-API internal calls, API-to-query service calls, public-read storage, pipeline control plane, external source acquisition, AI processing, private evidence, deployment credentials, and affiliate destinations. Provider strings and structured JSON remain untrusted after retrieval. The public API Worker has no D1, R2, Vectorize, AI, Workflow, Browser Run, provider-secret, or deployment-control binding. The internal query Worker has only public-serving D1, Vectorize, and query-embedding AI bindings; although D1 capability bindings are technically read/write, its generated query contract and source contain no mutation operation or arbitrary SQL input.

## 4. Architecture and component responsibilities

| Component | Responsibility | Forbidden capability |
|---|---|---|
| `apps/web` | Astro SSR/static assets, accessible pages, URL state, SEO, safe rendering | Canonical writes, provider fetches, raw evidence, recommendations |
| `apps/api` | `/v1` protocol, request validation, CORS, transient rate limit before cache, stable errors, response ceilings, query-service calls | D1/Vectorize/AI bindings, mutation methods, pipeline triggers, provider secrets, raw evidence, retained request IDs or visitor telemetry |
| `apps/query` | Non-routable typed read service, publication-scoped D1 reads, exact/semantic merge, evidence summaries | Public route, DML, arbitrary SQL, canonical D1, private evidence, pipeline controls |
| `apps/pipeline` | Scheduled Workflow definitions, adapters, validation, anomaly handling, publication, backup, rollback command target | Public route or user-controlled acquisition URL |
| `packages/domain` | Stable IDs, enums, precision/price/lineage rules, staleness, neutrality, applicability | UI-specific ranking or provider preference |
| `packages/contracts` | Runtime schemas, OpenAPI source, adapter/publication/search contracts | Separate Model Facts or Offering Facts canonical entities |
| `packages/api-core` | Pure bounded route, cursor, read-envelope, conditional-response, and cache-eligibility decisions | Cloudflare bindings, storage, network calls, request telemetry, production ceiling defaults |
| `packages/adapters/*` | One source-specific declaration, retrieval, deterministic parsing, roster, source register | Cross-provider special cases in canonical code |
| `packages/testing` | Builders, redacted fixtures, golden/search sets, traceability checks | Production credentials or authenticated dumps |

TypeScript uses strict compiler settings and npm workspaces. Runtime dependencies must be justified in the design or an ADR, pinned by the lockfile, scanned in CI, and usable in Workers ESM. Framework code may not conceal unbounded request parsing, floating promises, request-scoped global state, or handwritten binding types.

## 5. Canonical information model

### 5.1 Identifier rules

- Stable opaque prefixed UUIDv4 IDs are assigned once and never derived from mutable display names or source URLs. The complete one-prefix-per-table registry, including organizations, aliases, checkpoint links, components, conflicts, occurrences, outcomes, anomalies, and quarantines, is normative in `docs/design/canonical-contract.md`.
- Human-readable slugs are unique, historical slugs redirect to the stable resource, and explicit variants never collapse into canonical aliases.
- An offering identity key is the exact tuple `(provider_id, provider_model_id, tier, endpoint_class, material_region_key)`. An omitted region key means evidence proves the fact applies uniformly; it never means every region was assumed.
- Evidence hashes use SHA-256 over the already-redacted retained bytes plus a canonical metadata envelope.

### 5.2 Operational resources

Normalized D1 tables represent resource identities, publisher/developer organizations, model families, models, variants, aliases, checkpoints and model/checkpoint links/edges, parameter facts, providers, offerings, price schedules, precision claims/components, acquisition runs, observations, evidence summaries, field claims, typed claim scopes, adapter runs, roster outcomes, anomalies, quarantines, policy versions, source-compliance records, and affiliate configuration.

`field_claim` is the auditable link from an entity field/value to its observation, evidence, extraction policy, precedence decision, and applicability scope. It supports supersession; historical claims are append-oriented. Model facts and offering facts are SQL/application projections over these canonical resources.

### 5.3 Exact-offering applicability

`claim_scope` is a typed union for entity/model/checkpoint/provider facts and exact-offering facts. Model and checkpoint facts carry their own publisher/source applicability without a fictitious provider. An offering scope contains provider ID, exact provider model ID, tier, endpoint class, material region, component scope, source object locator, observed interval, and completeness. Publication rejects a non-unknown serving-precision or price claim unless its scope equals the offering scope or a versioned deterministic rule proves a safe narrower-to-equal relationship. Base-model catalog fields never inherit to a live offering by name alone. Ambiguity, broader scope, or equally authoritative conflict produces unknown/quarantine.

### 5.4 Prices and precision

- Decimal amounts are retained as provider text plus canonical decimal text. A validated non-negative fixed-width decimal sort key supports same-currency SQL sorting without binary floating point.
- Input, output, and cached input are separate rows/roles. Conditional, promotional, tiered, batch, subscription, region, and context qualifiers remain explicit.
- Currency provenance is `provider_stated` or `system_default`; only omitted currency receives the visibly marked USD default.
- Precision stores raw field name/string/definition, normalized exact format, optional format variant, summary, and component rows. BF16 and FP16 remain distinct; display order is versioned and expressly non-quality-bearing.

### 5.5 Publications

Public D1 contains immutable version-scoped snapshot tables, FTS5 search documents, a manifest, and a singleton active pointer. Each public row carries `publication_id`. The manifest includes schema, methodology, precision-normalization, display-order, source-policy, and embedding versions; provider slice versions; counts; integrity hashes; build commit; creation time; and search readiness.

Only the active and rollback-candidate snapshots must remain in hot public D1. Canonical history and all manifests remain durable in canonical D1/R2. Pruning is a separate, auditable operation after backup verification.

Field types, cardinalities, uniqueness/check constraints, current-claim selection, price classification, staleness, snapshot composition, retention, and partition triggers are normative design details in `docs/design/canonical-contract.md`. In particular, redacted audit evidence is private for at least 24 months, while normalized price and precision observations remain for the life of the service; no backup or pruning process may shorten those periods.

## 6. Source acquisition and provider-adapter contract

Each adapter exports a versioned declaration and deterministic functions. The declaration includes provider ID, enabled environments, exact HTTPS hosts/ports, endpoint templates, authentication class, pagination, source types, expected fields, content types, maximum redirects/bytes/pages, request rate, retry policy, roster path, robots/Content Signals behavior, terms/source-review version, fixture version, and cost budgets.

The acquisition library and the adapter's production-enable proof are specified in `docs/design/adapter-contract.md`. The effective authority is a reviewed exact operator-controlled host allowlist:

1. Accepts only adapter-owned endpoint identifiers and parameters validated against a closed schema; it never accepts a public URL.
2. Requires HTTPS, exact ASCII/IDNA-normalized host equality, default port, no userinfo, and no IP literal.
3. Performs a Cloudflare DNS-over-HTTPS preflight and rejects loopback, private, link-local, multicast, reserved, metadata, and internal results; enables `global_fetch_strictly_public` for public routing; and revalidates every explicit redirect. The preflight does not pin the later fetch answer, so it is defense in depth rather than a claim that Workers eliminates DNS rebinding.
4. Uses `redirect: manual`, a maximum of three redirects, byte-counted streaming, content-type allowlists, decompression and time ceilings, and bounded pagination.
5. Sends credentials only to the declared origin and strips them on every redirect.
6. Uses Browser Sessions, not Quick Actions, when rendering is required so every navigation/subresource can be intercepted; permits only declared hosts, uses an isolated context, blocks unnecessary third parties/downloads, and closes in `finally`.
7. Before any browser navigation or automated page fetch, retrieves and deterministically parses the applicable robots policy and Cloudflare Content Signals for the declared crawl purpose, records their bytes/hash/decision/policy version, and fails closed on prohibition, ambiguity, or retrieval failure. Browser Sessions are not assumed to enforce these controls automatically.

Production enablement requires a deployed SSRF canary proof against the actual Worker and Browser Session. If Cloudflare can reach a protected destination through rebinding or another tested bypass, the adapter remains disabled. This is the realizable fail-closed control for the platform's lack of a documented fetch DNS-answer pinning primitive.

Every roster item reaches `published`, `published_with_unknowns`, `unavailable`, `failed`, or `quarantined`; silence is a failed run. A provider remains disabled in production until its dated source-compliance record, fixtures, roster, parser contract tests, and terms revalidation pass.

## 7. Extraction, validation, and evidence

Structured authoritative sources use deterministic parsing first. A parsed field passes schema, applicability, provenance, precedence, referential-integrity, anomaly, and policy checks before becoming a candidate claim.

Unstructured sources may use Workers AI only after a deterministic approach is shown insufficient. AI output is JSON-schema constrained but never trusted merely because it parses. Prompts quote minimum redacted source spans as untrusted data. Each value retains the span locator and model/prompt/policy version and must pass entailment plus an independent model family or deterministic/corroborating path. Disagreement quarantines the field.

An external model is allowed only after a recorded Workers AI benchmark fails the approved gold-set threshold. It must use AI Gateway, metadata-only logging (`cf-aig-collect-log-payload: false`), an approved no-training/retention contract, redaction, per-request cost metadata, and a kill switch.

Redaction happens through a bounded streaming/in-memory stage before hashing, durable R2 evidence persistence, Workflow state, logging, fixtures, or AI dispatch. The stage minimizes to the relevant field/excerpt, runs DLP and redaction verification, and discards failed input without durable retention. Only verified redacted bytes enter the private evidence prefix and are bucket-locked for at least 24 months. Locked-evidence emergency/legal handling is a break-glass operator process, not an application delete. Public summaries expose only field, value, source class/owner, safe locator, observation time, extraction method, and integrity marker. Authenticated-only sources are labeled without exposing account information.

## 8. Pipeline orchestration and atomic publication

### 8.1 Durable state machine

The scheduled parent Workflow derives an immutable occurrence ID from schedule name plus scheduled time, independent of deployments. Each execution has a run ID, attempt number, and code version; an intentional replay links to the occurrence and prior attempt. It records durable run metadata in canonical D1 because Workflow state retention is not the audit store. It creates or resumes one idempotent provider slice per enabled provider:

```text
scheduled -> budget_check -> acquire -> redact/store evidence -> parse/extract
          -> validate/applicability -> anomaly re-fetch -> canonicalize
          -> slice_ready | slice_failed | slice_quarantined
```

Retries are bounded exponential backoff with `Retry-After`, maximum attempt/time/byte/AI/browser budgets, and deterministic idempotency keys. Provider slices are independent. A concurrent run for the same provider and schedule key becomes a no-op/resume rather than a second writer.

### 8.2 Publication protocol

```text
compose provider slices (new success or prior known-good)
  -> build immutable D1 snapshot and FTS documents for pub_N
  -> create embeddings and upsert Vectorize namespace pub_N
  -> poll sentinels until Vectorize is queryable
  -> run integrity, neutrality, filter, exact, semantic, and version probes
  -> write ready manifest
  -> D1 transaction: active_publication = pub_N
  -> active URLs resolve pub_N and select only pub_N cache keys
  -> retain pub_N-1 for rollback; export backup and run report
```

No public row or vector is queried without a publication namespace. The pointer transaction is the only active-version visibility switch. After validation and rate limiting, the API resolves the active head before selecting a cache key; the key contains publication ID plus canonical request identity. It never relies on cache purge for correctness and never serves stale-while-revalidate content across version keys. Astro resolves one publication at request start, pins every SSR/API read to it, and embeds it for later client calls. If any pre-switch step fails, `pub_N-1` remains active. Rollback validates the retained manifest/search namespace and switches the pointer back in one D1 transaction. Cache-filled multi-PoP switch and rollback cases are part of publication chaos testing.

At least the last two complete snapshots and search namespaces remain hot for seven days; cursors expire after 15 minutes. R2 retains logical exports of ordinary base tables, `publication_search_document` rows, manifests, policy artifacts, and rebuild inputs. D1 export does not support databases containing FTS5 virtual tables, so backup never treats the virtual index as portable: restore imports base rows into a fresh database, creates and deterministically repopulates FTS5, then rebuilds Vectorize and runs search probes. A scheduled daily backup plus post-publication backup satisfies the 24-hour RPO; restore and search rebuild are exercised in an isolated environment without taking active reads down.

## 9. Public API contract

The base path is `/v1`. GET/HEAD are supported for resources; OPTIONS handles CORS. Every other method returns `405`. No route shares a deployment with pipeline controls. After edge validation and rate limiting, the API calls the non-routable query Worker through a typed service binding to resolve the active head before selecting a versioned data cache entry; cache misses continue through the same binding. No client can address that Worker directly.

The complete field shapes, collection/detail/filter/sort matrix, errors, cache rules, cursor, semantic query plan, and compatibility behavior are defined in `docs/design/api-contract.md`. Initial resources include:

- `/v1/models`, `/v1/models/{id-or-slug}`, and `/v1/models/{id-or-slug}/offerings`
- `/v1/variants` and `/v1/variants/{id-or-slug}`
- `/v1/providers` and `/v1/providers/{id-or-slug}`
- `/v1/offerings` and `/v1/offerings/{id}`
- `/v1/prices` and `/v1/prices/{id}`
- `/v1/precision-observations` and `/v1/precision-observations/{id}`
- `/v1/evidence` and `/v1/evidence/{id}` summaries
- `/v1/search`, `/v1/metadata`, `/v1/openapi.json`, and human API documentation

Responses use UTF-8 JSON, ISO 8601 UTC timestamps, decimal strings, explicit null/unknown semantics, and a stable error envelope `{ code, message, details? }` with no request-correlation identifier. Unknown query parameters, sorts, filters, and enum values in requests are rejected. Collections use signed opaque cursors containing publication, resource, canonical filters, sort tuple, last stable key, and expiry. Page size defaults to 25 and is capped at 100; search results cap at 20 and semantic candidates at 50.

CORS is `*` for non-credentialed public reads. ETags include publication plus canonical request identity. Immutable version-pinned objects cache independently; active detail/browse URLs first resolve the head and then use the publication-specific internal cache key. Request validation and route-cost rate limiting always run before head resolution and Cache API lookup. Search is `no-store` so verbatim queries do not persist in application caches.

Source-address policy `ip-v1` uses IPv4 `/32` and IPv6 `/64` request-lifetime actor keys plus a higher-threshold IPv6 `/48` rotation-abuse bucket. Keys are HMACed in memory, passed only to the Cloudflare rate-limiting binding, and immediately discarded. Provisional limits are 120 inexpensive reads/minute, 30 exact searches/minute, and 8 semantic searches/minute per actor/PoP, with separate static request-cost ceilings and block-only firewall rules if justified. Cookie-setting or visitor-identifying Cloudflare features—including JavaScript challenges/detections, managed challenges, Turnstile, Waiting Room/session affinity, unique-visitor identifiers, and Always Online—are prohibited. `429` includes `Retry-After`. Limits are permissive abuse controls, not exact quotas, and require the `QA-014` false-positive/rotation suite.

The frontend Worker validates and transiently rate-limits the original request at its own public ingress, then uses a service binding and an unrouted internal audience. It forwards a signed canonical envelope containing audience, environment, method, path, canonical query hash, issued-at, and 30-second expiry, but no source address or actor key. The API rejects public-route internal headers, alteration, wrong audience/environment, expiry, and old/current-key failures. The design explicitly accepts that a captured envelope can replay the same non-mutating read within that short window; it grants no data or mutation capability and avoids adding a durable nonce store to the public edge. Full source addresses, actor keys, and verbatim queries are never persisted or emitted as telemetry.

## 10. Search design

Exact retrieval uses pinned normalization for Unicode case, punctuation, and separators without merging explicit variants. Approved evidence-backed organization-prefix tolerance currently applies to model aliases under `DATA-004`; provider organization/corporate aliases remain planned. Publication-scoped D1 tables and FTS5 provide exact, prefix, keyword, provider-name, and provider-model-ID candidates. [ADR 0025](../decisions/0025-trusted-model-variant-name-projection.md) makes the runtime-neutral `model-variant-name@1` projection—not the caller-supplied normalized field in the broad search document—the future tier-1 exact-classification authority. It derives the complete known-name subset from contract-valid closure-bound model/variant resources, preserves their current U+0000 semantics, and binds a deterministic inventory. [ADR 0026](../decisions/0026-blob-model-variant-exact-search-cutover.md) fixes its durable representation as exact UTF-8 BLOBs, with an immutable equality index and seven-field v3 readiness/switch suffix; the schema, bounded writer, seal/readiness/switch gates, and restore rebuild must land atomically in Phase 5G-A2, while the canonical-rehydrating reader/RPC remains Phase 5G-B. [Phase 5G-A1](phase-5g-a1-model-variant-durable-proof-core.md) is limited to the runtime-neutral byte rows, revision-bound staging, and six-field non-queryability storage-artifact proof. [ADR 0027](../decisions/0027-trusted-provider-model-id-projection.md) separately fixes the complete all-Offering `provider-model-id@1` projection and its exact provider, target, raw, normalized, and content-hash bindings. [ADR 0028](../decisions/0028-provider-model-id-durable-storage-cutover.md) and [Phase 5H-A2](phase-5h-a2-provider-model-id-storage.md) are locally implemented as schema `1.7.0` dual raw/normalized UTF-8 BLOB indexes with exact reconstruction, forced-index proof, and cumulative v4 readiness/switch gates. [ADR 0029](../decisions/0029-provider-model-id-exact-reader.md) and locally implemented [Phase 5H-B1](phase-5h-b1-provider-model-id-reader.md) select literal raw-first and then nonempty normalized equality within the existing 200-byte NFC-trimmed public ceiling. B1 requires an exact known-active, non-stale Offering witness and known-active target; rehydrates and verifies both canonical resources, hashes, and links; maps the match to the target Model or Variant with its canonical display Fact; applies only record-type and same-witness provider filters; deduplicates targets before limit; and orders raw before normalized-only, then normalized target display BLOB and stable target ID. IDs above 200 bytes or changed by trimming or NFC may not be raw-reachable, and this design does not claim that every contract-valid provider model ID is publicly searchable. Its fixed SELECT-only reader, tier-local continuation, and first-page-only RPC/API seam create no public route or cursor. Phase 5H-B2 owns multi-tier exact composition and the authenticated merged cursor; prefix/keyword, semantic, public integration, remote, and release evidence remain later work. [ADR 0021](../decisions/0021-canonical-provider-exact-search.md) keeps canonical provider documents in a separate immutable exact-search projection derived from closure-bound provider resources: an exact provider name returns a distinct provider result and never fans out into provider-ranked model results or vectors. Exact canonical model/variant name, provider-model-ID, and canonical provider-name tiers precede aliases, prefix/keyword matches, and semantic results. Within the provider-model-ID tier, raw matches precede normalized-only matches and normalized canonical target display name plus stable target ID break ties; the other exact tiers use their approved normalized display-name and stable-ID order. Existing approved BM25 and semantic scores apply in their own later tiers, and provider facts never influence model scores.

Semantic retrieval embeds the bounded query with a versioned Workers AI embedding model selected by the acceptance benchmark. Vector grain is exactly one vector per publication-scoped canonical model or explicit variant; offering or provider count never creates duplicate vectors or relevance weight. Vector IDs reference stable canonical records, with scalar model/family/resource metadata only; Vectorize is never canonical storage. Each publication is a namespace.

With no structured filter, Vectorize queries that corpus once for at most 50 candidates. With filters, D1 first computes the complete eligible model-ID set, including provider/precision/currency/freshness/price joins. The query service partitions eligible IDs into at most eight deterministic `$in` batches of at most 40 prefixed UUIDs whose encoded filters remain below Vectorize's 2,048-byte limit. Each call returns at most ten candidates; the service merges at most 80 by similarity and uses stable model ID only as the tie break. Above 320 eligible IDs it returns exact/structured results with explicit semantic degradation rather than claiming recall. D1 reapplies all filters after retrieval. Per-request Vectorize calls, returned candidates, input length, filters, and CPU/subrequests have static hard ceilings; transient rate limiting and Cloudflare account-level billing controls provide additional protection without an application request counter. Adversarial tests place qualifying records below unfiltered rank 50 and permute provider/offering counts to prove recall and ranking neutrality. If Vectorize or Workers AI fails or an operator/account-level cost control disables semantic work, exact/structured search remains available with an explicit degradation indicator. [ADR 0024](../decisions/0024-search-collection-semantic-degradation.md) fixes that indicator at required, non-defaulted `SearchCollection.meta.semantic_degraded`, including empty fallback collections; every result carries an identical `/v1` compatibility mirror. Provider-only applicability and the merged search cursor remain follow-up decisions. Search publication does not switch until exact and semantic acceptance sentinels for the candidate namespace pass.

The embedding model, query instruction, input document format, normalization, merge weights, and acceptance sets are versioned. At least 50 exact queries and 50 semantic queries plus filter/facet cases gate production as required by `SM-06`, `SM-12`, and `QA-013`.

## 11. Frontend delivery boundaries

Astro SSR on Cloudflare Workers with Static Assets is selected for content-first HTML, limited client JavaScript, accessible progressive enhancement, and compatibility with current supported Astro releases. Primary model/provider facts are server-rendered. Interactive search, filters, comparison selection, and Offering Facts use small isolated client components with all state represented in the URL; no tracking state or profile is stored.

The PRD field lists in `FE-020`, `FE-030`–`FE-035`, `FE-040`–`FE-043`, and `FE-050`–`FE-052` are adopted verbatim as normative page/data contracts; implementation may add only non-conflicting presentational fields. Provider pages therefore include official identity/site, supported active count, refresh time, affiliate disclosure, the complete offering table, and factual known/unknown precision counts. Methodology publishes its version/effective date, stable historical-version URLs, and a material-change log.

The page contract also enforces these boundaries:

- Model cards accept only model/variant fields plus the computed active non-stale distinct-provider count. Provider filtering supplies eligibility IDs separately and cannot alter card data or ordering.
- Model Facts projects model/variant/checkpoint claims only.
- Provider-offering comparison defaults to provider display name then stable offering ID. Sorting requires a visible active currency for numeric prices.
- Offering Facts is a projection over offering, scoped precision/price claims, observations, and evidence summaries.
- Referral configuration is joined only at the outbound action. It is absent from search documents and canonical sort inputs. A monetized link is a direct exact-allowlisted destination with the same static program identifier for every visitor, adjacent plain-language disclosure, `rel="sponsored nofollow noopener noreferrer"`, and no click redirect, click ID, pixel, callback, or personalized code.

Semantic HTML, skip links, visible focus, 44 CSS-pixel target sizing where applicable, text equivalents for every state, reduced motion, high contrast, semantic table headers/captions, narrow-screen alternatives, focus restoration, live result counts, 320-pixel layout, 200%/400% zoom, keyboard, and screen-reader checks are release gates.

Security headers are defined in Workers Static Assets `_headers` for static assets and attached explicitly by Astro middleware to every SSR response because `_headers` does not apply to Worker-generated output: a strict hash-pinned CSP with self-hosted assets and no analytics, beacon, or third-party script/connect origin; HSTS after domain readiness; `nosniff`; `Referrer-Policy: no-referrer`; frame denial; a restrictive permissions policy; and no opener on external links. CSP and network-capture tests reject analytics, pixels, tag managers, remote fonts/scripts, and unexpected connect origins. Every Worker preview URL and preview hostname is checked for `X-Robots-Tag: noindex` on static and SSR paths. Production emits canonical URLs, sitemaps, robots policy, and per-resource metadata.

## 12. Cloudflare service decisions

| Capability | Decision | Rationale / verified constraint |
|---|---|---|
| Frontend | Cloudflare Worker + Astro SSR + Workers Static Assets | Required by amended `CF-001`; current Astro and Cloudflare documentation support Workers SSR, integrated assets, version previews, and custom domains |
| Public API | Edge module Worker + non-routable query module Worker | Required by `CF-002`; internet-facing code has no storage/search binding, while the query service exposes only typed reads through a service binding |
| Orchestration | Scheduled Workflows | Direct cron schedules are currently supported; durable retries and long I/O; audit exported beyond 30-day paid retention |
| Async fan-out | Workflow child instances initially | Four providers do not require Queues; reevaluate at scale, retaining idempotency/quarantine semantics |
| Canonical storage | D1 operational database | Relational constraints/history; 10 GB paid database and single-threaded limits require indexes, bounded batches, and future partition threshold |
| Public storage | Separate D1 publication database | Minimal public binding surface, versioned snapshot queries, FTS5, atomic pointer transaction |
| Evidence/backup | Private R2 Standard bucket | Large objects off public path, no egress charge, bucket lock/retention, portable exports |
| Semantic search | Direct Vectorize | Required vector backing without generated answers; namespace-per-publication and deliberate metadata indexes |
| Embeddings | Workers AI, benchmark-selected model | Cloudflare-native and low cost; model/dimensions are contract-versioned after acceptance tests |
| Generative extraction | Workers AI only after deterministic need | JSON mode is not factual validation; external AI only through documented `CF-009` exception |
| Rendered acquisition | Browser Run only per approved adapter | Time/cost budgets, network interception, terms/robots gate |
| Abuse controls | Worker Rate Limiting API + WAF/bot + app ceilings | Limiter is PoP-local/eventually consistent; layered controls and tests acknowledge that |
| Caching | Cache API after validation/rate limit | Version-keyed responses; public controls cannot be bypassed by cache |
| Operational signals | Synthetic probes plus pipeline/publication/deployment control-plane logs and metrics | No public request logs, traces, Analytics Engine request events, or visitor-derived aggregates |
| Visitor analytics | None | Required by `PRIV-002`; Web Analytics and all request-event telemetry are disabled |
| Secrets | Environment-scoped Worker secrets | Separate deployment, pipeline, evidence, and source identities; no tracked values |
| Infrastructure | Wrangler JSONC, D1 migrations, checked-in idempotent provisioning manifests/scripts, GitHub environments | Reproducible bindings/schedules/resources; no dashboard-only source of truth; account resource ownership is recorded before creation |

Implementation must install Wrangler 4.x, use `wrangler.jsonc`, generate binding types with `wrangler types`, validate against the installed schema, set a current compatibility date, enable `nodejs_compat` only where required, enable `global_fetch_strictly_public` on acquisition, explicitly disable observability on public frontend/API/query Workers, enable structured observability only on non-public pipeline/control-plane Workers, and set tested CPU/subrequest limits. Production and preview use distinct D1, R2, Vectorize, AI Gateway, limiter namespaces, Worker names, frontend variables, and secrets.

The source of truth is a checked-in environment inventory plus idempotent `wrangler`/Cloudflare API provisioning commands run from protected GitHub environments. The inventory owns frontend Worker assets/domains/variables, Workers/bindings/routes, D1 databases/migrations, R2 buckets/lifecycle/lock rules, Vectorize indexes/metadata indexes, AI Gateway logging policy, Workflow schedules, limiter namespaces, block-only firewall rules, explicit public-observability/analytics disablement, DNS/Access, and budgets/alerts. It rejects Web Analytics, browser challenge/detection products, Tail/Logpush exports, request-event datasets, and public Worker observability. `infra plan` reads current resources and fails CI on unapproved drift; `infra apply <environment>` requires the protected environment and records resource IDs/versions without secrets; `infra destroy preview <id>` is limited to inventory-labeled ephemeral preview resources. Production destroy, bucket-lock weakening, D1 deletion, domain removal, and budget-control removal are absent from automation and require a separately reviewed break-glass procedure. Exact commands are added to `AGENTS.md` when implementation is approved and the toolchain exists.

Current official limits/prices verified on 2026-08-01 include: Workers Paid minimum USD 5/month; D1 10 GB/database and 30-day Time Travel on paid; Vectorize ten metadata indexes, 50 results when returning metadata, and 10 million vectors/index; Workflows 30-day completed-state retention and billing for steps/storage beginning 2026-08-10; and Browser Run paid inclusion of ten browser hours/month. Workers preview indexing protection is application-controlled and must be verified independently. Release verification must recheck all limits and prices.

## 13. Security, privacy, and legal controls

The threat model treats public input, source content, redirects/DNS, stored strings, AI prompts/outputs, dependencies, deployment identities, affiliate destinations, and operator actions as separate attack surfaces.

Mandatory release gates are:

- `applicability-integrity`: cross-tier/region/class/base-object negative and property tests.
- `publication-chaos`: failure injection before/after each phase and rollback under traffic.
- `source-egress-security`: SSRF encodings, redirects, DNS rebinding, CNAMEs, bombs, timeouts, and browser subresources.
- `extraction-adversarial`: prompt injection, unsupported claims, disagreement, and policy-version changes.
- `evidence-dlp`: credential/PII canaries prove redaction across R2, control-plane logs, prompts, fixtures, and public summaries.
- `zero-visitor-data`: browser storage/network capture plus deployed configuration prove no cookies, identifiers, analytics, public invocation logs/traces, custom request telemetry, click tracking, or visitor-derived storage; privacy/DPA/processing-record/legal-owner artifacts are current.
- `neutrality-invariance`: affiliate/provider permutation leaves facts, eligibility, relevance, and ordering byte-equivalent.
- `api-abuse`: IP policy, cache-hit floods, cursor tampering, filter/query/response limits, and semantic denial of wallet.
- `legal-source-register`: current signed review for every endpoint and destination.
- `restore-and-rebuild`, `manual-a11y`, and `cost-fail-safe`.

Automatic invocation logging, automatic tracing, custom events/spans, Web Analytics, and any other request telemetry are disabled for the entire frontend, public API, and query Workers. They do not assign a retained application request ID. No live visitor-derived route, status, timing, cache, rate-limit, query, result, publication, cost, IP, actor-key, header, URL, user-agent, referrer, or error event enters QuantClarity storage. Source-address material exists only for the lifetime of rate-limit/security processing and is never copied out of Cloudflare's transient facilities. Operator-generated synthetic probes use fixed non-personal inputs and retain only their own run data. Pipeline, publication, deployment, source-adapter, and non-visitor cost records use run IDs and structured events, with DLP canaries covering every allowed sink. AI Gateway payload and metadata logging are disabled when the gateway is used.

Referral destinations are exact-URL allowlisted, stored separately from provider facts, and receive no page/search query or visitor-specific value. QuantClarity does not log outbound clicks. The privacy notice identifies the controller/legal contact and Cloudflare processor role, purposes/lawful bases, transfers/safeguards, retention, rights, and destination-provider separation. The operator retains the current DPA/transfer review, subprocessor/data-location review, record of processing, rights procedure, and documented legal determinations. These are compliance controls and legal-owner release evidence, not a claim that code alone certifies GDPR compliance. Legal notice contact, privacy notice, non-affiliation notice, API terms, and dataset terms are static informational surfaces, not feedback or contribution systems.

## 14. Reliability, recovery, and operations

- Public target: 99.9% successful reads measured by scheduled synthetic production probes, never live visitor telemetry. Cached/versioned detail pages remain available during pipeline failure; semantic failure degrades to exact search.
- Synthetic probes carry operator-owned run IDs. Pipeline and control-plane metrics cover provider results, schema drift, quarantine, staleness, publication duration, backup, and non-visitor cost units. Public requests emit none.
- Alerts cover synthetic availability, missing schedule completion, provider-wide drift, eight-day freshness, search mismatch, rollback, secret failure, control-plane telemetry silence, and 50%/75%/100% budgets.
- D1 Time Travel is a short-window control, not the only backup. Daily and post-publication exports acquire/drain the single canonical-writer lease, record a Time Travel bookmark and immutable high-water mark, hash/count every ordinary-table chunk, and reject any changed ending boundary. Serving export selects one immutable publication closure. FTS5 and Vectorize are rebuilt deterministically. Public reads continue on the separate serving database; quarterly restore tests support the twice-yearly formal DR exercise.
- RPO/RTO are 24 hours. Public publication rollback target is four hours and should normally complete in minutes through the pointer switch.
- Runbooks cover provider addition, source-policy revalidation, credentials, drift/quarantine, publication/rollback, backup/restore, search rebuild, cost abuse, source poisoning, erroneous mass publication, and credential exposure.

## 15. Performance, scale, and cost model

All public list/detail queries use publication ID plus indexed stable keys. Model-first pages fetch prejoined/projection rows rather than N+1 source queries. Raw evidence is never loaded on public paths. D1 full scans, unbounded FTS patterns, regexes, and client-chosen result sizes are prohibited.

Initial and tenfold profiles cover 80/800 offerings, 10k/100k monthly visitors, 10k/100k external API requests, cold/warm cache, worst model page, exact and semantic search, provider failure, and publication rebuild. A 100,000-offering profile gates the public concepts even though launch is smaller. Public D1 warns at 50% and blocks candidate publication at 60% of its current 10 GB limit until partition/migration is approved, preserving migration headroom and measuring FTS/index amplification and write contention.

The dated service rates, formulas, assumptions, base/tenfold/100,000-offering projections, retry-storm ceilings, five-/ten-year lifetime-history growth, and sensitivity gates are in `docs/design/cost-model.md`. The current nominal projection is about USD 5.01/month at base, USD 6.64 at tenfold, and USD 21.90 for the modeled 100,000-offering five-year profile before unapproved generative extraction. Eight-batch saturation at that scale is about USD 74.13 and therefore fails the budget gate. Browser, D1 write amplification, evidence/history growth, and pipeline rebuild work have measured admission ceilings. Public semantic work is bounded per request and transiently rate-limited; no monthly application request counter is retained.

The proposed USD 25 monthly operator budget is a control target, not a promise of vendor billing caps. Locally metered byte/page/browser/AI/Workflow/vector/D1/R2/semantic ceilings stop new expensive work before relying on delayed provider alerts. At 100%, new browser/generative/rebuild work stops and runs quarantine; cached reads and deterministic low-cost refreshes may continue only within a reserved read budget. Re-enable is an audited operator action. Rates and Workflows billing are reverified after 2026-08-10 and at every major release.

## 16. Development, test, and deployment strategy

### 16.1 Environments

- Local: Miniflare/local D1/R2 fixtures; remote AI/Vectorize only under explicit test budgets.
- Test: ephemeral local databases and deterministic fake bindings in CI.
- Preview: dedicated Cloudflare D1/R2/Vectorize/limiter/AI resources; no production source credentials or write identity; frontend Worker preview static and SSR paths verified non-indexable.
- Production: protected GitHub environment, least-privilege resource-scoped rotatable Cloudflare API token and account ID, manual release gate until two-week observation completes. No unsupported GitHub OIDC exchange is assumed.

### 16.2 CI gates

Pinned GitHub Actions run formatting, lint, strict type-check, unit/property tests, contract/OpenAPI examples, adapter fixtures, D1 migrations, publication chaos, API conformance, search acceptance, accessibility automation, SSRF/injection/DLP, dependency audit, secret scan, SBOM, build, Wrangler types check, config-schema validation, and dry-run deployment. Traceability fails if any requirement or release gate is unmapped or references a nonexistent test.

Manual gates record keyboard/screen-reader/zoom/contrast results, source/legal reviews, cost acceptance, backup/restore/search rebuild, name/domain clearance, and the required two weeks of production schedules. Tests and operational evidence reference PRD IDs.

### 16.3 Delivery

Small conventional commits land on `main` only after CI. The frontend, API, and pipeline deploy as separate Worker versions from protected GitHub environments after dry-run and migrations. Preview versions point only at preview endpoints and are never promoted implicitly. Deployment never runs provider migrations or publication implicitly. Rollback selects prior Worker versions and, independently, the prior dataset pointer.

## 17. Initial vertical slice

The first slice implements one approved structured provider from source to public preview:

1. Source register, roster, redacted fixture, deterministic adapter, schema-drift and legal gate.
2. Canonical models/offerings/prices/precision with exact applicability and evidence links; unsupported fields stay unknown.
3. One Workflow run with retry, anomaly, quarantine, last-known-good, and immutable evidence.
4. One D1 publication, one Vectorize namespace, acceptance probes, pointer switch, failure injection, rollback, and rebuild.
5. `/v1/metadata`, model/provider/offering collections/details, evidence summary, exact and semantic search, caching, CORS, rate limit, and OpenAPI.
6. Home/search, model card/detail/Offering Facts, provider, methodology, API, privacy, and terms preview pages with accessibility checks.

The slice excludes additional providers, generative extraction, Browser Run, affiliates, custom domain, and public production branding. Those expand only after the slice's contracts and release gates pass.

## 18. Decisions, alternatives, and open approval items

Accepted ADRs are recorded in `docs/decisions/0001-*.md` through `0011-*.md`, covering the toolchain/frontend, public/query Worker trust boundary, D1/R2 topology, stable identity/applicability, FTS5/Vectorize search, scheduled Workflows, atomic publication, AI exception process, abuse/cost controls, decimal-neutral sorting, and the zero-visitor-data/GDPR posture.

Rejected alternatives:

- Client-only SPA: fails server-rendered fact/SEO and accessibility goals.
- One mutable canonical/public database view: weakens least privilege, rollback, and atomic version reasoning.
- Vector metadata as canonical facts: violates `SRCH-006`/`BE-011` and metadata limits.
- One Vectorize namespace with in-place mutation: cannot prove atomic data/search publication.
- Universal provider ranking or precision bit score: violates core product rules.
- Queue-first fan-out: adds an unnecessary product and DLQ path at four providers; Workflows already provide queued durable instances.
- External database/search/observability services: violate Cloudflare-native constraints.

The product owner approved the design, Section 2.4 defaults, and zero-visitor-data PRD amendment on 2026-08-01. Later source/legal rejection may replace a provider candidate without changing the conceptual model; any further product semantic change still requires PRD amendment.

## 19. Requirement-to-design and requirement-to-test matrix

`docs/design/traceability.md` contains the row-level matrix for 317 normative requirements, 13 success measures, and 24 derived release gates. The coverage graph is:

```text
Success measure / PRD requirement
  -> system-design section and ADR
  -> contract and owning component
  -> automated or manual verification ID
  -> REL-AC release gate
  -> retained CI/run/review evidence
```

Coverage must include every normative ID once, allow a requirement to map to multiple tests, reject unknown IDs, and distinguish `designed`, `implemented`, `verified`, and `accepted`. Approval of this document advances rows only to `designed`; it does not claim implementation or release acceptance.

## Approval checklist

- [x] Every applicable PRD requirement maps to a design section.
- [x] Every release acceptance criterion maps to planned tests or operational checks.
- [x] Canonical schema, identifiers, lifecycles, selection rules, and constraints are unambiguous at design level.
- [x] Exact-offering precision applicability is structurally enforceable.
- [x] Publication consistency, rollback, backup, RPO, and RTO are designed.
- [x] API and provider-adapter contract semantics are complete enough to produce machine-readable contracts after approval.
- [x] Cloudflare choices were checked against current official documentation and are assigned planned ADRs.
- [x] Security, privacy, source-compliance, and cost-abuse controls are testable.
- [x] The initial vertical slice has bounded scope and objective acceptance criteria.
- [x] Product-owner approval is recorded.

Approval record: product owner approved the reviewed design and its Section 2.4 defaults on 2026-08-01, with the approved zero-visitor-data/GDPR amendment recorded in `docs/product/decision-log.md`. Implementation is authorized; later legal, spending, production deployment, provider-enable, and public-release gates remain in force.
