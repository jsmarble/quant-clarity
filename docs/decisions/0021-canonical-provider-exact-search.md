# ADR 0021: Add canonical providers to exact search without provider-derived model ranking

- Status: Accepted
- Date: 2026-08-02
- Decision owners: Product owner, staff engineer, search lead
- Related requirements: `SM-06`, `RULE-017`, `FE-010`, `FE-011`, `FE-013`, `FE-023`, `FE-025`, `FE-026`, `SRCH-002`, `SRCH-006`–`SRCH-010`, `PIPE-044`, `PIPE-050`–`PIPE-053`, `BE-003`, `BE-011`, `CF-022`, `AFF-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-005`, `QA-006`
- Extends: ADRs 0005, 0013, 0015, 0018, and 0019
- Partially superseded by: ADR 0030 replaces normalized-display-name ordering only for the composed exact-search operation; this ADR's standalone tier behavior and all other decisions remain accepted

## Context

ADR 0019 records that the sealed model/variant search projection contains publisher names and provider model IDs but not canonical provider display names. That gap prevents complete `SRCH-002` acceptance. The public search contract already permits a distinct `provider` result with `match_kind = provider_name`, and `FE-011` requires provider suggestions to be distinguishable from models and explicit variants.

Copying provider names into model or variant documents would make provider availability part of model relevance and would create ambiguous active/stale-offering semantics. It could also leak provider-derived facts into model cards or embedding inputs. The approved requirements permit a provider filter to qualify model cards, but do not say that a provider-name text match itself expands into every model offered by that provider.

## Decision

### Canonical provider result

An exact canonical provider-name query returns a distinct canonical `provider` result. It does not fan out into provider-qualified model or variant results. Selecting that result navigates to the provider resource. Provider filters remain a separate structured eligibility operation and cannot change model-card facts or the relative order of models that remain eligible.

Every published provider whose canonical `display_name` fact is `known` receives exactly one publication-scoped provider exact-search document. The name must come from the contract-valid, closure-bound provider resource and retain its evidence and observation timestamp there; the search document is only an index projection and is never canonical evidence. An unknown display name remains unknown and produces no inferred name, alias, URL-derived label, corporate-name guess, or search document.

The provider document contains only its stable provider ID, projection version `provider-name@1`, the canonical display name, its versioned normalized name, and the exact canonical provider-resource content hash. Provider aliases are absent in version 1 because no approved evidence-linked provider-alias contract exists. Affiliate state, commission, offering count, popularity, and operator preference are not match, inclusion, display-name, or ranking inputs. An unrelated affiliate-field change can still change the enclosing canonical provider-resource hash; it cannot change the projected name or result order.

Provider documents form a separate physical, reconstructible exact-search subinventory derived only from immutable closure-bound provider resources. They are readiness-bound in the same sense as the existing reproducible FTS index, not an additional canonical fact or a second copy of provider evidence. The existing model/variant search-document and vector inventories remain unchanged and one-to-one. Provider documents never receive vectors, enter model/variant `document_text`, alter embedding input or metadata, or change model vector cardinality, IDs, scores, or ordering.

### Exact matching and neutral merge

`exact-search-normalization@1` is a checked-in, golden-tested transformation based on Unicode 17.0.0 data committed with its integrity hash and license notice. In this order, it applies the Unicode 17.0.0 `toNFKC_Casefold` operation; maps every code point in General Categories `Pc`, `Pd`, `Pe`, `Pf`, `Pi`, `Po`, `Ps`, `Zl`, `Zp`, or `Zs` plus ASCII tab, line feed, vertical tab, form feed, and carriage return to one ASCII space; collapses consecutive ASCII spaces; and trims leading/trailing space. It rejects an empty result and input containing an unpaired surrogate. Ingest, query, and restore use the same checked-in tables rather than host-locale or runtime Unicode tables. It does not strip organization words, select a winner for a normalized-name collision, or synthesize aliases. Explicit model aliases continue to cover approved organization-prefix variations under `DATA-004`; provider organization-prefix, corporate, or historical alias tolerance remains `Planned` until an evidence-backed provider-alias contract exists.

Exact provider-name lookup uses an indexed equality predicate on publication ID plus normalized name. Raw visitor input is never interpolated into SQL or passed directly to FTS5 `MATCH`; FTS syntax parsing remains a separate bounded keyword concern. Normalized-name collisions retain every distinct canonical provider ID and return them through the existing bounded, stable pagination rather than overriding the 20-result request ceiling.

The deterministic result tiers are:

1. exact canonical model or variant name;
2. exact provider model ID;
3. exact canonical provider name;
4. explicit model or variant alias;
5. prefix or keyword candidate; and
6. semantic similarity.

Within each exact tier, normalized canonical display name and stable resource ID are the only ordering keys. A model/provider name collision remains two distinct results, with the model-first tier first. Existing approved BM25 and semantic-similarity relevance applies only inside their later respective tiers, with the existing stable-ID tie break; provider facts never enter a model keyword or semantic score. Search fields identify candidates only; every response rehydrates the canonical publication resource.

Provider projection rows are retained with their publication for reproducibility. Default search emits a provider only after canonical rehydration proves `status.state = known` and `status.value = active`. Unknown, inactive, unavailable, deleted, or otherwise non-active providers are excluded by default; an explicit supported status filter may select retained historical states without changing their facts or order.

### Integrity, readiness, and migration

The canonical provider bytes and their content hashes already participate in the publication resource inventory, resource chunks, and closure hash. Provider exact-search documents therefore do not change `exact_document_count`, the model/variant exact-search inventory or chunks, `vector_document_count`, vector hashes, or embedding inputs. The provider projection is reproducible from those closure-bound bytes and must retain the exact source resource hash. Archive construction separately proves that its declared bundle contains the closure; this ADR does not infer that relationship from the resource hash alone.

Implementation uses a new publication-scoped ordinary projection table and an indexed normalized-name lookup. A nominal trusted core projection recomputes the normalized name and SHA-256 inventory root over the complete row set before any adapter write. Serialized, copied, reflected, or caller-hashed projections are rejected. Inserts are permitted only for an unsealed `building` publication and must prove the matching provider resource, provider attribution, selected-content provider disposition with a non-null slice and `fresh` or carried-forward `stale` freshness, exact resource content hash, and known evidence-backed display-name bytes. An `unavailable` provider contributes no provider resource or search document. Updates and deletes are prohibited, and no row may be added after sealing. Normalized-name collisions remain separate rows.

The inventory hash uses ADR 0015's version-1 length-prefixed tuple encoding exactly. Its root tuple begins with domain `publication-provider-search-inventory` and encoding version `1`, followed by the collection field `provider_search_documents`, type `list`, and minimal base-10 item count. Rows sort by validated lowercase provider ID and duplicate provider IDs reject. Each nested row tuple begins with domain `publication-provider-search-document` and encoding version `1`, followed in this exact order by `projection_version`/`text`, `provider_id`/`identifier`, `display_name`/`text`, `normalized_name`/`text`, and `provider_resource_content_hash`/`digest`. Text uses its already-validated UTF-8 bytes. An empty inventory is the same root tuple with list count `0` and no nested row tuples; it does not use an empty string, null, or sentinel record. The resulting lowercase `sha256:` digest is publication-scoped by the receipt/preflight fields that also bind publication ID and closure hash.

A separate reconstructible provider keyword FTS5 table is mandatory, uses build identity `provider-name-fts5-unicode61@1`, and is populated only from the ordinary provider projection. Exact classification still uses indexed normalized equality rather than FTS/BM25 rank. Fixed SQL can prove raw canonical display-name/content-hash linkage, exact persisted values supplied by a nominal projection, counts, versions, and bidirectional projection/FTS parity; it does not claim to reproduce Unicode normalization or SHA-256. Before `building` becomes `ready`, the trusted core recomputes the complete projection/root from canonical rows and the fixed adapter binds that exact root plus successful version-controlled provider-name probes. Switch preflight, activation, and rollback repeat the same trusted recomputation and fixed SQL parity. Corruption or omission fails closed without changing the head.

The four ADR 0019 receipt kinds remain, but schema 1.5 uses readiness receipt version `2.0.0`. Its serving receipt adds the closed fields `provider_search_projection_version`, `provider_search_document_count`, `provider_search_inventory_hash`, `provider_search_fts_build_version`, `provider_search_fts_document_count`, `provider_search_fts_queryable`, and `provider_search_exact_parity`; all are included in the serving-receipt hash. The readiness evaluator/attestation version becomes `2.0.0`, and its existing serving-receipt-hash field transitively binds the new proof. Search probes become `search-gold@2` and include provider exact, collision, inactive-default, and corruption cases.

Switch preflight version `2.0.0` carries and hashes the same provider projection version, source/index counts, inventory root, FTS build identity, queryability, and exact-parity fields. The switch event shape remains `1.0.0` because it already binds the exact preflight hash. The existing `fts_document_count` continues to mean the model/variant FTS count and is not silently repurposed. Exact reads rehydrate the canonical provider resource, apply default/explicit status policy, and recompute normalized equality before emitting `match_kind = provider_name`; index bytes never become response facts.

The implementation bumps the serving schema to `1.5.0` and uses provider projection `provider-name@1`, provider FTS `provider-name-fts5-unicode61@1`, readiness receipts/evaluator `2.0.0`, search probes `search-gold@2`, and switch preflight `2.0.0`. The publication manifest and backup-manifest formats do not change because the provider projection is reproducible rather than a new closure or portable source; version meanings may not be silently broadened.

Migration 0007 must require schema `1.4.0`, reject legacy sealed/readiness/head/switch state instead of fabricating new evidence, and remain atomic and retryable. Only eligible unsealed `building` publications may be populated before sealing. Failed publications may remain unprojected and nonqueryable; migration does not create a recovery transition for them. QuantClarity has no authorized deployable serving binding yet, so the project will not pretend that an in-place populated-database conversion has been proved.

Portable backup omits the provider projection and its FTS table. Restore imports the canonical provider resources, rebuilds the ordinary projection while the restored publication is unsealed `building`, builds FTS, recomputes the v2 serving proof, and compares rows, root, and exact results before readiness or switching. The provider resource remains the sole canonical fact.

### Privacy boundary

Provider exact-search rows are public catalog facts, not visitor data. Search requests remain transient and `private, no-store`, with no cookies, browser persistence, Cache API entry, request log, trace, analytics event, metric label, correlation ID, click record, or raw-query error echo. Query code uses fixed SELECT-only SQL, bound normalized values, publication pinning, bounded results, and static errors.

## Consequences

- `SRCH-002` can be completed without adding provider-derived model ranking or provider vectors.
- Provider suggestions are visibly distinct canonical resources that can be rehydrated and linked to stable provider pages.
- Provider-name changes create a new publication; immutable projection triggers prevent active search-state mutation.
- Unknown provider names and normalized-name collisions fail honestly instead of being guessed or collapsed.
- Inactive and unknown-status providers remain reproducible but are excluded from default search after canonical rehydration.
- Readiness and switching cryptographically bind explicit provider source/projection/index proof without repurposing the existing model/vector counts.
- Provider-name-to-model fan-out remains out of scope. If product intent later requires it, the PRD must first define eligibility, inactive/stale behavior, result placement, and model-card neutrality.

## Alternatives considered

- Copy provider names into every model/variant search document: rejected because offering/provider availability would become a model relevance input and could affect FTS frequency, embeddings, or model ordering.
- Convert a provider-name query into all active models offered by that provider: rejected because the current requirements and contract support a distinct provider suggestion but do not define the necessary freshness, status, fan-out, or ordering semantics.
- Add provider vectors: rejected because provider suggestions are exact catalog identities and ADR 0005 fixes vector grain at one model or explicit variant.
- Infer provider aliases from URLs, provider model IDs, marketing names, or corporate expectations: rejected because every non-null public fact requires evidence and unknown is valid.
- Use FTS rank to identify an exact provider name: rejected because exact classification must be deterministic and raw FTS syntax is an avoidable injection/complexity boundary.
- Store a second canonical provider-name fact in the search projection: rejected because the provider resource is already the evidence-backed, closure-bound source; the index must retain its hash, remain immutable after sealing, and be rehydrated rather than become canonical.

## Validation

- Prove exactly one provider document per known canonical provider display name and none for unknown names.
- Prove provider projection rows are deterministic under input permutation and normalized-name collisions and retain the exact provider-resource hash.
- Prove case, punctuation, separator, Unicode, empty, maximum-length, and hostile FTS-like inputs use bounded normalized equality.
- Verify checked-in Unicode data hashes and published Unicode normalization/case-fold conformance vectors, then compare fixed normalization and inventory-hash hex vectors produced by an independent test implementation that imports neither the production helper nor its table parser.
- Prove exact model/provider collisions retain both identities and the fixed model-first tier.
- Prove inactive, unavailable, deleted, and unknown-status providers are absent by default and only supported explicit status filters reveal retained historical states.
- Prove provider count, offering multiplicity/order, affiliate changes, and commission cannot alter provider exact results or any model document/vector input, ID, score, card content, or order.
- Prove provider documents never produce vectors and every search result rehydrates its canonical resource.
- Delete, add, and corrupt provider projection/FTS rows before readiness and switching; each operation must fail closed without replacing the last known-good head, and post-seal ordinary-row mutation must be impossible.
- Inject failure at every migration statement and prove schema `1.4.0` remains retryable.
- Rebuild from a portable publication bundle and compare provider rows, hashes, and exact results byte-for-byte.
- Include canonical provider-name cases in the version-controlled set of at least 50 exact queries with zero filter violations.
- Use visitor-query canaries to prove absence from logs, traces, metrics, caches, artifacts, errors, and browser persistence.

## References

- [The Unicode Standard, Version 17.0.0](https://www.unicode.org/versions/Unicode17.0.0/)
- [Unicode normalization forms and default case algorithms](https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-3/)
