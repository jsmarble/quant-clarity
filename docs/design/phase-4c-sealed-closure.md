# Phase 4C sealed serving-closure architecture

| Attribute | Value |
|---|---|
| Status | Local migration and projection evidence complete; D1 runtime evidence pending |
| Decision | [ADR 0018](../decisions/0018-sealed-serving-closure-persistence.md) |
| Primary requirements | `SRCH-006`, `PIPE-044`, `PIPE-050`–`PIPE-052`, `BE-011`, `QA-006` |
| Contributing requirements | `SRCH-007`, `API-003`, `PIPE-054`, `PIPE-055`, `BE-012`, `CF-022` |

## Implemented local boundary

Serving migration 0004 advances schema `1.1.0` to `1.2.0`. It persists provider-disposition versions, provider attribution, vector and chunk inventories, a monotone staging revision, and one immutable closure seal through the exact tables and keys in ADR 0018. The runtime-neutral controlled-writer projection reconstructs exact serving-row shapes, recomputes canonical content and chunk hashes, derives publication-qualified vector identity and every ADR 0015 root, verifies the reserved closure, and emits the only accepted seal shape against an unchanged revision.

All closure-bearing inserts are building-only and pre-seal. All closure rows become immutable at seal. Migration preflight rejects schema drift and any legacy queryable publication/head because the old schema lacks enough information for a truthful closure backfill. Migration tests execute each file atomically, matching the required rollback-capable Wrangler migrations path, and prove malformed metadata or a colliding target object leaves the 1.1 schema unchanged.

Phase 4C deliberately keeps readiness and head mutation closed. The migration rejects `building` to `ready`, head insertion, and head update. Phase 4D follows in this exact order: persist archive/serving/vector/probe receipts bound to the seal; add FTS and real Vectorize visibility evidence; then execute append-only switch history and exact-generation activation/rollback in one D1 transaction.

## Acceptance and nonclaims

Local tests cover exact schema reconstruction; fixed byte-hash vectors and hostile JSON; an end-to-end selected-plus-unavailable row projection; derived vector identity; exact chunk membership/hashes; manifest/root/seal reproducibility; staging/seal races; atomic migration rollback; post-seal revision/content immutability; Phase 4B regressions; and last-known-good preservation while readiness/head writes remain rejected.

This slice provides no readiness receipt, ready/active transition, switch event, head mutation, FTS index, Vectorize mutation or visibility poll, D1 binding/session, public route, cache behavior, backup/restore, pruning, provisioning, deployment, provider publication, or release evidence. It changes no traceability status; every affected row remains `Planned` until its complete declared runtime and operational evidence passes.
