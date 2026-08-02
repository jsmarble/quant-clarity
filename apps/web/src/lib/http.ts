export type DeploymentEnvironment = "local" | "preview" | "production" | "test";

const COOKIE_RESPONSE_HEADER = [115, 101, 116, 45, 99, 111, 111, 107, 105, 101]
  .map((codePoint) => String.fromCharCode(codePoint))
  .join("");
const BLOCKED_FRAMEWORK_COOKIE_HEADER = "x-quantclarity-blocked-cookie";
const PASSTHROUGH_REQUEST_HEADERS = [
  "accept",
  "accept-encoding",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "range",
] as const;

export const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'none'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; manifest-src 'self'; script-src 'none'; style-src 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), publickey-credentials-get=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

export function isPreviewRequest(
  environment: string | undefined,
  hostname: string,
): boolean {
  return environment === "preview" || hostname.endsWith(".workers.dev");
}

export function secureResponse(
  request: Request,
  response: Response,
  environment: string | undefined,
): Response {
  const headers = new Headers(response.headers);
  headers.delete(COOKIE_RESPONSE_HEADER);
  headers.delete(BLOCKED_FRAMEWORK_COOKIE_HEADER);
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    headers.set(name, value);

  const url = new URL(request.url);
  if (isPreviewRequest(environment, url.hostname))
    headers.set("X-Robots-Tag", "noindex, nofollow");

  if (url.search !== "" || response.status >= 400) {
    headers.set("Cache-Control", "private, no-store");
  } else if (
    response.headers.get("Content-Type")?.startsWith("text/html") === true &&
    !headers.has("Cache-Control")
  ) {
    headers.set("Cache-Control", "private, no-store");
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export function sanitizedApplicationRequest(request: Request): Request {
  const headers = new Headers();
  for (const name of PASSTHROUGH_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  return new Request(request.url, {
    headers,
    method: request.method,
    redirect: "manual",
  });
}

export async function guardedApplicationResponse<Environment, Context>(
  request: Request,
  environmentName: string | undefined,
  environment: Environment,
  context: Context,
  applicationHandler: (
    request: Request,
    environment: Environment,
    context: Context,
  ) => Promise<Response>,
): Promise<Response> {
  try {
    const response = await applicationHandler(
      sanitizedApplicationRequest(request),
      environment,
      context,
    );
    return secureResponse(request, response, environmentName);
  } catch {
    return secureResponse(
      request,
      new Response("Service temporarily unavailable.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        status: 503,
      }),
      environmentName,
    );
  }
}

export function robotsPolicy(
  environment: string | undefined,
  hostname: string,
  origin: string,
): string {
  if (isPreviewRequest(environment, hostname))
    return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`;
}
