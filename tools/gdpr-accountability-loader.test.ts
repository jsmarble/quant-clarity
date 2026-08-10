import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  readBoundedRegularFile,
  readBoundedRegularFiles,
} from "./gdpr-accountability-loader.js";

async function withTemporaryDirectory(
  operation: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "quant-clarity-gdpr-"));
  try {
    await operation(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

describe("bounded regular-file loader", () => {
  it("accepts the exact per-file boundary and rejects one byte over", async () => {
    await withTemporaryDirectory(async (directory) => {
      const exact = join(directory, "exact.json");
      const oversized = join(directory, "oversized.json");
      await writeFile(exact, new Uint8Array(16));
      await writeFile(oversized, new Uint8Array(17));
      await expect(
        readBoundedRegularFile({ maximumBytes: 16, path: exact }),
      ).resolves.toHaveLength(16);
      await expect(
        readBoundedRegularFile({ maximumBytes: 16, path: oversized }),
      ).rejects.toThrow("exceeds its 16-byte input limit");
    });
  });

  it("rejects symlinks before reading their targets", async () => {
    await withTemporaryDirectory(async (directory) => {
      const target = join(directory, "target.json");
      const link = join(directory, "link.json");
      await writeFile(target, "private target");
      await symlink(target, link);
      await expect(
        readBoundedRegularFile({ maximumBytes: 64, path: link }),
      ).rejects.toThrow("must be a regular non-symlink file");
    });
  });

  it("preflights aggregate size before reading the file set", async () => {
    await withTemporaryDirectory(async (directory) => {
      const first = join(directory, "first.json");
      const second = join(directory, "second.json");
      await writeFile(first, new Uint8Array(8));
      await writeFile(second, new Uint8Array(9));
      await expect(
        readBoundedRegularFiles(
          [
            { maximumBytes: 16, path: first },
            { maximumBytes: 16, path: second },
          ],
          16,
        ),
      ).rejects.toThrow("exceed their 16-byte aggregate input limit");
    });
  });
});
