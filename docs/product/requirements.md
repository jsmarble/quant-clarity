# QuantClarity Product Requirements Document

> **Tagline:** See the precision behind the price.

| Document attribute | Value |
|---|---|
| Status | Approved requirements baseline; independent review grade A |
| Product type | Public model-inference provider catalog and read-only API |
| Initial hosting target | Cloudflare Pages with a Cloudflare Worker API and Cloudflare Vectorize-backed search |
| Initial scale | 4 providers, approximately 20 models per provider, 10,000 monthly web visitors, and 10,000 monthly public API requests |
| Data refresh cadence | Mondays and Thursdays |
| Primary audience | Anyone selecting an inference provider for a particular model |
| Authentication | None for public site or API |
| Administration | No public or private application dashboard; data publication is automated |

## 1. Purpose

QuantClarity will help people understand exactly what a hosted inference provider is selling under a model name. It will present model-level source identity, lineage, architecture, and source precision in a compact, nutrition-label-inspired **Model Facts** format. Canonical model and explicit variant pages will each show Model Facts for their own source identity and lineage. Provider pricing, serving precision, provenance, and freshness will appear in a sortable and filterable provider-offering comparison rather than being forced into the label format.

The product addresses a specific market failure: two providers may advertise the same model name and charge the same token price while serving materially different representations, such as BF16, FP8, or FP4. Provider marketing pages frequently omit this distinction even when provider APIs or authenticated catalogs expose it.

QuantClarity will be model-first. A visitor will find a model, see source-model facts in a compact card, and open the model detail page to inspect every supported provider offering with its original-currency prices, serving precision, evidence, and freshness. QuantClarity will not rank providers or select winners; users will sort and filter the factual comparison themselves.

QuantClarity is a public-data project. Its sole justification is the usefulness of making accurate, otherwise difficult-to-find inference-provider facts freely accessible, comparable, and verifiable. The service shall remain free and public even when operating it produces a net financial loss. Revenue, affiliate commissions, traffic growth, and commercial adoption are secondary and shall not be treated as reasons for the product’s existence or conditions of public access.

This document defines product, frontend, backend, data-pipeline, API, Cloudflare-platform, security, operational, and acceptance requirements. It intentionally does **not** select a frontend framework, application topology, database schema, storage product, queueing pattern, embedding model, or specific Worker decomposition. Those are solution-design decisions.

## 2. Product goals

### 2.1 Goals

- **G-01 — Precision transparency:** Make provider-side quantization and source-checkpoint lineage visible at the exact offering level.
- **G-02 — Price transparency:** Show standard input, output, and cached-input prices per one million tokens in the provider’s stated currency without foreign-exchange conversion.
- **G-03 — Model-first discovery:** Let users locate a model first, then compare providers and precision.
- **G-04 — Evidence-backed facts:** Make every published non-null model, checkpoint, architecture, parameter, provider, offering, precision, and price fact traceable to timestamped source evidence.
- **G-05 — Neutral presentation:** Present verifiable facts without provider ratings, winner designations, fidelity/value scores, subjective provider preferences, editorial punishment, or pay-to-rank behavior.
- **G-06 — Automated freshness:** Refresh supported providers every Monday and Thursday without an application administration interface.
- **G-07 — Open access:** Provide the same canonical data through an anonymous, read-only public API.
- **G-08 — Provider extensibility:** Add providers incrementally without changing the public conceptual model or breaking existing identifiers.
- **G-09 — Cloudflare-native operation:** Keep the managed public application, orchestration, storage, search, and observability infrastructure on Cloudflare-native services. Outbound calls are limited to allowlisted, adapter-declared provider sources, model-publisher/checkpoint repositories, independent discovery sources, affiliate destinations, and an explicitly approved AI inference processor reached through Cloudflare AI Gateway only when Workers AI cannot meet an approved extraction requirement. External sources remain governed by the evidence and precedence rules in this document and do not become external managed application infrastructure.
- **G-10 — Sustainable cost:** Protect the public API and automated pipeline from abusive or runaway usage while remaining useful without accounts.
- **G-11 — Public usefulness:** Maximize the accuracy, coverage, freshness, accessibility, and practical usefulness of the free public dataset and API. Financial return is not a product goal or success criterion.

### 2.2 Non-goals

- Benchmarking model intelligence or measuring output quality.
- Declaring that one numerical format is always better than another.
- Producing a composite value, fidelity, trust, or provider score.
- Converting currencies or estimating exchange-adjusted prices.
- Routing inference requests or reselling inference access.
- Hosting model weights.
- Accepting user submissions, corrections, ratings, reviews, or comments.
- Providing account registration, authentication, saved comparisons, alerts, or personalization.
- Providing an admin dashboard or manual record editor.
- Supporting internationalized interfaces in the initial release.
- Operating public GitHub Issues or Discussions.
- Achieving profitability, generating a financial return, or making continued free access contingent on monetization.

## 3. Success measures

| ID | Measure | Initial target |
|---|---|---|
| SM-01 | Pipeline orchestration completion | At least 99% of scheduled provider jobs reach a terminal success, failed, or quarantined state within 12 hours; this metric does not count quarantine as successful data refresh |
| SM-02 | Published precision provenance | 100% of non-unknown serving-precision fields have accessible evidence metadata |
| SM-03 | Published price provenance | 100% of non-null current prices have source and observation timestamps |
| SM-04 | Freshness | Every active offering shows its last successful observation; stale data is visibly marked |
| SM-05 | Public API reliability | 99.9% successful read requests monthly, excluding invalid and rate-limited requests |
| SM-06 | Exact search effectiveness | At least 95% of a version-controlled acceptance set containing at least 50 exact model, alias, provider-model-ID, and provider-name queries returns the intended canonical record as the first result; all structured-filter cases have zero filter violations |
| SM-07 | Accessibility | WCAG 2.2 Level AA conformance for all production pages and responsive variants |
| SM-08 | Web performance | 75th-percentile field Core Web Vitals meet “good” thresholds: LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1 |
| SM-09 | Cost safety | Monthly platform and AI-processing spend remains within an operator-configured budget and alert thresholds |
| SM-10 | Provider-order neutrality | Affiliate availability, commission value, and operator preference never affect provider visibility, search relevance, comparison-table default order, or factual values |
| SM-11 | Provider refresh success | After an enabled provider has had four scheduled refresh opportunities, it achieves at least 95% successful retrieval/validation/publication over the shorter of its enabled lifetime or the trailing 90 days. Before four opportunities, the rate is reported as provisional. Any provider without a successful observation for eight days raises an operator alert regardless of age. |
| SM-12 | Semantic search effectiveness | At least 95% of a version-controlled acceptance set containing at least 50 natural-language queries, each with no more than 10 expected canonical models, returns every expected canonical model within the first 10 results, with zero structured-filter violations |
| SM-13 | Published model-fact provenance | 100% of non-null model-card and Model Facts fields have accessible evidence metadata and an observation timestamp |

## 4. Users and primary journeys

### 4.1 Primary user

A developer, researcher, technical buyer, or AI-tool user who already has a model in mind and needs to choose a hosted inference provider based on precision and price.

### 4.2 Primary journeys

1. **Find a model:** Search for a canonical model name, alias, or provider model ID and open its detail page.
2. **Understand source facts:** Review the source creator, checkpoint lineage and precision, total parameters, active parameters, and other model facts without a provider recommendation.
3. **Compare all providers:** Review all active offerings for a model in a sortable and filterable comparison using precision, input price, output price, cached-input price, provider, and currency.
4. **Inspect Model Facts:** Understand the source creator, checkpoint, source-provided variants, architecture, and total versus active parameters.
5. **Inspect an offering:** Open Offering Facts for the exact provider model ID, serving precision, price conditions, provenance, and freshness behind a comparison row.
6. **Verify a claim:** Follow the evidence link and see when and where the fact was observed.
7. **Browse a provider:** View all supported model offerings from a provider and their disclosed or discovered precision.
8. **Use the API:** Retrieve the same model, provider, offering, price, precision, and provenance facts programmatically.

## 5. Product principles

### 5.1 Exact facts over implied quality

QuantClarity shall say “BF16,” “FP8,” “NVFP4,” “INT4,” “mixed,” or “unknown,” not “good,” “bad,” “full quality,” or “stunted.” “Full precision” may appear only as a quoted provider/source term or when an explicit methodology defines it relative to an authoritative source checkpoint.

### 5.2 Model lineage over simple bit ranking

The same bit count can describe different formats, scopes, and derivations. FP8 serving of a source-native INT4 checkpoint does not recreate information absent from that checkpoint. Conversely, converting an official INT4 checkpoint again to FP4 may introduce an additional lossy transformation. The product shall therefore present checkpoint lineage and the scope of every precision claim so users can interpret the facts; it shall not convert nominal bit widths into a provider ranking.

### 5.3 Unknown is a fact

Missing precision must be published as `unknown`, never inferred from price, speed, GPU type, provider reputation, or an unlabeled model name. Unknown shall remain a visible factual state and shall not be silently excluded except by an explicit user-selected filter.

### 5.4 Provider naming does not override observed deployment metadata

If a provider sells a canonical model name but its own API reports FP4, the offering remains attached to the canonical model page and is labeled FP4. If the provider exposes a separately named precision variant, such as a model ID with an `-fp8` suffix, that explicit variant receives its own model-variant entry and links back to the model family.

### 5.5 No provider winners or pay-to-rank

QuantClarity shall not designate a highest-precision, cheapest, best-value, preferred, recommended, or winning provider. Affiliate and referral relationships may change only the outbound signup URL and its disclosure. They shall not change facts, visibility, search relevance, default order, filters, or table results.

## 6. Definitions and public taxonomy

| Term | Definition |
|---|---|
| **Model family** | A publisher-defined lineage that groups a canonical release and explicitly named variants. |
| **Model** | The canonical public model identity users search for, such as GLM-5.2. |
| **Model variant** | An explicitly named publisher or provider variant whose identity communicates a material distinction, such as a precision suffix. |
| **Provider** | A company or service selling hosted access to one or more models. |
| **Offering** | A provider’s exact purchasable/invocable deployment of a model or model variant, identified by provider plus provider model ID and any material tier or region. “Route” may be used internally but shall not replace “offering” in the public UI. |
| **Source checkpoint** | An authoritative upstream weights/checkpoint identity for a model or explicit variant, including publisher, repository, revision, and source format when known. It is an ancestor of a provider offering only when evidence establishes that relationship. |
| **Source-provided quantization** | A quantized checkpoint or variant published or explicitly endorsed by the original model publisher. |
| **Serving precision** | The provider-reported or provider-observed numerical representation used for the offering, with its scope identified where available. |
| **Model Facts label** | A compact, nutrition-label-inspired presentation limited to the source-model or explicit-variant identity, creator/publisher, lineage, architecture, source precision and quantizations, parameter counts, context, license, evidence, and freshness. It contains no provider comparison, provider price, provider-serving precision, recommendation, or winner. |
| **Provider-offering comparison** | The sortable and filterable decision-relevant summary of exact provider offerings, including provider identity, serving precision, prices, currency, evidence, freshness, and an affordance to inspect Offering Facts. |
| **Offering Facts** | A detail view opened from one provider-comparison row that presents all applicable public offering identity, applicability, precision, pricing, provenance, status, history, and evidence fields required by this document. It is an inspection view, not a ranking or substitute for the comparison table. |
| **Observation** | A timestamped retrieval of source data before normalization and publication. |
| **Evidence** | The source locator and retained audit information supporting a published field. |
| **Active offering** | An offering observed as available in the latest successful refresh and not withdrawn by the provider. |
| **Stale offering** | An offering whose source could not be successfully refreshed within the defined freshness window. |

## 7. Information model and facts requirements

### 7.1 Model identity

| ID | Requirement |
|---|---|
| DATA-001 | Each model shall have a stable internal identifier and stable public slug that do not depend on a single provider’s identifier. |
| DATA-002 | Each model shall store a canonical display name, normalized name, original publisher/developer, model family, and aliases. |
| DATA-003 | Each model shall support zero or more explicitly named variants and bidirectional family/variant links. |
| DATA-004 | Model aliases shall include common punctuation, case, separator, organization-prefix, and provider-ID variations without collapsing materially distinct releases. |
| DATA-005 | A model shall include release date, modalities, context length, maximum output length, license, and architecture family when reliably available. These fields may be unknown. |
| DATA-006 | A model shall store total parameter count and active parameter count independently; active parameters shall never be assumed equal to total parameters. |
| DATA-007 | Parameter counts shall retain the source value and normalized integer value where normalization is unambiguous. Approximate values shall remain visibly approximate. |
| DATA-008 | Every non-null public model identity, creator/publisher, release, architecture, context, license, total-parameter, and active-parameter fact shall reference timestamped evidence. Publisher-controlled evidence is required when available. |
| DATA-009 | When publisher-controlled evidence is unavailable, a model fact may publish only from the highest applicable source class in the versioned field-specific precedence policy; the lower-precedence source class and observation time shall be visible, and the fact shall satisfy the same automated verification gate as other unstructured facts. Otherwise the field shall remain unknown. |

### 7.2 Source checkpoint and lineage

| ID | Requirement |
|---|---|
| DATA-010 | Each model or variant shall support zero or more authoritative source checkpoints. |
| DATA-011 | A checkpoint record shall support publisher, repository or artifact URL, repository ID, revision or commit, publication date, declared weight format, quantization method, and file/checkpoint format. |
| DATA-012 | The system shall distinguish an original publisher checkpoint from a third-party conversion, even if both have the same nominal precision. |
| DATA-013 | The system shall distinguish canonical/base checkpoints from source-provided quantized variants. |
| DATA-014 | Checkpoint relationships shall express `derived from`, `quantized from`, `publisher-provided variant of`, and `unknown lineage` without implying information not present in evidence. |
| DATA-015 | If the public source is already quantized, the Model Facts label shall state that fact and shall not describe a provider’s wider compute format as restored source precision. |

### 7.3 Offering identity

| ID | Requirement |
|---|---|
| DATA-020 | Every provider/model combination shall be represented as one or more offerings rather than placing provider-specific facts directly on the model record. |
| DATA-021 | An offering shall include provider, provider model ID, display name, linked canonical model or variant, status, first observed time, last observed time, last successful refresh, and source URL/API locator. |
| DATA-022 | Materially different deployment tiers, such as standard versus fast or serverless versus dedicated, shall be separate offerings when they may differ in price, precision, limits, or behavior. |
| DATA-023 | Region shall create a distinct offering only when it changes price, precision, availability, or a user-visible limit; otherwise supported regions may be attributes of one offering. |
| DATA-024 | Provider aliases and corporate-name changes shall not alter stable provider IDs. |
| DATA-025 | An offering removed from a provider shall be retained historically and marked inactive rather than deleted. |

### 7.4 Serving-precision facts

| ID | Requirement |
|---|---|
| DATA-030 | Each offering shall expose the provider’s raw precision string exactly as observed, the provider field/property name, any provider-supplied definition, and a normalized precision classification. |
| DATA-031 | The normalized vocabulary shall support at minimum BF16, FP16, FP8, FP6, FP4, NVFP4, MXFP4, INT8, INT4, mixed precision, other, and unknown, and shall be extensible without an API-breaking change. |
| DATA-032 | Precision shall be scoped where evidence permits: stored weights, weight computation, activations, accumulation, KV cache, attention, experts, shared layers, and other explicitly named components. |
| DATA-033 | A single scalar “precision” field shall not overwrite mixed-precision detail. The summary may say `mixed` while preserving component-level facts. |
| DATA-034 | Format variants such as FP8 E4M3 versus E5M2 and vendor-specific block formats shall be retained when supplied. |
| DATA-035 | The provider-offering comparison and Offering Facts view shall identify whether serving precision was obtained from a provider API, authenticated provider catalog, public provider page, publisher checkpoint, or another source, and shall preserve the source’s claim scope without semantic reinterpretation. |
| DATA-036 | The system shall not infer precision from output speed, model price, accelerator model, endpoint name without a precision token, or third-party opinion. |
| DATA-037 | Provider API metadata may be published even when the provider’s public marketing page omits the same fact, provided the source is lawfully accessed, retained as evidence, and neutrally attributed. |
| DATA-038 | Asking the served language model to self-identify its precision shall not qualify as evidence. |
| DATA-039 | Unknown component precision shall remain unknown even if another component is known. |
| DATA-051 | Precision evidence shall identify the exact provider model ID, deployment tier, endpoint/availability class, region when material, and observation time to which the claim applies. Metadata for a provider-catalog base-model object shall not automatically be attributed to a live serverless or differently tiered offering. |
| DATA-052 | A wider downstream stored, compute, activation, accumulation, or cache representation shall not be described as restoring fidelity absent from a lower-precision source checkpoint. Dequantizing or expanding INT4/FP8 source weights into BF16 does not recreate discarded source information. |
| DATA-053 | Precision normalization rules and display-order rules shall be independently versioned and exposed through the API dataset metadata. |
| DATA-054 | BF16 and FP16 shall remain distinct exact formats. QuantClarity shall not assert a universal quality ordering between them; any display order is organizational only and documented as non-quality-bearing. |

### 7.5 Provider-offering price facts

| ID | Requirement |
|---|---|
| DATA-040 | Each offering shall support standard input, output, and cached-input read prices per one million tokens. |
| DATA-041 | Price amounts shall use decimal-safe storage and shall retain the provider’s stated currency using an ISO 4217 code where one exists. |
| DATA-055 | When a provider explicitly states a currency, that currency shall be preserved. When a provider omits currency, the system shall assign USD as a documented `system_default`, expose that provenance in the UI/API, and never present the default as provider-stated. |
| DATA-042 | Prices shall not be converted between currencies. The UI and API shall return the provider-stated currency and amount or, when no currency was stated, the amount with the visibly provenance-marked USD system default required by DATA-055. |
| DATA-043 | A missing cached-input price shall be `unknown`/`null`, not zero and not equal to standard input. |
| DATA-044 | Each current price shall include effective or observed time, source, unit, currency, and any material qualifier such as promotion, minimum tier, context-length tier, region, or subscription requirement. |
| DATA-045 | Promotional pricing shall be visibly identified and shall not silently replace the standard price. If only promotional pricing is available, that limitation shall be shown. |
| DATA-046 | Normalized historical price and precision observations shall be retained for the life of the service so changes can be audited, even if initial public pages show only current facts. |
| DATA-047 | The system shall not calculate a blended token price or composite value score. |
| DATA-048 | Standard input, output, and cached-input price fields shall remain separately sortable and filterable; the system shall not collapse them into a single price or winner. |
| DATA-049 | Numeric price sorting and filtering shall be scoped to one selected currency. Prices in different currencies shall not be numerically interleaved, converted, or ranked against one another. |
| DATA-050 | Equal factual values shall remain equal. The system shall not use affiliate value or subjective preference to break factual ties; neutral provider name and stable offering ID may provide deterministic table order only. |
| DATA-056 | A `standard comparable price` shall mean a generally available, on-demand pay-as-you-go, non-batch rate requiring no subscription, committed spend, volume minimum, or dedicated deployment. Conditional, subscription, batch, volume, and committed-use prices shall remain visible with qualifiers but shall be excluded from the default standard-price sort unless the user explicitly includes that price class. |
| DATA-057 | Context-tiered or region-tiered rates shall retain their threshold/region. A displayed `from` price shall always show the qualifying condition and shall not be treated as an unconditional standard rate. |
| DATA-058 | Promotional rates shall remain visibly separate from standard non-promotional rates and shall be excluded from default standard-price sorting unless the user explicitly includes promotions. |

### 7.6 Evidence and freshness

| ID | Requirement |
|---|---|
| DATA-060 | Every published non-null model, checkpoint, architecture, parameter, precision, price, offering, and provider fact shall reference at least one evidence record and observation timestamp. Display-only labels derived deterministically from cited canonical fields shall identify their derivation rather than duplicate evidence. |
| DATA-061 | Evidence shall include source type, source owner, source locator, retrieval timestamp, extraction method/version, and a content hash or equivalent integrity marker. |
| DATA-062 | Redacted raw evidence required for audit shall be retained privately for at least 24 months. The public site shall expose only the factual excerpt or structured field needed to substantiate the claim. |
| DATA-063 | Secrets, bearer tokens, account identifiers, personal data, and unrelated response content shall be redacted before evidence retention or logging. |
| DATA-064 | Public evidence links shall point as directly as practical to the supporting provider or publisher resource. Authenticated-only evidence shall be labeled as such without exposing credentials or private account details. |
| DATA-065 | Each model page and provider page shall show the most recent successful data refresh. Each offering shall expose its own observation time through the UI and API. |
| DATA-066 | An offering shall become stale after it misses two consecutive scheduled refresh opportunities or after eight days without a successful observation, whichever occurs first. |
| DATA-067 | Stale offerings shall remain available with a visible stale status but shall be excluded from the default active-offering table view. |

## 8. Model grouping and neutral comparison rules

### 8.1 Canonical model versus explicit variant

| ID | Requirement |
|---|---|
| RULE-001 | The provider’s serving precision alone shall not split a canonical model into separate public model entries when the provider markets the offering under the canonical model name. |
| RULE-002 | An explicitly named precision variant shall receive a separate variant entry when the precision distinction is part of the publisher/provider model identity or model ID and is intentionally selectable. |
| RULE-003 | Canonical and variant pages shall link to one another and explain the relationship without merging their provider comparisons. |
| RULE-004 | Alias matching shall not redirect an explicit variant identifier to the canonical page if doing so would hide its precision distinction. |

Example acceptance case: a provider offering `glm-5p2` with API-reported BF16 and another provider offering `GLM-5.2` with API-reported FP4 shall both appear on the canonical GLM-5.2 page. A separately selectable `glm-5p2-fp8` offering shall appear under a distinct FP8 variant entry linked to the GLM-5.2 family.

### 8.2 Neutral provider comparison

| ID | Requirement |
|---|---|
| RULE-010 | QuantClarity shall not compute or publish a provider winner, recommendation, preferred-provider list, fidelity rank, value rank, or cheapest-provider designation. |
| RULE-011 | The default provider-offering table order shall be provider display name ascending, then stable offering ID ascending. This order is deterministic navigation, not a quality rank. |
| RULE-012 | Users may explicitly sort the detail table by provider, normalized precision label, standard comparable input price, standard comparable output price, standard comparable cached-input price, freshness, and status; conditional price classes shall be separately filterable. |
| RULE-013 | Price sorting shall require or establish a single currency scope and shall not convert currencies. USD shall be the default currency scope when any matching USD offerings exist; otherwise the interface shall require currency selection or use the first available ISO currency in ascending code order while visibly showing the active scope. |
| RULE-014 | Precision sorting shall use a public, versioned display order only to organize exact normalized labels; it shall not be described as fidelity, quality, or source-lineage ranking. BF16 and FP16 shall not be silently treated as a universal total quality order. |
| RULE-015 | Mixed, other, unknown, and non-comparable precision states shall remain explicit and shall not be forced into a misleading numerical rank. |
| RULE-016 | User-selected sort and filter state shall be visible in the interface and URL and shall not persist as a global provider preference. |
| RULE-017 | Affiliate availability, commission value, and operator preference shall not influence default order, user-selected sort results, search relevance, or filter results. |

## 9. Frontend requirements

### 9.1 Global experience

| ID | Requirement |
|---|---|
| FE-001 | The production site shall be public without authentication, consent walls, personalization, or account prompts. |
| FE-002 | The primary navigation shall provide direct access to model search, model browse, provider browse, methodology, API documentation, and legal/privacy information. |
| FE-003 | Every model, model variant, and provider shall have a stable, human-readable, indexable URL. |
| FE-004 | The interface shall be responsive from 320 CSS pixels through large desktop displays. |
| FE-005 | All material facts available only through hover shall also be available through focus and touch interaction. |
| FE-006 | Precision and freshness states shall not rely on color alone. |
| FE-007 | Unknown, not applicable, unavailable, and zero shall be visually and semantically distinct. |
| FE-008 | The UI shall use concise definitions and expandable explanations for technical fields without editorializing about providers. |
| FE-009 | The site shall display a visible global “data refreshed” timestamp and offering-specific observation timestamps. |

### 9.2 Home and model discovery

| ID | Requirement |
|---|---|
| FE-010 | The home page shall center a model-first search control that supports canonical names, aliases, publisher names, provider names, and provider model IDs. |
| FE-011 | Search suggestions shall distinguish models, explicit variants, and providers before selection. |
| FE-012 | The home page shall explain the product in one sentence and show a compact example of why serving precision matters. |
| FE-013 | Initial results shall prioritize exact and prefix model-name matches before semantic matches. |
| FE-014 | A browse view shall allow filtering by model, provider, and normalized precision. |
| FE-015 | Filters shall be reflected in the URL so results are linkable and restorable. |
| FE-016 | Empty results shall explain which filters eliminated results and offer a one-action reset. |

### 9.3 Model cards

| ID | Requirement |
|---|---|
| FE-020 | A model card shall show the canonical model or explicit variant display name, source model creator/publisher, total parameters, active parameters, cataloged-provider count, and last model-data refresh. A variant card shall also identify and link its canonical family. `Cataloged-provider count` means the number of distinct providers with at least one active, non-stale offering for that model or variant in the displayed publication version; historical, inactive, stale, and duplicate-tier offerings do not increase it. |
| FE-021 | A model card shall show source-checkpoint precision and source-provided quantization facts when known, clearly labeled as source-model facts rather than provider-serving facts. |
| FE-022 | A model card may show additional model-level facts such as release date, architecture, context length, modality, and license when space and evidence permit. |
| FE-023 | A model card shall not show provider names, provider prices, provider-serving precision, provider recommendations, winners, or affiliate calls to action. The cataloged-provider count is the only provider-derived summary allowed. |
| FE-024 | Explicit model variants shall be visibly differentiated from canonical models and linked to their family. |
| FE-025 | Provider filters may determine whether a model card is included in results, but shall not change the card’s model-only content or introduce provider ranking. |
| FE-026 | Applying or removing a provider filter shall not introduce a provider-derived boost or secondary order among qualifying model cards; their order shall continue to follow the active model-search or model-browse order. |
| FE-027 | Model listing cards shall use a compact subset of the Model Facts presentation. They need not reproduce the complete label, but every displayed field shall remain model-level and evidence-backed. |

### 9.4 Model detail page

| ID | Requirement |
|---|---|
| FE-030 | Every canonical model page and explicit variant page shall begin with a Model Facts label for that page’s own source identity and lineage, containing identity, publisher, architecture, total parameters, active parameters, source checkpoints, source-provided quantizations, context, license, evidence, and freshness. A variant page shall identify its canonical family relationship without substituting inherited canonical facts for variant-specific facts. The label shall contain no provider-specific price, serving precision, affiliate call to action, or provider ordering. |
| FE-031 | The page summary shall show Model Facts only. Provider price and serving-precision facts shall begin in the provider-offering comparison rather than a provider winner/recommendation summary. |
| FE-032 | The page shall list every active provider offering and allow inactive/historical offerings to be revealed separately. |
| FE-033 | The provider comparison shall show provider, provider model ID, serving weights precision, important component precision, source lineage, input price, output price, cached-input price, currency, freshness, and evidence. |
| FE-034 | The comparison shall support sorting and filtering by provider, serving precision, currency, each price category, status, and freshness. |
| FE-035 | Default comparison-table order shall be provider display name ascending and stable offering ID ascending. Affiliate status and operator preference shall not affect this order. |
| FE-036 | Users shall be able to select offerings for a compact side-by-side comparison without an account. Selection need not persist beyond the URL or local session. |
| FE-037 | A provider signup link shall identify whether the link can generate a commission before the user activates it. |
| FE-038 | The page shall explain when a wider serving compute type does not imply a higher-fidelity source checkpoint. |
| FE-039 | A user shall be able to open an Offering Facts detail view from a provider-comparison row. It shall identify the exact provider model ID, tier, material region, serving and component precision, source lineage, input/output/cached-input prices and conditions, currency provenance, evidence, observation time, freshness, affiliate disclosure where applicable, and all other applicable public fields required by DATA-021, DATA-030 through DATA-058, and DATA-060 through DATA-067. It shall not characterize or rank the offering. |

### 9.5 Provider pages

| ID | Requirement |
|---|---|
| FE-040 | A provider page shall show provider identity, official site, supported active offering count, last refresh, and any affiliate relationship. |
| FE-041 | It shall list all supported offerings with canonical model, provider model ID, precision, input price, output price, cached-input price, currency, and freshness. |
| FE-042 | It shall show the proportion and count of offerings with known versus unknown provider-side precision as facts, without converting this into a score or rating. |
| FE-043 | Provider pages shall not use accusatory labels for differences between marketing pages and API metadata. Evidence source type shall make the distinction visible. |

### 9.6 Methodology and provenance pages

| ID | Requirement |
|---|---|
| FE-050 | A public methodology page shall define every precision term, model-grouping rule, neutral comparison/sort rule, source precedence, staleness rule, and price rule, and shall state that QuantClarity does not rank or recommend providers. |
| FE-051 | The methodology page shall publish a version and effective date; historical methodology versions shall remain addressable. |
| FE-052 | Material changes to model grouping, normalization, comparison, or neutral sort logic shall be summarized in a public change log. |
| FE-053 | Evidence views shall show field, value, source type, source locator where public, observation time, and extraction method without exposing retained raw confidential material. |

### 9.7 SEO and sharing

| ID | Requirement |
|---|---|
| FE-060 | Production model and provider pages shall be server-rendered or statically rendered enough for search engines and link unfurlers to receive primary facts without executing client JavaScript. |
| FE-061 | Pages shall have unique titles, descriptions, canonical URLs, and share metadata based on canonical names and current facts. |
| FE-062 | The site shall publish XML sitemaps and a robots policy appropriate for production. |
| FE-063 | Preview deployments shall be non-indexable; Cloudflare Pages currently supplies an `X-Robots-Tag: noindex` header for preview deployments, and release verification shall confirm this behavior. |
| FE-064 | If structured data is emitted, it shall use a suitable standard vocabulary; custom precision facts shall not be mislabeled as standardized product properties. |

## 10. Search requirements

| ID | Requirement |
|---|---|
| SRCH-001 | Search shall combine exact/keyword retrieval with semantic vector retrieval. |
| SRCH-002 | Exact canonical model names, exact provider model IDs, and exact provider names shall appear before semantic-similarity matches. This search-relevance rule shall not order providers within a model comparison. |
| SRCH-003 | Semantic search shall support natural-language queries such as “GLM models offered in FP8” or “Kimi coding models on provider X” while returning matching factual records rather than a generated recommendation, winner, or narrative answer. |
| SRCH-004 | Search filters shall include record type, model/family, provider, normalized precision, status, freshness, and currency where applicable. |
| SRCH-005 | Price ranges shall be applied as structured filters, not inferred from embeddings. |
| SRCH-006 | Search index records shall reference stable canonical IDs; canonical facts shall be fetched from the publication data store rather than trusted solely from vector metadata. |
| SRCH-007 | A data publication shall not be considered complete until corresponding search-index changes are queryable or the previous index remains active. |
| SRCH-008 | Deleted or inactive records shall be removed from default search results without destroying their historical canonical records. |
| SRCH-009 | Search shall tolerate common punctuation, case, separator, and organization-prefix differences. |
| SRCH-010 | Search quality shall be evaluated against version-controlled exact, alias, filter, semantic, and no-result test cases. |
| SRCH-011 | The system shall support future pivot/facet counts by provider and precision without requiring a breaking public API change. |

Cloudflare context: Vectorize provides vector similarity and pre-query metadata filtering; its current metadata indexing limits mean the solution design must reserve structured filtering for deliberate fields rather than attempting to index every Model Facts or offering property. Cloudflare AI Search may be evaluated as a managed hybrid-search capability because it combines Vectorize-backed semantic retrieval with keyword retrieval, but this document does not mandate it over direct Vectorize use.

## 11. Public API requirements

### 11.1 General contract

| ID | Requirement |
|---|---|
| API-001 | The API shall be anonymous, public, read-only, and versioned under a stable major-version path. |
| API-002 | The initial API shall provide collections and detail resources for models, variants, providers, offerings, prices, precision observations, and evidence summaries. |
| API-002A | Model Facts and Offering Facts are presentation views backed by the model, variant, offering, price, precision-observation, and evidence resources in API-002; they shall not create redundant canonical entities or conflicting API facts. |
| API-003 | API data shall be the same canonical published data used by the website. |
| API-004 | Responses shall use JSON and UTF-8, with documented field types, units, enums, null behavior, and timestamps. |
| API-005 | Unknown facts shall be `null` or an explicit `unknown` enum as documented; they shall not be omitted inconsistently or represented as empty strings. |
| API-006 | Decimal prices shall be serialized without binary floating-point artifacts. |
| API-007 | Every collection shall use deterministic cursor pagination and enforce a documented maximum page size. |
| API-008 | Filters shall include model, model family, provider, normalized precision, currency, active status, stale status, and observation/update time where relevant. |
| API-009 | Sorting shall use an explicit allowlist and neutral deterministic secondary keys such as provider display name and stable offering ID. Equal factual values shall remain equal; secondary keys provide stable presentation only. |
| API-010 | The API shall expose search with the same exact-first behavior and structured filters as the web interface. |
| API-011 | CORS shall permit safe public read access; public resource semantics shall support GET and HEAD plus protocol-required OPTIONS preflight responses. No public method may mutate data. |
| API-012 | Responses shall support cache validation through ETag and/or Last-Modified semantics and documented cache headers. |
| API-013 | Errors shall use a stable JSON envelope with machine-readable code, human-readable message, request identifier, and relevant parameter details. |
| API-014 | The API shall publish an OpenAPI description and human-readable examples. |
| API-015 | A metadata endpoint shall expose dataset version, schema version, methodology version, publication time, and next planned refresh window. |
| API-016 | Additive response fields and new enum values shall be backward-compatible within a major API version; API documentation shall require clients to ignore unknown fields and tolerate unknown enum values. |
| API-017 | Removing or changing field semantics shall require a new major API version or a published deprecation period of at least six months. |
| API-018 | Every response containing provider offerings shall preserve equal factual records without a winner/recommendation field and shall expose the active neutral sort/filter parameters. |
| API-019 | API terms of use and dataset-use terms shall be published before release and kept distinct from the source-code license. |

### 11.2 Rate limiting and cost control

| ID | Requirement |
|---|---|
| API-020 | Public API requests shall be rate-limited primarily by a documented, versioned source-address keying policy that defines separate IPv4 and IPv6 prefix treatment. Before release, version-controlled abuse and false-positive cases shall demonstrate resistance to trivial IPv6 address rotation without collapsing unrelated normal clients into one key. |
| API-021 | Limits may differ by resource cost, with tighter controls on semantic search than cacheable detail reads. |
| API-022 | Rate-limited responses shall use HTTP 429 and include a retry indication. |
| API-023 | Rate limiting shall be treated as abuse/cost protection rather than exact billing accounting. Cloudflare’s Workers Rate Limiting API is intentionally permissive and location-local, so the implementation shall not promise a globally exact request quota. |
| API-024 | Every public API request, including a cache hit, shall execute the applicable Worker rate-limit and request-validation policy before application response-cache lookup. No CDN/cache path may bypass required API abuse controls. |
| API-024A | After rate-limit and validation checks, cacheable anonymous responses shall be served from Cloudflare caching where safe to reduce canonical-store and vector-query usage. |
| API-025 | The system shall support operator-configurable per-request ceilings for CPU time, subrequests, result count, query length, and search fan-out. |
| API-026 | Cost anomalies, rate-limit events, and high-cardinality abuse patterns shall be observable without introducing external analytics vendors. |
| API-027 | The initial capacity target shall support at least 10,000 API requests per month in addition to web-originated API traffic, with tenfold growth not requiring an API contract change. |

## 12. Data-sourcing and publication pipeline requirements

### 12.1 Scheduling and orchestration

| ID | Requirement |
|---|---|
| PIPE-001 | Automated refreshes shall begin every Monday and Thursday on a configurable UTC schedule. |
| PIPE-002 | The configured schedule and its human-readable timezone interpretation shall be documented operationally. |
| PIPE-003 | A scheduled run shall create an immutable run identifier and record its scheduled time, actual start/end, code version, schema version, provider scope, status, cost metrics, and error summary. |
| PIPE-004 | Concurrent runs for the same provider shall be prevented or made safely idempotent. |
| PIPE-005 | Provider failures shall be isolated so one provider cannot prevent successful providers from publishing. |
| PIPE-006 | Long-running retrieval and AI-extraction work shall be durable across transient failures and platform restarts. |
| PIPE-007 | Retries shall use bounded exponential backoff with provider-specific limits and shall honor `Retry-After` and provider rate limits. |
| PIPE-008 | Repeated permanent failures shall enter quarantine without infinite retries or blocking the global run. |

### 12.2 Provider adapters

| ID | Requirement |
|---|---|
| PIPE-010 | Each provider shall be integrated through an independently deployable/configurable logical adapter conforming to one versioned normalized output contract. |
| PIPE-011 | Adding a provider shall not require changing canonical model, offering, price, precision, or evidence schemas unless the provider exposes a genuinely new concept. |
| PIPE-012 | An adapter shall declare source endpoints, required credentials, retrieval method, expected precision fields, price fields, pagination behavior, rate limits, terms, robots directives, and applicable Content Signals/crawl-purpose constraints. |
| PIPE-013 | Source URLs shall be operator-configured or allowlisted. No public user input may cause the pipeline to fetch an arbitrary URL. |
| PIPE-014 | Adapters shall support provider APIs, authenticated model catalogs, public static pages, public JavaScript-rendered pages, and publisher checkpoint repositories as distinct source types. |
| PIPE-015 | API and structured catalog sources shall be preferred over page scraping when they expose the same fact more precisely. |
| PIPE-016 | Browser execution shall be used only when required to obtain provider-published facts and shall declare only the required crawl purposes while respecting robots directives, Content Signals, source terms, access controls, and cost limits. |
| PIPE-017 | Adapter fixtures shall contain redacted representative responses for repeatable parser and schema-drift tests. |
| PIPE-018 | Provider credentials and affiliate secrets shall never be included in fixtures, logs, model prompts, public evidence, or repository history. |
| PIPE-019 | Each provider adapter shall have a version-controlled expected launch roster. Every roster item in a run shall end as published, published with evidence-backed unknown fields, unavailable, failed, or quarantined with machine-readable run evidence; silent omission is prohibited. |

### 12.3 Source precedence

When sources conflict, the system shall apply a field-specific, versioned precedence policy rather than a universal “newest wins” rule:

1. Exact offering metadata returned by the provider’s own API or authenticated catalog.
2. Exact offering metadata on a provider-controlled public page or documentation page.
3. Publisher-controlled checkpoint metadata for upstream model/checkpoint facts.
4. Provider support or changelog statements that identify the exact offering.
5. Independent structured catalogs for discovery and conflict detection, not as sole evidence when provider-controlled evidence is obtainable.
6. Community discussion only as a lead for further investigation, not as canonical production evidence.

| ID | Requirement |
|---|---|
| PIPE-020 | The precedence policy shall be applied per field because a publisher is authoritative for architecture while a serving provider is authoritative for its deployed precision and price. |
| PIPE-021 | Conflicting lower-precedence facts shall be retained internally for audit and shall not silently overwrite higher-precedence evidence. |
| PIPE-022 | When equally authoritative current sources conflict, the affected public field shall become unknown or not directly comparable until a deterministic rule resolves it. |

### 12.4 AI-assisted extraction

| ID | Requirement |
|---|---|
| PIPE-030 | AI processing may locate and normalize candidate facts but shall produce schema-constrained structured output. |
| PIPE-031 | Prompts shall include only the minimum source content required and shall treat retrieved content as untrusted data, not instructions. |
| PIPE-032 | Every AI-extracted value shall retain its source span/locator and extraction model/version for audit. |
| PIPE-033 | Deterministic validation shall run after AI extraction and before canonical publication. |
| PIPE-034 | AI shall not invent a precision classification when the source is silent; the result must be unknown. |
| PIPE-035 | AI shall not perform currency conversion, price blending, quality scoring, or unsupported checkpoint-lineage inference. |
| PIPE-036 | Changing the extraction model or material prompt shall require replay testing against a version-controlled gold dataset before production use. |
| PIPE-037 | AI extraction cost and token usage shall be recorded by provider/run and constrained by configurable per-run and monthly budgets. |
| PIPE-038 | A single generative extraction from unstructured content shall never become canonical solely because it satisfies the output schema. |
| PIPE-039 | An unstructured public model, checkpoint, architecture, parameter, precision, price, offering, or provider fact shall require source-span entailment validation plus either agreement from an independent re-extraction path or corroboration by a deterministic parser/second authoritative source. Disagreement shall quarantine the affected field or record. |
| PIPE-039A | A fact parsed deterministically from a structured authoritative provider or model-publisher source may publish after schema, applicability, provenance, and anomaly validation; it does not require duplicate generative extraction. |
| PIPE-039B | Each source type shall have a versioned automated publication policy defining required evidence, verification paths, confidence thresholds, and quarantine behavior. The policy version shall be retained with the observation. |
| PIPE-039C | An `independent re-extraction path` shall use a different extraction model family or a materially independent deterministic/extractive verification procedure and independently compare its result with the cited source span. A second stochastic sample of the same prompt and model shall not qualify by itself. |

### 12.5 Validation and anomaly detection

| ID | Requirement |
|---|---|
| PIPE-040 | Validation shall check identifiers, enum values, decimal prices, currency codes, price units, parameter relationships, URLs, timestamps, required evidence, and referential integrity. |
| PIPE-041 | A price change above an operator-configured percentage, precision downgrade/upgrade, model disappearance, checkpoint change, or unusually large catalog change shall be flagged as an anomaly. |
| PIPE-042 | Anomalies shall be automatically re-retrieved from the source before acceptance. |
| PIPE-043 | If automated re-verification cannot resolve an anomaly, only the affected records shall be quarantined; the last known good record remains published and becomes stale according to policy. |
| PIPE-044 | Validation failures shall never publish partial malformed records or erase the last known good dataset. |
| PIPE-045 | The pipeline shall provide machine-readable run reports suitable for private operator issue creation or task tracking, without creating public issues. |

### 12.6 Atomic publication and rollback

| ID | Requirement |
|---|---|
| PIPE-050 | Canonical publication shall be versioned and atomic from a public reader’s perspective. |
| PIPE-051 | Model/provider data and search indexes shall not expose incompatible dataset versions during a rollout. |
| PIPE-052 | The most recent known-good publication shall remain available while a new run is processing or quarantined. |
| PIPE-053 | Operators shall be able to roll back to a prior known-good publication without hand-editing individual records. |
| PIPE-054 | Every public response shall be traceable to a dataset publication version. |
| PIPE-055 | Historical observations and evidence shall be retained independently of the current publication view. |
| PIPE-056 | A defective publication shall be removable from public service by rollback to the prior known-good publication within four hours of detection, with no more than one completed publication of public data at risk. |

## 13. Backend and canonical-data requirements

| ID | Requirement |
|---|---|
| BE-001 | The backend shall separate raw observations, normalized canonical records, historical observations, and public publication snapshots conceptually, regardless of physical storage design. |
| BE-002 | Stable identifiers shall survive provider renames, model display-name changes, price changes, and source-URL changes. |
| BE-003 | All write operations shall originate from controlled pipeline/deployment identities; the public Worker API shall have no write capability. |
| BE-004 | Canonical writes shall be idempotent using run, provider, offering, observation, and evidence identifiers. |
| BE-005 | Data constraints shall prevent orphan offerings, prices without offerings, evidence without observations, and conflicting active canonical identities. |
| BE-006 | Historical data shall be append-oriented; corrections shall create superseding facts with audit linkage rather than silently rewriting history. |
| BE-007 | Read paths shall support model-first pages without N+1 provider/source retrieval at request time. |
| BE-008 | Provider source APIs shall never be called synchronously on behalf of a public page or API request. Public reads use published data only. |
| BE-009 | Large raw evidence objects shall not be loaded into memory on public request paths. |
| BE-010 | Backups or point-in-time recovery shall cover canonical and operational data with a recovery point objective of 24 hours and a recovery time objective of 24 hours; procedures shall be tested at least twice yearly. |
| BE-011 | Search indexes shall be reproducible from canonical publication data and shall not be the sole store of any fact. |
| BE-012 | Data export shall support complete operator-controlled backup and migration away from Cloudflare without relying on the public API. |

## 14. Cloudflare-native platform requirements

### 14.1 Mandatory platform constraints

| ID | Requirement |
|---|---|
| CF-001 | The public frontend shall deploy on Cloudflare Pages and support a custom subdomain initially, with migration to a dedicated custom domain without changing public path structure. |
| CF-002 | The public API shall run behind a Cloudflare Worker. |
| CF-003 | Semantic search shall use Cloudflare Vectorize directly or a Cloudflare managed search product whose vector index is powered by Vectorize. |
| CF-004 | Ancillary managed application capabilities shall be selected from Cloudflare-native products. Permitted outbound retrieval is limited to allowlisted, adapter-declared provider sources, model-publisher/checkpoint repositories, independent discovery sources governed by PIPE-012–016 and LEG-001, affiliate destinations, and approved AI inference processors governed by CF-009. Independent discovery sources shall not become canonical evidence unless the source-precedence and verification requirements expressly allow it. |
| CF-005 | Production and preview environments shall use separate data/search bindings or otherwise prevent preview builds from mutating production state. |
| CF-006 | Infrastructure, bindings, schedules, compatibility dates, secrets references, and environments shall be reproducibly defined as code. |
| CF-007 | Secrets shall use Cloudflare secret facilities and least-privilege credentials; plaintext configuration and repository secrets are prohibited. |
| CF-008 | Public static assets and API responses shall use Cloudflare caching with explicit invalidation/version behavior after publication. |
| CF-009 | External AI inference may be used only when a documented Workers AI evaluation fails the required extraction accuracy/capability. Calls shall pass through Cloudflare AI Gateway, use a processor contract prohibiting training on submitted data and requiring appropriate retention controls, minimize source content, redact credentials/personal data, and record vendor/model/cost per run. |

### 14.2 Required Cloudflare capabilities, without prescriptive product selection

| Capability | Requirement |
|---|---|
| Scheduled execution | Must trigger Monday/Thursday runs. Cloudflare Cron Triggers and Workflow schedules both support recurring cron-based execution in UTC. |
| Durable orchestration | Must persist progress, retry bounded steps, and isolate provider failures across work lasting longer than a single ordinary request. |
| Structured canonical storage | Must support relationships, uniqueness, historical observations, atomic publication semantics, indexes, and backup/recovery. |
| Evidence/object storage | Must retain private raw/structured evidence economically without placing it in public request memory. |
| Asynchronous work | Must buffer and retry provider/catalog processing with idempotency and dead-letter/quarantine behavior when needed. |
| Semantic/hybrid search | Must satisfy Section 10 using Vectorize-backed retrieval; managed keyword search/reranking may be evaluated. |
| AI processing | Must support schema-constrained extraction and embeddings with usage/cost observability. Workers AI is the default. An external processor is allowed only under the documented exception and controls in CF-009. |
| Source acquisition | Must support direct fetch, structured API calls, and browser-rendered acquisition. Cloudflare Browser Rendering currently provides content, Markdown, scrape, JSON, link, and crawl operations; its crawl behavior respects robots directives. |
| Abuse control | Must provide path/resource-aware Worker rate limiting, caching, request validation, and WAF/bot controls where justified. |
| Observability | Must collect Worker/pipeline logs, traces, metrics, cost signals, and rate-limit events without an outside observability SaaS. |
| Web analytics | Must use Cloudflare Web Analytics only. Cloudflare states that Web Analytics collects minimal performance data and does not track individual end users across customer properties. |

### 14.3 Platform-limit resilience

| ID | Requirement |
|---|---|
| CF-020 | The solution design shall verify all current Cloudflare product limits and prices at implementation and release time rather than relying on values copied into this PRD. |
| CF-021 | Pipeline batches, vector mutations, metadata indexes, query result counts, and Worker resource ceilings shall be configurable within current platform limits. |
| CF-022 | The system shall tolerate eventual visibility of vector-index mutations and shall not mark a dataset published until search consistency criteria pass. |
| CF-023 | Before release, every Worker shall have documented CPU-time ceilings configured through Cloudflare where supported and application-enforced subrequest budgets set to the lowest values that pass approved load and pipeline tests. |
| CF-024 | Platform usage alerts shall cover Worker requests/CPU, AI inference, Vectorize queries/storage, browser execution, workflow steps, queue operations, storage, and database use as applicable. |
| CF-025 | Before implementation approval, projected base and worst-case monthly cost at stated and tenfold load shall be documented and accepted against an operator-defined monthly budget. |

## 15. Performance, reliability, and scalability

| ID | Requirement |
|---|---|
| NFR-001 | Public detail API responses served from cache shall have p95 edge response time ≤200 ms, excluding client network latency. |
| NFR-002 | Uncached structured browse/detail API responses shall have p95 server response time ≤500 ms under initial expected load. |
| NFR-003 | Search API responses shall have p95 server response time ≤1,000 ms under initial expected load. |
| NFR-004 | The public site shall meet the Core Web Vitals target in SM-08 on representative mobile and desktop traffic. |
| NFR-005 | The public read service shall target 99.9% monthly availability; data-pipeline availability is measured separately by refresh completion. |
| NFR-006 | Failure of semantic search shall degrade to exact/structured discovery where feasible rather than make model detail pages unavailable. |
| NFR-007 | Failure of analytics, affiliate redirects, or nonessential evidence previews shall not block core model/provider pages. |
| NFR-008 | The product shall scale from the initial 4 providers/approximately 80 offerings to at least 100 providers and 100,000 offerings without changing public identifiers or API resource concepts. |
| NFR-009 | Provider adapters may be added independently and enabled gradually. |
| NFR-010 | All production timestamps shall be stored and returned in UTC with explicit offsets; display localization may use the visitor’s locale without changing canonical values. |

## 16. Accessibility requirements

| ID | Requirement |
|---|---|
| A11Y-001 | Production pages shall conform to WCAG 2.2 Level AA. WCAG 2.2 is a W3C Recommendation and Level AA requires all Level A and AA criteria. |
| A11Y-002 | All search, filters, sorting, comparison selection, disclosures, evidence expansion, and navigation shall be keyboard operable. |
| A11Y-003 | Focus shall be visible and not obscured; minimum target sizes and non-drag alternatives shall follow WCAG 2.2 AA requirements. |
| A11Y-004 | Data tables shall use semantic headers, captions/descriptions, logical focus order, and accessible alternatives on narrow screens. |
| A11Y-005 | Precision, price, stale, promotional, affiliate, and unknown states shall have text equivalents. |
| A11Y-006 | Automated accessibility checks shall run in CI, supplemented by keyboard and screen-reader acceptance testing for primary journeys. |
| A11Y-007 | Reduced-motion and high-contrast user preferences shall be respected. |

## 17. Security and abuse requirements

| ID | Requirement |
|---|---|
| SEC-001 | The public Worker shall expose no data mutation, pipeline trigger, credential validation, or privileged diagnostic endpoints. |
| SEC-002 | Pipeline triggers and operator-control APIs shall be inaccessible from the public application and protected by strong Cloudflare identity/service controls. |
| SEC-003 | All provider and affiliate credentials shall be least-privilege, rotatable, environment-scoped, and excluded from client bundles and logs. |
| SEC-004 | Source retrieval shall enforce scheme, host, redirect, DNS/IP, and response-size policies to prevent SSRF and internal-network access. |
| SEC-005 | Retrieved HTML, Markdown, JSON, model descriptions, and provider strings shall be treated as untrusted and safely encoded before display. |
| SEC-006 | AI extraction shall defend against prompt injection from provider pages by separating system instructions from quoted source data and validating all output. |
| SEC-007 | API query length, filter count, page size, semantic-search cost, and response size shall have explicit bounds. |
| SEC-008 | Security headers shall include an appropriately strict Content Security Policy, HSTS, MIME sniffing protection, referrer policy, frame restrictions, and permissions policy. |
| SEC-009 | External links shall prevent opener access; affiliate links shall also be marked for sponsored/nofollow treatment as appropriate. |
| SEC-010 | Dependency, secret, and known-vulnerability scanning shall run in CI. Critical production vulnerabilities shall block release. |
| SEC-011 | Routine logs shall not retain full IP addresses longer than seven days and shall never log authorization headers. Longer security retention requires truncation, hashing with rotation, or documented incident handling. |
| SEC-012 | Backup and evidence access shall be restricted to operator identities and audited. |
| SEC-013 | A documented incident procedure shall cover credential exposure, source poisoning, erroneous mass publication, cost spikes, and public API abuse. |

## 18. Privacy, analytics, and legal requirements

### 18.1 Privacy

| ID | Requirement |
|---|---|
| PRIV-001 | QuantClarity shall not create user accounts, profiles, cross-site identifiers, behavioral segments, or targeted advertising audiences. |
| PRIV-002 | Only Cloudflare Web Analytics may be used for visitor analytics; no outside analytics, session-replay, advertising, or fingerprinting service is permitted. |
| PRIV-003 | The site shall not set first-party analytics cookies or use local storage for tracking. Functional ephemeral state may be used only when necessary and documented. |
| PRIV-004 | IP addresses used for rate limiting or security shall not be repurposed for user profiling. |
| PRIV-005 | A concise privacy notice shall state what Cloudflare and the application process, purposes, retention, and any affiliate-link consequences. |
| PRIV-006 | Search query strings shall not be sent to analytics or retained verbatim in routine operational logs. Error/security logs shall redact query content unless a documented incident mode temporarily requires bounded capture. |

### 18.2 Affiliate monetization

| ID | Requirement |
|---|---|
| AFF-001 | Affiliate relationships may be added per provider without altering canonical provider/offering records. |
| AFF-002 | A clear disclosure such as “We may earn a commission if you sign up through this link” shall appear adjacent to or within the same view as each commission-generating call to action. |
| AFF-003 | The disclosure shall be understandable without relying on the phrase “affiliate link” alone. FTC guidance says material connections should be disclosed clearly and conspicuously near the relevant endorsement or link. |
| AFF-004 | Affiliate availability, expected commission, or rate shall not affect inclusion, search relevance, model-card content, comparison-table order, user-selected sort/filter results, precision facts, price facts, prose, or evidence. |
| AFF-005 | The canonical provider URL and the affiliate destination shall be stored separately. |
| AFF-006 | Redirects shall validate destinations against an allowlist and shall not leak page/query data unnecessarily. |
| AFF-007 | If an affiliate program requires tracking incompatible with the privacy requirements, it shall not be enabled until the conflict is explicitly resolved and disclosed. |
| AFF-008 | Affiliate revenue is incidental expense recovery only. The absence, reduction, or loss of affiliate revenue shall not reduce factual coverage, change provider treatment, introduce paid access, or constitute product failure. |

### 18.3 Source and publication compliance

| ID | Requirement |
|---|---|
| LEG-001 | Each provider adapter shall document lawful access method, relevant terms, robots behavior, Content Signals/crawl-purpose behavior, attribution requirements, and restrictions before production enablement and shall revalidate them before each major release. |
| LEG-002 | The public product shall republish normalized facts and brief necessary evidence, not substantial copyrighted page content or authenticated catalog dumps. |
| LEG-003 | Provider and model trademarks shall be used descriptively with a general non-affiliation notice. |
| LEG-004 | Claims shall be neutrally worded and directly supported; the product shall not characterize conduct as fraud, theft, deception, or illegality. |
| LEG-005 | A legal-contact mechanism may exist for formal notices while no general user feedback, correction, comment, or submission feature is offered. |
| LEG-006 | Terms shall explain that prices and deployments can change, users should verify before purchase, and QuantClarity is not the inference provider. |
| LEG-007 | Domain and trademark clearance for “QuantClarity” shall be completed before public branding is finalized. The working name shall not itself be treated as cleared. |

## 19. Open-source and repository requirements

| ID | Requirement |
|---|---|
| OSS-001 | Frontend, API, provider-adapter framework, extraction orchestration, validation, and deployment code shall be published as open source after secrets and source-license constraints are reviewed. |
| OSS-002 | **Recommended license:** MPL-2.0 for code. It keeps modifications to covered source files available while allowing use alongside differently licensed code. MIT may be substituted before first release if maximum permissiveness is preferred over file-level copyleft. |
| OSS-003 | Dataset licensing shall be evaluated separately from code licensing; raw authenticated evidence shall not be included in the public repository. |
| OSS-004 | The public repository shall have GitHub Issues and Discussions disabled and shall not advertise a contribution or feedback channel. GitHub supports disabling Issues when a repository does not accept reports. |
| OSS-005 | Private work tracking shall use a separate private repository or private project visible only to operators. |
| OSS-006 | The public repository shall not solicit pull requests or promise review/support; the README shall state the maintenance policy. |
| OSS-007 | Repository history, examples, fixtures, CI logs, and build artifacts shall be scanned for provider credentials and authenticated response data before publication. |

## 20. Observability and operations

| ID | Requirement |
|---|---|
| OPS-001 | Every public request and pipeline operation shall carry a correlation/request identifier. |
| OPS-002 | Metrics shall cover request rate, latency, status, cache effectiveness, vector-search latency, rate limiting, provider retrieval success, extraction/validation failures, publication duration, stale records, and cost drivers. |
| OPS-003 | Logs and traces shall distinguish production, preview, scheduled pipeline, provider adapter, and publication version. |
| OPS-004 | Alerts shall cover public availability, scheduled-run failure, provider-wide schema drift, publication rollback, search-index inconsistency, secret/authentication failure, and budget thresholds. |
| OPS-005 | Provider-specific failure dashboards or queries shall make it possible to add providers one at a time and identify unstable integrations. |
| OPS-006 | Runbooks shall cover adding a provider, rotating credentials, handling provider schema changes, quarantining a provider, rebuilding search, rolling back publication, restoring data, and responding to cost abuse. |
| OPS-007 | No operational system shall create public GitHub issues or expose private stack traces/configuration to API clients. |
| OPS-008 | A twice-yearly disaster-recovery exercise shall verify restoration of canonical data, evidence links, and search rebuilding. |

## 21. Testing and quality requirements

| ID | Requirement |
|---|---|
| QA-001 | Unit tests shall cover normalization, precision parsing, lineage rules, currency handling, neutral comparison/sort rules, staleness, aliases, and evidence requirements. |
| QA-002 | Contract tests shall run each provider adapter against redacted fixtures and detect source-schema drift. |
| QA-003 | End-to-end tests shall cover all primary user journeys without authentication. |
| QA-004 | API conformance tests shall validate OpenAPI examples, pagination, filters, sorting, caching, CORS, nulls, decimals, errors, and rate-limited responses. |
| QA-005 | Search tests shall cover exact IDs, aliases, provider names, precision phrases, natural-language intent, structured filters, stale/inactive exclusion, and empty results. |
| QA-006 | Publication tests shall prove that failed or partial runs cannot replace the last known-good dataset. |
| QA-007 | Security tests shall cover SSRF, redirect handling, stored/script injection from source data, prompt injection, oversized inputs, resource exhaustion, and credential redaction. |
| QA-008 | Performance tests shall validate initial load plus a tenfold traffic scenario and worst-case model pages against version-controlled mobile, desktop, API, search, cache-state, dataset-size, and concurrency profiles approved before release. |
| QA-009 | Accessibility tests shall include automation plus manual keyboard, focus, zoom, color-independent state, table, and screen-reader checks. |
| QA-010 | A golden dataset shall encode known cases including canonical-versus-explicit variants, BF16/FP8/FP4 normalization, BF16-versus-FP16 non-quality ordering, mixed precision, native INT4 lineage, exact-offering applicability, unknown precision, stated versus defaulted currency, currency separation, conditional pricing, promotional pricing, and equal factual values. |
| QA-011 | Before production use, each extraction-policy version shall achieve 100% precision (no unsupported published non-unknown claims) and at least 98% recall on the approved golden dataset for required Model Facts fields (creator/publisher, checkpoint identity and source format/precision, source-provided quantizations, total parameters, active parameters, and architecture) and provider-offering fields (serving precision and all three price fields). Failures shall block that policy version. |
| QA-012 | Golden tests shall prove that a provider-catalog base-model object’s `default_precision` value is not attributed to a live offering unless exact-offering applicability is established. |
| QA-013 | Search acceptance shall use version-controlled sets meeting the size and top-result/top-10 criteria in SM-06 and SM-12; structured filter and facet cases shall have 100% expected-record agreement and zero out-of-filter results. |
| QA-014 | Rate-limit acceptance shall exercise the documented IPv4/IPv6 keying policy against normal shared-network, IPv6 privacy-address, prefix-rotation, and concentrated-abuse cases. |

## 22. Release acceptance criteria

The first public release is acceptable only when all of the following are true:

- A version-controlled launch roster identifies exactly four enabled providers and a default minimum of 20 distinct published, active, non-stale model offerings per provider. A provider proven to expose fewer qualifying models may receive a documented pre-release scope amendment with its reduced minimum and evidence; failed, unavailable, or quarantined items never count toward a provider’s published-content minimum.
- Every roster item has reached a terminal published, unavailable, quarantined, or failed state with evidence, and every enabled provider’s latest scheduled refresh completed successfully before launch.
- Every non-null fact displayed on a model card, Model Facts label, provider-offering comparison, Offering Facts view, or provider page has evidence and an observation timestamp; unsupported fields remain unknown.
- The canonical-versus-explicit-variant rules pass the golden dataset.
- Exact-offering applicability tests prove that precision is attached only to the provider model ID, tier, endpoint class, and material region supported by its evidence.
- Model cards contain model facts only; provider-filtered searches change only which model cards qualify and never inject provider names, prices, serving precision, affiliate links, provider-derived boosts, or provider order into those cards.
- Model detail pages show no provider winner, recommendation, preferred-provider list, or computed “best” designation; their provider table defaults to provider display name and stable offering ID and supports explicit user sorting/filtering.
- Input, output, and cached-input prices remain separate. Standard, conditional, tiered, promotional, and cross-currency cases pass the golden dataset, including the documented USD system default when a provider omits currency.
- The extraction policy meets the precision and recall thresholds in QA-011 on the approved golden dataset.
- The Monday/Thursday pipeline has completed successfully in production for at least two consecutive weeks.
- A failed-provider simulation leaves other providers publishable and preserves the failed provider’s last known-good records as stale when applicable.
- Website and API use the same publication version.
- The exact, semantic, filter, and facet search targets in SM-06, SM-12, and QA-013 pass against the approved version-controlled acceptance sets.
- Public API rate limiting, caching, CORS, OpenAPI documentation, and cost ceilings are enabled.
- Production and preview environments are isolated; preview pages are verified non-indexable.
- WCAG 2.2 AA acceptance checks pass for primary journeys.
- Core Web Vitals and API latency targets pass the approved version-controlled mobile, desktop, API, search, cache-state, dataset-size, and concurrency test profiles.
- Affiliate disclosures are adjacent to every monetized link, and tests confirm that affiliate availability or commission cannot affect inclusion, visibility, search relevance, card content, comparison-table order, user-selected sort results, or factual values.
- Cloudflare-only analytics and required privacy/legal pages are live.
- Public GitHub Issues and Discussions are disabled; private work tracking exists separately.
- Backup, rollback, and search rebuild procedures have been executed successfully.
- API terms and dataset-use terms are published separately from the source-code license.
- Recovery testing meets the 24-hour RPO/RTO, and publication rollback meets the four-hour rollback requirement.
- Domain and name clearance are complete, or the product launches under a cleared replacement name.

## 23. Assumptions and deferred decisions

### 23.1 Confirmed assumptions

- The service is public from day one.
- The experience is model-first.
- Data is canonical only after automated extraction, validation, and publication.
- There is no login, administration UI, contribution path, public feedback mechanism, or moderation surface.
- Data refresh occurs Mondays and Thursdays.
- Pricing is shown only as input, output, and cached input in the provider’s stated currency; when the provider omits currency, USD is visibly identified as a system default.
- The public API is anonymous, read-only, and rate-limited by IP with cost controls.
- Precision may be sourced from provider APIs even when provider public pages omit it.
- Affiliate monetization is permitted but cannot influence facts, inclusion, search relevance, card content, provider order, or user-selected results.
- The dataset, website, and public API remain free and public even if the service operates at a net financial loss; usefulness of the data is the sole product justification, and revenue is secondary.
- Cloudflare is the sole application platform and analytics provider, subject only to the narrowly controlled source, affiliate-destination, and AI-processing exceptions in G-09 and CF-009.

### 23.2 Decisions deferred to solution design or implementation planning

- Frontend framework and rendering strategy.
- Canonical relational/object/cache storage products and schemas.
- Direct Vectorize versus Vectorize-backed Cloudflare AI Search for hybrid retrieval.
- Embedding and extraction models.
- Cron Trigger versus Workflow schedule and detailed pipeline decomposition.
- Queue and durable-workflow boundaries.
- Exact public API rate values and cache TTLs.
- Specific cost budget and alert thresholds.
- Exact Monday/Thursday UTC start time.
- Final custom domain.
- Final decision between recommended MPL-2.0 and MIT before the first OSS release.

## 24. Research context and authoritative references

These sources inform requirements but do not replace release-time verification of current limits, pricing, or terms:

- [OpenRouter provider routing and quantization taxonomy](https://openrouter.ai/docs/guides/routing/provider-selection) — demonstrates a current provider-level vocabulary including INT4, INT8, FP4, FP6, FP8, FP16, BF16, FP32, and unknown.
- [Fireworks model-list API](https://docs.fireworks.ai/api-reference/list-models) — exposes model metadata including `baseModelDetails.defaultPrecision`, supporting exact offering-level evidence.
- [Artificial Analysis provider leaderboard](https://artificialanalysis.ai/leaderboards/providers) — current example of provider/model price and performance comparison with some explicit precision labels; incomplete labels reinforce the requirement that unknown remain unknown.
- [Cloudflare Vectorize metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/) and [Vectorize client API](https://developers.cloudflare.com/vectorize/reference/client-api/) — current vector filtering and query constraints.
- [Cloudflare AI Search architecture](https://developers.cloudflare.com/ai-search/concepts/how-ai-search-works/) — current managed hybrid-search option built around vector and keyword retrieval.
- [Cloudflare Workers Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) — current path/resource-aware rate limiting and its locality/eventual-consistency caveats.
- [Cloudflare Worker limits](https://developers.cloudflare.com/workers/platform/limits/) — current paid-plan runtime and resource constraints that must be rechecked during solution design.
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) and [scheduled Workflows](https://developers.cloudflare.com/workflows/build/trigger-workflows/) — current native scheduling options.
- [Cloudflare Browser Rendering crawl](https://developers.cloudflare.com/browser-run/quick-actions/crawl-endpoint/) — current source-acquisition capability, including robots-aware crawling.
- [Cloudflare Pages preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/) and [custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/) — current deployment, preview noindex, and domain support.
- [Cloudflare Web Analytics data collection](https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/) — current privacy-oriented traffic/performance analytics behavior.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — accessibility conformance standard.
- [FTC Endorsement Guides FAQ](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking) — affiliate/material-connection disclosure guidance.
- [GitHub disabling Issues](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/disabling-issues) — supports the repository policy requirement.
