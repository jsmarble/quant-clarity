const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

function fetch(): Response {
  return Response.json(
    {
      error: {
        code: "service_binding_required",
        message: "This service has no public route.",
      },
    },
    { status: 404, headers: SECURITY_HEADERS },
  );
}

export default { fetch } satisfies ExportedHandler<CloudflareEnv>;
