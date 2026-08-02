# Phase 4 local-kernel evidence

| Attribute | Value |
|---|---|
| Status | Local publication decisions implemented; Cloudflare runtime, backup/restore, and public-read evidence pending |
| Branch | `codex/atomic-publication-kernel` |
| Requirements | `SRCH-006`, `SRCH-007`, `API-003`, `PIPE-050`–`PIPE-056`, `BE-010`–`BE-012`, `CF-022`, `QA-006` |

## Implemented local evidence

| Verification area | Artifact | Bounded evidence |
|---|---|---|
| Canonical closure hashing | `packages/publication-core/src/index.ts`, `index.test.ts`; [ADR 0015](../decisions/0015-publication-closure-and-lifecycle.md) | Versioned, domain-separated, length-prefixed SHA-256 inputs; deterministic inventory order; lifecycle excluded from closure identity; malformed and duplicate identities rejected |
| Provider-slice closure | `packages/publication-core/src/index.ts`, `index.test.ts` | Exact provider/slice/run lineage, explicitly null slice identity for unavailable providers, carried-forward content identity, and publication-time freshness inputs represented without fabricating content |
| Search/vector inventory | `packages/publication-core/src/index.ts`, `index.test.ts` | One model/explicit-variant search document and ADR 0013 vector ID per searchable resource; exact namespace/resource mapping; extra, missing, duplicate, offering/provider, and provider-count-derived entries rejected |
| Readiness decision | `packages/publication-core/src/index.ts`, `index.test.ts` | Closed local readiness inputs cover sealed closure, provider slices, resource/search/vector parity, declared integrity, and required probe receipts; a count or `queryable` Boolean alone cannot authorize a switch |
| Activation and rollback planning | `packages/publication-core/src/index.ts`, `index.test.ts` | Exact-generation compare-and-swap plans, former-head rollback binding, normalized head derivations, monotone switch time, one-generation advance, and append-only switch-event intent |
| Last-known-good preservation | `packages/publication-core/src/index.ts`, `index.test.ts` | Failed, incomplete, unready, mismatched, stale, or replayed candidate decisions do not produce an authorized head-switch plan |
| Publication selection and hot-retention decisions | `packages/publication-core/src/index.ts`, `index.test.ts` | Active/pinned/expired selection and cache-safe hot eligibility operate only on validated publication identities; no public Worker, D1 session, cache, cursor, or response behavior is claimed |
| Backup/restore planning | `packages/publication-core/src/index.ts`, `index.test.ts` | Closed manifest/chunk identity and consistency-boundary decisions support deterministic logical export and search reconstruction planning without claiming an actual backup or restore |
| Privacy and retention boundary | `packages/publication-core/src/index.ts`, `index.test.ts` | Closed publication/control-plane fields only, no live request/query/header/address inputs, and no physical-pruning command while the separately reviewed fenced design is absent |

The local kernel is pure decision code. It does not read or write D1, R2, FTS5, Vectorize, Cache API, Workflow state, or Cloudflare configuration. Its readiness receipts are typed local evidence, not proof that a remote mutation became visible or that a probe ran in the required environment. [ADR 0015](../decisions/0015-publication-closure-and-lifecycle.md) resolves the immutable closure/lifecycle boundary and intentionally leaves runtime persistence and pruning to reviewed follow-up migrations and decisions.

## Explicitly pending evidence

- `GATE-publication-chaos` remains pending a serving-D1 migration with append-only switch history, transactional exact-generation compare-and-swap, failure injection at every persistence step, D1 replica/bookmark tests, populated multi-PoP caches, SSR/API publication pins, and measured rollback under load.
- [Phase 4B](phase-4b-serving-dispositions.md) now persists the ADR 0015 closed provider disposition without a fictitious slice ID and preserves carried-forward provider/run lineage. Complete sealed-closure materialization, switch history, and runtime publication remain pending.
- `SRCH-007`, `CF-022`, and `GATE-search-acceptance` remain pending real FTS construction, Workers AI embedding approval/configuration, Vectorize writes and eventual-visibility polling, exact/semantic/filter/neutrality probes, wrong-namespace rejection, and explicit exact/structured degradation.
- `BE-010`–`BE-012` and `GATE-restore-and-rebuild` remain pending a writer-drained canonical D1 export, Time Travel bookmark/high-water proof, private R2 chunk persistence and hashes, serving logical export, fresh-environment import, deterministic FTS/Vectorize reconstruction, retained evidence linkage, and measured 24-hour RPO/RTO.
- Physical pruning remains deliberately absent. Existing immutable-delete protection and extra artifact retention stay in force until a separate ADR, fenced migration, cross-store interruption/recovery suite, and explicit destructive-operation authorization exist.
- Provider content remains synthetic and non-publishable. Fireworks source access, retention, evidence excerpts, and production enablement remain blocked on the authorized source/legal register.
- Preview resource inventory, spending/resource approval, provisioning, protected deployment environments, public query-AI privacy approval, and every production/public-release decision remain outside this slice.

No public response, active cache, remote search index, provider publication, Cloudflare backup, restored database, resource creation, deployment, rollback operation, or physical deletion is claimed by this evidence. All linked traceability rows remain `Planned` until their complete declared runtime and operational artifacts pass.
