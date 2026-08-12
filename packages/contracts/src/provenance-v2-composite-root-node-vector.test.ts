import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  PROVENANCE_V2_AUTHORITY_ROOT_VECTORS,
  PROVENANCE_V2_COMPOSITE_ROOT_VECTORS,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
} from "./index.js";

interface NullField {
  readonly tag: "null";
  readonly value: null;
}
interface BooleanField {
  readonly tag: "boolean";
  readonly value: boolean;
}
interface StringField {
  readonly tag: "text" | "integer" | "bytes" | "digest";
  readonly value: string;
}
type EncodableField = NullField | BooleanField | StringField;

const unsigned = (bytes: number, value: number): Buffer => {
  const result = Buffer.alloc(bytes);
  if (bytes === 2) result.writeUInt16BE(value);
  else if (bytes === 4) result.writeUInt32BE(value);
  else result.writeBigUInt64BE(BigInt(value));
  return result;
};
const payload = (field: EncodableField): Buffer => {
  if (field.tag === "boolean") return Buffer.from([field.value ? 1 : 0]);
  if (field.tag === "null") return Buffer.alloc(0);
  if (field.tag === "digest") return Buffer.from(field.value.slice(7), "hex");
  if (field.tag === "bytes") return Buffer.from(field.value, "hex");
  return Buffer.from(field.value, "utf8");
};
const tags = {
  null: 0,
  text: 1,
  integer: 2,
  boolean: 3,
  bytes: 4,
  digest: 4,
} as const;
const frame = (domain: string, fields: readonly EncodableField[]): Buffer => {
  const domainBytes = Buffer.from(domain, "ascii");
  return Buffer.concat([
    Buffer.from("514350563201", "hex"),
    unsigned(2, domainBytes.length),
    domainBytes,
    unsigned(4, fields.length),
    ...fields.flatMap((field) => {
      const bytes = payload(field);
      return [Buffer.from([tags[field.tag]]), unsigned(8, bytes.length), bytes];
    }),
  ]);
};
const sha256 = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const leafVectors = new Map<
  string,
  (typeof PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors)[number]
>(
  PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors.flatMap((vector) =>
    vector.registry_table === null ? [] : [[vector.registry_table, vector]],
  ),
);

const composeFrames = (reverseMembers = false) => {
  const frameDigests = new Map<string, string>();
  for (const expected of PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.traversals) {
    const traversal = PROVENANCE_V2_ROOT_BINDING_PLAN.traversals.find(
      (candidate) => candidate.name === expected.name,
    );
    if (traversal === undefined) throw new Error("missing traversal");
    const input = reverseMembers
      ? [...expected.ordered_members].reverse()
      : [...expected.ordered_members];
    const projected = input.map((member) => {
      const registry = PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.find(
        (candidate) => candidate.table === member.registry_table,
      );
      const leaf = leafVectors.get(member.registry_table);
      const source = traversal.sources.find(
        (candidate) => candidate.table === member.registry_table,
      );
      if (registry === undefined || leaf === undefined || source === undefined)
        throw new Error("unbound composite member");
      const declaredFields = registry.fields.filter(
        (candidate) => candidate.name !== registry.digest_output,
      );
      expect(leaf.fields.map((field) => field.tag)).toEqual(
        declaredFields.map((field, index) =>
          leaf.fields[index]?.tag === "null" ? "null" : field.frame_type,
        ),
      );
      const leafBytes = frame(registry.leaf_domain ?? "", leaf.fields);
      expect(leafBytes.toString("hex")).toBe(leaf.frame_hex);
      const leafDigest = sha256(leafBytes);
      expect(leafDigest).toBe(member.leaf_digest);
      const projectionBytes = frame(
        PROVENANCE_V2_ROOT_BINDING_PLAN.traversal_contract
          .member_projection_domain,
        [
          { tag: "integer", value: String(source.ordinal) },
          { tag: "text", value: source.family_tag },
          { tag: "digest", value: leafDigest },
        ],
      );
      expect(sha256(projectionBytes)).toBe(member.projection_digest);
      return { ordinal: source.ordinal, digest: sha256(projectionBytes) };
    });
    projected.sort((left, right) => left.ordinal - right.ordinal);
    const collectionBytes = frame(expected.domain, [
      ...expected.scope_fields,
      { tag: "integer", value: String(projected.length) },
      ...projected.map(({ digest }) => ({
        tag: "digest" as const,
        value: digest,
      })),
    ]);
    expect(collectionBytes.toString("hex"), expected.name).toBe(
      expected.frame_hex,
    );
    expect(sha256(collectionBytes), expected.name).toBe(expected.sha256);
    frameDigests.set(expected.name, expected.sha256);
  }
  return frameDigests;
};

describe("independent Node provenance-v2 family-frame composition", () => {
  it("composes all 33 isolated leaf families into nine traversal-shaped frames and four plan-shaped digests", () => {
    const frameDigests = composeFrames();
    expect(frameDigests.size).toBe(9);
    expect(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.traversals.flatMap((value) =>
        value.ordered_members.map((member) => member.registry_table),
      ),
    ).toHaveLength(38);
    expect(
      new Set(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.leaf_vector_names).size,
    ).toBe(33);
    expect(frameDigests.get("adapter_manifest_set_root")).toBe(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_root.fields[15].value,
    );
    expect(frameDigests.get("endpoint_set_root")).toBe(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_root.fields[17].value,
    );
    expect(frameDigests.get("verifier_policy_set_root")).toBe(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_root.fields[19].value,
    );
    expect(frameDigests.get("field_policy_set_root")).toBe(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_root.fields[21].value,
    );
  });

  it("is independent of caller member order and pins numeric/UTF-8 ordering", () => {
    expect(composeFrames(true)).toEqual(composeFrames(false));
    expect(
      [
        ...PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.ordering_cases.integer_numeric,
      ].sort((left, right) => Number(left) - Number(right)),
    ).toEqual(["2", "10"]);
    expect(
      [...PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.ordering_cases.utf8_binary].sort(
        (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)),
      ),
    ).toEqual(["z", "é"]);
  });

  it("composes four plan-shaped digests into authority and refused receipt frames", () => {
    composeFrames();
    const authority = frame(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_root.domain,
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_root.fields,
    );
    expect(authority.toString("hex")).toBe(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_root.frame_hex,
    );
    expect(sha256(authority)).toBe(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_root.sha256,
    );
    const receipt = frame(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.candidate_receipt.domain,
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.candidate_receipt
        .fields as readonly EncodableField[],
    );
    expect(receipt.toString("hex")).toBe(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.candidate_receipt.frame_hex,
    );
    expect(sha256(receipt)).toBe(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.candidate_receipt.sha256,
    );
    expect(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_eligible).toBe(false);
    expect(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.outcome).toBe(
      "authority_refused",
    );
  });
});
