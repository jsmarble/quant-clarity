# Provider adapter contract design

| Attribute | Value |
|---|---|
| Status | Approved design baseline; JSON Schemas are an implementation task |
| Parent design | [`system-design.md`](system-design.md) |
| Related requirements | `PIPE-010`–`PIPE-045`, `DATA-030`–`DATA-067`, `LEG-001`–`LEG-002`, `SEC-003`–`SEC-006`, `QA-002`, `QA-007`, `QA-011`–`QA-012` |

## Adapter package boundary

Each `packages/adapters/{provider}` package exports exactly:

```text
manifest        immutable source/security/legal declaration
roster          versioned expected launch items
retrieve        bounded source acquisition plan
parse           deterministic candidates from redacted observations
map             candidates to normalized adapter output
fixtures        redacted source, expected output, provenance metadata
```

Adapters cannot write D1/R2/Vectorize, choose public current claims, broaden applicability, calculate staleness, or publish. The pipeline supplies credential handles and acquisition functions; secret values are never passed to parser or fixture code.

## Manifest

Required fields:

| Field | Type / rule |
|---|---|
| `contract_version` | Semantic version understood by the pipeline |
| `provider_id` | Existing stable `prv_` ID |
| `adapter_version` | Semantic version plus code content hash |
| `enabled_environments` | Set; production absent until source review approval |
| `source_policy_version` | Approved field-precedence/publication policy |
| `sources[]` | Closed source declarations described below |
| `credential_handles[]` | Secret binding names and least-privilege purpose, never values |
| `roster_path` / `roster_version` | Versioned roster and hash |
| `parser_version` | Deterministic parser identifier |
| `extraction_policy_version` | Optional; absent when no AI extraction is approved |
| `budgets` | Per request/source/run page, byte, duration, retry, browser, AI, and item ceilings |
| `compliance_review` | Reviewer role, review date, terms/robots/Content Signals versions, permitted access/retention/publication, next review date |

Each source declaration includes an opaque source ID; exact HTTPS scheme/ASCII host/default port; path template; parameter schema; method; authentication class; allowed headers; source type; pagination; content-type and compressed/uncompressed byte limits; timeout; manual redirect limit and exact redirect hosts; provider rate limit; robots/Content Signals crawl purpose; evidence retention/publication permission; expected precision/price fields; and whether Browser Session execution is approved.

## Acquisition security

The only effective destination authority is the reviewed exact host allowlist. URL parameters are closed typed values interpolated into fixed templates; neither public nor retrieved content supplies a target host.

Before fetch, the pipeline rejects userinfo, IP literals in every syntax, non-default ports, invalid/ambiguous IDNA, overlong URLs, and any host not byte-equal to the manifest host. It performs a Cloudflare DNS-over-HTTPS preflight and rejects private, loopback, link-local, multicast, reserved, metadata, and internal results. This detects misconfiguration but does not cryptographically pin the later Workers fetch; the residual DNS rebinding risk is explicitly recorded. Because Cloudflare currently exposes no documented fetch answer-pinning primitive, production approval requires a deployed SSRF proof showing the platform cannot reach the protected canary destinations. If that proof fails, the adapter remains disabled; the design does not claim `global_fetch_strictly_public` solves rebinding.

Before automated HTML fetch or browser navigation, the acquisition layer retrieves and deterministically parses the applicable robots policy and Cloudflare Content Signals for the manifest's declared crawl purpose. It records policy bytes/hash, observation time, parser version, and allow/deny reason, and fails closed on prohibition, ambiguity, or retrieval failure. Browser Sessions are not assumed to apply this policy automatically.

Fetch uses `redirect: manual`, revalidates each allowed hop, strips credentials across origins, streams through hard byte/time ceilings, and accepts only declared media types. Retrieved bytes pass through bounded streaming/in-memory relevance minimization, DLP, and redaction before any durable object, Workflow state, log, fixture, hash, or AI request is created; a failure discards the bytes. Browser acquisition uses Browser Sessions—not Quick Actions—so every navigation and subresource can be intercepted. It allows only manifest hosts, blocks downloads and unnecessary third parties, creates an isolated context, applies the same pre-retention redaction boundary to captured content, and closes in `finally`.

## Normalized output

An adapter returns one `AdapterBatch`:

```text
contract_version, provider_id, adapter_version, roster_version
observation descriptors[]
model candidates[]
variant candidates[]
checkpoint candidates[] and lineage edges[]
offering candidates[]
precision candidates[] and component candidates[]
price candidates[]
roster outcomes[]
diagnostics[]
```

Every non-null candidate field contains:

```text
raw value
normalized candidate value
observation ID
evidence span locator
exact source object locator
typed claim scope
extraction method/version
source policy version
qualifiers
```

The typed scope is `entity`, `model`, `checkpoint`, `provider`, or `offering`. Model/checkpoint/publisher facts use their matching non-offering subject and source-object scope. Price, serving precision, and precision-component candidates require an `offering` scope containing provider ID, exact provider model ID, tier key, endpoint class, material region key, and component scope. It cannot use wildcard, inferred region, or a base-model object as an offering substitute. A catalog base model's `default_precision` is returned only as a base-object candidate unless exact-offering applicability is independently established.

Missing facts are explicit candidate state `unknown`, not absent strings. The adapter cannot infer precision, active parameters, currency, lineage, or offering availability. When source currency is omitted, the candidate marks `currency=null` and `currency_presence=omitted`; the canonical policy—not the adapter—applies the documented USD system default.

## Roster outcomes

Every versioned roster item has exactly one terminal result per provider run:

- `published_candidate`
- `published_candidate_with_unknowns`
- `unavailable`
- `failed`
- `quarantined`

Each result includes machine-readable reason, observation/evidence reference, attempt count, last response class, and optional candidate offering ID. Unseen items do not disappear; they become failed after bounded retrieval completes.

## Schema drift and anomaly behavior

Parser drift includes missing/renamed fields, type/enum changes, unexpected pagination, item-count change beyond configured thresholds, source content-type change, or fixture mismatch. Drift quarantines the affected source/provider slice and emits a run report; it never weakens validation automatically.

Price changes over the configured percentage, any precision/checkpoint change, model disappearance, or catalog-size anomaly triggers one fresh acquisition independent of the first observation. Agreement then proceeds through normal validation; disagreement quarantines only affected claims/records and preserves last known good.

## AI extraction extension

An adapter may declare an unstructured source only after deterministic parsing is insufficient. The extraction policy defines minimum quoted span, JSON schema, Workers AI model, independent verification path, confidence/entailment checks, prompt version, cost ceiling, and quarantine behavior. A model or prompt change must pass 100% precision and at least 98% recall on the approved gold set before production.

Provider text is data, never instruction. Redaction and DLP run before AI dispatch. A single generative result cannot publish. External AI is disabled unless the recorded Workers AI comparison fails and every `CF-009` condition passes; AI Gateway stores metadata only and receives `cf-aig-collect-log-payload: false`.

## Fixtures and enablement

Each fixture set contains a minimal redacted source fragment, fixture metadata, expected normalized output, expected unknowns/quarantines, and applicability negatives. Metadata records source type, lawful capture method, observation date, redaction notes, retention permission, parser/policy versions, and content hash. It contains no credential, account identifier, personal data, full authenticated dump, or substantial copyrighted content.

Production enablement requires:

1. Current signed source-compliance record.
2. Complete roster and lawful credential/access method.
3. Contract fixtures for normal, pagination, unknown, drift, failure, and malicious-content paths.
4. SSRF/redirect/size/timeout tests and deployed canary proof.
5. Exact-applicability and base-object negative tests.
6. Deterministic parser or approved extraction gold-set gate.
7. Per-source/run/month budget and kill-switch test.
8. Successful isolated preview/staging run without production mutation.
