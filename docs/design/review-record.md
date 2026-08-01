# System-design review record

| Attribute | Value |
|---|---|
| Design | [`system-design.md`](system-design.md) and linked contracts/ADRs |
| Review date | 2026-08-01 |
| Outcome | Product-owner approved; zero-visitor-data amendment independently re-reviewed |
| Scope boundary | Approved design baseline only; implementation and release evidence remain separate |

## Reviewers

| Role | Review focus | Final result |
|---|---|---|
| Requirements lead | Full PRD inventory, semantics, privacy amendment, traceability, release evidence | Approve after reconciliation: 317 normative requirements, 13 success measures, 24 release gates, 354/354 unique mapped rows |
| Architecture lead | Cloudflare realizability, component/storage/security boundaries, ADR/contract coherence | Approve; ADR 0012 and the product-owner amendment resolve the former Pages/Astro compatibility blocker with current Astro on Workers Static Assets |
| Adversarial risk reviewer | Atomicity, recovery, privacy, SSRF, search recall/cost, abuse and release feasibility | Approve after corrections: no remaining blocker |
| Staff engineer | Integrated findings, reconciled contracts/ADRs, reran mechanical validation | Approved baseline recorded; implementation authorized within remaining gates |
| Privacy/GDPR reviewer | Zero visitor data, Cloudflare processor boundary, cookies, referrals, accountability | Approve after telemetry/cache/request-ID/GDPR-gate corrections; legal-owner release items remain explicit |

## Material corrections incorporated

- Publication head resolution now precedes publication-keyed cache selection for API and SSR; cache purge is not a correctness mechanism.
- Serving backup exports ordinary rows and deterministically rebuilds FTS5/Vectorize; canonical backup has a drained-writer bookmark/high-water consistency boundary.
- Pre-retention streaming DLP/redaction discards failed source input before any durable object, Workflow state, hash, log, fixture, or AI request.
- Typed claim scopes separate model/checkpoint/provider facts from exact-offering precision/price applicability; publisher organizations are independent of inference providers.
- Public API resource fields/nullability/provenance, next refresh metadata, exact price behavior, stable IDs, and Model/Offering Facts projections are normative.
- Semantic search stores one vector per model/variant, derives complete eligibility in D1, uses bounded 40-ID batches, and degrades explicitly above 320 eligible IDs without provider-count weighting.
- Public semantic work has static per-request ceilings and transient rate limiting; forecast volume is cost-modeled without a retained application visitor counter.
- GET search, Worker-wide automatic telemetry disablement, AI Gateway payload suppression, bounded read-only replay risk, robots/Content Signals, CSP, and infrastructure ownership are consistent and testable.
- Web Analytics, public custom telemetry, retained request IDs, visitor-derived cache keys, bounded incident capture, click redirects, and cookie-setting Cloudflare challenge features are prohibited.
- GDPR accountability, zero-visitor-data, referral-zero-tracking, and public-query-AI privacy gates are explicit; legal-owner artifacts are not confused with an engineering certification.
- Every release coordinator maps to concrete trace evidence and explicit composite gates; no row is marked implemented, verified, accepted, or released.

## Mechanical checks

- Markdown local targets resolve.
- `git diff --check` passes.
- Traceability contains 354 unique rows: 317 normative requirements, 13 success measures, and 24 release gates.
- All 24 release coordinators have an explicit composite-gate mapping.
- Twelve ADRs are present and `Accepted`; ADR 0011 records the owner-approved privacy posture and ADR 0012 records the owner-approved Workers frontend amendment.

Product-owner approval was recorded on 2026-08-01. Runtime verification and all legal, source, spending, provider-enable, production-deployment, and public-release gates remain pending until their evidence exists.
