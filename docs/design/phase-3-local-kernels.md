# Phase 3 local-kernel evidence

| Attribute | Value |
|---|---|
| Status | Local decision kernels implemented; runtime and preview evidence pending |
| Branch | `codex/durable-pipeline-slice` |
| Requirements | `PIPE-001`–`PIPE-008`, `PIPE-013`, `PIPE-016`, `PIPE-018`, `PIPE-031`, `PIPE-040`–`PIPE-045`, `BE-003`–`BE-006`, `DATA-063`, `SEC-003`–`SEC-006` |

## Implemented local evidence

| Verification area | Artifact | Bounded evidence |
|---|---|---|
| Schedule and identity decisions | `packages/pipeline-core/src/index.ts`, `index.test.ts` | UTC schedule validation/description; deployment-independent deterministic occurrence, run, provider-attempt, and side-effect keys; controlled writer validation |
| Restart-safe reducer | `packages/pipeline-core/src/index.ts`, `index.test.ts` | Monotone provider states, append-only receipts, no terminal side effects, deterministic resume/no-op decisions, terminal roster coverage, and provider isolation |
| Retry and cost admission | `packages/pipeline-core/src/index.ts`, `index.test.ts` | Bounded exponential delay, both `Retry-After` forms, aggregate attempt/time/cost ceilings, closed failure classes, and terminal quarantine |
| Validation and anomaly decisions | `packages/pipeline-core/src/index.ts`, `index.test.ts` | Recheck-before-acceptance, record-scoped quarantine, last-known-good preservation, no empty replacement, canonical admission, and acyclic supersession checks |
| Machine run report | `packages/pipeline-core/src/index.ts`, `index.test.ts` | Recomputed coordination state, bounded non-negative cost counters, closed sanitized codes, and no raw source/visitor fields |
| Destination compiler | `packages/acquisition/src/index.ts`, `index.test.ts` | Manifest-owned source IDs and closed parameters; exact HTTPS ASCII hosts; unsafe paths, caller URLs, IP literals, userinfo, explicit ports, and undeclared parameters rejected |
| Redirect and credential decisions | `packages/acquisition/src/index.ts`, `index.test.ts` | Manual bounded hops, loop detection, destination revalidation, exact-origin credential injection, and reconstruction from a minimal safe header set |
| DNS and policy decisions | `packages/acquisition/src/index.ts`, `index.test.ts` | Fail-closed supplied-answer classification for IPv4/IPv6 special-use, mapped, metadata, and NAT64 addresses; legal-expiry, robots, Content Signals, and rendered-browser policy inputs |
| Pre-retention evidence boundary | `packages/acquisition/src/index.ts`, `index.test.ts` | Bounded in-memory minimization, mandatory credential/cookie/account/PII canaries, redaction verification, runtime-unforgeable evidence capability, exact safe locator, and SHA-256 over a canonical metadata envelope plus redacted bytes |

The approved design requires an occurrence identity derived from schedule name plus scheduled UTC time while the canonical ID grammar requires a prefixed UUIDv4 shape. [ADR 0014](../decisions/0014-deterministic-operational-identities.md) reconciles those constraints with a versioned SHA-256 tuple derivation formatted in the canonical `occ_`, `run_`, and `pvr_` UUIDv4-shaped grammar. These are deterministic idempotency identities, not claims of random UUIDv4 generation. Changing that derivation is a data migration and compatibility decision.

## Explicitly pending evidence

- `PIPE-006` remains planned for actual Cloudflare Workflow restart/retry behavior and transactional D1 uniqueness. The local reducer proves decision semantics only.
- `GATE-source-egress-security` remains pending DoH/CNAME execution, DNS-rebinding and protected-destination canaries, real manual redirect plumbing, stream/decompression/abort ceilings, policy parsers, and Browser Sessions in isolated preview.
- Composite `GATE-evidence-dlp` remains pending verified R2 promotion/lock/access controls plus every allowed runtime sink. No R2 write exists in this slice.
- `GATE-legal-source-register`, `LEG-001`, and `LEG-002` remain pending an authorized Fireworks review. Fireworks stays production-disabled and no live request is permitted.
- Resource inventory, budget/resource authorization, preview provisioning, migrations, deployment, and production enablement remain outside this slice.

No network request, DNS request, browser session, AI call, source credential, provider payload, D1/R2/Vectorize write, Cloudflare resource creation, or deployment is claimed by this evidence.
