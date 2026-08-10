import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  GDPR_ACCOUNTABILITY_ARTIFACT_MAX_BYTES,
  GDPR_ACCOUNTABILITY_ARTIFACTS_MAX_BYTES,
  GDPR_ACCOUNTABILITY_MANIFEST_PATH,
  GDPR_ACCOUNTABILITY_MAX_BYTES,
  GDPR_ACCOUNTABILITY_PUBLIC_ARTIFACT_PATHS,
  parseGdprAccountabilityManifest,
  validateGdprAccountabilityPolicy,
} from "./gdpr-accountability-policy.js";
import {
  readBoundedRegularFile,
  readBoundedRegularFiles,
} from "./gdpr-accountability-loader.js";
import { parseTraceabilityRows } from "./verification-artifact-policy.js";

const execFileAsync = promisify(execFile);
const { stdout } = await execFileAsync("git", ["ls-files", "-z"]);
const repositoryFiles = new Set(
  stdout.split("\0").filter((path) => path.length > 0),
);
if (!repositoryFiles.has(GDPR_ACCOUNTABILITY_MANIFEST_PATH))
  throw new Error(
    `${GDPR_ACCOUNTABILITY_MANIFEST_PATH} must be a tracked repository file`,
  );
const manifestBytes = await readBoundedRegularFile({
  maximumBytes: GDPR_ACCOUNTABILITY_MAX_BYTES,
  path: GDPR_ACCOUNTABILITY_MANIFEST_PATH,
});
const parsed = parseGdprAccountabilityManifest(manifestBytes);
const traceability = parseTraceabilityRows(
  await readFile("docs/design/traceability.md", "utf8"),
);
const artifactBytes = await readBoundedRegularFiles(
  GDPR_ACCOUNTABILITY_PUBLIC_ARTIFACT_PATHS.map((path) => ({
    maximumBytes: GDPR_ACCOUNTABILITY_ARTIFACT_MAX_BYTES,
    path,
  })),
  GDPR_ACCOUNTABILITY_ARTIFACTS_MAX_BYTES,
);
const errors = [...parsed.errors, ...traceability.errors];
if (parsed.errors.length === 0)
  errors.push(
    ...validateGdprAccountabilityPolicy({
      artifactBytes,
      manifest: parsed.manifest,
      repositoryFiles,
      traceRows: traceability.rows,
    }),
  );

const predeployment = JSON.parse(
  await readFile("config/predeployment-policy.json", "utf8"),
) as { deployment_authorized?: unknown };
if (predeployment.deployment_authorized !== false)
  errors.push("predeployment policy must keep deployment unauthorized");
const previewPlan = JSON.parse(
  await readFile("config/cloudflare-preview-plan.json", "utf8"),
) as {
  authority?: { deployment_authorized?: unknown };
  pending_gates?: unknown;
};
if (previewPlan.authority?.deployment_authorized !== false)
  errors.push("preview plan must keep deployment unauthorized");
if (
  !Array.isArray(previewPlan.pending_gates) ||
  !previewPlan.pending_gates.includes("legal_privacy_review")
)
  errors.push("preview plan must retain the legal_privacy_review blocker");

if (errors.length > 0)
  throw new Error(
    `GDPR accountability readiness checks failed:\n${errors
      .slice(0, 64)
      .join("\n")}`,
  );
