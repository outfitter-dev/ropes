import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

const SKIPPED_DIRS = new Set([".git", ".jj", "node_modules"]);

const git = async (cwd: string, args: readonly string[]) => {
  const child = Bun.spawn(["git", "-C", cwd, ...args], {
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
    // A directory name is a literal pathspec, so `*`, `?`, `[` and a leading
    // `:` stay characters in that name.
    const scope = ["--", `:(literal)${dir === "" ? "." : dir}`];
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
 * Root-relative files under `directory`. `prefix` is that directory's own
 * root-relative path. `.git`, `.jj` and `node_modules` are not opened.
 * A symlink is left untouched.
 */
const walk = async (directory: string, prefix: string): Promise<string[]> => {
  const children = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    children.map(async (entry) => {
      if (entry.isSymbolicLink() || SKIPPED_DIRS.has(entry.name)) {
        return [];
      }
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        return await walk(path.join(directory, entry.name), relative);
      }
      return entry.isFile() ? [relative] : [];
    })
  );
  return groups.flat();
};

/** Every file under `dir`, apart from version-control data and `node_modules`. */
const fromWalk = async (root: string, dir: string): Promise<string[]> => {
  if (dir.split("/").some((part) => SKIPPED_DIRS.has(part))) {
    return [];
  }
  return await walk(path.join(root, dir), dir);
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
