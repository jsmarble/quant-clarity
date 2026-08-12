import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { PROVENANCE_V2_AUTHORITY_ROOT_VECTORS } from "./index.js";

type Field =
  (typeof PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors)[number]["fields"][number];

const unsigned = (bytes: number, value: number): Buffer => {
  const result = Buffer.alloc(bytes);
  if (bytes === 2) result.writeUInt16BE(value);
  else if (bytes === 4) result.writeUInt32BE(value);
  else result.writeBigUInt64BE(BigInt(value));
  return result;
};

const fieldBytes = (field: Field): Buffer => {
  switch (field.tag) {
    case "null":
      return Buffer.alloc(0);
    case "text":
    case "integer":
      return Buffer.from(field.value as string, "utf8");
    case "boolean":
      return Buffer.from([field.value ? 1 : 0]);
    case "bytes":
      return Buffer.from(field.value as string, "hex");
    case "digest":
      return Buffer.from((field.value as string).slice(7), "hex");
  }
};

const tags = {
  null: 0,
  text: 1,
  integer: 2,
  boolean: 3,
  bytes: 4,
  digest: 4,
} as const;

describe("independent Node provenance-v2 root vectors", () => {
  it("reconstructs every reviewed frame and digest without production helpers", () => {
    for (const vector of PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors) {
      const domain = Buffer.from(vector.domain, "ascii");
      const frame = Buffer.concat([
        Buffer.from("514350563201", "hex"),
        unsigned(2, domain.length),
        domain,
        unsigned(4, vector.fields.length),
        ...vector.fields.flatMap((field) => {
          const payload = fieldBytes(field);
          return [
            Buffer.from([tags[field.tag]]),
            unsigned(8, payload.length),
            payload,
          ];
        }),
      ]);
      expect(frame.toString("hex"), vector.name).toBe(vector.frame_hex);
      expect(
        `sha256:${createHash("sha256").update(frame).digest("hex")}`,
        vector.name,
      ).toBe(vector.sha256);
    }
  });
});
