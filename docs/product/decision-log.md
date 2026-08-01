# Product decision log

This log records accepted product decisions that shape QuantClarity. It summarizes decisions for durable project context; the approved requirements in [`requirements.md`](requirements.md) remain authoritative.

## Accepted baseline

| Date | Decision | Consequence |
|---|---|---|
| 2026-07-21 | Use the working name **QuantClarity** with the tagline “See the precision behind the price.” | Branding remains subject to domain and trademark clearance. |
| 2026-07-21 | Make the service public from day one. | The website and read-only API require no login. |
| 2026-07-21 | Organize discovery around models. | Users search for a model first and inspect provider offerings on its detail page. |
| 2026-07-21 | Keep model listing cards provider-neutral. | Cards show model facts only; a cataloged-provider count is the sole provider-derived summary. Provider filters affect eligibility, not card content or provider-derived ordering. |
| 2026-07-21 | Do not rank providers or select winners. | No highest-precision, cheapest, preferred, best-value, fidelity, trust, or affiliate-influenced provider designation exists. Users sort and filter factual comparisons themselves. |
| 2026-07-21 | Narrow the nutrition-label metaphor to **Model Facts**. | Listing cards may use a compact Model Facts subset; canonical model and explicit-variant pages show full Model Facts for their own source identity and lineage. |
| 2026-07-21 | Present provider data as a comparison rather than a label. | Model pages use a sortable/filterable provider-offering table and a row-level Offering Facts inspection view. |
| 2026-07-21 | Preserve exact model and offering identity. | Provider-reported serving precision remains attached to the exact canonical-name offering unless a separately selectable precision variant is explicitly named. |
| 2026-07-21 | Treat source precision and serving precision as different facts. | Wider serving compute does not imply restoration of information absent from a quantized source checkpoint. |
| 2026-07-21 | Publish `unknown` rather than infer missing facts. | Precision, price, lineage, component scope, and other unsupported fields remain visibly unknown. |
| 2026-07-21 | Show input, output, and cached-input prices independently. | Prices use the provider-stated currency without FX conversion; omitted currency uses a visibly provenance-marked USD system default. |
| 2026-07-21 | Make automated evidence-backed data canonical. | There is no admin editor, contribution flow, or public correction interface. Publication requires evidence, validation, provenance, freshness, and atomic last-known-good behavior. |
| 2026-07-21 | Refresh provider data every Monday and Thursday. | Provider adapters and pipeline operations must support durable scheduled refresh, isolation, quarantine, and rollback. |
| 2026-07-21 | Start with four providers and approximately 20 active model offerings per provider. | Provider integrations are added independently through a versioned adapter contract. |
| 2026-07-21 | Use Cloudflare-native managed application infrastructure. | Pages, Workers, and Vectorize are required; remaining Cloudflare service choices belong to system design. |
| 2026-07-21 | Permit affiliate links only as neutral incidental monetization. | Affiliate relationships affect only outbound URLs and adjacent disclosures, never facts, inclusion, prose, search, ordering, or filters. |
| 2026-07-21 | Use Cloudflare Web Analytics only. | No outside analytics, session replay, targeting, fingerprinting, or visitor profiling is allowed. |
| 2026-07-21 | Keep the public repository informational rather than participatory. | Public Issues and Discussions are disabled; the repository does not solicit contributions or promise support. |
| 2026-07-21 | Separate source-code licensing from dataset terms. | MPL-2.0 is recommended for code, with MIT as a possible alternative; no final license decision has been made. |
| 2026-07-31 | Make public usefulness the sole product justification. | Accuracy, coverage, freshness, accessibility, and practical usefulness define success. Free public access does not depend on revenue or profitability, and operating at a net loss is acceptable. |

## Change procedure

1. Obtain explicit product-owner approval for a product decision or PRD amendment.
2. Update the authoritative requirements and preserve requirement IDs when practical.
3. Add a dated entry here describing the decision and its consequence.
4. Update affected design traceability and acceptance tests.
5. Do not rewrite historical decisions to hide superseded direction; add a new entry that identifies the replacement.

