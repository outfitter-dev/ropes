import { z } from "zod";

import { DEFAULT_CONFIG } from "../../contracts/config.ts";
import type { Inherited } from "../adapter.ts";
import { runnerIn } from "./markdownlint-source.ts";

const Globs = z.array(z.string());

/** Syntax the old linter's globs have and the Cinch config's do not. */
const GROUP = /[@+?!*]\(/u;
/** A pattern that can only name files: Markdown, or everything below. */
const FILES_ONLY = /\.(?:md|mdx|mdc|markdown)$|\*\*$/iu;
const TRAILING_SLASHES = /\/+$/u;

/** Without a leading `./` or a trailing slash. The root itself is `**`. */
const trimmed = (pattern: string): string => {
  const bare = (pattern.startsWith("./") ? pattern.slice(2) : pattern).replace(
    TRAILING_SLASHES,
    ""
  );
  return bare === "." || (bare === "" && pattern !== "") ? "**" : bare;
};

const expressible = (pattern: string): boolean =>
  pattern !== "" &&
  !pattern.startsWith("/") &&
  !pattern.startsWith("#") &&
  !pattern.includes("\\") &&
  !pattern.split("/").includes("..") &&
  !GROUP.test(pattern);

/**
 * The old linter reads a pattern that names a directory as everything under
 * it. A Cinch glob matches a whole path, so a pattern that may name a
 * directory is written twice: once as it is, and once for what is under it.
 * A dot does not make a name a file (`docs/v1.0`), so only a Markdown
 * extension counts. The second line is harmless when the name is a file.
 */
const withContents = (pattern: string): string[] =>
  FILES_ONLY.test(pattern) ? [pattern] : [pattern, `${pattern}/**`];

interface Sorted {
  readonly include: string[];
  readonly exclude: string[];
  readonly notes: string[];
}

const sort = (key: string, value: unknown, into: Sorted): void => {
  const globs = Globs.safeParse(value);
  if (!globs.success) {
    into.notes.push(`\`${key}\` is not a list of globs, so it was not read.`);
    return;
  }
  for (const stated of globs.data) {
    // In `globs`, a leading `!` takes files away.
    const negated = key === "globs" && stated.startsWith("!");
    const pattern = trimmed(negated ? stated.slice(1) : stated);
    if (expressible(pattern)) {
      const side = key === "ignores" || negated ? into.exclude : into.include;
      side.push(...withContents(pattern));
    } else {
      into.notes.push(
        `${JSON.stringify(stated)} in \`${key}\` was not carried over, because a Cinch glob cannot say it.`
      );
    }
  }
};

const same = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((glob) => right.includes(glob));

/**
 * The files the old Markdown linter was told to check and to leave alone, as
 * `include` and `exclude` globs for a new Cinch config. Null when its config
 * chooses none. An `include` equal to the Cinch default is left out.
 */
export const chosenFiles = async (root: string): Promise<Inherited | null> => {
  const runner = await runnerIn(root);
  if (runner === undefined) {
    return null;
  }
  const sorted: Sorted = { exclude: [], include: [], notes: [] };
  for (const key of ["globs", "ignores"]) {
    if (runner.table[key] !== undefined) {
      sort(key, runner.table[key], sorted);
    }
  }
  const include = [...new Set(sorted.include)];
  const chosen: Inherited = {
    exclude: [...new Set(sorted.exclude)],
    from: runner.file,
    include: same(include, DEFAULT_CONFIG.include.value) ? [] : include,
    notes: sorted.notes,
  };
  const empty =
    chosen.exclude.length + chosen.include.length + chosen.notes.length === 0;
  return empty ? null : chosen;
};
