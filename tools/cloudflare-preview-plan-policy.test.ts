import { describe, expect, it } from "vitest";

import {
  cloudflarePreviewPlanProposal,
  parseCloudflarePreviewPlanDocument,
  validateCloudflarePreviewPlan,
} from "./cloudflare-preview-plan-policy.js";

function safePlan(): unknown {
  return structuredClone(cloudflarePreviewPlanProposal);
}

function object(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe("Cloudflare preview plan proposal", () => {
  it("accepts only the exact inert proposal", () => {
    expect(validateCloudflarePreviewPlan(safePlan())).toEqual([]);
  });

  it.each([
    ['"account_id":"leaked-account","account_id":null', "account_id"],
    [
      '"credential_reference":"leaked-credential","credential_reference":null',
      "credential_reference",
    ],
    ['"web_host":"https://leaked.example","web_host":null', "web_host"],
    ['"resource_id":"leaked-resource","resource_id":null', "resource_id"],
  ])("rejects a shadowed duplicate %s", (duplicate, key) => {
    const document = parseCloudflarePreviewPlanDocument(`{${duplicate}}`);
    expect(document.errors).toEqual([`$.${key} is a duplicate property`]);
  });

  it("rejects every authority transition", () => {
    const plan = object(safePlan());
    const authority = object(plan.authority);
    authority.provisioning_authorized = true;
    authority.deployment_authorized = true;
    authority.migration_authorized = true;
    authority.publication_authorized = true;
    expect(validateCloudflarePreviewPlan(plan)).toEqual(
      expect.arrayContaining([
        "preview plan must exactly mirror the code-owned proposal",
        "$.authority.provisioning_authorized must remain false",
        "$.authority.deployment_authorized must remain false",
        "$.authority.migration_authorized must remain false",
        "$.authority.publication_authorized must remain false",
      ]),
    );
  });

  it("rejects remote IDs, hosts, routes, and schedules", () => {
    const plan = object(safePlan());
    const remote = object(plan.remote_identity);
    remote.account_id = "account";
    remote.zone_id = "zone";
    remote.workers_dev_subdomain = "preview";
    const routing = object(plan.routing);
    routing.web_host = "preview.example.test";
    routing.routes = ["preview.example.test/*"];
    routing.workers_dev = true;
    routing.preview_urls = true;
    const resources = object(plan.resources);
    const workflow = object(resources.workflow);
    workflow.schedule = "0 5 * * 1,4";
    expect(validateCloudflarePreviewPlan(plan)).toEqual(
      expect.arrayContaining([
        "$.remote_identity.account_id must remain null",
        "$.remote_identity.zone_id must remain null",
        "$.remote_identity.workers_dev_subdomain must remain null",
        "$.routing.web_host must remain null",
        "$.routing.routes must remain null",
        "$.routing.workers_dev must remain false",
        "$.routing.preview_urls must remain false",
        "$.resources.workflow.schedule must remain null",
      ]),
    );
  });

  it("rejects resolved data jurisdiction or location", () => {
    const plan = object(safePlan());
    const resources = object(plan.resources);
    const d1 = resources.d1 as Record<string, unknown>[];
    const r2 = resources.r2 as Record<string, unknown>[];
    d1[0]!.data_jurisdiction = "eu";
    r2[1]!.location_hint = "weur";
    expect(validateCloudflarePreviewPlan(plan)).toEqual(
      expect.arrayContaining([
        "$.resources.d1[0].data_jurisdiction must remain null",
        "$.resources.r2[1].location_hint must remain null",
      ]),
    );
  });

  it("rejects Worker/resource IDs and enabled observability", () => {
    const plan = object(safePlan());
    const workers = plan.workers as Record<string, unknown>[];
    workers[0]!.resource_id = "worker-id";
    object(workers[1]!.observability).enabled = true;
    const resources = object(plan.resources);
    const d1 = resources.d1 as Record<string, unknown>[];
    d1[0]!.resource_id = "database-id";
    expect(validateCloudflarePreviewPlan(plan)).toEqual(
      expect.arrayContaining([
        "$.workers[0].resource_id must remain null",
        "$.workers[1].observability.enabled must remain false",
        "$.resources.d1[0].resource_id must remain null",
      ]),
    );
  });

  it("rejects a resolved public API origin", () => {
    const plan = object(safePlan());
    const workers = plan.workers as Record<string, unknown>[];
    const bindings = object(workers[2]!.bindings);
    const variables = bindings.variables as Record<string, unknown>[];
    variables[1]!.value = "https://api.preview.example.test";
    expect(validateCloudflarePreviewPlan(plan)).toEqual(
      expect.arrayContaining([
        "preview plan must exactly mirror the code-owned proposal",
        "$.workers[2].bindings.variables[1].value contains a prohibited remote endpoint",
      ]),
    );
  });

  it("rejects created identities, credentials, secret values, and commands", () => {
    const plan = object(safePlan());
    const identities = plan.identities as Record<string, unknown>[];
    identities[0]!.created = true;
    identities[1]!.credential_reference = "secret://bootstrap";
    identities[2]!.credential_effective_permissions = ["write"];
    identities[3]!.cross_environment_access = true;
    plan.secret_value = "must-not-exist";
    plan.command = "wrangler deploy";
    expect(validateCloudflarePreviewPlan(plan)).toEqual(
      expect.arrayContaining([
        "$.identities[0].created must remain false",
        "$.identities[1].credential_reference must remain null",
        "$.identities[2].credential_effective_permissions must remain null",
        "$.identities[3].cross_environment_access must remain false",
        "$.secret_value is prohibited",
        "$.command is prohibited",
        "$.command contains a prohibited executable or API reference",
      ]),
    );
  });

  it("rejects selection or exposure of a smoke mechanism", () => {
    const plan = object(safePlan());
    const smokeTesting = object(plan.smoke_testing);
    smokeTesting.selected_mechanism = "api_web_version_preview_urls";
    smokeTesting.successor_authority_required = false;
    smokeTesting.query_and_pipeline_public_exposure = true;
    expect(validateCloudflarePreviewPlan(plan)).toEqual(
      expect.arrayContaining([
        "$.smoke_testing.selected_mechanism must remain null",
        "$.smoke_testing.successor_authority_required must remain true",
        "$.smoke_testing.query_and_pipeline_public_exposure must remain false",
      ]),
    );
  });

  it("rejects weakened account, credential, and private-storage containment", () => {
    const plan = object(safePlan());
    plan.required_account_isolation = "shared_cloudflare_account";
    const credentialModel = object(plan.credential_model);
    credentialModel.provider_write_scopes_may_exceed_automation_allowlists = false;
    credentialModel.dedicated_account_containment_required = false;
    credentialModel.bootstrap_lifecycle = "persistent";
    const resources = object(plan.resources);
    const r2 = resources.r2 as Record<string, unknown>[];
    r2[0]!.access = "public";
    expect(validateCloudflarePreviewPlan(plan)).toEqual(
      expect.arrayContaining([
        "$.required_account_isolation must require a dedicated Cloudflare account",
        "$.credential_model.provider_write_scopes_may_exceed_automation_allowlists must remain true",
        "$.credential_model.dedicated_account_containment_required must remain true",
        "$.credential_model.bootstrap_lifecycle must require short-lived revocation after use",
        "$.resources.r2[0].access must remain private",
      ]),
    );
  });

  it("rejects cross-environment references and additive bindings", () => {
    const plan = object(safePlan());
    const workers = plan.workers as Record<string, unknown>[];
    const bindings = object(workers[0]!.bindings);
    (bindings.storage as unknown[]).push("PRODUCTION_DB");
    (bindings.ai as unknown[]).push("AI");
    expect(validateCloudflarePreviewPlan(plan)).toEqual(
      expect.arrayContaining([
        "preview plan must exactly mirror the code-owned proposal",
        "$.workers[0].bindings.storage[0] contains a prohibited cross-environment reference",
      ]),
    );
  });

  it("rejects limiter reservation drift and GitHub environment creation", () => {
    const plan = object(safePlan());
    const resources = object(plan.resources);
    const limiters = resources.rate_limiters as Record<string, unknown>[];
    limiters[0]!.reserved_namespace_id = "9999";
    const githubEnvironments = plan.github_environments as Record<
      string,
      unknown
    >[];
    githubEnvironments[0]!.created = true;
    expect(validateCloudflarePreviewPlan(plan)).toEqual(
      expect.arrayContaining([
        "preview plan must exactly mirror the code-owned proposal",
        "$.github_environments[0].created must remain false",
      ]),
    );
  });

  it("rejects secret-value colocation or a stored value", () => {
    const plan = object(safePlan());
    const requirements = plan.protected_secret_requirements as Record<
      string,
      unknown
    >[];
    requirements[0]!.value_separation = "shared";
    requirements[0]!.values_present = true;
    expect(validateCloudflarePreviewPlan(plan)).toEqual(
      expect.arrayContaining([
        "preview plan must exactly mirror the code-owned proposal",
        "$.protected_secret_requirements[0].values_present must remain false",
      ]),
    );
  });
});
