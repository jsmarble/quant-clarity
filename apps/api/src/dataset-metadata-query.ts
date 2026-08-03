import {
  assertApiLimits,
  buildQueryServiceEnvelope,
  type ApiLimits,
  type DatasetMetadataQueryRpcV1,
  type DeploymentEnvironment,
  type NormalizedRequest,
  type ReadDatasetMetadataV1Input,
} from "@quant-clarity/api-core";
import type { DatasetMetadata } from "@quant-clarity/contracts";

const AUDIENCE = "quantclarity-catalog-query-v1" as const;
const FRESH_REQUEST_HORIZON_MS = 15 * 60 * 1000;
const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");
const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const RFC3339_MILLISECONDS =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/u;
const UTF8 = new TextEncoder();
const DEGRADATION_NOTICES = new Set([
  "One or more enabled provider slices are stale.",
  "One or more enabled provider slices are unavailable.",
]);

export type DatasetMetadataApiOutcome =
  | Readonly<{
      success: true;
      metadata: DatasetMetadata;
      publicationId: string;
      representationBytes: Uint8Array;
    }>
  | Readonly<{
      success: false;
      code: "publication_expired";
      currentPublicationId: string;
    }>
  | Readonly<{
      success: false;
      code:
        | "integrity_failure"
        | "invalid_input"
        | "publication_not_ready"
        | "read_failure";
    }>;

export type DatasetMetadataApiInput = Readonly<{
  environment: DeploymentEnvironment;
  limits: ApiLimits;
  nowMs: number;
  request: NormalizedRequest;
  service: DatasetMetadataQueryRpcV1 | Service;
}>;

const snapshotOwnRecord = (
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) return null;
    const actualKeys = (ownKeys as string[]).sort();
    const sortedExpected = [...expectedKeys].sort();
    if (
      actualKeys.length !== sortedExpected.length ||
      sortedExpected.some((key, index) => actualKeys[index] !== key)
    )
      return null;
    const snapshot: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      )
        return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
};

const snapshotArray = (
  value: unknown,
  maximumLength: number,
): readonly unknown[] | null => {
  try {
    if (!Array.isArray(value)) return null;
    if (value.length > maximumLength) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1 ||
      keys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" &&
            (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)),
      )
    )
      return null;
    const snapshot: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      )
        return null;
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
};

const validUnicodeScalars = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
};

const boundedString = (
  value: unknown,
  minimumScalars: number,
  maximumScalars: number,
): value is string =>
  typeof value === "string" &&
  validUnicodeScalars(value) &&
  Array.from(value).length >= minimumScalars &&
  Array.from(value).length <= maximumScalars;

const canonicalTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string" || !RFC3339_MILLISECONDS.test(value))
    return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const snapshotMethodologyUrl = (
  value: unknown,
  methodologyVersion: string,
): string | null => {
  if (!boundedString(value, 1, 2048)) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.pathname !== `/v1/methodologies/${methodologyVersion}` ||
      parsed.href !== value
    )
      return null;
    return parsed.href;
  } catch {
    return null;
  }
};

const snapshotMetadata = (value: unknown): DatasetMetadata | null => {
  try {
    const metadata = snapshotOwnRecord(value, [
      "api_version",
      "counts",
      "degradation_notices",
      "generated_at",
      "methodology_effective_at",
      "methodology_url",
      "methodology_version",
      "next_refresh_window",
      "precision_display_order_version",
      "precision_normalization_version",
      "price_policy_version",
      "publication_id",
      "published_at",
      "schema_version",
    ]);
    if (
      metadata === null ||
      typeof metadata.publication_id !== "string" ||
      !PUBLICATION_ID.test(metadata.publication_id) ||
      typeof metadata.schema_version !== "string" ||
      !SEMVER.test(metadata.schema_version) ||
      metadata.api_version !== "1" ||
      !boundedString(metadata.methodology_version, 1, 64) ||
      !canonicalTimestamp(metadata.methodology_effective_at) ||
      !boundedString(metadata.precision_normalization_version, 1, 64) ||
      !boundedString(metadata.precision_display_order_version, 1, 64) ||
      !boundedString(metadata.price_policy_version, 1, 64) ||
      !canonicalTimestamp(metadata.published_at) ||
      !canonicalTimestamp(metadata.generated_at) ||
      Date.parse(metadata.generated_at) > Date.parse(metadata.published_at)
    )
      return null;
    const methodologyUrl = snapshotMethodologyUrl(
      metadata.methodology_url,
      metadata.methodology_version,
    );
    const refresh = snapshotOwnRecord(metadata.next_refresh_window, [
      "ends_at",
      "starts_at",
    ]);
    const counts = snapshotOwnRecord(metadata.counts, [
      "active_models",
      "active_offerings",
      "active_providers",
    ]);
    const notices = snapshotArray(metadata.degradation_notices, 50);
    if (
      methodologyUrl === null ||
      refresh === null ||
      !canonicalTimestamp(refresh.starts_at) ||
      !canonicalTimestamp(refresh.ends_at) ||
      Date.parse(refresh.starts_at) >= Date.parse(refresh.ends_at) ||
      counts === null ||
      !Number.isSafeInteger(counts.active_models) ||
      (counts.active_models as number) < 0 ||
      !Number.isSafeInteger(counts.active_offerings) ||
      (counts.active_offerings as number) < 0 ||
      !Number.isSafeInteger(counts.active_providers) ||
      (counts.active_providers as number) < 0 ||
      notices === null ||
      notices.some(
        (notice, index) =>
          typeof notice !== "string" ||
          !DEGRADATION_NOTICES.has(notice) ||
          (index > 0 && (notices[index - 1] as string) >= notice),
      )
    )
      return null;
    return {
      publication_id: metadata.publication_id,
      schema_version: metadata.schema_version,
      api_version: "1",
      methodology_version: metadata.methodology_version,
      methodology_effective_at: metadata.methodology_effective_at,
      methodology_url: methodologyUrl,
      precision_normalization_version: metadata.precision_normalization_version,
      precision_display_order_version: metadata.precision_display_order_version,
      price_policy_version: metadata.price_policy_version,
      published_at: metadata.published_at,
      generated_at: metadata.generated_at,
      next_refresh_window: {
        starts_at: refresh.starts_at,
        ends_at: refresh.ends_at,
      },
      counts: {
        active_models: counts.active_models as number,
        active_offerings: counts.active_offerings as number,
        active_providers: counts.active_providers as number,
      },
      degradation_notices: notices as string[],
    };
  } catch {
    return null;
  }
};

type ResolverClassification =
  | Readonly<{
      kind: "selected";
      bookmark: string;
      publicationId: string;
      requiredAvailableUntilMs: number;
    }>
  | Readonly<{
      kind: "failure";
      outcome: Exclude<DatasetMetadataApiOutcome, { success: true }>;
    }>
  | Readonly<{ kind: "invalid" }>;

const classifyResolver = (
  value: unknown,
  requiredAvailableUntilMs: number,
): ResolverClassification => {
  try {
    const failure = snapshotOwnRecord(value, ["outcome"]);
    if (failure !== null)
      return failure.outcome === "integrity_failure" ||
        failure.outcome === "publication_not_ready" ||
        failure.outcome === "read_failure"
        ? {
            kind: "failure",
            outcome: { success: false, code: failure.outcome },
          }
        : { kind: "invalid" };
    const expired = snapshotOwnRecord(value, [
      "currentPublicationId",
      "outcome",
    ]);
    if (expired !== null)
      return expired.outcome === "publication_expired" &&
        typeof expired.currentPublicationId === "string" &&
        PUBLICATION_ID.test(expired.currentPublicationId)
        ? {
            kind: "failure",
            outcome: {
              success: false,
              code: "publication_expired",
              currentPublicationId: expired.currentPublicationId,
            },
          }
        : { kind: "invalid" };
    const selected = snapshotOwnRecord(value, [
      "bookmark",
      "outcome",
      "publicationId",
      "requiredAvailableUntilMs",
    ]);
    if (
      selected?.outcome !== "selected" ||
      typeof selected.publicationId !== "string" ||
      !PUBLICATION_ID.test(selected.publicationId) ||
      typeof selected.bookmark !== "string" ||
      selected.bookmark.length === 0 ||
      selected.bookmark.length > 4096 ||
      selected.bookmark === "first-primary" ||
      selected.bookmark === "first-unconstrained" ||
      selected.requiredAvailableUntilMs !== requiredAvailableUntilMs
    )
      return { kind: "invalid" };
    return {
      kind: "selected",
      bookmark: selected.bookmark,
      publicationId: selected.publicationId,
      requiredAvailableUntilMs,
    };
  } catch {
    return { kind: "invalid" };
  }
};

export const readDatasetMetadataFromQueryV1 = async (
  input: DatasetMetadataApiInput,
): Promise<DatasetMetadataApiOutcome> => {
  try {
    assertApiLimits(input.limits);
    if (
      !Number.isSafeInteger(input.nowMs) ||
      input.nowMs < 0 ||
      input.nowMs > Number.MAX_SAFE_INTEGER - FRESH_REQUEST_HORIZON_MS ||
      input.request.operation.kind !== "metadata" ||
      input.request.route.operation.kind !== "metadata" ||
      input.request.route.policy !== null ||
      (input.request.method !== "GET" && input.request.method !== "HEAD") ||
      input.request.hasQueryString ||
      input.request.cursor !== null ||
      Object.keys(input.request.filters).length !== 0 ||
      input.request.query !== null ||
      input.request.sort.length !== 0 ||
      (input.request.publicationHeader !== null &&
        !PUBLICATION_ID.test(input.request.publicationHeader))
    )
      return { success: false, code: "invalid_input" };
    const service = input.service;
    const requiredAvailableUntilMs = input.nowMs + FRESH_REQUEST_HORIZON_MS;
    let resolverValue: unknown;
    try {
      resolverValue = await (
        service as DatasetMetadataQueryRpcV1
      ).resolvePublicationV2({
        version: 2,
        audience: AUDIENCE,
        environment: input.environment,
        requestedPublicationId: input.request.publicationHeader,
        requiredAvailableUntilMs,
      });
    } catch {
      return { success: false, code: "read_failure" };
    }
    const resolver = classifyResolver(resolverValue, requiredAvailableUntilMs);
    if (resolver.kind === "failure") return resolver.outcome;
    if (resolver.kind === "invalid")
      return { success: false, code: "integrity_failure" };
    if (
      input.request.publicationHeader !== null &&
      resolver.publicationId !== input.request.publicationHeader
    )
      return { success: false, code: "integrity_failure" };
    let envelope;
    try {
      envelope = buildQueryServiceEnvelope(
        input.request,
        resolver.publicationId,
        input.environment,
        null,
        input.limits,
      );
    } catch {
      return { success: false, code: "invalid_input" };
    }
    const readInput: ReadDatasetMetadataV1Input = {
      version: 1,
      audience: AUDIENCE,
      environment: input.environment,
      bookmark: resolver.bookmark,
      requiredAvailableUntilMs,
      envelope,
    };
    let metadataValue: unknown;
    try {
      metadataValue = await (
        service as DatasetMetadataQueryRpcV1
      ).readDatasetMetadataV1(readInput);
    } catch {
      return { success: false, code: "read_failure" };
    }
    const failure = snapshotOwnRecord(metadataValue, ["outcome"]);
    if (failure !== null) {
      if (
        failure.outcome === "integrity_failure" ||
        failure.outcome === "read_failure"
      )
        return { success: false, code: failure.outcome };
      return { success: false, code: "integrity_failure" };
    }
    const response = snapshotOwnRecord(metadataValue, ["metadata", "outcome"]);
    if (response?.outcome !== "metadata")
      return { success: false, code: "integrity_failure" };
    const metadata = snapshotMetadata(response.metadata);
    if (metadata?.publication_id !== resolver.publicationId)
      return { success: false, code: "integrity_failure" };
    const representationBytes = UTF8.encode(JSON.stringify(metadata));
    if (representationBytes.byteLength > input.limits.maxResponseBytes)
      return { success: false, code: "integrity_failure" };
    return {
      success: true,
      metadata,
      publicationId: resolver.publicationId,
      representationBytes,
    };
  } catch {
    return { success: false, code: "invalid_input" };
  }
};
