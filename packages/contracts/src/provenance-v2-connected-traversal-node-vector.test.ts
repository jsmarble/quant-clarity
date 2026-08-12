import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH,
  PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS,
  PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
} from "./index.js";

interface Field {
  readonly name: string;
  readonly tag: "null" | "text" | "integer" | "boolean" | "digest";
  readonly value: string | boolean | null;
}
interface Row {
  readonly row_id: string;
  readonly table: string;
  readonly fields: readonly Field[];
}
interface EncodableField {
  readonly tag: "null" | "text" | "integer" | "boolean" | "digest";
  readonly value: string | boolean | null;
}
interface CollectionDigestBinding {
  readonly kind: "collection_digest";
  readonly traversal: string;
}
interface RowDigestBinding {
  readonly kind: "row_digest";
  readonly table: string;
  readonly digest_column: string;
  readonly joins: readonly {
    readonly local_column: string;
    readonly remote_column: string;
  }[];
}
interface SuccessorProjectionMapping {
  readonly target: string;
  readonly table: string;
  readonly column: string;
  readonly conversion: "identity" | "safe_integer";
  readonly cardinality: "exactly_one";
}
const normalizedProjectionMappings = [
  [
    "authority_plan_id",
    "authority_plan_id",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "run_plan_id",
    "run_plan_id",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "installation_id",
    "installation_id",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "provider_ordinal",
    "provider_ordinal",
    "safe_integer",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "provider_id",
    "provider_id",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "provider_organization_id",
    "provider_organization_id",
    "identity",
    "provenance_v2_source_owner_receipt",
  ],
  [
    "legacy_adapter_contract_version",
    "adapter_contract_version",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "legacy_adapter_version",
    "adapter_version",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "adapter_manifest_hash",
    "adapter_manifest_hash",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "roster_version",
    "roster_version",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "roster_content_hash",
    "roster_content_hash",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "source_register_version",
    "source_register_version",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "source_register_artifact_hash",
    "source_artifact_hash",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "source_policy_version",
    "source_policy_version",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "parser_version",
    "parser_version",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
  [
    "extraction_policy_version",
    "extraction_policy_version",
    "identity",
    "provenance_v2_adapter_manifest_receipt",
  ],
] as const;
const ceilingProjectionMappings = [
  ["request_ceiling", "request_ceiling"],
  ["byte_ceiling", "byte_ceiling"],
  ["ai_token_ceiling", "ai_token_ceiling"],
  ["browser_millisecond_ceiling", "browser_millisecond_ceiling"],
  ["elapsed_millisecond_ceiling", "elapsed_millisecond_ceiling"],
  ["cost_microusd_ceiling", "cost_microusd_ceiling"],
] as const;
const independentProjection = {
  scope_columns: ["authority_plan_id", "provider_id"],
  literals: ["contract_version", "canonical_json_version"],
  normalized_row_fields: normalizedProjectionMappings.map(
    ([target, column, conversion, table]) => ({
      target,
      table,
      column,
      conversion,
      cardinality: "exactly_one" as const,
    }),
  ),
  ceiling_fields: ceilingProjectionMappings.map(([target, column]) => ({
    target,
    table: "provenance_v2_adapter_manifest_receipt",
    column,
    conversion: "safe_integer" as const,
    cardinality: "exactly_one" as const,
  })),
  successor_claim_fields:
    PROVENANCE_V2_ROOT_BINDING_PLAN.successor_claim_bindings.map(
      (binding) => binding.field,
    ),
};
const digestBinding = (
  value: unknown,
): CollectionDigestBinding | RowDigestBinding =>
  value as CollectionDigestBinding | RowDigestBinding;

const rows = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows as readonly Row[];
const graphScope = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.selected_scope;
const unsigned = (bytes: number, value: bigint): Buffer => {
  const result = Buffer.alloc(bytes);
  if (bytes === 2) result.writeUInt16BE(Number(value));
  else if (bytes === 4) result.writeUInt32BE(Number(value));
  else result.writeBigUInt64BE(value);
  return result;
};
const payload = (field: EncodableField): Buffer => {
  if (field.tag === "null") return Buffer.alloc(0);
  if (field.tag === "boolean") return Buffer.from([field.value ? 1 : 0]);
  if (field.tag === "digest")
    return Buffer.from(String(field.value).slice(7), "hex");
  return Buffer.from(String(field.value), "utf8");
};
const tags = { null: 0, text: 1, integer: 2, boolean: 3, digest: 4 } as const;
const frame = (domain: string, fields: readonly EncodableField[]): Buffer => {
  const domainBytes = Buffer.from(domain, "ascii");
  return Buffer.concat([
    Buffer.from("514350563201", "hex"),
    unsigned(2, BigInt(domainBytes.length)),
    domainBytes,
    unsigned(4, BigInt(fields.length)),
    ...fields.flatMap((field) => {
      const bytes = payload(field);
      return [
        Buffer.from([tags[field.tag]]),
        unsigned(8, BigInt(bytes.length)),
        bytes,
      ];
    }),
  ]);
};
const sha256 = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fieldMap = (row: Row): ReadonlyMap<string, Field> =>
  new Map(row.fields.map((field) => [field.name, field]));
const requireField = (row: Row, name: string): Field => {
  const result = fieldMap(row).get(name);
  if (result === undefined) throw new Error("missing declared row field");
  return result;
};
const replaceDigest = (row: Row, name: string, value: string): Row => ({
  ...row,
  fields: row.fields.map((field) =>
    field.name === name ? { ...field, tag: "digest", value } : field,
  ),
});

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0))
      throw new Error("invalid canonical integer");
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    if (value !== value.normalize("NFC") || /[\ud800-\udfff]/u.test(value))
      throw new Error("invalid canonical text");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value !== "object") throw new Error("invalid canonical value");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const buildSuccessorManifest = (
  inputRows: readonly Row[],
  successorClaims: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const projection = independentProjection;
  const output: Record<string, unknown> = {
    contract_version: "provenance-v2-successor-manifest@1",
    canonical_json_version: "quantclarity-canonical-json@1",
  };
  const resolve = (mapping: SuccessorProjectionMapping) => {
    const matches = inputRows.filter(
      (row) =>
        row.table === mapping.table &&
        requireField(row, "authority_plan_id").value ===
          graphScope.authority_plan_id &&
        requireField(row, "provider_id").value === graphScope.provider_id,
    );
    if (matches.length !== 1)
      throw new Error("successor projection cardinality");
    const value = requireField(matches[0]!, mapping.column).value;
    return mapping.conversion === "safe_integer" ? Number(value) : value;
  };
  for (const mapping of projection.normalized_row_fields)
    output[mapping.target] = resolve(mapping);
  const ceilings: Record<string, unknown> = {};
  for (const mapping of projection.ceiling_fields)
    ceilings[mapping.target] = resolve(mapping);
  output.admitted_run_plan_ceilings = ceilings;
  for (const name of projection.successor_claim_fields) {
    if (!Object.hasOwn(successorClaims, name))
      throw new Error("missing successor claim");
    output[name] = successorClaims[name];
  }
  return output;
};
const utf8Compare = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const registryByTable = new Map(
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.map((entry) => [
    entry.table,
    entry,
  ]),
);
const graphDigestBindings =
  PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter((binding) =>
    rows.some(
      (row) =>
        row.table === binding.table &&
        row.fields.some((field) => field.name === binding.field),
    ),
  );
const graphTopLevelBindings = graphDigestBindings.filter(
  (binding) => binding.hash_class === "top_level_root",
);
const canonicalRowsById = new Map(rows.map((row) => [row.row_id, row]));
const planSourceByTable = new Map(
  PROVENANCE_V2_ROOT_BINDING_PLAN.traversals
    .filter((traversal) => traversal.purpose === "plan_root")
    .flatMap((traversal) =>
      traversal.sources.map((source) => [source.table, source] as const),
    ),
);

const hashLeaf = (row: Row): string => {
  const registry = registryByTable.get(row.table);
  if (registry?.leaf_domain === null || registry?.leaf_domain === undefined)
    throw new Error("missing leaf registry");
  const declared = registry.fields.filter(
    (field) => field.name !== registry.digest_output,
  );
  expect(row.fields.map((field) => field.name)).toEqual(
    declared.map((field) => field.name),
  );
  for (const [index, field] of row.fields.entries()) {
    const expected = declared[index];
    if (expected === undefined) throw new Error("missing leaf field contract");
    expect(field.tag === "null" ? expected.nullable : true).toBe(true);
    expect(field.tag === "null" ? "null" : field.tag).toBe(
      field.tag === "null" ? "null" : expected.frame_type,
    );
    if (field.tag === "text")
      expect(
        typeof field.value === "string" &&
          field.value === field.value.normalize("NFC") &&
          !/[\ud800-\udfff]/u.test(field.value),
      ).toBe(true);
    if (field.tag === "integer") {
      expect(typeof field.value).toBe("string");
      expect(field.value).toMatch(/^(?:0|[1-9][0-9]{0,15})$/u);
      expect(BigInt(field.value as string)).toBeLessThanOrEqual(
        BigInt(Number.MAX_SAFE_INTEGER),
      );
    }
    if (field.tag === "null") expect(field.value).toBeNull();
    if (field.tag === "boolean") expect(typeof field.value).toBe("boolean");
    if (field.tag === "digest")
      expect(field.value).toMatch(/^sha256:[0-9a-f]{64}$/u);
  }
  return sha256(frame(registry.leaf_domain, row.fields));
};

type Traversal = (typeof PROVENANCE_V2_ROOT_BINDING_PLAN.traversals)[number];
interface Projection {
  readonly sourceOrdinal: number;
  readonly table: string;
  readonly rowId: string;
  readonly leafDigest: string;
  readonly digest: string;
}
interface TraversalResult {
  readonly projections: readonly Projection[];
  readonly digest: string;
  readonly rowManifestDigest: string;
}

const compareRows = (
  left: Row,
  right: Row,
  source: Traversal["sources"][number],
): number => {
  for (const order of source.order_by) {
    const leftField = requireField(left, order.column);
    const rightField = requireField(right, order.column);
    let comparison: number;
    if (order.comparison === "integer") {
      const leftValue = BigInt(String(leftField.value));
      const rightValue = BigInt(String(rightField.value));
      comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    } else {
      comparison = utf8Compare(
        String(leftField.value),
        String(rightField.value),
      );
    }
    if (comparison !== 0) return comparison;
  }
  return 0;
};

const runTraversal = (
  traversal: Traversal,
  leafDigests: ReadonlyMap<string, string>,
  inputRows: readonly Row[] = rows,
): TraversalResult => {
  const projections: Projection[] = [];
  for (const source of [...traversal.sources].sort(
    (left, right) => left.ordinal - right.ordinal,
  )) {
    const selected = inputRows.filter((row) => {
      if (row.table !== source.table) return false;
      if (source.scope_binding.kind === "global_contract") return true;
      return source.scope_binding.joins.every(
        (join) =>
          requireField(row, join.row_column).value ===
          graphScope[join.scope_column as keyof typeof graphScope],
      );
    });
    selected.sort((left, right) => compareRows(left, right, source));
    for (let index = 1; index < selected.length; index += 1)
      if (compareRows(selected[index - 1]!, selected[index]!, source) === 0)
        throw new Error("duplicate complete order tuple");
    if (
      (source.cardinality === "one" && selected.length !== 1) ||
      (source.cardinality === "zero_or_one" && selected.length > 1)
    )
      throw new Error("source cardinality mismatch");
    for (const row of selected) {
      const leafDigest = leafDigests.get(row.row_id);
      if (leafDigest === undefined) throw new Error("missing leaf output");
      const projectionDigest = sha256(
        frame(
          PROVENANCE_V2_ROOT_BINDING_PLAN.traversal_contract
            .member_projection_domain,
          [
            { tag: "integer", value: String(source.ordinal) },
            { tag: "text", value: source.family_tag },
            { tag: "digest", value: leafDigest },
          ],
        ),
      );
      projections.push({
        sourceOrdinal: source.ordinal,
        table: source.table,
        rowId: row.row_id,
        leafDigest,
        digest: projectionDigest,
      });
    }
  }
  if (traversal.zero_members === "rejected" && projections.length === 0)
    throw new Error("empty traversal");
  const scopeFields: EncodableField[] = traversal.scope_columns.map(
    (column) => ({
      tag: "text",
      value: graphScope[column as keyof typeof graphScope],
    }),
  );
  const collection = frame(traversal.domain, [
    ...scopeFields,
    { tag: "integer", value: String(projections.length) },
    ...projections.map((projection) => ({
      tag: "digest" as const,
      value: projection.digest,
    })),
  ]);
  const rowManifest = frame(
    "provenance-v2-connected-ordered-row-id-manifest@1",
    [
      { tag: "integer", value: String(projections.length) },
      ...projections.map((projection) => ({
        tag: "text" as const,
        value: projection.rowId,
      })),
    ],
  );
  return {
    projections,
    digest: sha256(collection),
    rowManifestDigest: sha256(rowManifest),
  };
};

const compute = (inputRows: readonly Row[] = rows) => {
  if (new Set(inputRows.map((row) => row.row_id)).size !== inputRows.length)
    throw new Error("duplicate row identity");
  expect(
    inputRows.flatMap((row) =>
      row.fields.filter(
        (field) =>
          field.tag === "digest" &&
          graphDigestBindings.some(
            (binding) =>
              binding.table === row.table &&
              binding.field === field.name &&
              binding.hash_class === "safe_preimage",
          ),
      ),
    ),
  ).toHaveLength(30);
  expect(
    inputRows.flatMap((row) =>
      row.fields.filter(
        (field) =>
          field.tag === "digest" &&
          graphDigestBindings.some(
            (binding) =>
              binding.table === row.table &&
              binding.field === field.name &&
              binding.hash_class === "external_anchor",
          ),
      ),
    ),
  ).toHaveLength(10);
  expect(graphTopLevelBindings).toHaveLength(3);
  for (const row of inputRows) {
    const canonical = canonicalRowsById.get(row.row_id);
    const source = planSourceByTable.get(row.table);
    if (
      canonical === undefined ||
      source === undefined ||
      canonical.table !== row.table
    )
      throw new Error("unknown row identity");
    for (const order of source.order_by)
      if (
        requireField(canonical, order.column).value !==
        requireField(row, order.column).value
      )
        throw new Error("row identity tuple mismatch");
  }
  const leafDigests = new Map<string, string>();
  const dependentRows = new Set([
    "row-adapter_manifest_receipt-receipt",
    "row-source_register_receipt-receipt",
    "row-source_endpoint_registration-registration",
  ]);
  for (const row of inputRows)
    if (!dependentRows.has(row.row_id))
      leafDigests.set(row.row_id, hashLeaf(row));

  const memberBinding = graphTopLevelBindings.find(
    (binding) =>
      binding.table === "provenance_v2_source_register_receipt" &&
      binding.field === "member_set_root",
  );
  if (memberBinding === undefined) throw new Error("missing member binding");
  const memberBindingValue = digestBinding(memberBinding.binding);
  if (memberBindingValue.kind !== "collection_digest")
    throw new Error("missing member collection binding");
  const memberTraversal = PROVENANCE_V2_ROOT_BINDING_PLAN.traversals.find(
    (item) => item.name === memberBindingValue.traversal,
  );
  if (memberTraversal === undefined)
    throw new Error("missing member traversal");
  const memberResult = runTraversal(memberTraversal, leafDigests, inputRows);
  const receiptInput = inputRows.find(
    (row) => row.row_id === "row-source_register_receipt-receipt",
  );
  const endpointRegistrationInput = inputRows.find(
    (row) => row.row_id === "row-source_endpoint_registration-registration",
  );
  if (receiptInput === undefined || endpointRegistrationInput === undefined)
    throw new Error("missing dependent leaf");
  expect(requireField(receiptInput, "member_count").value).toBe(
    String(memberResult.projections.length),
  );
  const receipt = replaceDigest(
    receiptInput,
    "member_set_root",
    memberResult.digest,
  );
  const receiptDigest = hashLeaf(receipt);
  leafDigests.set(receipt.row_id, receiptDigest);

  const resolveRowDigest = (targetField: string): string => {
    const declared = graphTopLevelBindings.find(
      (binding) =>
        binding.table === endpointRegistrationInput.table &&
        binding.field === targetField,
    );
    if (declared === undefined)
      throw new Error("missing row-digest declaration");
    const declaredBinding = digestBinding(declared.binding);
    if (declaredBinding.kind !== "row_digest")
      throw new Error("missing row-digest binding");
    const matches = inputRows.filter(
      (candidate) =>
        candidate.table === declaredBinding.table &&
        declaredBinding.joins.every(
          (join) =>
            requireField(endpointRegistrationInput, join.local_column).value ===
            requireField(candidate, join.remote_column).value,
        ),
    );
    if (matches.length !== 1)
      throw new Error("row-digest cardinality mismatch");
    const digest = leafDigests.get(matches[0]!.row_id);
    if (digest === undefined) throw new Error("missing derived link output");
    return digest;
  };
  const endpointDigest = resolveRowDigest("endpoint_content_hash");
  const manifestSourceDigest = resolveRowDigest("manifest_source_hash");
  const endpointRegistration = replaceDigest(
    replaceDigest(
      endpointRegistrationInput,
      "endpoint_content_hash",
      endpointDigest,
    ),
    "manifest_source_hash",
    manifestSourceDigest,
  );
  leafDigests.set(endpointRegistration.row_id, hashLeaf(endpointRegistration));
  const childTraversalResults = new Map<string, TraversalResult>();
  for (const binding of PROVENANCE_V2_ROOT_BINDING_PLAN.successor_claim_bindings)
    if (
      binding.kind !== "row_digest" &&
      !childTraversalResults.has(binding.traversal)
    ) {
      const traversal = PROVENANCE_V2_ROOT_BINDING_PLAN.traversals.find(
        (item) => item.name === binding.traversal,
      );
      if (traversal === undefined)
        throw new Error("missing successor traversal");
      childTraversalResults.set(
        binding.traversal,
        binding.traversal === memberTraversal.name
          ? memberResult
          : runTraversal(traversal, leafDigests, inputRows),
      );
    }
  const successorClaims = Object.fromEntries(
    PROVENANCE_V2_ROOT_BINDING_PLAN.successor_claim_bindings.map((binding) => {
      if (binding.kind === "row_digest") {
        const matches = inputRows.filter(
          (row) =>
            row.table === binding.table &&
            binding.scope_joins.every(
              (join) =>
                requireField(row, join.row_column).value ===
                graphScope[join.scope_column as keyof typeof graphScope],
            ),
        );
        if (matches.length !== 1)
          throw new Error("successor row digest binding mismatch");
        const digest = leafDigests.get(matches[0]!.row_id);
        if (digest === undefined)
          throw new Error("missing successor row digest output");
        return [binding.field, digest];
      }
      const traversal = childTraversalResults.get(binding.traversal);
      if (traversal === undefined)
        throw new Error("missing successor traversal output");
      return [
        binding.field,
        binding.kind === "count"
          ? traversal.projections.length
          : traversal.digest,
      ];
    }),
  );
  const successorManifest = buildSuccessorManifest(inputRows, successorClaims);
  const successorCanonicalJson = canonicalJson(successorManifest);
  const successorManifestHash = sha256(
    Buffer.from(successorCanonicalJson, "utf8"),
  );
  const adapterReceiptInput = inputRows.find(
    (row) => row.row_id === "row-adapter_manifest_receipt-receipt",
  )!;
  const storedSuccessorManifestHash = requireField(
    adapterReceiptInput,
    "successor_manifest_hash",
  );
  if (
    storedSuccessorManifestHash.tag !== "digest" ||
    typeof storedSuccessorManifestHash.value !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(storedSuccessorManifestHash.value)
  )
    throw new Error("invalid stored successor manifest field");
  const storedSuccessorManifestDigest = storedSuccessorManifestHash.value;
  if (storedSuccessorManifestDigest !== successorManifestHash)
    throw new Error("stored successor manifest digest mismatch");
  const recomputedAdapterReceiptDigest = hashLeaf(
    replaceDigest(
      adapterReceiptInput,
      "successor_manifest_hash",
      successorManifestHash,
    ),
  );
  leafDigests.set(adapterReceiptInput.row_id, recomputedAdapterReceiptDigest);
  expect(leafDigests.size).toBe(371);

  const traversalResults = new Map<string, TraversalResult>();
  for (const traversal of PROVENANCE_V2_ROOT_BINDING_PLAN.traversals)
    traversalResults.set(
      traversal.name,
      traversal.name === "source_register_member_set_root"
        ? memberResult
        : runTraversal(traversal, leafDigests, inputRows),
    );
  const planRows = PROVENANCE_V2_ROOT_BINDING_PLAN.traversals
    .filter((traversal) => traversal.purpose === "plan_root")
    .flatMap(
      (traversal) => traversalResults.get(traversal.name)?.projections ?? [],
    );
  expect(planRows).toHaveLength(371);
  expect(new Set(planRows.map((item) => item.rowId)).size).toBe(371);
  const consumedPlanRows = new Set(planRows.map((item) => item.rowId));
  if (
    inputRows.some((row) => !consumedPlanRows.has(row.row_id)) ||
    consumedPlanRows.size !== inputRows.length
  )
    throw new Error("unconsumed row");
  const leafManifest = frame("provenance-v2-connected-leaf-manifest@1", [
    { tag: "integer", value: String(leafDigests.size) },
    ...[...leafDigests.entries()]
      .sort(([left], [right]) => utf8Compare(left, right))
      .flatMap(([rowId, digest]) => [
        { tag: "text" as const, value: rowId },
        { tag: "digest" as const, value: digest },
      ]),
  ]);
  const authorityContract = PROVENANCE_V2_ROOT_BINDING_PLAN.record_frames.find(
    (item) => item.name === "authority_root",
  );
  const receiptContract = PROVENANCE_V2_ROOT_BINDING_PLAN.record_frames.find(
    (item) => item.name === "oracle_receipt_hash",
  );
  if (authorityContract === undefined || receiptContract === undefined)
    throw new Error("missing record frame contract");
  expect(authorityContract.fields.map((item) => item.ordinal)).toEqual(
    Array.from({ length: 22 }, (_, ordinal) => ordinal),
  );
  expect(receiptContract.fields.map((item) => item.ordinal)).toEqual(
    Array.from({ length: 6 }, (_, ordinal) => ordinal),
  );
  expect(
    PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_authority_frame.fields.map(
      (item) => ({ name: item.name, tag: item.tag }),
    ),
  ).toEqual(
    authorityContract.fields.map((item) => ({
      name: item.name,
      tag: item.frame_type,
    })),
  );
  expect(
    new Set(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_authority_frame.fields.map(
        (item) => item.name,
      ),
    ).size,
  ).toBe(authorityContract.fields.length);
  expect(
    PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_refused_receipt_frame.fields.map(
      (item) => ({ name: item.name, tag: item.tag }),
    ),
  ).toEqual(
    receiptContract.fields.map((item) => ({
      name: item.name,
      tag: item.frame_type,
    })),
  );
  expect(
    new Set(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_refused_receipt_frame.fields.map(
        (item) => item.name,
      ),
    ).size,
  ).toBe(receiptContract.fields.length);
  const authorityFixture = new Map(
    PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_authority_frame.fields.map(
      (item) => [item.name, item],
    ),
  );
  const authorityFields = authorityContract.fields.map(
    (binding): EncodableField => {
      const fixture = authorityFixture.get(binding.name);
      if (fixture?.tag !== binding.frame_type)
        throw new Error("authority fixture layout mismatch");
      return {
        tag: binding.frame_type,
        value:
          binding.source.kind === "collection"
            ? (traversalResults.get(binding.source.traversal)?.digest ?? "")
            : fixture.value,
      };
    },
  );
  const authority = frame(authorityContract.domain, authorityFields);
  const authorityDigest = sha256(authority);
  const receiptFixture = new Map(
    PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_refused_receipt_frame.fields.map(
      (item) => [item.name, item],
    ),
  );
  const receiptFields = receiptContract.fields.map(
    (binding): EncodableField => {
      const fixture = receiptFixture.get(binding.name);
      if (fixture?.tag !== binding.frame_type)
        throw new Error("receipt fixture layout mismatch");
      return {
        tag: binding.frame_type,
        value:
          binding.name === "authority_root" ? authorityDigest : fixture.value,
      };
    },
  );
  const refusedReceipt = frame(receiptContract.domain, receiptFields);
  return {
    substitutions: [memberResult.digest, endpointDigest, manifestSourceDigest],
    receiptDigest,
    leafManifestDigest: sha256(leafManifest),
    traversalResults,
    authorityHex: authority.toString("hex"),
    authorityDigest,
    receiptHex: refusedReceipt.toString("hex"),
    receiptFrameDigest: sha256(refusedReceipt),
    leafDigests,
    successorClaims,
    successorManifest,
    successorCanonicalJson,
    successorManifestHash,
    storedSuccessorManifestHash: storedSuccessorManifestDigest,
    recomputedAdapterReceiptDigest,
  };
};

describe("independent Node connected provenance-v2 traversal vectors", () => {
  it("recomputes all connected leaves, projections, traversals, and derived links", () => {
    const result = compute();
    expect(
      PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.projection_plan,
    ).toEqual(independentProjection);
    expect(result.substitutions).toEqual(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.derived_digest_substitutions.map(
        (item) => item.computed_digest,
      ),
    );
    expect(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.derived_digest_substitutions,
    ).toEqual(
      graphTopLevelBindings.map((binding, index) => {
        const target = rows.find((row) => row.table === binding.table);
        if (target === undefined) throw new Error("missing binding target row");
        const bindingValue = digestBinding(binding.binding);
        return {
          target_row_id: target.row_id,
          target_field: binding.field,
          source_kind: bindingValue.kind,
          source_name:
            bindingValue.kind === "collection_digest"
              ? bindingValue.traversal
              : `${bindingValue.table}.${bindingValue.digest_column}`,
          computed_digest: result.substitutions[index],
        };
      }),
    );
    expect(result.receiptDigest).toBe(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_successor_claims
        .source_register_receipt_hash,
    );
    expect(result.successorClaims).toEqual(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_successor_claims,
    );
    expect(result.successorManifest).toEqual(
      PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.successor_manifest,
    );
    expect(result.successorCanonicalJson).toBe(
      PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.canonical_preimage
        .canonical_json,
    );
    expect(Buffer.byteLength(result.successorCanonicalJson, "utf8")).toBe(
      PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.canonical_preimage
        .utf8_byte_length,
    );
    expect(
      Buffer.from(result.successorCanonicalJson, "utf8").toString("hex"),
    ).toBe(
      PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.canonical_preimage
        .canonical_utf8_hex,
    );
    expect(result.successorManifestHash).toBe(
      PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.canonical_preimage
        .sha256,
    );
    expect(result.leafManifestDigest).toBe(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.leaf_output_manifest.sha256,
    );
    for (const expected of PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.traversals) {
      const actual = result.traversalResults.get(expected.name);
      expect(actual?.projections.length, expected.name).toBe(
        expected.member_count,
      );
      expect(actual?.rowManifestDigest, expected.name).toBe(
        expected.ordered_row_id_manifest_sha256,
      );
      expect(actual?.digest, expected.name).toBe(expected.collection_sha256);
    }
    expect({
      authorityHex: result.authorityHex,
      authorityDigest: result.authorityDigest,
      receiptHex: result.receiptHex,
      receiptFrameDigest: result.receiptFrameDigest,
    }).toEqual({
      authorityHex:
        PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_authority_frame
          .frame_hex,
      authorityDigest:
        PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_authority_frame
          .sha256,
      receiptHex:
        PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS
          .candidate_refused_receipt_frame.frame_hex,
      receiptFrameDigest:
        PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS
          .candidate_refused_receipt_frame.sha256,
    });
    const adapterRoot = result.traversalResults.get(
      "adapter_manifest_set_root",
    )?.digest;
    expect(
      PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.adapter_receipt_fixture_parity,
    ).toEqual({
      row_id: "row-adapter_manifest_receipt-receipt",
      target_field: "successor_manifest_hash",
      stored_digest: result.storedSuccessorManifestHash,
      computed_digest: result.successorManifestHash,
      fixture_digest_equal: true,
      leaf_domain: "provenance-v2-adapter-receipt-leaf@1",
      recomputed_manifest_content_hash: result.recomputedAdapterReceiptDigest,
    });
    expect(
      PROVENANCE_V2_CONNECTED_SUCCESSOR_MANIFEST_VECTORS.downstream_cascade,
    ).toEqual({
      leaf_manifest_sha256: result.leafManifestDigest,
      adapter_manifest_set_root: adapterRoot,
      endpoint_set_root_unchanged:
        result.traversalResults.get("endpoint_set_root")?.digest,
      verifier_policy_set_root_unchanged: result.traversalResults.get(
        "verifier_policy_set_root",
      )?.digest,
      field_policy_set_root_unchanged: result.traversalResults.get(
        "field_policy_set_root",
      )?.digest,
      candidate_authority_root: result.authorityDigest,
      candidate_refused_receipt_hash: result.receiptFrameDigest,
    });
  });

  it("is invariant to caller row order and uses numeric credential ordering", () => {
    const forward = compute();
    const reverse = compute([...rows].reverse());
    expect(
      [...reverse.traversalResults].map(([name, value]) => [
        name,
        value.digest,
        value.rowManifestDigest,
      ]),
    ).toEqual(
      [...forward.traversalResults].map(([name, value]) => [
        name,
        value.digest,
        value.rowManifestDigest,
      ]),
    );
    const credentials = forward.traversalResults.get("credential_set_root");
    expect(
      credentials?.projections.map(
        (projection) =>
          requireField(
            rows.find((row) => row.row_id === projection.rowId)!,
            "ordinal",
          ).value,
      ),
    ).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(["é", "z"].sort((left, right) => utf8Compare(left, right))).toEqual([
      "z",
      "é",
    ]);
  });

  it("rejects missing, duplicate, extra, and complete-order-collision rows", () => {
    expect(() => compute(rows.slice(1))).toThrow();
    expect(() => compute([...rows, rows[0]!])).toThrow();
    const foreign = structuredClone(rows[0]!) as unknown as {
      row_id: string;
      fields: {
        name: string;
        tag: Field["tag"];
        value: string | boolean | null;
      }[];
      table: string;
    };
    foreign.row_id = "row-source_owner_receipt-foreign-plan";
    foreign.fields.find((field) => field.name === "authority_plan_id")!.value =
      "vpa_99999999-9999-4999-8999-999999999999";
    expect(() => compute([...rows, foreign as unknown as Row])).toThrow();
    const shadow = structuredClone(rows[0]!) as unknown as {
      row_id: string;
      fields: { name: string; value: string | boolean | null }[];
    };
    shadow.fields.find((item) => item.name === "authority_plan_id")!.value =
      "vpa_99999999-9999-4999-8999-999999999999";
    expect(() => compute([...rows, shadow as unknown as Row])).toThrow(
      "duplicate row identity",
    );

    const collision = structuredClone(
      rows.find(
        (row) => row.row_id === "row-adapter_manifest_credential-credential-0",
      )!,
    ) as unknown as { row_id: string } & Row;
    collision.row_id = "row-adapter_manifest_credential-order-collision";
    const withoutLastCredential = rows.filter(
      (row) => row.row_id !== "row-adapter_manifest_credential-credential-10",
    );
    const credentialTraversal = PROVENANCE_V2_ROOT_BINDING_PLAN.traversals.find(
      (item) => item.name === "credential_set_root",
    )!;
    const collisionDigests = new Map(compute().leafDigests);
    collisionDigests.set(
      collision.row_id,
      collisionDigests.get("row-adapter_manifest_credential-credential-0")!,
    );
    expect(() =>
      runTraversal(credentialTraversal, collisionDigests, [
        ...withoutLastCredential,
        collision,
      ]),
    ).toThrow("duplicate complete order tuple");
  });

  it("treats unresolved digests as inputs without promoting their authority", () => {
    const mutated = structuredClone(rows) as unknown as Row[];
    const owner = mutated.find(
      (row) => row.table === "provenance_v2_source_owner_receipt",
    )!;
    const identity = owner.fields.find(
      (field) => field.name === "identity_content_hash",
    ) as { value: string };
    identity.value = `sha256:${"f".repeat(64)}`;
    expect(() => compute(mutated)).toThrow(
      "stored successor manifest digest mismatch",
    );
    expect(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.pending
        .document_and_anchor_resolvers,
    ).toBe("pending");
  });

  it("implements strict successor JCS integer and Unicode boundaries", () => {
    expect(() => canonicalJson(-0)).toThrow("invalid canonical integer");
    expect(() => canonicalJson(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      "invalid canonical integer",
    );
    expect(() => canonicalJson("e\u0301")).toThrow("invalid canonical text");
    expect(() => canonicalJson("\ud800")).toThrow("invalid canonical text");
    expect(canonicalJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });

  it.each([
    ["row-verifier_policy-policy", "span_entailment_required", "false"],
    ["row-adapter_manifest_receipt-receipt", "extraction_policy_version", ""],
    [
      "row-adapter_manifest_receipt-receipt",
      "roster_content_hash",
      "sha256:bad",
    ],
    ["row-adapter_manifest_receipt-receipt", "parser_version", "\ud800"],
  ])(
    "rejects malformed typed leaf payload %s.%s",
    (rowId, fieldName, value) => {
      const mutated = structuredClone(rows) as unknown as {
        row_id: string;
        table: string;
        fields: { name: string; tag: Field["tag"]; value: Field["value"] }[];
      }[];
      mutated
        .find((row) => row.row_id === rowId)!
        .fields.find((item) => item.name === fieldName)!.value = value;
      expect(() => compute(mutated)).toThrow();
    },
  );

  it("rejects a laundered successor tag and a numeric integer payload", () => {
    const laundered = structuredClone(rows) as unknown as {
      row_id: string;
      table: string;
      fields: { name: string; tag: Field["tag"]; value: unknown }[];
    }[];
    laundered
      .find((row) => row.row_id === "row-adapter_manifest_receipt-receipt")!
      .fields.find((item) => item.name === "successor_manifest_hash")!.tag =
      "text";
    expect(() => compute(laundered as unknown as Row[])).toThrow();

    const numeric = structuredClone(rows) as unknown as typeof laundered;
    numeric
      .find((row) => row.row_id === "row-source_owner_receipt-owner")!
      .fields.find((item) => item.name === "ordinal")!.value = 0;
    expect(() => compute(numeric as unknown as Row[])).toThrow();
  });
});
