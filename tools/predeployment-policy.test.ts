import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  classifyPredeploymentPaths,
  type PredeploymentInputs,
  validatePredeploymentPolicy,
} from "./predeployment-policy.js";

function observability(): Record<string, unknown> {
  return {
    enabled: false,
    logs: {
      enabled: false,
      invocation_logs: false,
      persist: false,
      destinations: [],
    },
    traces: { enabled: false, persist: false, destinations: [] },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonSha256(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function safeInputs(): PredeploymentInputs {
  const configs = {
    "apps/api/wrangler.jsonc": {
      name: "quant-clarity-api-local",
      workers_dev: false,
      preview_urls: false,
      observability: observability(),
    },
  };
  const scripts = {
    build:
      "WRANGLER_SEND_METRICS=false wrangler deploy --dry-run --outdir dist",
    "preview-plan:check": "tsx tools/check-cloudflare-preview-plan.ts",
  };
  const npmConfiguration = "engine-strict=true\n";
  const npmLockfile = '{"lockfileVersion":3}\n';
  const workflow = `
permissions:
  contents: read
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
    with:
      persist-credentials: false
  - run: npm ci --ignore-scripts
  - run: node --import tsx tools/check-predeployment.ts
  - run: npm rebuild --strict-allow-scripts
  - run: npm run verify
`;
  const input = {
    policy: {
      schema_version: "1.0.0",
      deployment_authorized: false,
      environment_inventory: {
        path: "config/environments.json",
        config_sha256: "",
      },
      environment_names: ["local", "test", "preview", "production"],
      npm_configuration: {
        path: ".npmrc",
        file_sha256: sha256(npmConfiguration),
      },
      npm_lockfile: {
        path: "package-lock.json",
        file_sha256: sha256(npmLockfile),
      },
      package_manifests: [
        {
          path: "package.json",
          authority_sha256: jsonSha256({ scripts, allowScripts: null }),
        },
      ],
      wrangler_configs: [
        {
          app: "api",
          path: "apps/api/wrangler.jsonc",
          worker_name: "quant-clarity-api-local",
          config_sha256: jsonSha256(configs["apps/api/wrangler.jsonc"]),
          allowed_root_keys: [
            "name",
            "observability",
            "preview_urls",
            "workers_dev",
          ],
        },
      ],
      workflow_files: [
        { path: ".github/workflows/ci.yml", file_sha256: sha256(workflow) },
      ],
      allowed_wrangler_mode: "telemetry_disabled_dry_run_only",
    },
    environments: {
      status: "logical_inventory_only",
      environments: [
        {
          name: "local",
          provisioned: false,
          may_access_production: false,
          write_identity: "local-only",
        },
        {
          name: "test",
          provisioned: false,
          may_access_production: false,
          write_identity: "test-only",
        },
        {
          name: "preview",
          provisioned: false,
          may_access_production: false,
          write_identity: "preview-pending",
        },
        {
          name: "production",
          provisioned: false,
          may_access_production: true,
          write_identity: "production-pending",
        },
      ],
    },
    packageManifests: {
      "package.json": {
        scripts,
      },
    },
    npmConfiguration,
    npmLockfile,
    wranglerConfigs: configs,
    workflowFiles: {
      ".github/workflows/ci.yml": workflow,
    },
  } satisfies PredeploymentInputs;
  const environmentPolicy = (input.policy as Record<string, unknown>)
    .environment_inventory as Record<string, unknown>;
  environmentPolicy.config_sha256 = jsonSha256(input.environments);
  return input;
}

function clone(inputs: PredeploymentInputs): PredeploymentInputs {
  return structuredClone(inputs);
}

describe("predeployment embargo", () => {
  it("discovers nested manifests, named Wrangler configs, and local actions", () => {
    expect(
      classifyPredeploymentPaths([
        "package.json",
        "packages/domain/package.json",
        "apps/api/wrangler.preview.jsonc",
        "ops/wrangler.toml",
        ".github/workflows/nested/release.yaml",
        ".github/actions/release/action.yml",
        ".github/actions/action.yml",
        "ops/release/action.yaml",
        "docs/example.yml",
      ]),
    ).toEqual({
      packagePaths: ["package.json", "packages/domain/package.json"],
      wranglerPaths: ["apps/api/wrangler.preview.jsonc", "ops/wrangler.toml"],
      workflowPaths: [
        ".github/actions/action.yml",
        ".github/actions/release/action.yml",
        ".github/workflows/nested/release.yaml",
        "ops/release/action.yaml",
      ],
    });
  });

  it("accepts the closed unprovisioned dry-run-only state", () => {
    expect(validatePredeploymentPolicy(safeInputs())).toEqual([]);
  });

  it("rejects deployment authorization and provisioned environments", () => {
    const inputs = clone(safeInputs());
    (inputs.policy as Record<string, unknown>).deployment_authorized = true;
    const environments = (inputs.environments as Record<string, unknown>)
      .environments as Record<string, unknown>[];
    environments[2]!.provisioned = true;
    environments[2]!.may_access_production = true;
    expect(validatePredeploymentPolicy(inputs)).toEqual(
      expect.arrayContaining([
        "deployment_authorized must remain false",
        "preview must remain unprovisioned",
        "preview must not access production",
      ]),
    );
  });

  it("rejects real deploys and other Wrangler mutations", () => {
    const inputs = clone(safeInputs());
    const scripts = (
      inputs.packageManifests["package.json"] as Record<string, unknown>
    ).scripts as Record<string, string>;
    scripts.deploy = "wrangler deploy && wrangler secret put TOKEN";
    scripts.preverify = "wrangler deploy";
    expect(validatePredeploymentPolicy(inputs)).toEqual(
      expect.arrayContaining([
        "package.json scripts/allowScripts do not match the approved digest",
        "package.json#deploy contains a non-allowlisted Wrangler deploy",
        "package.json#deploy contains a prohibited Wrangler mutation command",
        "package.json#preverify is a prohibited pre-gate lifecycle hook",
      ]),
    );
  });

  it("rejects an unreviewed verification-gate script even when it is non-deploying", () => {
    const inputs = clone(safeInputs());
    const scripts = (
      inputs.packageManifests["package.json"] as Record<string, unknown>
    ).scripts as Record<string, string>;
    scripts["traceability:check"] = "tsx tools/check-verification-artifacts.ts";
    expect(validatePredeploymentPolicy(inputs)).toContain(
      "package.json scripts/allowScripts do not match the approved digest",
    );
  });

  it("rejects removal or mutation of the preview proposal gate", () => {
    const inputs = clone(safeInputs());
    const scripts = (
      inputs.packageManifests["package.json"] as Record<string, unknown>
    ).scripts as Record<string, string>;
    scripts["preview-plan:check"] = "true";
    expect(validatePredeploymentPolicy(inputs)).toContain(
      "package.json scripts/allowScripts do not match the approved digest",
    );
  });

  it("rejects deletion of the preview proposal gate", () => {
    const inputs = clone(safeInputs());
    const scripts = (
      inputs.packageManifests["package.json"] as Record<string, unknown>
    ).scripts as Record<string, string>;
    delete scripts["preview-plan:check"];
    expect(validatePredeploymentPolicy(inputs)).toContain(
      "package.json scripts/allowScripts do not match the approved digest",
    );
  });

  it("rejects routes, privileged bindings, and observability", () => {
    const inputs = clone(safeInputs());
    const config = inputs.wranglerConfigs["apps/api/wrangler.jsonc"] as Record<
      string,
      unknown
    >;
    config.workers_dev = true;
    config.routes = ["example.test/*"];
    config.d1_databases = [{ binding: "DB" }];
    (config.observability as Record<string, unknown>).enabled = true;
    expect(validatePredeploymentPolicy(inputs)).toEqual(
      expect.arrayContaining([
        "apps/api/wrangler.jsonc must remain unrouted",
        "apps/api/wrangler.jsonc observability must remain fully disabled",
        "apps/api/wrangler.jsonc contains forbidden routes",
        "apps/api/wrangler.jsonc contains forbidden d1_databases",
      ]),
    );
  });

  it("rejects deployment workflows, credentials, and write permissions", () => {
    const inputs = clone(safeInputs());
    const workflowFiles = inputs.workflowFiles as Record<string, string>;
    workflowFiles[".github/workflows/ci.yml"] = `
permissions:
  id-token: write
jobs:
  deploy:
    environment: production
    steps:
      - uses: actions/checkout@v7
      - run: wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ""
`;
    expect(validatePredeploymentPolicy(inputs)).toEqual(
      expect.arrayContaining([
        ".github/workflows/ci.yml must bootstrap the embargo before lifecycle scripts and verification",
        ".github/workflows/ci.yml must not target a GitHub deployment environment",
        ".github/workflows/ci.yml contains prohibited GitHub write permissions",
        ".github/workflows/ci.yml contains a Cloudflare deployment credential reference",
        ".github/workflows/ci.yml contains a Cloudflare mutation command",
        ".github/workflows/ci.yml checkout must disable credential persistence",
        ".github/workflows/ci.yml action references must use full commit SHAs",
      ]),
    );
  });

  it("rejects inventory drift and shared write identities", () => {
    const inputs = clone(safeInputs());
    const environments = (inputs.environments as Record<string, unknown>)
      .environments as Record<string, unknown>[];
    environments[2]!.write_identity = environments[1]!.write_identity;
    const packageManifests = inputs.packageManifests as Record<string, unknown>;
    const workflowFiles = inputs.workflowFiles as Record<string, string>;
    delete packageManifests["package.json"];
    workflowFiles[".github/workflows/extra.yml"] = "permissions: {}";
    expect(validatePredeploymentPolicy(inputs)).toEqual(
      expect.arrayContaining([
        "environment write identities must be present and distinct",
        "package manifest inventory does not match repository inputs",
        "workflow inventory does not match repository inputs",
      ]),
    );
  });

  it("rejects renamed environments and additive observability fields", () => {
    const inputs = clone(safeInputs());
    const environments = (inputs.environments as Record<string, unknown>)
      .environments as Record<string, unknown>[];
    environments.splice(2, 1);
    environments[0]!.cloudflare_api_token = "must-never-be-stored";
    const manifest = inputs.packageManifests["package.json"] as Record<
      string,
      unknown
    >;
    manifest.allowScripts = { "unreviewed-package@1.0.0": true };
    inputs.npmConfiguration += "strict-allow-scripts=false\n";
    inputs.npmLockfile += "changed";
    const config = inputs.wranglerConfigs["apps/api/wrangler.jsonc"] as Record<
      string,
      unknown
    >;
    (config.observability as Record<string, unknown>).telemetry = false;
    expect(validatePredeploymentPolicy(inputs)).toEqual(
      expect.arrayContaining([
        "environment inventory does not match the approved digest",
        "package.json scripts/allowScripts do not match the approved digest",
        ".npmrc does not match the approved digest",
        "package-lock.json does not match the approved digest",
        "environment inventory rows must use the closed four-environment set in order",
        "apps/api/wrangler.jsonc contents do not match the approved digest",
        "apps/api/wrangler.jsonc observability must remain fully disabled",
      ]),
    );
  });

  it("rejects alternate deployment syntax, broad authority, and aliased secrets", () => {
    const inputs = clone(safeInputs());
    const scripts = (
      inputs.packageManifests["package.json"] as Record<string, unknown>
    ).scripts as Record<string, string>;
    scripts.release =
      "npx wrangler --config hidden.jsonc versions deploy && curl https://api.cloudflare.com/client/v4";
    const workflowFiles = inputs.workflowFiles as Record<string, string>;
    workflowFiles[".github/workflows/ci.yml"] = `
permissions: write-all
jobs:
  deploy:
    secrets: inherit
    steps:
      - run: wrangler --config hidden.jsonc deploy
        env:
          TOKEN: \${{ secrets.RELEASE_TOKEN }}
`;
    expect(validatePredeploymentPolicy(inputs)).toEqual(
      expect.arrayContaining([
        "package.json#release contains a non-allowlisted Wrangler deploy",
        "package.json#release contains a prohibited Wrangler mutation command",
        "package.json#release contains a direct Cloudflare API reference",
        ".github/workflows/ci.yml contents do not match the approved digest",
        ".github/workflows/ci.yml contains prohibited GitHub write permissions",
        ".github/workflows/ci.yml contains a non-platform secret reference",
        ".github/workflows/ci.yml must not inherit workflow secrets",
        ".github/workflows/ci.yml contains a Cloudflare mutation command",
      ]),
    );
  });
});
