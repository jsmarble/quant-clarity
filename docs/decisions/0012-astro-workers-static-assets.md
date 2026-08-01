# ADR 0012: Host Astro SSR on Cloudflare Workers with Static Assets

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, frontend lead
- Related requirements: CF-001, CF-005, CF-006, FE-001–FE-009, FE-060–FE-064, NFR-004, A11Y-001–A11Y-007, PRIV-001–PRIV-012
- Supersedes: ADR 0001's Cloudflare Pages-specific frontend topology; its TypeScript/npm/Astro decisions remain accepted

## Context

ADR 0001 selected Astro SSR on Cloudflare Pages. Current Astro 7 and `@astrojs/cloudflare` 14 removed Pages support and target Cloudflare Workers, while current Cloudflare documentation recommends Workers Static Assets for full-stack applications and documents Astro as a natively supported Workers framework. Maintaining the Pages constraint would require an unsupported or legacy framework line.

The product owner explicitly approved amending `CF-001`, `FE-063`, and the initial hosting target. The amendment changes hosting topology only; it does not weaken model-first rendering, progressive enhancement, zero visitor data, accessibility, performance, path stability, or the separate public API/query trust boundaries.

## Decision

Use current pinned Astro and the official Cloudflare adapter in server-rendered mode on a dedicated frontend Worker with Workers Static Assets:

- Pre-render methodology, privacy, terms, API documentation, and historical methodology pages where their inputs are build-stable.
- Server-render model, variant, provider, Offering Facts, evidence, search, and other publication-dependent pages.
- Reach the public API Worker only through a service binding and the signed internal request envelope; the frontend receives no D1, R2, Vectorize, pipeline, or provider credential binding.
- Hydrate only accessible search, filter, sort, disclosure, and comparison controls. URL/history navigation is allowed, but no cookie, browser store, service worker, beacon, analytics, profile, or visitor telemetry is allowed.
- Serve immutable build assets through Workers Static Assets. Author static security headers in `public/_headers`; attach the same applicable controls to SSR responses in Worker middleware.
- Enable preview URLs only in the isolated preview environment. Every preview static and SSR response receives `X-Robots-Tag: noindex`; preview robots policy disallows indexing.
- Keep production `workers_dev` and preview URLs disabled. Custom-domain promotion must preserve all public paths.

Official references verified on 2026-08-01:

- [Astro on Cloudflare Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)
- [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Static Asset headers](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Workers Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
- [Migrate from Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)

## Consequences

- The frontend can use the supported current Astro/adapter line without a legacy compatibility pin.
- Static assets and SSR deploy as one versioned Worker unit while canonical data publication remains independently versioned.
- The frontend Worker remains a separate public ingress and must execute the same transient rate-limit, zero-data, security-header, publication-pinning, and internal-envelope controls previously assigned to Pages SSR.
- Preview `noindex` is now an application/configuration requirement rather than an assumed Pages default.
- Workers Builds or protected GitHub deployment may create versions/previews later, but no automatic production promotion is authorized until release gates pass.

## Alternatives considered

- Pin legacy Astro 5 and adapter 12 on Pages: rejected because it begins the product on an obsolete framework line and increases security/maintenance risk.
- Abandon Astro for a Pages-compatible framework: rejected because current Workers support resolves the platform conflict without changing the content-first rendering model.
- Merge frontend and public API into one Worker: rejected because it would collapse the approved trust, caching, rate-limit, and independently deployable API boundaries.

## Validation

- Build and execute Astro SSR with the Workers runtime and current adapter.
- Prove primary facts are present in raw HTML without client JavaScript.
- Prove the frontend has only its asset and API service bindings.
- Crawl static and SSR preview paths and require `X-Robots-Tag: noindex`, no cookies/storage/beacons, and no unexpected network requests.
- Verify current custom-domain routing preserves the canonical path structure.
- Run keyboard, screen-reader, zoom, contrast, reduced-motion, controlled Lighthouse, and repeatable build checks.
