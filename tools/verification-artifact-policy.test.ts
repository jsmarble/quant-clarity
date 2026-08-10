import { describe, expect, it } from "vitest";

import {
  IMPLEMENTED_EVIDENCE_AUTHORITY,
  parseTraceabilityRows,
  type TraceRow,
  validateVerificationArtifactRegistry,
  type VerificationArtifactInputs,
} from "./verification-artifact-policy.js";

function safeInputs(): VerificationArtifactInputs {
  const contents = new Map<string, string>();
  for (const entry of IMPLEMENTED_EVIDENCE_AUTHORITY)
    for (const artifact of entry.artifacts)
      contents.set(
        artifact.path,
        `${contents.get(artifact.path) ?? ""}\n${artifact.criterion}`,
      );
  return {
    artifactContents: contents,
    registry: {
      schema_version: "1.0.0",
      traceability_path: "docs/design/traceability.md",
      entries: structuredClone(IMPLEMENTED_EVIDENCE_AUTHORITY),
    },
    repositoryFiles: new Set(contents.keys()),
    traceRows: [
      ...IMPLEMENTED_EVIDENCE_AUTHORITY.map((entry) => ({
        sourceId: entry.source_id,
        primaryVerificationId: entry.primary_verification_id,
        status: "Implemented" as const,
      })),
      {
        sourceId: "DATA-002",
        primaryVerificationId: "CT-DATA-002",
        status: "Planned" as const,
      },
    ],
  };
}

function clone(inputs: VerificationArtifactInputs): VerificationArtifactInputs {
  return {
    artifactContents: new Map(inputs.artifactContents),
    registry: structuredClone(inputs.registry),
    repositoryFiles: new Set(inputs.repositoryFiles),
    traceRows: structuredClone(inputs.traceRows),
  };
}

function registryEntries(
  inputs: VerificationArtifactInputs,
): Record<string, unknown>[] {
  return (inputs.registry as { entries: Record<string, unknown>[] }).entries;
}

describe("verification artifact registry v1", () => {
  it("accepts only the code-owned Implemented mappings and needs no Planned entry", () => {
    expect(validateVerificationArtifactRegistry(safeInputs())).toEqual([]);
  });

  it("parses and completely reconciles the authoritative matrix row shape", () => {
    const parsed = parseTraceabilityRows(`
## Traceability matrix

| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| \`DATA-001\` | §7.1 | Stable identity | \`D05\` | Schema/contract — \`CT-DATA-001\` | Implemented |
| \`DATA-002\` | §7.1 | Future work | \`D05\` | Schema/contract — \`CT-DATA-002\` | Planned |
`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        sourceId: "DATA-001",
        primaryVerificationId: "CT-DATA-001",
        status: "Implemented",
      },
      {
        sourceId: "DATA-002",
        primaryVerificationId: "CT-DATA-002",
        status: "Planned",
      },
    ]);
  });

  it("rejects extra-column bypasses instead of silently ignoring them", () => {
    const parsed = parseTraceabilityRows(`
## Traceability matrix
| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| \`DATA-001\` | §7.1 | Stable identity | \`D05\` | \`CT-DATA-001\` | Implemented | injected |
`);
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        "traceability line 5 must have exactly six columns",
        "traceability contains no complete matrix rows",
      ]),
    );
  });

  it("rejects invalid source, status, and primary cells", () => {
    const parsed = parseTraceabilityRows(`
## Traceability matrix
| Source ID | PRD | Requirement summary | Planned design sections | Planned primary verification | Status |
|---|---|---|---|---|---|
| not-code | §7.1 | Bad source | \`D05\` | \`CT-DATA-001\` | Implemented |
| \`DATA-002\` | §7.1 | Bad status | \`D05\` | \`CT-DATA-002\` | Complete |
| \`DATA-003\` | §7.1 | Bad primary | \`D05\` | not-an-id | Planned |
`);
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        "traceability line 5 has an invalid source ID",
        "traceability line 6 has an invalid status",
        "traceability line 7 must contain a canonical primary verification ID",
      ]),
    );
  });

  it("rejects schema drift and any self-declared authority field", () => {
    const inputs = clone(safeInputs());
    const registry = inputs.registry as Record<string, unknown>;
    registry.schema_version = "2.0.0";
    registry.self_declared_authority = true;
    expect(validateVerificationArtifactRegistry(inputs)).toEqual(
      expect.arrayContaining([
        "verification artifact registry must use the exact closed v1 schema",
        "verification artifact registry schema_version must be 1.0.0",
      ]),
    );
  });

  it("rejects registry relabeling, promotion, alternate paths, and duplicate entries", () => {
    for (const mutate of [
      (entry: Record<string, unknown>) => {
        entry.source_id = "DATA-999";
      },
      (entry: Record<string, unknown>) => {
        entry.trace_status = "Verified";
      },
      (entry: Record<string, unknown>) => {
        const artifacts = entry.artifacts as Record<string, unknown>[];
        artifacts[0]!.path = "packages/contracts/src/index.test.ts";
      },
    ]) {
      const inputs = clone(safeInputs());
      mutate(registryEntries(inputs)[0]!);
      expect(validateVerificationArtifactRegistry(inputs)).toContain(
        "verification artifact registry entries must exactly match the code-owned v1 authority",
      );
    }
    const duplicate = clone(safeInputs());
    registryEntries(duplicate).push(
      structuredClone(registryEntries(duplicate)[0]!),
    );
    expect(validateVerificationArtifactRegistry(duplicate)).toContain(
      "verification artifact registry entries must exactly match the code-owned v1 authority",
    );
  });

  it.each(["Designed", "Verified", "Accepted", "Released"] as const)(
    "rejects %s promotion until a successor schema exists",
    (status) => {
      const inputs = clone(safeInputs());
      (inputs.traceRows as TraceRow[])[0]!.status = status;
      expect(validateVerificationArtifactRegistry(inputs)).toEqual(
        expect.arrayContaining([
          `CT-DATA-001 status ${status} requires a successor verification-artifact schema; v1 supports only Planned and Implemented`,
          `CT-DATA-001 code-owned v1 authority requires trace status Implemented, found ${status}`,
        ]),
      );
    },
  );

  it("rejects an Implemented trace row absent from code-owned authority", () => {
    const inputs = clone(safeInputs());
    (inputs.traceRows as TraceRow[]).push({
      sourceId: "DATA-999",
      primaryVerificationId: "CT-DATA-999",
      status: "Implemented",
    });
    expect(validateVerificationArtifactRegistry(inputs)).toContain(
      "CT-DATA-999 is Implemented but absent from the code-owned v1 authority",
    );
  });

  it("rejects duplicate primary and source IDs in traceability", () => {
    const inputs = clone(safeInputs());
    (inputs.traceRows as TraceRow[]).push({
      sourceId: "DATA-001",
      primaryVerificationId: "CT-DATA-001",
      status: "Implemented",
    });
    expect(validateVerificationArtifactRegistry(inputs)).toEqual(
      expect.arrayContaining([
        "duplicate trace primary verification ID CT-DATA-001",
        "duplicate trace source ID DATA-001",
      ]),
    );
  });

  it("rejects a missing code-owned criterion and a missing authority path", () => {
    const missingCriterion = clone(safeInputs());
    const first = IMPLEMENTED_EVIDENCE_AUTHORITY[0];
    const criterionContents = new Map(missingCriterion.artifactContents);
    criterionContents.set(
      first.artifacts[0].path,
      "CT-DATA-001 unrelated suite",
    );
    missingCriterion.artifactContents = criterionContents;
    expect(validateVerificationArtifactRegistry(missingCriterion)).toContain(
      `CT-DATA-001 authority path lacks criterion ${first.artifacts[0].criterion}: ${first.artifacts[0].path}`,
    );

    const missingPath = clone(safeInputs());
    const repositoryFiles = new Set(missingPath.repositoryFiles);
    repositoryFiles.delete(first.artifacts[0].path);
    missingPath.repositoryFiles = repositoryFiles;
    expect(validateVerificationArtifactRegistry(missingPath)).toContain(
      `CT-DATA-001 authority path is missing: ${first.artifacts[0].path}`,
    );
  });

  it("rejects a longer identifier that only contains a primary ID as a prefix", () => {
    const inputs = clone(safeInputs());
    const first = IMPLEMENTED_EVIDENCE_AUTHORITY[0];
    const artifactContents = new Map(inputs.artifactContents);
    artifactContents.set(
      first.artifacts[0].path,
      "CT-DATA-0010 stable identity",
    );
    inputs.artifactContents = artifactContents;
    expect(validateVerificationArtifactRegistry(inputs)).toContain(
      `CT-DATA-001 authority path lacks an exact primary-ID anchor: ${first.artifacts[0].path}`,
    );
  });

  it("rejects a criterion that exists only as a longer suffixed token", () => {
    const inputs = clone(safeInputs());
    const first = IMPLEMENTED_EVIDENCE_AUTHORITY[0];
    const artifactContents = new Map(inputs.artifactContents);
    artifactContents.set(
      first.artifacts[0].path,
      `${first.artifacts[0].criterion}0`,
    );
    inputs.artifactContents = artifactContents;
    expect(validateVerificationArtifactRegistry(inputs)).toContain(
      `CT-DATA-001 authority path lacks criterion ${first.artifacts[0].criterion}: ${first.artifacts[0].path}`,
    );
  });
});
