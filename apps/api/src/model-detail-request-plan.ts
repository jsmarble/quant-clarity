import {
  assertApiLimits,
  classifyModelDetailIdentifier,
  MODEL_DETAIL_API_PATH_PREFIX,
  parseModelDetailApiPath,
  validIfNoneMatch,
  validateAndNormalizeRequest,
  type ApiError,
  type ApiLimits,
  type NormalizedRequest,
  type RequestInput,
} from "@quant-clarity/api-core";

const UTF8 = new TextEncoder();

export type ModelDetailRequestPlan =
  | Readonly<{ error: ApiError; kind: "error" }>
  | Readonly<{ kind: "preflight" }>
  | Readonly<{
      identifier: string;
      identifierKind: "stable_id" | "slug";
      ifNoneMatch: string | null;
      kind: "lookup";
      request: NormalizedRequest;
    }>;

export type ModelDetailRequestPlanInput = Readonly<
  RequestInput & { ifNoneMatch: string | null }
>;

const INPUT_KEYS = [
  "bodyBytes",
  "hasQueryString",
  "ifNoneMatch",
  "method",
  "pathname",
  "publicationHeader",
  "rawQuery",
] as const;
const INPUT_KEY_SET: ReadonlySet<string> = new Set(INPUT_KEYS);

const snapshotInput = (value: unknown): ModelDetailRequestPlanInput | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== INPUT_KEYS.length ||
      keys.some((key) => typeof key !== "string" || !INPUT_KEY_SET.has(key))
    )
      return null;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of INPUT_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) return null;
      output[key] = descriptor.value;
    }
    if (
      typeof output.bodyBytes !== "number" ||
      typeof output.hasQueryString !== "boolean" ||
      (output.ifNoneMatch !== null && typeof output.ifNoneMatch !== "string") ||
      typeof output.method !== "string" ||
      typeof output.pathname !== "string" ||
      (output.publicationHeader !== null &&
        typeof output.publicationHeader !== "string") ||
      typeof output.rawQuery !== "string"
    )
      return null;
    return output as ModelDetailRequestPlanInput;
  } catch {
    return null;
  }
};

const failure = (
  code: ApiError["code"],
  message: string,
  status: ApiError["status"],
): ModelDetailRequestPlan => ({
  error: { code, message, status },
  kind: "error",
});

const modelPathHasInvalidSyntax = (pathname: string): boolean => {
  return (
    pathname.startsWith(MODEL_DETAIL_API_PATH_PREFIX) &&
    parseModelDetailApiPath(pathname) === null
  );
};

/** Pure B3-B request plan. It performs no limiter, cache, query, or logging effect. */
export const planModelDetailRequest = (
  input: ModelDetailRequestPlanInput,
  limits: ApiLimits,
): ModelDetailRequestPlan => {
  try {
    const requestInput = snapshotInput(input);
    if (requestInput === null)
      return failure(
        "invalid_parameter",
        "The Model detail request is malformed.",
        400,
      );
    assertApiLimits(limits);
    if (requestInput.hasQueryString) {
      const pathnameBytes = UTF8.encode(requestInput.pathname).byteLength;
      const queryBytes = UTF8.encode(requestInput.rawQuery).byteLength;
      if (
        pathnameBytes > limits.maxPathBytes ||
        queryBytes > limits.maxQueryBytes ||
        pathnameBytes + queryBytes + 1 > limits.maxUrlBytes
      )
        return failure(
          "query_too_large",
          "The request target exceeds the configured size limit.",
          413,
        );
    }
    const validation = validateAndNormalizeRequest(
      requestInput.hasQueryString
        ? { ...requestInput, hasQueryString: false, rawQuery: "" }
        : requestInput,
      limits,
    );
    if (!validation.success) {
      if (
        validation.error.code === "resource_not_found" &&
        modelPathHasInvalidSyntax(requestInput.pathname)
      )
        return failure(
          "invalid_parameter",
          "The Model identifier path is malformed.",
          400,
        );
      return { error: validation.error, kind: "error" };
    }

    const operation = validation.request.operation;
    if (operation.kind !== "detail" || operation.resourceType !== "model")
      return failure(
        "resource_not_found",
        "The requested resource does not exist.",
        404,
      );
    if (requestInput.hasQueryString)
      return failure(
        "invalid_parameter",
        "This route does not accept a query string.",
        400,
      );
    if (!validIfNoneMatch(requestInput.ifNoneMatch))
      return failure(
        "invalid_parameter",
        "If-None-Match is malformed or exceeds the configured size limit.",
        400,
      );
    const identifier = classifyModelDetailIdentifier(operation.identifier);
    if (identifier === null)
      return failure(
        "invalid_parameter",
        "The Model identifier path is malformed.",
        400,
      );
    if (validation.request.method === "OPTIONS") return { kind: "preflight" };
    return {
      identifier: operation.identifier,
      identifierKind: identifier.kind,
      ifNoneMatch: requestInput.ifNoneMatch,
      kind: "lookup",
      request: validation.request,
    };
  } catch {
    return failure(
      "invalid_parameter",
      "The Model detail request is malformed.",
      400,
    );
  }
};
