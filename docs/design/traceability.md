# QuantClarity requirements traceability

| Attribute | Value |
|---|---|
| Status | Implementation in progress; no release gate in this matrix is verified |
| Requirements baseline | [`docs/product/requirements.md`](../product/requirements.md) |
| Design baseline | [`docs/design/system-design.md`](system-design.md), sections 1–19 |
| Coverage | 317 normative requirements, 13 success measures, and 24 derived release-acceptance anchors |
| Derived identifiers | `REL-AC-01` through `REL-AC-24` label the ordered bullets in PRD Section 22; they do not amend the PRD |

## Purpose and authority

The PRD remains authoritative for requirement wording. This file is the authoritative human-readable mapping from each normative PRD ID, success measure, and release-acceptance bullet to planned design ownership and verification. Requirement summaries below are navigation aids only and must not be used to reinterpret the source requirement.

A `Planned` status means the design and verification destination has been assigned. It does not mean the requirement is implemented, tested, accepted, or approved. Status may advance only when linked evidence exists.

## Design-section legend

| Code | System-design section |
|---|---|
| `D02` | 2. Scope, constraints, assumptions, and traceability |
| `D03` | 3. System context and trust boundaries |
| `D04` | 4. Architecture and component responsibilities |
| `D05` | 5. Canonical information model |
| `D06` | 6. Source acquisition and provider-adapter contract |
| `D07` | 7. Extraction, validation, and evidence |
| `D08` | 8. Pipeline orchestration and publication |
| `D09` | 9. Public API contract |
| `D10` | 10. Search design |
| `D11` | 11. Frontend delivery boundaries |
| `D12` | 12. Cloudflare service decisions |
| `D13` | 13. Security, privacy, and legal controls |
| `D14` | 14. Reliability, recovery, and operations |
| `D15` | 15. Performance, scale, and cost model |
| `D16` | 16. Development, test, and deployment strategy |
| `D17` | 17. Initial vertical slice |
| `D18` | 18. Decisions, alternatives, and open approval items |
| `D19` | 19. Requirement-to-design and requirement-to-test matrix |

## Verification conventions

Verification IDs are planned stable anchors. The prefix states the primary verification category; a requirement may gain additional checks during detailed design without changing its primary ID.

| Prefix | Category |
|---|---|
| `MET` | Measured success criterion or acceptance-set result |
| `CT` | Schema and contract verification |
| `UT` | Unit and golden-case verification |
| `E2E` | End-to-end and frontend accessibility verification |
| `SAT` | Search acceptance testing |
| `ACT` | API conformance testing |
| `PIT` | Pipeline integration and failure-path testing |
| `DIT` | Canonical-data integration testing |
| `POT` | Cloudflare platform and operational verification |
| `PRT` | Performance and reliability testing |
| `AAT` | Automated and manual accessibility testing |
| `SST` | Security testing |
| `PVT` | Privacy verification |
| `ANT` | Affiliate disclosure and neutrality verification |
| `LCT` | Legal and source-compliance review |
| `RCT` | Repository-policy verification |
| `ORT` | Operational, backup, rollback, and recovery exercise |
| `QGA` | Quality-plan and release-gate audit |
| `RGA` | Composite release-acceptance gate |

## Coverage rules

1. Every normative requirement ID in PRD Sections 7–21 shall appear exactly once.
2. Every success-measure ID in PRD Section 3 shall appear exactly once.
3. Every ordered release bullet in PRD Section 22 shall appear exactly once as `REL-AC-01` through `REL-AC-24`.
4. Every row shall reference at least one system-design section and exactly one primary planned verification ID.
5. Verification IDs shall be unique and shall reference an existing source ID.
6. No row may be marked verified without a linked, reproducible artifact or recorded manual approval.
7. A release-blocking row may not be waived through this matrix; any product change requires explicit owner approval and the PRD change procedure.
8. CI shall eventually validate source-ID coverage, uniqueness, design references, verification-ID uniqueness, and the absence of orphan verification references.

## Traceability matrix

### Success measures

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `SM-01` | §3 | Pipeline orchestration completion | `D08`, `D14`, `D19` | Metric/acceptance — `MET-SM-01` | Planned |
| `SM-02` | §3 | Published precision provenance | `D07`, `D11`, `D19` | Metric/acceptance — `MET-SM-02` | Planned |
| `SM-03` | §3 | Published price provenance | `D07`, `D11`, `D19` | Metric/acceptance — `MET-SM-03` | Planned |
| `SM-04` | §3 | Freshness | `D08`, `D11`, `D14`, `D19` | Metric/acceptance — `MET-SM-04` | Planned |
| `SM-05` | §3 | Public API reliability | `D09`, `D14`, `D19` | Metric/acceptance — `MET-SM-05` | Planned |
| `SM-06` | §3 | Exact search effectiveness | `D10`, `D16`, `D19` | Metric/acceptance — `MET-SM-06` | Planned |
| `SM-07` | §3 | Accessibility | `D11`, `D16`, `D19` | Metric/acceptance — `MET-SM-07` | Planned |
| `SM-08` | §3 | Web performance | `D11`, `D15`, `D16`, `D19` | Metric/acceptance — `MET-SM-08` | Planned |
| `SM-09` | §3 | Cost safety | `D12`, `D15`, `D19` | Metric/acceptance — `MET-SM-09` | Planned |
| `SM-10` | §3 | Provider-order neutrality | `D10`, `D11`, `D13`, `D19` | Metric/acceptance — `MET-SM-10` | Planned |
| `SM-11` | §3 | Provider refresh success | `D06`, `D08`, `D14`, `D19` | Metric/acceptance — `MET-SM-11` | Planned |
| `SM-12` | §3 | Semantic search effectiveness | `D10`, `D16`, `D19` | Metric/acceptance — `MET-SM-12` | Planned |
| `SM-13` | §3 | Published model-fact provenance | `D05`, `D07`, `D11`, `D19` | Metric/acceptance — `MET-SM-13` | Planned |

### Information model and facts

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `DATA-001` | §7.1 | Each model shall have a stable internal identifier and stable public slug that do not depend on a single… | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-001`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `DATA-002` | §7.1 | Each model shall store a canonical display name, normalized name, original publisher/developer, model… | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-002` | Planned |
| `DATA-003` | §7.1 | Each model shall support zero or more explicitly named variants and bidirectional family/variant links. | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-003` | Planned |
| `DATA-004` | §7.1 | Model aliases shall include common punctuation, case, separator, organization-prefix, and provider-ID… | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-004` | Planned |
| `DATA-005` | §7.1 | A model shall include release date, modalities, context length, maximum output length, license, and… | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-005` | Planned |
| `DATA-006` | §7.1 | A model shall store total parameter count and active parameter count independently; active parameters shall… | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-006` | Planned |
| `DATA-007` | §7.1 | Parameter counts shall retain the source value and normalized integer value where normalization is… | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-007` | Planned |
| `DATA-008` | §7.1 | Every non-null public model identity, creator/publisher, release, architecture, context, license,… | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-008` | Planned |
| `DATA-009` | §7.1 | When publisher-controlled evidence is unavailable, a model fact may publish only from the highest applicable… | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-009` | Planned |
| `DATA-010` | §7.2 | Each model or variant shall support zero or more authoritative source checkpoints. | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-010` | Planned |
| `DATA-011` | §7.2 | A checkpoint record shall support publisher, repository or artifact URL, repository ID, revision or commit,… | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-011` | Planned |
| `DATA-012` | §7.2 | The system shall distinguish an original publisher checkpoint from a third-party conversion, even if both… | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-012` | Planned |
| `DATA-013` | §7.2 | The system shall distinguish canonical/base checkpoints from source-provided quantized variants. | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-013` | Planned |
| `DATA-014` | §7.2 | Checkpoint relationships shall express derived from, quantized from, publisher-provided variant of, and… | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-014` | Planned |
| `DATA-015` | §7.2 | If the public source is already quantized, the Model Facts label shall state that fact and shall not… | `D05`, `D07`, `D19` | Schema/contract — `CT-DATA-015` | Planned |
| `DATA-020` | §7.3 | Every provider/model combination shall be represented as one or more offerings rather than placing… | `D05`, `D19` | Schema/contract — `CT-DATA-020`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `DATA-021` | §7.3 | An offering shall include provider, provider model ID, display name, linked canonical model or variant,… | `D05`, `D19` | Schema/contract — `CT-DATA-021` | Planned |
| `DATA-022` | §7.3 | Materially different deployment tiers, such as standard versus fast or serverless versus dedicated, shall be… | `D05`, `D19` | Schema/contract — `CT-DATA-022` | Planned |
| `DATA-023` | §7.3 | Region shall create a distinct offering only when it changes price, precision, availability, or a… | `D05`, `D19` | Schema/contract — `CT-DATA-023` | Planned |
| `DATA-024` | §7.3 | Provider aliases and corporate-name changes shall not alter stable provider IDs. | `D05`, `D19` | Schema/contract — `CT-DATA-024` | Planned |
| `DATA-025` | §7.3 | An offering removed from a provider shall be retained historically and marked inactive rather than deleted. | `D05`, `D19` | Schema/contract — `CT-DATA-025` | Planned |
| `DATA-030` | §7.4 | Each offering shall expose the provider’s raw precision string exactly as observed, the provider… | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-030`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `DATA-031` | §7.4 | The normalized vocabulary shall support at minimum BF16, FP16, FP8, FP6, FP4, NVFP4, MXFP4, INT8, INT4,… | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-031` | Planned |
| `DATA-032` | §7.4 | Precision shall be scoped where evidence permits: stored weights, weight computation, activations,… | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-032` | Planned |
| `DATA-033` | §7.4 | A single scalar “precision” field shall not overwrite mixed-precision detail. The summary may say mixed… | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-033` | Planned |
| `DATA-034` | §7.4 | Format variants such as FP8 E4M3 versus E5M2 and vendor-specific block formats shall be retained when supplied. | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-034` | Planned |
| `DATA-035` | §7.4 | The provider-offering comparison and Offering Facts view shall identify whether serving precision was… | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-035` | Planned |
| `DATA-036` | §7.4 | The system shall not infer precision from output speed, model price, accelerator model, endpoint name… | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-036` | Planned |
| `DATA-037` | §7.4 | Provider API metadata may be published even when the provider’s public marketing page omits the same fact,… | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-037` | Planned |
| `DATA-038` | §7.4 | Asking the served language model to self-identify its precision shall not qualify as evidence. | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-038` | Planned |
| `DATA-039` | §7.4 | Unknown component precision shall remain unknown even if another component is known. | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-039` | Planned |
| `DATA-051` | §7.4 | Precision evidence shall identify the exact provider model ID, deployment tier, endpoint/availability class,… | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-051`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `DATA-052` | §7.4 | A wider downstream stored, compute, activation, accumulation, or cache representation shall not be described… | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-052` | Planned |
| `DATA-053` | §7.4 | Precision normalization rules and display-order rules shall be independently versioned and exposed through… | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-053` | Planned |
| `DATA-054` | §7.4 | BF16 and FP16 shall remain distinct exact formats. QuantClarity shall not assert a universal quality… | `D05`, `D07`, `D11`, `D19` | Schema/contract — `CT-DATA-054` | Planned |
| `DATA-040` | §7.5 | Each offering shall support standard input, output, and cached-input read prices per one million tokens. | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-040`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `DATA-041` | §7.5 | Price amounts shall use decimal-safe storage and shall retain the provider’s stated currency using an ISO… | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-041` | Planned |
| `DATA-055` | §7.5 | When a provider explicitly states a currency, that currency shall be preserved. When a provider omits… | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-055`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `DATA-042` | §7.5 | Prices shall not be converted between currencies. The UI and API shall return the provider-stated currency… | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-042` | Planned |
| `DATA-043` | §7.5 | A missing cached-input price shall be unknown/null, not zero and not equal to standard input. | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-043` | Planned |
| `DATA-044` | §7.5 | Each current price shall include effective or observed time, source, unit, currency, and any material… | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-044` | Planned |
| `DATA-045` | §7.5 | Promotional pricing shall be visibly identified and shall not silently replace the standard price. If only… | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-045` | Planned |
| `DATA-046` | §7.5 | Normalized historical price and precision observations shall be retained for the life of the service so… | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-046` | Planned |
| `DATA-047` | §7.5 | The system shall not calculate a blended token price or composite value score. | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-047` | Planned |
| `DATA-048` | §7.5 | Standard input, output, and cached-input price fields shall remain separately sortable and filterable; the… | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-048` | Planned |
| `DATA-049` | §7.5 | Numeric price sorting and filtering shall be scoped to one selected currency. Prices in different currencies… | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-049` | Planned |
| `DATA-050` | §7.5 | Equal factual values shall remain equal. The system shall not use affiliate value or subjective preference… | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-050` | Planned |
| `DATA-056` | §7.5 | A standard comparable price shall mean a generally available, on-demand pay-as-you-go, non-batch rate… | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-056` | Planned |
| `DATA-057` | §7.5 | Context-tiered or region-tiered rates shall retain their threshold/region. A displayed from price shall… | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-057` | Planned |
| `DATA-058` | §7.5 | Promotional rates shall remain visibly separate from standard non-promotional rates and shall be excluded… | `D05`, `D11`, `D19` | Schema/contract — `CT-DATA-058` | Planned |
| `DATA-060` | §7.6 | Every published non-null model, checkpoint, architecture, parameter, precision, price, offering, and… | `D05`, `D07`, `D08`, `D11`, `D14`, `D19` | Schema/contract — `CT-DATA-060`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `DATA-061` | §7.6 | Evidence shall include source type, source owner, source locator, retrieval timestamp, extraction… | `D05`, `D07`, `D08`, `D11`, `D14`, `D19` | Schema/contract — `CT-DATA-061` | Planned |
| `DATA-062` | §7.6 | Redacted raw evidence required for audit shall be retained privately for at least 24 months. The public site… | `D05`, `D07`, `D08`, `D11`, `D14`, `D19` | Schema/contract — `CT-DATA-062` | Planned |
| `DATA-063` | §7.6 | Secrets, bearer tokens, account identifiers, personal data, and unrelated response content shall be redacted… | `D05`, `D07`, `D08`, `D11`, `D14`, `D19` | Schema/contract — `CT-DATA-063`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `DATA-064` | §7.6 | Public evidence links shall point as directly as practical to the supporting provider or publisher resource.… | `D05`, `D07`, `D08`, `D11`, `D14`, `D19` | Schema/contract — `CT-DATA-064` | Planned |
| `DATA-065` | §7.6 | Each model page and provider page shall show the most recent successful data refresh. Each offering shall… | `D05`, `D07`, `D08`, `D11`, `D14`, `D19` | Schema/contract — `CT-DATA-065` | Planned |
| `DATA-066` | §7.6 | An offering shall become stale after it misses two consecutive scheduled refresh opportunities or after… | `D05`, `D07`, `D08`, `D11`, `D14`, `D19` | Schema/contract — `CT-DATA-066` | Planned |
| `DATA-067` | §7.6 | Stale offerings shall remain available with a visible stale status but shall be excluded from the default… | `D05`, `D07`, `D08`, `D11`, `D14`, `D19` | Schema/contract — `CT-DATA-067` | Planned |

### Model grouping and neutral comparison

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `RULE-001` | §8.1 | The provider’s serving precision alone shall not split a canonical model into separate public model entries… | `D05`, `D10`, `D11`, `D19` | Unit/golden — `UT-RULE-001` | Planned |
| `RULE-002` | §8.1 | An explicitly named precision variant shall receive a separate variant entry when the precision distinction… | `D05`, `D10`, `D11`, `D19` | Unit/golden — `UT-RULE-002` | Planned |
| `RULE-003` | §8.1 | Canonical and variant pages shall link to one another and explain the relationship without merging their… | `D05`, `D10`, `D11`, `D19` | Unit/golden — `UT-RULE-003` | Planned |
| `RULE-004` | §8.1 | Alias matching shall not redirect an explicit variant identifier to the canonical page if doing so would… | `D05`, `D10`, `D11`, `D19` | Unit/golden — `UT-RULE-004` | Planned |
| `RULE-010` | §8.2 | QuantClarity shall not compute or publish a provider winner, recommendation, preferred-provider list,… | `D05`, `D10`, `D11`, `D19` | Unit/golden — `UT-RULE-010` | Planned |
| `RULE-011` | §8.2 | The default provider-offering table order shall be provider display name ascending, then stable offering ID… | `D05`, `D10`, `D11`, `D19` | Unit/golden — `UT-RULE-011` | Planned |
| `RULE-012` | §8.2 | Users may explicitly sort the detail table by provider, normalized precision label, standard comparable… | `D05`, `D10`, `D11`, `D19` | Unit/golden — `UT-RULE-012` | Planned |
| `RULE-013` | §8.2 | Price sorting shall require or establish a single currency scope and shall not convert currencies. USD shall… | `D05`, `D10`, `D11`, `D19` | Unit/golden — `UT-RULE-013` | Planned |
| `RULE-014` | §8.2 | Precision sorting shall use a public, versioned display order only to organize exact normalized labels; it… | `D05`, `D10`, `D11`, `D19` | Unit/golden — `UT-RULE-014` | Planned |
| `RULE-015` | §8.2 | Mixed, other, unknown, and non-comparable precision states shall remain explicit and shall not be forced… | `D05`, `D10`, `D11`, `D19` | Unit/golden — `UT-RULE-015` | Planned |
| `RULE-016` | §8.2 | User-selected sort and filter state shall be visible in the interface and URL and shall not persist as a… | `D05`, `D10`, `D11`, `D19` | Unit/golden — `UT-RULE-016` | Planned |
| `RULE-017` | §8.2 | Affiliate availability, commission value, and operator preference shall not influence default order,… | `D05`, `D10`, `D11`, `D19` | Unit/golden — `UT-RULE-017` | Planned |

### Frontend

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `FE-001` | §9.1 | The production site shall be public without authentication, consent walls, personalization, or account prompts. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-001` | Planned |
| `FE-002` | §9.1 | The primary navigation shall provide direct access to model search, model browse, provider browse,… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-002` | Planned |
| `FE-003` | §9.1 | Every model, model variant, and provider shall have a stable, human-readable, indexable URL. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-003` | Planned |
| `FE-004` | §9.1 | The interface shall be responsive from 320 CSS pixels through large desktop displays. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-004` | Planned |
| `FE-005` | §9.1 | All material facts available only through hover shall also be available through focus and touch interaction. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-005` | Planned |
| `FE-006` | §9.1 | Precision and freshness states shall not rely on color alone. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-006` | Planned |
| `FE-007` | §9.1 | Unknown, not applicable, unavailable, and zero shall be visually and semantically distinct. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-007` | Planned |
| `FE-008` | §9.1 | The UI shall use concise definitions and expandable explanations for technical fields without editorializing… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-008` | Planned |
| `FE-009` | §9.1 | The site shall display a visible global “data refreshed” timestamp and offering-specific observation timestamps. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-009` | Planned |
| `FE-010` | §9.2 | The home page shall center a model-first search control that supports canonical names, aliases, publisher… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-010` | Planned |
| `FE-011` | §9.2 | Search suggestions shall distinguish models, explicit variants, and providers before selection. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-011` | Planned |
| `FE-012` | §9.2 | The home page shall explain the product in one sentence and show a compact example of why serving precision… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-012` | Planned |
| `FE-013` | §9.2 | Initial results shall prioritize exact and prefix model-name matches before semantic matches. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-013` | Planned |
| `FE-014` | §9.2 | A browse view shall allow filtering by model, provider, and normalized precision. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-014` | Planned |
| `FE-015` | §9.2 | Filters shall be reflected in the URL so results are linkable and restorable. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-015` | Planned |
| `FE-016` | §9.2 | Empty results shall explain which filters eliminated results and offer a one-action reset. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-016` | Planned |
| `FE-020` | §9.3 | A model card shall show the canonical model or explicit variant display name, source model… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-020` | Planned |
| `FE-021` | §9.3 | A model card shall show source-checkpoint precision and source-provided quantization facts when known,… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-021` | Planned |
| `FE-022` | §9.3 | A model card may show additional model-level facts such as release date, architecture, context length,… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-022` | Planned |
| `FE-023` | §9.3 | A model card shall not show provider names, provider prices, provider-serving precision, provider… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-023` | Planned |
| `FE-024` | §9.3 | Explicit model variants shall be visibly differentiated from canonical models and linked to their family. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-024` | Planned |
| `FE-025` | §9.3 | Provider filters may determine whether a model card is included in results, but shall not change the card’s… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-025` | Planned |
| `FE-026` | §9.3 | Applying or removing a provider filter shall not introduce a provider-derived boost or secondary order among… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-026` | Planned |
| `FE-027` | §9.3 | Model listing cards shall use a compact subset of the Model Facts presentation. They need not reproduce the… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-027` | Planned |
| `FE-030` | §9.4 | Every canonical model page and explicit variant page shall begin with a Model Facts label for that page’s… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-030` | Planned |
| `FE-031` | §9.4 | The page summary shall show Model Facts only. Provider price and serving-precision facts shall begin in the… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-031` | Planned |
| `FE-032` | §9.4 | The page shall list every active provider offering and allow inactive/historical offerings to be revealed… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-032` | Planned |
| `FE-033` | §9.4 | The provider comparison shall show provider, provider model ID, serving weights precision, important… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-033` | Planned |
| `FE-034` | §9.4 | The comparison shall support sorting and filtering by provider, serving precision, currency, each price… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-034` | Planned |
| `FE-035` | §9.4 | Default comparison-table order shall be provider display name ascending and stable offering ID ascending.… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-035` | Planned |
| `FE-036` | §9.4 | Users shall be able to select offerings for a compact side-by-side comparison without an account. Selection… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-036` | Planned |
| `FE-037` | §9.4 | A provider signup link shall identify whether the link can generate a commission before the user activates it. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-037` | Planned |
| `FE-038` | §9.4 | The page shall explain when a wider serving compute type does not imply a higher-fidelity source checkpoint. | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-038` | Planned |
| `FE-039` | §9.4 | A user shall be able to open an Offering Facts detail view from a provider-comparison row. It shall identify… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-039` | Planned |
| `FE-040` | §9.5 | A provider page shall show provider identity, official site, supported active offering count, last refresh,… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-040` | Planned |
| `FE-041` | §9.5 | It shall list all supported offerings with canonical model, provider model ID, precision, input price,… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-041` | Planned |
| `FE-042` | §9.5 | It shall show the proportion and count of offerings with known versus unknown provider-side precision as… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-042` | Planned |
| `FE-043` | §9.5 | Provider pages shall not use accusatory labels for differences between marketing pages and API metadata.… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-043` | Planned |
| `FE-050` | §9.6 | A public methodology page shall define every precision term, model-grouping rule, neutral comparison/sort… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-050` | Planned |
| `FE-051` | §9.6 | The methodology page shall publish a version and effective date; historical methodology versions shall… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-051` | Planned |
| `FE-052` | §9.6 | Material changes to model grouping, normalization, comparison, or neutral sort logic shall be summarized in… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-052` | Planned |
| `FE-053` | §9.6 | Evidence views shall show field, value, source type, source locator where public, observation time, and… | `D11`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-053` | Planned |
| `FE-060` | §9.7 | Production model and provider pages shall be server-rendered or statically rendered enough for search… | `D11`, `D13`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-060` | Planned |
| `FE-061` | §9.7 | Pages shall have unique titles, descriptions, canonical URLs, and share metadata based on canonical names… | `D11`, `D13`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-061` | Planned |
| `FE-062` | §9.7 | The site shall publish XML sitemaps and a robots policy appropriate for production. | `D11`, `D13`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-062` | Planned |
| `FE-063` | §9.7 | Worker preview static and SSR responses shall be non-indexable with explicit headers and robots policy… | `D11`, `D13`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-063` | Planned |
| `FE-064` | §9.7 | If structured data is emitted, it shall use a suitable standard vocabulary; custom precision facts shall not… | `D11`, `D13`, `D16`, `D19` | End-to-end/accessibility — `E2E-FE-064` | Planned |

### Search

[Phase 5A](phase-5a-local-api-kernel.md) records bounded local decision targets for `SRCH-002`, `SRCH-004`–`SRCH-006`, `SRCH-008`, and `SRCH-009`. It deliberately disables public semantic processing and leaves every search row `Planned` pending the complete acceptance set and deployed search evidence.

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `SRCH-001` | §10 | Search shall combine exact/keyword retrieval with semantic vector retrieval. | `D10`, `D16`, `D19` | Search acceptance — `SAT-SRCH-001` | Planned |
| `SRCH-002` | §10 | Exact canonical model names, exact provider model IDs, and exact provider names shall appear before… | `D10`, `D16`, `D19` | Search acceptance — `SAT-SRCH-002` | Planned |
| `SRCH-003` | §10 | Semantic search shall support natural-language queries such as “GLM models offered in FP8” or “Kimi coding… | `D10`, `D16`, `D19` | Search acceptance — `SAT-SRCH-003` | Planned |
| `SRCH-004` | §10 | Search filters shall include record type, model/family, provider, normalized precision, status, freshness,… | `D10`, `D16`, `D19` | Search acceptance — `SAT-SRCH-004` | Planned |
| `SRCH-005` | §10 | Price ranges shall be applied as structured filters, not inferred from embeddings. | `D10`, `D16`, `D19` | Search acceptance — `SAT-SRCH-005` | Planned |
| `SRCH-006` | §10 | Search index records shall reference stable canonical IDs; canonical facts shall be fetched from the… | `D10`, `D16`, `D19` | Search acceptance — `SAT-SRCH-006`; [Phase 4 local evidence](phase-4-local-kernel.md) | Planned |
| `SRCH-007` | §10 | A data publication shall not be considered complete until corresponding search-index changes are queryable… | `D10`, `D16`, `D19` | Search acceptance — `SAT-SRCH-007`; [Phase 4 local readiness decision](phase-4-local-kernel.md), Vectorize evidence pending | Planned |
| `SRCH-008` | §10 | Deleted or inactive records shall be removed from default search results without destroying their historical… | `D10`, `D16`, `D19` | Search acceptance — `SAT-SRCH-008` | Planned |
| `SRCH-009` | §10 | Search shall tolerate common punctuation, case, separator, and organization-prefix differences. | `D10`, `D16`, `D19` | Search acceptance — `SAT-SRCH-009` | Planned |
| `SRCH-010` | §10 | Search quality shall be evaluated against version-controlled exact, alias, filter, semantic, and no-result… | `D10`, `D16`, `D19` | Search acceptance — `SAT-SRCH-010` | Planned |
| `SRCH-011` | §10 | The system shall support future pivot/facet counts by provider and precision without requiring a breaking… | `D10`, `D16`, `D19` | Search acceptance — `SAT-SRCH-011` | Planned |

### Public API

[Phase 5A](phase-5a-local-api-kernel.md) records the local contract and decision boundary for `API-001`–`API-018` and `API-020`–`API-026`. Pure plans, fakes, and generated contracts do not complete the runtime, load, privacy, or legal evidence, so every row remains `Planned`.

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `API-001` | §11.1 | The API shall be anonymous, public, read-only, and versioned under a stable major-version path. | `D09`, `D16`, `D19` | API conformance — `ACT-API-001` | Planned |
| `API-002` | §11.1 | The initial API shall provide collections and detail resources for models, variants, providers, offerings,… | `D09`, `D16`, `D19` | API conformance — `ACT-API-002` | Planned |
| `API-002A` | §11.1 | Model Facts and Offering Facts are presentation views backed by the model, variant, offering, price,… | `D09`, `D16`, `D19` | API conformance — `ACT-API-002A` | Planned |
| `API-003` | §11.1 | API data shall be the same canonical published data used by the website. | `D09`, `D16`, `D19` | API conformance — `ACT-API-003`; ADR 0013 contract; [Phase 4 local selection decision](phase-4-local-kernel.md), public transport pending | Planned |
| `API-004` | §11.1 | Responses shall use JSON and UTF-8, with documented field types, units, enums, null behavior, and timestamps. | `D09`, `D16`, `D19` | API conformance — `ACT-API-004` | Planned |
| `API-005` | §11.1 | Unknown facts shall be null or an explicit unknown enum as documented; they shall not be omitted… | `D09`, `D16`, `D19` | API conformance — `ACT-API-005` | Planned |
| `API-006` | §11.1 | Decimal prices shall be serialized without binary floating-point artifacts. | `D09`, `D16`, `D19` | API conformance — `ACT-API-006` | Planned |
| `API-007` | §11.1 | Every collection shall use deterministic cursor pagination and enforce a documented maximum page size. | `D09`, `D16`, `D19` | API conformance — `ACT-API-007` | Planned |
| `API-008` | §11.1 | Filters shall include model, model family, provider, normalized precision, currency, active status, stale… | `D09`, `D16`, `D19` | API conformance — `ACT-API-008` | Planned |
| `API-009` | §11.1 | Sorting shall use an explicit allowlist and neutral deterministic secondary keys such as provider display… | `D09`, `D16`, `D19` | API conformance — `ACT-API-009` | Planned |
| `API-010` | §11.1 | The API shall expose search with the same exact-first behavior and structured filters as the web interface. | `D09`, `D16`, `D19` | API conformance — `ACT-API-010` | Planned |
| `API-011` | §11.1 | CORS shall permit safe public read access; public resource semantics shall support GET and HEAD plus… | `D09`, `D16`, `D19` | API conformance — `ACT-API-011` | Planned |
| `API-012` | §11.1 | Responses shall support cache validation through ETag and/or Last-Modified semantics and documented cache… | `D09`, `D16`, `D19` | API conformance — `ACT-API-012` | Planned |
| `API-013` | §11.1 | Stable bounded error envelope with no retained public request-correlation identifier | `D09`, `D13`, `D16`, `D19` | API conformance — `ACT-API-013` | Planned |
| `API-014` | §11.1 | The API shall publish an OpenAPI description and human-readable examples. | `D09`, `D16`, `D19` | API conformance — `ACT-API-014` | Planned |
| `API-015` | §11.1 | A metadata endpoint shall expose dataset version, schema version, methodology version, publication time, and… | `D09`, `D16`, `D19` | API conformance — `ACT-API-015` | Planned |
| `API-016` | §11.1 | Additive response fields and new enum values shall be backward-compatible within a major API version; API… | `D09`, `D16`, `D19` | API conformance — `ACT-API-016` | Planned |
| `API-017` | §11.1 | Removing or changing field semantics shall require a new major API version or a published deprecation period… | `D09`, `D16`, `D19` | API conformance — `ACT-API-017` | Planned |
| `API-018` | §11.1 | Every response containing provider offerings shall preserve equal factual records without a… | `D09`, `D16`, `D19` | API conformance — `ACT-API-018` | Planned |
| `API-019` | §11.1 | API terms of use and dataset-use terms shall be published before release and kept distinct from the… | `D09`, `D16`, `D19` | API conformance — `ACT-API-019` | Planned |
| `API-020` | §11.2 | Public API requests shall be rate-limited primarily by a documented, versioned source-address keying policy… | `D09`, `D12`, `D13`, `D15`, `D16`, `D19` | API conformance — `ACT-API-020` | Planned |
| `API-021` | §11.2 | Limits may differ by resource cost, with tighter controls on semantic search than cacheable detail reads. | `D09`, `D12`, `D13`, `D15`, `D16`, `D19` | API conformance — `ACT-API-021` | Planned |
| `API-022` | §11.2 | Rate-limited responses shall use HTTP 429 and include a retry indication. | `D09`, `D12`, `D13`, `D15`, `D16`, `D19` | API conformance — `ACT-API-022` | Planned |
| `API-023` | §11.2 | Rate limiting shall be treated as abuse/cost protection rather than exact billing accounting. Cloudflare’s… | `D09`, `D12`, `D13`, `D15`, `D16`, `D19` | API conformance — `ACT-API-023` | Planned |
| `API-024` | §11.2 | Every public API request, including a cache hit, shall execute the applicable Worker rate-limit and… | `D09`, `D12`, `D13`, `D15`, `D16`, `D19` | API conformance — `ACT-API-024` | Planned |
| `API-024A` | §11.2 | After rate-limit and validation checks, cacheable anonymous responses shall be served from Cloudflare… | `D09`, `D12`, `D13`, `D15`, `D16`, `D19` | API conformance — `ACT-API-024A`; ADR 0013 local helpers | Planned |
| `API-025` | §11.2 | The system shall support operator-configurable per-request ceilings for CPU time, subrequests, result count,… | `D09`, `D12`, `D13`, `D15`, `D16`, `D19` | API conformance — `ACT-API-025` | Planned |
| `API-026` | §11.2 | Abuse/cost protection without application-stored visitor events, identifiers, queries, or traffic telemetry | `D09`, `D12`, `D13`, `D15`, `D16`, `D19` | API conformance — `ACT-API-026` | Planned |
| `API-027` | §11.2 | The initial capacity target shall support at least 10,000 API requests per month in addition to… | `D09`, `D12`, `D13`, `D15`, `D16`, `D19` | API conformance — `ACT-API-027` | Planned |

### Data sourcing and publication pipeline

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `PIPE-001` | §12 | Automated refreshes shall begin every Monday and Thursday on a configurable UTC schedule. | `D08`, `D12`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-001` | Planned |
| `PIPE-002` | §12 | The configured schedule and its human-readable timezone interpretation shall be documented operationally. | `D08`, `D12`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-002` | Planned |
| `PIPE-003` | §12 | A scheduled run shall create an immutable run identifier and record its scheduled time, actual start/end,… | `D08`, `D12`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-003`; [local kernel evidence](phase-3-local-kernels.md) | Planned |
| `PIPE-004` | §12 | Concurrent runs for the same provider shall be prevented or made safely idempotent. | `D08`, `D12`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-004`; [local kernel evidence](phase-3-local-kernels.md) | Planned |
| `PIPE-005` | §12 | Provider failures shall be isolated so one provider cannot prevent successful providers from publishing. | `D08`, `D12`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-005`; [local kernel evidence](phase-3-local-kernels.md) | Planned |
| `PIPE-006` | §12 | Long-running retrieval and AI-extraction work shall be durable across transient failures and platform restarts. | `D08`, `D12`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-006`; local reducer only, runtime proof pending | Planned |
| `PIPE-007` | §12 | Retries shall use bounded exponential backoff with provider-specific limits and shall honor Retry-After and… | `D08`, `D12`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-007`; [local kernel evidence](phase-3-local-kernels.md) | Planned |
| `PIPE-008` | §12 | Repeated permanent failures shall enter quarantine without infinite retries or blocking the global run. | `D08`, `D12`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-008`; [local kernel evidence](phase-3-local-kernels.md) | Planned |
| `PIPE-010` | §12 | Each provider shall be integrated through an independently deployable/configurable logical adapter… | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-010`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `PIPE-011` | §12 | Adding a provider shall not require changing canonical model, offering, price, precision, or evidence… | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-011` | Planned |
| `PIPE-012` | §12 | An adapter shall declare source endpoints, required credentials, retrieval method, expected precision… | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-012`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `PIPE-013` | §12 | Source URLs shall be operator-configured or allowlisted. No public user input may cause the pipeline to… | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-013`; [local kernel evidence](phase-3-local-kernels.md) | Planned |
| `PIPE-014` | §12 | Adapters shall support provider APIs, authenticated model catalogs, public static pages, public… | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-014` | Planned |
| `PIPE-015` | §12 | API and structured catalog sources shall be preferred over page scraping when they expose the same fact more… | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-015` | Planned |
| `PIPE-016` | §12 | Browser execution shall be used only when required to obtain provider-published facts and shall declare only… | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-016`; local decision only, Browser proof pending | Planned |
| `PIPE-017` | §12 | Adapter fixtures shall contain redacted representative responses for repeatable parser and schema-drift tests. | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-017`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `PIPE-018` | §12 | Provider credentials and affiliate secrets shall never be included in fixtures, logs, model prompts, public… | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-018`; [local kernel evidence](phase-3-local-kernels.md) | Planned |
| `PIPE-019` | §12 | Each provider adapter shall have a version-controlled expected launch roster. Every roster item in a run… | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-019`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `PIPE-020` | §12 | The precedence policy shall be applied per field because a publisher is authoritative for architecture while… | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-020` | Planned |
| `PIPE-021` | §12 | Conflicting lower-precedence facts shall be retained internally for audit and shall not silently overwrite… | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-021` | Planned |
| `PIPE-022` | §12 | When equally authoritative current sources conflict, the affected public field shall become unknown or not… | `D06`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-022` | Planned |
| `PIPE-030` | §12 | AI processing may locate and normalize candidate facts but shall produce schema-constrained structured output. | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-030` | Planned |
| `PIPE-031` | §12 | Prompts shall include only the minimum source content required and shall treat retrieved content as… | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-031`; pre-AI envelope only, AI disabled | Planned |
| `PIPE-032` | §12 | Every AI-extracted value shall retain its source span/locator and extraction model/version for audit. | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-032` | Planned |
| `PIPE-033` | §12 | Deterministic validation shall run after AI extraction and before canonical publication. | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-033` | Planned |
| `PIPE-034` | §12 | AI shall not invent a precision classification when the source is silent; the result must be unknown. | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-034` | Planned |
| `PIPE-035` | §12 | AI shall not perform currency conversion, price blending, quality scoring, or unsupported checkpoint-lineage… | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-035` | Planned |
| `PIPE-036` | §12 | Changing the extraction model or material prompt shall require replay testing against a version-controlled… | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-036` | Planned |
| `PIPE-037` | §12 | AI extraction cost and token usage shall be recorded by provider/run and constrained by configurable per-run… | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-037` | Planned |
| `PIPE-038` | §12 | A single generative extraction from unstructured content shall never become canonical solely because it… | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-038` | Planned |
| `PIPE-039` | §12 | An unstructured public model, checkpoint, architecture, parameter, precision, price, offering, or provider… | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-039` | Planned |
| `PIPE-039A` | §12 | A fact parsed deterministically from a structured authoritative provider or model-publisher source may… | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-039A` | Planned |
| `PIPE-039B` | §12 | Each source type shall have a versioned automated publication policy defining required evidence,… | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-039B` | Planned |
| `PIPE-039C` | §12 | An independent re-extraction path shall use a different extraction model family or a materially independent… | `D07`, `D12`, `D13`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-039C` | Planned |
| `PIPE-040` | §12 | Validation shall check identifiers, enum values, decimal prices, currency codes, price units, parameter… | `D07`, `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-040`; [local kernel evidence](phase-3-local-kernels.md) | Planned |
| `PIPE-041` | §12 | A price change above an operator-configured percentage, precision downgrade/upgrade, model disappearance,… | `D07`, `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-041`; [local kernel evidence](phase-3-local-kernels.md) | Planned |
| `PIPE-042` | §12 | Anomalies shall be automatically re-retrieved from the source before acceptance. | `D07`, `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-042`; local decision only, retrieval pending | Planned |
| `PIPE-043` | §12 | If automated re-verification cannot resolve an anomaly, only the affected records shall be quarantined; the… | `D07`, `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-043`; [local kernel evidence](phase-3-local-kernels.md) | Planned |
| `PIPE-044` | §12 | Validation failures shall never publish partial malformed records or erase the last known good dataset. | `D07`, `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-044`; [local kernel evidence](phase-3-local-kernels.md) | Planned |
| `PIPE-045` | §12 | The pipeline shall provide machine-readable run reports suitable for private operator issue creation or task… | `D07`, `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-045`; [local kernel evidence](phase-3-local-kernels.md) | Planned |
| `PIPE-050` | §12 | Canonical publication shall be versioned and atomic from a public reader’s perspective. | `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-050`; [Phase 4 local evidence](phase-4-local-kernel.md) | Planned |
| `PIPE-051` | §12 | Model/provider data and search indexes shall not expose incompatible dataset versions during a rollout. | `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-051`; [Phase 4 local evidence](phase-4-local-kernel.md) | Planned |
| `PIPE-052` | §12 | The most recent known-good publication shall remain available while a new run is processing or quarantined. | `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-052`; [Phase 4 local evidence](phase-4-local-kernel.md) | Planned |
| `PIPE-053` | §12 | Operators shall be able to roll back to a prior known-good publication without hand-editing individual records. | `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-053`; [Phase 4 local switch plan](phase-4-local-kernel.md), runtime rollback pending | Planned |
| `PIPE-054` | §12 | Every public response shall be traceable to a dataset publication version. | `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-054`; [Phase 4 local normalized-head decision](phase-4-local-kernel.md), public response pending | Planned |
| `PIPE-055` | §12 | Historical observations and evidence shall be retained independently of the current publication view. | `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-055`; [Phase 4 local no-pruning decision](phase-4-local-kernel.md), durable retention pending | Planned |
| `PIPE-056` | §12 | A defective publication shall be removable from public service by rollback to the prior known-good… | `D08`, `D14`, `D16`, `D19` | Pipeline integration — `PIT-PIPE-056`; [Phase 4 local switch plan](phase-4-local-kernel.md), runtime rollback pending | Planned |

### Backend and canonical data

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `BE-001` | §13 | The backend shall separate raw observations, normalized canonical records, historical observations, and… | `D04`, `D05`, `D08`, `D09`, `D14`, `D16`, `D19` | Data integration — `DIT-BE-001` | Planned |
| `BE-002` | §13 | Stable identifiers shall survive provider renames, model display-name changes, price changes, and source-URL… | `D04`, `D05`, `D08`, `D09`, `D14`, `D16`, `D19` | Data integration — `DIT-BE-002` | Planned |
| `BE-003` | §13 | All write operations shall originate from controlled pipeline/deployment identities; the public Worker API… | `D04`, `D05`, `D08`, `D09`, `D14`, `D16`, `D19` | Data integration — `DIT-BE-003` | Planned |
| `BE-004` | §13 | Canonical writes shall be idempotent using run, provider, offering, observation, and evidence identifiers. | `D04`, `D05`, `D08`, `D09`, `D14`, `D16`, `D19` | Data integration — `DIT-BE-004` | Planned |
| `BE-005` | §13 | Data constraints shall prevent orphan offerings, prices without offerings, evidence without observations,… | `D04`, `D05`, `D08`, `D09`, `D14`, `D16`, `D19` | Data integration — `DIT-BE-005` | Planned |
| `BE-006` | §13 | Historical data shall be append-oriented; corrections shall create superseding facts with audit linkage… | `D04`, `D05`, `D08`, `D09`, `D14`, `D16`, `D19` | Data integration — `DIT-BE-006` | Planned |
| `BE-007` | §13 | Read paths shall support model-first pages without N+1 provider/source retrieval at request time. | `D04`, `D05`, `D08`, `D09`, `D14`, `D16`, `D19` | Data integration — `DIT-BE-007` | Planned |
| `BE-008` | §13 | Provider source APIs shall never be called synchronously on behalf of a public page or API request. Public… | `D04`, `D05`, `D08`, `D09`, `D14`, `D16`, `D19` | Data integration — `DIT-BE-008` | Planned |
| `BE-009` | §13 | Large raw evidence objects shall not be loaded into memory on public request paths. | `D04`, `D05`, `D08`, `D09`, `D14`, `D16`, `D19` | Data integration — `DIT-BE-009` | Planned |
| `BE-010` | §13 | Backups or point-in-time recovery shall cover canonical and operational data with a recovery point objective… | `D04`, `D05`, `D08`, `D09`, `D14`, `D16`, `D19` | Data integration — `DIT-BE-010`; [Phase 4 local backup-manifest decision](phase-4-local-kernel.md), RPO/RTO exercise pending | Planned |
| `BE-011` | §13 | Search indexes shall be reproducible from canonical publication data and shall not be the sole store of any… | `D04`, `D05`, `D08`, `D09`, `D14`, `D16`, `D19` | Data integration — `DIT-BE-011`; [Phase 4 local evidence](phase-4-local-kernel.md) | Planned |
| `BE-012` | §13 | Data export shall support complete operator-controlled backup and migration away from Cloudflare without… | `D04`, `D05`, `D08`, `D09`, `D14`, `D16`, `D19` | Data integration — `DIT-BE-012`; [Phase 4 local manifest decision](phase-4-local-kernel.md), portable export/restore pending | Planned |

### Cloudflare platform

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `CF-001` | §14 | The public frontend shall deploy as Astro SSR on Cloudflare Workers with Static Assets and support a custom subdomain… | `D04`, `D12`, `D13`, `D16`, `D18`, `D19` | Platform/operational — `POT-CF-001` | Planned |
| `CF-002` | §14 | The public API shall run behind a Cloudflare Worker. | `D04`, `D12`, `D13`, `D16`, `D18`, `D19` | Platform/operational — `POT-CF-002` | Planned |
| `CF-003` | §14 | Semantic search shall use Cloudflare Vectorize directly or a Cloudflare managed search product whose vector… | `D04`, `D12`, `D13`, `D16`, `D18`, `D19` | Platform/operational — `POT-CF-003` | Planned |
| `CF-004` | §14 | Ancillary managed application capabilities shall be selected from Cloudflare-native products. Permitted… | `D04`, `D12`, `D13`, `D16`, `D18`, `D19` | Platform/operational — `POT-CF-004` | Planned |
| `CF-005` | §14 | Production and preview environments shall use separate data/search bindings or otherwise prevent preview… | `D04`, `D12`, `D13`, `D16`, `D18`, `D19` | Platform/operational — `POT-CF-005` | Planned |
| `CF-006` | §14 | Infrastructure, bindings, schedules, compatibility dates, secrets references, and environments shall be… | `D04`, `D12`, `D13`, `D16`, `D18`, `D19` | Platform/operational — `POT-CF-006` | Planned |
| `CF-007` | §14 | Secrets shall use Cloudflare secret facilities and least-privilege credentials; plaintext configuration and… | `D04`, `D12`, `D13`, `D16`, `D18`, `D19` | Platform/operational — `POT-CF-007` | Planned |
| `CF-008` | §14 | Public static assets and API responses shall use Cloudflare caching with explicit invalidation/version… | `D04`, `D12`, `D13`, `D16`, `D18`, `D19` | Platform/operational — `POT-CF-008` | Planned |
| `CF-009` | §14 | External AI inference may be used only when a documented Workers AI evaluation fails the required extraction… | `D04`, `D12`, `D13`, `D16`, `D18`, `D19` | Platform/operational — `POT-CF-009` | Planned |
| `CF-020` | §14 | The solution design shall verify all current Cloudflare product limits and prices at implementation and… | `D12`, `D15`, `D16`, `D19` | Platform/operational — `POT-CF-020` | Planned |
| `CF-021` | §14 | Pipeline batches, vector mutations, metadata indexes, query result counts, and Worker resource ceilings… | `D12`, `D15`, `D16`, `D19` | Platform/operational — `POT-CF-021` | Planned |
| `CF-022` | §14 | The system shall tolerate eventual visibility of vector-index mutations and shall not mark a dataset… | `D12`, `D15`, `D16`, `D19` | Platform/operational — `POT-CF-022`; [Phase 4 local receipt decision](phase-4-local-kernel.md), Vectorize visibility pending | Planned |
| `CF-023` | §14 | Before release, every Worker shall have documented CPU-time ceilings configured through Cloudflare where… | `D12`, `D15`, `D16`, `D19` | Platform/operational — `POT-CF-023` | Planned |
| `CF-024` | §14 | Platform usage alerts shall cover Worker requests/CPU, AI inference, Vectorize queries/storage, browser… | `D12`, `D15`, `D16`, `D19` | Platform/operational — `POT-CF-024` | Planned |
| `CF-025` | §14 | Before implementation approval, projected base and worst-case monthly cost at stated and tenfold load shall… | `D12`, `D15`, `D16`, `D19` | Platform/operational — `POT-CF-025` | Planned |

### Performance, reliability, and scalability

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `NFR-001` | §15 | Cached detail p95 ≤200 ms in the approved controlled load profile | `D14`, `D15`, `D16`, `D19` | Performance/reliability — `PRT-NFR-001` | Planned |
| `NFR-002` | §15 | Uncached browse/detail p95 ≤500 ms in the approved controlled load profile | `D14`, `D15`, `D16`, `D19` | Performance/reliability — `PRT-NFR-002` | Planned |
| `NFR-003` | §15 | Search p95 ≤1,000 ms in the approved controlled load profile | `D14`, `D15`, `D16`, `D19` | Performance/reliability — `PRT-NFR-003` | Planned |
| `NFR-004` | §15 | Synthetic/lab Core Web Vitals target without field visitor telemetry | `D14`, `D15`, `D16`, `D19` | Performance/reliability — `PRT-NFR-004` | Planned |
| `NFR-005` | §15 | The public read service shall target 99.9% monthly availability; data-pipeline availability is measured… | `D14`, `D15`, `D16`, `D19` | Performance/reliability — `PRT-NFR-005` | Planned |
| `NFR-006` | §15 | Failure of semantic search shall degrade to exact/structured discovery where feasible rather than make model… | `D14`, `D15`, `D16`, `D19` | Performance/reliability — `PRT-NFR-006` | Planned |
| `NFR-007` | §15 | Synthetic-monitoring, referral, or evidence-preview failure shall not block core pages | `D14`, `D15`, `D16`, `D19` | Performance/reliability — `PRT-NFR-007` | Planned |
| `NFR-008` | §15 | The product shall scale from the initial 4 providers/approximately 80 offerings to at least 100 providers… | `D14`, `D15`, `D16`, `D19` | Performance/reliability — `PRT-NFR-008` | Planned |
| `NFR-009` | §15 | Provider adapters may be added independently and enabled gradually. | `D14`, `D15`, `D16`, `D19` | Performance/reliability — `PRT-NFR-009` | Planned |
| `NFR-010` | §15 | All production timestamps shall be stored and returned in UTC with explicit offsets; display localization… | `D14`, `D15`, `D16`, `D19` | Performance/reliability — `PRT-NFR-010` | Planned |

### Accessibility

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `A11Y-001` | §16 | Production pages shall conform to WCAG 2.2 Level AA. WCAG 2.2 is a W3C Recommendation and Level AA requires… | `D11`, `D16`, `D19` | Accessibility — `AAT-A11Y-001` | Planned |
| `A11Y-002` | §16 | All search, filters, sorting, comparison selection, disclosures, evidence expansion, and navigation shall be… | `D11`, `D16`, `D19` | Accessibility — `AAT-A11Y-002` | Planned |
| `A11Y-003` | §16 | Focus shall be visible and not obscured; minimum target sizes and non-drag alternatives shall follow WCAG… | `D11`, `D16`, `D19` | Accessibility — `AAT-A11Y-003` | Planned |
| `A11Y-004` | §16 | Data tables shall use semantic headers, captions/descriptions, logical focus order, and accessible… | `D11`, `D16`, `D19` | Accessibility — `AAT-A11Y-004` | Planned |
| `A11Y-005` | §16 | Precision, price, stale, promotional, affiliate, and unknown states shall have text equivalents. | `D11`, `D16`, `D19` | Accessibility — `AAT-A11Y-005` | Planned |
| `A11Y-006` | §16 | Automated accessibility checks shall run in CI, supplemented by keyboard and screen-reader acceptance… | `D11`, `D16`, `D19` | Accessibility — `AAT-A11Y-006` | Planned |
| `A11Y-007` | §16 | Reduced-motion and high-contrast user preferences shall be respected. | `D11`, `D16`, `D19` | Accessibility — `AAT-A11Y-007` | Planned |

### Security and abuse

[Phase 5A](phase-5a-local-api-kernel.md) contributes local negative-capability and bounds targets to `SEC-001`, `SEC-007`, and `SEC-011`; deployed penetration, platform-limit, and zero-visitor-data evidence remains required and the rows stay `Planned`.

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `SEC-001` | §17 | The public Worker shall expose no data mutation, pipeline trigger, credential validation, or privileged… | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-001` | Planned |
| `SEC-002` | §17 | Pipeline triggers and operator-control APIs shall be inaccessible from the public application and protected… | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-002` | Planned |
| `SEC-003` | §17 | All provider and affiliate credentials shall be least-privilege, rotatable, environment-scoped, and excluded… | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-003` | Planned |
| `SEC-004` | §17 | Source retrieval shall enforce scheme, host, redirect, DNS/IP, and response-size policies to prevent SSRF… | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-004` | Planned |
| `SEC-005` | §17 | Retrieved HTML, Markdown, JSON, model descriptions, and provider strings shall be treated as untrusted and… | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-005` | Planned |
| `SEC-006` | §17 | AI extraction shall defend against prompt injection from provider pages by separating system instructions… | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-006` | Planned |
| `SEC-007` | §17 | API query length, filter count, page size, semantic-search cost, and response size shall have explicit bounds. | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-007` | Planned |
| `SEC-008` | §17 | Security headers shall include an appropriately strict Content Security Policy, HSTS, MIME sniffing… | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-008` | Planned |
| `SEC-009` | §17 | External links shall prevent opener access; affiliate links shall also be marked for sponsored/nofollow… | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-009` | Planned |
| `SEC-010` | §17 | Dependency, secret, and known-vulnerability scanning shall run in CI. Critical production vulnerabilities… | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-010` | Planned |
| `SEC-011` | §17 | No visitor network/request data in any QuantClarity sink; no incident exception | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-011` | Planned |
| `SEC-012` | §17 | Backup and evidence access shall be restricted to operator identities and audited. | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-012` | Planned |
| `SEC-013` | §17 | A documented incident procedure shall cover credential exposure, source poisoning, erroneous mass… | `D03`, `D06`, `D07`, `D09`, `D12`, `D13`, `D16`, `D19` | Security — `SST-SEC-013` | Planned |

### Privacy

[Phase 5A](phase-5a-local-api-kernel.md) contributes local decision targets to `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, and `PRIV-011`. It creates no legal or deployed privacy evidence and does not advance these rows beyond `Planned`.

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `PRIV-001` | §18.1 | QuantClarity shall not create user accounts, profiles, cross-site identifiers, behavioral segments, or… | `D11`, `D13`, `D16`, `D19` | Privacy — `PVT-PRIV-001` | Planned |
| `PRIV-002` | §18.1 | No visitor analytics, request telemetry, beacons, replay, advertising measurement, or fingerprinting | `D11`, `D13`, `D16`, `D19` | Privacy — `PVT-PRIV-002` | Planned |
| `PRIV-003` | §18.1 | No cookies or visitor-specific browser persistence; identical public HTTP caching only | `D11`, `D13`, `D16`, `D19` | Privacy — `PVT-PRIV-003` | Planned |
| `PRIV-004` | §18.1 | Source addresses are transient abuse inputs and never persisted or repurposed | `D09`, `D13`, `D16`, `D19` | Privacy — `PVT-PRIV-004` | Planned |
| `PRIV-005` | §18.1 | GDPR-complete privacy notice describing zero storage and necessary Cloudflare processing | `D11`, `D13`, `D16`, `D19` | Privacy — `PVT-PRIV-005` | Planned |
| `PRIV-006` | §18.1 | No raw visitor input retention; only path-only canonical detail caching by publication and stable ID | `D09`, `D11`, `D13`, `D16`, `D19` | Privacy — `PVT-PRIV-006`; ADR 0013 local helpers | Planned |
| `PRIV-007` | §18.1 | Privacy by design/default and a blocking zero-visitor-data gate | `D12`, `D13`, `D16`, `D19` | Privacy — `PVT-PRIV-007` | Planned |
| `PRIV-008` | §18.1 | Current Cloudflare DPA, transfers, subprocessors, and data-location review | `D13`, `D16`, `D19` | Privacy — `PVT-PRIV-008` | Planned |
| `PRIV-009` | §18.1 | Record of processing and documented GDPR role/duty determinations | `D13`, `D16`, `D19` | Privacy — `PVT-PRIV-009` | Planned |
| `PRIV-010` | §18.1 | Formal rights procedure without collecting identity merely to create a visitor record | `D13`, `D16`, `D19` | Privacy — `PVT-PRIV-010` | Planned |
| `PRIV-011` | §18.1 | Synthetic-only public monitoring; non-visitor control-plane observability | `D12`, `D13`, `D14`, `D16`, `D19` | Privacy — `PVT-PRIV-011` | Planned |
| `PRIV-012` | §18.1 | Static referral IDs only; no click/pixel/cookie/callback tracking | `D11`, `D13`, `D16`, `D19` | Privacy — `PVT-PRIV-012` | Planned |

### Affiliate monetization

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `AFF-001` | §18.2 | Affiliate relationships may be added per provider without altering canonical provider/offering records. | `D03`, `D11`, `D13`, `D16`, `D19` | Affiliate neutrality — `ANT-AFF-001` | Planned |
| `AFF-002` | §18.2 | A clear disclosure such as “We may earn a commission if you sign up through this link” shall appear adjacent… | `D03`, `D11`, `D13`, `D16`, `D19` | Affiliate neutrality — `ANT-AFF-002` | Planned |
| `AFF-003` | §18.2 | The disclosure shall be understandable without relying on the phrase “affiliate link” alone. FTC guidance… | `D03`, `D11`, `D13`, `D16`, `D19` | Affiliate neutrality — `ANT-AFF-003` | Planned |
| `AFF-004` | §18.2 | Affiliate availability, expected commission, or rate shall not affect inclusion, search relevance,… | `D03`, `D11`, `D13`, `D16`, `D19` | Affiliate neutrality — `ANT-AFF-004` | Planned |
| `AFF-005` | §18.2 | The canonical provider URL and the affiliate destination shall be stored separately. | `D03`, `D11`, `D13`, `D16`, `D19` | Affiliate neutrality — `ANT-AFF-005` | Planned |
| `AFF-006` | §18.2 | Direct exact-allowlisted no-referrer destinations with no tracking redirect or visitor identifier | `D03`, `D11`, `D13`, `D16`, `D19` | Affiliate neutrality — `ANT-AFF-006` | Planned |
| `AFF-007` | §18.2 | Programs requiring visitor tracking are prohibited | `D03`, `D11`, `D13`, `D16`, `D19` | Affiliate neutrality — `ANT-AFF-007` | Planned |
| `AFF-008` | §18.2 | Affiliate revenue is incidental expense recovery only. The absence, reduction, or loss of affiliate revenue… | `D03`, `D11`, `D13`, `D16`, `D19` | Affiliate neutrality — `ANT-AFF-008` | Planned |

### Source and publication compliance

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `LEG-001` | §18.3 | Each provider adapter shall document lawful access method, relevant terms, robots behavior, Content… | `D06`, `D11`, `D13`, `D16`, `D19` | Legal/compliance — `LCT-LEG-001`; pending Fireworks register | Planned |
| `LEG-002` | §18.3 | The public product shall republish normalized facts and brief necessary evidence, not substantial… | `D06`, `D11`, `D13`, `D16`, `D19` | Legal/compliance — `LCT-LEG-002`; synthetic fixture boundary | Planned |
| `LEG-003` | §18.3 | Provider and model trademarks shall be used descriptively with a general non-affiliation notice. | `D06`, `D11`, `D13`, `D16`, `D19` | Legal/compliance — `LCT-LEG-003` | Planned |
| `LEG-004` | §18.3 | Claims shall be neutrally worded and directly supported; the product shall not characterize conduct as… | `D06`, `D11`, `D13`, `D16`, `D19` | Legal/compliance — `LCT-LEG-004` | Planned |
| `LEG-005` | §18.3 | A legal-contact mechanism may exist for formal notices while no general user feedback, correction, comment,… | `D06`, `D11`, `D13`, `D16`, `D19` | Legal/compliance — `LCT-LEG-005` | Planned |
| `LEG-006` | §18.3 | Terms shall explain that prices and deployments can change, users should verify before purchase, and… | `D06`, `D11`, `D13`, `D16`, `D19` | Legal/compliance — `LCT-LEG-006` | Planned |
| `LEG-007` | §18.3 | Domain and trademark clearance for “QuantClarity” shall be completed before public branding is finalized.… | `D06`, `D11`, `D13`, `D16`, `D19` | Legal/compliance — `LCT-LEG-007` | Planned |

### Open source and repository

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `OSS-001` | §19 | Frontend, API, provider-adapter framework, extraction orchestration, validation, and deployment code shall… | `D13`, `D16`, `D18`, `D19` | Repository compliance — `RCT-OSS-001` | Planned |
| `OSS-002` | §19 | **Recommended license:** MPL-2.0 for code. It keeps modifications to covered source files available while… | `D13`, `D16`, `D18`, `D19` | Repository compliance — `RCT-OSS-002` | Planned |
| `OSS-003` | §19 | Dataset licensing shall be evaluated separately from code licensing; raw authenticated evidence shall not be… | `D13`, `D16`, `D18`, `D19` | Repository compliance — `RCT-OSS-003` | Planned |
| `OSS-004` | §19 | The public repository shall have GitHub Issues and Discussions disabled and shall not advertise a… | `D13`, `D16`, `D18`, `D19` | Repository compliance — `RCT-OSS-004` | Planned |
| `OSS-005` | §19 | Private work tracking shall use a separate private repository or private project visible only to operators. | `D13`, `D16`, `D18`, `D19` | Repository compliance — `RCT-OSS-005` | Planned |
| `OSS-006` | §19 | The public repository shall not solicit pull requests or promise review/support; the README shall state the… | `D13`, `D16`, `D18`, `D19` | Repository compliance — `RCT-OSS-006` | Planned |
| `OSS-007` | §19 | Repository history, examples, fixtures, CI logs, and build artifacts shall be scanned for provider… | `D13`, `D16`, `D18`, `D19` | Repository compliance — `RCT-OSS-007` | Planned |

### Observability and operations

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `OPS-001` | §20 | Correlation IDs only for control-plane/synthetic work, never retained live requests | `D12`, `D14`, `D16`, `D19` | Operational/recovery — `ORT-OPS-001` | Planned |
| `OPS-002` | §20 | Synthetic and non-visitor pipeline metrics only | `D12`, `D14`, `D16`, `D19` | Operational/recovery — `ORT-OPS-002` | Planned |
| `OPS-003` | §20 | Control-plane logs/traces only; public surface observability disabled | `D12`, `D14`, `D16`, `D19` | Operational/recovery — `ORT-OPS-003` | Planned |
| `OPS-004` | §20 | Alerts shall cover public availability, scheduled-run failure, provider-wide schema drift, publication… | `D12`, `D14`, `D16`, `D19` | Operational/recovery — `ORT-OPS-004` | Planned |
| `OPS-005` | §20 | Provider-specific failure dashboards or queries shall make it possible to add providers one at a time and… | `D12`, `D14`, `D16`, `D19` | Operational/recovery — `ORT-OPS-005` | Planned |
| `OPS-006` | §20 | Runbooks shall cover adding a provider, rotating credentials, handling provider schema changes, quarantining… | `D12`, `D14`, `D16`, `D19` | Operational/recovery — `ORT-OPS-006` | Planned |
| `OPS-007` | §20 | No operational system shall create public GitHub issues or expose private stack traces/configuration to API… | `D12`, `D14`, `D16`, `D19` | Operational/recovery — `ORT-OPS-007` | Planned |
| `OPS-008` | §20 | A twice-yearly disaster-recovery exercise shall verify restoration of canonical data, evidence links, and… | `D12`, `D14`, `D16`, `D19` | Operational/recovery — `ORT-OPS-008` | Planned |

### Testing and quality

[Phase 5A](phase-5a-local-api-kernel.md) defines local targets contributing to `QA-004`–`QA-006` and `QA-014`; complete API, search, publication, cache, abuse, and multi-PoP artifacts are still pending.

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| `QA-001` | §21 | Unit tests shall cover normalization, precision parsing, lineage rules, currency handling, neutral… | `D16`, `D19` | Quality-gate audit — `QGA-QA-001`; [Phase 2 evidence](phase-2-implementation.md) | Implemented |
| `QA-002` | §21 | Contract tests shall run each provider adapter against redacted fixtures and detect source-schema drift. | `D16`, `D19` | Quality-gate audit — `QGA-QA-002` | Planned |
| `QA-003` | §21 | End-to-end tests shall cover all primary user journeys without authentication. | `D16`, `D19` | Quality-gate audit — `QGA-QA-003` | Planned |
| `QA-004` | §21 | API conformance tests shall validate OpenAPI examples, pagination, filters, sorting, caching, CORS, nulls,… | `D16`, `D19` | Quality-gate audit — `QGA-QA-004` | Planned |
| `QA-005` | §21 | Search tests shall cover exact IDs, aliases, provider names, precision phrases, natural-language intent,… | `D16`, `D19` | Quality-gate audit — `QGA-QA-005` | Planned |
| `QA-006` | §21 | Publication tests shall prove that failed or partial runs cannot replace the last known-good dataset. | `D16`, `D19` | Quality-gate audit — `QGA-QA-006`; [Phase 4 local evidence](phase-4-local-kernel.md) | Planned |
| `QA-007` | §21 | Security tests shall cover SSRF, redirect handling, stored/script injection from source data, prompt… | `D16`, `D19` | Quality-gate audit — `QGA-QA-007` | Planned |
| `QA-008` | §21 | Performance tests shall validate initial load plus a tenfold traffic scenario and worst-case model pages… | `D16`, `D19` | Quality-gate audit — `QGA-QA-008` | Planned |
| `QA-009` | §21 | Accessibility tests shall include automation plus manual keyboard, focus, zoom, color-independent state,… | `D16`, `D19` | Quality-gate audit — `QGA-QA-009` | Planned |
| `QA-010` | §21 | A golden dataset shall encode known cases including canonical-versus-explicit variants, BF16/FP8/FP4… | `D16`, `D19` | Quality-gate audit — `QGA-QA-010`; synthetic case matrix | Planned |
| `QA-011` | §21 | Before production use, each extraction-policy version shall achieve 100% precision (no unsupported published… | `D16`, `D19` | Quality-gate audit — `QGA-QA-011` | Planned |
| `QA-012` | §21 | Golden tests shall prove that a provider-catalog base-model object’s default_precision value is not… | `D16`, `D19` | Quality-gate audit — `QGA-QA-012`; Fireworks negative fixture | Implemented |
| `QA-013` | §21 | Search acceptance shall use version-controlled sets meeting the size and top-result/top-10 criteria in SM-06… | `D16`, `D19` | Quality-gate audit — `QGA-QA-013` | Planned |
| `QA-014` | §21 | Rate-limit acceptance shall exercise the documented IPv4/IPv6 keying policy against normal shared-network,… | `D16`, `D19` | Quality-gate audit — `QGA-QA-014` | Planned |

### Release acceptance

| Source ID | PRD | Requirement summary | Planned design sections | Planned coordinator and concrete verification evidence | Status |
|---|---|---|---|---|---|
| `REL-AC-01` | §22 | A version-controlled launch roster identifies exactly four enabled providers and a default minimum of 20… | `D06`, `D17`, `D19` | Release coordinator — `RGA-REL-AC-01`; concrete evidence — `PIT-PIPE-019`, `QGA-QA-002` | Planned |
| `REL-AC-02` | §22 | Every roster item has reached a terminal published, unavailable, quarantined, or failed state with evidence,… | `D06`, `D08`, `D17`, `D19` | Release coordinator — `RGA-REL-AC-02`; concrete evidence — `PIT-PIPE-003`, `PIT-PIPE-005`, `PIT-PIPE-019`, `MET-SM-11` | Planned |
| `REL-AC-03` | §22 | Every non-null fact displayed on a model card, Model Facts label, provider-offering comparison, Offering… | `D05`, `D07`, `D11`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-03`; concrete evidence — `CT-DATA-060`, `MET-SM-02`, `MET-SM-03`, `MET-SM-13` | Planned |
| `REL-AC-04` | §22 | The canonical-versus-explicit-variant rules pass the golden dataset. | `D05`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-04`; concrete evidence — `UT-RULE-001`, `UT-RULE-002`, `UT-RULE-003`, `UT-RULE-004`, `QGA-QA-010` | Planned |
| `REL-AC-05` | §22 | Exact-offering applicability tests prove that precision is attached only to the provider model ID, tier,… | `D05`, `D06`, `D07`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-05`; concrete evidence — `CT-DATA-051`, `QGA-QA-010`, `QGA-QA-012` | Planned |
| `REL-AC-06` | §22 | Model cards contain model facts only; provider-filtered searches change only which model cards qualify and… | `D10`, `D11`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-06`; concrete evidence — `E2E-FE-023`, `E2E-FE-025`, `E2E-FE-026`, `ANT-AFF-004` | Planned |
| `REL-AC-07` | §22 | Model detail pages show no provider winner, recommendation, preferred-provider list, or computed “best”… | `D11`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-07`; concrete evidence — `UT-RULE-010`, `UT-RULE-011`, `UT-RULE-012`, `E2E-FE-034`, `E2E-FE-035`, `MET-SM-10` | Planned |
| `REL-AC-08` | §22 | Input, output, and cached-input prices remain separate. Standard, conditional, tiered, promotional, and… | `D05`, `D11`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-08`; concrete evidence — `CT-DATA-040`, `CT-DATA-048`, `CT-DATA-055`, `CT-DATA-056`, `CT-DATA-057`, `CT-DATA-058`, `QGA-QA-010` | Planned |
| `REL-AC-09` | §22 | The extraction policy meets the precision and recall thresholds in QA-011 on the approved golden dataset. | `D07`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-09`; concrete evidence — `PIT-PIPE-036`, `QGA-QA-011` | Planned |
| `REL-AC-10` | §22 | The Monday/Thursday pipeline has completed successfully in production for at least two consecutive weeks. | `D08`, `D14`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-10`; concrete evidence — `PIT-PIPE-001`, `MET-SM-01`, `MET-SM-11`, `ORT-OPS-004` | Planned |
| `REL-AC-11` | §22 | A failed-provider simulation leaves other providers publishable and preserves the failed provider’s last… | `D08`, `D14`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-11`; concrete evidence — `PIT-PIPE-005`, `PIT-PIPE-043`, `PIT-PIPE-052`, `QGA-QA-006` | Planned |
| `REL-AC-12` | §22 | Website and API use the same publication version. | `D08`, `D09`, `D11`, `D19` | Release coordinator — `RGA-REL-AC-12`; concrete evidence — `PIT-PIPE-050`, `PIT-PIPE-051`, `PIT-PIPE-054`, `ACT-API-003`, `QGA-QA-006` | Planned |
| `REL-AC-13` | §22 | The exact, semantic, filter, and facet search targets in SM-06, SM-12, and QA-013 pass against the approved… | `D10`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-13`; concrete evidence — `MET-SM-06`, `MET-SM-12`, `QGA-QA-013` | Planned |
| `REL-AC-14` | §22 | Public API rate limiting, caching, CORS, OpenAPI documentation, and cost ceilings are enabled. | `D09`, `D12`, `D13`, `D15`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-14`; concrete evidence — `ACT-API-011`, `ACT-API-012`, `ACT-API-014`, `ACT-API-020`, `ACT-API-024`, `ACT-API-024A`, `ACT-API-025`, `MET-SM-09`, `POT-CF-025` | Planned |
| `REL-AC-15` | §22 | Production and preview environments are isolated; preview pages are verified non-indexable. | `D12`, `D13`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-15`; concrete evidence — `POT-CF-005`, `E2E-FE-063` | Planned |
| `REL-AC-16` | §22 | WCAG 2.2 AA acceptance checks pass for primary journeys. | `D11`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-16`; concrete evidence — `MET-SM-07`, `AAT-A11Y-001`, `QGA-QA-009` | Planned |
| `REL-AC-17` | §22 | Core Web Vitals and API latency targets pass the approved version-controlled mobile, desktop, API, search,… | `D11`, `D15`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-17`; concrete evidence — `MET-SM-08`, `PRT-NFR-001`, `PRT-NFR-002`, `PRT-NFR-003`, `PRT-NFR-004`, `QGA-QA-008` | Planned |
| `REL-AC-18` | §22 | Affiliate disclosures are adjacent to every monetized link, and tests confirm that affiliate availability or… | `D11`, `D13`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-18`; concrete evidence — `ANT-AFF-002`, `ANT-AFF-003`, `ANT-AFF-004`, `MET-SM-10` | Planned |
| `REL-AC-19` | §22 | Zero visitor data/telemetry gate and required privacy/GDPR/legal surfaces pass | `D11`, `D12`, `D13`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-19`; concrete evidence — `SST-SEC-011`, `PVT-PRIV-001`–`PVT-PRIV-012`, `LCT-LEG-005`, `LCT-LEG-006` | Planned |
| `REL-AC-20` | §22 | Public GitHub Issues and Discussions are disabled; private work tracking exists separately. | `D13`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-20`; concrete evidence — `RCT-OSS-004`, `RCT-OSS-005`, `RCT-OSS-006` | Planned |
| `REL-AC-21` | §22 | Backup, rollback, and search rebuild procedures have been executed successfully. | `D10`, `D14`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-21`; concrete evidence — `DIT-BE-010`, `DIT-BE-011`, `PIT-PIPE-053`, `ORT-OPS-006`, `ORT-OPS-008` | Planned |
| `REL-AC-22` | §22 | API terms and dataset-use terms are published separately from the source-code license. | `D09`, `D13`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-22`; concrete evidence — `ACT-API-019`, `RCT-OSS-003`, `LCT-LEG-006` | Planned |
| `REL-AC-23` | §22 | Recovery testing meets the 24-hour RPO/RTO, and publication rollback meets the four-hour rollback requirement. | `D08`, `D14`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-23`; concrete evidence — `DIT-BE-010`, `PIT-PIPE-056`, `ORT-OPS-008` | Planned |
| `REL-AC-24` | §22 | Domain and name clearance are complete, or the product launches under a cleared replacement name. | `D13`, `D16`, `D19` | Release coordinator — `RGA-REL-AC-24`; concrete evidence — `LCT-LEG-007` | Planned |

## Coverage totals

| Source class | Expected | Represented | Current state |
|---|---:|---:|---|
| Normative PRD requirements | 317 | 317 | Planned; not verified |
| Success measures | 13 | 13 | Planned; not verified |
| Derived release-acceptance anchors | 24 | 24 | Planned; not verified |
| **Total** | **354** | **354** | **Planned; not verified** |
