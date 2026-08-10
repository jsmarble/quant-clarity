import { posix } from "node:path";

type JsonObject = Record<string, unknown>;

export const TRACE_STATUSES = [
  "Planned",
  "Designed",
  "Implemented",
  "Verified",
  "Accepted",
  "Released",
] as const;

export type TraceStatus = (typeof TRACE_STATUSES)[number];

export interface TraceRow {
  sourceId: string;
  primaryVerificationId: string;
  status: TraceStatus;
}

export interface TraceParseResult {
  errors: string[];
  rows: TraceRow[];
}

export interface VerificationArtifactInputs {
  artifactContents: ReadonlyMap<string, string>;
  registry: unknown;
  repositoryFiles: ReadonlySet<string>;
  traceRows: readonly TraceRow[];
}

interface EvidenceCriterion {
  criterion: string;
  path: string;
}

interface ImplementedEvidenceAuthority {
  artifacts: readonly EvidenceCriterion[];
  primary_verification_id: string;
  source_id: string;
  trace_status: "Implemented";
}

export const IMPLEMENTED_EVIDENCE_AUTHORITY = [
  {
    source_id: "DATA-001",
    primary_verification_id: "CT-DATA-001",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/canonical/src/index.test.ts",
        criterion: "CT-DATA-001 stable identity",
      },
      {
        path: "packages/publication-core/src/model-slug-projection.test.ts",
        criterion: "CT-DATA-001 stable public slug rename determinism",
      },
    ],
  },
  {
    source_id: "DATA-020",
    primary_verification_id: "CT-DATA-020",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/canonical/src/migrations.test.ts",
        criterion: "CT-DATA-020 offering identity",
      },
    ],
  },
  {
    source_id: "DATA-030",
    primary_verification_id: "CT-DATA-030",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/contracts/src/index.test.ts",
        criterion: "CT-DATA-030 precision provenance",
      },
    ],
  },
  {
    source_id: "DATA-040",
    primary_verification_id: "CT-DATA-040",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/contracts/src/index.test.ts",
        criterion: "CT-DATA-040 exact price",
      },
    ],
  },
  {
    source_id: "DATA-051",
    primary_verification_id: "CT-DATA-051",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/canonical/src/migrations.test.ts",
        criterion: "CT-DATA-051 exact applicability",
      },
    ],
  },
  {
    source_id: "DATA-055",
    primary_verification_id: "CT-DATA-055",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/canonical/src/index.test.ts",
        criterion: "CT-DATA-055 currency preservation",
      },
    ],
  },
  {
    source_id: "DATA-060",
    primary_verification_id: "CT-DATA-060",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/contracts/src/index.test.ts",
        criterion: "CT-DATA-060 evidence-backed known facts",
      },
    ],
  },
  {
    source_id: "DATA-063",
    primary_verification_id: "CT-DATA-063",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/acquisition/src/index.test.ts",
        criterion: "CT-DATA-063 pre-retention DLP and redaction",
      },
    ],
  },
  {
    source_id: "PIPE-010",
    primary_verification_id: "PIT-PIPE-010",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/adapters/fireworks/src/index.test.ts",
        criterion: "PIT-PIPE-010 isolated adapter boundary",
      },
    ],
  },
  {
    source_id: "PIPE-012",
    primary_verification_id: "PIT-PIPE-012",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/adapters/fireworks/src/index.test.ts",
        criterion: "PIT-PIPE-012 declared adapter manifest",
      },
    ],
  },
  {
    source_id: "PIPE-017",
    primary_verification_id: "PIT-PIPE-017",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/adapters/fireworks/src/index.test.ts",
        criterion: "PIT-PIPE-017 redacted fixture provenance",
      },
    ],
  },
  {
    source_id: "PIPE-019",
    primary_verification_id: "PIT-PIPE-019",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/adapters/fireworks/src/index.test.ts",
        criterion: "PIT-PIPE-019 versioned launch roster",
      },
    ],
  },
  {
    source_id: "QA-001",
    primary_verification_id: "QGA-QA-001",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/domain/src/index.test.ts",
        criterion: "QGA-QA-001 normalization",
      },
      {
        path: "packages/domain/src/index.test.ts",
        criterion: "QGA-QA-001 precision",
      },
      {
        path: "packages/canonical/src/migrations.test.ts",
        criterion: "QGA-QA-001 lineage",
      },
      {
        path: "packages/canonical/src/index.test.ts",
        criterion: "QGA-QA-001 currency",
      },
      {
        path: "packages/publication-core/src/model-variant-name-projection.test.ts",
        criterion: "QGA-QA-001 neutral sorting",
      },
      {
        path: "packages/canonical/src/index.test.ts",
        criterion: "QGA-QA-001 staleness",
      },
      {
        path: "packages/canonical/src/migrations.test.ts",
        criterion: "QGA-QA-001 aliases",
      },
      {
        path: "packages/contracts/src/index.test.ts",
        criterion: "QGA-QA-001 evidence",
      },
    ],
  },
  {
    source_id: "QA-012",
    primary_verification_id: "QGA-QA-012",
    trace_status: "Implemented",
    artifacts: [
      {
        path: "packages/adapters/fireworks/src/index.test.ts",
        criterion: "QGA-QA-012 base precision non-broadening",
      },
    ],
  },
] as const satisfies readonly ImplementedEvidenceAuthority[];

const primaryIdPattern =
  /^((?:MET|CT|UT|E2E|SAT|ACT|PIT|DIT|POT|PRT|AAT|SST|PVT|ANT|LCT|RCT|ORT|QGA|RGA)-[A-Z0-9-]+)$/u;
const sourceIdPattern = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/u;
const expectedRegistryKeys = [
  "entries",
  "schema_version",
  "traceability_path",
] as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: JsonObject, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function isTraceStatus(value: unknown): value is TraceStatus {
  return (
    typeof value === "string" &&
    (TRACE_STATUSES as readonly string[]).includes(value)
  );
}

function validRepositoryPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    posix.normalize(path) === path &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function containsExactPrimaryId(contents: string, primaryId: string): boolean {
  const escaped = primaryId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![A-Z0-9-])${escaped}(?![A-Z0-9-])`, "u").test(
    contents,
  );
}

function containsExactCriterion(contents: string, criterion: string): boolean {
  const escaped = criterion.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`, "u").test(
    contents,
  );
}

export function parseTraceabilityRows(contents: string): TraceParseResult {
  const rows: TraceRow[] = [];
  const errors: string[] = [];
  let inMatrix = false;
  let sawMatrix = false;
  for (const [index, line] of contents.split(/\r?\n/u).entries()) {
    if (line === "## Traceability matrix") {
      inMatrix = true;
      sawMatrix = true;
      continue;
    }
    if (inMatrix && line.startsWith("## ")) {
      inMatrix = false;
      continue;
    }
    if (!inMatrix || !line.startsWith("|")) continue;
    if (
      line.startsWith("| Source ID |") ||
      /^\|(?:\s*:?-+:?\s*\|)+$/u.test(line)
    )
      continue;
    const lineNumber = String(index + 1);
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length !== 8) {
      errors.push(
        `traceability line ${lineNumber} must have exactly six columns`,
      );
      continue;
    }
    const sourceMatch = /^`([^`]+)`$/u.exec(cells[1] ?? "");
    const sourceId = sourceMatch?.[1];
    if (sourceId === undefined || !sourceIdPattern.test(sourceId))
      errors.push(`traceability line ${lineNumber} has an invalid source ID`);

    const status = cells[6];
    if (!isTraceStatus(status))
      errors.push(`traceability line ${lineNumber} has an invalid status`);

    const verificationCell = cells[5] ?? "";
    const primaryMatches = [
      ...verificationCell.matchAll(
        /`((?:MET|CT|UT|E2E|SAT|ACT|PIT|DIT|POT|PRT|AAT|SST|PVT|ANT|LCT|RCT|ORT|QGA|RGA)-[A-Z0-9-]+)`/gu,
      ),
    ];
    const primaryId = primaryMatches[0]?.[1];
    if (primaryId === undefined || !primaryIdPattern.test(primaryId))
      errors.push(
        `traceability line ${lineNumber} must contain a canonical primary verification ID`,
      );

    if (
      sourceId !== undefined &&
      sourceIdPattern.test(sourceId) &&
      isTraceStatus(status) &&
      primaryId !== undefined &&
      primaryIdPattern.test(primaryId)
    )
      rows.push({ sourceId, primaryVerificationId: primaryId, status });
  }
  if (!sawMatrix) errors.push("traceability matrix heading is missing");
  if (rows.length === 0)
    errors.push("traceability contains no complete matrix rows");
  return { errors, rows };
}

export function validateVerificationArtifactRegistry(
  inputs: VerificationArtifactInputs,
): string[] {
  const errors: string[] = [];
  const registry = inputs.registry;
  if (!isObject(registry))
    return ["verification artifact registry must be an object"];
  if (!exactKeys(registry, expectedRegistryKeys))
    errors.push(
      "verification artifact registry must use the exact closed v1 schema",
    );
  if (registry.schema_version !== "1.0.0")
    errors.push("verification artifact registry schema_version must be 1.0.0");
  if (registry.traceability_path !== "docs/design/traceability.md")
    errors.push(
      "verification artifact registry traceability_path must be docs/design/traceability.md",
    );
  if (
    JSON.stringify(registry.entries) !==
    JSON.stringify(IMPLEMENTED_EVIDENCE_AUTHORITY)
  )
    errors.push(
      "verification artifact registry entries must exactly match the code-owned v1 authority",
    );

  const traceByPrimary = new Map<string, TraceRow>();
  const traceSources = new Set<string>();
  for (const row of inputs.traceRows) {
    if (traceByPrimary.has(row.primaryVerificationId))
      errors.push(
        `duplicate trace primary verification ID ${row.primaryVerificationId}`,
      );
    else traceByPrimary.set(row.primaryVerificationId, row);
    if (traceSources.has(row.sourceId))
      errors.push(`duplicate trace source ID ${row.sourceId}`);
    else traceSources.add(row.sourceId);
    if (row.status !== "Planned" && row.status !== "Implemented")
      errors.push(
        `${row.primaryVerificationId} status ${row.status} requires a successor verification-artifact schema; v1 supports only Planned and Implemented`,
      );
  }

  const authorityByPrimary = new Map<string, ImplementedEvidenceAuthority>(
    IMPLEMENTED_EVIDENCE_AUTHORITY.map((entry) => [
      entry.primary_verification_id,
      entry,
    ]),
  );
  for (const entry of IMPLEMENTED_EVIDENCE_AUTHORITY) {
    const trace = traceByPrimary.get(entry.primary_verification_id);
    if (!trace)
      errors.push(
        `code-owned v1 authority has no trace row for ${entry.primary_verification_id}`,
      );
    else {
      if (trace.sourceId !== entry.source_id)
        errors.push(
          `${entry.primary_verification_id} authority source ${entry.source_id} does not match trace source ${trace.sourceId}`,
        );
      if (trace.status !== "Implemented")
        errors.push(
          `${entry.primary_verification_id} code-owned v1 authority requires trace status Implemented, found ${trace.status}`,
        );
    }
    for (const artifact of entry.artifacts) {
      if (!validRepositoryPath(artifact.path))
        errors.push(
          `${entry.primary_verification_id} authority path is not repository-relative: ${artifact.path}`,
        );
      else if (!inputs.repositoryFiles.has(artifact.path))
        errors.push(
          `${entry.primary_verification_id} authority path is missing: ${artifact.path}`,
        );
      else {
        const contents = inputs.artifactContents.get(artifact.path);
        if (contents === undefined)
          errors.push(
            `${entry.primary_verification_id} authority path is not a readable regular file: ${artifact.path}`,
          );
        else {
          if (!containsExactPrimaryId(contents, entry.primary_verification_id))
            errors.push(
              `${entry.primary_verification_id} authority path lacks an exact primary-ID anchor: ${artifact.path}`,
            );
          if (!containsExactCriterion(contents, artifact.criterion))
            errors.push(
              `${entry.primary_verification_id} authority path lacks criterion ${artifact.criterion}: ${artifact.path}`,
            );
        }
      }
    }
  }
  for (const row of inputs.traceRows)
    if (
      row.status === "Implemented" &&
      !authorityByPrimary.has(row.primaryVerificationId)
    )
      errors.push(
        `${row.primaryVerificationId} is Implemented but absent from the code-owned v1 authority`,
      );
  return errors;
}
