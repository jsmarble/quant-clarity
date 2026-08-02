# ADR 0011: Enforce zero visitor data and GDPR release controls

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, privacy and security lead
- Related requirements: SEC-011, PRIV-001–PRIV-012, AFF-001–AFF-008, OPS-001–OPS-004, QA-007, REL-AC-19
- Supersedes: The earlier visitor-telemetry and bounded incident-retention clauses that appeared in the pre-approval design and draft ADR 0009

## Context

QuantClarity is a public factual service with no accounts, personalization, contribution flow, or behavioral business model. The product owner approved a stricter posture than the original baseline: QuantClarity must store no visitor information and run no cookies, browser identifiers, visitor analytics, public-request telemetry, search/click retention, or per-user referral tracking.

Serving any HTTPS request necessarily causes Cloudflare, as infrastructure provider, to transiently process network data such as an IP address. That unavoidable processor activity must be minimized, contractually governed, and accurately disclosed; it is not permission for QuantClarity to copy the data into application storage or telemetry. GDPR readiness also includes organizational and legal-owner work that code cannot certify.

## Decision

Public frontend, API, and query Worker surfaces have all invocation logs, traces, Tail Worker/Logpush export, request-event metrics, Web Analytics, browser beacons, and custom telemetry disabled. They set no cookies and write no local storage, session storage, IndexedDB, service-worker state, or other visitor-specific browser data. Static public HTTP caching remains allowed only when every visitor receives identical content and the key contains no visitor-derived value.

Source addresses may be transformed only in request memory for the Cloudflare rate-limiting binding. The application discards its references immediately and creates no application record. The binding necessarily maintains bounded counter state as a processor feature; its retention is a vendor/contract-confirmation release item because the public binding documentation does not specify key/counter deletion timing. No application database, object, durable state, cache, event, alert, fixture, artifact, or incident procedure receives the address or derived actor key. Live requests receive no retained correlation identifier.

Operational evidence comes from fixed-input synthetic probes and from pipeline, publication, deployment, and source-adapter control-plane records that cannot contain or derive from live visitor requests. Cloudflare account-level aggregate billing and security controls may be reviewed in place but are not imported into visitor-level records.

Referral links are direct exact-allowlisted destinations with `Referrer-Policy: no-referrer`, `rel="sponsored nofollow noopener noreferrer"`, an adjacent plain-language disclosure, and at most one static program identifier shared by all visitors. Programs requiring pixels, cookies, click IDs, personalized codes, callbacks, or redirect logs are prohibited.

Before public release, an authorized owner must approve the controller identity and legal contact, privacy notice, lawful-basis analysis, Cloudflare DPA and transfer terms, subprocessor/data-location review, record of processing activities, retention schedule, rights-request procedure, security measures, and determinations concerning a DPIA, DPO, EU/UK representative, and other jurisdiction-specific duties. The technical gate records evidence but does not claim legal advice or certify compliance by itself.

## Consequences

- QuantClarity has no visitor dataset to sell, profile, leak, inspect, or honor through an application-level access/export flow.
- Production debugging cannot rely on real visitor requests; deterministic reproduction, synthetic probes, canary rollout, and rollback become more important.
- Field Core Web Vitals and real-traffic availability analytics are unavailable; version-controlled lab tests and synthetic production probes are the accepted measures.
- Some affiliate programs and abuse-investigation techniques are unavailable by design.
- Cloudflare's own necessary processing remains governed by its contract and disclosed transparently; “zero visitor data stored by QuantClarity” must not be phrased as “no data is processed anywhere.”

## Alternatives considered

- Cloudflare Web Analytics: rejected because the owner prohibited visitor analytics even when cookie-free.
- Sanitized per-request events or aggregate live counters: rejected because they remain visitor-derived telemetry.
- Short-lived IP/query incident capture: rejected because incident mode may not weaken the invariant.
- Consent banner plus optional analytics: rejected because the product has no need for analytics and should not create a consent or identity surface.
- Affiliate click redirects: rejected because they create an unnecessary tracking and security surface.

## Validation

- Static configuration tests fail on any public observability enablement, Analytics Engine request binding, Web Analytics beacon, third-party analytics origin, cookie write, browser-storage write, visitor-derived cache key, click redirect, or dynamic referral identifier.
- Browser tests crawl every route and assert no `Set-Cookie`, no visitor-storage mutation, no analytics/pixel request, no referrer leakage, and no unexpected third-party connection.
- Deployed checks inspect Cloudflare public Worker settings and network behavior, then retain signed configuration/crawl artifacts.
- The privacy notice and operator compliance artifacts receive authorized legal-owner approval before release and on material changes.
