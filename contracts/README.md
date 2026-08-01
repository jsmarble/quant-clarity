# Contracts

This directory contains machine-readable contracts generated from the approved design. The current OpenAPI and shared-schema skeleton is executable but intentionally incomplete while Phase 1 remains in progress.

The completed phase will include:

- Public OpenAPI specification
- Canonical data schemas
- Provider-adapter input/output contract
- Evidence and observation schema
- Publication manifest/version contract
- Search document and filter contract
- Stable error and enum definitions

Contracts must trace to PRD requirement IDs and remain compatible with the versioning rules in the PRD. Do not create redundant Model Facts or Offering Facts canonical entities; those are presentation views over model and offering resources.
