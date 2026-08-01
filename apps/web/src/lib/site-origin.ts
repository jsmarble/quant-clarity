export function configuredSiteOrigin(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const buildEnvironment = environment.QUANTCLARITY_BUILD_ENV ?? "local";
  const configured = environment.QUANTCLARITY_SITE_ORIGIN;

  if (buildEnvironment === "production" && configured === undefined)
    throw new Error(
      "Production builds require a cleared QUANTCLARITY_SITE_ORIGIN.",
    );
  if (configured === undefined) return undefined;

  const origin = new URL(configured);
  if (
    origin.protocol !== "https:" ||
    origin.origin !== configured ||
    origin.username !== "" ||
    origin.password !== ""
  )
    throw new Error(
      "QUANTCLARITY_SITE_ORIGIN must be an HTTPS origin without credentials, a path, query, hash, or trailing slash.",
    );
  return configured;
}
