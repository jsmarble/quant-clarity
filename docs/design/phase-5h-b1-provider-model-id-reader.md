# Phase 5H-B1: provider-model-ID exact reader and local query seam

| Attribute | Value |
|---|---|
| Status | Locally implemented; public composition, deployment, and release evidence pending |
| Decision | [ADR 0029](../decisions/0029-provider-model-id-exact-reader.md) |
| Requirements | `FE-010`, `FE-011`, `FE-013`, `FE-023`, `FE-025`, `FE-026`, `SRCH-002`, `SRCH-004`, `SRCH-006`, `SRCH-008`–`SRCH-010`, `API-003`, `API-007`, `API-009`, `API-010`, `API-013`, `BE-003`, `BE-008`, `BE-011`, `SEC-001`, `SEC-007`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`–`QA-006`, `QA-013` |

## Outcome and nonclaims

Phase 5H-B1 adds one internal provider-model-ID equality reader over schema `1.7.0`, canonical Offering and target rehydration, a fourth closed catalog-query RPC method, and a storage-free API adapter seam. It returns only canonical Model or Variant target candidates through two fixed SELECT statements and at most two D1 queries per call.

B1 creates no public route, public cursor, service binding, remote D1 resource, migration, write operation, Cache API entry, provisioning, preview, production deployment, or release evidence. It does not merge canonical-name, provider-name, or alias exact tiers. Phase 5H-B2 owns multi-tier exact composition and the authenticated public cursor. Prefix/keyword and semantic composition remain later work.

The approved public input remains trimmed NFC Unicode from 1 through 200 UTF-8 bytes. Within that bound, reserved characters and U+0000 are literal. B1 makes no claim that every contract-valid 1,024-byte, whitespace-sensitive, or non-NFC provider model ID is publicly reachable.

## Closed reader contract

The function reader accepts one own, plain, closed object:

```text
{
  publicationId: exact publication ID,
  query: approved trimmed NFC string, 1..200 UTF-8 bytes,
  recordType: null | "model" | "variant",
  providerId: null | exact stable provider ID,
  continuation: null | {
    matchMode: "raw" | "normalized",
    normalizedTargetDisplayName: string,
    resourceId: exact model/variant ID
  },
  limit: integer 1..20
}
```

The continuation is a tier-local function input only. It must be used with the identical publication, query, filters, and limit and must be strictly after the prior emitted tuple. Missing, extra, inherited, malformed, over-bound, inconsistent, or noncanonical fields reject before D1.

The frozen detached result page is:

```text
{
  publicationId,
  results: [{
    tier: 2,
    resourceType: "model" | "variant",
    resourceId,
    matchKind: "provider_model_id",
    displayName: canonical known Fact<string>,
    semanticDegraded: "disabled"
  }],
  matchModes: page-aligned ("raw" | "normalized")[],
  nextContinuation: null | internal tier-local tuple
}
```

`nextContinuation` and the page-aligned `matchModes` array are internal composition and ordering metadata. The continuation's `normalizedTargetDisplayName` is a string at the contract boundary; the reader validates and normalizes it, then encodes and binds the resulting strict UTF-8 BLOB key. Result items do not expose match mode. The API adapter uses the closed `matchModes` array to validate raw-before-normalized ordering across the RPC boundary, then strips it; it maps `matchKind` to public `match_kind` only after validating the complete result and does not expose match mode, projection fields, normalized bytes, Offering ID, provider ID, score, or continuation.

Errors are static `invalid_input`, `integrity_failure`, and `read_failure`. A valid hot publication with no eligible match returns an empty page. A missing or contradictory publication sentinel, malformed row, integrity mismatch, or corrupt lookahead fails closed.

## Fixed queries and ordering

The reader uses exactly two checked-in, fixed, bound SELECT-only statements and executes no more than two D1 queries per call. The first query selects and rehydrates the eligible Offering witnesses and proves the supplied publication is the active head or current rollback candidate. If that query returns no candidates, the reader returns the empty page without another D1 call. Otherwise, one second query rehydrates the complete target set. There is no per-row query, fallback query, arbitrary SQL dispatch, or third D1 call.

Across those two fixed statements, the reader:

1. encodes the approved query as strict UTF-8 BLOB bytes;
2. probes `publication_provider_model_id_raw_exact_idx` with `INDEXED BY`;
3. applies `exact-search-normalization@1` and, only when nonempty, probes `publication_provider_model_id_normalized_exact_idx` with `INDEXED BY`;
4. excludes normalized rows whose raw bytes equal the query;
5. applies `recordType` to the target and `providerId` to the same matching Offering row;
6. requires the matching Offering to be known-active and non-stale and the target to be known-active;
7. groups by exact target type and ID before limit, assigning raw match mode when any eligible raw witness exists and otherwise normalized match mode;
8. selects the lowest ASCII Offering ID only as the deterministic witness within an equal target/class group;
9. orders by match mode, normalized canonical target display-name BLOB, and stable target ID; and
10. returns one typed publication sentinel plus at most `limit + 1` deduplicated candidates.

Raw match mode sorts before normalized-only. Normalized target display bytes sort before the globally prefixed stable target ID. No provider or Offering fact is an ordering key. Pagination is a strict keyset over the complete internal tuple; direct-reader tests must traverse every page without duplicate or omission.

## Canonical rehydration and witness policy

Every selected witness is an index pointer, not a fact source. Before emission, B1:

1. validates publication, projection/storage versions, Offering/provider/target identities, and exact projection hashes;
2. enforces per-resource and aggregate transfer ceilings before parsing;
3. validates the complete canonical Offering contract and recomputes its content hash;
4. proves the Offering's raw provider model ID UTF-8 bytes, provider ID, target type/ID, status, and stale value agree with the selected row and query class;
5. validates the complete canonical Model or Variant contract and recomputes its content hash;
6. proves target identity, known-active status, known evidence-backed display-name Fact, exact display UTF-8 bytes, and pinned target-display normalization; and
7. emits only the target's canonical display Fact.

Default eligibility is exact: `Offering.status = known(active)`, `Offering.stale = false`, and `Target.status = known(active)`. B1 defines no explicit historical search. Every other Offering or target state is absent, not reclassified as a no-result integrity error.

The provider filter must match the same witness. A second Offering for the target cannot qualify the selected row. Multiple eligible witnesses for one target remain integrity inputs but produce one target candidate. A malformed selected witness, target, or lookahead fails the page rather than falling through to an unproved alternative.

## Query reachability boundary

B1 deliberately preserves the approved public ceiling and transformation:

- 201–1,024-byte canonical provider IDs cannot be supplied;
- leading/trailing space is removed before equality;
- non-NFC query spelling is converted to NFC before raw equality;
- U+0000 and formerly reserved punctuation are accepted literally within 200 bytes;
- an empty pinned-normalization result disables only the normalized class; and
- raw reachability means equality to the approved transformed query bytes.

Golden tests must include IDs that are raw-unreachable but normalized-reachable and IDs unreachable by either class. Documentation and UI copy may say provider IDs are supported, but may not say every cataloged ID is searchable. A future wider or separate exact-ID input is a product-contract decision outside B1.

## Bookmark-continuous RPC and API seam

The named local query entrypoint adds exactly:

```text
readProviderModelIdExactTierV1(input)
```

The outer input retains the existing version, audience, protected environment, exact publication, and live-only non-selector D1 bookmark. Its closed search envelope must use sort `relevance,stable_id`, semantic calls/candidates zero, `semantic_degraded=disabled`, public continuation null, and either no filters or the supported `record_type` and `provider` filters. Query, filters, and limit must agree at every layer.

The method creates a Session with `withSession(bookmark)` and invokes only the fixed B1 reader. It exposes no arbitrary operation or SQL dispatch. The bookmark, query, provider filter, and tier-local continuation remain live-call-only.

The storage-free API adapter starts from an already normalized internal request and injected service. It validates environment and ceilings, resolves the publication, builds the closed envelope, invokes the named method, validates and detaches the response, and returns an internal outcome. It does not parse `Request`, rate-limit, sign a cursor, build `SearchCollection`, set headers, touch Cache API, or connect Workers.

## Bounded acceptance and current local evidence

The current focused evidence comprises the passing direct-reader suite in [`provider-model-id-exact.test.ts`](../../apps/query/src/provider-model-id-exact.test.ts), the schema-`1.7.0` pinned-workerd suite in [`exact-readers-schema17.worker.test.ts`](../../apps/query/src/exact-readers-schema17.worker.test.ts), the named-RPC acceptance suite in [`catalog-provider-model-id-query-rpc.test.ts`](../../apps/query/src/catalog-provider-model-id-query-rpc.test.ts), and the storage-free API adapter acceptance suite in [`provider-model-id-exact-query.test.ts`](../../apps/api/src/provider-model-id-exact-query.test.ts). The full local repository `verify` gate also passed on 2026-08-02 after reviewer remediation. This evidence supports the local implementation claim but does not establish complete search, public API, remote D1, deployment, legal/privacy-accountability, performance, or release acceptance.

The broader B1 acceptance boundary remains:

1. **Input and source:** closed own input, prototypes/accessors, exact query scalar/byte boundaries, NFC/trim behavior, U+0000, literal reserved characters, empty normalization, malformed UTF-8/scalars, exactly two fixed SELECT-only statements, at most two D1 queries, forced dual indexes, exact binding order, `limit + 1`, and static errors.
2. **Equality and collisions:** raw-only, normalized-only, raw-before-normalized, raw exclusion from normalized, empty-normalized raw match, duplicate IDs, normalized collisions, repeated providers/targets, target deduplication before limit, deterministic witness selection, string match-mode continuation validation, and every direct-reader page.
3. **Canonical integrity:** wrong publication/type/ID/version/provider/target/link/hash; malformed or oversized Offering/target JSON; raw byte drift; normalization drift; recomputed-hash mismatch; invalid display Fact/evidence/timestamps; duplicate, descending, pre-continuation, and corrupt lookahead rows.
4. **Eligibility and filters:** active/non-stale witness inclusion; every non-active, unknown, and stale witness exclusion; active target inclusion; every non-active/non-known target exclusion; model/variant filter; same-witness provider filter; conjunction; mismatched provider; and rejection of every unsupported filter.
5. **Neutrality:** Offering multiplicity, provider permutation, price, precision, affiliate relationship, site, popularity, coverage, input order, and operator preference cannot alter target facts, deduplication, class, or order.
6. **Pinned workerd/D1:** schema `1.7.0`, active and rollback-candidate reads, arbitrary older-publication rejection, ArrayBuffer/View BLOB equality, U+0000, normalized-empty behavior, forced-index collision sets, bookmark continuity, and selected no-result.
7. **RPC/API seam:** exact callable surface, closed envelope, environment/publication/query/filter/limit agreement, public continuation null, no read after resolution failure, hostile/malformed result rejection, and no public route or binding.
8. **Privacy/security:** source scans reject DML, dynamic SQL, `Request`, raw URL/headers/source address, cookies, browser persistence, Cache API, `console.*`, logs, traces, metrics, analytics, telemetry, beacons, correlation IDs, query echo, and visitor-derived durable keys.

## Requirement handoff

- `SRCH-002`, `SRCH-006`, `API-003`: B1 contributes one trusted provider-ID target tier with canonical Offering/target rehydration.
- `SRCH-008`: B1 fixes default active/non-stale Offering and active target eligibility only; explicit historical search remains pending.
- `SRCH-009`: B1 fixes raw-first plus nonempty pinned-normalized equality within the existing public transformation and ceiling; aliases and complete reachability remain pending.
- `SRCH-004`, `API-010`: B1 contributes only record-type and same-witness provider filters; complete structured filtering remains pending.
- `API-007`, `API-009`: B1 proves dedupe-before-limit and a neutral tier-local keyset but issues no public cursor.
- `FE-023`, `FE-025`, `FE-026`, `RULE-017`: B1 returns target facts only and forbids provider-derived target ordering.
- `PRIV-006`, `PRIV-007`, `PRIV-011`: B1 remains transient and no-store; deployed and legal privacy evidence remains pending.
- `QA-004`–`QA-006`, `QA-013`: focused local evidence contributes to but does not complete public API, full-search, publication, or release acceptance.

All mapped traceability rows remain `Planned` until B2/later public composition, deployment, privacy, load, abuse, and release evidence pass.
