import {
  PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY,
  PROVENANCE_V2_AUTHORITY_ROOT_VECTORS,
  PROVENANCE_V2_COMPOSITE_ROOT_VECTORS,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
} from "@quant-clarity/contracts";
import { describe, expect, it } from "vitest";

interface Field {
  readonly tag: "null" | "text" | "integer" | "boolean" | "bytes" | "digest";
  readonly value: string | boolean | null;
}
const utf8 = new TextEncoder();
const tags = {
  null: 0,
  text: 1,
  integer: 2,
  boolean: 3,
  bytes: 4,
  digest: 4,
} as const;
const hexBytes = (value: string): Uint8Array => {
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < result.length; index += 1)
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return result;
};
const bytesHex = (value: Uint8Array): string =>
  [...value].map((entry) => entry.toString(16).padStart(2, "0")).join("");
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
const payload = (field: Field): Uint8Array => {
  if (field.tag === "null") return new Uint8Array();
  if (field.tag === "boolean") return new Uint8Array([field.value ? 1 : 0]);
  if (field.tag === "digest") return hexBytes(String(field.value).slice(7));
  if (field.tag === "bytes") return hexBytes(String(field.value));
  return utf8.encode(String(field.value));
};
const frame = (domain: string, fields: readonly Field[]): Uint8Array => {
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
const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const exact = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return `sha256:${bytesHex(new Uint8Array(await crypto.subtle.digest("SHA-256", exact)))}`;
};
const fields = (value: readonly unknown[]): readonly Field[] =>
  value as readonly Field[];

describe("independent workerd provenance-v2 family-frame composition", () => {
  it("composes every isolated leaf and family projection through higher frames and a refused receipt", async () => {
    const leaves = new Map<
      string,
      (typeof PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors)[number]
    >(
      PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors.flatMap((vector) =>
        vector.registry_table === null ? [] : [[vector.registry_table, vector]],
      ),
    );
    const frameDigests = new Map<string, string>();
    for (const expected of PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.traversals) {
      const traversal = PROVENANCE_V2_ROOT_BINDING_PLAN.traversals.find(
        (candidate) => candidate.name === expected.name,
      );
      if (traversal === undefined) throw new Error("missing traversal");
      const projections: { ordinal: number; digest: string }[] = [];
      for (const member of [...expected.ordered_members].reverse()) {
        const registry = PROVENANCE_V2_AUTHORITY_ROOT_REGISTRY.entries.find(
          (candidate) => candidate.table === member.registry_table,
        );
        const leaf = leaves.get(member.registry_table);
        const source = traversal.sources.find(
          (candidate) => candidate.table === member.registry_table,
        );
        if (
          registry === undefined ||
          leaf === undefined ||
          source === undefined
        )
          throw new Error("unbound composite member");
        const leafBytes = frame(
          registry.leaf_domain ?? "",
          fields(leaf.fields),
        );
        expect(bytesHex(leafBytes), member.registry_table).toBe(leaf.frame_hex);
        const leafDigest = await sha256(leafBytes);
        expect(leafDigest).toBe(member.leaf_digest);
        const projection = frame(
          PROVENANCE_V2_ROOT_BINDING_PLAN.traversal_contract
            .member_projection_domain,
          [
            { tag: "integer", value: String(source.ordinal) },
            { tag: "text", value: source.family_tag },
            { tag: "digest", value: leafDigest },
          ],
        );
        const projectionDigest = await sha256(projection);
        expect(projectionDigest).toBe(member.projection_digest);
        projections.push({ ordinal: source.ordinal, digest: projectionDigest });
      }
      projections.sort((left, right) => left.ordinal - right.ordinal);
      const collection = frame(expected.domain, [
        ...fields(expected.scope_fields),
        { tag: "integer", value: String(projections.length) },
        ...projections.map(({ digest }) => ({
          tag: "digest" as const,
          value: digest,
        })),
      ]);
      expect(bytesHex(collection), expected.name).toBe(expected.frame_hex);
      expect(await sha256(collection), expected.name).toBe(expected.sha256);
      frameDigests.set(expected.name, expected.sha256);
    }
    expect(frameDigests.size).toBe(9);

    const authority = frame(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_root.domain,
      fields(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_root.fields),
    );
    expect(bytesHex(authority)).toBe(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_root.frame_hex,
    );
    expect(await sha256(authority)).toBe(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.authority_root.sha256,
    );
    const receipt = frame(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.candidate_receipt.domain,
      fields(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.candidate_receipt.fields),
    );
    expect(bytesHex(receipt)).toBe(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.candidate_receipt.frame_hex,
    );
    expect(await sha256(receipt)).toBe(
      PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.candidate_receipt.sha256,
    );
    expect(PROVENANCE_V2_COMPOSITE_ROOT_VECTORS.outcome).toBe(
      "authority_refused",
    );
  });
});
