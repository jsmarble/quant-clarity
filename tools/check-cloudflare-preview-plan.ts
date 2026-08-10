import { readFile } from "node:fs/promises";

import {
  parseCloudflarePreviewPlanDocument,
  validateCloudflarePreviewPlan,
} from "./cloudflare-preview-plan-policy.js";

const document = parseCloudflarePreviewPlanDocument(
  await readFile("config/cloudflare-preview-plan.json", "utf8"),
);
const errors = [
  ...document.errors,
  ...(document.errors.length === 0
    ? validateCloudflarePreviewPlan(document.plan)
    : []),
];

if (errors.length > 0)
  throw new Error(
    `Cloudflare preview plan checks failed:\n${errors.join("\n")}`,
  );
