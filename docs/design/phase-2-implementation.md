# Phase 2 implementation evidence

| Attribute | Value |
|---|---|
| Status | Local implementation in progress; external approval inputs pending |
| Branch | `codex/canonical-provider-slice` |
| Requirements | `DATA-001`–`DATA-067`, `PIPE-010`–`PIPE-022`, `BE-001`–`BE-006`, `LEG-001`–`LEG-002`, `QA-001`, `QA-002`, `QA-010`–`QA-012` |

## Implemented local evidence

| Verification area | Artifact | Current evidence |
|---|---|---|
| Stable identity and canonical schema | `migrations/canonical/0001_registry_identity_and_scope.sql` | Typed registry, identity/lineage records, exact offering tuple, typed immutable claim scopes, and indexes |
| Provenance, facts, price, precision, roster, and runs | `migrations/canonical/0002_provenance_facts_and_control.sql` | Observation/evidence linkage, claims/conflicts, separate precision components and price roles, source register, roster, and control-plane state |
| Canonical negative invariants | `migrations/canonical/0003_integrity_triggers.sql` | Registry/type checks, exact applicability, lifecycle, append-only audit state, and source-approval gates |
| Publication metadata | `migrations/serving/0001_publication_metadata.sql`, `0002_publication_integrity.sql` | Immutable publication resources, ordinary search documents, closure checks, and protected head/rollback state; FTS remains Phase 4 |
| Schema and decimal tests | `packages/canonical/src/migrations.test.ts`, `packages/canonical/src/index.test.ts` | Fresh migration application, FK checks, hostile inserts, identity/applicability/evidence/price/precision/publication constraints, fixed-width decimal property tests, and staleness policy |
| Adapter contracts | `packages/contracts/src/index.ts`, `packages/contracts/src/index.test.ts` | Versioned manifest, exact source-to-credential injection, redirect cap, fail-closed compliance expiry, safe locators, roster, fixture metadata, exact candidate applicability, and terminal coverage |
| First-provider boundary | `packages/adapters/fireworks/src/index.ts`, `index.test.ts` | Pure deterministic plan/parser/mapper with no fetch/storage/secret access; local/test only; exact-offering precision stays unknown when only base-object metadata exists |
| Retained fixture | `fixtures/providers/fireworks/` | Invented synthetic identities/prices plus executable normal, pagination, missing, drift, malicious-text, separate-price, precision-normalization, and base-applicability tests; no captured provider bytes |
| Source/legal record | `docs/compliance/sources/fireworks.md` | Pending register whose content hash is pinned by the adapter; all access/retention/publication decisions remain false |
| Publication consistency | ADR 0013 and publication-consistency tests | Header pin, cursor agreement, request-lifetime D1 bookmark, safe internal cache key, and publication-qualified Vectorize identity |

## Gate state

- `GATE-applicability-integrity`: local SQL, adapter, and base-object negative inputs implemented; deployed preview proof pending.
- `GATE-evidence-dlp`: contract and synthetic-fixture inputs implemented; deployed acquisition/redaction/R2 proof pending.
- `GATE-legal-source-register`: register template and immutable reference implemented; authorized review and approval pending.
- `GATE-api-contract`: publication-pin machine contract implemented; data-backed query/API conformance remains Phase 5.

The case matrix deliberately marks retrieval-failure terminal mapping as Phase 3 pending and equal-authority conflict-to-public-unknown selection as current-claim-selector pending. Labels alone are not counted as executable evidence.

No live provider request, authenticated payload retention, Cloudflare resource creation, migration apply, preview deployment, or production enablement is claimed by this evidence.
