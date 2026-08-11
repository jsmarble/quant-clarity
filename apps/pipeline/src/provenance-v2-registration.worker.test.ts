import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const DORMANT_TABLES = [
  "provenance_v2_source_owner_receipt",
  "provenance_v2_source_register_receipt",
  "provenance_v2_source_register_member",
  "provenance_v2_adapter_manifest_receipt",
  "provenance_v2_adapter_manifest_environment",
  "provenance_v2_adapter_manifest_credential",
  "provenance_v2_adapter_manifest_source",
  "provenance_v2_source_endpoint_registration",
  "provenance_v2_source_endpoint_request",
  "provenance_v2_source_endpoint_parameter",
  "provenance_v2_source_endpoint_parameter_enum",
  "provenance_v2_source_endpoint_allowed_header",
  "provenance_v2_source_endpoint_redirect_host",
  "provenance_v2_source_endpoint_content_type",
  "provenance_v2_field_path_vocabulary",
  "provenance_v2_source_endpoint_expected_field",
  "provenance_v2_source_endpoint_approval",
  "provenance_v2_source_endpoint_revocation",
  "provenance_v2_verifier_implementation",
  "provenance_v2_verifier_policy",
  "provenance_v2_verifier_policy_member",
  "provenance_v2_field_policy",
  "provenance_v2_field_policy_precedence_class",
  "provenance_v2_field_policy_precedence_edge",
  "provenance_v2_field_policy_endpoint_admission",
  "provenance_v2_authority_plan_registration_close",
  "provenance_v2_authority_plan_oracle_receipt",
  "provenance_v2_authority_plan_approval_intent",
  "provenance_v2_authority_plan_revocation",
] as const;

const FOUNDATION_BLOCKERS = [
  "provenance_v2_installation_identity_activation_blocked",
  "provenance_v2_authority_plan_activation_blocked",
  "provenance_v2_authority_plan_seal_activation_blocked",
  "provenance_v2_authority_plan_approval_activation_blocked",
  "provenance_v2_source_endpoint_activation_blocked",
  "provenance_v2_provider_bundle_activation_blocked",
  "provenance_v2_acquisition_permit_activation_blocked",
  "provenance_v2_admitted_response_activation_blocked",
] as const;

beforeAll(async () => {
  await applyD1Migrations(env.CANONICAL_DB, env.CANONICAL_MIGRATIONS);
});

describe("dormant provenance-v2 registration graph in workerd", () => {
  it("installs only the static successor capability", async () => {
    expect(
      await env.CANONICAL_DB.prepare(
        `SELECT capability, predecessor_capability, adapter_receipt_contract,
          endpoint_contract, field_policy_contract, verifier_policy_contract,
          root_contract
         FROM provenance_v2_registration_integrity_metadata
         WHERE singleton = 1`,
      ).first(),
    ).toEqual({
      capability: "fenced-provenance-v2-registration@1",
      predecessor_capability: "fenced-provenance-v2@1",
      adapter_receipt_contract: "provenance-v2-adapter-receipt@1",
      endpoint_contract: "provenance-v2-endpoint@1",
      field_policy_contract: "provenance-v2-field-policy@1",
      verifier_policy_contract: "provenance-v2-verifier-policy@1",
      root_contract: "provenance-v2-authority-root@1",
    });

    for (const table of DORMANT_TABLES) {
      expect(
        await env.CANONICAL_DB.prepare(
          `SELECT count(*) AS count FROM ${table}`,
        ).first(),
      ).toEqual({ count: 0 });
    }
  });

  it("keeps every new registration path unconditionally blocked", async () => {
    for (const table of DORMANT_TABLES) {
      await expect(
        env.CANONICAL_DB.prepare(`INSERT INTO ${table} DEFAULT VALUES`).run(),
      ).rejects.toThrow(/not activated/u);
    }
  });

  it("preserves every migration-0008 runtime blocker exactly as unconditional D1 guards", async () => {
    for (const triggerName of FOUNDATION_BLOCKERS) {
      const trigger = await env.CANONICAL_DB.prepare(
        `SELECT tbl_name, sql FROM sqlite_schema
         WHERE type = 'trigger' AND name = ?1`,
      )
        .bind(triggerName)
        .first<{ tbl_name: string; sql: string }>();

      if (trigger === null) throw new Error(`missing blocker ${triggerName}`);
      expect(trigger.sql).toContain(`BEFORE INSERT ON ${trigger.tbl_name}`);
      expect(trigger.sql).toContain("RAISE(ABORT");
      expect(trigger.sql).not.toContain("WHEN");
    }
  });

  it("retains the source-backed outcome blocker and has no foreign-key drift", async () => {
    const blocker = await env.CANONICAL_DB.prepare(
      `SELECT tbl_name, sql FROM sqlite_schema
       WHERE type = 'trigger'
         AND name = 'publication_roster_outcome_source_execution_blocked'`,
    ).first<{ tbl_name: string; sql: string }>();
    expect(blocker?.tbl_name).toBe("publication_roster_operational_outcome");
    expect(blocker?.sql).toContain(
      "source-backed outcomes require provenance-v2 authority",
    );

    expect(
      (await env.CANONICAL_DB.prepare("PRAGMA foreign_key_check").all())
        .results,
    ).toEqual([]);
  });
});
