# Phase 4E: trusted provider exact-search core

- Status: local core implemented; persistence, readiness, query, and deployment evidence pending
- Decision: [ADR 0021](../decisions/0021-canonical-provider-exact-search.md)
- Requirements: `SRCH-002`, `SRCH-006`, `SRCH-009`, `FE-023`, `FE-025`, `FE-026`, `AFF-004`, `BE-011`, `QA-005`

## Implemented local boundary

The runtime-neutral publication core now pins `exact-search-normalization@1` to checked-in Unicode 17.0.0 source data and generated tables. Production normalization applies the Unicode `NFKC_CF` mapping, a data-driven NFC pass, the ADR 0021 punctuation/separator mapping, space collapse, and empty/unpaired-surrogate rejection without host normalization, case, locale, or Unicode-category APIs.

`projectProviderSearchProjection` accepts only a nominal immutable manifest produced by the publication core plus the exact provider-resource bytes declared by that complete manifest. It recomputes every provider resource content hash, validates the provider contract and evidence-bearing display-name fact, applies the closed fresh/carried-stale/unavailable rules, retains normalized-name collisions, and returns a frozen nominal projection with the exact ADR 0021 inventory root and closure hash. Caller-supplied rows, copied manifests, copied projections, omitted resources, and caller hashes are not trusted.

Provider names remain a separate provider projection. No provider name, offering count, affiliate state, or other provider-derived value enters a model/variant search document, vector, result identity, or ordering input. Unknown display names produce no inferred row; punctuation-only known names fail the publication projection rather than becoming a fabricated value.

## Local verification

- `packages/publication-core/src/unicode/exact-search-normalization.test.ts` compares production behavior with an independent raw-UCD oracle across every affected mapping/category scalar and 100,170 published normalization inputs. It also covers compatibility folding, NFC composition/reordering, Hangul, ignorables, every configured separator category, empty output, and unpaired surrogates.
- `packages/publication-core/src/provider-search-projection.test.ts` covers known/unknown/unavailable states, fresh and carried-stale selection, normalized collisions, permutation invariance, exact fixed inventory hashes, manifest/resource completeness, nominal trust, mutation isolation, evidence/timestamp failures, input ceilings, and affiliate/offering-count neutrality.
- `npm run unicode:check` verifies checked-in source/license hashes, all 20,034 Unicode normalization rows used by the deterministic generator, and byte-for-byte freshness of the generated production tables.

## Non-claims and next boundary

This slice adds no D1 table, Worker binding, public query route, cache, visitor processing, deployment configuration, or Cloudflare resource. It does not complete any traceability row. The next additive slice defines dormant readiness and switch-preflight v2 proof models; migration 0007 and the active D1 writers must still land together before any provider projection can become queryable.
