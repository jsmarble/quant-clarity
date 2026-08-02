# Contracts

This directory contains deterministic machine-readable contracts generated from the approved design. The initial canonical launch-resource, provider-adapter, publication-manifest, and OpenAPI 3.1 schemas are executable. Phase 1 remains in progress until the cursor and search-document contracts, complete route examples, and executable API-conformance skeleton are finished.

The generated baseline includes:

- equivalent deterministic OpenAPI JSON and YAML documents with collection/detail paths for methodology metadata, model families, models, variants, providers, offerings, prices, precision observations, evidence summaries, search, and dataset metadata (`API-001`–`API-018`);
- canonical public resource and evidence schemas (`DATA-001`–`DATA-067`);
- provider-adapter manifest, candidate, batch, and terminal-roster contracts (`PIPE-010`–`PIPE-019`, `PIPE-030`–`PIPE-045`);
- publication manifest/head contracts (`PIPE-050`–`PIPE-056`);
- stable unknown-fact, error, identifier, decimal, currency-provenance, exact-applicability, and observation/evidence shapes;
- route-specific filter, neutral-sort, limit, and response-metadata policies (`API-002`–`API-018`);
- an authoritative required `SearchCollection.meta.semantic_degraded` state that remains expressible for empty exact/structured fallback, with an identical required `/v1` result mirror and no implicit default (`API-004`, `API-010`, `API-016`, `NFR-006`); and
- semantic validation for adapter manifests, terminal batches, publication closure, and head activation.

Remaining contract work includes the authenticated cursor and search-document/index schemas and validated human-readable examples for every public resource. ADR 0024 resolves the empty-search degradation representation only; provider-only semantic applicability and the merged public search cursor remain pending. Active path-only details are cacheable through a publication-scoped internal cache key; collections and every request with a query string are `private, no-store`. ADR 0013 defines `X-QuantClarity-Publication` as the public publication pin, and ADR 0016 defines the bounded local cursor, service-envelope, conditional-request, and cache-origin decisions without claiming deployed runtime behavior.

Contracts must trace to PRD requirement IDs and remain compatible with the versioning rules in the PRD. Do not create redundant Model Facts or Offering Facts canonical entities; those are presentation views over model and offering resources.
