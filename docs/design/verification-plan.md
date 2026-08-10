# Verification and release-gate plan

| Attribute | Value |
|---|---|
| Status | Approved plan; all checks are planned unless an artifact states otherwise |
| Traceability | [`traceability.md`](traceability.md) |
| Parent design | [`system-design.md`](system-design.md) |

Each traceability primary ID becomes a test/report anchor in code or an operational evidence record. This catalog defines the composite gates that turn those anchors into executable release decisions.

## Verification-artifact registry

[`config/verification-artifacts.json`](../../config/verification-artifacts.json) is the versioned machine-readable registry for current local test-source anchors. Its closed v1 schema records only the source ID, primary verification ID, `Implemented` trace status, and exact repository-relative path/criterion pairs. The validator owns the complete 14-entry authority in code; the configuration must match it exactly and therefore cannot authorize itself by relabeling an entry or selecting another artifact. `npm run traceability:check` also requires every current `Implemented` trace row to match that authority and rejects malformed matrix rows, missing or duplicate IDs, source/status drift, unsafe or absent paths, and missing exact test criteria.

Version 1 makes no claim about test execution results or evidence needed beyond local implementation. `Planned` rows need no entry. A `Designed`, `Verified`, `Accepted`, or `Released` row is rejected with a successor-schema requirement; those states need separately designed authorities and cannot be represented by adding fields to this registry. Registry membership does not advance a trace status or pass a composite gate.

[`config/gdpr-accountability.json`](../../config/gdpr-accountability.json) is a separate pending-only readiness manifest, not a verification-artifact entry. Its checker hash-binds the working notice and public-safe accountability drafts, verifies the exact missing-evidence inventory, requires the six mapped rows to remain `Planned`, and rejects approval, release, or compliance claims. A passing `npm run gdpr-accountability:check` means only that the repository is deterministically release-blocked; it is not `GATE-gdpr-accountability` evidence of an authorized decision.

| Gate | Constituent trace IDs | Inputs / environment | Pass/fail assertion | Retained artifact | Owner |
|---|---|---|---|---|---|
| `GATE-applicability-integrity` | `CT-DATA-051`, `QGA-QA-010`, `QGA-QA-012` | Gold fixtures for exact, base-object, alias, tier, class, and region cases; local + preview D1 | No known claim publishes outside an equal/proven applicability tuple; ambiguous cases are unknown/quarantined | JUnit/property report and candidate publication manifest | Data engineering |
| `GATE-publication-chaos` | `PIT-PIPE-050`, `PIT-PIPE-051`, `PIT-PIPE-052`, `PIT-PIPE-053`, `PIT-PIPE-054`, `PIT-PIPE-056`, `QGA-QA-006`, `ACT-API-003` | Candidate/active/rollback publications, populated multi-PoP cache, injected failure at every phase | Readers and SSR/API sequences observe one version; failed candidates never activate; rollback meets four hours | Failure matrix, request transcript, manifests, timing | Reliability |
| `GATE-source-egress-security` | `SST-SEC-004`, `QGA-QA-007`, `PIT-PIPE-013`, `PIT-PIPE-016` | Deployed Worker/Browser Session canary network; encoded IP, redirect, DNS, CNAME, bomb and subresource corpus | Protected canaries are unreachable; only exact declared hosts receive requests/credentials; limits terminate safely | Egress capture, test report, adapter manifest hash | Security |
| `GATE-extraction-adversarial` | `PIT-PIPE-031`, `PIT-PIPE-033`, `PIT-PIPE-034`, `PIT-PIPE-038`, `PIT-PIPE-039`, `QGA-QA-011` | Approved gold set plus prompt-injection/missing-fact/conflict corpus | 100% precision and ≥98% recall; unsupported/conflicting claims never publish | Confusion matrix, policy/model/prompt hashes | Data governance |
| `GATE-evidence-dlp` | `CT-DATA-063`, `SST-SEC-003`, `PVT-PRIV-006`, `RCT-OSS-007` | Seeded bearer token, cookie, email, account ID, query and hidden content through every sink | No canary appears in R2 promoted evidence, logs, traces, AI payload logs, fixtures, public API, or build artifacts | DLP scan, sink inventory, negative search log | Security/privacy |
| `GATE-neutrality-invariance` | `MET-SM-10`, `UT-RULE-011`, `UT-RULE-017`, `ANT-AFF-004`, `E2E-FE-023`, `E2E-FE-025`, `E2E-FE-026` | Permutations of affiliate presence/rate and operator/provider input order | Canonical facts, eligibility, relevance, cards and comparison order are byte-identical except outbound URL/disclosure | Property/snapshot diff report | Product/data governance |
| `GATE-api-abuse` | `ACT-API-020`–`ACT-API-026`, `SST-SEC-007`, `QGA-QA-014` | Controlled IPv4/IPv6 NAT/privacy/rotation, distributed-PoP, cache, query/filter/cursor/response/concurrency tests | Static bounds and transient limiter hold, normal shared cases remain usable, abuse receives 429/retry, exact reads survive semantic disablement, and no live visitor counter is stored | Controlled load/security report and configuration export | API/security |
| `GATE-legal-source-register` | `LCT-LEG-001`, `LCT-LEG-002`, `PIT-PIPE-012`, `PIT-PIPE-016` | Every enabled endpoint/destination and current terms/robots/Content Signals | Signed, unexpired approval exists for access, retention, excerpt/publication, attribution and crawl purpose | Dated register and reviewer approval | Legal/product owner |
| `GATE-restore-and-rebuild` | `DIT-BE-010`, `DIT-BE-011`, `DIT-BE-012`, `PIT-PIPE-053`, `ORT-OPS-006`, `ORT-OPS-008` | Fresh isolated environment, no existing FTS/Vectorize state, and—only if proposed ADR 0045 is product-owner-accepted—protected three-artifact backup-v3 authority | Canonical/public data restore ≤24h; FTS rebuilt; under the accepted recovery decision exact archived Float32 values are restored and fully reread; current query policy either passes all search probes or semantic remains disabled; hashes/evidence links match | Restore transcript, approved manifests, lifecycle receipts, timings | Operations |
| `GATE-manual-a11y` | `MET-SM-07`, `AAT-A11Y-001`–`AAT-A11Y-007`, `QGA-QA-009` | Primary journeys at 320px/desktop, 200%/400%, keyboard, screen readers, contrast/reduced motion | WCAG 2.2 AA checklist passes; every state and interaction remains operable/announced | Signed checklist, automated report, recordings/notes | Accessibility reviewer |
| `GATE-cost-fail-safe` | `MET-SM-09`, `POT-CF-023`, `POT-CF-024`, `POT-CF-025`, `PIT-PIPE-037`, `QGA-QA-008` | Controlled base, tenfold, eight-batch semantic saturation, retry storm, source explosion and full rebuild tests plus account-level billing controls | Projected/test cost is within the accepted envelope; static request ceilings and pipeline admission breakers stop expensive work while last-known-good reads remain healthy; no production visitor counter is created | Cost worksheet, controlled-load metrics, account-control export, pipeline-breaker transcript | Staff engineer/owner |
| `GATE-api-contract` | `ACT-API-001`–`ACT-API-019`, `QGA-QA-004` | Generated OpenAPI, examples, local/preview API | Schema examples, methods, CORS, errors, nulls, decimals, filters/sorts/cursors/cache all conform | OpenAPI validation and conformance report | API engineering |
| `GATE-search-acceptance` | `MET-SM-06`, `MET-SM-12`, `QGA-QA-005`, `QGA-QA-013` | ≥50 exact and ≥50 semantic queries plus selective filter/facet/no-result adversaries | Exact first ≥95%; for at least 95% of semantic queries, every expected model appears in that query's top 10; structured filters 100%, no violation | Versioned set and per-query scored report | Search/data engineering |
| `GATE-provider-launch` | `PIT-PIPE-019`, `MET-SM-11`, `QGA-QA-002`, `LCT-LEG-001` | Four enabled provider rosters and latest production runs | Each meets approved roster minimum/amendment, all items terminal, latest refresh successful, legal register current | Roster/run manifests and approvals | Product/data operations |
| `GATE-repository-release` | `RCT-OSS-004`–`RCT-OSS-007`, `ACT-API-019`, `LCT-LEG-007` | GitHub settings/history, licenses/terms, cleared brand/domain | Issues/Discussions off, no solicited contributions/secrets, code and data/API terms separate, brand cleared | Settings export, scan, legal approvals | Product owner |
| `GATE-environment-isolation` | `POT-CF-005`, `E2E-FE-063` | Inventory and deployed production/preview resources, credentials, routes, search indexes and robots headers | No preview write path/resource/secret reaches production; every preview response is non-indexable | Inventory diff, access probes, header crawl | Platform/security |
| `GATE-performance` | `MET-SM-08`, `PRT-NFR-001`–`PRT-NFR-004`, `QGA-QA-008` | Version-controlled repeated cold/warm mobile/desktop Lighthouse profiles and controlled API/search loads at base, tenfold and worst model page | Every PRD synthetic Core Web Vital and controlled-load API percentile target passes without excluded samples; no field telemetry is used | Lighthouse/load raw results and summary | Performance |
| `GATE-zero-visitor-data` | `SST-SEC-011`, `PVT-PRIV-001`–`PVT-PRIV-007`, `PVT-PRIV-011`, `ACT-API-013`, `ACT-API-026`, `ORT-OPS-001`–`ORT-OPS-003` | Source/bundle/config scan; Cloudflare API/IaC export; browser network/storage capture over success, 404/405/413/429/5xx, abuse and outage paths; seeded IP/query/header/referrer canaries | No `Set-Cookie`, browser storage/service-worker state, analytics/beacon, public log/trace/custom event/Analytics Engine/Logpush/Tail binding, retained request ID, visitor-derived cache key/record, challenge cookie, or canary exists | Signed config export, crawl/network/storage archive, source scan, sink inventory | Privacy/security |
| `GATE-referral-zero-tracking` | `PVT-PRIV-012`, `ANT-AFF-002`–`ANT-AFF-007` | Every configured referral URL, program terms, page disclosure, CSP/referrer headers and browser network capture | Direct static exact-allowlisted destination only; same program ID for all visitors; no redirect, click ID, pixel, callback, cookie, referrer leakage, event, or ranking/fact change | Program review, URL manifest, browser capture, invariance report | Privacy/product owner |
| `GATE-gdpr-accountability` | `PVT-PRIV-005`, `PVT-PRIV-008`–`PVT-PRIV-010`, `SST-SEC-012`, `LCT-LEG-005` | Deployed privacy notice plus authorized controller/contact, DPA/transfer/subprocessor/data-location review, RoPA, lawful-basis/retention/rights/security records, and DPIA/DPO/representative determinations | All artifacts are current, internally consistent with deployed behavior, signed by authorized owners, and scheduled for annual/material-change review; no engineering-only compliance claim is made | Signed accountability packet and deployed-notice hash | Authorized legal/product owner |
| `GATE-public-query-ai-privacy` | `PVT-PRIV-006`, `PVT-PRIV-007`, `PVT-PRIV-011`, `POT-CF-009`, `SST-SEC-006` | Current Workers AI terms/privacy documentation, binding/config export, seeded query tests and exact-search fallback | Public query embeddings are enabled only with signed processor/retention/training approval and proof that query payload/logging retention is disabled; otherwise exact/structured search is the enforced fallback and release remains blocked if semantic acceptance is mandatory | Dated legal/privacy review, config export, canary report | Privacy/legal/search owner |

`MET-SM-11` is computed per enabled provider after at least four scheduled opportunities over the shorter of its enabled lifetime or trailing 90 days: successful retrieval, validation, and publication divided by completed opportunities must be at least 95%. Before four opportunities it is reported only as provisional. Failed, unavailable, or quarantined acquisition is not success, and no successful observation for eight elapsed days always alerts.

## Release coordinator to composite-gate mapping

| Coordinator | Required composite gates |
|---|---|
| `RGA-REL-AC-01` | `GATE-provider-launch`, `GATE-legal-source-register` |
| `RGA-REL-AC-02` | `GATE-provider-launch` |
| `RGA-REL-AC-03` | `GATE-evidence-dlp`, `GATE-api-contract` |
| `RGA-REL-AC-04` | `GATE-applicability-integrity` |
| `RGA-REL-AC-05` | `GATE-applicability-integrity` |
| `RGA-REL-AC-06` | `GATE-neutrality-invariance`, `GATE-search-acceptance` |
| `RGA-REL-AC-07` | `GATE-neutrality-invariance` |
| `RGA-REL-AC-08` | `GATE-api-contract` |
| `RGA-REL-AC-09` | `GATE-extraction-adversarial` |
| `RGA-REL-AC-10` | `GATE-provider-launch` |
| `RGA-REL-AC-11` | `GATE-publication-chaos` |
| `RGA-REL-AC-12` | `GATE-publication-chaos` |
| `RGA-REL-AC-13` | `GATE-search-acceptance`, `GATE-public-query-ai-privacy` |
| `RGA-REL-AC-14` | `GATE-api-contract`, `GATE-api-abuse`, `GATE-cost-fail-safe` |
| `RGA-REL-AC-15` | `GATE-environment-isolation` |
| `RGA-REL-AC-16` | `GATE-manual-a11y` |
| `RGA-REL-AC-17` | `GATE-performance` |
| `RGA-REL-AC-18` | `GATE-neutrality-invariance`, `GATE-referral-zero-tracking` |
| `RGA-REL-AC-19` | `GATE-zero-visitor-data`, `GATE-gdpr-accountability` |
| `RGA-REL-AC-20` | `GATE-repository-release` |
| `RGA-REL-AC-21` | `GATE-restore-and-rebuild` |
| `RGA-REL-AC-22` | `GATE-repository-release`, `GATE-gdpr-accountability` |
| `RGA-REL-AC-23` | `GATE-restore-and-rebuild`, `GATE-publication-chaos` |
| `RGA-REL-AC-24` | `GATE-repository-release` |

Open question: the `REL-AC-19` traceability row lists concrete evidence through `PVT-PRIV-012`, but the current `RGA-REL-AC-19` mapping includes only `GATE-zero-visitor-data` and `GATE-gdpr-accountability`. Neither composite gate contains `PVT-PRIV-012`; that verification belongs to `GATE-referral-zero-tracking`. This plan records the text-versus-mapping omission without adding or removing a gate, changing the PRD, or interpreting which source is intended. `REL-AC-19` remains `Planned` until an authorized clarification is recorded.

## Release coordinator behavior

Each `RGA-REL-AC-nn` in traceability is a coordinator, not a self-validating test. It passes only when every concrete trace ID listed in that row has a current artifact, every composite gate in the explicit mapping above passes, and no artifact references an older contract/policy/publication version. Coordinators produce a signed JSON release manifest containing inputs, artifact hashes, owners, timestamps, exceptions (normally none), and final status.

Manual evidence expires when its source terms, design, environment, or major version changes. Production schedule evidence for `REL-AC-10` inherently requires the full two-week elapsed observation window and cannot be simulated.
