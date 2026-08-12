import { describe, expect, it } from "vitest";

import {
  PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT,
  PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_DEPTH,
  PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_BYTES,
  PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_NODES,
  PROVENANCE_V2_ROOT_BINDING_PLAN,
} from "@quant-clarity/contracts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Selector {
  readonly wildcard_ordinal: number;
  readonly kind: string;
  readonly row_column: string;
  readonly member_field?: string;
}
interface Binding {
  readonly pointer_pattern: string;
  readonly selectors?: readonly Selector[];
}

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
// Intrinsic accessors are deliberately invoked with Reflect.apply.
// eslint-disable-next-line @typescript-eslint/unbound-method
const byteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
// eslint-disable-next-line @typescript-eslint/unbound-method
const bufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)?.get;
const admitted = new WeakSet<object>();

const freezeJson = (value: Json): void => {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) value.forEach(freezeJson);
  else Object.values(value).forEach(freezeJson);
  Object.freeze(value);
};

const validUnicode = (value: string): boolean => {
  if (value.normalize("NFC") !== value) return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
};

class WorkerdJsonReader {
  private position = 0;
  private nodes = 0;

  constructor(private readonly source: string) {}

  read(): Json {
    const result = this.readValue(0);
    if (this.position !== this.source.length) throw new Error("invalid_json");
    return result;
  }

  private readValue(depth: number): Json {
    if (
      depth > PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_DEPTH ||
      ++this.nodes > PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_NODES
    )
      throw new Error("limit");
    const character = this.source[this.position];
    if (character === "{") return this.readObject(depth + 1);
    if (character === "[") return this.readArray(depth + 1);
    if (character === '"') return this.readString();
    for (const [literal, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const)
      if (this.source.startsWith(literal, this.position)) {
        this.position += literal.length;
        return value;
      }
    const token = /^-?(?:0|[1-9][0-9]*)/u.exec(
      this.source.slice(this.position),
    )?.[0];
    if (token === undefined || token === "-0" || token.length > 17)
      throw new Error("invalid_integer");
    const next = this.source[this.position + token.length];
    if (next === "." || next === "e" || next === "E")
      throw new Error("invalid_integer");
    const number = Number(token);
    if (!Number.isSafeInteger(number)) throw new Error("invalid_integer");
    this.position += token.length;
    return number;
  }

  private readObject(depth: number): Record<string, Json> {
    this.position += 1;
    const result = Object.create(null) as Record<string, Json>;
    const keys = new Set<string>();
    if (this.source[this.position] === "}") {
      this.position += 1;
      return result;
    }
    while (this.position < this.source.length) {
      const key = this.readString();
      if (keys.has(key)) throw new Error("duplicate_key");
      keys.add(key);
      if (this.source[this.position++] !== ":") throw new Error("invalid_json");
      Object.defineProperty(result, key, {
        value: this.readValue(depth),
        enumerable: true,
      });
      const delimiter = this.source[this.position++];
      if (delimiter === "}") return result;
      if (delimiter !== ",") throw new Error("invalid_json");
    }
    throw new Error("invalid_json");
  }

  private readArray(depth: number): Json[] {
    this.position += 1;
    const result: Json[] = [];
    if (this.source[this.position] === "]") {
      this.position += 1;
      return result;
    }
    while (this.position < this.source.length) {
      result.push(this.readValue(depth));
      const delimiter = this.source[this.position++];
      if (delimiter === "]") return result;
      if (delimiter !== ",") throw new Error("invalid_json");
    }
    throw new Error("invalid_json");
  }

  private readString(): string {
    const start = this.position;
    if (this.source[this.position++] !== '"') throw new Error("invalid_json");
    while (this.position < this.source.length) {
      const unit = this.source.charCodeAt(this.position);
      if (unit === 0x22) {
        this.position += 1;
        const result = JSON.parse(
          this.source.slice(start, this.position),
        ) as string;
        if (!validUnicode(result)) throw new Error("invalid_unicode");
        return result;
      }
      if (unit < 0x20) throw new Error("invalid_json");
      if (unit === 0x5c) {
        this.position += 1;
        const escape = this.source[this.position];
        if (escape === "u") {
          if (
            !/^[0-9a-fA-F]{4}$/u.test(
              this.source.slice(this.position + 1, this.position + 5),
            )
          )
            throw new Error("invalid_json");
          this.position += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape))
          throw new Error("invalid_json");
      }
      this.position += 1;
    }
    throw new Error("invalid_json");
  }
}

const workerdCanonical = (value: Json): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(workerdCanonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${workerdCanonical(value[key]!)}`)
    .join(",")}}`;
};

const workerdParse = (bytes: Uint8Array): Json => {
  let byteLength: number;
  let snapshot: Uint8Array;
  let buffer: unknown;
  try {
    if (byteLengthGetter === undefined || bufferGetter === undefined)
      throw new Error("input_type");
    byteLength = Reflect.apply(byteLengthGetter, bytes, []) as number;
    buffer = Reflect.apply(bufferGetter, bytes, []) as unknown;
  } catch {
    throw new Error("input_type");
  }
  if (byteLength > PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_BYTES)
    throw new Error("byte_limit");
  try {
    if (
      !(buffer instanceof ArrayBuffer) ||
      Object.getPrototypeOf(bytes) !== Uint8Array.prototype
    )
      throw new Error("input_type");
    snapshot = Uint8Array.prototype.slice.call(bytes);
  } catch {
    throw new Error("input_type");
  }
  const source = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(snapshot);
  if (source.startsWith("\uFEFF")) throw new Error("bom");
  const value = new WorkerdJsonReader(source).read();
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_root");
  const encoded = new TextEncoder().encode(workerdCanonical(value));
  if (
    encoded.length !== byteLength ||
    encoded.some((byte, index) => byte !== snapshot[index])
  )
    throw new Error("noncanonical");
  freezeJson(value);
  admitted.add(value);
  return value;
};

const rowField = (
  row: Readonly<Record<string, string | number>>,
  column: string,
): string | number => {
  const descriptor = Object.getOwnPropertyDescriptor(row, column);
  if (descriptor === undefined || !("value" in descriptor))
    throw new Error("row");
  const value: unknown = descriptor.value;
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("row");
  return value;
};

const compile = (binding: Binding): readonly string[] => {
  if (!binding.pointer_pattern.startsWith("/")) throw new Error("pointer");
  const tokens = binding.pointer_pattern.split("/").slice(1);
  if (tokens.some((token) => /(?:~(?![01])|~$)/u.test(token)))
    throw new Error("pointer");
  const wildcardCount = tokens.filter((token) => token === "*").length;
  const ordinals = (binding.selectors ?? [])
    .map((selector) => selector.wildcard_ordinal)
    .sort((left, right) => left - right);
  if (
    ordinals.length !== wildcardCount ||
    ordinals.some((ordinal, index) => ordinal !== index)
  )
    throw new Error("wildcard");
  return tokens.map((token) =>
    token.replaceAll("~1", "/").replaceAll("~0", "~"),
  );
};

const resolve = (
  document: Json,
  binding: Binding,
  row: Readonly<Record<string, string | number>>,
): Json => {
  if (
    document === null ||
    typeof document !== "object" ||
    !admitted.has(document)
  )
    throw new Error("not_admitted");
  let current: Json = document;
  let wildcard = 0;
  for (const token of compile(binding)) {
    if (token !== "*") {
      if (typeof current !== "object" || Array.isArray(current))
        throw new Error("container");
      if (!Object.hasOwn(current, token)) throw new Error("missing");
      current = current[token]!;
      continue;
    }
    if (!Array.isArray(current)) throw new Error("container");
    const selector = (binding.selectors ?? []).find(
      (candidate) => candidate.wildcard_ordinal === wildcard,
    )!;
    wildcard += 1;
    if (selector.kind === "array_index_by_ordinal") {
      const ordinal = rowField(row, selector.row_column);
      if (
        typeof ordinal !== "number" ||
        !Number.isSafeInteger(ordinal) ||
        Object.is(ordinal, -0) ||
        ordinal < 0 ||
        ordinal >= current.length
      )
        throw new Error("index");
      current = current[ordinal]!;
      continue;
    }
    const expected = rowField(row, selector.row_column);
    const matches: Json[] = current.filter(
      (candidate) =>
        candidate !== null &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        selector.member_field !== undefined &&
        candidate[selector.member_field] === expected,
    );
    if (matches.length !== 1) throw new Error("cardinality");
    current = matches[0]!;
  }
  return current;
};

const resolveValueSemantics = (
  document: Json,
  binding: Binding & {
    readonly encoding: "nfc_utf8" | "rfc8785_jcs";
    readonly null_result: "null" | "reject";
  },
  row: Readonly<Record<string, string | number>>,
): { readonly value: Json; readonly bytes: Uint8Array | null } => {
  const value = resolve(document, binding, row);
  if (value === null) {
    if (binding.null_result !== "null") throw new Error("null");
    return { value, bytes: null };
  }
  if (binding.encoding === "nfc_utf8") {
    if (typeof value !== "string") throw new Error("value_type");
    return { value, bytes: new TextEncoder().encode(value) };
  }
  return { value, bytes: new TextEncoder().encode(workerdCanonical(value)) };
};

const resolveCountSemantics = (
  document: Json,
  binding: Binding & {
    readonly kind: string;
    readonly predicate?: {
      readonly member_field: string;
      readonly equals: string;
    };
  },
  row: Readonly<Record<string, string | number>>,
): number => {
  const value = resolve(document, binding, row);
  if (binding.kind === "document_declared_integer") {
    if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 0)
      throw new Error("count_type");
    return value;
  }
  if (!Array.isArray(value)) throw new Error("count_type");
  return binding.kind === "document_filtered_array_length"
    ? value.filter(
        (candidate) =>
          candidate !== null &&
          typeof candidate === "object" &&
          !Array.isArray(candidate) &&
          binding.predicate !== undefined &&
          candidate[binding.predicate.member_field] ===
            binding.predicate.equals,
      ).length
    : value.length;
};

const makeProbe = (
  binding: Binding,
  terminal: Json = [1, 2],
): {
  readonly bytes: Uint8Array;
  readonly row: Record<string, string | number>;
} => {
  const tokens = compile(binding);
  const row: Record<string, string | number> = {};
  let wildcard = 0;
  const nest = (index: number): Json => {
    if (index === tokens.length) return terminal;
    const token = tokens[index]!;
    const selector =
      token === "*"
        ? (binding.selectors ?? []).find(
            (candidate) => candidate.wildcard_ordinal === wildcard,
          )
        : undefined;
    if (token === "*") wildcard += 1;
    const child = nest(index + 1);
    if (token !== "*") return { [token]: child };
    if (selector === undefined) throw new Error("probe");
    if (selector.kind === "array_index_by_ordinal") {
      row[selector.row_column] = 0;
      return [child];
    }
    const expected = selector.row_column.includes("ordinal") ? 0 : "match";
    row[selector.row_column] = expected;
    if (child === null || typeof child !== "object" || Array.isArray(child))
      throw new Error("probe");
    return [{ [selector.member_field!]: expected, ...child }];
  };
  return {
    bytes: new TextEncoder().encode(workerdCanonical(nest(0))),
    row,
  };
};

describe("provenance-v2 registration-document resolver in workerd", () => {
  it("independently admits canonical bytes and rejects duplicate/noncanonical input", () => {
    expect(
      workerdParse(new TextEncoder().encode('{"a":1,"b":[true]}')),
    ).toEqual({
      a: 1,
      b: [true],
    });
    expect(() =>
      workerdParse(new TextEncoder().encode('{"a":1,"a":2}')),
    ).toThrow("duplicate_key");
    expect(() =>
      workerdParse(new TextEncoder().encode('{"b":1,"a":2}')),
    ).toThrow("noncanonical");
    expect(() => workerdParse(Uint8Array.from([0xc0, 0xaf]))).toThrow();
    expect(() =>
      workerdParse(
        new Uint8Array(PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_BYTES + 1),
      ),
    ).toThrow("byte_limit");
    let trapHits = 0;
    const hostile = new Proxy(new TextEncoder().encode("{}"), {
      getPrototypeOf() {
        trapHits += 1;
        throw new Error("trap");
      },
    });
    expect(() => workerdParse(hostile)).toThrow("input_type");
    expect(trapHits).toBe(0);
    expect(() =>
      workerdParse(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
    ).toThrow("bom");
    expect(() => workerdParse(new TextEncoder().encode('{"a":"é"}'))).toThrow(
      "invalid_unicode",
    );
    expect(() => workerdParse(new TextEncoder().encode('{"a":-0}'))).toThrow(
      "invalid_integer",
    );
    expect(() =>
      workerdParse(
        new TextEncoder().encode(
          `{"a":${"[".repeat(PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_DEPTH + 1)}null${"]".repeat(PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_DEPTH + 1)}}`,
        ),
      ),
    ).toThrow("limit");
  });

  it("independently compiles and executes every checked-in document pointer", () => {
    const digestBindings =
      PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(
        (entry) =>
          (entry.binding as { readonly kind?: string }).kind ===
          "document_value",
      );
    const countBindings = PROVENANCE_V2_ROOT_BINDING_PLAN.count_bindings.filter(
      (entry) =>
        [
          "document_array_length",
          "document_declared_integer",
          "document_filtered_array_length",
        ].includes((entry.binding as { readonly kind?: string }).kind ?? ""),
    );
    expect(digestBindings).toHaveLength(18);
    expect(countBindings).toHaveLength(27);
    for (const entry of digestBindings) {
      const binding = entry.binding as Binding & {
        readonly encoding: "nfc_utf8" | "rfc8785_jcs";
        readonly null_result: "null" | "reject";
      };
      const terminal: Json =
        binding.null_result === "null"
          ? null
          : binding.encoding === "nfc_utf8"
            ? "selected"
            : { selected: true };
      const probe = makeProbe(binding, terminal);
      expect(
        resolveValueSemantics(workerdParse(probe.bytes), binding, probe.row),
      ).toEqual({
        value: terminal,
        bytes:
          terminal === null
            ? null
            : new TextEncoder().encode(
                binding.encoding === "nfc_utf8"
                  ? (terminal as string)
                  : workerdCanonical(terminal),
              ),
      });
    }
    for (const entry of countBindings) {
      const binding = entry.binding as Binding & {
        readonly kind: string;
        readonly predicate?: {
          readonly member_field: string;
          readonly equals: string;
        };
      };
      const terminal: Json =
        binding.kind === "document_declared_integer"
          ? 2
          : binding.kind === "document_filtered_array_length"
            ? [
                {
                  [binding.predicate!.member_field]: binding.predicate!.equals,
                },
              ]
            : [1, 2];
      const probe = makeProbe(binding, terminal);
      expect(
        resolveCountSemantics(workerdParse(probe.bytes), binding, probe.row),
      ).toBe(binding.kind === "document_filtered_array_length" ? 1 : 2);
    }
    const policyBinding = digestBindings.find(
      (entry) =>
        entry.table === "provenance_v2_field_policy" &&
        entry.field === "canonical_bytes_hash",
    )?.binding as
      | (Binding & {
          readonly encoding: "rfc8785_jcs";
          readonly null_result: "reject";
        })
      | undefined;
    if (policyBinding === undefined) throw new Error("policy binding missing");
    const policyProbe = makeProbe(policyBinding, "policy-string");
    expect(
      resolveValueSemantics(
        workerdParse(policyProbe.bytes),
        policyBinding,
        policyProbe.row,
      ).bytes,
    ).toEqual(new TextEncoder().encode('"policy-string"'));
    expect(PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT).toMatchObject({
      outcome: "authority_refused",
      authority_eligible: false,
      persisted: false,
      document_resolver_executed: true,
      retained_resolver_executed: false,
      semantic_oracle_executed: false,
    });
    const enumBinding = digestBindings.find(
      (entry) => entry.table === "provenance_v2_source_endpoint_parameter_enum",
    )?.binding as Binding | undefined;
    if (enumBinding === undefined) throw new Error("enum binding missing");
    const enumProbe = makeProbe(enumBinding);
    const enumDocument = workerdParse(enumProbe.bytes);
    expect(() =>
      resolve(enumDocument, enumBinding, { ...enumProbe.row, ordinal: -0 }),
    ).toThrow("index");
    expect(() => resolve({}, enumBinding, enumProbe.row)).toThrow(
      "not_admitted",
    );
    expect(Object.isFrozen(enumDocument)).toBe(true);
  });
});
