# Phase 5G-B: model/variant exact-name reader and local query seam

| Attribute | Value |
|---|---|
| Status | Locally implemented; public composition, deployment, and release evidence pending |
| Decision | [ADR 0026](../decisions/0026-blob-model-variant-exact-search-cutover.md) |
| Requirements | `FE-010`, `FE-011`, `FE-013`, `FE-023`, `FE-025`, `FE-026`, `SRCH-002`, `SRCH-006`, `SRCH-008`, `SRCH-009`, `API-003`, `API-007`, `API-009`, `API-010`, `API-013`, `BE-003`, `BE-008`, `BE-011`, `SEC-001`, `SEC-007`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-005`, `QA-006` |

## Outcome and nonclaims

Phase 5G-B adds one internal tier-1 equality reader over the schema-`1.6.0` model/variant UTF-8 BLOB projection, one third named method on the local catalog-query RPC, and one storage-free API adapter seam. The reader returns only canonical model or variant search candidates after strict canonical rehydration. It preserves the publication Session bookmark obtained by the existing resolver.

This slice creates no internet-reachable route, Worker service binding, remote D1 binding or identifier, resource inventory, migration application, provisioning, preview, production deployment, or cache entry. It does not define or issue the merged public search cursor, implement provider-model-ID, alias, publisher, prefix, keyword, complete structured-filter, or semantic tiers, merge the existing provider tier, or make `/v1/search` complete or reachable. It does not satisfy complete search, public API conformance, deployed privacy, load, abuse, or release acceptance. Every mapped traceability status remains `Planned`.

## Closed reader contract

The function-level reader accepts one own, plain, closed object with exactly:

```text
{
  publicationId: exact publication ID,
  query: string,
  recordType: null | "model" | "variant",
  afterResourceId: null | exact model/variant stable ID,
  limit: integer 1..20
}
```

`recordType=null` means the model and explicit-variant canonical-name tier together; it does not mean every search result type. Missing, extra, inherited, malformed, or inconsistent fields reject before D1. The raw reader input is bounded to 200 Unicode scalars and 800 UTF-8 bytes, then normalized only with checked-in `exact-search-normalization@1`. The normalized result must be nonempty and within its existing 3,600-scalar and 14,400-byte projection bounds. U+0000 is valid at the leading, interior, and trailing positions. The API adapter remains subject to ADR 0016's narrower public search-plan ceiling of 200 UTF-8 bytes.

The reader returns one frozen, detached page:

```text
{
  publicationId,
  results: [
    {
      tier: 1,
      resourceType: "model" | "variant",
      resourceId,
      matchKind: "canonical_name",
      displayName: canonical known Fact<string>,
      semanticDegraded: "disabled"
    }
  ],
  nextAfterResourceId: null | stable model/variant ID
}
```

It returns no full canonical resource, projection version, projection hash, BLOB, normalized key, score, provider fact, provider count, offering fact, affiliate state, recommendation, or rank. The page's `nextAfterResourceId` is an internal tier-local keyset continuation only; it is not an ADR 0016 token, public field, or authorization to issue `page.next_cursor`.

Errors are the static non-echoing classes `invalid_input`, `integrity_failure`, and `read_failure`. A selected eligible publication with no equality match returns a valid empty page. An unavailable publication, a missing or contradictory selected-publication sentinel, a malformed result envelope, or a corrupt candidate or lookahead fails closed rather than being reported as an empty search.

## Fixed indexed query and neutral order

The reader uses one fixed, bound, SELECT-only statement. It first proves that the supplied publication is either the active head with state `active` or the current rollback candidate with state `superseded` or `rolled_back`. It always emits exactly one typed publication sentinel. Candidate lookup:

- binds the pinned normalized query UTF-8 as an `ArrayBuffer` or `ArrayBufferView`, never as SQLite `TEXT`;
- names `publication_model_variant_name_exact_idx` with `INDEXED BY`;
- constrains `publication_id` and exact `normalized_name_utf8` equality;
- applies only the nullable exact record-type selector and the internal `resource_id > afterResourceId` keyset;
- joins the same publication's canonical `publication_resource` row;
- fetches at most `limit + 1` candidates after the sentinel; and
- orders only by stable `resource_id` ASCII bytes.

Models and explicit variants are both tier 1. A normalized-name collision selects no winner. `resource_type` distinguishes the canonical result but is not a relevance or tie-break key; globally type-prefixed stable IDs provide the one neutral collision order. Publisher, provider, offering, precision, price, freshness, affiliate, popularity, coverage, input order, and operator preference cannot alter equality, tier, inclusion, or order.

The reader's internal keyset is `(normalized query bytes, stable resource ID)` because every row in this equality call has the same normalized bytes. Page continuation must retain the same publication, query, record-type selector, and limit. Direct reader tests may exercise every page and prove no duplicate or omission. The 5G-B RPC and API seams still require `envelope.continuation=null`; they neither encode nor consume this keyset as a public cursor. A later complete-search decision must define the merged tuple across tier, exact/keyword/semantic ordering, and stable ID before an ADR 0016 cursor may be issued.

## Canonical rehydration and status policy

Every candidate is an index pointer, not a fact source. Before emission, the reader:

1. validates and binds the normalized query UTF-8 as an `ArrayBuffer` BLOB for equality through the named exact index, without returning projection BLOBs from D1;
2. requires D1's bytewise canonical-display comparison to return exactly true, then independently revalidates the canonical display fact and pinned normalization in the Worker;
3. requires exact publication, type, globally prefixed stable ID, projection version, and projection/resource content-hash agreement;
4. enforces the existing one-resource 1,000,000-byte canonical JSON ceiling and a page-plus-lookahead transfer ceiling of 21,000,000 bytes before sequential parsing;
5. runs the shared Worker-safe complete `Model` or `Variant` contract validator;
6. rechecks identity, a known evidence-backed display-name fact, exact display-name UTF-8 bytes, pinned normalization, canonical timestamps, and a recomputed canonical resource hash; and
7. emits the display-name fact from canonical JSON only.

The default exact tier emits a resource only when its canonical status fact is exactly `state=known` and `value=active`. Known inactive, unavailable, deleted, otherwise non-active, and non-known status facts are absent from this default operation. The projection retains their reproducible name rows, but 5G-B defines no historical/status-search mode. A future explicit status filter must be designed together with complete structured filtering and cannot reinterpret this default.

Provider filters are outside this reader. They may later qualify model cards through a separate complete eligibility plan, but cannot change this tier's model/variant facts or order. A provider-name query remains the distinct tier-3 provider result defined by ADR 0021 and does not fan out into provider-ranked model results.

## Bookmark-continuous RPC and API adapter

The named query entrypoint gains exactly one method in addition to ADR 0023's two Phase-5D methods:

```text
readModelVariantExactNameTierV1(input)
```

Its outer input is exactly version `1`, audience `quantclarity-catalog-query-v1`, protected environment, one opaque non-selector bookmark, and one ADR 0016 `QueryServiceEnvelope`. The envelope must select the same environment and exact publication, use `operation.kind=search`, sort `relevance,stable_id`, set semantic calls/candidates to zero and degradation to `disabled`, have `continuation=null`, and contain either no filters or exactly `record_type=model` or `record_type=variant`. Its search plan must repeat the same normalized query, filters, and limit. Provider and every other structured filter reject before D1.

The method creates a Session with `withSession(bookmark)` and invokes only the fixed reader. It returns a bounded page, `integrity_failure`, or `read_failure`. The bookmark, normalized query, envelope, internal continuation, and D1 rows remain live-call-only.

The separate API adapter begins only from an already constructed `NormalizedRequest`, a validated environment/ceiling set, and an injected service. It rejects cursors and unsupported filters, calls the existing `resolvePublicationV1`, builds the closed envelope, and calls the model/variant method only after successful selection. It validates, snapshots, and detaches the RPC result before returning an internal outcome. It does not parse `Request`, rate-limit, sign a cursor, form a public collection, set headers, touch Cache API, change `apps/api/src/request.ts`, or connect the Workers.

## Bounded verification and acceptance

The local implementation is accepted only when the following evidence passes together:

1. **Reader unit/source:** exact closed input; U+0000; punctuation/case/separator normalization; hostile SQL/FTS-like text as a bound BLOB; raw scalar, raw byte, page, and resource bounds immediately below, at, and above their ceilings; the exact reachable maximum normalization expansion and its derived scalar/byte caps; the aggregate transfer ceiling immediately below and at its maximum plus fail-closed proof when any constituent resource necessarily exceeds its own cap; fixed SELECT-only source; forced index; exact binding order; active and rollback-candidate eligibility; hot no-result; record-type selection; collision order; every direct-reader page without duplicate or omission; and frozen detached results.
2. **Canonical integrity:** model and variant contract rejection; wrong type/ID/publication/version/hash; malformed canonical JSON; oversized canonical bytes; failed SQL display-byte parity; canonical display or normalized-name mismatch; missing evidence; invalid timestamps; projection/resource hash disagreement; recomputed-hash mismatch; corrupt lookahead; duplicates; descending/pre-continuation rows; and wrong or missing publication sentinel.
3. **Status and neutrality:** active inclusion; exclusion of every contract-valid known non-active status (inactive, unavailable, and deleted) plus non-known status; real-runtime cross-publication invariance under safely mutable publisher and provider affiliate/site/precision-coverage metadata; fixed-SQL/source proof that provider/offering multiplicity, eligibility/count, precision, price, affiliate, site, coverage, and input/operator order are not query inputs, joins, or order keys; and stable model/variant collision order independent of record type.
4. **Pinned workerd/D1:** schema `1.6.0` and v3-built publications; actual ArrayBuffer/View-to-BLOB equality; leading/interior/trailing U+0000; forced-index collisions; selected no-result; switch and rollback; stale/unknown/ready-only rejection; and a bookmark obtained from `first-primary` anchoring the named read Session. A three-activation case must prove that an arbitrary older `superseded` publication is not eligible.
5. **RPC/API seam:** exact callable surface; outer/envelope closure; environment agreement; empty/model/variant filter modes; every other filter and every non-null continuation rejected; query/filter/limit identity; no read after resolution failure; static result mapping; malformed/hostile RPC result rejection without accessor re-read; and bookmarks/queries never returned or retained.
6. **Privacy/security:** focused source scans reject DML, arbitrary SQL/operation dispatch, `Request`, raw URL/header/source-address fields, cookies, browser persistence, Cache API, `console.*`, request logs/traces, analytics, telemetry, beacons, correlation IDs, visitor-derived durable keys, query echo, and dynamic error payloads. Existing zero-visitor-data and full repository verification gates remain mandatory.

This local evidence does not advance any traceability row or claim a public route, real service binding, merged cursor, provider-model-ID result, complete search, remote resource, deployment, privacy/legal approval, load/capacity acceptance, or release readiness.

## Requirement handoff

- `SRCH-002`, `SRCH-006`, and `API-003`: this slice contributes the trusted canonical model/variant equality candidate and canonical rehydration only.
- `SRCH-008`: this slice contributes the default known-active exclusion rule only; explicit historical/status search remains pending.
- `SRCH-009`: this slice reuses the pinned normalizer and preserves Model/Variant U+0000; alias and organization-prefix coverage remain pending.
- `API-007`, `API-009`, and `API-010`: this slice proves a tier-local keyset and neutral collision order but deliberately issues no public cursor and performs no complete tier merge or filter plan.
- `FE-023`, `FE-025`, and `FE-026`: the candidate exposes model/variant canonical facts only, with no provider-derived content or ordering.
- `PRIV-006`, `PRIV-007`, and `PRIV-011`: all live inputs remain transient and `private, no-store` at any later query-string response boundary; deployed and legal evidence remains pending.
- `QA-004`–`QA-006`: focused local evidence contributes to, but does not complete, the public API, full search, publication, or release suites.
