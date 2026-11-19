import {
  copyFile,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { filesUnder } from "./files.ts";

/**
 * The target of a link that is relative and stays inside the root. Such a
 * link means the same thing in the copy. Any other path gets null.
 */
const innerLink = async (
  root: string,
  file: string
): Promise<string | null> => {
  try {
    const target = await readlink(path.join(root, file));
    const reached = path.relative(root, path.resolve(root, file, "..", target));
    const inside =
      !path.isAbsolute(target) &&
      !path.isAbsolute(reached) &&
      reached !== ".." &&
      !reached.startsWith(`..${path.sep}`);
    return inside ? target : null;
  } catch {
    return null;
  }
};

const place = async (root: string, copy: string, file: string) => {
  try {
    const target = await innerLink(root, file);
    // A link that leads elsewhere is copied as the content it reaches, so a
    // step in the copy can never write through it.
    await (target === null
      ? copyFile(path.join(root, file), path.join(copy, file))
      : symlink(target, path.join(copy, file)));
  } catch {
    // A broken link or a path that is not a file. No step can read it.
  }
};

/**
 * Runs `body` against a temporary copy of the root and removes it afterwards.
 * The copy holds what git would let you commit, plus every path in `also`, so
 * an engine finds its own config there and a file the caller named is present
 * even when git ignores it. Other ignored files are not copied.
 */
export const withCopy = async <T>(
  root: { readonly root: string; readonly vcsRoot: string },
  also: readonly string[],
  body: (copy: string) => Promise<T>
): Promise<T> => {
  const copy = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-dry-")));
  try {
    const files = [...new Set([...(await filesUnder(root, "")), ...also])];
    const dirs = new Set(files.map((file) => path.dirname(file)));
    await Promise.all(
      [...dirs].map((dir) => mkdir(path.join(copy, dir), { recursive: true }))
    );
    await Promise.all(files.map((file) => place(root.root, copy, file)));
    return await body(copy);
  } finally {
    await rm(copy, { force: true, recursive: true });
  }
};
