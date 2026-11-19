import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

const SKIPPED_DIRS = new Set([".git", ".jj", "node_modules"]);

const git = async (cwd: string, args: readonly string[]) => {
  // Literal pathspecs: a directory named `*` means itself, not a
  // pattern that also matches its neighbours.
  const child = Bun.spawn(["git", "--literal-pathspecs", "-C", cwd, ...args], {
    stderr: "ignore",
    stdout: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return exitCode === 0 ? stdout : null;
};

const entries = (listing: string): string[] =>
  listing.split("\0").filter((entry) => entry !== "");

/**
 * What git would let you commit under `dir`: tracked files plus untracked
 * ones that no ignore rule covers, minus files deleted from the working tree.
 * Null when git cannot answer for this repository, for example in a jj
 * workspace with no git directory, or when git is not installed.
 */
const fromGit = async (
  root: string,
  vcsRoot: string,
  dir: string
): Promise<string[] | null> => {
  try {
    const top = await git(root, ["rev-parse", "--show-toplevel"]);
    // A different top level means git found some other repository above.
    if (top === null || (await realpath(top.trim())) !== vcsRoot) {
      return null;
    }
    const scope = ["--", dir === "" ? "." : dir];
    const [present, deleted] = await Promise.all([
      git(root, [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--deduplicate",
        ...scope,
      ]),
      git(root, ["ls-files", "-z", "--deleted", ...scope]),
    ]);
    if (present === null || deleted === null) {
      return null;
    }
    const gone = new Set(entries(deleted));
    return entries(present).filter((file) => !gone.has(file));
  } catch {
    return null;
  }
};

/**
 * Every file under `dir`, apart from version-control data and `node_modules`.
 * Those directories are never opened, so their size costs nothing.
 */
const fromWalk = async (root: string, dir: string): Promise<string[]> => {
  const listing = await readdir(path.join(root, dir), { withFileTypes: true });
  const nested = await Promise.all(
    listing.map(async (entry): Promise<string[]> => {
      const file = path.posix.join(dir, entry.name);
      if (!entry.isDirectory()) {
        return [file];
      }
      return SKIPPED_DIRS.has(entry.name) ? [] : await fromWalk(root, file);
    })
  );
  return nested.flat().toSorted();
};

/**
 * The root-relative files under a root-relative directory. Ignore rules apply
 * when git can answer. Otherwise the tree is walked as it is.
 */
export const filesUnder = async (
  root: { readonly root: string; readonly vcsRoot: string },
  dir: string
): Promise<string[]> =>
  (await fromGit(root.root, root.vcsRoot, dir)) ??
  (await fromWalk(root.root, dir));
