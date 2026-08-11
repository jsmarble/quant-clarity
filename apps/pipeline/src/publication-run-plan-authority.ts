const RUN_PLAN_CONTRACT_VERSION = "publication-run-plan@1" as const;
const RUN_PLAN_CAPABILITY_VERSION = "publication-run-plan-authority@1" as const;
const LOGICAL_SCHEDULE_NAME = "provider-refresh-v1" as const;
const SCHEDULE_EXPRESSION = "0 5 * * 1,4" as const;
const PROVIDER_SCOPE_HASH_DOMAIN =
  "publication-run-plan-provider-scope@1" as const;
const POLICY_SET_HASH_DOMAIN = "publication-run-plan-policy-set@1" as const;
const PLAN_HASH_DOMAIN = "publication-run-plan-root@1" as const;
const MAX_PROVIDERS = 16;
const MAX_SAFE_SQL_INTEGER = Number.MAX_SAFE_INTEGER;
const MAX_ECMASCRIPT_DATE_MILLISECONDS = 8_640_000_000_000_000;
const RUN_PLAN_ID_PATTERN =
  /^rpl_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROVIDER_ID_PATTERN =
  /^prv_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const POLICY_ROLES = [
  "provider_retry",
  "run_budget",
  "terminal_deadline",
] as const;

const APPROVER_ROLES_JSON =
  '["legal_source_owner","platform_owner","product_owner"]' as const;

const REVOCATION_REASON_CODES = [
  "integrity_failure",
  "legal_source_revoked",
  "platform_authority_revoked",
  "product_authority_revoked",
  "superseded",
] as const;

export const PUBLICATION_RUN_PLAN_ERROR_CODES = [
  "approval_invalid",
  "database_result_invalid",
  "environment_mismatch",
  "integrity_capability_missing",
  "plan_hash_mismatch",
  "plan_invalid",
  "plan_not_effective",
  "plan_not_found",
  "plan_revoked",
  "policy_authority_invalid",
  "provider_authority_invalid",
  "scheduled_time_invalid",
  "source_authority_invalid",
  "version_mismatch",
] as const;

export type PublicationRunPlanErrorCode =
  (typeof PUBLICATION_RUN_PLAN_ERROR_CODES)[number];

export class PublicationRunPlanAuthorityError extends Error {
  readonly code: PublicationRunPlanErrorCode;

  constructor(code: PublicationRunPlanErrorCode) {
    super(code);
    this.name = "PublicationRunPlanAuthorityError";
    this.code = code;
  }
}

export type AuthorizedPublicationRunPlanV1 = Readonly<{
  contractVersion: typeof RUN_PLAN_CONTRACT_VERSION;
  runPlanId: string;
  planHash: string;
  environment: "preview" | "production";
  scheduleName: typeof LOGICAL_SCHEDULE_NAME;
  scheduleExpression: typeof SCHEDULE_EXPRESSION;
  effectiveFrom: string;
  effectiveTo: string;
  scheduledAt: string;
  canonicalSchemaVersion: string;
  pipelineContractVersion: string;
  providerScopeHash: string;
  policySetHash: string;
  providers: readonly Readonly<{
    ordinal: number;
    providerId: string;
    adapterVersion: string;
    rosterVersion: string;
    rosterContentHash: string;
    sourceRegisterVersion: string;
    sourceRegisterArtifactHash: string;
    requestCeiling: number;
    byteCeiling: number;
    aiTokenCeiling: number;
    browserMillisecondCeiling: number;
    elapsedMillisecondCeiling: number;
    costMicrousdCeiling: number;
    retryPolicyHash: string;
  }>[];
  policies: readonly Readonly<{
    role: (typeof POLICY_ROLES)[number];
    version: string;
    contentHash: string;
  }>[];
  approval: Readonly<{
    artifactPath: string;
    artifactHash: string;
    approvedAt: string;
    approverRoles: readonly [
      "legal_source_owner",
      "platform_owner",
      "product_owner",
    ];
  }>;
}>;

type HeaderRow = Readonly<{
  run_plan_id: unknown;
  contract_version: unknown;
  environment: unknown;
  schedule_name: unknown;
  schedule_expression: unknown;
  effective_from_ms: unknown;
  effective_to_ms: unknown;
  canonical_schema_version: unknown;
  pipeline_contract_version: unknown;
  provider_count: unknown;
  provider_scope_hash: unknown;
  policy_set_hash: unknown;
  plan_hash: unknown;
  created_at_ms: unknown;
  sealed_contract_version: unknown;
  sealed_provider_count: unknown;
  sealed_provider_scope_hash: unknown;
  sealed_policy_count: unknown;
  sealed_policy_set_hash: unknown;
  sealed_plan_hash: unknown;
  sealed_at_ms: unknown;
  approval_artifact_path: unknown;
  approval_artifact_hash: unknown;
  approver_roles_json: unknown;
  approved_at_ms: unknown;
  revocation_reason_code: unknown;
  revocation_effective_at_ms: unknown;
}>;

type ProviderRow = Readonly<{
  run_plan_id: unknown;
  ordinal: unknown;
  provider_id: unknown;
  adapter_version: unknown;
  roster_version: unknown;
  roster_content_hash: unknown;
  source_register_version: unknown;
  source_register_artifact_hash: unknown;
  request_ceiling: unknown;
  byte_ceiling: unknown;
  ai_token_ceiling: unknown;
  browser_millisecond_ceiling: unknown;
  elapsed_millisecond_ceiling: unknown;
  cost_microusd_ceiling: unknown;
  retry_policy_hash: unknown;
  actual_roster_content_hash: unknown;
  actual_source_artifact_hash: unknown;
  source_reviewed_at_ms: unknown;
  source_next_review_at_ms: unknown;
  source_approval_state: unknown;
  source_access_permitted: unknown;
  source_retention_permitted: unknown;
  source_excerpt_permitted: unknown;
  source_publication_permitted: unknown;
}>;

type PolicyRow = Readonly<{
  run_plan_id: unknown;
  policy_role: unknown;
  policy_version: unknown;
  content_hash: unknown;
}>;

const METADATA_SQL = `SELECT capability
FROM publication_run_plan_authority_integrity_metadata
WHERE singleton = ?1`;

const HEADER_SQL = `SELECT
  plan.run_plan_id,
  plan.contract_version,
  plan.environment,
  plan.schedule_name,
  plan.schedule_expression,
  plan.effective_from_ms,
  plan.effective_to_ms,
  plan.canonical_schema_version,
  plan.pipeline_contract_version,
  plan.provider_count,
  plan.provider_scope_hash,
  plan.policy_set_hash,
  plan.plan_hash,
  plan.created_at_ms,
  seal.contract_version AS sealed_contract_version,
  seal.provider_count AS sealed_provider_count,
  seal.provider_scope_hash AS sealed_provider_scope_hash,
  seal.policy_count AS sealed_policy_count,
  seal.policy_set_hash AS sealed_policy_set_hash,
  seal.plan_hash AS sealed_plan_hash,
  seal.sealed_at_ms,
  approval.artifact_path AS approval_artifact_path,
  approval.artifact_hash AS approval_artifact_hash,
  approval.approval_roles_json AS approver_roles_json,
  approval.approved_at_ms,
  revocation.reason_code AS revocation_reason_code,
  revocation.effective_at_ms AS revocation_effective_at_ms
FROM publication_run_plan AS plan
JOIN publication_run_plan_seal AS seal USING (run_plan_id)
JOIN publication_run_plan_approval AS approval USING (run_plan_id)
LEFT JOIN publication_run_plan_revocation AS revocation USING (run_plan_id)
WHERE plan.run_plan_id = ?1
  AND plan.plan_hash = ?2
  AND seal.plan_hash = ?2
LIMIT 2`;

const PROVIDERS_SQL = `SELECT
  planned.run_plan_id,
  planned.ordinal,
  planned.provider_id,
  planned.adapter_version,
  planned.roster_version,
  planned.roster_content_hash,
  planned.source_register_version,
  planned.source_artifact_hash AS source_register_artifact_hash,
  planned.request_ceiling,
  planned.byte_ceiling,
  planned.ai_token_ceiling,
  planned.browser_millisecond_ceiling,
  planned.elapsed_millisecond_ceiling,
  planned.cost_microusd_ceiling,
  planned.retry_policy_hash,
  roster.content_hash AS actual_roster_content_hash,
  source.artifact_hash AS actual_source_artifact_hash,
  source.reviewed_at_ms AS source_reviewed_at_ms,
  source.next_review_at_ms AS source_next_review_at_ms,
  source.approval_state AS source_approval_state,
  source.access_permitted AS source_access_permitted,
  source.retention_permitted AS source_retention_permitted,
  source.excerpt_permitted AS source_excerpt_permitted,
  source.publication_permitted AS source_publication_permitted
FROM publication_run_plan_provider AS planned
JOIN provider_roster AS roster
  ON roster.provider_id = planned.provider_id
 AND roster.roster_version = planned.roster_version
JOIN source_compliance_record AS source
  ON source.provider_id = planned.provider_id
 AND source.register_version = planned.source_register_version
WHERE planned.run_plan_id = ?1
ORDER BY planned.ordinal
LIMIT 17`;

const POLICIES_SQL = `SELECT
  run_plan_id,
  role AS policy_role,
  policy_version,
  policy_hash AS content_hash
FROM publication_run_plan_policy
WHERE run_plan_id = ?1
ORDER BY policy_role
LIMIT 4`;

const fail = (code: PublicationRunPlanErrorCode): never => {
  throw new PublicationRunPlanAuthorityError(code);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const exactOwnDataRecord = (
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> => {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype)
    return fail("database_result_invalid");
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))
  )
    return fail("database_result_invalid");
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      return fail("database_result_invalid");
  }
  return value;
};

const ascii = (
  value: unknown,
  minimum: number,
  maximum: number,
  code: PublicationRunPlanErrorCode,
): string => {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    !/^[\x20-\x7e]+$/.test(value)
  )
    return fail(code);
  return value;
};

const sha256 = (value: unknown, code: PublicationRunPlanErrorCode): string => {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value))
    return fail(code);
  return value;
};

const deploymentEnvironment = (value: unknown): "preview" | "production" => {
  if (value !== "preview" && value !== "production")
    return fail("plan_invalid");
  return value;
};

const safeInteger = (
  value: unknown,
  code: PublicationRunPlanErrorCode,
): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_SAFE_SQL_INTEGER
  )
    return fail(code);
  return value;
};

const canonicalInstant = (
  value: number,
  code: PublicationRunPlanErrorCode,
): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fail(code);
  return date.toISOString();
};

const dateMilliseconds = (
  value: unknown,
  code: PublicationRunPlanErrorCode,
): number => {
  const milliseconds = safeInteger(value, code);
  if (milliseconds > MAX_ECMASCRIPT_DATE_MILLISECONDS) return fail(code);
  return milliseconds;
};

const scheduledMilliseconds = (value: unknown): number => {
  if (typeof value !== "string" || (value.length !== 24 && value.length !== 27))
    return fail("scheduled_time_invalid");
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 0 ||
    new Date(milliseconds).toISOString() !== value
  )
    return fail("scheduled_time_invalid");
  const scheduled = new Date(milliseconds);
  if (
    ![1, 4].includes(scheduled.getUTCDay()) ||
    scheduled.getUTCHours() !== 5 ||
    scheduled.getUTCMinutes() !== 0 ||
    scheduled.getUTCSeconds() !== 0 ||
    scheduled.getUTCMilliseconds() !== 0
  )
    return fail("scheduled_time_invalid");
  return milliseconds;
};

const digestCanonicalJson = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
};

export type PublicationRunPlanHashInput = Readonly<{
  runPlanId: string;
  environment: "preview" | "production";
  effectiveFromMs: number;
  effectiveToMs: number;
  canonicalSchemaVersion: string;
  pipelineContractVersion: string;
  createdAtMs: number;
  providers: readonly Readonly<{
    ordinal: number;
    providerId: string;
    adapterVersion: string;
    rosterVersion: string;
    rosterContentHash: string;
    sourceRegisterVersion: string;
    sourceRegisterArtifactHash: string;
    requestCeiling: number;
    byteCeiling: number;
    aiTokenCeiling: number;
    browserMillisecondCeiling: number;
    elapsedMillisecondCeiling: number;
    costMicrousdCeiling: number;
    retryPolicyHash: string;
  }>[];
  policies: readonly Readonly<{
    role: (typeof POLICY_ROLES)[number];
    version: string;
    contentHash: string;
  }>[];
}>;

export const hashPublicationRunPlan = async (
  input: PublicationRunPlanHashInput,
): Promise<
  Readonly<{
    providerScopeHash: string;
    policySetHash: string;
    planHash: string;
  }>
> => {
  const providers = input.providers.map((provider) => ({
    ordinal: provider.ordinal,
    provider_id: provider.providerId,
    adapter_version: provider.adapterVersion,
    roster_version: provider.rosterVersion,
    roster_content_hash: provider.rosterContentHash,
    source_register_version: provider.sourceRegisterVersion,
    source_register_artifact_hash: provider.sourceRegisterArtifactHash,
    request_ceiling: provider.requestCeiling,
    byte_ceiling: provider.byteCeiling,
    ai_token_ceiling: provider.aiTokenCeiling,
    browser_millisecond_ceiling: provider.browserMillisecondCeiling,
    elapsed_millisecond_ceiling: provider.elapsedMillisecondCeiling,
    cost_microusd_ceiling: provider.costMicrousdCeiling,
    retry_policy_hash: provider.retryPolicyHash,
  }));
  const policies = input.policies.map((policy) => ({
    policy_role: policy.role,
    policy_version: policy.version,
    content_hash: policy.contentHash,
  }));
  const providerScopeHash = await digestCanonicalJson({
    domain: PROVIDER_SCOPE_HASH_DOMAIN,
    provider_ids: providers.map((provider) => provider.provider_id),
  });
  const policySetHash = await digestCanonicalJson({
    domain: POLICY_SET_HASH_DOMAIN,
    policies,
  });
  const planHash = await digestCanonicalJson({
    domain: PLAN_HASH_DOMAIN,
    contract_version: RUN_PLAN_CONTRACT_VERSION,
    run_plan_id: input.runPlanId,
    environment: input.environment,
    schedule_name: LOGICAL_SCHEDULE_NAME,
    schedule_expression: SCHEDULE_EXPRESSION,
    effective_from_ms: input.effectiveFromMs,
    effective_to_ms: input.effectiveToMs,
    canonical_schema_version: input.canonicalSchemaVersion,
    pipeline_contract_version: input.pipelineContractVersion,
    provider_count: providers.length,
    provider_scope_hash: providerScopeHash,
    policy_set_hash: policySetHash,
    created_at_ms: input.createdAtMs,
    providers,
    policies,
  });
  return Object.freeze({ providerScopeHash, policySetHash, planHash });
};

const HEADER_KEYS = [
  "run_plan_id",
  "contract_version",
  "environment",
  "schedule_name",
  "schedule_expression",
  "effective_from_ms",
  "effective_to_ms",
  "canonical_schema_version",
  "pipeline_contract_version",
  "provider_count",
  "provider_scope_hash",
  "policy_set_hash",
  "plan_hash",
  "created_at_ms",
  "sealed_contract_version",
  "sealed_provider_count",
  "sealed_provider_scope_hash",
  "sealed_policy_count",
  "sealed_policy_set_hash",
  "sealed_plan_hash",
  "sealed_at_ms",
  "approval_artifact_path",
  "approval_artifact_hash",
  "approver_roles_json",
  "approved_at_ms",
  "revocation_reason_code",
  "revocation_effective_at_ms",
] as const;

const PROVIDER_KEYS = [
  "run_plan_id",
  "ordinal",
  "provider_id",
  "adapter_version",
  "roster_version",
  "roster_content_hash",
  "source_register_version",
  "source_register_artifact_hash",
  "request_ceiling",
  "byte_ceiling",
  "ai_token_ceiling",
  "browser_millisecond_ceiling",
  "elapsed_millisecond_ceiling",
  "cost_microusd_ceiling",
  "retry_policy_hash",
  "actual_roster_content_hash",
  "actual_source_artifact_hash",
  "source_reviewed_at_ms",
  "source_next_review_at_ms",
  "source_approval_state",
  "source_access_permitted",
  "source_retention_permitted",
  "source_excerpt_permitted",
  "source_publication_permitted",
] as const;

const POLICY_KEYS = [
  "run_plan_id",
  "policy_role",
  "policy_version",
  "content_hash",
] as const;

const rowsFromResult = (value: unknown): unknown[] => {
  const result = exactOwnDataRecord(value, ["results", "success", "meta"]);
  if (result.success !== true || !Array.isArray(result.results))
    return fail("database_result_invalid");
  return result.results;
};

export const authorizePublicationRunPlanRows = async (input: {
  capabilityRows: readonly unknown[];
  headerRows: readonly unknown[];
  providerRows: readonly unknown[];
  policyRows: readonly unknown[];
  expectedRunPlanId: string;
  expectedPlanHash: string;
  expectedEnvironment: "preview" | "production";
  expectedCanonicalSchemaVersion: string;
  expectedPipelineContractVersion: string;
  scheduledAt: string;
}): Promise<AuthorizedPublicationRunPlanV1> => {
  if (!RUN_PLAN_ID_PATTERN.test(input.expectedRunPlanId))
    return fail("plan_invalid");
  sha256(input.expectedPlanHash, "plan_invalid");
  const expectedEnvironment = deploymentEnvironment(input.expectedEnvironment);
  const expectedCanonicalSchemaVersion = ascii(
    input.expectedCanonicalSchemaVersion,
    1,
    64,
    "plan_invalid",
  );
  const expectedPipelineContractVersion = ascii(
    input.expectedPipelineContractVersion,
    1,
    128,
    "plan_invalid",
  );
  const scheduledMs = scheduledMilliseconds(input.scheduledAt);

  if (input.capabilityRows.length !== 1)
    return fail("integrity_capability_missing");
  const capability = exactOwnDataRecord(input.capabilityRows[0], [
    "capability",
  ]);
  if (capability.capability !== RUN_PLAN_CAPABILITY_VERSION)
    return fail("integrity_capability_missing");
  if (input.headerRows.length === 0) return fail("plan_not_found");
  if (input.headerRows.length !== 1) return fail("database_result_invalid");
  const header = exactOwnDataRecord(
    input.headerRows[0],
    HEADER_KEYS,
  ) as HeaderRow;
  if (
    header.run_plan_id !== input.expectedRunPlanId ||
    header.contract_version !== RUN_PLAN_CONTRACT_VERSION ||
    (header.environment !== "preview" && header.environment !== "production") ||
    header.schedule_name !== LOGICAL_SCHEDULE_NAME ||
    header.schedule_expression !== SCHEDULE_EXPRESSION ||
    header.sealed_contract_version !== RUN_PLAN_CONTRACT_VERSION ||
    header.plan_hash !== input.expectedPlanHash ||
    header.sealed_plan_hash !== input.expectedPlanHash
  )
    return fail("plan_invalid");
  if (header.environment !== expectedEnvironment)
    return fail("environment_mismatch");

  const effectiveFromMs = dateMilliseconds(
    header.effective_from_ms,
    "plan_invalid",
  );
  const effectiveToMs = dateMilliseconds(
    header.effective_to_ms,
    "plan_invalid",
  );
  const createdAtMs = dateMilliseconds(header.created_at_ms, "plan_invalid");
  const sealedAtMs = dateMilliseconds(header.sealed_at_ms, "plan_invalid");
  const approvedAtMs = dateMilliseconds(
    header.approved_at_ms,
    "approval_invalid",
  );
  if (
    effectiveToMs <= effectiveFromMs ||
    createdAtMs > sealedAtMs ||
    sealedAtMs > approvedAtMs ||
    approvedAtMs > effectiveFromMs
  )
    return fail("approval_invalid");
  if (scheduledMs < effectiveFromMs || scheduledMs >= effectiveToMs)
    return fail("plan_not_effective");

  const providerCount = safeInteger(header.provider_count, "plan_invalid");
  if (
    providerCount < 1 ||
    providerCount > MAX_PROVIDERS ||
    header.sealed_provider_count !== providerCount ||
    header.sealed_policy_count !== POLICY_ROLES.length
  )
    return fail("plan_invalid");
  const providerScopeHash = sha256(header.provider_scope_hash, "plan_invalid");
  const policySetHash = sha256(header.policy_set_hash, "plan_invalid");
  if (
    header.sealed_provider_scope_hash !== providerScopeHash ||
    header.sealed_policy_set_hash !== policySetHash
  )
    return fail("plan_invalid");

  if (header.approver_roles_json !== APPROVER_ROLES_JSON)
    return fail("approval_invalid");
  const approvalArtifactPath = ascii(
    header.approval_artifact_path,
    28,
    512,
    "approval_invalid",
  );
  if (!approvalArtifactPath.startsWith("docs/compliance/run-plans/"))
    return fail("approval_invalid");
  if (["..", "?", "#", "@"].some((part) => approvalArtifactPath.includes(part)))
    return fail("approval_invalid");
  const approvalArtifactHash = sha256(
    header.approval_artifact_hash,
    "approval_invalid",
  );

  if (header.revocation_reason_code !== null) {
    if (
      typeof header.revocation_reason_code !== "string" ||
      !REVOCATION_REASON_CODES.some(
        (code) => code === header.revocation_reason_code,
      )
    )
      return fail("plan_invalid");
    const revokedAt = dateMilliseconds(
      header.revocation_effective_at_ms,
      "plan_invalid",
    );
    if (revokedAt < approvedAtMs) return fail("plan_invalid");
    if (revokedAt <= scheduledMs) return fail("plan_revoked");
  } else if (header.revocation_effective_at_ms !== null) {
    return fail("plan_invalid");
  }

  if (input.providerRows.length !== providerCount)
    return fail("provider_authority_invalid");
  const providers = input.providerRows.map((unknownRow, ordinal) => {
    const row = exactOwnDataRecord(unknownRow, PROVIDER_KEYS) as ProviderRow;
    const providerId = ascii(
      row.provider_id,
      40,
      40,
      "provider_authority_invalid",
    );
    if (
      row.run_plan_id !== input.expectedRunPlanId ||
      row.ordinal !== ordinal ||
      !PROVIDER_ID_PATTERN.test(providerId)
    )
      return fail("provider_authority_invalid");
    const rosterContentHash = sha256(
      row.roster_content_hash,
      "provider_authority_invalid",
    );
    const sourceRegisterArtifactHash = sha256(
      row.source_register_artifact_hash,
      "provider_authority_invalid",
    );
    if (
      row.actual_roster_content_hash !== rosterContentHash ||
      row.actual_source_artifact_hash !== sourceRegisterArtifactHash
    )
      return fail("provider_authority_invalid");
    const sourceReviewedAtMs = safeInteger(
      row.source_reviewed_at_ms,
      "source_authority_invalid",
    );
    const sourceNextReviewAtMs = safeInteger(
      row.source_next_review_at_ms,
      "source_authority_invalid",
    );
    if (
      row.source_approval_state !== "approved" ||
      row.source_access_permitted !== 1 ||
      row.source_retention_permitted !== 1 ||
      row.source_excerpt_permitted !== 1 ||
      row.source_publication_permitted !== 1 ||
      sourceReviewedAtMs > scheduledMs ||
      sourceNextReviewAtMs <= scheduledMs
    )
      return fail("source_authority_invalid");
    return Object.freeze({
      ordinal,
      providerId,
      adapterVersion: ascii(
        row.adapter_version,
        1,
        128,
        "provider_authority_invalid",
      ),
      rosterVersion: ascii(
        row.roster_version,
        1,
        128,
        "provider_authority_invalid",
      ),
      rosterContentHash,
      sourceRegisterVersion: ascii(
        row.source_register_version,
        1,
        128,
        "provider_authority_invalid",
      ),
      sourceRegisterArtifactHash,
      requestCeiling: safeInteger(
        row.request_ceiling,
        "provider_authority_invalid",
      ),
      byteCeiling: safeInteger(row.byte_ceiling, "provider_authority_invalid"),
      aiTokenCeiling: safeInteger(
        row.ai_token_ceiling,
        "provider_authority_invalid",
      ),
      browserMillisecondCeiling: safeInteger(
        row.browser_millisecond_ceiling,
        "provider_authority_invalid",
      ),
      elapsedMillisecondCeiling: safeInteger(
        row.elapsed_millisecond_ceiling,
        "provider_authority_invalid",
      ),
      costMicrousdCeiling: safeInteger(
        row.cost_microusd_ceiling,
        "provider_authority_invalid",
      ),
      retryPolicyHash: sha256(
        row.retry_policy_hash,
        "provider_authority_invalid",
      ),
    });
  });
  for (let index = 1; index < providers.length; index += 1) {
    if (
      (providers[index - 1]?.providerId ?? "") >=
      (providers[index]?.providerId ?? "")
    )
      return fail("provider_authority_invalid");
  }

  if (input.policyRows.length !== POLICY_ROLES.length)
    return fail("policy_authority_invalid");
  const policies = input.policyRows.map((unknownRow, index) => {
    const row = exactOwnDataRecord(unknownRow, POLICY_KEYS) as PolicyRow;
    const role = POLICY_ROLES[index];
    if (
      role === undefined ||
      row.run_plan_id !== input.expectedRunPlanId ||
      row.policy_role !== role
    )
      return fail("policy_authority_invalid");
    return Object.freeze({
      role,
      version: ascii(row.policy_version, 1, 128, "policy_authority_invalid"),
      contentHash: sha256(row.content_hash, "policy_authority_invalid"),
    });
  });

  const canonicalSchemaVersion = ascii(
    header.canonical_schema_version,
    1,
    64,
    "plan_invalid",
  );
  const pipelineContractVersion = ascii(
    header.pipeline_contract_version,
    1,
    128,
    "plan_invalid",
  );
  if (
    canonicalSchemaVersion !== expectedCanonicalSchemaVersion ||
    pipelineContractVersion !== expectedPipelineContractVersion
  )
    return fail("version_mismatch");
  const hashes = await hashPublicationRunPlan({
    runPlanId: input.expectedRunPlanId,
    environment: header.environment,
    effectiveFromMs,
    effectiveToMs,
    canonicalSchemaVersion,
    pipelineContractVersion,
    createdAtMs,
    providers,
    policies,
  });
  if (
    hashes.providerScopeHash !== providerScopeHash ||
    hashes.policySetHash !== policySetHash ||
    hashes.planHash !== input.expectedPlanHash
  )
    return fail("plan_hash_mismatch");

  return Object.freeze({
    contractVersion: RUN_PLAN_CONTRACT_VERSION,
    runPlanId: input.expectedRunPlanId,
    planHash: input.expectedPlanHash,
    environment: header.environment,
    scheduleName: LOGICAL_SCHEDULE_NAME,
    scheduleExpression: SCHEDULE_EXPRESSION,
    effectiveFrom: canonicalInstant(effectiveFromMs, "plan_invalid"),
    effectiveTo: canonicalInstant(effectiveToMs, "plan_invalid"),
    scheduledAt: input.scheduledAt,
    canonicalSchemaVersion,
    pipelineContractVersion,
    providerScopeHash,
    policySetHash,
    providers: Object.freeze(providers),
    policies: Object.freeze(policies),
    approval: Object.freeze({
      artifactPath: approvalArtifactPath,
      artifactHash: approvalArtifactHash,
      approvedAt: canonicalInstant(approvedAtMs, "approval_invalid"),
      approverRoles: Object.freeze([
        "legal_source_owner",
        "platform_owner",
        "product_owner",
      ] as const),
    }),
  });
};

export const resolveAuthorizedPublicationRunPlan = async (input: {
  database: D1Database;
  runPlanId: string;
  planHash: string;
  expectedEnvironment: "preview" | "production";
  expectedCanonicalSchemaVersion: string;
  expectedPipelineContractVersion: string;
  scheduledAt: string;
}): Promise<AuthorizedPublicationRunPlanV1> => {
  if (!RUN_PLAN_ID_PATTERN.test(input.runPlanId)) return fail("plan_invalid");
  sha256(input.planHash, "plan_invalid");
  deploymentEnvironment(input.expectedEnvironment);
  ascii(input.expectedCanonicalSchemaVersion, 1, 64, "plan_invalid");
  ascii(input.expectedPipelineContractVersion, 1, 128, "plan_invalid");
  scheduledMilliseconds(input.scheduledAt);
  let results: D1Result[];
  try {
    const session = input.database.withSession("first-primary");
    results = await session.batch([
      session.prepare(METADATA_SQL).bind(1),
      session.prepare(HEADER_SQL).bind(input.runPlanId, input.planHash),
      session.prepare(PROVIDERS_SQL).bind(input.runPlanId),
      session.prepare(POLICIES_SQL).bind(input.runPlanId),
    ]);
  } catch {
    return fail("database_result_invalid");
  }
  if (results.length !== 4) return fail("database_result_invalid");
  return authorizePublicationRunPlanRows({
    capabilityRows: rowsFromResult(results[0]),
    headerRows: rowsFromResult(results[1]),
    providerRows: rowsFromResult(results[2]),
    policyRows: rowsFromResult(results[3]),
    expectedRunPlanId: input.runPlanId,
    expectedPlanHash: input.planHash,
    expectedEnvironment: input.expectedEnvironment,
    expectedCanonicalSchemaVersion: input.expectedCanonicalSchemaVersion,
    expectedPipelineContractVersion: input.expectedPipelineContractVersion,
    scheduledAt: input.scheduledAt,
  });
};

export const PUBLICATION_RUN_PLAN_AUTHORITY_SQL = Object.freeze({
  metadata: METADATA_SQL,
  header: HEADER_SQL,
  providers: PROVIDERS_SQL,
  policies: POLICIES_SQL,
});
