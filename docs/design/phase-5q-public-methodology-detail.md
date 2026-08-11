# Phase 5Q: Publication-pinned public methodology detail

| Attribute | Value |
|---|---|
| Status | Local implementation verified; remote configuration and deployment remain prohibited |
| Decision | [ADR 0049](../decisions/0049-public-methodology-detail.md) |
| Requirements | `FE-051`, `API-001`, `API-003`, `API-004`, `API-011`–`API-017`, `API-020`–`API-024`, `API-024A`, `API-025`, `API-026`, `BE-003`, `BE-007`, `BE-008`, `SEC-001`, `SEC-007`, `SEC-008`, `SEC-011`, `PRIV-003`, `PRIV-004`, `PRIV-006`, `PRIV-007`, `PRIV-011`, `QA-004`, `QA-014` |
| Release gates | Local prerequisite to `GATE-api-contract`, `GATE-api-abuse`, and `GATE-zero-visitor-data`; all mapped rows remain `Planned` |

## Objective

Replace only the exact registered local/test GET/HEAD `/v1/methodologies/{version}` `404` with the existing `MethodologyDetail` representation and enable fixed preflight only for registered local/test versions. Unregistered versions and every preview/production methodology request remain fixed `404` routes. Preserve the storage-free API, SELECT-only named query boundary, publication pinning, stable historical methodology identity, zero visitor storage, and closure of every unrelated route.

## Fixed implementation boundary

The slice has four implementation units:

1. centralize the existing immutable methodology registry in API core so dataset metadata and methodology detail use one lookup;
2. build one hostile-input-safe, exact-byte `MethodologyDetail` encoder capped at 4,096 bytes;
3. add one dedicated bookmark-continuous `readMethodologyContextV1` query RPC that returns only selected publication/schema plus protected-origin authority; and
4. add the route to the existing API response handler with limiter-first GET/HEAD/OPTIONS, conditional ETag, fixed CORS/errors/security headers, and no Cache API.

No contract field, generated OpenAPI path, D1 schema, Wrangler binding, environment variable, cache capability, migration, or public topology is added. The named query interface advances only by the dedicated typed context method. The current `MethodologyDetail` schema and generated path are authoritative.

## Registry and historical semantics

One registry entry is an immutable exact tuple of version, effective time, and `/v1/methodologies/<version>` path. Lookup is case-sensitive and own-key-only. Once referenced by a publication, entries are append-only; changed semantics require a new version plus its versioned web page and change-log entry.

The exact route version selects the historical methodology record. The selected active or explicitly pinned publication supplies only the envelope's `publication_id` and `schema_version`. Equality between the requested methodology version and the selected publication's methodology version is neither required nor allowed as an availability rule: historical methodology metadata must remain addressable after its datasets leave the retained-hot window.

The route returns registry metadata only. It does not serialize the methodology prose, duplicate canonical data, or claim that the API response alone satisfies the `FE-050`–`FE-052` frontend acceptance criteria.

## Request and effect matrix

| Case | Required local result | Forbidden effects |
|---|---|---|
| registered local/test GET | exact contract-valid JSON `200`, selected publication header, strong ETag, `private, no-store` | API D1, Cache API, mutation, telemetry |
| registered local/test HEAD | GET-equivalent status/headers, empty body | same as GET |
| registered local/test OPTIONS | fixed non-credentialed preflight after limiter | resolver, query RPC, ETag, Cache API |
| registered local/test conditional match | bodyless `304` with `private, no-store` after complete canonical read/encode | early conditional bypass |
| valid grammar, unregistered GET/HEAD/OPTIONS in every environment | static `404` after limiter | resolver, query RPC, encoding, Cache API |
| registered GET/HEAD/OPTIONS in preview/production | static `404` after limiter | resolver, query RPC, encoding, Cache API |
| malformed/encoded/trailing path or query/body/cursor/filter/sort | existing bounded static error after limiter | downstream data effects |
| unavailable exact publication pin on registered local/test GET/HEAD | generic `409 publication_expired` and current publication header | fall-forward to active data |
| no safe active publication for registered local/test GET/HEAD | static `503 publication_not_ready` | fabricated publication/schema |
| metadata/registry/origin/encoding/runtime failure | fixed private `503` | internal text or partial response |

Every methodology outcome uses exact `Cache-Control: private, no-store`. Successful `200` and `304` also use the methodology-specific generated policy's `Vary: X-QuantClarity-Publication`; the input-independent OPTIONS response has no `Vary`. No outcome has a cookie or request-correlation identifier, and all use the existing environment-matched security policy. Source-address and actor material exist only inside the request-lifetime limiter. No route outcome uses Cache API.

## Selected-publication context

Use one bounded withheld-plan sequence:

1. validate the complete request, route grammar, method-specific body/query rules, publication control, and conditional headers;
2. perform exact own-key registry-existence validation and the environment gate, producing a withheld fixed `404` plan when the version is unregistered or the environment is not local/test while retaining only the validated version;
3. settle the request-lifetime limiter before releasing any withheld validation, registry, environment, or method response;
4. release registered local/test OPTIONS as fixed preflight without resolver or query RPC;
5. for registered local/test GET/HEAD only, preserve the exact optional publication pin, compute the fresh-work horizon once, and call resolver V2;
6. call exactly one fixed SELECT-only `readMethodologyContextV1` with environment, selected publication, bookmark, horizon, and the closed normalized methodology-operation envelope containing the already-registered version;
7. validate the returned exact publication/schema/origin context, require resolver agreement, and encode once through a fresh exact own-key lookup that revalidates the immutable registry entry before computing the strong ETag and evaluating `If-None-Match`.

The context method validates the already-registered exact methodology version as part of the closed operation envelope and validates its fixed empty-filter/null-continuation shape, but it does not consult the registry. Only publication ID and horizon enter SQL; the requested version does not. The context query never joins or returns dataset-metadata counts, notices, schedules, current methodology, provider slices, canonical resources, or other policy versions. No request host, forwarded value, raw header, or public URL becomes origin authority.

## Local acceptance target

Implementation is complete locally only when focused unit and Worker-runtime tests prove:

- shared-registry identity across dataset metadata and methodology detail, immutable returned values, and fail-closed hostile lookups;
- the exact response/meta shape and byte identity against `MethodologyDetail` and generated OpenAPI;
- exact current and historical registered versions, including a requested version different from the selected publication's current version;
- registered/unregistered/malformed route behavior and closure of Model, search, collection, OpenAPI, and all other detail routes;
- complete request/header and registry/environment planning before limiting with every planned response withheld until limiter settlement;
- active, rollback, retained-hot, expiration, no-publication, cutoff, and switch-race continuity through the dedicated context read;
- unregistered and preview/production GET/HEAD/OPTIONS fixed `404` after limiting with no resolver/query effect, and registered local/test OPTIONS effect-free after limiting;
- registered local/test GET/HEAD resolver V2 followed by exactly one context read, including ordinary expiration/no-publication/integrity handling only on that open path;
- exact closed methodology envelope validation including the already-registered version, fixed SELECT, exact two-bind order/count with no version bind, one Session, forced retained-hot indexes/query plan, no broader metadata joins, and no DML/dynamic SQL;
- trusted-origin isolation, exact publication/schema propagation, hostile encoder-input code-unit ceilings, the composed methodology-URL cap, exact UTF-8 bytes, the defensive 4,096-byte encoded-representation cap plus the injected response ceiling, strong ETag, GET/HEAD/304 parity, methodology-specific successful `private, no-store` and `Vary` headers, no-store errors/preflight, and fixed CORS/security/errors;
- absence of Cache API, API D1, cookies, application persistence, logs, traces, analytics, custom telemetry, request identifiers, and visitor-derived values; and
- format, lint, type, contracts, privacy, Worker-runtime, build, documentation, traceability, and full repository gates.

## Non-claims and remaining gates

This slice does not by itself complete the human-readable methodology/change-log frontend, every API route, remote conformance, Cloudflare privacy exports, abuse/load acceptance, GDPR accountability, provider sourcing, production configuration, deployment, or release acceptance. [Phase 5T](phase-5t-local-methodology-acceptance.md) supplies the separate local frontend prerequisite; its deployed accessibility and historical-retention evidence remain pending. This slice does not select or authorize any remote host or route. It has no ADR 0045 dependency and makes no recovery claim. Every mapped traceability requirement remains `Planned` until its full declared gate evidence exists.
