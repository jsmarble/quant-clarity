import { readFile } from "node:fs/promises";

interface LockPackage {
  dev?: unknown;
  license?: unknown;
  link?: unknown;
  optional?: unknown;
}

interface PackageLock {
  packages?: Record<string, LockPackage>;
}

const lock = JSON.parse(
  await readFile("package-lock.json", "utf8"),
) as PackageLock;
if (lock.packages === undefined)
  throw new Error("package-lock.json does not contain a packages inventory.");

const missing: string[] = [];
const prohibited: string[] = [];
const permissiveOrProjectLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT OR Apache-2.0",
  "MPL-2.0",
]);
const reviewedBuildOnlyLicenses = new Set([
  "Apache-2.0 AND LGPL-3.0-or-later",
  "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
  "LGPL-3.0-or-later",
]);
for (const [path, entry] of Object.entries(lock.packages)) {
  if (path === "" || entry.link === true) continue;
  if (typeof entry.license !== "string" || entry.license.trim() === "") {
    missing.push(path);
    continue;
  }
  if (/\b(?:UNLICENSED|UNKNOWN)\b|SEE LICENSE IN/iu.test(entry.license))
    prohibited.push(`${path}: ${entry.license}`);
  else if (permissiveOrProjectLicenses.has(entry.license)) continue;
  else if (
    reviewedBuildOnlyLicenses.has(entry.license) &&
    (entry.dev === true || entry.optional === true)
  )
    continue;
  else prohibited.push(`${path}: ${entry.license} requires explicit review`);
}

if (missing.length > 0 || prohibited.length > 0)
  throw new Error(
    [
      missing.length > 0
        ? `Dependencies without declared license metadata:\n${missing.join("\n")}`
        : "",
      prohibited.length > 0
        ? `Dependencies requiring manual license resolution:\n${prohibited.join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
