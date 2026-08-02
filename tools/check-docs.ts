import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

const root = process.cwd();
const requirementsPath = resolve(root, "docs/product/requirements.md");
const traceabilityPath = resolve(root, "docs/design/traceability.md");
const verificationPath = resolve(root, "docs/design/verification-plan.md");

function firstCellIds(contents: string, quoted: boolean): string[] {
  const wrapper = quoted ? "`?" : "";
  const pattern = new RegExp(
    `^\\| ${wrapper}([A-Z][A-Z0-9-]*[0-9A-Z])${wrapper} \\|`,
    "gmu",
  );
  return [...contents.matchAll(pattern)].map((match) => match[1] ?? "");
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated].sort();
}

const requirements = await readFile(requirementsPath, "utf8");
const traceability = await readFile(traceabilityPath, "utf8");
const verification = await readFile(verificationPath, "utf8");
const prdIds = firstCellIds(requirements, false).filter((id) => id !== "ID");
const goalIds = [...requirements.matchAll(/^- \*\*(G-[0-9]{2})\b/gmu)].map(
  (match) => match[1] ?? "",
);
const traceRows = traceability.split("\n").filter((line) => {
  const cells = line.split("|");
  return cells.length >= 8 && /^\| `[A-Z][A-Z0-9-]*[0-9A-Z]` \|/u.test(line);
});
const traceIds = traceRows.map(
  (line) => /^\| `([^`]+)`/u.exec(line)?.[1] ?? "",
);
const successIds = prdIds.filter((id) => id.startsWith("SM-"));
const normativeIds = prdIds.filter((id) => !id.startsWith("SM-"));
const expectedReleaseIds = Array.from(
  { length: 24 },
  (_, index) => `REL-AC-${String(index + 1).padStart(2, "0")}`,
);
const releaseIds = traceIds.filter((id) => id.startsWith("REL-AC-"));
const expectedTraceIds = new Set([...prdIds, ...expectedReleaseIds]);
const representedTraceIds = traceIds.filter((id) => expectedTraceIds.has(id));
const primaryVerificationIds = traceRows.map(
  (line) => /— `([^`]+)`/u.exec(line.split("|")[5] ?? "")?.[1] ?? "",
);

const errors: string[] = [];
const allowedTraceStatuses = new Set([
  "Planned",
  "Designed",
  "Implemented",
  "Verified",
  "Accepted",
  "Released",
]);
for (const line of traceRows) {
  const status = (line.split("|")[6] ?? "").trim();
  if (!allowedTraceStatuses.has(status))
    errors.push(`Invalid traceability status: ${status || "(missing)"}`);
}
if (duplicates(prdIds).length > 0)
  errors.push(`Duplicate PRD IDs: ${duplicates(prdIds).join(", ")}`);
if (duplicates(goalIds).length > 0)
  errors.push(`Duplicate goal IDs: ${duplicates(goalIds).join(", ")}`);
if (duplicates(representedTraceIds).length > 0)
  errors.push(
    `Duplicate traceability IDs: ${duplicates(representedTraceIds).join(", ")}`,
  );
for (const id of prdIds) {
  if (!representedTraceIds.includes(id))
    errors.push(`Missing traceability row: ${id}`);
}
for (const id of traceIds) {
  if (!expectedTraceIds.has(id)) errors.push(`Orphan traceability row: ${id}`);
}
if (duplicates(primaryVerificationIds).length > 0)
  errors.push(
    `Duplicate primary verification IDs: ${duplicates(primaryVerificationIds).join(", ")}`,
  );
if (primaryVerificationIds.some((id) => id === ""))
  errors.push("A traceability row is missing its primary verification ID");
for (const line of traceRows) {
  const designCell = line.split("|")[4] ?? "";
  for (const reference of designCell.matchAll(/`(D[0-9]{2})`/gu)) {
    const section = Number((reference[1] ?? "D00").slice(1));
    if (section < 2 || section > 19)
      errors.push(`Invalid design reference: ${reference[1] ?? ""}`);
  }
}
const coordinatorIds = [
  ...verification.matchAll(/^\| `(RGA-REL-AC-[0-9]{2})` \|/gmu),
].map((match) => match[1] ?? "");
const expectedCoordinatorIds = expectedReleaseIds.map((id) => `RGA-${id}`);
if (
  coordinatorIds.length !== 24 ||
  duplicates(coordinatorIds).length > 0 ||
  coordinatorIds.some((id) => !expectedCoordinatorIds.includes(id)) ||
  expectedCoordinatorIds.some((id) => !coordinatorIds.includes(id))
)
  errors.push(
    `Expected 24 unique release coordinator mappings, found ${String(new Set(coordinatorIds).size)}`,
  );
if (goalIds.length !== 11)
  errors.push(`Expected 11 goal IDs, found ${String(goalIds.length)}`);
if (normativeIds.length !== 317)
  errors.push(
    `Expected 317 normative PRD IDs, found ${String(normativeIds.length)}`,
  );
if (successIds.length !== 13)
  errors.push(
    `Expected 13 success measures, found ${String(successIds.length)}`,
  );
if (releaseIds.length !== 24)
  errors.push(
    `Expected 24 release anchors, found ${String(releaseIds.length)}`,
  );

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries
      .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules")
      .map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
          ? markdownFiles(path)
          : Promise.resolve(extname(path) === ".md" ? [path] : []);
      }),
  );
  return groups.flat();
}

for (const path of await markdownFiles(root)) {
  const contents = await readFile(path, "utf8");
  for (const match of contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const rawTarget = match[1] ?? "";
    if (
      rawTarget === "" ||
      rawTarget.startsWith("#") ||
      /^[a-z][a-z+.-]*:/iu.test(rawTarget)
    )
      continue;
    const withoutAnchor = rawTarget.split("#", 1)[0] ?? "";
    const target = resolve(
      dirname(path),
      decodeURIComponent(withoutAnchor.replace(/^<|>$/gu, "")),
    );
    const exists = await stat(target).then(
      () => true,
      () => false,
    );
    if (!exists)
      errors.push(
        `Broken local link in ${path.slice(root.length + 1)}: ${rawTarget}`,
      );
  }
}

if (errors.length > 0)
  throw new Error(`Documentation checks failed:\n${errors.join("\n")}`);
