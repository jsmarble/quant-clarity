# ADR 0029: Read provider model IDs as canonical target results within the approved public query ceiling

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Staff engineer, product-semantics lead, search lead, API lead
- Related requirements: `DATA-001`, `DATA-004`, `DATA-020`, `DATA-021`, `DATA-025`, `DATA-066`, `DATA-067`, `RULE-004`, `RULE-017`, `FE-010`, `FE-011`, `FE-013`, `FE-015`, `FE-016`, `FE-023`, `FE-025`, `FE-026`, `SRCH-002`, `SRCH-004`, `SRCH-006`, `SRCH-008`–`SRCH-010`, `API-003`, `API-007`, `API-009`, `API-010`, `API-013`, `BE-003`, `BE-008`, `BE-011`, `SEC-001`, `SEC-007`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`–`QA-006`, `QA-013`
- Extends: ADRs 0016, 0021, and 0026–0028
- Partially superseded by: ADR 0030 replaces normalized-target-display ordering only for the composed exact-search operation; this ADR's standalone B1 reader and all other decisions remain accepted

## Context

ADRs 0027 and 0028 establish a complete, closure-bound, dual-indexed provider-model-ID projection with one immutable row per canonical Offering. They deliberately leave the reader contract unresolved. Phase 5H-B must decide equality, eligibility, result identity, collision handling, filtering, and continuation without turning an Offering-derived match into provider-derived model ranking.

The approved public search contract already fixes a trimmed, NFC-normalized query of 1–200 UTF-8 bytes. It also fixes a model-first `SearchResult` union containing only Model, Variant, and Provider resources, and includes `provider_model_id` as a `match_kind`. This decision does not amend those approved limits or add an Offering result type.

The Offering contract is wider than the public query contract. A canonical provider model ID can occupy up to 1,024 UTF-8 bytes, can contain leading or trailing space, can be non-NFC, can contain U+0000 or characters previously treated as reserved by generic search planning, and can normalize to empty. Consequently, durable presence does not imply public reachability through the current search input. That limitation must be explicit rather than hidden behind a completeness claim.

## Decision

### Literal bounded equality

Phase 5H-B1 accepts only the approved public query representation: trim the supplied string, normalize it to NFC, and require 1–200 UTF-8 bytes. Within that ceiling every Unicode scalar, including U+0000 and the characters `*`, `\`, `[`, `]`, `{`, `}`, and `|`, is literal data. B1 does not implement wildcard, regex, inline-filter, or FTS query syntax and never interpolates query text into SQL.

The reader encodes the approved NFC-trimmed query as strict UTF-8 and performs two ordered equality classes:

1. **raw:** forced equality through `publication_provider_model_id_raw_exact_idx`; then
2. **normalized-only:** apply checked-in `exact-search-normalization@1`, require a nonempty normalized result, and force equality through `publication_provider_model_id_normalized_exact_idx`, excluding rows already equal in the raw class.

An empty normalized query has no normalized class; raw equality remains available. Both keys bind as `ArrayBuffer` or `ArrayBufferView` BLOBs. Host normalization, SQLite text comparison, locale collation, FTS tokenization, and lossy coercion are not authorities.

Raw equality means equality to the approved NFC-trimmed query bytes, not equality to the pre-normalization URL spelling. A stored ID longer than 200 bytes, changed by trimming, or changed by NFC may therefore be unreachable through raw equality. Normalized equality may recover some, but not all, such values. B1 makes no claim that every contract-valid provider model ID is publicly searchable. Expanding the ceiling or creating a separate exact-ID input requires a product decision and a separately accepted contract change; this ADR does not make one.

### Eligible Offering witness and canonical target

Each match is authorized by an exact canonical Offering witness. Before emission, the reader rehydrates and validates the Offering and its target Model or Variant from the selected publication and proves:

- exact publication, Offering ID, provider ID, target type, and target ID;
- projection version and exact Offering/target content-hash agreement;
- the canonical Offering's provider model ID equals the stored raw bytes;
- its provider and target links equal the projection row;
- Offering status is exactly known `active` and `stale=false`; and
- target status is exactly known `active`.

Inactive, unavailable, deleted, unknown-status, stale, and otherwise non-default Offering witnesses remain canonical history but do not qualify in B1. Non-active or non-known targets do not qualify. B1 adds no historical/status mode.

The public-shaped candidate is the Offering's exact target:

```text
{
  resource_type: "model" | "variant",
  resource_id: exact target ID,
  display_name: canonical known Fact<string>,
  match_kind: "provider_model_id"
}
```

An Offering targeting an explicit Variant returns that Variant; it never redirects to the canonical Model. The display-name Fact comes only from the rehydrated target resource. No provider-model-ID projection bytes, Offering facts, provider facts, scores, provider counts, prices, precision, affiliate state, or recommendation fields enter the result.

### Filters, deduplication, and neutral order

B1 supports only these optional filters:

- `record_type=model|variant`, applied to the exact target; and
- `provider=<stable provider ID>`, applied to the same Offering witness that matched the provider model ID.

The filters are conjunctive. A different Offering for the same target cannot satisfy the provider filter on behalf of the matching witness. Every other structured filter rejects before D1; later complete-search phases own their applicability semantics.

The fixed query deduplicates by exact target type and target ID before applying the requested result limit. Multiple raw or normalized Offering matches for one target produce one result. Different targets in a collision all remain visible. A target's winning class is raw if any eligible raw witness exists; otherwise it is normalized-only. The deterministic order is:

1. raw before normalized-only;
2. normalized canonical target display-name BLOB ascending; and
3. globally prefixed stable target ID ascending.

Offering ID is used only to select a deterministic witness inside an already equal target/class group. It is not a public relevance, result, or tie-break field. Provider, Offering multiplicity, price, precision, affiliate state, popularity, input order, and operator preference cannot alter target ordering.

### Bounded reader and internal transport

B1 is a fixed SELECT-only equality reader. Its closed input binds exact publication, approved query, the two optional filters, a limit from 1 through 20, and a nullable internal continuation. Candidate SQL names both required indexes with `INDEXED BY`, selects at most `limit + 1` deduplicated targets after the keyset, and uses only bound values.

The tier-local continuation contains the last match mode (`raw|normalized`), pinned normalized target display-name string, and stable target ID. The reader validates and normalizes that string before binding its strict UTF-8 BLOB key. The continuation is valid only with the identical publication, approved query, filter set, and limit. It is not an ADR 0016 authenticated cursor, public response field, or authority to issue `page.next_cursor`.

The internal reader page also carries a closed, page-aligned `matchModes` array so the API adapter can independently validate raw-before-normalized ordering across the RPC boundary. Match mode is not part of a result item and the adapter strips both this array and the continuation before producing its storage-free API outcome.

The catalog-query Worker may add one closed named RPC method, `readProviderModelIdExactTierV1`, over the existing bookmark-continuous Session boundary. A storage-free API adapter seam may validate and map an already normalized internal request. The RPC and adapter remain first-page-only, require public continuation to be null, and emit no public cursor.

### Delivery split and nonclaims

Phase 5H is completed in additional reviewable boundaries:

- **5H-B1:** this provider-model-ID reader, canonical rehydration, target mapping, narrow filters, tier-local continuation, named RPC, internal API seam, and local acceptance evidence;
- **5H-B2:** multi-tier exact composition and the authenticated merged public cursor; and
- **later search integration:** prefix/keyword and semantic composition, public route wiring, service bindings, remote evidence, deployment, and release acceptance.

B1 creates no public route, `Request` parser, service binding, D1 resource, cursor token, Cache API entry, remote migration, provisioning, or deployment. It does not complete `/v1/search`, `SM-06`, `SM-12`, `SRCH-001`–`SRCH-010`, API conformance, or any release gate.

### Privacy and security boundary

The query, filters, bookmark, continuation, and database rows exist only in the live call chain. They are never stored, logged, traced, measured, cached, echoed in dynamic errors, or copied into fixtures or correlation identifiers. Static error classes are `invalid_input`, `integrity_failure`, and `read_failure`. A valid selected publication with no eligible match returns an empty page; missing publication sentinels or malformed/corrupt candidates fail closed.

Any later query-string response is `private, no-store`. B1 adds no cookies, browser persistence, analytics, beacons, request telemetry, request logs/traces, or visitor-derived durable keys.

## Consequences

- A literal copied provider model ID receives the strongest provider-ID match available within the approved public input transformation and ceiling.
- Pinned normalization supplies bounded punctuation, case, and separator tolerance without collapsing collision targets or inventing aliases.
- Search remains model-first: an Offering-derived pointer returns its canonical Model or Variant target and does not create provider-ranked model duplicates.
- Default results exclude inactive and stale Offering witnesses while preserving their immutable publication history.
- Provider filtering can qualify a target only through the same matching Offering and cannot affect target facts or neutral order.
- The 200-byte ceiling is preserved without pretending that all 1,024-byte or transformation-sensitive canonical IDs are reachable.
- Public exact composition and pagination remain blocked on B2 rather than leaking a tier-local keyset into the public contract.

## Alternatives considered

- Return an Offering result or deep-link directly to Offering Facts: rejected because the approved model-first journey and `SearchResult` union map provider-model-ID discovery to canonical Model or Variant resources.
- Use normalized equality only: rejected because a literal raw ID should win its normalization-collision set and empty-normalized valid IDs would otherwise be unreachable.
- Use raw equality only: rejected because it would not provide the approved punctuation, case, and separator tolerance.
- Collapse by Offering or return one row per Offering: rejected because Offering multiplicity would duplicate and implicitly weight canonical model results.
- Let any Offering for the target satisfy a provider filter: rejected because it breaks exact-witness applicability and can create out-of-filter results.
- Raise the public query limit to the Offering ceiling in this ADR: rejected because the product owner approved the existing public ceiling and did not approve a PRD or public-contract amendment.
- Issue the tier-local continuation as a public cursor: rejected because it cannot represent earlier/later exact tiers or complete merged pagination.

## Validation

- Prove closed plain input, prototype rejection, NFC trimming, exact 1/200-byte boundaries, U+0000, literal reserved characters, malformed scalar rejection, and static non-echoing errors.
- Prove raw-first and normalized-only lookup through the named indexes, empty-normalized raw-only behavior, strict BLOB binding, raw/normalized collisions, and no FTS or dynamic SQL.
- Prove and document non-reachability cases above 200 bytes, with meaningful leading/trailing space, and with raw non-NFC bytes; never advertise complete public ID reachability.
- Prove known-active/non-stale Offering and known-active target eligibility, every excluded status/stale combination, exact provider/target links, canonical ID and content hashes, strict UTF-8, canonical provider-model-ID bytes, and recomputed resource hashes.
- Prove Model and Variant mapping, canonical display Fact emission, explicit-Variant preservation, target deduplication before limit, complete collision visibility, raw/normalized class order, display-name/stable-ID keyset order, and no duplicate or omission across direct-reader pages.
- Prove record-type and same-witness provider filters, filter conjunction, filter mismatch, and rejection of every unsupported filter.
- Prove fixed SELECT-only source, `limit + 1`, publication sentinel, active and rollback-candidate selection, bounded resource/result transfer, corrupt witness/lookahead rejection, and pinned-workerd ArrayBuffer equality.
- Prove the named RPC/API seam remains bookmark-continuous, first-page-only, storage-free, and unreachable from a public route.
- Run privacy source scans and canaries for `Request`, URL/header/source-address input, cookies, Cache API, `console.*`, logs, traces, metrics, analytics, telemetry, query echo, correlation IDs, and visitor-derived persistence.

## References

- [ADR 0016: bounded local API read protocol](0016-bounded-local-api-read-protocol.md)
- [ADR 0021: canonical provider exact search](0021-canonical-provider-exact-search.md)
- [ADR 0026: model/variant BLOB exact reader](0026-blob-model-variant-exact-search-cutover.md)
- [ADR 0027: trusted provider-model-ID projection](0027-trusted-provider-model-id-projection.md)
- [ADR 0028: provider-model-ID durable storage](0028-provider-model-id-durable-storage-cutover.md)
- [Phase 5H-B1 acceptance contract](../design/phase-5h-b1-provider-model-id-reader.md)
