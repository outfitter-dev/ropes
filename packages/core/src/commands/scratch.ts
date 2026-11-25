import {
  copyFile,
  cp,
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

import type { PreviewInput } from "../adapters/adapter.ts";
import { toRootRelative } from "../config/root.ts";
import { filesUnder } from "./files.ts";

const MODULES = "node_modules";

const under = (dir: string, file: string): boolean =>
  file === dir || file.startsWith(`${dir}${path.sep}`);

/**
 * Whether a path ends up in the root's installed dependencies. The copy links
 * to that folder, so a link kept into it would let a step write to the
 * checkout.
 */
const reachesModules = async (root: string, file: string) => {
  try {
    const [base, real] = await Promise.all([
      realpath(root),
      realpath(path.join(root, file)),
    ]);
    return under(MODULES, path.relative(base, real));
  } catch {
    return false;
  }
};

/**
 * The target of a link that is relative, stays inside the root and does not
 * lead into the installed dependencies. Such a link means the same thing in
 * the copy. Any other path gets null.
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
      !under("..", reached) &&
      // The path the link names counts as well as where it ends up: a
      // dependency can itself be a link to somewhere else in the checkout.
      !under(MODULES, reached) &&
      !(await reachesModules(root, file));
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

const isDir = async (dir: string): Promise<boolean> => {
  try {
    const found = await stat(dir);
    return found.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Installed dependencies are not copied, but an engine's config may import
 * from them. The copy gets a link to the root's own folder instead.
 */
const linkModules = async (root: string, copy: string) => {
  try {
    if (await isDir(path.join(root, MODULES))) {
      await symlink(path.join(root, MODULES), path.join(copy, MODULES));
    }
  } catch {
    // A copied file already has that name.
  }
};

/** The dependency folders above the root, the farthest first. */
const modulesAbove = async (root: string): Promise<string[]> => {
  const above: string[] = [];
  for (
    let dir = path.dirname(root);
    dir !== path.dirname(dir);
    dir = path.dirname(dir)
  ) {
    above.unshift(path.join(dir, MODULES));
  }
  const kept = await Promise.all(above.map((dir) => isDir(dir)));
  return above.filter((_, index) => kept[index] === true);
};

/**
 * Makes the folder the copy goes in. A root inside a workspace imports from
 * the dependency folders above it too, so the copy sits one folder deep for
 * each of those, with a link to it beside each level. A package is then
 * found from the copy exactly where it is found from the root.
 */
const nest = async (root: string, base: string): Promise<string> => {
  let copy = base;
  for (const modules of await modulesAbove(root)) {
    // Each level holds the next, so they are made in order.
    // eslint-disable-next-line no-await-in-loop
    await symlink(modules, path.join(copy, MODULES));
    copy = path.join(copy, "in");
    // eslint-disable-next-line no-await-in-loop
    await mkdir(copy);
  }
  return copy;
};

/**
 * Runs `body` against a temporary copy of the root and removes it afterwards.
 * The copy holds what git would let you commit, plus every path in `also`, so
 * an engine finds its own config there and a file the caller named is present
 * even when git ignores it. Other ignored files are not copied. Installed
 * dependencies at the root and above it are linked, not copied.
 */
export const withCopy = async <T>(
  root: { readonly root: string; readonly vcsRoot: string },
  also: readonly string[],
  body: (copy: string) => Promise<T>,
  inputs: readonly PreviewInput[] = []
): Promise<T> => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "ropes-dry-")));
  try {
    const copy = await nest(root.root, base);
    const files = [...new Set([...(await filesUnder(root, "")), ...also])];
    const dirs = new Set(files.map((file) => path.dirname(file)));
    await Promise.all(
      [...dirs].map((dir) => mkdir(path.join(copy, dir), { recursive: true }))
    );
    await Promise.all(files.map((file) => place(root.root, copy, file)));
    await linkModules(root.root, copy);
    for (const input of inputs) {
      const target = path.join(copy, input.path);
      // eslint-disable-next-line no-await-in-loop -- validate before each snapshot is materialized
      const located = await toRootRelative(copy, copy, target);
      if (!located.ok) {
        throw new CopyError(input.path);
      }
      try {
        if (input.directory === true) {
          // eslint-disable-next-line no-await-in-loop -- each destination is checked before creation
          await mkdir(target, { recursive: true });
          continue;
        }
        // eslint-disable-next-line no-await-in-loop -- each input is checked before any writes to its destination
        await mkdir(path.dirname(target), { recursive: true });
        // A fresh destination prevents copies through descendant links left
        // by the generic repository snapshot.
        // eslint-disable-next-line no-await-in-loop -- remove only this already validated scratch path
        await rm(target, { force: true, recursive: true });
        // Dereferencing makes the snapshot independent of source symlinks.
        // eslint-disable-next-line no-await-in-loop -- copy each validated input once
        await cp(input.source, target, { dereference: true, recursive: true });
      } catch {
        throw new CopyError(input.path);
      }
    }
    return await body(copy);
  } finally {
    await rm(base, { force: true, recursive: true });
  }
};
