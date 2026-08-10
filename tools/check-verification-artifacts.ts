import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  IMPLEMENTED_EVIDENCE_AUTHORITY,
  parseTraceabilityRows,
  validateVerificationArtifactRegistry,
} from "./verification-artifact-policy.js";

const execFileAsync = promisify(execFile);
const traceability = await readFile("docs/design/traceability.md", "utf8");
const registry = JSON.parse(
  await readFile("config/verification-artifacts.json", "utf8"),
) as unknown;
const parsed = parseTraceabilityRows(traceability);
const { stdout } = await execFileAsync("git", [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
]);
const repositoryFiles = new Set(
  stdout.split("\0").filter((path) => path.length > 0),
);
const artifactContents = new Map<string, string>();
for (const entry of IMPLEMENTED_EVIDENCE_AUTHORITY) {
  for (const artifact of entry.artifacts) {
    if (
      !repositoryFiles.has(artifact.path) ||
      artifactContents.has(artifact.path)
    )
      continue;
    const metadata = await lstat(artifact.path);
    if (metadata.isFile())
      artifactContents.set(
        artifact.path,
        await readFile(artifact.path, "utf8"),
      );
  }
}
const errors = [
  ...parsed.errors,
  ...validateVerificationArtifactRegistry({
    artifactContents,
    registry,
    repositoryFiles,
    traceRows: parsed.rows,
  }),
];
if (errors.length > 0)
  throw new Error(
    `Verification artifact registry checks failed:\n${errors.join("\n")}`,
  );
