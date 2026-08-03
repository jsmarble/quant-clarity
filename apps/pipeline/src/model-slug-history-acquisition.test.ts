import { beforeAll, describe, expect, it } from "vitest";

import {
  MODEL_SLUG_MAX_HISTORY_ROWS,
  MODEL_SLUG_MAX_MODELS,
  assertModelSlugProjection,
  type ModelSlugHistorySourceRow,
} from "@quant-clarity/publication-core";

import {
  MODEL_SLUG_HISTORY_ACQUISITION_VERSION,
  ModelSlugHistoryAcquisitionError,
  acquireModelSlugHistoryCandidate,
  assertModelSlugHistoryCandidateCapture,
  type ModelSlugHistoryAcquisitionPorts,
  type ModelSlugHistoryPublicationAssembly,
} from "./model-slug-history-acquisition.js";
import {
  createModelVariantNameSearchFixture,
  type ModelVariantNameSearchFixture,
} from "../test/model-variant-name-search-fixture.js";

const PUBLICATION_ID = "pub_81111111-1111-4111-8111-111111111111";
const GENERATED_AT_MS = Date.parse("2026-08-03T00:00:00.000Z");
type ResultKey =
  | "row_kind"
  | "guard_version"
  | "guard_row_count"
  | "requested_model_count"
  | "canonical_model_count"
  | "source_history_count"
  | "slug_history_id"
  | "resource_id"
  | "resource_type"
  | "slug"
  | "valid_from_ms"
  | "valid_to_ms";

let fixture: ModelVariantNameSearchFixture;
let assembly: ModelSlugHistoryPublicationAssembly;
let historyRows: readonly ModelSlugHistorySourceRow[];

beforeAll(async () => {
  fixture = await createModelVariantNameSearchFixture(
    PUBLICATION_ID,
    GENERATED_AT_MS,
    "Alpha Model",
  );
  const resources = fixture.closureRows.resources.filter(
    (resource) => resource.resource_type === "model",
  );
  assembly = Object.freeze({ manifest: fixture.manifest, resources });
  historyRows = Object.freeze(
    resources.map((resource, index) => {
      const parsed = JSON.parse(resource.resource_json) as {
        slug: { value: string };
      };
      return Object.freeze({
        slug_history_id: `slg_${(index + 1)
          .toString(16)
          .padStart(8, "0")}-0000-4000-8000-000000000001`,
        resource_id: resource.resource_id,
        resource_type: "model" as const,
        slug: parsed.slug.value,
        valid_from_ms: 0,
        valid_to_ms: null,
      });
    }),
  );
});

const sentinel = (
  requestedModelCount = historyRows.length,
  canonicalModelCount = requestedModelCount,
  sourceHistoryCount = historyRows.length,
): Record<ResultKey, unknown> => ({
  row_kind: "sentinel",
  guard_version: "model-slug-history-guard@1",
  guard_row_count: 1,
  requested_model_count: requestedModelCount,
  canonical_model_count: canonicalModelCount,
  source_history_count: sourceHistoryCount,
  slug_history_id: null,
  resource_id: null,
  resource_type: null,
  slug: null,
  valid_from_ms: null,
  valid_to_ms: null,
});

const historyResultRow = (
  row: ModelSlugHistorySourceRow,
): Record<ResultKey, unknown> => ({
  row_kind: "history",
  guard_version: null,
  guard_row_count: null,
  requested_model_count: null,
  canonical_model_count: null,
  source_history_count: null,
  slug_history_id: row.slug_history_id,
  resource_id: row.resource_id,
  resource_type: row.resource_type,
  slug: row.slug,
  valid_from_ms: row.valid_from_ms,
  valid_to_ms: row.valid_to_ms,
});

const modelResultRow = (
  row: ModelSlugHistorySourceRow,
): Record<ResultKey, unknown> => ({
  row_kind: "model",
  guard_version: null,
  guard_row_count: null,
  requested_model_count: null,
  canonical_model_count: null,
  source_history_count: null,
  slug_history_id: null,
  resource_id: row.resource_id,
  resource_type: "model",
  slug: row.slug,
  valid_from_ms: null,
  valid_to_ms: null,
});

const d1Result = (rows: readonly unknown[]): unknown => ({
  success: true,
  results: [...rows],
  meta: { served_by_primary: true },
});

interface QueryCapture {
  constraint?: string | undefined;
  sql?: string;
  values?: readonly unknown[];
  events: string[];
}

const fakeDatabase = (
  result: unknown,
  capture: QueryCapture,
  bookmark: string | null = "bookmark-private-1",
): D1Database =>
  ({
    withSession(constraint?: D1SessionConstraint) {
      capture.constraint = constraint;
      capture.events.push("session");
      return {
        prepare(sql: string) {
          capture.sql = sql;
          capture.events.push("prepare");
          return {
            bind(...values: unknown[]) {
              capture.values = values;
              capture.events.push("bind");
              return {
                all() {
                  capture.events.push("all");
                  return Promise.resolve(result);
                },
              } as D1PreparedStatement;
            },
          } as D1PreparedStatement;
        },
        getBookmark() {
          capture.events.push("bookmark");
          return bookmark;
        },
      } as D1DatabaseSession;
    },
  }) as D1Database;

const validResult = (): unknown =>
  d1Result([
    sentinel(),
    ...historyRows.map(modelResultRow),
    ...historyRows.map(historyResultRow),
  ]);

const createPorts = (
  capture: QueryCapture,
  nextAssembly: ModelSlugHistoryPublicationAssembly = assembly,
): ModelSlugHistoryAcquisitionPorts => ({
  async withWriterDrain<T>(operation: () => Promise<T>): Promise<T> {
    capture.events.push("drain-enter");
    const result = await operation();
    capture.events.push("drain-release");
    return result;
  },
  assemblePublication() {
    capture.events.push("assemble");
    return Promise.resolve(nextAssembly);
  },
});

const expectStaticError = async (
  operation: Promise<unknown>,
  code: ModelSlugHistoryAcquisitionError["code"],
): Promise<void> => {
  const error = await operation.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ModelSlugHistoryAcquisitionError);
  expect(error).toMatchObject({
    code,
    message: "Canonical Model slug history could not be acquired safely.",
  });
  expect(String(error)).not.toContain("TOP-SECRET");
  expect(String(error)).not.toContain(PUBLICATION_ID);
};

describe("canonical Model slug-history acquisition", () => {
  it("holds assembly and one fixed exact-scope primary read inside one drain", async () => {
    const capture: QueryCapture = { events: [] };
    const result = await acquireModelSlugHistoryCandidate(
      fakeDatabase(validResult(), capture),
      createPorts(capture),
    );

    assertModelSlugHistoryCandidateCapture(result);
    assertModelSlugProjection(result.projection);
    expect(result).toMatchObject({
      acquisitionVersion: MODEL_SLUG_HISTORY_ACQUISITION_VERSION,
      publicationId: fixture.manifest.publicationId,
      closureHash: fixture.manifest.closureHash,
      publicationBoundaryMs: GENERATED_AT_MS,
      privateSessionBookmark: "bookmark-private-1",
    });
    expect(capture.events).toEqual([
      "drain-enter",
      "assemble",
      "session",
      "prepare",
      "bind",
      "all",
      "bookmark",
      "drain-release",
    ]);
    expect(capture.constraint).toBe("first-primary");
    expect(capture.values).toHaveLength(2);
    expect(JSON.parse(String(capture.values?.[0]))).toEqual(
      fixture.manifest.resources
        .filter((resource) => resource.resourceType === "model")
        .map((resource) => resource.resourceId),
    );
    expect(capture.values?.[1]).toBe(GENERATED_AT_MS);
    expect(capture.sql).toContain("FROM json_each(?1)");
    expect(capture.sql).toContain("history.valid_from_ms <= ?2");
    expect(capture.sql).toContain("history.valid_to_ms > ?2 THEN NULL");
    expect(capture.sql).toContain("FROM model_slug_history_integrity_metadata");
    expect(capture.sql).toContain("identity.resource_type = 'model'");
    expect(capture.sql).toContain("JOIN model AS canonical_model");
    expect(capture.sql).toContain("ORDER BY sort_group, resource_id");
    expect(capture.sql).toContain(
      `LIMIT ${String(1 + MODEL_SLUG_MAX_MODELS + MODEL_SLUG_MAX_HISTORY_ROWS + 1)}`,
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).not.toContain("privateSessionBookmark");
    expect(JSON.stringify(result)).not.toContain("bookmark-private-1");
    expect(Object.isFrozen(result.historyRows)).toBe(true);
    expect(result.historyRows).not.toBe(historyRows);
    expect(result.historyRows).toEqual(historyRows);
    expect(result.modelIds).toEqual(historyRows.map((row) => row.resource_id));
    expect(result.canonicalModels).toEqual(
      historyRows.map((row) => ({
        resource_id: row.resource_id,
        resource_type: "model",
        slug: row.slug,
      })),
    );
    expect(result.historyRows.every(Object.isFrozen)).toBe(true);
    expect(() => {
      assertModelSlugHistoryCandidateCapture({ ...result });
    }).toThrow("not trusted");
  });

  it("rejects sentinel scope, canonical-presence, count, and maximum+1 failures", async () => {
    const cases = [
      d1Result([
        sentinel(historyRows.length + 1),
        ...historyRows.map(modelResultRow),
        ...historyRows.map(historyResultRow),
      ]),
      d1Result([
        sentinel(historyRows.length, historyRows.length - 1),
        ...historyRows.map(modelResultRow),
        ...historyRows.map(historyResultRow),
      ]),
      d1Result([sentinel(historyRows.length, historyRows.length, 1)]),
      d1Result([
        sentinel(
          historyRows.length,
          historyRows.length,
          MODEL_SLUG_MAX_HISTORY_ROWS + 1,
        ),
      ]),
      d1Result([
        { ...sentinel(), guard_version: "model-slug-history-guard@0" },
        ...historyRows.map(modelResultRow),
        ...historyRows.map(historyResultRow),
      ]),
      d1Result([
        { ...sentinel(), guard_row_count: 2 },
        ...historyRows.map(modelResultRow),
        ...historyRows.map(historyResultRow),
      ]),
      d1Result([]),
    ];
    for (const result of cases) {
      const capture: QueryCapture = { events: [] };
      await expectStaticError(
        acquireModelSlugHistoryCandidate(
          fakeDatabase(result, capture),
          createPorts(capture),
        ),
        "integrity_failure",
      );
    }
  });

  it("rejects unordered, duplicate, and malformed result rows", async () => {
    const current = historyRows[0]!;
    const orderedHistory: readonly ModelSlugHistorySourceRow[] = [
      {
        ...current,
        slug_history_id: "slg_00000002-0000-4000-8000-000000000001",
        slug: "earlier-alpha-model",
        valid_to_ms: 1,
      },
      {
        ...current,
        slug_history_id: "slg_00000003-0000-4000-8000-000000000001",
        valid_from_ms: 1,
      },
    ];
    const reversed = [...orderedHistory].reverse().map(historyResultRow);
    const extra = { ...historyResultRow(historyRows[0]!), unexpected: true };
    const malformedCases = [
      d1Result([
        sentinel(1, 1, 2),
        ...historyRows.map(modelResultRow),
        ...reversed,
      ]),
      d1Result([
        sentinel(1, 1, 2),
        ...historyRows.map(modelResultRow),
        historyResultRow(historyRows[0]!),
        historyResultRow(historyRows[0]!),
      ]),
      d1Result([sentinel(), ...historyRows.map(modelResultRow), extra]),
    ];
    for (const result of malformedCases) {
      const capture: QueryCapture = { events: [] };
      await expectStaticError(
        acquireModelSlugHistoryCandidate(
          fakeDatabase(result, capture),
          createPorts(capture),
        ),
        "integrity_failure",
      );
    }
  });

  it("does not execute hostile result-row accessors or accept sparse arrays", async () => {
    let getterCalls = 0;
    const accessorRow = { ...sentinel() };
    Object.defineProperty(accessorRow, "source_history_count", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return historyRows.length;
      },
    });
    const sparseRows = new Array(3);
    sparseRows[0] = sentinel();
    sparseRows[2] = historyResultRow(historyRows[0]!);
    const accessorResult = { success: true };
    Object.defineProperty(accessorResult, "results", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return [];
      },
    });
    const extraPropertyRows = [
      sentinel(),
      ...historyRows.map(modelResultRow),
      ...historyRows.map(historyResultRow),
    ];
    Object.defineProperty(extraPropertyRows, "unexpected", {
      value: true,
      enumerable: true,
    });
    for (const result of [
      d1Result([accessorRow]),
      d1Result(sparseRows),
      accessorResult,
      { success: true, results: extraPropertyRows },
    ]) {
      const capture: QueryCapture = { events: [] };
      await expectStaticError(
        acquireModelSlugHistoryCandidate(
          fakeDatabase(result, capture),
          createPorts(capture),
        ),
        "integrity_failure",
      );
    }
    expect(getterCalls).toBe(0);
  });

  it("requires a nonempty bookmark after the read and redacts read failures", async () => {
    for (const bookmark of [
      null,
      "",
      "first-primary",
      "first-unconstrained",
      "x".repeat(4_097),
    ] as const) {
      const capture: QueryCapture = { events: [] };
      await expectStaticError(
        acquireModelSlugHistoryCandidate(
          fakeDatabase(validResult(), capture, bookmark),
          createPorts(capture),
        ),
        "read_failure",
      );
      expect(capture.events.indexOf("bookmark")).toBeGreaterThan(
        capture.events.indexOf("all"),
      );
    }

    const capture: QueryCapture = { events: [] };
    const database = {
      withSession() {
        throw new Error(`TOP-SECRET ${PUBLICATION_ID}`);
      },
    } as unknown as D1Database;
    await expectStaticError(
      acquireModelSlugHistoryCandidate(database, createPorts(capture)),
      "read_failure",
    );

    const forgedReadError = new ModelSlugHistoryAcquisitionError(
      "integrity_failure",
    );
    forgedReadError.message = `TOP-SECRET ${PUBLICATION_ID}`;
    const forgedDatabase = {
      withSession() {
        throw forgedReadError;
      },
    } as unknown as D1Database;
    await expectStaticError(
      acquireModelSlugHistoryCandidate(
        forgedDatabase,
        createPorts({ events: [] }),
      ),
      "read_failure",
    );
  });

  it("rejects assembly failures and drain implementations that bypass or substitute the operation", async () => {
    const capture: QueryCapture = { events: [] };
    await expectStaticError(
      acquireModelSlugHistoryCandidate(fakeDatabase(validResult(), capture), {
        ...createPorts(capture),
        assemblePublication() {
          return Promise.reject(new Error(`TOP-SECRET ${PUBLICATION_ID}`));
        },
      }),
      "assembly_failure",
    );

    const bypassCapture: QueryCapture = { events: [] };
    await expectStaticError(
      acquireModelSlugHistoryCandidate(
        fakeDatabase(validResult(), bypassCapture),
        {
          ...createPorts(bypassCapture),
          withWriterDrain<T>() {
            return Promise.resolve(assembly as T);
          },
        },
      ),
      "configuration_invalid",
    );

    const substituteCapture: QueryCapture = { events: [] };
    let rejectedCandidate: unknown;
    await expectStaticError(
      acquireModelSlugHistoryCandidate(
        fakeDatabase(validResult(), substituteCapture),
        {
          ...createPorts(substituteCapture),
          async withWriterDrain<T>(operation: () => Promise<T>) {
            rejectedCandidate = await operation();
            return Object.freeze({}) as T;
          },
        },
      ),
      "configuration_invalid",
    );
    expect(() => {
      assertModelSlugHistoryCandidateCapture(rejectedCandidate);
    }).toThrow("not trusted");

    const forgedDrainError = new ModelSlugHistoryAcquisitionError(
      "read_failure",
    );
    forgedDrainError.message = `TOP-SECRET ${PUBLICATION_ID}`;
    await expectStaticError(
      acquireModelSlugHistoryCandidate(
        fakeDatabase(validResult(), { events: [] }),
        {
          ...createPorts({ events: [] }),
          withWriterDrain() {
            return Promise.reject(forgedDrainError);
          },
        },
      ),
      "configuration_invalid",
    );
  });

  it("maps closure/projector disagreement to a static integrity failure", async () => {
    const capture: QueryCapture = { events: [] };
    await expectStaticError(
      acquireModelSlugHistoryCandidate(
        fakeDatabase(validResult(), capture),
        createPorts(capture, {
          manifest: assembly.manifest,
          resources: assembly.resources.slice(1),
        }),
      ),
      "integrity_failure",
    );
    expect(capture.events).not.toContain("session");
  });

  it("requires canonical model.slug, boundary history, and manifest resource agreement", async () => {
    const capture: QueryCapture = { events: [] };
    const mismatchedModelRows = historyRows.map(modelResultRow);
    const firstModelRow = mismatchedModelRows[0];
    if (firstModelRow === undefined) throw new Error("fixture lacks a Model");
    mismatchedModelRows[0] = {
      ...firstModelRow,
      slug: "canonical-table-disagreement",
    };
    await expectStaticError(
      acquireModelSlugHistoryCandidate(
        fakeDatabase(
          d1Result([
            sentinel(),
            ...mismatchedModelRows,
            ...historyRows.map(historyResultRow),
          ]),
          capture,
        ),
        createPorts(capture),
      ),
      "integrity_failure",
    );
  });
});
