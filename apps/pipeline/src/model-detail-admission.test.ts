import { beforeAll, describe, expect, it } from "vitest";

import { MODEL_DETAIL_PUBLIC_MAX_BYTES } from "@quant-clarity/api-core";
import { checkModelContract, type Model } from "@quant-clarity/contracts";
import {
  MODEL_SLUG_MAX_MODELS,
  MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES,
  hashPublicationResourceContent,
} from "@quant-clarity/publication-core";

import {
  MODEL_DETAIL_ADMISSION_METADATA_SQL,
  MODEL_DETAIL_ADMISSION_PAGE_SQL,
  addModelDetailAdmissionBytes,
  admitModelDetailPublication,
} from "./model-detail-admission.js";
import { ServingSwitchError } from "./serving-switch.js";
import { createProviderModelIdSearchFixture } from "../test/provider-model-id-search-fixture.js";

const PUBLICATION_ID = "pub_b3a00000-0000-4000-8000-000000000001";
const SCHEMA_VERSION = "1.13.0";
const UTF8 = new TextEncoder();

const META = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
} satisfies D1Meta;

const result = (rows: readonly unknown[]): D1Result => ({
  success: true,
  meta: META,
  results: [...rows],
});

type Captured = Readonly<{ sql: string; values: readonly unknown[] }>;
const CAPTURE = Symbol("model detail admission statement");
type CapturedStatement = D1PreparedStatement & {
  readonly [CAPTURE]: Captured;
};

const prepared = (
  sql: string,
  values: readonly unknown[] = [],
): D1PreparedStatement =>
  ({
    [CAPTURE]: { sql, values },
    bind: (...next: unknown[]) => prepared(sql, next),
  }) as CapturedStatement;

const fakeSession = (...responses: readonly unknown[][]) => {
  const statements: Captured[] = [];
  let responseIndex = 0;
  const session = {
    prepare: prepared,
    batch(input: D1PreparedStatement[]) {
      expect(input).toHaveLength(1);
      const captured = (input[0] as CapturedStatement)[CAPTURE];
      statements.push(captured);
      const rows = responses[responseIndex];
      responseIndex += 1;
      if (rows === undefined) throw new Error("unexpected D1 batch");
      return Promise.resolve([result(rows)]);
    },
    getBookmark: () => null,
  } as D1DatabaseSession;
  return { session, statements };
};

const canonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const detailBytes = (model: Model): number =>
  UTF8.encode(
    JSON.stringify({
      data: model,
      meta: {
        resource: "models",
        publication_id: PUBLICATION_ID,
        schema_version: SCHEMA_VERSION,
        sort: ["name", "stable_id"],
        filters: {},
      },
    }),
  ).byteLength;

const evidenceId = (index: number): `evd_${string}` =>
  `evd_00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

type ModelResourceRow = Readonly<{
  resource_type: "model";
  resource_id: string;
  resource_json: string;
  content_hash: string;
}>;

let modelRows: ModelResourceRow[];
let baseModel: Model;

beforeAll(async () => {
  const fixture = await createProviderModelIdSearchFixture(
    PUBLICATION_ID,
    Date.parse("2026-08-03T00:00:00.000Z"),
    [],
    false,
    Array.from(
      { length: 65 },
      (_, index) => `Admission Model ${String(index).padStart(3, "0")}`,
    ),
  );
  modelRows = fixture.closureRows.resources
    .filter((row) => row.resource_type === "model")
    .map((row) => ({
      resource_type: "model" as const,
      resource_id: row.resource_id,
      resource_json: row.resource_json,
      content_hash: row.content_hash,
    }))
    .sort((left, right) => left.resource_id.localeCompare(right.resource_id));
  const first = modelRows[0];
  if (first === undefined) throw new Error("missing Model fixture");
  const parsed = JSON.parse(first.resource_json) as unknown;
  if (!checkModelContract(parsed)) throw new Error("invalid Model fixture");
  baseModel = parsed;
});

const admissionRow = (resource: ModelResourceRow) => ({
  resource_id: resource.resource_id,
  content_hash: resource.content_hash,
  resource_json_bytes: UTF8.encode(resource.resource_json).byteLength,
  resource_json: resource.resource_json,
});

const resourceForModel = async (model: Model) => {
  const resourceJson = canonicalJson(model);
  const contentHash = await hashPublicationResourceContent({
    resourceType: "model",
    resourceId: model.model_id,
    resourceJson,
  });
  return {
    resource_type: "model",
    resource_id: model.model_id,
    resource_json: resourceJson,
    content_hash: contentHash,
  } satisfies ModelResourceRow;
};

const modelAtDetailBytes = (targetBytes: number): Model => {
  const model = structuredClone(baseModel);
  if (model.publisher.state !== "known" || model.display_name.state !== "known")
    throw new Error("Model fixture facts must be known");
  model.publisher.value = "x";
  model.display_name.evidence_ids = [evidenceId(0)];
  const oneIdBytes = detailBytes(model);
  model.display_name.evidence_ids = [evidenceId(0), evidenceId(1)];
  const bytesPerId = detailBytes(model) - oneIdBytes;
  const evidenceCount = 1 + Math.floor((targetBytes - oneIdBytes) / bytesPerId);
  model.display_name.evidence_ids = Array.from(
    { length: evidenceCount },
    (_, index) => evidenceId(index),
  );
  const padding = targetBytes - detailBytes(model);
  if (padding < 0 || padding > 199)
    throw new Error("exact ModelDetail fixture drifted");
  model.publisher.value = "x".repeat(1 + padding);
  if (detailBytes(model) !== targetBytes || !checkModelContract(model))
    throw new Error("invalid exact ModelDetail fixture");
  return model;
};

const expectIntegrityFailure = async (operation: Promise<void>) => {
  await expect(operation).rejects.toMatchObject({
    name: "ServingSwitchError",
    code: "integrity_failure",
  });
};

describe("Model detail publication admission", () => {
  it("scans a full 64-row page plus lookahead with a strict keyset and SELECT-only statements", async () => {
    expect(modelRows).toHaveLength(65);
    const rows = modelRows.map(admissionRow);
    const { session, statements } = fakeSession(
      [{ schema_version: SCHEMA_VERSION }],
      rows,
      rows.slice(64),
    );

    await admitModelDetailPublication(session, {
      publicationId: PUBLICATION_ID,
      expectedModelCount: 65,
    });

    expect(statements).toHaveLength(3);
    expect(statements[0]).toEqual({
      sql: MODEL_DETAIL_ADMISSION_METADATA_SQL,
      values: [PUBLICATION_ID],
    });
    expect(statements[1]).toEqual({
      sql: MODEL_DETAIL_ADMISSION_PAGE_SQL,
      values: [PUBLICATION_ID, ""],
    });
    expect(statements[2]).toEqual({
      sql: MODEL_DETAIL_ADMISSION_PAGE_SQL,
      values: [PUBLICATION_ID, modelRows[63]?.resource_id],
    });
    expect(MODEL_DETAIL_ADMISSION_PAGE_SQL).toContain(
      "INDEXED BY publication_resource_lookup_idx",
    );
    expect(MODEL_DETAIL_ADMISSION_PAGE_SQL).toContain("resource_id > ?2");
    expect(MODEL_DETAIL_ADMISSION_PAGE_SQL).toContain("LIMIT 65");
    expect(MODEL_DETAIL_ADMISSION_PAGE_SQL).not.toMatch(/\bOFFSET\b/u);
    expect(
      statements.every(({ sql }) => /^SELECT\b/u.test(sql.trimStart())),
    ).toBe(true);
  });

  it("accepts an exact 65,536-byte representation and rejects 65,537 without truncation", async () => {
    const accepted = await resourceForModel(
      modelAtDetailBytes(MODEL_DETAIL_PUBLIC_MAX_BYTES),
    );
    expect(detailBytes(JSON.parse(accepted.resource_json) as Model)).toBe(
      MODEL_DETAIL_PUBLIC_MAX_BYTES,
    );
    const acceptedSession = fakeSession(
      [{ schema_version: SCHEMA_VERSION }],
      [admissionRow(accepted)],
    );
    await admitModelDetailPublication(acceptedSession.session, {
      publicationId: PUBLICATION_ID,
      expectedModelCount: 1,
    });

    const rejected = await resourceForModel(
      modelAtDetailBytes(MODEL_DETAIL_PUBLIC_MAX_BYTES + 1),
    );
    expect(UTF8.encode(rejected.resource_json).byteLength).toBeLessThanOrEqual(
      MODEL_DETAIL_PUBLIC_MAX_BYTES,
    );
    const rejectedSession = fakeSession(
      [{ schema_version: SCHEMA_VERSION }],
      [admissionRow(rejected)],
    );
    await expectIntegrityFailure(
      admitModelDetailPublication(rejectedSession.session, {
        publicationId: PUBLICATION_ID,
        expectedModelCount: 1,
      }),
    );
    expect(
      rejectedSession.statements.every(({ sql }) =>
        /^SELECT\b/u.test(sql.trimStart()),
      ),
    ).toBe(true);
  });

  it("rejects SQL CASE-null oversized resource JSON before parsing and performs no mutation", async () => {
    const first = modelRows[0];
    if (first === undefined) throw new Error("missing Model fixture");
    const { session, statements } = fakeSession(
      [{ schema_version: SCHEMA_VERSION }],
      [
        {
          resource_id: first.resource_id,
          content_hash: first.content_hash,
          resource_json_bytes: MODEL_DETAIL_PUBLIC_MAX_BYTES + 1,
          resource_json: null,
        },
      ],
    );

    await expectIntegrityFailure(
      admitModelDetailPublication(session, {
        publicationId: PUBLICATION_ID,
        expectedModelCount: 1,
      }),
    );
    expect(MODEL_DETAIL_ADMISSION_PAGE_SQL).toContain(
      `WHEN length(CAST(resource_json AS BLOB)) <= ${String(MODEL_DETAIL_PUBLIC_MAX_BYTES)}`,
    );
    expect(statements).toHaveLength(2);
    expect(
      statements.every(({ sql }) => /^SELECT\b/u.test(sql.trimStart())),
    ).toBe(true);
  });

  it("reconciles the exact expected count and rejects duplicate keyset rows", async () => {
    const first = modelRows[0];
    if (first === undefined) throw new Error("missing Model fixture");
    await expectIntegrityFailure(
      admitModelDetailPublication(
        fakeSession([{ schema_version: SCHEMA_VERSION }], []).session,
        { publicationId: PUBLICATION_ID, expectedModelCount: 1 },
      ),
    );
    await expectIntegrityFailure(
      admitModelDetailPublication(
        fakeSession([{ schema_version: SCHEMA_VERSION }], [admissionRow(first)])
          .session,
        { publicationId: PUBLICATION_ID, expectedModelCount: 0 },
      ),
    );
    await expectIntegrityFailure(
      admitModelDetailPublication(
        fakeSession(
          [{ schema_version: SCHEMA_VERSION }],
          [admissionRow(first), admissionRow(first)],
        ).session,
        { publicationId: PUBLICATION_ID, expectedModelCount: 2 },
      ),
    );
  });

  it("rejects resource hash, Model identity, byte-count, and contract mismatches", async () => {
    const first = modelRows[0];
    if (first === undefined) throw new Error("missing Model fixture");
    const valid = admissionRow(first);
    const differentId = "mdl_b3a00000-0000-4000-8000-000000000099";
    const identityHash = await hashPublicationResourceContent({
      resourceType: "model",
      resourceId: differentId,
      resourceJson: first.resource_json,
    });
    const invalidContractJson = "{}";
    const invalidContractHash = await hashPublicationResourceContent({
      resourceType: "model",
      resourceId: first.resource_id,
      resourceJson: invalidContractJson,
    });
    const hostileRows = [
      { ...valid, content_hash: `sha256:${"0".repeat(64)}` },
      {
        ...valid,
        resource_id: differentId,
        content_hash: identityHash,
      },
      { ...valid, resource_json_bytes: valid.resource_json_bytes + 1 },
      {
        ...valid,
        content_hash: invalidContractHash,
        resource_json: invalidContractJson,
        resource_json_bytes: UTF8.encode(invalidContractJson).byteLength,
      },
    ];

    for (const hostileRow of hostileRows)
      await expectIntegrityFailure(
        admitModelDetailPublication(
          fakeSession([{ schema_version: SCHEMA_VERSION }], [hostileRow])
            .session,
          { publicationId: PUBLICATION_ID, expectedModelCount: 1 },
        ),
      );
  });

  it("rejects above the model-count ceiling before D1 and permits the exact ceiling to reach reconciliation", async () => {
    const above = fakeSession();
    await expectIntegrityFailure(
      admitModelDetailPublication(above.session, {
        publicationId: PUBLICATION_ID,
        expectedModelCount: MODEL_SLUG_MAX_MODELS + 1,
      }),
    );
    expect(above.statements).toEqual([]);

    const exact = fakeSession([{ schema_version: SCHEMA_VERSION }], []);
    await expectIntegrityFailure(
      admitModelDetailPublication(exact.session, {
        publicationId: PUBLICATION_ID,
        expectedModelCount: MODEL_SLUG_MAX_MODELS,
      }),
    );
    expect(exact.statements).toHaveLength(2);
  });

  it("accepts exactly the aggregate byte ceiling and rejects the next byte", () => {
    expect(
      addModelDetailAdmissionBytes(MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES - 2, 2),
    ).toBe(MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES);
    expect(() =>
      addModelDetailAdmissionBytes(MODEL_SLUG_MAX_TOTAL_RESOURCE_BYTES, 1),
    ).toThrow(new ServingSwitchError("integrity_failure"));
  });

  it("accounts for multibyte UTF-8 resource bytes rather than characters", async () => {
    const model = structuredClone(baseModel);
    if (model.publisher.state !== "known")
      throw new Error("Model fixture publisher must be known");
    model.publisher.value = "Mödel";
    const resource = await resourceForModel(model);
    expect(resource.resource_json.length).toBeLessThan(
      UTF8.encode(resource.resource_json).byteLength,
    );
    const valid = admissionRow(resource);
    await expectIntegrityFailure(
      admitModelDetailPublication(
        fakeSession(
          [{ schema_version: SCHEMA_VERSION }],
          [{ ...valid, resource_json_bytes: resource.resource_json.length }],
        ).session,
        { publicationId: PUBLICATION_ID, expectedModelCount: 1 },
      ),
    );
    await admitModelDetailPublication(
      fakeSession([{ schema_version: SCHEMA_VERSION }], [valid]).session,
      { publicationId: PUBLICATION_ID, expectedModelCount: 1 },
    );
  });

  it("normalizes a hostile D1 envelope to a static integrity failure", async () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const session = {
      prepare: prepared,
      batch: () => Promise.resolve([revoked.proxy]),
      getBookmark: () => null,
    } as unknown as D1DatabaseSession;

    await expectIntegrityFailure(
      admitModelDetailPublication(session, {
        publicationId: PUBLICATION_ID,
        expectedModelCount: 0,
      }),
    );
  });
});
