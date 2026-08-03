import {
  assertModelSlugArtifactProofBindingV5,
  assertModelSlugArchiveArtifactProofV5,
  assertModelSlugServingArtifactProofV5,
  type ModelSlugArchiveArtifactProofV5,
  type ModelSlugServingArtifactProofV5,
} from "@quant-clarity/publication-core";

import {
  assertModelSlugHistoryArchiveProof,
  type TrustedModelSlugHistoryArchiveProof,
} from "./model-slug-history-archive.js";
import {
  assertModelSlugServingProof,
  type TrustedModelSlugServingProof,
} from "./model-slug-history-staging.js";

const authorityBrand: unique symbol = Symbol("ModelSlugLifecycleAuthorityV5");
const trustedAuthorities = new WeakMap<
  object,
  Readonly<{
    archiveProof: ModelSlugArchiveArtifactProofV5;
    servingProof: ModelSlugServingArtifactProofV5;
    operationalArchiveProof: TrustedModelSlugHistoryArchiveProof;
    operationalServingProof: TrustedModelSlugServingProof;
  }>
>();

export type ModelSlugLifecycleAuthorityV5 = Readonly<{
  readonly [authorityBrand]: true;
}>;

export const assertModelSlugLifecycleAuthorityV5: (
  value: unknown,
) => asserts value is ModelSlugLifecycleAuthorityV5 = (value) => {
  if (
    typeof value !== "object" ||
    value === null ||
    !(authorityBrand in value) ||
    value[authorityBrand] !== true ||
    !trustedAuthorities.has(value)
  )
    throw new TypeError("model slug lifecycle authority v5 is not trusted");
};

/**
 * Bridges B2B's operational R2/D1 capabilities into the pure publication
 * kernel. Core facts alone cannot mint this mutation authority.
 */
export const mintModelSlugLifecycleAuthorityV5 = (
  inputValue: unknown,
): ModelSlugLifecycleAuthorityV5 => {
  const expectedKeys = [
    "archiveProof",
    "operationalArchiveProof",
    "operationalServingProof",
    "servingProof",
  ] as const;
  let values: readonly unknown[];
  try {
    if (
      typeof inputValue !== "object" ||
      inputValue === null ||
      Array.isArray(inputValue)
    )
      throw new TypeError();
    const ownKeys = Reflect.ownKeys(inputValue);
    const prototype = Object.getPrototypeOf(inputValue) as object | null;
    if (
      prototype !== Object.prototype ||
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some(
        (key) =>
          typeof key !== "string" || !expectedKeys.includes(key as never),
      )
    )
      throw new TypeError();
    values = expectedKeys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(inputValue, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      )
        throw new TypeError();
      const value: unknown = descriptor.value;
      return value;
    });
  } catch {
    throw new TypeError("model slug lifecycle authority v5 input is invalid");
  }
  const [
    archiveProof,
    operationalArchiveProof,
    operationalServingProof,
    servingProof,
  ] = values as unknown as readonly [
    ModelSlugArchiveArtifactProofV5,
    TrustedModelSlugHistoryArchiveProof,
    TrustedModelSlugServingProof,
    ModelSlugServingArtifactProofV5,
  ];
  assertModelSlugHistoryArchiveProof(operationalArchiveProof);
  assertModelSlugServingProof(operationalServingProof);
  assertModelSlugArchiveArtifactProofV5(archiveProof);
  assertModelSlugServingArtifactProofV5(servingProof);
  assertModelSlugArtifactProofBindingV5(
    archiveProof,
    servingProof,
    operationalArchiveProof.projection,
  );
  if (
    operationalServingProof.projection !== operationalArchiveProof.projection ||
    operationalServingProof.publicationId !==
      operationalArchiveProof.publicationId ||
    operationalServingProof.artifactDigest !==
      operationalArchiveProof.artifactDigest ||
    archiveProof.publication_id !== operationalArchiveProof.publicationId ||
    archiveProof.closure_hash !== operationalArchiveProof.closureHash ||
    archiveProof.base_bundle_hash !== operationalArchiveProof.baseBundleHash ||
    archiveProof.publication_boundary_ms !==
      operationalArchiveProof.publicationBoundaryMs ||
    archiveProof.artifact_digest !== operationalArchiveProof.artifactDigest ||
    archiveProof.artifact_byte_count !==
      operationalArchiveProof.artifactByteCount ||
    servingProof.publication_id !== operationalServingProof.publicationId ||
    servingProof.staging_revision !== operationalServingProof.stagingRevision ||
    servingProof.artifact_digest !== operationalServingProof.artifactDigest
  )
    throw new TypeError(
      "model slug lifecycle authority v5 evidence does not match",
    );
  const authority = {};
  Object.defineProperty(authority, authorityBrand, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  trustedAuthorities.set(
    authority,
    Object.freeze({
      archiveProof,
      servingProof,
      operationalArchiveProof,
      operationalServingProof,
    }),
  );
  return Object.freeze(authority) as ModelSlugLifecycleAuthorityV5;
};

export const readModelSlugLifecycleOperationalBindingV5 = (
  authority: ModelSlugLifecycleAuthorityV5,
): Readonly<{
  archiveProof: TrustedModelSlugHistoryArchiveProof;
  servingProof: TrustedModelSlugServingProof;
}> => {
  assertModelSlugLifecycleAuthorityV5(authority);
  const binding = trustedAuthorities.get(authority);
  if (binding === undefined)
    throw new TypeError("model slug lifecycle authority v5 is not trusted");
  return Object.freeze({
    archiveProof: binding.operationalArchiveProof,
    servingProof: binding.operationalServingProof,
  });
};

export const assertModelSlugLifecycleAuthorityBindingV5 = (
  authority: ModelSlugLifecycleAuthorityV5,
  archiveProof: ModelSlugArchiveArtifactProofV5,
  servingProof: ModelSlugServingArtifactProofV5,
): void => {
  assertModelSlugLifecycleAuthorityV5(authority);
  const binding = trustedAuthorities.get(authority);
  if (
    binding?.archiveProof !== archiveProof ||
    binding.servingProof !== servingProof
  )
    throw new TypeError("model slug lifecycle authority v5 binding differs");
};
