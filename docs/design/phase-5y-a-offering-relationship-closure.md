# Phase 5Y-A: Persisted Offering relationship closure

| Attribute | Value |
|---|---|
| Status | Implemented locally; no public or remote authority |
| Decision | [ADR 0056](../decisions/0056-offering-relationship-closure.md) |
| Requirements | `DATA-003`, `DATA-020`, `DATA-021`, `DATA-025`, `DATA-030`–`DATA-035`, `DATA-040`–`DATA-046`, `DATA-051`, `DATA-055`, `DATA-060`, `DATA-061`, `DATA-065`, `BE-005`, `BE-011`, `QA-006`, `QA-010`, `QA-012` |

## Objective

Make the common persisted-content manifest boundary reject incomplete or contradictory Offering relationship graphs before any current-value policy, provider comparison, Offering Facts projection, API, or UI work begins.

## Fixed boundary

- Validate complete Provider, Offering, Model-or-Variant target, Price, PrecisionObservation, and EvidenceSummary contracts and outer/inner identities from one persisted publication.
- Require every Offering Provider and target to exist with matching type and provider attribution.
- Treat `price_ids` and `precision_observation_ids` as unordered sets and prove exact equality with the complete reverse child inventories.
- Require each PrecisionObservation applicability tuple to equal its Offering on provider ID, provider model ID, tier, endpoint class, and material region. `component_scope` is contract-valid but not compared.
- Require every evidence reference enumerated by the Offering, Price, and PrecisionObservation contracts to resolve and its EvidenceSummary subject to equal the enclosing resource identity. Provider/Model/Variant/ModelFamily and Checkpoint fact-evidence completeness remain separate work.
- Require `first_observed_at <= last_observed_at` and non-null `effective_from <= effective_to`.
- Enforce 100,000 relevant resources, 500,000 relationship edges, 32 MiB aggregate relevant UTF-8 JSON, and the existing 1,000,000-byte per-resource ceiling.
- Count relevant resources and UTF-8 bytes before parsing any relevant JSON; enforce edges incrementally before retaining an over-limit relationship.
- Integrate only at `buildImmutableManifestFromPersistedContent` after existing content-hash, descriptor, and ADR 0035 closure checks and before a trusted manifest returns.
- Keep schema `1.13.0`, manifest/proof/backup formats, query/API/web surfaces, remote resources, and deployment unchanged.

## Acceptance matrix

| Case | Required result |
|---|---|
| Complete Offering graph | Accepted independent of resource and child-array order |
| Provider or target missing/wrong type/wrong identity | Entire persisted-content build rejected |
| Forward child omitted or extra | Rejected |
| Reverse Price/PrecisionObservation orphan or cross-Offering owner | Rejected |
| Exact precision applicability | Accepted when the five Offering identity fields match |
| `component_scope` present | Contract-validated and retained without Offering equality comparison |
| Evidence reference | Exact EvidenceSummary exists and subject equals its owning resource identity |
| Evidence field/value text differs | Not evaluated by this phase |
| Equal observation/effective endpoints | Accepted |
| Reversed Offering or Price time interval | Rejected |
| Lifecycle state changes | No effect on relationship validity |
| Relevant resource/byte limit exceeded | Rejected before relevant JSON parsing |
| Relationship edge limit exceeded | Rejected before retaining the over-limit edge |
| Failure ordering | Basic outer descriptor failure precedes capacity; capacity precedes content parsing/hash; hash/full-descriptor/family failures precede Offering semantic closure; no trusted manifest escapes |

## Implementation sequence

1. Add one runtime-neutral bounded validator in publication core without widening public contracts.
2. Validate basic outer resource descriptors, enforce relevant-resource and UTF-8 byte caps, then parse/hash and contract-check bounded resources.
3. Build bounded Provider, target, Offering, Price, PrecisionObservation, EvidenceSummary, child-set, attribution, applicability, and evidence-owner maps.
4. Prove exact forward/reverse sets, identity, applicability, evidence-subject, and time-order invariants.
5. Invoke the validator from the content-aware manifest builder after existing trusted prerequisites and before return.
6. Update deterministic shared fixtures and derived hashes through existing helpers; do not hand-edit digest values.
7. Prove inherited hard-cutover behavior through seal, readiness, switch, retained-publication, backup, and restore call paths.

## Verification target

- pure contract, identity, set-closure, applicability, evidence-owner, and time-order unit/property tests;
- input/resource/child-array permutation invariance;
- `limit - 1`, `limit`, and `limit + 1` checks for the exported resource/edge/UTF-8 admission arithmetic, plus a real aggregate-byte builder rejection before invalid JSON parsing;
- hostile JSON and worker-memory tests proving pre-parse capacity admission and bounded diagnostics;
- persisted-content trust-boundary ordering and no-manifest-escape tests;
- integration inheritance through publication lifecycle and recovery fixtures;
- schema/proof/OpenAPI/privacy drift checks; and
- independent data-correctness and security/privacy review before implementation acceptance.

## Explicit deferrals

Evidence field/value semantic equivalence, provenance precedence, current-value selection, price/precision overlap resolution, comparison projection, display/default order, sorting/filtering, currency scope, pagination, Offering Facts, provider comparison, provider pages, Model/Variant reverse-link presentation, query RPC, API/OpenAPI, web UI, source access, remote configuration, migrations, provisioning, publication, deployment, and release acceptance remain pending.

The next comparison increment may define deterministic current-value authority only after this closure is implemented and verified. It must not select “latest” by convenience or infer a value from search witnesses.

Every mapped traceability row retains its current status. This design and any later local implementation provide prerequisite evidence only.
