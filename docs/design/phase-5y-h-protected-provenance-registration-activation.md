# Phase 5Y-H: Protected provenance registration activation

| Field | Value |
|---|---|
| Status | Proposed; review-candidate registration/root/field artifacts, typed root-binding plan, independent codec vectors, Phase 5Y-H1 frame-composition evidence and Phase 5Y-H2a complete preimage inventory locally implemented; derived digest linkage, connected traversal execution, normative resolver/semantic contract, accepted limits, migration and activation evidence pending |
| Decision | [ADR 0067](../decisions/0067-protected-provenance-registration-activation.md) |
| Planned migration | `migrations/canonical/0010_activate_provenance_v2_registration.sql` |
| Requirements | `DATA-030`–`DATA-046`, `DATA-048`–`DATA-051`, `DATA-055`–`DATA-064`, `PIPE-010`–`PIPE-022`, `PIPE-030`–`PIPE-045`, `PIPE-050`–`PIPE-056`, `BE-005`, `SEC-003`–`SEC-006`, `SEC-011`, `SEC-012`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `LEG-001`, `LEG-002`, `QA-002`, `QA-006`, `QA-007`, `QA-010`–`QA-012` |

## Intended outcome

Activate migration 0009's private registration vocabulary without making a partial staged plan authoritative. A fixed private writer may append and exactly resume bounded plan-definition pages. Registration close freezes every plan-scoped table. A separately implemented root oracle then recomputes every leaf, collection and plan root from normalized columns. One final atomic batch may create the oracle receipt, base seal and approval only after reasserting the complete current authority boundary.

Provider-bundle opening is enabled only with a current exact installation, approved unrevoked plan, admitted run and Provider, matching roster/register/manifest, eligible time interval, no terminal state, and current unreleased Provider fence. Permits, responses, source effects, source-backed outcomes, artifacts, selection, serving, remote resources and deployment remain blocked.

## State machine

```text
absent
  -> staged (bounded append-only pages; no authority)
  -> closed (all tables frozen; no authority)
  -> oracle-verified + approved (registration authority only)
  -> revoked (historical authority retained; no new bundle)

approved + exact admitted Provider run + current fence
  -> Provider bundle open (still no acquisition/effect authority)
```

There is no update, delete, reopen, repair or replacement transition. An interrupted staging operation may resume only exact missing rows from the same canonical plan. A closed graph whose independent root does not match is permanently stranded.

## Planned implementation components

| Component | Responsibility | Authority boundary |
|---|---|---|
| Migration 0010 | Exact-match migration 0009; atomically rebuild the empty vocabulary/precedence portion; install active/freeze/closure guards before replacing only registration/approval/bundle blockers | No authority rows or approval |
| Root contract registry | Fix every leaf/set domain, column/type/order, child relation, digest-output slot and safe-preimage/external-anchor classification; check registry/schema closure | Specification only |
| Registration document | Retain bounded canonical safe preimages in private immutable D1 chunks with exact whole/chunk commitments | Non-authoritative witness only |
| Runtime-neutral registrar | Strict canonical-plan validation, DNS/SSRF/path/header/credential checks, independent content digests, bounded deterministic row plan | No D1 or source access |
| Private D1 registration adapter | Fixed prepared statements, dependency-ordered bounded pages, exact readback and same-operation reconciliation | Staging only |
| Registration close adapter | Exhaustive relational/count/order checks and post-close freeze on a fresh primary transaction | Immutable candidate only |
| Independent root oracle | Keyset-paged frozen-row and canonical-document reads; independent safe-preimage, leaf/set/authority hashing and exact parity | Proof result only |
| Approval/revocation adapter | Atomic oracle-receipt/seal/approval and append-only revocation with current-state reassertion | Mints or removes future registration authority |
| Bundle-opening adapter | Exact admitted-run/Provider/register/manifest/time/fence revalidation and one immutable bundle | No permit or source effect |

All database adapters live only in `apps/pipeline`. The runtime-neutral codec/validator may live in `packages/pipeline-core`, but the oracle must not import its hashing implementation. Public Workers gain no method, route or binding.

## D1 protocol

Every database operation starts a fresh `withSession("first-primary")` session. Writes are fixed `batch()` transactions; dynamic SQL and `exec()` are forbidden. Batch results are hints, not proof. Exact fresh-primary readback classifies each operation as applied, absent, partial staging, mismatched, or outcome unknown. Atomic operations treat partial state as corruption. An unreadable reconciliation forbids retry until the identical operation is reconciled.

The design relies only on current documented D1 guarantees: a batch is a sequential transaction and rolls back when a statement fails; a first-primary session begins at current primary state and remains sequentially consistent. It does not treat a session as a cross-request transaction or persist a D1 bookmark.

Migration 0010 must also atomically install and permanently close the initial global field vocabulary and rebuild the still-empty precedence/admission portion so one precedence class can contain multiple source classes. Migration 0009's missing edge means incomparability, not equality; therefore Provider API and authenticated catalog are both members of one structured-Provider class with identical primary/conflict semantics, while edges order that class against other actual classes. Publisher and independent sources cannot become primary Price, serving-Precision or applicability authority in the initial corpus.

The exact machine-readable field corpus and raw-provider-field mapping remain prerequisite deliverables. They must preserve complete record groups: one Offering applicability tuple, one atomic Price tuple, and one atomic summary/component Precision tuple. Every group has one committed identity and ordered membership; all members share one policy version, endpoint admission/exclusion, precedence graph and effective interval. Scalar policies cannot splice amount/currency/conditions, raw/normalized/component precision, applicability, observation or evidence across unrelated claims. Initial primary policies use a total class order; incomparability cannot select or fall back to a source.

## Security and data-integrity boundary

Endpoint registration accepts exact `https`/`GET` templates and credential binding names, never request values, secrets or full URLs. It rejects IP literals and obfuscated IP forms, local/special/private/reserved names, malformed A-labels, unsafe redirects/paths/headers, manifest drift, owner inference, permission drift, ceiling expansion and unapproved field roles. Acquisition must later repeat DNS-answer and redirect validation to prevent rebinding.

The oracle recomputes every leaf digest from all registry-declared authority columns using versioned, domain-separated, typed uint64-length-prefixed bytes and verifies a stored digest only where the registry designates an output. Every other hash column is registry-classified as a recomputed safe-preimage digest or a named external approved anchor; an unclassified hash fails. The oracle independently repeats endpoint, manifest/register/owner, precedence, record-group, verifier, interval and aggregate-ceiling semantics and rejects any digest mismatch, unexpected member or order discrepancy. Provider structured sources remain an equal-authority class; publisher and independent sources cannot be promoted through labels; equal-authority disagreement remains unresolved.

## Verification and exit criteria

Implementation status may advance only when:

1. Node SQLite and real workerd/D1 prove exact migration, rollback, blocker replacement and unchanged permit/effect refusal;
2. minimum and accepted-scale plans pass every vocabulary, closure, root and lifecycle vector;
3. one aggregate normalized-row/byte/hash/D1-call/CPU budget is fixed from accepted-scale workerd evidence and enforced before staging;
4. DNS/SSRF, path, redirect, auth/header, credential, source-owner/register/manifest, precedence/equivalence and verifier-independence adversarial matrices pass;
5. the normative registry covers every authority column and independent Node and WebCrypto implementations match checked-in golden bytes without sharing encoder/traversal code;
6. every D1 ambiguity classification and stale authority/fence race is exercised;
7. privacy scans prove zero visitor material, credential values, logs/telemetry, public bindings and bookmark persistence; and
8. independent architecture, data-neutrality and security/privacy reviews have no unresolved P0–P2 finding.

Passing this phase will prove only private registration approval and guarded bundle opening. It will not prove source execution, canonical facts, public data, remote migration, release readiness or deployment.

## Local contract evidence

The contract-review candidate is locally implemented without changing any Worker, route, binding, migration, resource or blocker. Generated artifacts under `contracts/generated/provenance-v2/` draft strict canonical JSON, binary frame tags/lengths, the 32-path field/record-group corpus, raw-field mapping grammar, semantic-oracle obligations, table/root ownership and hash provenance, plus frame bytes/digests for each proposed leaf and collection domain. The additive `root-binding-plan.v1.json` gives every registered digest and root-member count exactly one typed draft resolver; distinguishes leaf outputs, document values, retained bytes, approved D1 rows, repository artifacts whose build-manifest status remains pending, recomputed row references, collection references and record-frame outputs; fixes typed order/collation and heterogeneous table-family ordinals; binds all successor child count/root claims; and keeps complete resolver and migration-schema closure explicitly pending until migration 0010 exists. Closed TypeBox schemas cover `ProvenanceV2RegistrationPlan@1`, `ProvenanceV2AdapterReceipt@1`, the explicit `ProvenanceV2SuccessorManifest@1` preimage, the root-binding plan, raw mappings and pending aggregate limits. Focused review-candidate helpers reject representative unsafe hosts, paths, safe locators and raw-pointer extensions. Separate Node and WebCrypto tests reconstruct every existing codec vector without importing a shared encoder or hash helper. [Phase 5Y-H1](phase-5y-h1-independent-composite-root-evidence.md) composes all 33 isolated root-member leaf families through 38 family projections and the proposed higher-frame codec into plan-shaped digests, the authority-root frame and an explicitly refused candidate receipt with a second independent workerd implementation. [Phase 5Y-H2a](phase-5y-h2a-connected-registration-graph.md) adds the complete 371-row leaf-preimage inventory across all 33 families, including field-specific expansion of the compiled corpus. Derived digest linkage, scope/order traversal, successor parity and higher-frame recomputation remain pending for H2b.

These artifacts remain review evidence, not a normative registration contract. The root-binding plan makes the proposed digest/count targets and cross-table order machine-readable and locks the reviewed artifact as one canonical singleton. Phase 5Y-H1 supplies isolated family-projection and higher-frame vectors, while Phase 5Y-H2a supplies a complete multi-row preimage inventory but no derived digest linkage, computed leaf or traversal result. Executable connected traversal, safe-preimage/external-anchor/repository resolvers, D1 enumeration and scope closure, the independent semantic oracle, migration-0010 schema parity, build-manifest verification, a full registration-document/root golden vector, strict duplicate-detecting byte ingestion, immutable record-group instance identity, deterministic-derivation mappings, exact verifier matrices and complete hostile mutation vectors remain prerequisites. In particular, a caller-provided child root in the successor manifest remains only a claim for later oracle comparison and cannot confer authority.

Aggregate values deliberately remain `benchmark_pending`, the schema admits no caller-declared accepted status or evidence digest, and the candidate inspector always refuses authority. These contracts cannot activate migration 0009 or authorize a source. The accepted-scale audit also established that local D1 metadata and wall time do not prove Worker CPU: the future evidence contract must distinguish D1 API calls from SQL statements and keep CPU acceptance pending until an approved profile or protected remote run exists. The next slice must close the remaining contract-review gaps and then build the real migration-0010 registrar/oracle path before benchmarking it; bypassing migration 0009's blockers would measure a different and non-authoritative system.
