import type { AdapterManifest } from "@quant-clarity/contracts";
import { describe, expect, it } from "vitest";

import {
  checkAcquisitionBudget,
  classifyDnsAnswers,
  classifyIpAddress,
  compileAcquisitionRequest,
  createUntrustedSourceEnvelope,
  decideCredentialInjection,
  decideManifestSourcePolicy,
  decideRedirect,
  hashVerifiedEvidence,
  prepareEvidence,
  validateSafeLocator,
  type EvidenceMetadata,
  type ManifestSourcePolicyInputs,
  type VerifiedRedactedEvidence,
} from "./index.js";

type Source = AdapterManifest["sources"][number];

const BASE_SOURCE: Source = {
  source_id: "catalog",
  scheme: "https",
  host: "api.example.test",
  path_template: "/v1/accounts/{account_id}/models",
  safe_locator_template: "/v1/accounts/redacted/models",
  parameters: [
    {
      name: "account_id",
      location: "path",
      value_type: "string",
      required: true,
      enum_values: [],
      pattern: "^[A-Za-z0-9_-]{1,32}$",
      maximum_length: 32,
    },
    {
      name: "page",
      location: "query",
      value_type: "integer",
      required: false,
      enum_values: [],
      pattern: "^[1-9][0-9]{0,2}$",
      maximum_length: 3,
    },
  ],
  method: "GET",
  authentication_class: "bearer",
  credential_handle: "EXAMPLE_TOKEN",
  credential_injection: "authorization_bearer",
  credential_header: "Authorization",
  allowed_headers: ["Accept", "Authorization"],
  source_type: "authenticated_catalog",
  pagination: "page",
  content_types: ["application/json"],
  compressed_byte_limit: 1_000,
  uncompressed_byte_limit: 4_000,
  timeout_ms: 1_000,
  redirect_limit: 2,
  redirect_hosts: ["cdn.example.test"],
  provider_rate_limit: "one per second",
  crawl_purpose: "structured provider facts",
  robots_policy: "not applicable",
  content_signals_policy: "not applicable",
  retention_permitted: true,
  publication_permitted: true,
  expected_precision_fields: [],
  expected_price_fields: [],
  browser_session_approved: false,
};

function manifestWith(source: Source = BASE_SOURCE): AdapterManifest {
  return {
    contract_version: "1.0.0",
    provider_id: "prv_e234a657-a08e-46e9-8bd6-d08dfb7a6079",
    adapter_version: `1.0.0+sha256.${"a".repeat(64)}`,
    enabled_environments: ["test"],
    source_policy_version: "policy-1",
    sources: [source],
    credential_handles: [
      { binding_name: "EXAMPLE_TOKEN", purpose: "read-only catalog" },
    ],
    roster_path: "fixtures/example/roster.json",
    roster_version: "1",
    roster_hash: `sha256:${"b".repeat(64)}`,
    parser_version: "parser-1",
    extraction_policy_version: null,
    budgets: {
      requests_per_run: 4,
      pages_per_source: 2,
      bytes_per_run: 4_000,
      duration_ms: 2_000,
      retry_attempts: 1,
      browser_sessions: 0,
      ai_tokens: 0,
      items_per_run: 100,
    },
    compliance_review: {
      register_path: "docs/compliance/sources/example.md",
      register_hash: `sha256:${"c".repeat(64)}`,
      reviewer_role: "test",
      reviewed_at: "2026-08-01T00:00:00.000Z",
      terms_version: "test",
      robots_version: "test",
      content_signals_version: "test",
      access_permitted: true,
      retention_permitted: true,
      publication_permitted: true,
      next_review_at: "2027-08-01T00:00:00.000Z",
    },
  };
}

function sourceWith(overrides: Partial<Source>): Source {
  return { ...BASE_SOURCE, ...overrides };
}

describe("closed acquisition request compilation (PIPE-013, PIPE-040)", () => {
  it("compiles a declared source with typed, encoded parameters and no caller URL", () => {
    const result = compileAcquisitionRequest(manifestWith(), "catalog", {
      account_id: "team_one",
      page: 2,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        sourceId: "catalog",
        url: "https://api.example.test/v1/accounts/team_one/models?page=2",
        safeLocator: "https://api.example.test/v1/accounts/redacted/models",
        origin: "https://api.example.test",
        method: "GET",
        redirectMode: "manual",
        credentialHandle: "EXAMPLE_TOKEN",
      },
    });
  });

  it.each([
    ["unknown source", "other", { account_id: "team" }],
    ["missing required parameter", "catalog", {}],
    [
      "unknown parameter",
      "catalog",
      { account_id: "team", url: "https://evil.test" },
    ],
    ["wrong type", "catalog", { account_id: "team", page: "1" }],
    ["pattern violation", "catalog", { account_id: "../metadata" }],
  ])("rejects %s", (_label, sourceId, parameters) => {
    expect(
      compileAcquisitionRequest(manifestWith(), sourceId, parameters).ok,
    ).toBe(false);
  });

  it("rejects a dot traversal segment even if a manifest pattern permits it", () => {
    const source = sourceWith({
      parameters: [
        { ...BASE_SOURCE.parameters[0]!, pattern: "^.{1,32}$" },
        BASE_SOURCE.parameters[1]!,
      ],
    });
    expect(
      compileAcquisitionRequest(manifestWith(source), "catalog", {
        account_id: "..",
      }).ok,
    ).toBe(false);
  });

  it.each([
    { host: "127.0.0.1" },
    { host: "2130706433" },
    { host: "0x7f000001" },
    { host: "Api.Example.Test" },
    { host: "api.example.test:443" },
    { host: "éxample.test" },
    { path_template: "/v1/%2e%2e/metadata" },
    { path_template: "/v1/../metadata" },
    { path_template: "//metadata.internal/path" },
    { path_template: "/v1/models#fragment" },
  ])("rejects an unsafe source declaration %#", (override) => {
    const result = compileAcquisitionRequest(
      manifestWith(sourceWith(override)),
      "catalog",
      { account_id: "team" },
    );
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate parameter declarations in the manifest", () => {
    const source = sourceWith({
      parameters: [BASE_SOURCE.parameters[0]!, BASE_SOURCE.parameters[0]!],
    });
    expect(
      compileAcquisitionRequest(manifestWith(source), "catalog", {
        account_id: "team",
      }).ok,
    ).toBe(false);
  });
});

describe("safe locators, redirects, and credentials (PIPE-018, SEC-004)", () => {
  it("accepts only the exact redacted safe-locator template", () => {
    expect(
      validateSafeLocator(
        BASE_SOURCE,
        "https://api.example.test/v1/accounts/redacted/models",
      ).ok,
    ).toBe(true);
    for (const locator of [
      "https://api.example.test:443/v1/accounts/redacted/models",
      "https://user@api.example.test/v1/accounts/redacted/models",
      "https://api.example.test/v1/accounts/private-account/models",
      "https://api.example.test/v1/accounts/redacted/models?account=private",
      "https://127.0.0.1/v1/accounts/redacted/models",
    ]) {
      expect(validateSafeLocator(BASE_SOURCE, locator).ok).toBe(false);
    }
  });

  it("revalidates an allowed manual hop and strips every credential-like header", () => {
    const result = decideRedirect(
      BASE_SOURCE,
      "https://api.example.test/v1/models",
      "https://cdn.example.test/v1/models?page=2",
      0,
      {
        Accept: "application/json",
        Authorization: "Bearer CREDENTIAL_CANARY_1234",
        Cookie: "session=COOKIE_CANARY_1234",
        "X-Api-Key": ["API", "KEY", "CANARY", "1234"].join("_"),
        "X-Other-Credential": "CUSTOM_SECRET_CANARY_1234",
      },
    );
    expect(result).toEqual({
      ok: true,
      value: {
        url: "https://cdn.example.test/v1/models?page=2",
        hop: 1,
        headers: { Accept: "application/json" },
        credentials: "stripped",
        redirectMode: "manual",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/CANARY/u);
  });

  it.each([
    ["scheme", "http://cdn.example.test/v1/models", 0, []],
    ["host", "https://evil.test/v1/models", 0, []],
    ["IP literal", "https://127.0.0.1/v1/models", 0, []],
    ["numeric host", "https://2130706433/v1/models", 0, []],
    ["userinfo", "https://user@cdn.example.test/v1/models", 0, []],
    ["explicit default port", "https://cdn.example.test:443/v1/models", 0, []],
    ["scheme-relative default port", "//cdn.example.test:443/v1/models", 0, []],
    [
      "case and whitespace port",
      "  HTTPS://cdn.example.test:443/v1/models  ",
      0,
      [],
    ],
    ["hop limit", "https://cdn.example.test/v1/models", 2, []],
    [
      "loop",
      "https://cdn.example.test/v1/models",
      0,
      ["https://cdn.example.test/v1/models"],
    ],
  ])("rejects a redirect for %s", (_label, location, hops, history) => {
    expect(
      decideRedirect(
        BASE_SOURCE,
        "https://api.example.test/v1/models",
        location,
        hops,
        { Authorization: "not-returned" },
        history,
      ).ok,
    ).toBe(false);
  });

  it("permits credential injection only at the exact declared origin", () => {
    expect(
      decideCredentialInjection(
        BASE_SOURCE,
        "https://api.example.test/v1/models",
      ),
    ).toEqual({ ok: true, value: "inject" });
    for (const target of [
      "https://cdn.example.test/v1/models",
      "https://api.example.test:443/v1/models",
      "https://api.example.test.evil.test/v1/models",
    ]) {
      expect(decideCredentialInjection(BASE_SOURCE, target).ok).toBe(false);
    }
  });
});

describe("DNS preflight result classification (SEC-004)", () => {
  it.each([
    ["8.8.8.8", "public"],
    ["0.0.0.0", "unspecified"],
    ["10.0.0.1", "private"],
    ["100.64.0.1", "reserved"],
    ["127.0.0.1", "loopback"],
    ["169.254.169.254", "metadata"],
    ["169.254.1.1", "link_local"],
    ["172.31.255.255", "private"],
    ["192.0.2.1", "reserved"],
    ["192.88.99.1", "reserved"],
    ["192.168.1.1", "private"],
    ["198.18.0.1", "reserved"],
    ["198.51.100.1", "reserved"],
    ["203.0.113.1", "reserved"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "reserved"],
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:169.254.169.254", "metadata"],
    ["fc00::1", "private"],
    ["fe80::1", "link_local"],
    ["ff02::1", "multicast"],
    ["64:ff9b:1::1", "reserved"],
    ["64:ff9b::7f00:1", "reserved"],
    ["64:ff9b::a9fe:a9fe", "reserved"],
    ["100::", "reserved"],
    ["2001:db8::1", "reserved"],
    ["2002::1", "reserved"],
    ["2606:4700:4700::1111", "public"],
    ["not-an-address", "invalid"],
    ["0177.0.0.1", "invalid"],
  ] as const)("classifies %s as %s", (address, expected) => {
    expect(classifyIpAddress(address)).toBe(expected);
  });

  it("fails closed for empty, malformed, or mixed DNS answers", () => {
    expect(classifyDnsAnswers([]).allowed).toBe(false);
    expect(classifyDnsAnswers(["not-an-address"]).allowed).toBe(false);
    expect(classifyDnsAnswers(["8.8.8.8", "127.0.0.1"]).allowed).toBe(false);
    expect(
      classifyDnsAnswers(["8.8.8.8", "2606:4700:4700::1111"]).allowed,
    ).toBe(true);
  });
});

describe("aggregate response budgets", () => {
  const budget = {
    allowedContentTypes: ["application/json"],
    compressedBytes: 100,
    uncompressedBytes: 200,
    timeoutMs: 1_000,
    pages: 2,
    requests: 3,
  } as const;

  it("accepts aggregate usage at every exact ceiling and a parameterized media type", () => {
    expect(
      checkAcquisitionBudget(
        budget,
        {
          compressedBytes: 100,
          uncompressedBytes: 200,
          elapsedMs: 1_000,
          pages: 2,
          requests: 3,
        },
        "application/json; charset=utf-8",
      ).ok,
    ).toBe(true);
  });

  it.each([
    ["content type", {}, "text/html"],
    ["compressed", { compressedBytes: 101 }, "application/json"],
    ["decompressed", { uncompressedBytes: 201 }, "application/json"],
    ["timeout", { elapsedMs: 1_001 }, "application/json"],
    ["pages", { pages: 3 }, "application/json"],
    ["requests", { requests: 4 }, "application/json"],
  ])("fails closed when %s exceeds policy", (_label, override, mediaType) => {
    expect(
      checkAcquisitionBudget(
        budget,
        {
          compressedBytes: 100,
          uncompressedBytes: 200,
          elapsedMs: 1_000,
          pages: 2,
          requests: 3,
          ...override,
        },
        mediaType,
      ).ok,
    ).toBe(false);
  });
});

describe("robots, Content Signals, and browser policy (PIPE-016)", () => {
  const staticManifest = manifestWith(
    sourceWith({ source_type: "public_static_page" }),
  );
  const allowed = {
    environment: "test",
    asOf: "2026-08-01T00:00:00.000Z",
    robots: "allow",
    contentSignals: "allow",
    renderingRequested: false,
  } as const;

  function isAllowed(
    manifest: AdapterManifest,
    inputs: ManifestSourcePolicyInputs,
  ): boolean {
    const result = decideManifestSourcePolicy(manifest, "catalog", inputs);
    return result.ok && result.value.allowed;
  }

  it("allows only complete affirmative page policy inputs", () => {
    expect(isAllowed(staticManifest, allowed)).toBe(true);
  });

  it.each(["deny", "ambiguous", "retrieval_failed", "not_applicable"] as const)(
    "fails closed for robots state %s",
    (robots) => {
      expect(isAllowed(staticManifest, { ...allowed, robots })).toBe(false);
    },
  );

  it.each(["deny", "ambiguous", "retrieval_failed", "not_applicable"] as const)(
    "fails closed for Content Signals state %s",
    (contentSignals) => {
      expect(isAllowed(staticManifest, { ...allowed, contentSignals })).toBe(
        false,
      );
    },
  );

  it("requires approved browser execution exactly when rendered acquisition is required", () => {
    const rendered = manifestWith(
      sourceWith({
        source_type: "public_rendered_page",
        browser_session_approved: true,
      }),
    );
    expect(isAllowed(rendered, allowed)).toBe(false);
    expect(isAllowed(rendered, { ...allowed, renderingRequested: true })).toBe(
      true,
    );
    expect(
      isAllowed(staticManifest, { ...allowed, renderingRequested: true }),
    ).toBe(false);
  });

  it("derives legal permission from the manifest and fails closed", () => {
    const unapproved = {
      ...staticManifest,
      compliance_review: {
        ...staticManifest.compliance_review,
        access_permitted: false,
      },
    };
    expect(isAllowed(unapproved, allowed)).toBe(false);
    expect(
      isAllowed(staticManifest, { ...allowed, environment: "production" }),
    ).toBe(false);
    expect(
      isAllowed(staticManifest, {
        ...allowed,
        asOf: "2028-08-01T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(isAllowed(staticManifest, { ...allowed, asOf: "not-a-time" })).toBe(
      false,
    );
    expect(
      isAllowed(staticManifest, {
        ...allowed,
        asOf: staticManifest.compliance_review.next_review_at,
      }),
    ).toBe(false);
    const offsetReview = {
      ...staticManifest,
      compliance_review: {
        ...staticManifest.compliance_review,
        reviewed_at: "2026-08-01T01:00:00+01:00",
        next_review_at: "2027-08-01T01:00:00+01:00",
      },
    };
    expect(isAllowed(offsetReview, allowed)).toBe(true);
    expect(
      isAllowed(
        {
          ...staticManifest,
          compliance_review: {
            ...staticManifest.compliance_review,
            reviewed_at: "2026-08-01T00:00:01.000Z",
          },
        },
        allowed,
      ),
    ).toBe(false);
  });
});

describe("pre-retention evidence minimization and DLP (DATA-063, PIPE-018, PIPE-031)", () => {
  const metadata: EvidenceMetadata = {
    envelopeVersion: "evidence-envelope-1",
    sourceId: "catalog",
    observationId: "obs_c54f90e2-c507-44ca-959a-5f76d011ef28",
    observedAt: "2026-08-01T00:00:00.000Z",
    extractionVersion: "parser-1",
  };
  const canaries = [
    "CREDENTIAL_CANARY_1234",
    "COOKIE_CANARY_1234",
    "ACCOUNT_CANARY_1234",
    "person-canary@example.test",
  ] as const;
  const policy = {
    maximumInputBytes: 4_096,
    maximumSpans: 4,
    maximumExcerptBytes: 2_048,
    maximumRedactions: 20,
    forbiddenCanaries: canaries,
  } as const;
  const locator = "https://api.example.test/v1/accounts/redacted/models";

  it("minimizes, redacts configured canaries, and exposes only a branded sanitized result", async () => {
    const unrelated = "UNRELATED_SOURCE_CONTENT";
    const relevant = [
      "precision=FP16",
      "Bearer CREDENTIAL_CANARY_1234",
      "Cookie: session=COOKIE_CANARY_1234",
      "account=ACCOUNT_CANARY_1234",
      "owner=person-canary@example.test",
    ].join(" ");
    const input = `${unrelated}\n${relevant}`;
    const result = prepareEvidence(
      BASE_SOURCE,
      input,
      [{ start: unrelated.length + 1, end: input.length }],
      locator,
      metadata,
      policy,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.redactedText).toContain("precision=FP16");
    expect(result.value.redactedText).not.toContain(unrelated);
    for (const canary of canaries) {
      expect(JSON.stringify(result.value)).not.toContain(canary);
    }
    const envelope = createUntrustedSourceEnvelope(result.value);
    expect(envelope.handling).toBe("untrusted_source_data_not_instructions");
    for (const canary of canaries)
      expect(JSON.stringify(envelope)).not.toContain(canary);
    await expect(hashVerifiedEvidence(result.value)).resolves.toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
  });

  it("hashes the redacted bytes together with a versioned canonical metadata envelope", async () => {
    const first = prepareEvidence(
      BASE_SOURCE,
      "precision=FP16",
      [{ start: 0, end: 14 }],
      locator,
      metadata,
      policy,
    );
    const second = prepareEvidence(
      BASE_SOURCE,
      "precision=FP16",
      [{ start: 0, end: 14 }],
      locator,
      {
        ...metadata,
        observationId: "obs_12e96ec2-3e17-4b37-82b3-dd3498545f0e",
      },
      policy,
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.canonicalMetadata).toContain(
      '"envelope_version":"evidence-envelope-1"',
    );
    expect(await hashVerifiedEvidence(first.value)).not.toBe(
      await hashVerifiedEvidence(second.value),
    );
  });

  it("fails closed before producing hashable evidence for invalid bounds, metadata, locator, or canary policy", () => {
    const cases = [
      prepareEvidence(BASE_SOURCE, "abc", [], locator, metadata, policy),
      prepareEvidence(
        BASE_SOURCE,
        "abc",
        [{ start: 0, end: 4 }],
        locator,
        metadata,
        policy,
      ),
      prepareEvidence(
        BASE_SOURCE,
        "abc",
        [{ start: 0, end: 3 }],
        `${locator}?account=ACCOUNT_CANARY_1234`,
        metadata,
        policy,
      ),
      prepareEvidence(
        BASE_SOURCE,
        "abc",
        [{ start: 0, end: 3 }],
        locator,
        { ...metadata, observedAt: "not-a-time" },
        policy,
      ),
      prepareEvidence(
        BASE_SOURCE,
        "abc",
        [{ start: 0, end: 3 }],
        locator,
        {
          ...metadata,
          observationId: "obs_00000000-0000-1000-8000-000000000001",
        },
        policy,
      ),
      prepareEvidence(
        BASE_SOURCE,
        "abc",
        [{ start: 0, end: 3 }],
        locator,
        metadata,
        { ...policy, forbiddenCanaries: [] },
      ),
    ];
    for (const result of cases) {
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/ACCOUNT_CANARY_1234/u);
    }
  });

  it("rejects forged TypeScript and JavaScript evidence objects at every sink", async () => {
    const forged = {
      safeLocator: "https://evil.test/ACCOUNT_CANARY_1234",
      canonicalMetadata: "ACCOUNT_CANARY_1234",
      redactedText: "Bearer CREDENTIAL_CANARY_1234",
      byteLength: 30,
    } as unknown as VerifiedRedactedEvidence;
    const hashFailure = await hashVerifiedEvidence(forged).catch(
      (error: unknown) => error,
    );
    expect(hashFailure).toBeInstanceOf(TypeError);
    expect(JSON.stringify(hashFailure)).not.toMatch(/CANARY/u);
    expect(() => createUntrustedSourceEnvelope(forged)).toThrow(
      "evidence was not produced by prepareEvidence",
    );
    let envelopeFailure: unknown;
    try {
      createUntrustedSourceEnvelope(forged);
    } catch (error) {
      envelopeFailure = error;
    }
    expect(JSON.stringify(envelopeFailure)).not.toMatch(/CANARY/u);
  });
});
