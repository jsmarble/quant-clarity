import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  GDPR_ACCOUNTABILITY_MAX_BYTES,
  GDPR_ACCOUNTABILITY_PUBLIC_ARTIFACT_PATHS,
  type GdprAccountabilityInputs,
  parseGdprAccountabilityManifest,
  validateGdprAccountabilityPolicy,
} from "./gdpr-accountability-policy.js";
import { parseTraceabilityRows } from "./verification-artifact-policy.js";

const manifestBytes = await readFile("config/gdpr-accountability.json");
const parsedManifest = parseGdprAccountabilityManifest(manifestBytes);
if (parsedManifest.errors.length > 0)
  throw new Error(parsedManifest.errors.join("\n"));
const traceability = parseTraceabilityRows(
  await readFile("docs/design/traceability.md", "utf8"),
);
if (traceability.errors.length > 0)
  throw new Error(traceability.errors.join("\n"));
const artifactPaths = GDPR_ACCOUNTABILITY_PUBLIC_ARTIFACT_PATHS;
const artifactBytes = new Map<string, Uint8Array>();
for (const path of artifactPaths) artifactBytes.set(path, await readFile(path));

const cloneManifest = (): Record<string, unknown> =>
  structuredClone(parsedManifest.manifest) as Record<string, unknown>;

const safeInputs = (
  manifest: unknown = cloneManifest(),
): GdprAccountabilityInputs => ({
  artifactBytes: new Map(artifactBytes),
  manifest,
  repositoryFiles: new Set(artifactPaths),
  traceRows: structuredClone(traceability.rows),
});

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

describe("pending-only GDPR accountability policy", () => {
  it("accepts the exact release-blocked inventory", () => {
    expect(validateGdprAccountabilityPolicy(safeInputs())).toEqual([]);
  });

  it("rejects engineering-authored gate, release, and compliance claims", () => {
    for (const [key, value, message] of [
      ["status", "approved", "v1 status must remain release_blocked"],
      [
        "gate_passed",
        true,
        "v1 cannot claim the GDPR accountability gate passed",
      ],
      ["release_authorized", true, "v1 cannot authorize public release"],
      [
        "compliance_claim_allowed",
        true,
        "engineering must not claim GDPR compliance",
      ],
    ] as const) {
      const manifest = cloneManifest();
      manifest[key] = value;
      expect(validateGdprAccountabilityPolicy(safeInputs(manifest))).toContain(
        message,
      );
    }
  });

  it("rejects approved, not-required, or self-signed evidence in v1", () => {
    const manifest = cloneManifest();
    const categories = manifest.evidence_categories as Record<
      string,
      unknown
    >[];
    categories[1]!.status = "approved";
    categories[1]!.private_approval_reference = "private:assertion";
    categories[1]!.approved_on = "2026-08-10";
    expect(validateGdprAccountabilityPolicy(safeInputs(manifest))).toEqual(
      expect.arrayContaining([
        "evidence_categories[1] must remain pending in v1",
        "evidence_categories[1] cannot contain approval metadata in v1",
      ]),
    );
    categories[1]!.status = "not_required";
    expect(validateGdprAccountabilityPolicy(safeInputs(manifest))).toContain(
      "evidence_categories[1] must remain pending in v1",
    );
  });

  it("rejects missing, extra, reordered, and remapped authority", () => {
    const extra = cloneManifest();
    extra.exception = true;
    expect(validateGdprAccountabilityPolicy(safeInputs(extra))).toEqual([
      "manifest must use the exact closed schema",
    ]);

    const reordered = cloneManifest();
    const categories = reordered.evidence_categories as unknown[];
    [categories[0], categories[1]] = [categories[1], categories[0]];
    expect(
      validateGdprAccountabilityPolicy(safeInputs(reordered)).some((error) =>
        error.includes("invalid id"),
      ),
    ).toBe(true);

    const remapped = cloneManifest();
    const rows = remapped.evidence_categories as Record<string, unknown>[];
    rows[0]!.requirement_ids = ["PRIV-005"];
    expect(validateGdprAccountabilityPolicy(safeInputs(remapped))).toContain(
      "evidence_categories[0] has an invalid requirement mapping",
    );
  });

  it("rejects accessor, proxy, symbol, and prototype-backed manifests without reading getters", () => {
    let reads = 0;
    const accessor = cloneManifest();
    Object.defineProperty(accessor, "status", {
      enumerable: true,
      get: () => {
        reads += 1;
        return "release_blocked";
      },
    });
    expect(validateGdprAccountabilityPolicy(safeInputs(accessor))).toEqual([
      "manifest must use the exact closed schema",
    ]);
    expect(reads).toBe(0);

    const symbol = cloneManifest();
    Object.defineProperty(symbol, Symbol("hidden"), { value: true });
    expect(validateGdprAccountabilityPolicy(safeInputs(symbol))).toEqual([
      "manifest must use the exact closed schema",
    ]);
    expect(
      validateGdprAccountabilityPolicy(
        safeInputs(
          new Proxy(cloneManifest(), {
            ownKeys: () => {
              throw new Error("hostile");
            },
          }),
        ),
      ),
    ).toEqual(["manifest must use the exact closed schema"]);
    expect(
      validateGdprAccountabilityPolicy(
        safeInputs(
          Object.assign(Object.create({ inherited: true }), cloneManifest()),
        ),
      ),
    ).toEqual(["manifest must use the exact closed schema"]);
  });

  it("binds exact tracked regular-artifact paths and reviewed bytes", () => {
    const missing = safeInputs();
    const missingBytes = new Map(missing.artifactBytes);
    missingBytes.delete(artifactPaths[0]);
    expect(
      validateGdprAccountabilityPolicy({
        ...missing,
        artifactBytes: missingBytes,
      }),
    ).toContain(`${artifactPaths[0]} is missing`);

    const untracked = safeInputs();
    expect(
      validateGdprAccountabilityPolicy({
        ...untracked,
        repositoryFiles: new Set(artifactPaths.slice(1)),
      }),
    ).toContain(`${artifactPaths[0]} is not a tracked repository file`);

    const manifest = cloneManifest();
    const artifacts = manifest.public_artifacts as Record<string, unknown>[];
    artifacts[0]!.path = "../privacy.astro";
    expect(validateGdprAccountabilityPolicy(safeInputs(manifest))).toContain(
      "public_artifacts[0] is invalid",
    );
  });

  it("rejects digest drift, oversized artifacts, and removed blocker markers", () => {
    const drift = safeInputs();
    const driftBytes = new Map(drift.artifactBytes);
    driftBytes.set(artifactPaths[0], new TextEncoder().encode("changed"));
    expect(
      validateGdprAccountabilityPolicy({ ...drift, artifactBytes: driftBytes }),
    ).toContain(`${artifactPaths[0]} does not match its reviewed digest`);

    const oversized = safeInputs();
    const oversizedBytes = new Map(oversized.artifactBytes);
    oversizedBytes.set(artifactPaths[0], new Uint8Array(262_145));
    expect(
      validateGdprAccountabilityPolicy({
        ...oversized,
        artifactBytes: oversizedBytes,
      }),
    ).toContain(`${artifactPaths[0]} exceeds the 256 KiB artifact limit`);

    const noMarker = safeInputs();
    const noMarkerBytes = new Map(noMarker.artifactBytes);
    const replacement = new TextEncoder().encode("working privacy page");
    noMarkerBytes.set(artifactPaths[0], replacement);
    const manifest = noMarker.manifest as Record<string, unknown>;
    const artifacts = manifest.public_artifacts as Record<string, unknown>[];
    artifacts[0]!.sha256 = sha256(replacement);
    expect(
      validateGdprAccountabilityPolicy({
        ...noMarker,
        artifactBytes: noMarkerBytes,
      }),
    ).toContain(
      `${artifactPaths[0]} no longer declares its pending-state marker`,
    );
  });

  it("rejects a marker-preserving public compliance claim", () => {
    const inputs = safeInputs();
    const bytes = new TextEncoder().encode(
      `${new TextDecoder().decode(inputs.artifactBytes.get(artifactPaths[0]))}\n<p>QuantClarity is GDPR compliant.</p>`,
    );
    const artifactBytes = new Map(inputs.artifactBytes);
    artifactBytes.set(artifactPaths[0], bytes);
    const manifest = inputs.manifest as Record<string, unknown>;
    const artifacts = manifest.public_artifacts as Record<string, unknown>[];
    artifacts[0]!.sha256 = sha256(bytes);
    expect(
      validateGdprAccountabilityPolicy({
        ...inputs,
        artifactBytes,
      }),
    ).toContain(
      `${artifactPaths[0]} contains a prohibited pending-state claim`,
    );
  });

  it("requires every pending-only scope row to remain Planned", () => {
    const implemented = safeInputs();
    implemented.traceRows = implemented.traceRows.map((row) =>
      row.sourceId === "PRIV-008"
        ? { ...row, status: "Implemented" as const }
        : row,
    );
    expect(validateGdprAccountabilityPolicy(implemented)).toContain(
      "PRIV-008 must remain Planned in pending-only v1",
    );
    const missing = safeInputs();
    missing.traceRows = missing.traceRows.filter(
      (row) => row.sourceId !== "LEG-005",
    );
    expect(validateGdprAccountabilityPolicy(missing)).toContain(
      "LEG-005 is missing from traceability",
    );
  });
});

describe("strict bounded GDPR manifest parser", () => {
  it("accepts the exact 65,536-byte boundary and rejects 65,537 bytes", () => {
    const source = new TextEncoder().encode('{"value":true}');
    const atLimit = new Uint8Array(GDPR_ACCOUNTABILITY_MAX_BYTES);
    atLimit.set(source);
    atLimit.fill(0x20, source.byteLength);
    expect(parseGdprAccountabilityManifest(atLimit).errors).toEqual([]);
    expect(
      parseGdprAccountabilityManifest(
        new Uint8Array(GDPR_ACCOUNTABILITY_MAX_BYTES + 1),
      ).errors,
    ).toEqual(["manifest exceeds the 65,536-byte input limit"]);
  });

  it("rejects invalid UTF-8, comments, trailing commas, and duplicate keys", () => {
    expect(
      parseGdprAccountabilityManifest(Uint8Array.from([0xff])).errors,
    ).toEqual(["manifest is not valid UTF-8"]);
    for (const source of [
      '{"a":1,// comment\n"b":2}',
      '{"a":1,}',
      '{"a":1,"a":2}',
    ])
      expect(
        parseGdprAccountabilityManifest(new TextEncoder().encode(source)).errors
          .length,
      ).toBeGreaterThan(0);
  });
});
