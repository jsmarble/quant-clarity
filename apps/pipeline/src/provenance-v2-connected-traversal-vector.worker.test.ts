import {
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH,
  PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
} from "@quant-clarity/contracts";
import { describe, expect, it } from "vitest";

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
interface FrameField {
  readonly tag: Field["tag"];
  readonly value: Field["value"];
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
const digestBinding = (
  value: unknown,
): CollectionDigestBinding | RowDigestBinding =>
  value as CollectionDigestBinding | RowDigestBinding;
const rows = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.rows as readonly Row[];
const scope = PROVENANCE_V2_CONNECTED_REGISTRATION_GRAPH.selected_scope;
const utf8 = new TextEncoder();
const tags = { null: 0, text: 1, integer: 2, boolean: 3, digest: 4 } as const;
const hexBytes = (value: string): Uint8Array => {
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < result.length; index += 1)
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return result;
};
const bytesHex = (value: Uint8Array): string =>
  [...value].map((item) => item.toString(16).padStart(2, "0")).join("");
const unsigned = (length: number, input: bigint): Uint8Array => {
  const result = new Uint8Array(length);
  for (let index = length - 1; index >= 0; index -= 1) {
    result[index] = Number(input & 0xffn);
    input >>= 8n;
  }
  return result;
};
const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};
const payload = (field: FrameField): Uint8Array => {
  if (field.tag === "null") return new Uint8Array();
  if (field.tag === "boolean") return new Uint8Array([field.value ? 1 : 0]);
  if (field.tag === "digest") return hexBytes(String(field.value).slice(7));
  return utf8.encode(String(field.value));
};
const frame = (domain: string, fields: readonly FrameField[]): Uint8Array => {
  const domainBytes = utf8.encode(domain);
  return concatenate([
    hexBytes("514350563201"),
    unsigned(2, BigInt(domainBytes.length)),
    domainBytes,
    unsigned(4, BigInt(fields.length)),
    ...fields.flatMap((field) => {
      const content = payload(field);
      return [
        new Uint8Array([tags[field.tag]]),
        unsigned(8, BigInt(content.length)),
        content,
      ];
    }),
  ]);
};
const sha256 = async (value: Uint8Array): Promise<string> => {
  const exact = value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
  return `sha256:${bytesHex(new Uint8Array(await crypto.subtle.digest("SHA-256", exact)))}`;
};
const field = (row: Row, name: string): Field => {
  const result = row.fields.find((item) => item.name === name);
  if (result === undefined) throw new Error("missing field");
  return result;
};
const replaceDigest = (row: Row, name: string, digest: string): Row => ({
  ...row,
  fields: row.fields.map((item) =>
    item.name === name ? { ...item, tag: "digest", value: digest } : item,
  ),
});
const compareBytes = (left: string, right: string): number => {
  const leftBytes = utf8.encode(left);
  const rightBytes = utf8.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
};
const registry = new Map(
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.map((entry) => [
    entry.table,
    entry,
  ]),
);
const leaf = async (row: Row): Promise<string> => {
  const entry = registry.get(row.table);
  if (entry?.leaf_domain === null || entry?.leaf_domain === undefined)
    throw new Error("missing registry entry");
  const fields = entry.fields.filter(
    (item) => item.name !== entry.digest_output,
  );
  if (
    fields.length !== row.fields.length ||
    fields.some((item, index) => item.name !== row.fields[index]?.name)
  )
    throw new Error("leaf field closure mismatch");
  return sha256(frame(entry.leaf_domain, row.fields));
};
type Traversal = (typeof PROVENANCE_V2_ROOT_BINDING_PLAN.traversals)[number];
interface TraversalResult {
  readonly count: number;
  readonly digest: string;
  readonly rowManifest: string;
  readonly rowIds: readonly string[];
}
const rowCompare = (
  left: Row,
  right: Row,
  source: Traversal["sources"][number],
): number => {
  for (const order of source.order_by) {
    const leftValue = field(left, order.column).value;
    const rightValue = field(right, order.column).value;
    const result =
      order.comparison === "integer"
        ? BigInt(String(leftValue)) < BigInt(String(rightValue))
          ? -1
          : BigInt(String(leftValue)) > BigInt(String(rightValue))
            ? 1
            : 0
        : compareBytes(String(leftValue), String(rightValue));
    if (result !== 0) return result;
  }
  return 0;
};
const traverse = async (
  traversal: Traversal,
  digests: ReadonlyMap<string, string>,
  input: readonly Row[],
): Promise<TraversalResult> => {
  const projections: { rowId: string; digest: string }[] = [];
  for (const source of [...traversal.sources].sort(
    (a, b) => a.ordinal - b.ordinal,
  )) {
    const selected = input
      .filter(
        (row) =>
          row.table === source.table &&
          (source.scope_binding.kind === "global_contract" ||
            source.scope_binding.joins.every(
              (join) =>
                field(row, join.row_column).value ===
                scope[join.scope_column as keyof typeof scope],
            )),
      )
      .sort((left, right) => rowCompare(left, right, source));
    for (let index = 1; index < selected.length; index += 1)
      if (rowCompare(selected[index - 1]!, selected[index]!, source) === 0)
        throw new Error("duplicate order tuple");
    if (
      (source.cardinality === "one" && selected.length !== 1) ||
      (source.cardinality === "zero_or_one" && selected.length > 1)
    )
      throw new Error("source cardinality mismatch");
    for (const row of selected) {
      const leafDigest = digests.get(row.row_id);
      if (leafDigest === undefined) throw new Error("missing leaf digest");
      projections.push({
        rowId: row.row_id,
        digest: await sha256(
          frame(
            PROVENANCE_V2_ROOT_BINDING_PLAN.traversal_contract
              .member_projection_domain,
            [
              { tag: "integer", value: String(source.ordinal) },
              { tag: "text", value: source.family_tag },
              { tag: "digest", value: leafDigest },
            ],
          ),
        ),
      });
    }
  }
  if (traversal.zero_members === "rejected" && projections.length === 0)
    throw new Error("empty traversal");
  const scopeFields = traversal.scope_columns.map((name): FrameField => ({
    tag: "text",
    value: scope[name as keyof typeof scope],
  }));
  const collection = frame(traversal.domain, [
    ...scopeFields,
    { tag: "integer", value: String(projections.length) },
    ...projections.map((item) => ({
      tag: "digest" as const,
      value: item.digest,
    })),
  ]);
  const rowManifest = frame(
    "provenance-v2-connected-ordered-row-id-manifest@1",
    [
      { tag: "integer", value: String(projections.length) },
      ...projections.map((item) => ({
        tag: "text" as const,
        value: item.rowId,
      })),
    ],
  );
  return {
    count: projections.length,
    digest: await sha256(collection),
    rowManifest: await sha256(rowManifest),
    rowIds: projections.map((item) => item.rowId),
  };
};

const execute = async (input: readonly Row[]) => {
  if (new Set(input.map((row) => row.row_id)).size !== input.length)
    throw new Error("duplicate row identity");
  if (input.length !== rows.length)
    throw new Error("canonical row inventory mismatch");
  const canonicalRows = new Map(rows.map((row) => [row.row_id, row]));
  if (input.some((row) => !canonicalRows.has(row.row_id)))
    throw new Error("canonical row inventory mismatch");
  const planSources = new Map(
    PROVENANCE_V2_ROOT_BINDING_PLAN.traversals
      .filter((traversal) => traversal.purpose === "plan_root")
      .flatMap((traversal) =>
        traversal.sources.map((source) => [source.table, source] as const),
      ),
  );
  for (const row of input) {
    const canonical = canonicalRows.get(row.row_id);
    const source = planSources.get(row.table);
    if (
      canonical === undefined ||
      source === undefined ||
      canonical.table !== row.table
    )
      throw new Error("unknown row identity");
    for (const order of source.order_by)
      if (
        field(canonical, order.column).value !== field(row, order.column).value
      )
        throw new Error("row identity tuple mismatch");
  }
  const digests = new Map<string, string>();
  for (const row of input)
    if (
      row.row_id !== "row-source_register_receipt-receipt" &&
      row.row_id !== "row-source_endpoint_registration-registration"
    )
      digests.set(row.row_id, await leaf(row));
  const memberBinding = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.find(
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
  )!;
  const member = await traverse(memberTraversal, digests, input);
  const receiptInput = input.find(
    (row) => row.row_id === "row-source_register_receipt-receipt",
  )!;
  if (field(receiptInput, "member_count").value !== String(member.count))
    throw new Error("source register member count mismatch");
  const receipt = replaceDigest(receiptInput, "member_set_root", member.digest);
  const receiptDigest = await leaf(receipt);
  digests.set(receipt.row_id, receiptDigest);
  const registrationInput = input.find(
    (row) => row.row_id === "row-source_endpoint_registration-registration",
  )!;
  const graphBindings = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(
    (binding) =>
      input.some(
        (row) =>
          row.table === binding.table &&
          row.fields.some((item) => item.name === binding.field),
      ),
  );
  expect(
    input.flatMap((row) =>
      row.fields.filter(
        (item) =>
          item.tag === "digest" &&
          graphBindings.some(
            (binding) =>
              binding.table === row.table &&
              binding.field === item.name &&
              binding.hash_class === "safe_preimage",
          ),
      ),
    ),
  ).toHaveLength(30);
  expect(
    input.flatMap((row) =>
      row.fields.filter(
        (item) =>
          item.tag === "digest" &&
          graphBindings.some(
            (binding) =>
              binding.table === row.table &&
              binding.field === item.name &&
              binding.hash_class === "external_anchor",
          ),
      ),
    ),
  ).toHaveLength(10);
  const topLevelBindings = graphBindings.filter(
    (binding) => binding.hash_class === "top_level_root",
  );
  expect(topLevelBindings).toHaveLength(3);
  const resolveRowDigest = (targetField: string): string => {
    const declared = topLevelBindings.find(
      (binding) =>
        binding.table === registrationInput.table &&
        binding.field === targetField,
    );
    if (declared === undefined)
      throw new Error("missing row digest declaration");
    const declaredBinding = digestBinding(declared.binding);
    if (declaredBinding.kind !== "row_digest")
      throw new Error("missing row digest binding");
    const matches = input.filter(
      (candidate) =>
        candidate.table === declaredBinding.table &&
        declaredBinding.joins.every(
          (join) =>
            field(registrationInput, join.local_column).value ===
            field(candidate, join.remote_column).value,
        ),
    );
    if (matches.length !== 1)
      throw new Error("row digest cardinality mismatch");
    const digest = digests.get(matches[0]!.row_id);
    if (digest === undefined) throw new Error("missing row digest output");
    return digest;
  };
  const endpointDigest = resolveRowDigest("endpoint_content_hash");
  const sourceDigest = resolveRowDigest("manifest_source_hash");
  const registration = replaceDigest(
    replaceDigest(registrationInput, "endpoint_content_hash", endpointDigest),
    "manifest_source_hash",
    sourceDigest,
  );
  digests.set(registration.row_id, await leaf(registration));
  const traversals = new Map<string, TraversalResult>();
  for (const traversal of PROVENANCE_V2_ROOT_BINDING_PLAN.traversals)
    traversals.set(
      traversal.name,
      traversal.name === memberTraversal.name
        ? member
        : await traverse(traversal, digests, input),
    );
  const consumed = PROVENANCE_V2_ROOT_BINDING_PLAN.traversals
    .filter((item) => item.purpose === "plan_root")
    .flatMap((item) => traversals.get(item.name)?.rowIds ?? []);
  if (
    consumed.length !== input.length ||
    new Set(consumed).size !== input.length ||
    input.some((row) => !consumed.includes(row.row_id))
  )
    throw new Error("plan row accounting mismatch");
  const authorityContract = PROVENANCE_V2_ROOT_BINDING_PLAN.record_frames.find(
    (item) => item.name === "authority_root",
  )!;
  const receiptContract = PROVENANCE_V2_ROOT_BINDING_PLAN.record_frames.find(
    (item) => item.name === "oracle_receipt_hash",
  )!;
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
  const authority = frame(
    authorityContract.domain,
    authorityContract.fields.map((binding): FrameField => {
      const fixture = authorityFixture.get(binding.name);
      if (fixture?.tag !== binding.frame_type)
        throw new Error("authority fixture layout mismatch");
      return {
        tag: binding.frame_type,
        value:
          binding.source.kind === "collection"
            ? (traversals.get(binding.source.traversal)?.digest ?? "")
            : fixture.value,
      };
    }),
  );
  const authorityDigest = await sha256(authority);
  const receiptFixture = new Map(
    PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_refused_receipt_frame.fields.map(
      (item) => [item.name, item],
    ),
  );
  const refusedReceipt = frame(
    receiptContract.domain,
    receiptContract.fields.map((binding): FrameField => {
      const fixture = receiptFixture.get(binding.name);
      if (fixture?.tag !== binding.frame_type)
        throw new Error("receipt fixture layout mismatch");
      return {
        tag: binding.frame_type,
        value:
          binding.name === "authority_root" ? authorityDigest : fixture.value,
      };
    }),
  );
  const successorClaims = Object.fromEntries(
    PROVENANCE_V2_ROOT_BINDING_PLAN.successor_claim_bindings.map((binding) => {
      if (binding.kind === "row_digest") {
        const matches = input.filter(
          (row) =>
            row.table === binding.table &&
            binding.scope_joins.every(
              (join) =>
                field(row, join.row_column).value ===
                scope[join.scope_column as keyof typeof scope],
            ),
        );
        if (matches.length !== 1)
          throw new Error("successor row digest binding mismatch");
        const digest = digests.get(matches[0]!.row_id);
        if (digest === undefined)
          throw new Error("missing successor row digest output");
        return [binding.field, digest];
      }
      const traversal = traversals.get(binding.traversal);
      if (traversal === undefined)
        throw new Error("missing successor traversal output");
      return [
        binding.field,
        binding.kind === "count" ? traversal.count : traversal.digest,
      ];
    }),
  );
  return {
    digests,
    traversals,
    receiptDigest,
    endpointDigest,
    sourceDigest,
    authorityHex: bytesHex(authority),
    authorityDigest,
    refusedReceiptHex: bytesHex(refusedReceipt),
    refusedReceiptDigest: await sha256(refusedReceipt),
    successorClaims,
  };
};

describe("independent workerd connected provenance-v2 traversal vectors", () => {
  it("recomputes every connected leaf and typed traversal in reverse caller order", async () => {
    const result = await execute([...rows].reverse());
    expect(result.digests.size).toBe(371);
    expect([
      result.traversals.get("source_register_member_set_root")?.digest,
      result.endpointDigest,
      result.sourceDigest,
    ]).toEqual(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.derived_digest_substitutions.map(
        (item) => item.computed_digest,
      ),
    );
    const graphBindings =
      PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(
        (binding) =>
          binding.hash_class === "top_level_root" &&
          rows.some(
            (row) =>
              row.table === binding.table &&
              row.fields.some((item) => item.name === binding.field),
          ),
      );
    expect(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.derived_digest_substitutions,
    ).toEqual(
      graphBindings.map((binding, index) => {
        const target = rows.find((row) => row.table === binding.table)!;
        const bindingValue = digestBinding(binding.binding);
        return {
          target_row_id: target.row_id,
          target_field: binding.field,
          source_kind: bindingValue.kind,
          source_name:
            bindingValue.kind === "collection_digest"
              ? bindingValue.traversal
              : `${bindingValue.table}.${bindingValue.digest_column}`,
          computed_digest: [
            result.traversals.get("source_register_member_set_root")?.digest,
            result.endpointDigest,
            result.sourceDigest,
          ][index],
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
    for (const expected of PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.traversals) {
      const actual = result.traversals.get(expected.name);
      expect(actual?.count, expected.name).toBe(expected.member_count);
      expect(actual?.rowManifest, expected.name).toBe(
        expected.ordered_row_id_manifest_sha256,
      );
      expect(actual?.digest, expected.name).toBe(expected.collection_sha256);
    }
    expect(result.authorityHex).toBe(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_authority_frame
        .frame_hex,
    );
    expect(result.authorityDigest).toBe(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_authority_frame
        .sha256,
    );
    expect(result.refusedReceiptHex).toBe(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_refused_receipt_frame
        .frame_hex,
    );
    expect(result.refusedReceiptDigest).toBe(
      PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.candidate_refused_receipt_frame
        .sha256,
    );
    expect(PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.authority_eligible).toBe(
      false,
    );
    expect(PROVENANCE_V2_CONNECTED_TRAVERSAL_VECTORS.outcome).toBe(
      "authority_refused",
    );
  });

  it("rejects same-row-id scope shadowing", async () => {
    const shadow = structuredClone(rows[0]!) as unknown as {
      fields: { name: string; value: string | boolean | null }[];
    } & Row;
    shadow.fields.find((item) => item.name === "authority_plan_id")!.value =
      "vpa_99999999-9999-4999-8999-999999999999";
    await expect(execute([...rows, shadow])).rejects.toThrow(
      "duplicate row identity",
    );
  });

  it("rejects an incomplete canonical row inventory", async () => {
    await expect(execute(rows.slice(1))).rejects.toThrow(
      "canonical row inventory mismatch",
    );
    await expect(
      execute(
        rows.filter(
          (row) =>
            row.row_id !== "row-adapter_manifest_credential-credential-10",
        ),
      ),
    ).rejects.toThrow("canonical row inventory mismatch");
  });
});
