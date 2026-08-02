import type { AdapterManifest } from "@quant-clarity/contracts";

export type AcquisitionErrorCode =
  | "budget_exceeded"
  | "closed_parameter_violation"
  | "credential_or_pii_detected"
  | "destination_rejected"
  | "invalid_dns_answer"
  | "policy_denied"
  | "redaction_failed"
  | "safe_locator_rejected"
  | "source_not_declared";

export type AcquisitionResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: AcquisitionErrorCode;
        readonly reason: string;
      };
    };

type AdapterSource = AdapterManifest["sources"][number];

function accept<T>(value: T): AcquisitionResult<T> {
  return { ok: true, value };
}

function reject<T>(
  code: AcquisitionErrorCode,
  reason: string,
): AcquisitionResult<T> {
  return { ok: false, error: { code, reason } };
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

function normalizeMediaType(value: string): string | null {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType !== undefined &&
    /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mediaType)
    ? mediaType
    : null;
}

function parseIpv4(value: string): readonly number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)) return null;
  const octets = value.split(".").map(Number);
  if (
    octets.some((octet) => !Number.isInteger(octet) || octet > 255) ||
    value.split(".").some((octet) => octet.length > 1 && octet.startsWith("0"))
  )
    return null;
  return octets;
}

function parseIpv6(value: string): readonly number[] | null {
  const input = value.toLowerCase();
  if (!/^[0-9a-f:.]+$/u.test(input) || input.includes(":::")) return null;
  const doubleColon = input.indexOf("::");
  if (doubleColon !== -1 && input.slice(doubleColon + 2).includes("::"))
    return null;

  let normalized = input;
  const ipv4Start = input.lastIndexOf(":");
  if (input.includes(".")) {
    if (ipv4Start === -1) return null;
    const ipv4 = parseIpv4(input.slice(ipv4Start + 1));
    if (ipv4 === null) return null;
    const high = ((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0);
    const low = ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0);
    normalized = `${input.slice(0, ipv4Start)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const parts = normalized.split("::");
  const left = parts[0] === "" ? [] : (parts[0]?.split(":") ?? []);
  const right =
    parts.length < 2 || parts[1] === "" ? [] : (parts[1]?.split(":") ?? []);
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/u.test(part)))
    return null;
  const omitted = 8 - left.length - right.length;
  if (
    (parts.length === 1 && omitted !== 0) ||
    (parts.length === 2 && omitted < 1)
  )
    return null;
  return [
    ...left.map((part) => Number.parseInt(part, 16)),
    ...Array.from({ length: omitted }, () => 0),
    ...right.map((part) => Number.parseInt(part, 16)),
  ];
}

export type IpAddressClass =
  | "invalid"
  | "link_local"
  | "loopback"
  | "metadata"
  | "multicast"
  | "private"
  | "public"
  | "reserved"
  | "unspecified";

/** Classifies canonical DNS answer text. It does not perform or pin DNS. */
export function classifyIpAddress(value: string): IpAddressClass {
  const ipv4 = parseIpv4(value);
  if (ipv4 !== null) {
    const [a = 0, b = 0, c = 0, d = 0] = ipv4;
    if (a === 169 && b === 254 && c === 169 && d === 254) return "metadata";
    if (a === 0)
      return b === 0 && c === 0 && d === 0 ? "unspecified" : "reserved";
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
      return "private";
    if (a === 127) return "loopback";
    if (a === 169 && b === 254) return "link_local";
    if (a >= 224 && a <= 239) return "multicast";
    if (
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 240
    )
      return "reserved";
    return "public";
  }

  const ipv6 = parseIpv6(value);
  if (ipv6 === null) return "invalid";
  const [
    first = 0,
    second = 0,
    third = 0,
    fourth = 0,
    fifth = 0,
    sixth = 0,
    seventh = 0,
  ] = ipv6;
  if (ipv6.every((part) => part === 0)) return "unspecified";
  if (ipv6.slice(0, 7).every((part) => part === 0) && ipv6[7] === 1)
    return "loopback";
  if (
    first === 0 &&
    second === 0 &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    (sixth === 0 || sixth === 0xffff)
  ) {
    return classifyIpAddress(
      [
        seventh >> 8,
        seventh & 255,
        (ipv6[7] ?? 0) >> 8,
        (ipv6[7] ?? 0) & 255,
      ].join("."),
    );
  }
  if ((first & 0xfe00) === 0xfc00) return "private";
  if ((first & 0xffc0) === 0xfe80) return "link_local";
  if ((first & 0xff00) === 0xff00) return "multicast";
  if (
    first === 0x0064 &&
    second === 0xff9b &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    sixth === 0
  )
    return "reserved";
  if (first === 0x0064 && second === 0xff9b && third === 1) return "reserved";
  if (first === 0x0100 && ipv6.slice(1).every((part) => part === 0))
    return "reserved";
  if (first === 0x2001 && second <= 0x01ff) return "reserved";
  if (first === 0x2001 && second === 0x0db8) return "reserved";
  if (first === 0x2002 || first === 0x3fff || first === 0x5f00)
    return "reserved";
  if ((first & 0xe000) !== 0x2000) return "reserved";
  return "public";
}

export interface DnsPreflightDecision {
  readonly allowed: boolean;
  readonly classifications: readonly IpAddressClass[];
  readonly reason: string;
}

/** Fail-closed evaluation of results supplied by the runtime's DNS preflight. */
export function classifyDnsAnswers(
  answers: readonly string[],
): DnsPreflightDecision {
  const classifications = answers.map(classifyIpAddress);
  if (answers.length === 0)
    return {
      allowed: false,
      classifications,
      reason: "DNS returned no addresses",
    };
  const rejectedIndex = classifications.findIndex(
    (value) => value !== "public",
  );
  if (rejectedIndex !== -1)
    return {
      allowed: false,
      classifications,
      reason: `DNS answer ${String(rejectedIndex)} is ${String(classifications[rejectedIndex])}`,
    };
  return {
    allowed: true,
    classifications,
    reason: "all DNS answers are public",
  };
}

function validateHostname(hostname: string): string | null {
  if (!isAscii(hostname) || hostname !== hostname.toLowerCase())
    return "host must be lower-case ASCII";
  if (classifyIpAddress(hostname) !== "invalid")
    return "IP literals are prohibited";
  try {
    const parsed = new URL(`https://${hostname}/`);
    if (parsed.hostname !== hostname || parsed.host !== hostname)
      return "host is not in canonical form";
  } catch {
    return "host is invalid";
  }
  return null;
}

function hasExplicitAuthorityPort(value: string): boolean {
  const authority = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)/iu.exec(
    value.trim(),
  )?.[1];
  if (authority === undefined) return false;
  const withoutUserinfo = authority.slice(authority.lastIndexOf("@") + 1);
  return withoutUserinfo.startsWith("[")
    ? /^\[[^\]]+\]:/u.test(withoutUserinfo)
    : withoutUserinfo.includes(":");
}

function hasUnsafeRawUrlWhitespace(value: string): boolean {
  if (value !== value.trim()) return true;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function validateSourceDeclaration(source: AdapterSource): string | null {
  if (
    source.path_template.startsWith("//") ||
    /[\\?#@]/u.test(source.path_template) ||
    /%(?:2e|2f|5c)/iu.test(source.path_template) ||
    /(?:^|\/)\.{1,2}(?:\/|$)/u.test(source.path_template)
  )
    return "source path template is unsafe";
  const names = source.parameters.map((parameter) => parameter.name);
  if (new Set(names).size !== names.length)
    return "source parameter declarations are not unique";
  return validateHostname(source.host);
}

function validateExactDestination(
  target: URL,
  allowedHosts: ReadonlySet<string>,
): string | null {
  if (target.protocol !== "https:") return "scheme must be HTTPS";
  if (target.username !== "" || target.password !== "")
    return "userinfo is prohibited";
  if (target.port !== "") return "non-default or explicit ports are prohibited";
  const hostError = validateHostname(target.hostname);
  if (hostError !== null) return hostError;
  if (!allowedHosts.has(target.hostname))
    return "host is not exactly allowlisted";
  return null;
}

function renderParameter(
  parameter: AdapterSource["parameters"][number],
  value: unknown,
): AcquisitionResult<string> {
  let rendered: string;
  if (parameter.value_type === "string" && typeof value === "string")
    rendered = value;
  else if (
    parameter.value_type === "integer" &&
    typeof value === "number" &&
    Number.isSafeInteger(value)
  )
    rendered = String(value);
  else if (parameter.value_type === "boolean" && typeof value === "boolean")
    rendered = String(value);
  else
    return reject(
      "closed_parameter_violation",
      `parameter ${parameter.name} has the wrong type`,
    );

  if (
    parameter.maximum_length !== null &&
    rendered.length > parameter.maximum_length
  )
    return reject(
      "closed_parameter_violation",
      `parameter ${parameter.name} exceeds its maximum length`,
    );
  if (
    parameter.enum_values.length > 0 &&
    !parameter.enum_values.includes(rendered)
  )
    return reject(
      "closed_parameter_violation",
      `parameter ${parameter.name} is outside its closed enum`,
    );
  if (parameter.pattern !== null) {
    try {
      if (!new RegExp(parameter.pattern, "u").test(rendered))
        return reject(
          "closed_parameter_violation",
          `parameter ${parameter.name} does not match its declared pattern`,
        );
    } catch {
      return reject(
        "closed_parameter_violation",
        `parameter ${parameter.name} has an invalid declared pattern`,
      );
    }
  }
  return accept(rendered);
}

export interface CompiledAcquisitionRequest {
  readonly sourceId: string;
  readonly url: string;
  readonly safeLocator: string;
  readonly origin: string;
  readonly method: "GET";
  readonly redirectMode: "manual";
  readonly credentialHandle: string | null;
}

/** PIPE-013: compiles only a manifest source identifier plus closed parameters. */
export function compileAcquisitionRequest(
  manifest: AdapterManifest,
  sourceId: string,
  suppliedParameters: Readonly<Record<string, unknown>>,
): AcquisitionResult<CompiledAcquisitionRequest> {
  const source = manifest.sources.find(
    (candidate) => candidate.source_id === sourceId,
  );
  if (source === undefined)
    return reject("source_not_declared", "source identifier is not declared");
  const declarationError = validateSourceDeclaration(source);
  if (declarationError !== null)
    return reject("destination_rejected", declarationError);

  const declaredNames = new Set(
    source.parameters.map((parameter) => parameter.name),
  );
  const extra = Object.keys(suppliedParameters).find(
    (name) => !declaredNames.has(name),
  );
  if (extra !== undefined)
    return reject(
      "closed_parameter_violation",
      `parameter ${extra} is not declared`,
    );

  let path = source.path_template;
  const query = new URLSearchParams();
  for (const parameter of source.parameters) {
    const value = suppliedParameters[parameter.name];
    if (value === undefined) {
      if (parameter.required)
        return reject(
          "closed_parameter_violation",
          `required parameter ${parameter.name} is missing`,
        );
      continue;
    }
    const rendered = renderParameter(parameter, value);
    if (!rendered.ok) return rendered;
    if (
      parameter.location === "path" &&
      (rendered.value === "." || rendered.value === "..")
    )
      return reject(
        "closed_parameter_violation",
        `parameter ${parameter.name} is a traversal segment`,
      );
    if (parameter.location === "path")
      path = path.replaceAll(
        `{${parameter.name}}`,
        encodeURIComponent(rendered.value),
      );
    else query.append(parameter.name, rendered.value);
  }
  if (/[{}]/u.test(path))
    return reject(
      "closed_parameter_violation",
      "path contains an unresolved parameter",
    );

  const target = new URL(`https://${source.host}${path}`);
  query.forEach((value, name) => {
    target.searchParams.append(name, value);
  });
  const targetError = validateExactDestination(target, new Set([source.host]));
  if (targetError !== null) return reject("destination_rejected", targetError);
  if (target.href.length > 2048)
    return reject(
      "destination_rejected",
      "compiled URL exceeds 2048 characters",
    );
  const safeLocator = `https://${source.host}${source.safe_locator_template}`;
  const safeResult = validateSafeLocator(source, safeLocator);
  if (!safeResult.ok) return safeResult;

  return accept({
    sourceId,
    url: target.href,
    safeLocator,
    origin: target.origin,
    method: "GET",
    redirectMode: "manual",
    credentialHandle: source.credential_handle,
  });
}

export function validateSafeLocator(
  source: AdapterSource,
  locator: string,
): AcquisitionResult<string> {
  if (hasUnsafeRawUrlWhitespace(locator) || hasExplicitAuthorityPort(locator))
    return reject(
      "safe_locator_rejected",
      "safe locator cannot contain an explicit port",
    );
  let parsed: URL;
  try {
    parsed = new URL(locator);
  } catch {
    return reject("safe_locator_rejected", "safe locator is not a URL");
  }
  const destinationError = validateExactDestination(
    parsed,
    new Set([source.host]),
  );
  if (destinationError !== null)
    return reject("safe_locator_rejected", destinationError);
  if (parsed.search !== "" || parsed.hash !== "")
    return reject(
      "safe_locator_rejected",
      "safe locator cannot contain query or fragment",
    );
  if (parsed.pathname !== source.safe_locator_template)
    return reject(
      "safe_locator_rejected",
      "safe locator does not match its redacted template",
    );
  return accept(locator);
}

const ALWAYS_STRIPPED_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
]);

function stripCredentialHeaders(
  headers: Readonly<Record<string, string>>,
  declaredCredentialHeader: string | null,
): Readonly<Record<string, string>> {
  const declared = declaredCredentialHeader?.toLowerCase() ?? null;
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => {
      const lower = name.toLowerCase();
      return lower !== declared && !ALWAYS_STRIPPED_HEADERS.has(lower);
    }),
  );
}

const SAFE_REDIRECT_HEADERS = new Set(["accept"]);

function buildRedirectHeaders(
  source: AdapterSource,
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const manifestAllowed = new Set(
    source.allowed_headers.map((header) => header.toLowerCase()),
  );
  const stripped = stripCredentialHeaders(headers, source.credential_header);
  return Object.fromEntries(
    Object.entries(stripped).filter(([name]) => {
      const lower = name.toLowerCase();
      return manifestAllowed.has(lower) && SAFE_REDIRECT_HEADERS.has(lower);
    }),
  );
}

export interface RedirectDecision {
  readonly url: string;
  readonly hop: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly credentials: "stripped";
  readonly redirectMode: "manual";
}

export function decideCredentialInjection(
  source: AdapterSource,
  targetUrl: string,
): AcquisitionResult<"inject" | "omit"> {
  if (
    hasUnsafeRawUrlWhitespace(targetUrl) ||
    hasExplicitAuthorityPort(targetUrl)
  )
    return reject(
      "destination_rejected",
      "credential target has an explicit port",
    );
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return reject("destination_rejected", "credential target URL is invalid");
  }
  const targetError = validateExactDestination(target, new Set([source.host]));
  if (targetError !== null) return reject("destination_rejected", targetError);
  if (target.origin !== `https://${source.host}`)
    return reject("destination_rejected", "credential origin is not exact");
  return accept(source.credential_handle === null ? "omit" : "inject");
}

/** Revalidates one manually observed redirect and strips credentials on every hop. */
export function decideRedirect(
  source: AdapterSource,
  currentUrl: string,
  location: string,
  completedHops: number,
  headers: Readonly<Record<string, string>>,
  visitedUrls: readonly string[] = [currentUrl],
): AcquisitionResult<RedirectDecision> {
  if (!Number.isSafeInteger(completedHops) || completedHops < 0)
    return reject("destination_rejected", "redirect hop count is invalid");
  if (completedHops >= source.redirect_limit)
    return reject("budget_exceeded", "redirect limit exceeded");
  let current: URL;
  let target: URL;
  if (
    hasUnsafeRawUrlWhitespace(currentUrl) ||
    hasUnsafeRawUrlWhitespace(location) ||
    hasExplicitAuthorityPort(currentUrl) ||
    hasExplicitAuthorityPort(location)
  )
    return reject("destination_rejected", "redirect URL has an explicit port");
  try {
    current = new URL(currentUrl);
    target = new URL(location, current);
  } catch {
    return reject("destination_rejected", "redirect URL is invalid");
  }
  const currentError = validateExactDestination(
    current,
    new Set([source.host, ...source.redirect_hosts]),
  );
  if (currentError !== null)
    return reject("destination_rejected", currentError);
  const targetError = validateExactDestination(
    target,
    new Set([source.host, ...source.redirect_hosts]),
  );
  if (targetError !== null) return reject("destination_rejected", targetError);
  let normalizedVisited: ReadonlySet<string>;
  try {
    normalizedVisited = new Set(
      visitedUrls.map((visited) => {
        if (
          hasUnsafeRawUrlWhitespace(visited) ||
          hasExplicitAuthorityPort(visited)
        )
          throw new Error("invalid redirect history");
        return new URL(visited).href;
      }),
    );
  } catch {
    return reject("destination_rejected", "redirect history is invalid");
  }
  if (normalizedVisited.has(target.href))
    return reject("destination_rejected", "redirect loop detected");
  return accept({
    url: target.href,
    hop: completedHops + 1,
    headers: buildRedirectHeaders(source, headers),
    credentials: "stripped",
    redirectMode: "manual",
  });
}

export interface AcquisitionBudget {
  readonly allowedContentTypes: readonly string[];
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly timeoutMs: number;
  readonly pages: number;
  readonly requests: number;
}

export interface AcquisitionUsage {
  readonly compressedBytes: number;
  readonly uncompressedBytes: number;
  readonly elapsedMs: number;
  readonly pages: number;
  readonly requests: number;
}

export function checkAcquisitionBudget(
  budget: AcquisitionBudget,
  usage: AcquisitionUsage,
  contentType: string,
): AcquisitionResult<AcquisitionUsage> {
  const mediaType = normalizeMediaType(contentType);
  const allowed = budget.allowedContentTypes.map(normalizeMediaType);
  if (mediaType === null || !allowed.includes(mediaType))
    return reject(
      "budget_exceeded",
      "response content type is not allowlisted",
    );
  const numericValues = [
    budget.compressedBytes,
    budget.uncompressedBytes,
    budget.timeoutMs,
    budget.pages,
    budget.requests,
    usage.compressedBytes,
    usage.uncompressedBytes,
    usage.elapsedMs,
    usage.pages,
    usage.requests,
  ];
  if (numericValues.some((value) => !Number.isSafeInteger(value) || value < 0))
    return reject("budget_exceeded", "budget or usage is invalid");
  if (usage.compressedBytes > budget.compressedBytes)
    return reject("budget_exceeded", "compressed byte limit exceeded");
  if (usage.uncompressedBytes > budget.uncompressedBytes)
    return reject("budget_exceeded", "uncompressed byte limit exceeded");
  if (usage.elapsedMs > budget.timeoutMs)
    return reject("budget_exceeded", "time limit exceeded");
  if (usage.pages > budget.pages)
    return reject("budget_exceeded", "page limit exceeded");
  if (usage.requests > budget.requests)
    return reject("budget_exceeded", "request limit exceeded");
  return accept(usage);
}

export type SourcePolicyState =
  "allow" | "deny" | "ambiguous" | "retrieval_failed" | "not_applicable";

interface SourcePolicyInputs {
  readonly sourceType: AdapterSource["source_type"];
  readonly termsAccessPermitted: boolean;
  readonly robots: SourcePolicyState;
  readonly contentSignals: SourcePolicyState;
  readonly renderingRequested: boolean;
  readonly renderingRequired: boolean;
  readonly browserSessionApproved: boolean;
  readonly declaredCrawlPurpose: string;
}

export interface SourcePolicyDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

/** PIPE-016: deterministic, fail-closed inputs; retrieval and policy parsing live elsewhere. */
function decideSourcePolicy(inputs: SourcePolicyInputs): SourcePolicyDecision {
  if (!inputs.termsAccessPermitted)
    return {
      allowed: false,
      reason: "source terms/access review does not permit retrieval",
    };
  if (inputs.declaredCrawlPurpose.trim() === "")
    return { allowed: false, reason: "crawl purpose is missing" };
  if (inputs.renderingRequested && !inputs.renderingRequired)
    return { allowed: false, reason: "browser rendering is not required" };
  if (inputs.renderingRequested && !inputs.browserSessionApproved)
    return { allowed: false, reason: "browser session is not approved" };
  if (
    inputs.sourceType === "public_rendered_page" &&
    !inputs.renderingRequested
  )
    return {
      allowed: false,
      reason: "required browser rendering was not requested",
    };
  const pageSource =
    inputs.sourceType === "public_static_page" ||
    inputs.sourceType === "public_rendered_page";
  const requiredPolicies: readonly [string, SourcePolicyState][] = [
    ["robots", inputs.robots],
    ["Content Signals", inputs.contentSignals],
  ];
  for (const [name, state] of requiredPolicies) {
    if (state === "allow") continue;
    if (!pageSource && state === "not_applicable") continue;
    return { allowed: false, reason: `${name} policy is ${state}` };
  }
  return {
    allowed: true,
    reason: "all declared source policies allow acquisition",
  };
}

export interface ManifestSourcePolicyInputs {
  readonly environment: AdapterManifest["enabled_environments"][number];
  readonly asOf: string;
  readonly robots: SourcePolicyState;
  readonly contentSignals: SourcePolicyState;
  readonly renderingRequested: boolean;
}

function parseRfc3339Instant(value: string): number | null {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    )
  )
    return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

/**
 * Derives authorization and browser constraints from the reviewed manifest;
 * callers can supply parser outcomes but cannot supply permission booleans.
 */
export function decideManifestSourcePolicy(
  manifest: AdapterManifest,
  sourceId: string,
  inputs: ManifestSourcePolicyInputs,
): AcquisitionResult<SourcePolicyDecision> {
  const source = manifest.sources.find(
    (candidate) => candidate.source_id === sourceId,
  );
  if (source === undefined)
    return reject("source_not_declared", "source identifier is not declared");
  const asOf = parseRfc3339Instant(inputs.asOf);
  const reviewedAt = parseRfc3339Instant(
    manifest.compliance_review.reviewed_at,
  );
  const nextReviewAt = parseRfc3339Instant(
    manifest.compliance_review.next_review_at,
  );
  const compliancePermitsAcquisition =
    manifest.enabled_environments.includes(inputs.environment) &&
    asOf !== null &&
    reviewedAt !== null &&
    nextReviewAt !== null &&
    reviewedAt <= asOf &&
    asOf < nextReviewAt &&
    manifest.compliance_review.access_permitted &&
    manifest.compliance_review.retention_permitted &&
    manifest.compliance_review.publication_permitted &&
    source.retention_permitted &&
    source.publication_permitted;
  return accept(
    decideSourcePolicy({
      sourceType: source.source_type,
      termsAccessPermitted: compliancePermitsAcquisition,
      robots: inputs.robots,
      contentSignals: inputs.contentSignals,
      renderingRequested: inputs.renderingRequested,
      renderingRequired: source.source_type === "public_rendered_page",
      browserSessionApproved: source.browser_session_approved,
      declaredCrawlPurpose: source.crawl_purpose,
    }),
  );
}

const EVIDENCE_BRAND: unique symbol = Symbol("verified-redacted-evidence");
const VERIFIED_EVIDENCE = new WeakSet<object>();

export interface EvidenceSpan {
  readonly start: number;
  readonly end: number;
}

export interface EvidencePreparationPolicy {
  readonly maximumInputBytes: number;
  readonly maximumSpans: number;
  readonly maximumExcerptBytes: number;
  readonly maximumRedactions: number;
  readonly forbiddenCanaries: readonly string[];
}

export interface EvidenceMetadata {
  readonly envelopeVersion: string;
  readonly sourceId: string;
  readonly observationId: string;
  readonly observedAt: string;
  readonly extractionVersion: string;
}

export interface VerifiedRedactedEvidence {
  readonly [EVIDENCE_BRAND]: true;
  readonly safeLocator: string;
  readonly canonicalMetadata: string;
  readonly redactedText: string;
  readonly byteLength: number;
}

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\bCookie\s*:\s*[^\r\n]{1,2048}/giu,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/giu,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}["']?/giu,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu,
  /\b(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/gu,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function containsSensitiveValue(
  value: string,
  canaries: readonly string[],
): boolean {
  if (canaries.some((canary) => value.includes(canary))) return true;
  return SENSITIVE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function validateEvidencePolicy(
  policy: EvidencePreparationPolicy,
): string | null {
  const limits = [
    policy.maximumInputBytes,
    policy.maximumSpans,
    policy.maximumExcerptBytes,
    policy.maximumRedactions,
  ];
  if (limits.some((value) => !Number.isSafeInteger(value) || value < 1))
    return "evidence limits must be positive safe integers";
  if (policy.forbiddenCanaries.length === 0)
    return "at least one credential, account, or PII canary is required";
  if (
    policy.forbiddenCanaries.some(
      (canary) =>
        canary.length < 8 || new TextEncoder().encode(canary).length > 1024,
    )
  )
    return "canaries must contain 8 to 1024 UTF-8 bytes";
  return null;
}

/**
 * DATA-063/PIPE-018/PIPE-031: minimizes and redacts entirely in memory. Only
 * the successful branded result is accepted by hashing and AI-envelope helpers.
 */
export function prepareEvidence(
  source: AdapterSource,
  input: string,
  spans: readonly EvidenceSpan[],
  safeLocator: string,
  metadata: EvidenceMetadata,
  policy: EvidencePreparationPolicy,
): AcquisitionResult<VerifiedRedactedEvidence> {
  const policyError = validateEvidencePolicy(policy);
  if (policyError !== null) return reject("redaction_failed", policyError);
  const locatorResult = validateSafeLocator(source, safeLocator);
  if (!locatorResult.ok) return locatorResult;
  if (containsSensitiveValue(safeLocator, policy.forbiddenCanaries))
    return reject(
      "credential_or_pii_detected",
      "safe locator contains credential, account, or PII material",
    );
  if (
    metadata.sourceId !== source.source_id ||
    metadata.envelopeVersion !== "evidence-envelope-1" ||
    !/^obs_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      metadata.observationId,
    ) ||
    metadata.extractionVersion.length < 1 ||
    metadata.extractionVersion.length > 128 ||
    containsSensitiveValue(
      `${metadata.observationId}\n${metadata.extractionVersion}`,
      policy.forbiddenCanaries,
    )
  )
    return reject("redaction_failed", "evidence metadata is invalid");
  const observed = new Date(metadata.observedAt);
  if (
    !Number.isFinite(observed.valueOf()) ||
    observed.toISOString() !== metadata.observedAt
  )
    return reject("redaction_failed", "evidence observation time is invalid");
  const encoder = new TextEncoder();
  if (encoder.encode(input).length > policy.maximumInputBytes)
    return reject(
      "budget_exceeded",
      "unredacted input exceeds the in-memory limit",
    );
  if (spans.length === 0 || spans.length > policy.maximumSpans)
    return reject("redaction_failed", "evidence span count is outside policy");

  let previousEnd = 0;
  const excerpts: string[] = [];
  for (const span of spans) {
    if (
      !Number.isSafeInteger(span.start) ||
      !Number.isSafeInteger(span.end) ||
      span.start < previousEnd ||
      span.end <= span.start ||
      span.end > input.length
    )
      return reject(
        "redaction_failed",
        "evidence spans are invalid or overlapping",
      );
    excerpts.push(input.slice(span.start, span.end));
    previousEnd = span.end;
  }
  let minimized = excerpts.join("\n[…minimized…]\n");
  if (encoder.encode(minimized).length > policy.maximumExcerptBytes)
    return reject(
      "budget_exceeded",
      "minimized excerpt exceeds its byte limit",
    );

  let redactions = 0;
  const replaceMatch = (): string => {
    redactions += 1;
    return "[REDACTED]";
  };
  for (const canary of policy.forbiddenCanaries) {
    minimized = minimized.replace(
      new RegExp(escapeRegExp(canary), "gu"),
      replaceMatch,
    );
  }
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    minimized = minimized.replace(pattern, replaceMatch);
  }
  if (redactions > policy.maximumRedactions)
    return reject("redaction_failed", "redaction count exceeds policy");
  if (containsSensitiveValue(minimized, policy.forbiddenCanaries))
    return reject(
      "credential_or_pii_detected",
      "credential or PII canary remains after redaction",
    );
  const byteLength = encoder.encode(minimized).length;
  if (byteLength > policy.maximumExcerptBytes)
    return reject("budget_exceeded", "redacted excerpt exceeds its byte limit");
  const canonicalMetadata = JSON.stringify({
    envelope_version: metadata.envelopeVersion,
    source_id: metadata.sourceId,
    observation_id: metadata.observationId,
    observed_at: metadata.observedAt,
    extraction_version: metadata.extractionVersion,
    safe_locator: safeLocator,
  });
  const verified: VerifiedRedactedEvidence = {
    [EVIDENCE_BRAND]: true,
    safeLocator,
    canonicalMetadata,
    redactedText: minimized,
    byteLength,
  };
  Object.freeze(verified);
  VERIFIED_EVIDENCE.add(verified);
  return accept(verified);
}

function assertRuntimeVerifiedEvidence(
  evidence: unknown,
): asserts evidence is VerifiedRedactedEvidence {
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    !VERIFIED_EVIDENCE.has(evidence)
  )
    throw new TypeError("evidence was not produced by prepareEvidence");
}

export async function hashVerifiedEvidence(
  evidence: VerifiedRedactedEvidence,
): Promise<`sha256:${string}`> {
  assertRuntimeVerifiedEvidence(evidence);
  const bytes = new TextEncoder().encode(
    `${evidence.canonicalMetadata}\n${evidence.redactedText}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
}

export interface UntrustedSourceEnvelope {
  readonly handling: "untrusted_source_data_not_instructions";
  readonly safeLocator: string;
  readonly excerpt: string;
}

/** Creates data for a later prompt builder; this function performs no AI call. */
export function createUntrustedSourceEnvelope(
  evidence: VerifiedRedactedEvidence,
): UntrustedSourceEnvelope {
  assertRuntimeVerifiedEvidence(evidence);
  return {
    handling: "untrusted_source_data_not_instructions",
    safeLocator: evidence.safeLocator,
    excerpt: evidence.redactedText,
  };
}
