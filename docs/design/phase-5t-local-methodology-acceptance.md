# Phase 5T: Local human-readable methodology acceptance

| Attribute | Value |
|---|---|
| Status | Locally implemented; deployed accessibility and historical-retention evidence remain pending |
| Extends | [Phase 5Q](phase-5q-public-methodology-detail.md) |
| Requirements | `FE-050`, `FE-051`, `FE-052`, `PRIV-006`, `QA-009` |
| Release gates | Local prerequisite to frontend, accessibility, zero-visitor-data, and release acceptance; every mapped row remains `Planned` |

## Objective

Close the local human-readable frontend prerequisite left by Phase 5Q without changing the approved methodology. The current and stable historical routes render the complete approved methodology, version, effective date, and material-change log as semantic server-rendered HTML. Browser acceptance proves the required rule categories and historical route locally while preserving the script-free, storage-free public frontend.

## Implemented representation

An immutable version-owned `MethodologyVersion100` component exposes the approved `1.0.0` version and `2026-08-01` effective date through visible semantic markup on both `/methodology` and `/methodology/1.0.0`. The current route explicitly selects that snapshot; a later current version must select a new version-owned component and leave the historical route on this one. Its definition list retains the complete precision vocabulary. Dedicated sections retain every approved model-grouping, evidence-precedence, freshness/status, price, and neutral comparison/sort rule plus the prohibition on rankings and recommendations.

The price section makes all three per-million-token roles, decimal-safe amounts, unknown cached input, currency provenance and no conversion, current-price evidence/time/unit/qualifiers, promotional limitations, historical audit retention, conditional standard-comparable rules, separate sort/filter fields, and the prohibitions on blended prices and composite scores explicit. Neutral-ordering prose includes the exact single-currency USD/fallback algorithm, visibly active scope, URL-visible nonpersistent state, equal-value behavior, and neutral deterministic tie navigation.

The material-change log is a labeled chronological list. Its initial-release entry links to the stable historical route and explicitly identifies the model-grouping and normalization rules plus neutral comparison and sort behavior established by that version. Future material changes require a new stable version and log entry; historical version URLs remain available.

The representation adds no script, cookies, browser storage, telemetry, visitor-derived state, mutation path, referral behavior, or client-side request. Current and historical pages continue through the same guarded Astro SSR Worker and shared static component.

## Local browser evidence

The public-runtime browser suite verifies:

- the current and stable historical URLs return successful server-rendered pages with distinct titles;
- semantic version and effective-date markup is visible;
- each precision-definition group and every `FE-050` methodology rule is present, including requirement-specific price, currency-scope, URL-state, and tie-handling assertions on both current and historical routes;
- the no-ranking/no-recommendation statement is explicit;
- the material-change log links the initial version to its stable historical route and names the material grouping, normalization, comparison, and sort semantics; and
- the existing all-route privacy and accessibility checks still cover both methodology URLs with no scripts, cookies, browser persistence, third-party requests, or automated accessibility violations.

## Non-claims and remaining gates

This local slice does not change methodology version `1.0.0`, its effective date, any approved rule, or any product requirement. It does not prove that future historical versions have been retained, complete manual accessibility acceptance, remote/multi-PoP conformance, Cloudflare privacy-accountability exports, a production publication, deployment, or release acceptance. Phase 5Q's API metadata route remains a separate prerequisite. Every mapped traceability row stays `Planned` until its full declared gate evidence exists.
