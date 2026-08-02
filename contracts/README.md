# Contracts

This directory contains deterministic machine-readable contracts generated from the approved design. The initial canonical launch-resource, provider-adapter, publication-manifest, and OpenAPI 3.1 schemas are executable. Phase 1 remains in progress until the cursor and search-document contracts, complete route examples, and executable API-conformance skeleton are finished.

The generated baseline includes:

- public collection/detail OpenAPI paths for model families, models, variants, providers, offerings, prices, precision observations, evidence summaries, search, and metadata (`API-001`–`API-018`);
- canonical public resource and evidence schemas (`DATA-001`–`DATA-067`);
- provider-adapter manifest, candidate, batch, and terminal-roster contracts (`PIPE-010`–`PIPE-019`, `PIPE-030`–`PIPE-045`);
- publication manifest/head contracts (`PIPE-050`–`PIPE-056`); and
- stable unknown-fact, error, identifier, decimal, currency-provenance, exact-applicability, and observation/evidence shapes;
- route-specific filter, neutral-sort, limit, and response-metadata policies (`API-002`–`API-018`); and
- semantic validation for adapter manifests, terminal batches, publication closure, and head activation.

Remaining Phase 1 contract work includes authenticated cursor and search-document/index schemas, methodology response schemas, and validating human-readable examples for every public resource. Active path-only details are cacheable through a publication-scoped internal cache key; collections and every request with a query string are `private, no-store`. A public publication-pinning path or header protocol is deliberately not invented here and requires an explicit design/ADR decision before it can become part of the public API.

Contracts must trace to PRD requirement IDs and remain compatible with the versioning rules in the PRD. Do not create redundant Model Facts or Offering Facts canonical entities; those are presentation views over model and offering resources.
