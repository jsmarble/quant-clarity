import { createHash } from "node:crypto";

import { parse, type ParseError, visit } from "jsonc-parser";

import type { TraceRow } from "./verification-artifact-policy.js";

type JsonObject = Record<string, unknown>;

export const GDPR_ACCOUNTABILITY_MAX_BYTES = 65_536;
export const GDPR_ACCOUNTABILITY_ARTIFACT_MAX_BYTES = 262_144;
export const GDPR_ACCOUNTABILITY_ARTIFACTS_MAX_BYTES = 1_048_576;
export const GDPR_ACCOUNTABILITY_MANIFEST_PATH =
  "config/gdpr-accountability.json";
const MAX_ERRORS = 64;
const SHA256 = /^[0-9a-f]{64}$/u;

const scopeRequirementIds = [
  "LEG-005",
  "PRIV-005",
  "PRIV-008",
  "PRIV-009",
  "PRIV-010",
  "SEC-012",
] as const;

export const GDPR_ACCOUNTABILITY_PUBLIC_ARTIFACT_PATHS = [
  "apps/web/src/pages/privacy/index.astro",
  "docs/compliance/gdpr-accountability.md",
  "docs/compliance/privacy-notice.md",
  "docs/compliance/processing-record.md",
] as const;

const evidenceAuthority = [
  {
    id: "privacy_notice_and_formal_contact",
    requirementIds: ["LEG-005", "PRIV-005"],
    status: "draft",
  },
  {
    id: "cloudflare_processor_terms_transfers_subprocessors_locations",
    requirementIds: ["PRIV-008"],
    status: "pending",
  },
  {
    id: "processing_record_and_legal_determinations",
    requirementIds: ["PRIV-009"],
    status: "draft",
  },
  {
    id: "rights_request_procedure",
    requirementIds: ["PRIV-010"],
    status: "pending",
  },
  {
    id: "restricted_and_audited_evidence_access",
    requirementIds: ["SEC-012"],
    status: "pending",
  },
  {
    id: "authorized_owner_signoff",
    requirementIds: [...scopeRequirementIds],
    status: "pending",
  },
] as const;

export interface GdprAccountabilityInputs {
  artifactBytes: ReadonlyMap<string, Uint8Array>;
  manifest: unknown;
  repositoryFiles: ReadonlySet<string>;
  traceRows: readonly TraceRow[];
}

export interface ParsedGdprAccountabilityManifest {
  errors: string[];
  manifest: unknown;
}

const exactObject = (
  value: unknown,
  expectedKeys: readonly string[],
): JsonObject | null => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string") ||
      [...expectedKeys]
        .sort()
        .some((key, index) => [...(keys as string[])].sort()[index] !== key)
    )
      return null;
    const snapshot: JsonObject = Object.create(null) as JsonObject;
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

const exactArray = (
  value: unknown,
  maximumLength: number,
): readonly unknown[] | null => {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maximumLength
    )
      return null;
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

const exactStrings = (value: unknown, expected: readonly string[]): boolean => {
  const values = exactArray(value, expected.length);
  return (
    values !== null &&
    values.length === expected.length &&
    values.every(
      (entry, index) =>
        typeof entry === "string" &&
        entry.length <= 64 &&
        entry === expected[index],
    )
  );
};

const addError = (errors: string[], message: string): void => {
  if (errors.length < MAX_ERRORS) errors.push(message);
};

export function parseGdprAccountabilityManifest(
  bytes: Uint8Array,
): ParsedGdprAccountabilityManifest {
  if (bytes.byteLength > GDPR_ACCOUNTABILITY_MAX_BYTES)
    return {
      errors: ["manifest exceeds the 65,536-byte input limit"],
      manifest: null,
    };
  let contents: string;
  try {
    contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { errors: ["manifest is not valid UTF-8"], manifest: null };
  }
  const errors: string[] = [];
  const propertySets: Set<string>[] = [];
  visit(contents, {
    onError: () => {
      addError(errors, "manifest is not strict JSON");
    },
    onObjectBegin: () => {
      propertySets.push(new Set());
    },
    onObjectProperty: (property) => {
      const properties = propertySets.at(-1);
      if (properties?.has(property) === true)
        addError(errors, `manifest contains duplicate property ${property}`);
      properties?.add(property);
    },
    onObjectEnd: () => {
      propertySets.pop();
    },
  });
  const parseErrors: ParseError[] = [];
  const manifest = parse(contents, parseErrors, {
    allowTrailingComma: false,
    disallowComments: true,
  }) as unknown;
  if (parseErrors.length > 0) addError(errors, "manifest is not strict JSON");
  return { errors: [...new Set(errors)].slice(0, MAX_ERRORS), manifest };
}

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const safeRepositoryPath = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 256 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  value
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");

export function validateGdprAccountabilityPolicy(
  inputs: GdprAccountabilityInputs,
): string[] {
  const errors: string[] = [];
  const manifest = exactObject(inputs.manifest, [
    "compliance_claim_allowed",
    "evidence_categories",
    "gate_id",
    "gate_passed",
    "public_artifacts",
    "release_authorized",
    "review_policy",
    "schema_version",
    "scope_requirement_ids",
    "status",
  ]);
  if (manifest === null) return ["manifest must use the exact closed schema"];
  if (manifest.schema_version !== "1.0.0")
    addError(errors, "schema_version must be 1.0.0");
  if (manifest.gate_id !== "GATE-gdpr-accountability")
    addError(errors, "gate_id must be GATE-gdpr-accountability");
  if (manifest.status !== "release_blocked")
    addError(errors, "v1 status must remain release_blocked");
  if (manifest.gate_passed !== false)
    addError(errors, "v1 cannot claim the GDPR accountability gate passed");
  if (manifest.release_authorized !== false)
    addError(errors, "v1 cannot authorize public release");
  if (manifest.compliance_claim_allowed !== false)
    addError(errors, "engineering must not claim GDPR compliance");
  if (!exactStrings(manifest.scope_requirement_ids, scopeRequirementIds))
    addError(errors, "scope_requirement_ids differ from the approved gate");

  const reviewPolicy = exactObject(manifest.review_policy, [
    "cadence",
    "maximum_age_days",
    "owner_role",
  ]);
  if (
    reviewPolicy?.owner_role !== "authorized_legal_product_owner" ||
    reviewPolicy.cadence !== "annual_and_material_change" ||
    reviewPolicy.maximum_age_days !== 366
  )
    addError(errors, "review_policy differs from the approved owner cadence");

  const publicArtifacts = exactArray(
    manifest.public_artifacts,
    GDPR_ACCOUNTABILITY_PUBLIC_ARTIFACT_PATHS.length,
  );
  let totalArtifactBytes = 0;
  if (
    publicArtifacts?.length !== GDPR_ACCOUNTABILITY_PUBLIC_ARTIFACT_PATHS.length
  ) {
    addError(
      errors,
      "public_artifacts must contain the exact bounded inventory",
    );
  } else {
    for (
      let index = 0;
      index < GDPR_ACCOUNTABILITY_PUBLIC_ARTIFACT_PATHS.length;
      index += 1
    ) {
      const row = exactObject(publicArtifacts[index], ["path", "sha256"]);
      const expectedPath = GDPR_ACCOUNTABILITY_PUBLIC_ARTIFACT_PATHS[index];
      if (
        row === null ||
        typeof row.path !== "string" ||
        !safeRepositoryPath(row.path) ||
        row.path !== expectedPath ||
        typeof row.sha256 !== "string" ||
        row.sha256.length > 64 ||
        !SHA256.test(row.sha256)
      ) {
        addError(errors, `public_artifacts[${String(index)}] is invalid`);
        continue;
      }
      if (!inputs.repositoryFiles.has(expectedPath))
        addError(errors, `${expectedPath} is not a tracked repository file`);
      const bytes = inputs.artifactBytes.get(expectedPath);
      if (bytes === undefined) {
        addError(errors, `${expectedPath} is missing`);
        continue;
      }
      totalArtifactBytes += bytes.byteLength;
      if (bytes.byteLength > GDPR_ACCOUNTABILITY_ARTIFACT_MAX_BYTES)
        addError(errors, `${expectedPath} exceeds the 256 KiB artifact limit`);
      if (sha256(bytes) !== row.sha256)
        addError(errors, `${expectedPath} does not match its reviewed digest`);
    }
  }
  if (totalArtifactBytes > GDPR_ACCOUNTABILITY_ARTIFACTS_MAX_BYTES)
    addError(errors, "public accountability artifacts exceed 1 MiB total");

  const categories = exactArray(
    manifest.evidence_categories,
    evidenceAuthority.length,
  );
  if (categories?.length !== evidenceAuthority.length) {
    addError(errors, "evidence_categories must contain the exact v1 inventory");
  } else {
    for (let index = 0; index < evidenceAuthority.length; index += 1) {
      const row = exactObject(categories[index], [
        "approved_on",
        "id",
        "next_review_due",
        "private_approval_reference",
        "requirement_ids",
        "status",
      ]);
      const expected = evidenceAuthority[index]!;
      if (row === null) {
        addError(
          errors,
          `evidence_categories[${String(index)}] is not an exact record`,
        );
        continue;
      }
      if (
        typeof row.id !== "string" ||
        row.id.length > 64 ||
        row.id !== expected.id
      )
        addError(
          errors,
          `evidence_categories[${String(index)}] has an invalid id`,
        );
      if (!exactStrings(row.requirement_ids, expected.requirementIds))
        addError(
          errors,
          `evidence_categories[${String(index)}] has an invalid requirement mapping`,
        );
      if (row.status !== expected.status)
        addError(
          errors,
          `evidence_categories[${String(index)}] must remain ${expected.status} in v1`,
        );
      if (
        row.private_approval_reference !== null ||
        row.approved_on !== null ||
        row.next_review_due !== null
      )
        addError(
          errors,
          `evidence_categories[${String(index)}] cannot contain approval metadata in v1`,
        );
    }
  }

  const traceBySource = new Map(
    inputs.traceRows.map((row) => [row.sourceId, row] as const),
  );
  for (const sourceId of scopeRequirementIds) {
    const trace = traceBySource.get(sourceId);
    if (trace === undefined)
      addError(errors, `${sourceId} is missing from traceability`);
    else if (trace.status !== "Planned")
      addError(errors, `${sourceId} must remain Planned in pending-only v1`);
  }

  const markerExpectations = new Map<string, readonly string[]>([
    [
      "apps/web/src/pages/privacy/index.astro",
      [
        "<strong>Release gate:</strong> Controller identity, legal contact, transfer terms, rights-request procedure, and retention/accountability records must be finalized before this working notice is published to production.",
      ],
    ],
    [
      "docs/compliance/gdpr-accountability.md",
      [
        "Release blocked",
        "No row may be marked complete from an agent assertion alone.",
      ],
    ],
    [
      "docs/compliance/privacy-notice.md",
      ["release-blocked draft", "RELEASE BLOCKER"],
    ],
    [
      "docs/compliance/processing-record.md",
      ["public-safe draft", "RELEASE BLOCKER"],
    ],
  ]);
  for (const [path, markers] of markerExpectations) {
    const bytes = inputs.artifactBytes.get(path);
    if (bytes === undefined) continue;
    let contents: string;
    try {
      contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      addError(errors, `${path} is not valid UTF-8`);
      continue;
    }
    const normalizedContents = contents.replace(/\s+/gu, " ");
    for (const marker of markers)
      if (!normalizedContents.includes(marker))
        addError(errors, `${path} no longer declares its pending-state marker`);
    if (
      /\b(?:GDPR[- ]compliant|GDPR compliance approved|release authorized|approved for production|final privacy notice)\b/iu.test(
        contents,
      )
    )
      addError(errors, `${path} contains a prohibited pending-state claim`);
  }

  return errors.slice(0, MAX_ERRORS);
}
