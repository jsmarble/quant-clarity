# ADR 0014 — deterministic operational identities

| Attribute | Value |
|---|---|
| Status | Accepted |
| Date | 2026-08-01 |
| Requirements | `PIPE-003`, `PIPE-004`, `PIPE-006`, `BE-004` |
| Supersedes | Nothing |

## Context

The approved state-machine design requires the scheduled occurrence identity to derive from schedule name plus scheduled UTC instant so duplicate delivery and deployment changes resume one logical occurrence. The canonical contract also requires `occ_`, `run_`, and `pvr_` identifiers to use its lowercase prefixed UUIDv4-shaped grammar. Allowing a caller to supply a fresh random ID would defeat idempotent duplicate detection before storage.

## Decision

Operational identities use a versioned length-prefixed tuple encoding and SHA-256 derivation:

- occurrence: schedule name plus canonical scheduled UTC timestamp;
- run: occurrence key plus positive attempt number;
- provider attempt: run key plus provider ID.

The first 128 digest bits are formatted with the canonical UUID version/variant bits and the registered `occ_`, `run_`, or `pvr_` prefix. These values are deterministic idempotency identities in the repository's UUIDv4-shaped grammar; they are not described as random UUIDv4 generation. Schedule names and tuple encoding are durable identity inputs. A derivation-version change requires an explicit migration/compatibility decision.

Side-effect keys extend the provider-attempt key with a closed step name and stable resource key. Storage remains responsible for unique constraints and atomic receipt insertion; the local kernel cannot claim Workflow/D1 durability.

## Consequences

- Duplicate delivery for one occurrence/attempt/provider resolves to the same identity across deployments.
- An intentional replay receives a distinct run and provider-attempt identity while linking to the adjacent prior attempt.
- Mutable code, schema, adapter, or display versions do not change the scheduled occurrence identity.
- The portable local implementation is cross-checked against a standard SHA-256 implementation in tests and has no Node-only runtime dependency.
- Preview verification must still prove transactional uniqueness, interruption recovery, and Workflow resume behavior.
