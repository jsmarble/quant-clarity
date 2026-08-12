import { PROVENANCE_V2_ROOT_BINDING_PLAN } from "./provenance-v2-root-binding-plan.js";

export const PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_BYTES = 1_048_576;
export const PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_DEPTH = 64;
export const PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_NODES = 100_000;
const MAX_ERRORS = 8;

type TextCodecGlobal = typeof globalThis & {
  TextDecoder: new (
    label?: string,
    options?: { readonly fatal?: boolean; readonly ignoreBOM?: boolean },
  ) => { decode(input?: Uint8Array): string };
  TextEncoder: new () => { encode(input?: string): Uint8Array };
};
const textCodecGlobal = globalThis as TextCodecGlobal;
const encodeUtf8 = (value: string): Uint8Array =>
  new textCodecGlobal.TextEncoder().encode(value);

export type ProvenanceV2CanonicalDocumentError =
  | "input_not_plain_uint8array"
  | "input_byte_limit_exceeded"
  | "invalid_utf8"
  | "bom_not_allowed"
  | "invalid_json"
  | "duplicate_object_key"
  | "document_depth_limit_exceeded"
  | "document_node_limit_exceeded"
  | "noncanonical_integer"
  | "noncanonical_unicode"
  | "noncanonical_document_bytes"
  | "document_not_admitted"
  | "document_selector_binding_not_found"
  | "document_selector_invalid_row"
  | "document_selector_no_match"
  | "document_selector_multiple_matches"
  | "document_selector_index_out_of_bounds"
  | "document_selector_type_mismatch";

export type ProvenanceV2CanonicalJson =
  | null
  | boolean
  | number
  | string
  | ProvenanceV2CanonicalJson[]
  | { readonly [key: string]: ProvenanceV2CanonicalJson };

export type ProvenanceV2CanonicalDocumentResult =
  | {
      readonly outcome: "accepted_review_candidate";
      readonly authority_eligible: false;
      readonly errors: readonly [];
      readonly document: ProvenanceV2CanonicalJson;
      readonly canonical_bytes: Uint8Array;
    }
  | {
      readonly outcome: "authority_refused";
      readonly authority_eligible: false;
      readonly errors: readonly ProvenanceV2CanonicalDocumentError[];
      readonly document: null;
      readonly canonical_bytes: null;
    };

type MutableJson =
  | null
  | boolean
  | number
  | string
  | MutableJson[]
  | { [key: string]: MutableJson };

class ParseFailure extends Error {
  constructor(readonly code: ProvenanceV2CanonicalDocumentError) {
    super(code);
  }
}

const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
// The intrinsic accessors are intentionally invoked with Reflect.apply below.
// eslint-disable-next-line @typescript-eslint/unbound-method
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
// eslint-disable-next-line @typescript-eslint/unbound-method
const typedArrayBuffer = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)?.get;
const acceptedDocuments = new WeakSet<object>();

const isCanonicalUnicode = (value: string): boolean => {
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

class StrictJsonParser {
  private offset = 0;
  private nodes = 0;

  constructor(private readonly text: string) {}

  parse(): MutableJson {
    const value = this.value(0);
    if (this.offset !== this.text.length)
      throw new ParseFailure("invalid_json");
    return value;
  }

  private count(depth: number): void {
    if (depth > PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_DEPTH)
      throw new ParseFailure("document_depth_limit_exceeded");
    this.nodes += 1;
    if (this.nodes > PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_NODES)
      throw new ParseFailure("document_node_limit_exceeded");
  }

  private value(depth: number): MutableJson {
    this.count(depth);
    const character = this.text[this.offset];
    if (character === "{") return this.object(depth + 1);
    if (character === "[") return this.array(depth + 1);
    if (character === '"') return this.string();
    if (this.text.startsWith("true", this.offset)) {
      this.offset += 4;
      return true;
    }
    if (this.text.startsWith("false", this.offset)) {
      this.offset += 5;
      return false;
    }
    if (this.text.startsWith("null", this.offset)) {
      this.offset += 4;
      return null;
    }
    return this.integer();
  }

  private object(depth: number): Record<string, MutableJson> {
    this.offset += 1;
    const result: Record<string, MutableJson> = Object.create(null) as Record<
      string,
      MutableJson
    >;
    const seen = new Set<string>();
    if (this.text[this.offset] === "}") {
      this.offset += 1;
      return result;
    }
    while (this.offset < this.text.length) {
      if (this.text[this.offset] !== '"')
        throw new ParseFailure("invalid_json");
      const key = this.string();
      if (seen.has(key)) throw new ParseFailure("duplicate_object_key");
      seen.add(key);
      if (this.text[this.offset] !== ":")
        throw new ParseFailure("invalid_json");
      this.offset += 1;
      Object.defineProperty(result, key, {
        value: this.value(depth),
        enumerable: true,
        configurable: false,
        writable: false,
      });
      const delimiter = this.text[this.offset];
      if (delimiter === "}") {
        this.offset += 1;
        return result;
      }
      if (delimiter !== ",") throw new ParseFailure("invalid_json");
      this.offset += 1;
    }
    throw new ParseFailure("invalid_json");
  }

  private array(depth: number): MutableJson[] {
    this.offset += 1;
    const result: MutableJson[] = [];
    if (this.text[this.offset] === "]") {
      this.offset += 1;
      return result;
    }
    while (this.offset < this.text.length) {
      result.push(this.value(depth));
      const delimiter = this.text[this.offset];
      if (delimiter === "]") {
        this.offset += 1;
        return result;
      }
      if (delimiter !== ",") throw new ParseFailure("invalid_json");
      this.offset += 1;
    }
    throw new ParseFailure("invalid_json");
  }

  private string(): string {
    const start = this.offset;
    this.offset += 1;
    while (this.offset < this.text.length) {
      const unit = this.text.charCodeAt(this.offset);
      if (unit === 0x22) {
        this.offset += 1;
        let value: string;
        try {
          value = JSON.parse(this.text.slice(start, this.offset)) as string;
        } catch {
          throw new ParseFailure("invalid_json");
        }
        if (!isCanonicalUnicode(value))
          throw new ParseFailure("noncanonical_unicode");
        return value;
      }
      if (unit < 0x20) throw new ParseFailure("invalid_json");
      if (unit === 0x5c) {
        this.offset += 1;
        const escape = this.text[this.offset];
        if (escape === "u") {
          if (
            !/^[0-9a-fA-F]{4}$/u.test(
              this.text.slice(this.offset + 1, this.offset + 5),
            )
          )
            throw new ParseFailure("invalid_json");
          this.offset += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape))
          throw new ParseFailure("invalid_json");
      }
      this.offset += 1;
    }
    throw new ParseFailure("invalid_json");
  }

  private integer(): number {
    const remainder = this.text.slice(this.offset);
    const token = /^-?(?:0|[1-9][0-9]*)/u.exec(remainder)?.[0];
    if (token === undefined) throw new ParseFailure("invalid_json");
    const next = remainder[token.length];
    if (next === "." || next === "e" || next === "E")
      throw new ParseFailure("noncanonical_integer");
    if (token === "-0" || token.length > 17)
      throw new ParseFailure("noncanonical_integer");
    const value = Number(token);
    if (!Number.isSafeInteger(value))
      throw new ParseFailure("noncanonical_integer");
    this.offset += token.length;
    return value;
  }
}

const canonicalJson = (value: ProvenanceV2CanonicalJson): string => {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const child = value[key];
      if (child === undefined) throw new ParseFailure("invalid_json");
      return `${JSON.stringify(key)}:${canonicalJson(child)}`;
    })
    .join(",")}}`;
};

const freezeJson = (value: ProvenanceV2CanonicalJson): void => {
  if (typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) value.forEach(freezeJson);
  else Object.values(value).forEach(freezeJson);
  Object.freeze(value);
};

const reject = (
  ...errors: readonly ProvenanceV2CanonicalDocumentError[]
): ProvenanceV2CanonicalDocumentResult => ({
  outcome: "authority_refused",
  authority_eligible: false,
  errors: [...new Set(errors)].slice(0, MAX_ERRORS),
  document: null,
  canonical_bytes: null,
});

export const parseProvenanceV2CanonicalDocument = (
  input: Uint8Array,
): ProvenanceV2CanonicalDocumentResult => {
  let bytes: Uint8Array;
  try {
    if (typedArrayByteLength === undefined || typedArrayBuffer === undefined)
      return reject("input_not_plain_uint8array");
    const byteLength = Reflect.apply(typedArrayByteLength, input, []) as number;
    const buffer = Reflect.apply(typedArrayBuffer, input, []) as unknown;
    if (Object.getPrototypeOf(input) !== Uint8Array.prototype)
      return reject("input_not_plain_uint8array");
    if (!(buffer instanceof ArrayBuffer))
      return reject("input_not_plain_uint8array");
    if (byteLength > PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_BYTES)
      return reject("input_byte_limit_exceeded");
    bytes = Uint8Array.prototype.slice.call(input);
  } catch {
    return reject("input_not_plain_uint8array");
  }
  let text: string;
  try {
    text = new textCodecGlobal.TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    return reject("invalid_utf8");
  }
  if (text.startsWith("\uFEFF")) return reject("bom_not_allowed");
  let document: ProvenanceV2CanonicalJson;
  try {
    document = new StrictJsonParser(text).parse();
  } catch (error) {
    return reject(error instanceof ParseFailure ? error.code : "invalid_json");
  }
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document)
  )
    return reject("invalid_json");
  const canonicalBytes = encodeUtf8(canonicalJson(document));
  if (
    canonicalBytes.byteLength !== bytes.byteLength ||
    canonicalBytes.some((byte, index) => byte !== bytes[index])
  )
    return reject("noncanonical_document_bytes");
  freezeJson(document);
  acceptedDocuments.add(document);
  return {
    outcome: "accepted_review_candidate",
    authority_eligible: false,
    errors: [],
    document,
    canonical_bytes: canonicalBytes.slice(),
  };
};

type DocumentSelector =
  | {
      readonly wildcard_ordinal: number;
      readonly kind: "array_object_by_field";
      readonly row_column: string;
      readonly member_field: string;
    }
  | {
      readonly wildcard_ordinal: number;
      readonly kind: "array_index_by_ordinal";
      readonly row_column: string;
    }
  | {
      readonly wildcard_ordinal: number;
      readonly kind: "object_key_via_array_lookup";
      readonly row_column: string;
      readonly lookup_array_pointer: string;
      readonly lookup_match_field: string;
      readonly lookup_value_field: string;
    };

interface DocumentBinding {
  readonly kind: "document_value";
  readonly document: "registration_plan";
  readonly pointer_pattern: string;
  readonly selectors: readonly DocumentSelector[];
  readonly encoding: "nfc_utf8" | "rfc8785_jcs";
  readonly null_result: "null" | "reject";
}

const ownObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unescapePointerToken = (token: string): string => {
  if (/(?:~(?![01])|~$)/u.test(token))
    throw new ParseFailure("document_selector_binding_not_found");
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
};

const rowValue = (
  row: Readonly<Record<string, string | number | boolean | null>>,
  column: string,
): string | number | boolean | null => {
  const descriptor = Object.getOwnPropertyDescriptor(row, column);
  if (descriptor === undefined || !("value" in descriptor))
    throw new ParseFailure("document_selector_invalid_row");
  const value: unknown = descriptor.value;
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  )
    throw new ParseFailure("document_selector_invalid_row");
  return value;
};

const select = (
  value: unknown,
  binding: DocumentBinding,
  row: Readonly<Record<string, string | number | boolean | null>>,
): ProvenanceV2CanonicalJson => {
  if (!binding.pointer_pattern.startsWith("/"))
    throw new ParseFailure("document_selector_binding_not_found");
  const tokens = binding.pointer_pattern
    .split("/")
    .slice(1)
    .map(unescapePointerToken);
  const wildcardCount = tokens.filter((token) => token === "*").length;
  const selectorOrdinals = binding.selectors
    .map((selector) => selector.wildcard_ordinal)
    .sort((left, right) => left - right);
  if (
    selectorOrdinals.length !== wildcardCount ||
    selectorOrdinals.some((ordinal, index) => ordinal !== index)
  )
    throw new ParseFailure("document_selector_binding_not_found");
  let current: unknown = value;
  let wildcardOrdinal = 0;
  for (const token of tokens) {
    if (token !== "*") {
      if (Array.isArray(current)) {
        if (!/^(?:0|[1-9][0-9]*)$/u.test(token))
          throw new ParseFailure("document_selector_type_mismatch");
        const index = Number(token);
        if (index >= current.length)
          throw new ParseFailure("document_selector_index_out_of_bounds");
        current = current[index];
      } else {
        if (!ownObject(current) || !Object.hasOwn(current, token))
          throw new ParseFailure("document_selector_no_match");
        current = current[token];
      }
      continue;
    }
    const selector = binding.selectors.find(
      (candidate: DocumentSelector) =>
        candidate.wildcard_ordinal === wildcardOrdinal,
    );
    wildcardOrdinal += 1;
    if (selector === undefined || !Array.isArray(current))
      throw new ParseFailure("document_selector_type_mismatch");
    if (selector.kind === "array_index_by_ordinal") {
      const ordinal = rowValue(row, selector.row_column);
      if (
        !Number.isSafeInteger(ordinal) ||
        typeof ordinal !== "number" ||
        Object.is(ordinal, -0) ||
        ordinal < 0
      )
        throw new ParseFailure("document_selector_invalid_row");
      if (ordinal >= current.length)
        throw new ParseFailure("document_selector_index_out_of_bounds");
      current = current[ordinal];
      continue;
    }
    if (selector.kind === "object_key_via_array_lookup")
      throw new ParseFailure("document_selector_type_mismatch");
    const expected = rowValue(row, selector.row_column);
    const matches = current.filter(
      (candidate) =>
        ownObject(candidate) &&
        Object.hasOwn(candidate, selector.member_field) &&
        candidate[selector.member_field] === expected,
    );
    if (matches.length === 0)
      throw new ParseFailure("document_selector_no_match");
    if (matches.length !== 1)
      throw new ParseFailure("document_selector_multiple_matches");
    current = matches[0];
  }
  return current as ProvenanceV2CanonicalJson;
};

interface DocumentCountBinding {
  readonly kind:
    | "document_array_length"
    | "document_declared_integer"
    | "document_filtered_array_length";
  readonly pointer_pattern: string;
  readonly selectors?: readonly DocumentSelector[];
  readonly predicate?: {
    readonly member_field: string;
    readonly equals: string;
  };
}

export const PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT = Object.freeze({
  contract_version: "provenance-v2-registration-document-resolver@1",
  status: "review_candidate",
  coverage: "strict_canonical_byte_and_compiled_selector_engine",
  outcome: "authority_refused",
  authority_eligible: false,
  persisted: false,
  document_resolver_executed: true,
  retained_resolver_executed: false,
  semantic_oracle_executed: false,
  trusted_input_byte_ceiling: PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_BYTES,
  trusted_input_depth_ceiling: PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_DEPTH,
  trusted_input_node_ceiling: PROVENANCE_V2_CANONICAL_DOCUMENT_MAX_NODES,
  document_value_binding_count: 18,
  document_count_binding_count: 27,
  exact_binding_inventory_sha256:
    "sha256:e4ef1d3dcf0864fff347ca997b9a0320d8a7aecb8b40b737e2bcad37276b3025",
  pending: Object.freeze({
    schema_valid_registration_plan_fixture: "pending_h2d_b",
    aggregate_declared_count_parity: "pending_h2d_b",
    normalized_inventory_parity: "pending_h2d_b",
    retained_chunk_planning_and_reassembly: "pending_h2d_b",
    safe_preimage_occurrence_parity: "pending_h2d_b",
    external_and_repository_anchors: "pending",
    reviewed_repository_build_manifest: "pending",
    semantic_oracle: "pending",
    migration_schema_parity: "pending",
    frozen_d1_enumeration: "pending",
    accepted_aggregate_limits: "pending",
  }),
} as const);

export const validateProvenanceV2DocumentResolverContract = (): string[] => {
  const errors: string[] = [];
  const digestBindings = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.filter(
    (entry) =>
      (entry.binding as { readonly kind?: string }).kind === "document_value",
  );
  const countBindings = PROVENANCE_V2_ROOT_BINDING_PLAN.count_bindings.filter(
    (entry) =>
      [
        "document_array_length",
        "document_declared_integer",
        "document_filtered_array_length",
      ].includes((entry.binding as { readonly kind?: string }).kind ?? ""),
  );
  if (
    digestBindings.length !==
    PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT.document_value_binding_count
  )
    errors.push("document-value binding inventory drifted");
  if (
    countBindings.length !==
    PROVENANCE_V2_DOCUMENT_RESOLVER_CONTRACT.document_count_binding_count
  )
    errors.push("document-count binding inventory drifted");
  for (const entry of [...digestBindings, ...countBindings]) {
    const binding = entry.binding as {
      readonly pointer_pattern?: string;
      readonly selectors?: readonly DocumentSelector[];
    };
    try {
      if (binding.pointer_pattern === undefined)
        throw new ParseFailure("document_selector_binding_not_found");
      const tokens = binding.pointer_pattern
        .split("/")
        .slice(1)
        .map(unescapePointerToken);
      const wildcardCount = tokens.filter((token) => token === "*").length;
      const ordinals = (binding.selectors ?? [])
        .map((selector) => selector.wildcard_ordinal)
        .sort((left, right) => left - right);
      if (
        !binding.pointer_pattern.startsWith("/") ||
        ordinals.length !== wildcardCount ||
        ordinals.some((ordinal, index) => ordinal !== index)
      )
        throw new ParseFailure("document_selector_binding_not_found");
    } catch {
      errors.push(`document selector binding is not closed: ${entry.table}`);
    }
  }
  return errors;
};

export const resolveProvenanceV2DocumentCountCandidate = (
  document: ProvenanceV2CanonicalJson,
  table: string,
  row: Readonly<Record<string, string | number | boolean | null>>,
):
  | {
      readonly outcome: "resolved_review_candidate";
      readonly authority_eligible: false;
      readonly count: number;
      readonly errors: readonly [];
    }
  | {
      readonly outcome: "authority_refused";
      readonly authority_eligible: false;
      readonly errors: readonly ProvenanceV2CanonicalDocumentError[];
    } => {
  if (
    document === null ||
    typeof document !== "object" ||
    !acceptedDocuments.has(document)
  )
    return {
      outcome: "authority_refused",
      authority_eligible: false,
      errors: ["document_not_admitted"],
    };
  const entry = PROVENANCE_V2_ROOT_BINDING_PLAN.count_bindings.find(
    (candidate) =>
      candidate.table === table &&
      [
        "document_array_length",
        "document_declared_integer",
        "document_filtered_array_length",
      ].includes((candidate.binding as { readonly kind?: string }).kind ?? ""),
  );
  if (entry === undefined)
    return {
      outcome: "authority_refused",
      authority_eligible: false,
      errors: ["document_selector_binding_not_found"],
    };
  try {
    const binding = entry.binding as DocumentCountBinding;
    const value = select(
      document,
      {
        kind: "document_value",
        document: "registration_plan",
        pointer_pattern: binding.pointer_pattern,
        selectors: binding.selectors ?? [],
        encoding: "rfc8785_jcs",
        null_result: "reject",
      },
      row,
    );
    let count: number;
    if (binding.kind === "document_declared_integer") {
      if (
        !Number.isSafeInteger(value) ||
        typeof value !== "number" ||
        value < 0
      )
        throw new ParseFailure("document_selector_type_mismatch");
      count = value;
    } else {
      if (!Array.isArray(value))
        throw new ParseFailure("document_selector_type_mismatch");
      count =
        binding.kind === "document_filtered_array_length"
          ? value.filter(
              (candidate) =>
                ownObject(candidate) &&
                binding.predicate !== undefined &&
                candidate[binding.predicate.member_field] ===
                  binding.predicate.equals,
            ).length
          : value.length;
    }
    return {
      outcome: "resolved_review_candidate",
      authority_eligible: false,
      count,
      errors: [],
    };
  } catch (error) {
    return {
      outcome: "authority_refused",
      authority_eligible: false,
      errors: [
        error instanceof ParseFailure
          ? error.code
          : "document_selector_type_mismatch",
      ],
    };
  }
};

export const resolveProvenanceV2DocumentValueCandidate = (
  document: ProvenanceV2CanonicalJson,
  table: string,
  field: string,
  row: Readonly<Record<string, string | number | boolean | null>>,
):
  | {
      readonly outcome: "resolved_review_candidate";
      readonly authority_eligible: false;
      readonly encoding: "nfc_utf8" | "rfc8785_jcs";
      readonly value: null;
      readonly preimage_kind: "absent";
      readonly preimage_bytes: null;
      readonly errors: readonly [];
    }
  | {
      readonly outcome: "resolved_review_candidate";
      readonly authority_eligible: false;
      readonly encoding: "nfc_utf8" | "rfc8785_jcs";
      readonly value: Exclude<ProvenanceV2CanonicalJson, null>;
      readonly preimage_kind: "bytes";
      readonly preimage_bytes: Uint8Array;
      readonly errors: readonly [];
    }
  | {
      readonly outcome: "authority_refused";
      readonly authority_eligible: false;
      readonly errors: readonly ProvenanceV2CanonicalDocumentError[];
    } => {
  if (
    document === null ||
    typeof document !== "object" ||
    !acceptedDocuments.has(document)
  )
    return {
      outcome: "authority_refused",
      authority_eligible: false,
      errors: ["document_not_admitted"],
    };
  const entry = PROVENANCE_V2_ROOT_BINDING_PLAN.digest_bindings.find(
    (candidate) =>
      candidate.table === table &&
      candidate.field === field &&
      (candidate.binding as { readonly kind?: string }).kind ===
        "document_value",
  );
  if (
    entry === undefined ||
    (entry.binding as { readonly kind?: string }).kind !== "document_value"
  )
    return {
      outcome: "authority_refused",
      authority_eligible: false,
      errors: ["document_selector_binding_not_found"],
    };
  try {
    const binding = entry.binding as DocumentBinding;
    const value = select(document, binding, row);
    if (value === null && binding.null_result === "reject")
      throw new ParseFailure("document_selector_type_mismatch");
    if (value === null)
      return {
        outcome: "resolved_review_candidate",
        authority_eligible: false,
        encoding: binding.encoding,
        value: null,
        preimage_kind: "absent",
        preimage_bytes: null,
        errors: [],
      };
    if (binding.encoding === "nfc_utf8" && typeof value !== "string")
      throw new ParseFailure("document_selector_type_mismatch");
    const preimage =
      binding.encoding === "nfc_utf8"
        ? encodeUtf8(value as string)
        : encodeUtf8(canonicalJson(value));
    return {
      outcome: "resolved_review_candidate",
      authority_eligible: false,
      encoding: binding.encoding,
      value: value,
      preimage_kind: "bytes",
      preimage_bytes: preimage,
      errors: [],
    };
  } catch (error) {
    return {
      outcome: "authority_refused",
      authority_eligible: false,
      errors: [
        error instanceof ParseFailure
          ? error.code
          : "document_selector_type_mismatch",
      ],
    };
  }
};
