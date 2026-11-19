import { copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { filesUnder } from "./files.ts";

/**
 * Runs `body` against a temporary copy of the root and removes it afterwards.
 * The copy holds what git would let you commit, so an engine finds its own
 * config there. Ignored files, such as `node_modules`, are not copied.
 */
export const withCopy = async <T>(
  root: { readonly root: string; readonly vcsRoot: string },
  body: (copy: string) => Promise<T>
): Promise<T> => {
  const copy = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-dry-")));
  try {
    const files = await filesUnder(root, "");
    const dirs = new Set(files.map((file) => path.dirname(file)));
    await Promise.all(
      [...dirs].map((dir) => mkdir(path.join(copy, dir), { recursive: true }))
    );
    await Promise.all(
      files.map(async (file) => {
        try {
          await copyFile(path.join(root.root, file), path.join(copy, file));
        } catch {
          // A broken link or a path that is not a file. No step can read it.
        }
      })
    );
    return await body(copy);
  } finally {
    await rm(copy, { force: true, recursive: true });
  }
};
