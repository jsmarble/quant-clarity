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
| 2026-08-01 | Approve the reviewed system design and its Section 2.4 defaults: Monday/Thursday 05:00 UTC schedule, USD 25 monthly control target, MPL-2.0 code license, Fireworks AI as the conditional first-adapter candidate, the four named conditional launch candidates, and QuantClarity as a preview-only working brand pending clearance. | The repository may enter implementation. Provider source/legal approval, paid resource creation beyond the accepted budget, production deployment, dataset/API terms, and final brand clearance remain separate gates. |
| 2026-08-01 | Store no visitor information and enable no visitor analytics or request telemetry. This supersedes the 2026-07-21 Cloudflare Web Analytics decision. | QuantClarity sets no cookies or browser state, retains no visitor request events/searches/clicks/IPs/user agents/referrers, disables public-request logs/traces/custom telemetry, and relies only on operator-generated synthetic probes plus non-visitor control-plane records. Necessary transient Cloudflare delivery and abuse-protection processing must be disclosed and governed as processor activity. |
| 2026-08-01 | Permit referral links only without visitor tracking. | Referral URLs may use one static program identifier for everyone, with adjacent disclosure and strict no-referrer behavior. QuantClarity will not run click redirects, pixels, cookies, click IDs, personalized codes, conversion callbacks, or programs that require them. |
| 2026-08-01 | Make GDPR readiness a release gate. | Before public release, the operator must complete the privacy notice, controller/legal-contact details, Cloudflare DPA and transfer review, subprocessor/data-location review, processing record, rights procedure, security controls, and an authorized legal-owner review; technical verification alone does not constitute legal advice or certify compliance. |
| 2026-08-01 | Treat user-controlled URL and browser-history state as navigation, not application persistence. | URL-restorable filters required by `FE-015` may use the current URL/history while the page is open, but QuantClarity may not copy that state into cookies, Web Storage, IndexedDB, Cache API, service-worker state, analytics, logs, or profiles. Query-string responses remain `private, no-store` and no-referrer. |
| 2026-08-01 | Replace the Cloudflare Pages frontend requirement with Astro SSR on Cloudflare Workers plus Workers Static Assets. This explicitly amends `CF-001`, `FE-063`, and the initial hosting target after current Astro removed Pages support. | Use current supported Astro and `@astrojs/cloudflare` releases on Workers. Preserve the separate public API/query boundaries, custom-domain path stability, server-rendered facts, static-asset caching, non-indexable previews, zero visitor data, and every accessibility/performance/security invariant. ADR 0012 supersedes only ADR 0001's Pages-specific topology. |

## Change procedure

1. Obtain explicit product-owner approval for a product decision or PRD amendment.
2. Update the authoritative requirements and preserve requirement IDs when practical.
3. Add a dated entry here describing the decision and its consequence.
4. Update affected design traceability and acceptance tests.
5. Do not rewrite historical decisions to hide superseded direction; add a new entry that identifies the replacement.
