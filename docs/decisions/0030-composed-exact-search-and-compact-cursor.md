# ADR 0030: Compose exact-search tiers with a compact authenticated cursor

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Product owner, staff engineer, search lead, API lead, security and privacy lead
- Related requirements: `SM-06`, `RULE-017`, `FE-010`, `FE-011`, `FE-013`, `FE-015`, `FE-016`, `FE-023`, `FE-025`, `FE-026`, `SRCH-002`, `SRCH-004`, `SRCH-006`, `SRCH-008`–`SRCH-010`, `API-003`, `API-004`, `API-007`–`API-010`, `API-013`–`API-017`, `API-020`, `API-021`, `API-025`, `API-026`, `BE-003`, `BE-008`, `BE-011`, `CF-002`, `CF-005`, `CF-006`, `CF-020`, `CF-023`, `NFR-006`, `SEC-001`, `SEC-007`, `SEC-011`, `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`–`QA-006`, `QA-013`, `QA-014`
- Extends: ADRs 0013, 0016, 0021, 0023, 0024, 0026, and 0029
- Supersedes: ADR 0021's and ADR 0029's within-exact-tier display-name ordering only; their equality, eligibility, identity, and neutrality decisions remain accepted

## Context

The three accepted exact readers are independent first-page seams. Public search instead needs one deterministic page across canonical model/variant names, provider model IDs, and canonical provider names, followed by one authenticated continuation. ADR 0016 permits a 4,096-character cursor and at most 512 UTF-8 bytes per string sort scalar. The provider-model-ID reader's internal continuation can contain a normalized target display name of up to 14,400 UTF-8 bytes, so serializing that continuation cannot satisfy the public cursor contract.

The API/query transport also permits exactly one post-resolution typed query operation on one bookmark-continuous D1 Session. Calling the three existing tier RPCs from the API would violate that boundary and could mix snapshots. Cross-tier result identity creates a second problem: a Model or Variant can match both its canonical name and a provider model ID, and a page-local emitted-ID set cannot prevent replay after a tier boundary.

This decision covers a local, non-routable exact-search composition seam. It does not complete every structured filter, prefix/keyword search, semantic retrieval, retained-hot publication resolution, the public request route, runtime secrets/bindings, deployment, or release evidence.

## Decision

### Exact classes and complete neutral sort tuple

The composed exact classes are, in order:

1. exact canonical Model or Variant name (`exact-v1:c`);
2. exact raw provider model ID (`exact-v1:r`);
3. exact normalized-only provider model ID (`exact-v1:n`); and
4. exact canonical Provider name (`exact-v1:p`).

Within each class, the globally prefixed stable canonical resource ID is the sole ordering key. Raw remains ahead of normalized-only. The complete order is therefore exactly the advertised `relevance,stable_id` tuple: fixed exact class followed by stable ID. This narrowly supersedes ADR 0021's and ADR 0029's normalized-display-name tie ordering for composed B2 search; their standalone tier readers retain their existing behavior as independently tested seams. The PRD does not require alphabetical exact-tier order, and `API-009` expressly permits a neutral stable-ID key. Provider or Offering multiplicity, display-name changes, price, precision, affiliate state, popularity, and operator preference are never ordering inputs.

Identity is the canonical `(resource_type, resource_id)`. The first applicable class wins. Provider-model-ID candidates must be suppressed before limit when the same active target is an eligible canonical-name match for the identical query and record-type filter. Raw witnesses continue to win over normalized-only witnesses inside ADR 0029. A Provider is a distinct canonical identity and cannot collide with a Model or Variant.

### Compact public continuation

The authenticated cursor continues to use ADR 0016 unchanged. Its two public `lastSortTuple` scalars are the closed exact-class marker and globally prefixed stable resource ID; `stableId` repeats that ID as required by cursor version 1. No query, display name, provider model ID, bookmark, Offering ID, or provider fact enters the cursor.

The marker and stable-ID prefix must agree: `c`, `r`, and `n` accept only Model or Variant IDs, while `p` accepts only Provider IDs. This is the complete actual sort tuple, so a provider-model-ID continuation resumes directly by match class and stable target ID. No display-order reconstruction, offset, ordinal, or caller-supplied hidden ordering key exists.

The first page receives a fresh ADR 0016 issuance and expiry. A subsequent cursor preserves the original encoded expiry and never extends the chain. The normalized query must be resubmitted and hash to the cursor's query hash. Publication, resource operation, canonical filters, exact sort, and immutable limit must reconcile exactly. Current/overlap HMAC keys, maximum 15-minute TTL, maximum 30-second future skew, and the 4,096-character token ceiling remain unchanged.

### One composed query operation

The API resolves the publication exactly once and invokes exactly one named composed RPC with the resolver bookmark. The RPC creates exactly one `database.withSession(bookmark)` Session and invokes only fixed SELECT-only exact readers on that Session. Earlier tiers are skipped when a valid continuation resumes a later class.

The compositor fills at most the caller's `1..20` result limit in exact-class order. It performs bounded lookahead across a tier boundary before declaring the page terminal. Any invoked tier read or integrity failure fails the whole page; lower-tier data is never returned as a partial success.

The post-resolution statement ceiling is four on a first page: one canonical-name read, the provider-model-ID reader's at-most-two statements, and one provider-name read. A provider-model-ID resume skips the canonical-name tier and needs no reconstruction statement. A no-candidate provider-model-ID call retains ADR 0029's one-statement fast path. Results and lookahead remain bounded by the public limit plus one.

The query result contains canonical Model, Variant, or Provider facts plus a closed internal marker and compact next continuation. The API validates and detaches the hostile RPC result, mirrors one collection-level semantic-degradation state to every item, strips markers and all tier-local keys, and signs the next cursor only after the whole page validates. Signing failure is an error, not a truncated terminal page.

### Filter and semantic-applicability boundary

B2 accepts only:

- no filters; or
- exactly one `record_type` value of `model`, `variant`, or `provider`.

No filter invokes every exact class. `model` or `variant` invokes only the applicable target classes. `provider` invokes only canonical provider-name search. Every other filter and every incompatible/multi-value form is rejected before publication resolution or D1 access. In particular, B2 does not partially apply a provider, precision, price, currency, status, stale, family, or time filter and does not claim `SRCH-004` or `API-010` completion.

Sort is exactly `relevance,stable_id`. A global `stable_id`-only request is rejected because sequential relevance tiers cannot implement that order honestly.

For untyped, Model, or Variant exact-only fallback, semantic work is applicable but disabled, so the collection and every result use `disabled`. For explicit `record_type=provider`, the approved semantic corpus has no Provider documents, so the collection and every result use `not_applicable`. This resolves ADR 0024's expressly deferred provider-only state without changing the PRD or public schema's extensible-value compatibility rule.

### Privacy and public-integration boundary

The API adapter remains storage-free and accepts an already normalized internal request plus injected keyring, clock, Web Crypto implementation, and service. It does not accept a `Request`, parse a raw URL, set a cookie, touch Cache API, create browser persistence, log, trace, measure, correlate, rate-limit, configure secrets, or bind Workers. Query text, filters, cursor text, bookmark, and derived query hash remain live-call-only except for the authenticated query hash inside the returned cursor; that hash grants no retention or telemetry permission.

Every query-bearing response remains `private, no-store` when the later public route is implemented. The local seam creates no authorization to expose `/v1/search`, configure cursor secrets, provision resources, or deploy.

The existing resolver recognizes only the active publication and current rollback candidate. Multiple head changes inside one cursor TTL can therefore strand an otherwise valid cursor. B2 must test and document active and one-step rollback behavior, but it does not claim complete public cursor continuity. Retained-hot publication resolution is a separate blocking design and implementation slice before public route activation or `API-007` completion.

## Consequences

- One exact page can cross all currently implemented exact tiers without crossing D1 snapshots.
- The cursor remains bounded even for maximum canonical display names and contains no visitor query text.
- The public cursor carries the complete actual sort tuple without a migration or durable visitor state.
- Deterministic pre-limit winner suppression prevents cross-page Model/Variant duplication.
- Provider-only semantic inapplicability is explicit instead of mislabeled as disabled work.
- Complete structured filtering, global stable-ID sort, retained-hot cursor continuity, later search tiers, public routing, and release gates remain closed.

## Alternatives considered

- Serialize the provider-model-ID display ordering key: rejected because a valid 14,400-byte key cannot fit ADR 0016's scalar or token ceilings.
- Reconstruct the prior display-name key from stable ID: rejected because it adds a read while leaving the authenticated tuple incomplete relative to the actual order.
- Persist a filter-aware ordinal or ordering projection: rejected because it adds migration, readiness, switch, restore, and filter-combination complexity without improving correctness.
- Carry previously emitted IDs in the cursor: rejected because the set is unbounded and retains unnecessary query-derived state.
- Deduplicate only inside the current page: rejected because duplicates can reappear after a class boundary.
- Call one service RPC per tier: rejected because it violates the single post-resolution operation and one-session snapshot boundary.
- Partially apply the provider filter only to the provider-model-ID tier: rejected because the same filter would be ignored for canonical-name targets and violate zero-filter-violation semantics.
- Label provider-only exact fallback `disabled`: rejected because semantic retrieval is not applicable to Provider resources.

## Validation

- Prove all four class markers, class precedence, raw-before-normalized, stable-ID-only within-class ordering, and prefix/marker validation.
- Traverse pages at limits 1 and 20 across every class boundary without duplicate or omission, including canonical/provider-ID collisions and raw/normalized collisions.
- Prove winner suppression occurs before limit and is invariant under Offering/provider multiplicity and input permutation.
- Prove maximum display-name bytes and display-name changes cannot alter class/ID order and never enter the cursor.
- Prove exactly one post-resolution RPC, one D1 Session, and at most four post-resolution SELECTs for every page shape.
- Prove no filter or one valid record type, reject every other filter and sort before service access, and produce `not_applicable` only for explicit provider-only search.
- Verify current/overlap HMAC keys, rotation, tamper, unknown key, expiry, skew, oversize, wrong query/filter/sort/limit/publication, original-expiry preservation, and static non-echoing failures.
- Prove active and current rollback-candidate pins while retaining the multiple-switch continuity nonclaim.
- Scan implementation and artifacts for DML, dynamic SQL, `Request`, cookies, browser storage, Cache API, `console.*`, logging, tracing, metrics, analytics, telemetry, correlation IDs, visitor-derived durable keys, query echo, cursor echo, and bookmark leakage.
