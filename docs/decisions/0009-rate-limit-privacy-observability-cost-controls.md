# ADR 0009: Make abuse, privacy, observability, and cost controls part of the public request path

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, security and privacy lead, operations lead
- Related requirements: G-10, SM-05, SM-09, API-020–API-027, CF-008, CF-023–CF-025, SEC-007, SEC-010–SEC-013, PRIV-001–PRIV-012, OPS-001–OPS-007, QA-007, QA-008, QA-014
- Supersedes: None

## Context

The anonymous API must remain useful without allowing semantic search, broad filters, or abusive clients to create runaway cost. The PRD mandates a documented IPv4/IPv6 source-address policy even though Cloudflare cautions that IPs can represent shared users and its Worker rate limiter is permissive, eventually consistent, and location-local. The approved zero-visitor-data amendment prohibits QuantClarity from retaining any public request event, source address/key, search, click, header, URL, referrer, user agent, or visitor-derived telemetry.

## Decision

Apply controls in `api-edge` in this order: validate method/path/input bounds, derive an in-memory versioned source-address key, consume the route-cost rate-limit bucket, erase all references to that key, then consult response cache or call the query service. Do not assign or return a retained application request ID on live public requests.

The initial `ip-v1` keying policy uses IPv4 `/32` and both IPv6 `/64` primary and `/48` rotation buckets, combined only with a coarse route-cost class before HMAC transformation. It is provisional until QA-014 passes normal shared-network, IPv6 privacy-address, prefix-rotation, and concentrated-abuse cases. Rate limiting is defense-in-depth, not billing or an exact global quota. Use separate generous cacheable-read and tighter semantic-search buckets. Return `429` with a retry indication.

Set explicit bounds for URL/body size, query length, filters, page size, cursor size, sort fields, semantic fan-out, result count, response bytes, CPU, subrequests, and upstream calls. Add only block-only firewall or rate-limit rules where measured abuse justifies them. Never enable challenges, JavaScript detection, unique-visitor identifiers, or cookie-setting bot products.

Disable stored invocation logs, automatic traces, custom spans/events, Tail Worker export, Logpush, Analytics Engine request events, and Web Analytics for the public frontend, API, and query Workers. Live visitor requests emit no application logs, request counters, request IDs, status/latency/cache/rate-limit metrics, or error events. Error responses remain bounded and generic. Debugging uses deterministic local reproduction, version-controlled synthetic probes, and deployment/configuration evidence rather than capture of production visitor requests.

Use `GET /v1/search` consistently with the read-only resource contract and mark it `private, no-store`. Privacy acceptance must inspect every query-string handling path, public Worker observability setting, browser storage surface, network request, response header, cache key, and affiliate destination. Operator-generated synthetic probes use fixed non-personal inputs and a separate control-plane identity; their results cannot be joined to live traffic.

Configure account and application budgets/alerts for Workers requests and CPU, D1, R2, Workflows, Vectorize, Workers AI/AI Gateway, Browser Run, and Queues if later introduced. The dated formulas, base/tenfold/100,000-offering projections, and per-service admission ceilings live in `docs/design/cost-model.md`. At the proposed USD 25 application budget, expensive new work stops while a reserved last-known-good public read path remains available; vendor alerts are not treated as instantaneous hard caps.

Official references:

- [Workers Rate Limiting API](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Workers Logs and invocation-log control](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Workers traces](https://developers.cloudflare.com/workers/observability/traces/)
- [Cloudflare Web Analytics FAQ](https://developers.cloudflare.com/web-analytics/faq/)
- [Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)

## Consequences

- Cache hits cannot bypass abuse controls.
- Expensive routes receive tighter ceilings without requiring accounts.
- QuantClarity retains no live public-request telemetry or visitor information at all.
- Disabling all public invocation logs and telemetry removes production request-level debugging; deterministic reproduction, synthetic probes, health checks, and safe rollout/rollback must compensate. There is no incident-mode exception.
- IPv6 prefix choice is explicitly test-driven and may change before release without changing the API contract.
- Platform-local permissive counters reduce denial-of-wallet risk but cannot promise exact global quotas.

## Alternatives considered

- Rate limit after cache lookup: rejected because cache hits could bypass required controls.
- Durable Object global per-IP counters: rejected initially due added latency, cost, privacy surface, and false precision.
- Raw-IP Analytics Engine events: rejected by privacy and profiling constraints.
- External observability or analytics SaaS: rejected by Cloudflare-native and privacy requirements.
- CAPTCHA or login for ordinary use: rejected by the anonymous public-access requirements.
- Store search queries or any live request aggregate for relevance/operations: rejected by `PRIV-002`, `PRIV-006`, and `PRIV-011`; quality uses version-controlled acceptance sets and operator-generated synthetic probes instead.

## Validation

- Run QA-014 cases and document false-positive and evasion results before finalizing prefix treatment.
- Prove all API cache paths call validation and the applicable rate limiter first.
- Prove Workers Logs, traces, Tail Workers, Logpush, Analytics Engine request events, Web Analytics, third-party beacons, browser persistence, and click tracking are absent; inspect errors and cache keys for visitor-derived values.
- Load-test normal, tenfold, worst-case semantic, and concentrated-abuse profiles against CPU, subrequest, latency, and cost ceilings.
- Simulate budget thresholds from account-level billing controls and exercise the abuse runbook without importing visitor events.
- Confirm no allowed application sink can contain authorization/cookie headers, visitor network metadata, actor keys, full URLs, queries, user agents, referrers, or click events, including during incident response.
