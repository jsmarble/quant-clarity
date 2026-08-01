# ADR 0001: Use TypeScript npm workspaces and Astro SSR on Cloudflare Pages

- Status: Accepted; Cloudflare Pages-specific topology superseded by ADR 0012
- Date: 2026-08-01
- Decision owners: Product owner, staff engineer, frontend lead
- Related requirements: CF-001, CF-005, CF-006, FE-001–FE-009, FE-060–FE-064, NFR-004, A11Y-001–A11Y-007, OSS-001
- Supersedes: None

## Context

QuantClarity needs an implementation toolchain and a frontend delivery model before application code can be scaffolded. The site is content-heavy, must render primary model and provider facts without client JavaScript, must remain fast and accessible, and must deploy on Cloudflare Pages. The repository will also contain a public API Worker, internal Workers, contracts, fixtures, and shared domain logic that must not drift across packages.

## Decision

Use a TypeScript monorepo managed with npm workspaces. Pin the Node.js and npm major versions in version-controlled toolchain metadata and use one lockfile at the repository root. Enable strict TypeScript checking and share generated contract types rather than duplicating domain interfaces.

Use Astro with the official Cloudflare adapter in server-rendered mode on Cloudflare Pages:

- Pre-render stable pages such as methodology, privacy, terms, API documentation, and historical methodology versions.
- Server-render model, variant, provider, Offering Facts, and evidence pages through Pages Functions.
- Obtain canonical data through a service binding to the public API Worker; the Pages application receives no direct D1, R2, Vectorize, pipeline, or provider-credential bindings.
- Hydrate only interactive search, filter, sort, disclosure, and comparison controls.
- Keep URL state explicit and make the initial meaningful facts available in rendered HTML.
- Generate security headers, canonical URLs, sitemaps, robots policy, and share metadata as tested build artifacts.

The workspace layout will separate applications, shared libraries, contracts, tests, and infrastructure without allowing presentation packages to become a second canonical data model.

Official references:

- [Deploy an Astro site to Cloudflare Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/)
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [Pages service bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [Pages preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/)

## Implementation compatibility finding

Release-time research on 2026-08-01 found an unresolved primary-source conflict. Current Astro 7 and `@astrojs/cloudflare` 14 explicitly remove Cloudflare Pages support and target Workers, while Cloudflare's current Pages framework guide still describes Astro SSR on Pages. The last identified Pages-compatible pairing is the legacy Astro 5 / adapter 12 line. Pinning that legacy line or moving the frontend to Workers would be a consequential choice; the latter also amends `CF-001`.

The product owner resolved this finding on 2026-08-01 by explicitly amending `CF-001` and accepting ADR 0012. `apps/web` may use the supported current Astro/adapter line on Cloudflare Workers with Static Assets. The TypeScript/npm/Astro portions of this ADR remain accepted; the Pages-specific portions are retained as decision history and are no longer operative.

## Consequences

- Primary facts are indexable and useful without client-side execution.
- Static pages and assets use Pages caching while dynamic pages can follow the current publication version.
- Shared TypeScript contracts reduce API/frontend drift.
- npm workspaces avoid introducing a second package-management layer.
- Astro and its Cloudflare adapter become consequential dependencies that require upgrade and compatibility testing.
- Pages Functions count against Workers quotas, so SSR routes require caching and performance budgets.
- Client-side islands must be reviewed to prevent unnecessary JavaScript and accessibility regressions.

## Alternatives considered

- Fully static generation: rejected because data publication occurs independently of code deployment and would create synchronization and rebuild pressure at 100,000 offerings.
- Client-only React/Vite application: rejected because it would not satisfy primary-fact rendering, SEO, and low-JavaScript performance goals as directly.
- Next.js on Pages: rejected because Astro better matches a content-first, progressively enhanced site and has a smaller default client runtime.
- A standalone frontend Worker: rejected because the PRD requires Cloudflare Pages.
- pnpm or Yarn workspaces: viable, but npm workspaces minimize required tooling for the initial implementation.

## Validation

- Build and deploy an Astro SSR proof to an isolated Pages preview.
- Verify model and provider primary facts in raw HTML with JavaScript disabled.
- Confirm the Pages Function reaches the API Worker only through its service binding.
- Confirm preview responses contain `X-Robots-Tag: noindex`.
- Run responsive, keyboard, screen-reader, automated accessibility, and Core Web Vitals acceptance profiles.
- Run `npm ci`, strict type-checking, production build, and a repeat build to confirm lockfile reproducibility.
