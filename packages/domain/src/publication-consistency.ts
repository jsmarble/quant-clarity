const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PUBLICATION_ID = new RegExp(`^pub_${UUID_V4}$`, "u");

const CACHE_RESOURCE_PREFIX = {
  "evidence-summary": "evd_",
  "model-family": "fam_",
  model: "mdl_",
  offering: "off_",
  precision: "prc_",
  price: "pcs_",
  provider: "prv_",
  variant: "var_",
} as const;

export const PUBLICATION_PIN_HEADER = "X-QuantClarity-Publication";
export const PUBLICATION_CACHE_PATH_PREFIX =
  "/.well-known/quantclarity-cache/v1";

export type PublicationId = `pub_${string}`;
export type PublicationCacheResourceType = keyof typeof CACHE_RESOURCE_PREFIX;
export type PublicationRepresentation = "html" | "json";
export type VectorResourceType = "model" | "variant";

export interface PublicationCacheIdentity {
  publicationId: string;
  representation: PublicationRepresentation;
  resourceId: string;
  resourceType: PublicationCacheResourceType;
}

function assertPublicationId(value: string): asserts value is PublicationId {
  if (!PUBLICATION_ID.test(value))
    throw new RangeError(
      "Publication pin must be a lowercase prefixed UUIDv4.",
    );
}

function assertResourceId(resourceType: unknown, resourceId: string): void {
  let prefix: (typeof CACHE_RESOURCE_PREFIX)[PublicationCacheResourceType];
  switch (resourceType) {
    case "evidence-summary":
    case "model-family":
    case "model":
    case "offering":
    case "precision":
    case "price":
    case "provider":
    case "variant":
      prefix = CACHE_RESOURCE_PREFIX[resourceType];
      break;
    default:
      throw new RangeError("Resource type is not cache-key eligible.");
  }
  const pattern = new RegExp(`^${prefix}${UUID_V4}$`, "u");
  if (!pattern.test(resourceId))
    throw new RangeError(
      "Resource ID must be a stable UUIDv4 with the prefix for its resource type.",
    );
}

function assertRepresentation(
  value: unknown,
): asserts value is PublicationRepresentation {
  if (value !== "html" && value !== "json")
    throw new RangeError("Representation is not cache-key eligible.");
}

export function parsePublicationPin(
  value: string | null,
): PublicationId | null {
  if (value === null) return null;
  assertPublicationId(value);
  return value;
}

export function reconcilePublicationPin(
  headerValue: string | null,
  cursorPublicationId: string | null,
): PublicationId | null {
  const headerPin = parsePublicationPin(headerValue);
  const cursorPin = parsePublicationPin(cursorPublicationId);
  if (headerPin !== null && cursorPin !== null && headerPin !== cursorPin)
    throw new RangeError(
      "Publication header and authenticated cursor select different publications.",
    );
  return headerPin ?? cursorPin;
}

export function publicationCacheKey(
  publicOrigin: string,
  identity: PublicationCacheIdentity,
): string {
  const origin = new URL(publicOrigin);
  if (
    origin.origin !== publicOrigin ||
    origin.username !== "" ||
    origin.password !== ""
  )
    throw new RangeError(
      "Cache origin must be an exact origin without a path.",
    );
  assertPublicationId(identity.publicationId);
  assertResourceId(identity.resourceType, identity.resourceId);
  assertRepresentation(identity.representation);
  return new URL(
    `${PUBLICATION_CACHE_PATH_PREFIX}/${identity.publicationId}/${identity.resourceType}/${identity.resourceId}/${identity.representation}`,
    origin,
  ).toString();
}

export async function publicationVectorId(
  publicationId: string,
  resourceType: VectorResourceType,
  resourceId: string,
): Promise<string> {
  assertPublicationId(publicationId);
  assertResourceId(resourceType, resourceId);
  const input = new TextEncoder().encode(
    `quantclarity-vector-v1\0${publicationId}\0${resourceType}\0${resourceId}`,
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
