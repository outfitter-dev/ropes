import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { PathResult, RootResult, VcsKind } from "../contracts/root.ts";
import { configFileIn } from "./load.ts";

const kindOf = async (target: string): Promise<"dir" | "file" | null> => {
  try {
    const stats = await stat(target);
    return stats.isDirectory() ? "dir" : "file";
  } catch {
    return null;
  }
};

/** A jj workspace wins over the git directory it may be colocated with. */
const vcsAt = async (dir: string): Promise<VcsKind | null> => {
  const [jj, git] = await Promise.all([
    kindOf(path.join(dir, ".jj")),
    kindOf(path.join(dir, ".git")),
  ]);
  if (jj === "dir") {
    return "jj";
  }
  if (git === "dir") {
    return "git";
  }
  return git === "file" ? "git-linked" : null;
};

const toPosix = (relative: string): string =>
  relative.split(path.sep).join("/");

/**
 * Finds the root for a run started in `from`. Walks up to the nearest
 * directory that configures Cinch and stops at the version-control boundary,
 * which is the root when no config sits at or below it. A linked worktree and
 * a jj workspace are their own boundaries, so each reads its own config.
 */
export const discoverRoot = async (from: string): Promise<RootResult> => {
  const start = await realpath(from);
  let dir = start;
  let configured: { dir: string; file: string } | null = null;
  for (;;) {
    if (configured === null) {
      // oxlint-disable-next-line no-await-in-loop -- the walk is sequential: each step depends on the last
      const file = await configFileIn(dir);
      configured = file === null ? null : { dir, file };
    }
    // oxlint-disable-next-line no-await-in-loop -- as above
    const vcs = await vcsAt(dir);
    if (vcs !== null) {
      const root = configured?.dir ?? dir;
      return {
        ok: true,
        value: {
          configFile: configured?.file ?? null,
          root,
          startedIn: toPosix(path.relative(root, start)),
          vcs,
          vcsRoot: dir,
        },
      };
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return { error: { from: start, kind: "no-repo" }, ok: false };
    }
    dir = parent;
  }
};

/**
 * Turns a path the user selected into root-relative form with forward
 * slashes. `cwd` is where a relative selection is resolved from. The root
 * itself is the empty string. A path outside the root is an error.
 */
export const toRootRelative = (
  root: string,
  cwd: string,
  selected: string
): PathResult => {
  const relative = path.relative(root, path.resolve(cwd, selected));
  const outside =
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  return outside
    ? { error: { kind: "outside-root", path: selected, root }, ok: false }
    : { ok: true, value: toPosix(relative) };
};
