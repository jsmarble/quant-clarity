# Phase 5Y-H2a: Connected registration graph preimages

| Field | Value |
|---|---|
| Status | Locally implemented complete synthetic leaf-preimage inventory review candidate; derived digest linkage, hashing, traversal execution, authority, semantic-oracle, migration and aggregate acceptance remain blocked |
| Decision | [Proposed ADR 0067](../decisions/0067-protected-provenance-registration-activation.md) |
| Requirements | `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-064`, `PIPE-030`–`PIPE-045`, `SEC-003`–`SEC-006`, `QA-006`, `QA-007`, `QA-010`–`QA-012` |

## Outcome

This slice freezes one closed, synthetic input inventory for the proposed provenance-v2 root traversal. The generated `provenance-v2-connected-registration-graph@1` artifact contains the exact authority-column preimage shapes, in registry order and excluding only each row's designated digest output, for all 33 root-member table families. Relational identities, field membership and declared counts are connected; hash-valued references to derived child rows remain synthetic placeholders until H2b computes and substitutes them topologically.

The graph contains 371 rows: 17 adapter-family members, 73 endpoint-family members, three verifier-family members and 278 field-policy-family members. The field-policy collection includes the complete compiled field corpus: 32 vocabulary rows, 87 field-authority-role rows, 68 field-specific enum rows, four record-group rows and 32 record-group-member rows. The 68 enum count is intentionally larger than the 46 values across unique enum domains because the normalized registry keys each enum member by canonical field identity; shared domains are expanded once for every field that uses them.

One synthetic endpoint declares and maps all 32 canonical fields, all four immutable record groups, three admitted groups and one excluded group. Four field policies include every member, five precedence classes, nine class/source memberships, one exact edge and exhaustive endpoint dispositions. Eleven ordered credential rows preserve a connected numeric `0` through `10` ordering case without inventing unconsumed owner identities. The `z`/`é` probe is separately and explicitly comparator-only because the current valid normalized row keys do not provide a truthful multibyte tie-break case.

Collection-member counts remain distinct from authority-frame entity counts. In particular, the proposed collection shapes contain `17/73/3/278` members while their entity counts are `1/1/1/4`. `root_member_row_count: 371` is an artifact-local inventory; it is not a claim about migration 0010's future `normalized_row_count`, whose exact inventory remains pending.

## Authority firewall

This artifact contains leaf-preimage shapes, not stored digest outputs, computed leaves, collection roots, a successor-manifest hash, an authority root or an oracle receipt. Its closed shape is `review_candidate`, `authority_eligible: false` and `outcome: authority_refused`; derived digest linkage and leaf/traversal recomputation are both encoded as `pending`. It adds no Worker handler, D1 access, route, binding, migration, remote resource, logging, telemetry or deployment configuration.

Opaque digest-valued columns are synthetic comparison inputs only. The artifact does not resolve safe document preimages, retained chunks, approved external rows or repository artifacts, and it cannot prove the semantics, currency, precision or applicability of any public fact. No fixture value identifies a real provider, visitor or credential, and the artifact remains outside the public OpenAPI allowlist.

## Verification boundary

The validator first takes a bounded descriptor snapshot and rejects accessors, hostile property reads, exotic prototypes, symbols, cycles, sparse arrays, oversized arrays and non-safe integers. It then requires exact equality with the reviewed singleton. Focused tests prove:

- exact registry field name/order closure, with every designated digest output excluded from its own preimage;
- complete, unique 371-row and 33-table accounting;
- exact field-specific expansion of shared enum domains;
- complete endpoint declaration/mapping and field-policy membership of all 32 corpus paths;
- explicit separation of collection-member and authority-entity counts; and
- fail-closed mutation and hostile-object handling without evaluating getters.

[Phase 5Y-H2b](phase-5y-h2b-connected-traversal-vectors.md) independently encodes and hashes this graph in Node and workerd, applies the typed scope/order plan, rejects order-key collisions and unconsumed rows, substitutes the three mechanically resolvable parent digests and links the four plan roots through synthetic authority and refused-receipt frames. Successor-manifest preimage parity, document/anchor resolvers, the complete semantic oracle, reviewed build manifest, migration 0010 and frozen D1 enumeration, accepted aggregate limits and all protected writers remain pending.
