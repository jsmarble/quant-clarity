import {
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";

type JsonObject = Record<string, unknown>;

const disabledPublicObservability = {
  enabled: false,
  reason: "zero_visitor_data",
} as const;

export const cloudflarePreviewPlanProposal = {
  schema_version: "1.0.0",
  status: "proposal_only_non_authoritative",
  environment: "preview",
  required_account_isolation: "dedicated_cloudflare_account",
  authority: {
    provisioning_authorized: false,
    deployment_authorized: false,
    migration_authorized: false,
    publication_authorized: false,
  },
  remote_identity: {
    account_id: null,
    zone_id: null,
    workers_dev_subdomain: null,
  },
  routing: {
    workers_dev: false,
    preview_urls: false,
    web_host: null,
    api_host: null,
    routes: null,
  },
  smoke_testing: {
    selected_mechanism: null,
    successor_authority_required: true,
    allowed_future_mechanisms: [
      "api_web_version_preview_urls",
      "private_probe_worker",
    ],
    query_and_pipeline_public_exposure: false,
  },
  workers: [
    {
      component: "web",
      name: "quant-clarity-web-preview",
      resource_id: null,
      ingress: "reserved_public_but_unrouted",
      observability: disabledPublicObservability,
      bindings: {
        assets: ["ASSETS"],
        services: [
          {
            binding: "API",
            worker: "quant-clarity-api-preview",
            entrypoint: null,
          },
        ],
        rate_limiters: ["READ_LIMITER", "ROTATION_LIMITER"],
        protected_secret_names: ["RATE_LIMIT_HMAC_KEY"],
        variables: [{ name: "DEPLOYMENT_ENV", value: "preview" }],
        storage: [],
        ai: [],
        pipeline_control: [],
      },
    },
    {
      component: "api",
      name: "quant-clarity-api-preview",
      resource_id: null,
      ingress: "reserved_public_but_unrouted",
      observability: disabledPublicObservability,
      bindings: {
        assets: [],
        services: [
          {
            binding: "CATALOG_QUERY",
            worker: "quant-clarity-query-preview",
            entrypoint: "CatalogQueryService",
          },
        ],
        rate_limiters: ["READ_LIMITER", "ROTATION_LIMITER"],
        protected_secret_names: ["RATE_LIMIT_HMAC_KEY"],
        variables: [{ name: "DEPLOYMENT_ENV", value: "preview" }],
        storage: [],
        ai: [],
        pipeline_control: [],
      },
    },
    {
      component: "query",
      name: "quant-clarity-query-preview",
      resource_id: null,
      ingress: "private_service_binding_only",
      observability: disabledPublicObservability,
      bindings: {
        assets: [],
        services: [],
        rate_limiters: [],
        protected_secret_names: [],
        variables: [
          { name: "DEPLOYMENT_ENVIRONMENT", value: "preview" },
          { name: "PUBLIC_API_ORIGIN", value: null },
        ],
        storage: ["SERVING_DB"],
        ai: [],
        pipeline_control: [],
      },
    },
    {
      component: "pipeline",
      name: "quant-clarity-pipeline-preview",
      resource_id: null,
      ingress: "private_control_plane_only",
      observability: {
        enabled: false,
        reason: "nonvisitor_schema_pending",
      },
      bindings: {
        assets: [],
        services: [],
        rate_limiters: [],
        protected_secret_names: [],
        variables: [],
        storage: [
          "CANONICAL_DB",
          "SERVING_DB",
          "EVIDENCE_BUCKET",
          "BACKUP_BUCKET",
          "SEARCH_INDEX",
        ],
        ai: [],
        pipeline_control: ["PUBLICATION_WORKFLOW"],
      },
    },
  ],
  resources: {
    d1: [
      {
        purpose: "canonical",
        name: "quant-clarity-canonical-preview",
        resource_id: null,
        binding: "CANONICAL_DB",
        data_jurisdiction: null,
        location_hint: null,
      },
      {
        purpose: "serving",
        name: "quant-clarity-serving-preview",
        resource_id: null,
        binding: "SERVING_DB",
        data_jurisdiction: null,
        location_hint: null,
      },
    ],
    r2: [
      {
        purpose: "evidence",
        name: "quant-clarity-evidence-preview",
        resource_id: null,
        binding: "EVIDENCE_BUCKET",
        access: "private",
        data_jurisdiction: null,
        location_hint: null,
        retention_policy: "pending",
      },
      {
        purpose: "backup",
        name: "quant-clarity-backup-preview",
        resource_id: null,
        binding: "BACKUP_BUCKET",
        access: "private",
        data_jurisdiction: null,
        location_hint: null,
        retention_policy: "pending",
      },
    ],
    vectorize: {
      name: "quant-clarity-search-preview",
      resource_id: null,
      binding: "SEARCH_INDEX",
      namespace_policy: "publication_id",
      index_policy: "pending_adr_0045",
    },
    workflow: {
      name: "quant-clarity-publication-preview",
      resource_id: null,
      binding: "PUBLICATION_WORKFLOW",
      class_name: "PublicationWorkflow",
      schedule: null,
    },
    rate_limiters: [
      {
        worker: "api",
        binding: "READ_LIMITER",
        reserved_namespace_id: "2101",
        uniqueness: "pending_remote_audit",
      },
      {
        worker: "api",
        binding: "ROTATION_LIMITER",
        reserved_namespace_id: "2102",
        uniqueness: "pending_remote_audit",
      },
      {
        worker: "web",
        binding: "READ_LIMITER",
        reserved_namespace_id: "2301",
        uniqueness: "pending_remote_audit",
      },
      {
        worker: "web",
        binding: "ROTATION_LIMITER",
        reserved_namespace_id: "2302",
        uniqueness: "pending_remote_audit",
      },
    ],
  },
  credential_model: {
    cloudflare_permission_granularity_verified: false,
    provider_write_scopes_may_exceed_automation_allowlists: true,
    dedicated_account_containment_required: true,
    bootstrap_lifecycle: "short_lived_revoke_after_use",
  },
  identities: [
    {
      role: "plan_read_only",
      desired_github_environment: "preview-plan",
      created: false,
      credential_reference: null,
      credential_effective_permissions: null,
      cross_environment_access: false,
      automation_action_allowlist: "inventory_read_only",
    },
    {
      role: "bootstrap",
      desired_github_environment: "preview-bootstrap",
      created: false,
      credential_reference: null,
      credential_effective_permissions: null,
      cross_environment_access: false,
      automation_action_allowlist: "create_exact_named_resources_no_delete",
    },
    {
      role: "worker_deploy",
      desired_github_environment: "preview-deploy",
      created: false,
      credential_reference: null,
      credential_effective_permissions: null,
      cross_environment_access: false,
      automation_action_allowlist:
        "upload_and_activate_exact_worker_versions_no_delete",
    },
    {
      role: "data_migrate",
      desired_github_environment: "preview-migrate",
      created: false,
      credential_reference: null,
      credential_effective_permissions: null,
      cross_environment_access: false,
      automation_action_allowlist:
        "approved_forward_migrations_and_controlled_writes_no_routes",
    },
    {
      role: "synthetic_probe",
      desired_github_environment: "preview-synthetic",
      created: false,
      credential_reference: null,
      credential_effective_permissions: null,
      cross_environment_access: false,
      automation_action_allowlist: "fixed_public_probes_no_mutation",
    },
    {
      role: "worker_rollback_break_glass",
      desired_github_environment: "preview-worker-rollback",
      created: false,
      credential_reference: null,
      credential_effective_permissions: null,
      cross_environment_access: false,
      automation_action_allowlist: "rollback_exact_worker_versions_only",
    },
    {
      role: "publication_rollback",
      desired_github_environment: "preview-publication-rollback",
      created: false,
      credential_reference: null,
      credential_effective_permissions: null,
      cross_environment_access: false,
      automation_action_allowlist: "fixed_publication_pointer_rollback_only",
    },
  ],
  github_environments: [
    { name: "preview-plan", created: false, protection_rules: "pending" },
    { name: "preview-bootstrap", created: false, protection_rules: "pending" },
    { name: "preview-deploy", created: false, protection_rules: "pending" },
    { name: "preview-migrate", created: false, protection_rules: "pending" },
    { name: "preview-synthetic", created: false, protection_rules: "pending" },
    {
      name: "preview-worker-rollback",
      created: false,
      protection_rules: "pending",
    },
    {
      name: "preview-publication-rollback",
      created: false,
      protection_rules: "pending",
    },
  ],
  protected_secret_requirements: [
    {
      binding_name: "RATE_LIMIT_HMAC_KEY",
      workers: ["web", "api"],
      value_separation: "distinct_per_worker",
      values_present: false,
    },
  ],
  pending_gates: [
    "owner_authorization",
    "legal_privacy_review",
    "provider_source_approval",
    "adr_0045_product_decision",
    "spend_authorization",
    "domain_decision",
    "data_residency_jurisdiction_decision",
    "cloudflare_permission_scope_validation",
    "preview_smoke_mechanism_design",
    "preview_api_query_environment_configuration_and_remote_mismatch_probe",
    "publication_rollback_authority_design",
    "rate_limiter_namespace_audit",
    "retention_lock_policy_approval",
  ],
} as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonPath(path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (result, part) =>
      typeof part === "number"
        ? `${result}[${String(part)}]`
        : `${result}.${part}`,
    "$",
  );
}

function findDuplicateProperties(
  node: JsonNode,
  path: readonly (string | number)[],
  errors: string[],
): void {
  if (node.type === "object") {
    const seen = new Set<string>();
    for (const property of node.children ?? []) {
      const [keyNode, valueNode] = property.children ?? [];
      const key: unknown =
        keyNode === undefined ? undefined : getNodeValue(keyNode);
      if (typeof key !== "string" || valueNode === undefined) continue;
      const propertyPath = [...path, key];
      if (seen.has(key))
        errors.push(`${jsonPath(propertyPath)} is a duplicate property`);
      seen.add(key);
      findDuplicateProperties(valueNode, propertyPath, errors);
    }
    return;
  }

  if (node.type === "array")
    for (const [index, child] of (node.children ?? []).entries())
      findDuplicateProperties(child, [...path, index], errors);
}

export function parseCloudflarePreviewPlanDocument(contents: string): {
  plan: unknown;
  errors: string[];
} {
  const parseErrors: ParseError[] = [];
  const root = parseTree(contents, parseErrors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  const errors = parseErrors.map(
    ({ error, offset }) =>
      `invalid JSON at offset ${String(offset)}: ${printParseErrorCode(error)}`,
  );
  if (root === undefined) return { plan: undefined, errors };
  findDuplicateProperties(root, [], errors);
  return { plan: getNodeValue(root) as unknown, errors };
}

function walk(
  value: unknown,
  path: string,
  visit: (value: unknown, path: string, key: string | null) => void,
): void {
  visit(value, path, path === "$" ? null : (path.split(".").at(-1) ?? null));
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, `${path}[${String(index)}]`, visit);
    });
    return;
  }
  if (isObject(value))
    for (const [key, child] of Object.entries(value))
      walk(child, `${path}.${key}`, visit);
}

export function validateCloudflarePreviewPlan(plan: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(plan)) return ["preview plan must be an object"];

  if (JSON.stringify(plan) !== JSON.stringify(cloudflarePreviewPlanProposal))
    errors.push("preview plan must exactly mirror the code-owned proposal");

  walk(plan, "$", (value, path, key) => {
    if (
      key !== null &&
      /(?:account_id|zone_id|resource_id|data_jurisdiction|location_hint)$/u.test(
        key,
      ) &&
      value !== null
    )
      errors.push(`${path} must remain null`);
    if (
      key !== null &&
      /(?:_host|subdomain|routes?|schedule)$/u.test(key) &&
      value !== null
    )
      errors.push(`${path} must remain null`);
    if (key === "workers_dev" && value !== false)
      errors.push(`${path} must remain false`);
    if (key === "preview_urls" && value !== false)
      errors.push(`${path} must remain false`);
    if (key?.endsWith("_authorized") === true && value !== false)
      errors.push(`${path} must remain false`);
    if (key === "created" && value !== false)
      errors.push(`${path} must remain false`);
    if (
      (key === "credential_reference" ||
        key === "credential_effective_permissions") &&
      value !== null
    )
      errors.push(`${path} must remain null`);
    if (key === "cross_environment_access" && value !== false)
      errors.push(`${path} must remain false`);
    if (key === "values_present" && value !== false)
      errors.push(`${path} must remain false`);
    if (key === "cloudflare_permission_granularity_verified" && value !== false)
      errors.push(`${path} must remain false`);
    if (key === "selected_mechanism" && value !== null)
      errors.push(`${path} must remain null`);
    if (key === "query_and_pipeline_public_exposure" && value !== false)
      errors.push(`${path} must remain false`);
    if (
      key === "required_account_isolation" &&
      value !== "dedicated_cloudflare_account"
    )
      errors.push(`${path} must require a dedicated Cloudflare account`);
    if (key === "successor_authority_required" && value !== true)
      errors.push(`${path} must remain true`);
    if (
      key === "provider_write_scopes_may_exceed_automation_allowlists" &&
      value !== true
    )
      errors.push(`${path} must remain true`);
    if (key === "dedicated_account_containment_required" && value !== true)
      errors.push(`${path} must remain true`);
    if (
      key === "bootstrap_lifecycle" &&
      value !== "short_lived_revoke_after_use"
    )
      errors.push(`${path} must require short-lived revocation after use`);
    if (key === "access" && value !== "private")
      errors.push(`${path} must remain private`);
    if (
      key !== null &&
      /(?:credential|secret|token)/iu.test(key) &&
      !key.startsWith("protected_secret_") &&
      ![
        "credential_effective_permissions",
        "credential_model",
        "credential_reference",
      ].includes(key)
    )
      errors.push(`${path} contains a prohibited sensitive value`);
    if (
      key === "enabled" &&
      path.includes(".observability.") &&
      value !== false
    )
      errors.push(`${path} must remain false`);
    if (key !== null && /(?:command|secret_value|token_value)$/u.test(key))
      errors.push(`${path} is prohibited`);
    if (typeof value === "string") {
      if (/production/iu.test(value))
        errors.push(
          `${path} contains a prohibited cross-environment reference`,
        );
      if (/\b(?:wrangler|curl)\b|api\.cloudflare\.com/iu.test(value))
        errors.push(
          `${path} contains a prohibited executable or API reference`,
        );
      if (/https?:\/\//iu.test(value))
        errors.push(`${path} contains a prohibited remote endpoint`);
    }
  });

  return [...new Set(errors)];
}
