import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  checkModelSlugHistoryArtifactContract,
  GENERATED_SCHEMAS,
  MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES,
  MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
  type ModelSlugHistoryArtifact,
  ModelSlugHistoryArtifactSchema,
  validateModelSlugHistoryArtifactContract,
} from "./index.js";

const UUID_1 = "00000000-0000-4000-8000-000000000001";
const UUID_2 = "00000000-0000-4000-8000-000000000002";
const UUID_3 = "00000000-0000-4000-8000-000000000003";
const HASH = `sha256:${"a".repeat(64)}`;
const MAX_MODELS = 25_000;
const MAX_HISTORY_ROWS = 50_000;

const canonicalModel = {
  resource_id: `mdl_${UUID_1}`,
  resource_type: "model",
  slug: "example-model",
} as const;

const historicalRow = {
  slug_history_id: `slg_${UUID_2}`,
  resource_id: canonicalModel.resource_id,
  resource_type: "model",
  slug: "example-model-old",
  valid_from_ms: 1,
  valid_to_ms: 2,
} as const;

const currentRow = {
  slug_history_id: `slg_${UUID_3}`,
  resource_id: canonicalModel.resource_id,
  resource_type: "model",
  slug: canonicalModel.slug,
  valid_from_ms: 2,
  valid_to_ms: null,
} as const;

function validArtifact(): ModelSlugHistoryArtifact {
  return {
    artifact_version: MODEL_SLUG_HISTORY_ARTIFACT_VERSION,
    acquisition_version: "model-slug-history-canonical@1",
    canonical_guard_version: "model-slug-history-guard@1",
    projection_version: "model-slug@1",
    publication_id: `pub_${UUID_1}`,
    closure_hash: HASH,
    base_bundle_hash: HASH,
    publication_boundary_ms: 2,
    canonical_models: [canonicalModel],
    history_rows: [historicalRow, currentRow],
    model_count: 1,
    source_history_count: 2,
    source_history_hash: HASH,
    mapping_count: 2,
    current_mapping_count: 1,
    historical_mapping_count: 1,
    mapping_inventory_hash: HASH,
  };
}

function standaloneValidator(schema: object) {
  const sanitized = JSON.parse(
    JSON.stringify(schema, (key, value: unknown) =>
      key === "$id" ? undefined : value,
    ),
  ) as object;
  return new Ajv2020({ allErrors: true, strict: true }).compile(sanitized);
}

describe("private model-slug history artifact contract", () => {
  it("registers a deterministic standalone schema and accepts the closed artifact", () => {
    expectTypeOf<ModelSlugHistoryArtifact["artifact_version"]>().toEqualTypeOf<
      typeof MODEL_SLUG_HISTORY_ARTIFACT_VERSION
    >();
    expect(GENERATED_SCHEMAS.ModelSlugHistoryArtifact).toBe(
      ModelSlugHistoryArtifactSchema,
    );
    expect(
      standaloneValidator(ModelSlugHistoryArtifactSchema)(validArtifact()),
    ).toBe(true);
    expect(checkModelSlugHistoryArtifactContract(validArtifact())).toBe(true);
    expect(validateModelSlugHistoryArtifactContract(validArtifact())).toEqual(
      [],
    );
  });

  it("rejects extra fields, bookmarks, and accessor-backed input without invoking it", () => {
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        unexpected: true,
      }),
    ).toBe(false);
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        private_session_bookmark: "forbidden",
      }),
    ).toBe(false);
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        canonical_models: [{ ...canonicalModel, bookmark: "forbidden" }],
      }),
    ).toBe(false);
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        history_rows: [{ ...historicalRow, source_locator: "forbidden" }],
      }),
    ).toBe(false);

    let getterCalls = 0;
    const accessorArtifact = { ...validArtifact() };
    Object.defineProperty(accessorArtifact, "publication_id", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return `pub_${UUID_1}`;
      },
    });
    expect(checkModelSlugHistoryArtifactContract(accessorArtifact)).toBe(false);
    expect(getterCalls).toBe(0);

    let toJsonCalls = 0;
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        publication_id: {
          toJSON() {
            toJsonCalls += 1;
            return `pub_${UUID_1}`;
          },
        },
      }),
    ).toBe(false);
    expect(toJsonCalls).toBe(0);
  });

  it("rejects malformed rows and unsafe numeric values", () => {
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        history_rows: [{ ...historicalRow, slug_history_id: `mdl_${UUID_2}` }],
      }),
    ).toBe(false);
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        history_rows: [{ ...historicalRow, slug: "Not-Canonical" }],
      }),
    ).toBe(false);
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        history_rows: [{ ...historicalRow, valid_from_ms: -1 }],
      }),
    ).toBe(false);
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        publication_boundary_ms: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBe(false);
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        history_rows: [
          { ...historicalRow, valid_to_ms: Number.MAX_SAFE_INTEGER + 1 },
        ],
      }),
    ).toBe(false);
  });

  it("rejects count fields and arrays above their declared caps", () => {
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        model_count: MAX_MODELS + 1,
      }),
    ).toBe(false);
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        source_history_count: MAX_HISTORY_ROWS + 1,
      }),
    ).toBe(false);
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        canonical_models: Array.from(
          { length: MAX_MODELS + 1 },
          () => canonicalModel,
        ),
      }),
    ).toBe(false);
    expect(
      checkModelSlugHistoryArtifactContract({
        ...validArtifact(),
        history_rows: Array.from(
          { length: MAX_HISTORY_ROWS + 1 },
          () => historicalRow,
        ),
      }),
    ).toBe(false);
  });

  it("rejects an encoded artifact above the 24 MiB defense-in-depth cap", () => {
    const oversized = {
      ...validArtifact(),
      publication_id: "x".repeat(MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES),
    };
    const errors = validateModelSlugHistoryArtifactContract(oversized);

    expect(MODEL_SLUG_HISTORY_ARTIFACT_MAX_BYTES).toBe(24 * 1024 * 1024);
    expect(errors).toContain("artifact exceeds the 24 MiB encoded-byte limit");
  });

  it("rejects inconsistent summaries and cross-resource references", () => {
    expect(
      validateModelSlugHistoryArtifactContract({
        ...validArtifact(),
        model_count: 0,
      }),
    ).toContain("model_count does not match canonical_models length");
    expect(
      validateModelSlugHistoryArtifactContract({
        ...validArtifact(),
        mapping_count: 1,
      }),
    ).toContain("mapping_count does not match mapping inventory counts");
    expect(
      validateModelSlugHistoryArtifactContract({
        ...validArtifact(),
        history_rows: [
          { ...historicalRow, resource_id: `mdl_${UUID_2}` },
          currentRow,
        ],
      }),
    ).toContain("history_rows references a non-canonical model");
  });
});
