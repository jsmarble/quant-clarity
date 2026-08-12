import { describe, expect, it } from "vitest";

import { PROVENANCE_V2_AUTHORITY_ROOT_VECTORS } from "./index.js";

type Field =
  (typeof PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors)[number]["fields"][number];
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
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
};
const bytesHex = (value: Uint8Array): string =>
  [...value].map((entry) => entry.toString(16).padStart(2, "0")).join("");
const integer = (bytes: number, value: bigint): Uint8Array => {
  const result = new Uint8Array(bytes);
  for (let index = bytes - 1; index >= 0; index -= 1) {
    result[index] = Number(value & 0xffn);
    value >>= 8n;
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
  switch (field.tag) {
    case "null":
      return new Uint8Array();
    case "text":
    case "integer":
      return utf8.encode(field.value);
    case "boolean":
      return new Uint8Array([field.value ? 1 : 0]);
    case "bytes":
      return hexBytes(field.value);
    case "digest":
      return hexBytes(field.value.slice(7));
  }
};

describe("independent WebCrypto provenance-v2 root vectors", () => {
  it("reconstructs every reviewed frame and digest without Node or production helpers", async () => {
    for (const vector of PROVENANCE_V2_AUTHORITY_ROOT_VECTORS.vectors) {
      const domain = utf8.encode(vector.domain);
      const frame = concatenate([
        hexBytes("514350563201"),
        integer(2, BigInt(domain.length)),
        domain,
        integer(4, BigInt(vector.fields.length)),
        ...vector.fields.flatMap((field) => {
          const content = payload(field);
          return [
            new Uint8Array([tags[field.tag]]),
            integer(8, BigInt(content.length)),
            content,
          ];
        }),
      ]);
      expect(bytesHex(frame), vector.name).toBe(vector.frame_hex);
      const exactFrame = frame.buffer.slice(
        frame.byteOffset,
        frame.byteOffset + frame.byteLength,
      ) as ArrayBuffer;
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", exactFrame),
      );
      expect(`sha256:${bytesHex(digest)}`, vector.name).toBe(vector.sha256);
    }
  });
});
