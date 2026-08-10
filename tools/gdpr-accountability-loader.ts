import { lstat, readFile } from "node:fs/promises";

export interface BoundedFileAuthority {
  maximumBytes: number;
  path: string;
}

async function regularFileSize(
  authority: BoundedFileAuthority,
): Promise<number> {
  const metadata = await lstat(authority.path);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error(`${authority.path} must be a regular non-symlink file`);
  if (metadata.size > authority.maximumBytes)
    throw new Error(
      `${authority.path} exceeds its ${String(authority.maximumBytes)}-byte input limit`,
    );
  return metadata.size;
}

export async function readBoundedRegularFile(
  authority: BoundedFileAuthority,
): Promise<Uint8Array> {
  await regularFileSize(authority);
  const bytes = await readFile(authority.path);
  if (bytes.byteLength > authority.maximumBytes)
    throw new Error(
      `${authority.path} changed beyond its ${String(authority.maximumBytes)}-byte input limit during read`,
    );
  return bytes;
}

export async function readBoundedRegularFiles(
  authorities: readonly BoundedFileAuthority[],
  maximumTotalBytes: number,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const sizes = await Promise.all(authorities.map(regularFileSize));
  const totalSize = sizes.reduce((total, size) => total + size, 0);
  if (totalSize > maximumTotalBytes)
    throw new Error(
      `bounded files exceed their ${String(maximumTotalBytes)}-byte aggregate input limit`,
    );

  const contents = await Promise.all(
    authorities.map(
      async (authority) =>
        [authority.path, await readFile(authority.path)] as const,
    ),
  );
  const actualTotal = contents.reduce(
    (total, [, bytes]) => total + bytes.byteLength,
    0,
  );
  for (const [index, [, bytes]] of contents.entries()) {
    const authority = authorities[index]!;
    if (bytes.byteLength > authority.maximumBytes)
      throw new Error(
        `${authority.path} changed beyond its ${String(authority.maximumBytes)}-byte input limit during read`,
      );
  }
  if (actualTotal > maximumTotalBytes)
    throw new Error(
      `bounded files changed beyond their ${String(maximumTotalBytes)}-byte aggregate input limit during read`,
    );
  return new Map(contents);
}
