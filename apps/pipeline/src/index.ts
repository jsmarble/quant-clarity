function fetch(): Response {
  return Response.json(
    {
      error: {
        code: "private_control_plane",
        message: "This service has no public route.",
      },
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export default { fetch } satisfies ExportedHandler<CloudflareEnv>;
