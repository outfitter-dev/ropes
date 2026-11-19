import {
  copyFile,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rm,
  stat,
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

/** Thrown when a file that exists could not be copied. */
export class CopyError extends Error {
  constructor(file: string) {
    super(`the dry run could not copy ${file}, so it did not run`);
    this.name = "CopyError";
  }
}

const isFile = async (file: string): Promise<boolean> => {
  try {
    const found = await stat(file);
    return found.isFile();
  } catch {
    return false;
  }
};

const place = async (root: string, copy: string, file: string) => {
  const target = await innerLink(root, file);
  try {
    // A link that leads elsewhere is copied as the content it reaches, so a
    // step in the copy can never write through it.
    await (target === null
      ? copyFile(path.join(root, file), path.join(copy, file))
      : symlink(target, path.join(copy, file)));
  } catch {
    // A broken link or a directory is left out: no step can read it. A file
    // that is there but did not copy would make the copy tell a different
    // story from the checkout, for example by losing an engine's config.
    if (await isFile(path.join(root, file))) {
      throw new CopyError(file);
    }
  }
};

const MODULES = "node_modules";

/**
 * Installed dependencies are not copied, but an engine's config may import
 * from them. The copy gets a link to the root's own folder instead.
 */
const linkModules = async (root: string, copy: string) => {
  try {
    const found = await stat(path.join(root, MODULES));
    if (found.isDirectory()) {
      await symlink(path.join(root, MODULES), path.join(copy, MODULES));
    }
  } catch {
    // Nothing is installed, or a copied file already has that name.
  }
};

/**
 * Runs `body` against a temporary copy of the root and removes it afterwards.
 * The copy holds what git would let you commit, plus every path in `also`, so
 * an engine finds its own config there and a file the caller named is present
 * even when git ignores it. Other ignored files are not copied. Installed
 * dependencies at the root are linked, not copied.
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
    await linkModules(root.root, copy);
    return await body(copy);
  } finally {
    await rm(copy, { force: true, recursive: true });
  }
};
