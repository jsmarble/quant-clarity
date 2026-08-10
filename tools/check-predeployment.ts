import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { parse } from "jsonc-parser";

import {
  classifyPredeploymentPaths,
  validatePredeploymentPolicy,
} from "./predeployment-policy.js";

const execFileAsync = promisify(execFile);

function parseJson(contents: string): unknown {
  return JSON.parse(contents) as unknown;
}

const policy = parseJson(
  await readFile("config/predeployment-policy.json", "utf8"),
);
const environments = parseJson(
  await readFile("config/environments.json", "utf8"),
);
const npmConfiguration = await readFile(".npmrc", "utf8");
const npmLockfile = await readFile("package-lock.json", "utf8");

if (typeof policy !== "object" || policy === null || Array.isArray(policy))
  throw new Error("Predeployment policy must be an object.");
async function readJsonFiles(
  paths: readonly string[],
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const path of paths)
    results[path] = parseJson(await readFile(path, "utf8"));
  return results;
}

const { stdout: repositoryFileOutput } = await execFileAsync("git", [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
]);
const repositoryFiles = repositoryFileOutput
  .split("\0")
  .filter((path) => path.length > 0);
const { packagePaths, workflowPaths, wranglerPaths } =
  classifyPredeploymentPaths(repositoryFiles);
const wranglerConfigs: Record<string, unknown> = {};
for (const path of wranglerPaths)
  wranglerConfigs[path] = parse(await readFile(path, "utf8")) as unknown;

const workflowFiles: Record<string, string> = {};
for (const path of workflowPaths)
  workflowFiles[path] = await readFile(path, "utf8");

const errors = validatePredeploymentPolicy({
  policy,
  environments,
  npmConfiguration,
  npmLockfile,
  packageManifests: await readJsonFiles(packagePaths),
  wranglerConfigs,
  workflowFiles,
});
if (errors.length > 0)
  throw new Error(`Predeployment embargo checks failed:\n${errors.join("\n")}`);
