# Phase 5Y-B: Selection-free Offering observation sets

| Attribute | Value |
|---|---|
| Status | Locally implemented, independently reviewed, and verified on 2026-08-11; no public or remote authority |
| Decision | [ADR 0057](../decisions/0057-selection-free-offering-observation-set.md) |
| Requirements | `DATA-003`, `DATA-020`, `DATA-021`, `DATA-025`, `DATA-030`–`DATA-035`, `DATA-039`–`DATA-046`, `DATA-048`, `DATA-050`, `DATA-051`, `DATA-055`–`DATA-058`, `DATA-060`, `DATA-061`, `DATA-065`–`DATA-067`, `RULE-010`, `RULE-011`, `RULE-014`, `RULE-015`, `RULE-017`, `API-002A`, `BE-005`, `BE-011`, `QA-006`, `QA-010`, `QA-012` |

## Objective

Project one complete, deterministic, byte-authentic observation set per Offering from the already trusted persisted publication. Preserve every Price, PrecisionObservation, and applicable EvidenceSummary, add the exact Provider display-name Fact with Provider-subject evidence closure, and make no current-value or presentation decision.

## Fixed boundary

- Accept only a branded trusted immutable manifest plus the complete exact persisted resource inventory that reconciles to it.
- Recompute selected resource content hashes from their original canonical `resource_json` UTF-8 bytes before parsing; reject incomplete, additional, duplicate, non-canonical, hash-mismatched, or cross-publication input.
- Project version `offering-observation-set@1`, explicit selection-free/unproven authority, publication ID, manifest closure and resource-inventory hashes, Offering/Provider/target identities, exact Provider display-name Fact, complete canonical Offering, every owned Price, every owned PrecisionObservation, and the exact union of their referenced EvidenceSummaries.
- Derive every detached, frozen canonical object only after reconciling and hashing its exact persisted canonical `resource_json`; the verified content hash is the byte-authentic commitment. The complete Provider is a hash-verified source dependency, while only its display-name Fact is copied.
- Add Provider display-name evidence to ADR 0056's evidence closure: each referenced EvidenceSummary must exist, have matching inner/outer evidence identity, and name the Provider as `subject_resource_id`.
- Preserve ADR 0056's exact Offering-, Price-, and PrecisionObservation-subject closure, including component Facts owned by the enclosing PrecisionObservation.
- Sort Prices, PrecisionObservations, and EvidenceSummaries only by their stable IDs in ASCII byte order. Input order has no authority and stable-ID order carries no quality or recency meaning.
- Publish exact aggregate Offering-set, Price-membership, PrecisionObservation-membership, and EvidenceSummary-membership counts; one domain-separated hash per set over version/publication/identity and all selected resource content hashes; and an inventory hash with a mandatory publication-authority/count header followed by the stable-ID-ordered sets. Offering-ID order is serialization only, not presentation order.
- Keep the projection unbranded with fixed `claim_authority = "unproven"`; neither a set hash nor the inventory hash is trusted-manifest or current-claim authority.
- Inherit the 100,000-resource, 32-MiB relevant UTF-8, 500,000-edge, and 1,000,000-byte per-resource ceilings. Separately cap emitted graph memberships at 500,000, counting Provider, target, Offering, every child, and per-set EvidenceSummary memberships before retaining each set. Fail the complete operation without partial sets or dropped history.
- Keep current-value policy, rank/order policy, comparison rows, Offering Facts, RPC/API/OpenAPI, UI, source access, remote resources, publication, and deployment out of scope.

## Observation-set shape

Version 1 has these semantic members; implementation naming may vary only if the ADR is updated before code review:

| Member | Authority |
|---|---|
| Projection/publication authority | Fixed projection version, selection-free/unproven authority, exact publication ID, trusted closure hash, and resource-inventory hash |
| Structural identity | Offering ID, Provider ID, and Model-or-Variant target ID from the exact Offering |
| Provider label | Exact Provider `display_name` Fact plus the hash-verified Provider source dependency |
| Offering | One complete canonical Offering derived from exact hash-verified persisted bytes |
| Prices | Every complete canonical Price reverse-owned by and forward-listed on the Offering |
| Precision observations | Every complete canonical PrecisionObservation reverse-owned by and forward-listed on the Offering |
| Evidence summaries | Deduplicated complete canonical evidence union for Provider display name, Offering, Prices, PrecisionObservations, and component Facts |
| Integrity | Exact aggregate membership counts, one domain-separated hash per set, and one ordered-set inventory hash |

The target Model or Variant remains an already verified structural dependency but contributes no Fact and is not counted in version 1. No Provider field other than display name enters the copied projection.

## Acceptance matrix

| Case | Required local result |
|---|---|
| Trusted manifest plus its complete exact persisted inventory | One deterministic set per Offering |
| Descriptor-only, forged, incomplete, additional, duplicate, or cross-publication inventory | Entire projection rejected |
| Persisted byte or content-hash mismatch | Rejected before the resource can enter a set |
| Zero, one, or many Price/Precision children | Every child retained; no selection or collapse |
| Historical, inactive, stale, conditional, promotional, overlapping, unknown, or component-scoped observation | Retained exactly |
| Missing cached-input Price | Remains absent/unknown; never synthesized as zero or input price |
| Provider display-name Fact | Copied exactly from the matching Provider; no slug/source-owner fallback |
| Provider display evidence subject is not the Provider | Rejected |
| Offering/Price/Precision/component evidence subject mismatch | Rejected under inherited ADR 0056 closure |
| Duplicate valid evidence references | One EvidenceSummary in stable-ID order; no evidence selection |
| Unrelated publication evidence | Excluded from this Offering's set |
| Caller resource-array permutation | Identical projection values, counts, set hashes, and inventory hash |
| Valid array-order byte change inside a canonical resource | Stable-ID outer child/evidence arrays remain ordered; exact resource, set, and inventory hashes change |
| Observation timestamp, price amount, precision label, affiliate state, or input order changes | Never used to rank or choose members; exact retained-byte changes alter the hash where applicable |
| Any set exceeds inherited bounds or fails a closure/count/hash check | Complete operation fails; no partial output |

## Implementation sequence

1. Define a runtime-neutral internal observation-set contract and exact persisted-resource carrier without changing public contracts.
2. Snapshot and reconcile the complete persisted inventory to the trusted manifest, then recompute exact resource content hashes before parsing.
3. Build shared bounded indexes for Provider, Offering, Price, PrecisionObservation, and EvidenceSummary resources.
4. Project each Offering's complete stable-ID-ordered children and exact evidence union.
5. Add and validate Provider display-name Fact evidence closure with Provider subject identity.
6. Incrementally enforce the emitted-membership ceiling, compute checked aggregate counts and per-set hashes, and build the inventory hash from a mandatory authority/count header plus stable-ID set rows.
7. Prove losslessness, caller-container permutation invariance, exact-byte hash sensitivity, input/output bounds, and absence of selection or presentation semantics.

## Verification target

- trusted-manifest/exact-inventory reconciliation and hostile-input tests;
- exact canonical-byte/content-hash validation before projection;
- all Price roles/classes/currencies/conditions/effective intervals and every precision/applicability/component/Fact-state case preserved;
- complete evidence-union and Provider/Offering/Price/Precision subject-closure tests;
- stable-ID outer ordering and caller resource-array permutation tests, plus exact internal-array byte-order hash sensitivity;
- fixed version/count/set-hash/inventory-hash fixtures, mandatory empty-inventory authority binding, and one-field/one-byte mutation sensitivity;
- inherited input capacity and explicit emitted-membership boundaries with no-partial-output failure paths;
- explicit absence of clock, current/latest flag, precedence, rank, affiliate, API, cache, UI, source, or network inputs; and
- full local verification plus independent data-neutrality/correctness and security/privacy review before implementation acceptance.

## Local verification result

The focused observation-set suite passes 10 tests, both independent data-neutrality/correctness and security/privacy re-reviews report no remaining P0–P2 findings, and the full repository `verify` gate passes with 1,931 unit tests plus all Worker-runtime, browser, build, privacy, supply-chain, generated-contract, and configuration-drift checks.

## Explicit deferrals

Evidence field/value equivalence, source precedence, current-value selection, price/precision overlap resolution, comparison projection, display/default order, currency scope, sorting/filtering, pagination, Offering Facts, provider comparison, provider pages, Model/Variant reverse-link presentation, query RPC, API/OpenAPI, web UI, source access, remote configuration, migrations, provisioning, publication, deployment, and release acceptance remain pending.

Every mapped traceability row retains its current status. This accepted design and any later local implementation provide prerequisite evidence only.
