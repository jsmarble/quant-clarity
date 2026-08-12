# Phase 5Y-H2b: Connected traversal vectors

| Field | Value |
|---|---|
| Status | Locally implemented connected synthetic leaf/traversal evidence; authority remains refused and all resolver, semantic, migration, D1 and aggregate acceptance gates remain pending |
| Decision | [Proposed ADR 0067](../decisions/0067-protected-provenance-registration-activation.md) |
| Requirements | `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-064`, `PIPE-030`–`PIPE-045`, `SEC-003`–`SEC-006`, `QA-006`, `QA-007`, `QA-010`–`QA-012` |

## Outcome

This slice independently encodes and hashes the complete [H2a](phase-5y-h2a-connected-registration-graph.md) synthetic graph in Node and real workerd. Both implementations recompute all 371 leaf outputs, apply the reviewed typed scope and complete order tuples, produce 386 traversal-member projections and reproduce all nine collection roots. The four plan roots consume every H2a row exactly once; the five Provider-scoped claim traversals deliberately reuse 15 of those rows as additional views.

Three mechanically resolvable draft bindings are applied before their dependent leaves: the source-register member collection root and the endpoint/manifest-source row digests referenced by endpoint registration. The source-register count is independently reconciled. The artifact then composes the four computed plan roots into a 22-field synthetic post-resolution authority frame and links its digest into a six-field refused receipt frame.

The H2a fixture now also respects equal resolver identity: the same source-register artifact, adapter manifest and endpoint path-template inputs share their exact synthetic digests wherever the draft binding plan resolves the same logical object. Other unresolved inputs remain collision-free. This is fixture consistency, not resolver execution or evidence approval.

## Exact evidence

The generated `provenance-v2-connected-traversal-vectors@1` artifact pins:

- 371 leaf outputs represented by one domain-separated leaf-manifest digest;
- 371 plan-root projections plus 15 Provider-claim projections;
- collection member counts `1/1/1/11/1` and `17/73/3/278` for the five Provider and four plan traversals;
- ordered-row manifests and collection roots for every traversal;
- the three computed parent substitutions and source-register receipt leaf;
- the Provider child count/root claim tuple, without claiming successor-manifest parity; and
- exact synthetic authority/refused-receipt frame bytes and digests.

Caller row order is non-authoritative. Numeric ordinals use exact integer ordering, UTF-8 text uses unsigned byte ordering, and a duplicate complete order tuple fails before projection. The connected credential rows prove numeric `0` through `10`; `z`/`é` remains an honestly labeled comparator-only probe because the normalized fixture has no valid multibyte tie-break key.

## Authority firewall

The artifact is permanently shaped as `review_candidate`, `authority_eligible: false`, `outcome: authority_refused`, `persisted: false` and `semantic_oracle_executed: false`. Its authority-frame scalar inputs are explicitly `synthetic_post_resolution_fixture`; they do not prove registration-document, authority-plan, installation or close-row lookup. The H2a row count is not treated as migration 0010's future `normalized_row_count`.

Safe-preimage and external-row/repository resolvers, successor-manifest JCS parity, the complete semantic oracle, reviewed build manifest, migration-schema parity, frozen fresh-primary D1 enumeration and accepted aggregate limits remain machine-readable `pending`. Forty opaque digest inputs stay comparison inputs only. No Worker handler, route, binding, D1 operation, migration, resource, log, trace, telemetry, seal, approval, permit, public response, source effect or deployment surface is added.

## Verification

The Node implementation uses `Buffer` and `node:crypto`; the workerd implementation separately uses `Uint8Array`, `TextEncoder` and WebCrypto. They share only static review artifacts, not encoders, comparators, traversal helpers or hash helpers. Focused tests cover complete recomputation, reverse caller order, numeric and UTF-8 comparison, missing/duplicate/extra/cross-scope rows, complete-order collisions, opaque-input mutation and exact authority-to-refused-receipt linkage. The closed artifact validator descriptor-snapshots bounded plain data and rejects accessors, hostile proxies, sparse arrays, cycles, symbols, exotic prototypes and prototype-key smuggling without evaluating hostile properties.

[Phase 5Y-H2c](phase-5y-h2c-connected-successor-manifest-vectors.md) independently reconstructs and JCS-hashes the already-defined complete synthetic successor-manifest preimage, requires adapter-receipt stored parity and recomputes the affected H2b cascade. It does not execute a retained registration-document selector. The next slice must implement strict document-byte ingestion and every document/retained/external/repository resolver against independently retained witnesses. Semantic-oracle closure, migration 0010 and post-close guards, D1 race/rollback enumeration and accepted-scale evidence remain later gates. No requirement status advances in either slice.
