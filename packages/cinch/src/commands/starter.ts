import type { Adapter, Inherited } from "../adapters/adapter.ts";
import { compileGlob } from "../policy/glob.ts";

const HEAD = [
  "# Cinch config. This is the unstable pilot format and will change.",
  "pilot = 0",
  "",
];
const PROFILE = ["[markdown]", "enabled = true", "preset = true", ""];

/**
 * What a repository with no Cinch config and nothing to carry over starts
 * with. It states the defaults, so the plan is the same before and after the
 * file is written.
 */
export const STARTER_CONFIG = [...HEAD, ...PROFILE].join("\n");

const list = (key: string, globs: readonly string[]): string[] =>
  globs.length === 0
    ? []
    : [`${key} = [`, ...globs.map((glob) => `  ${JSON.stringify(glob)},`), "]"];

const unique = (globs: readonly string[]): string[] => [...new Set(globs)];

/** The top-level lines for file choices. A key is written once at most. */
const carried = (inherited: readonly Inherited[]): string[] => {
  if (inherited.length === 0) {
    return [];
  }
  const from = inherited.map((one) => one.from).join(" and ");
  const lists = [
    ...list("include", unique(inherited.flatMap((one) => one.include))),
    ...list("exclude", unique(inherited.flatMap((one) => one.exclude))),
  ];
  return [
    ...(lists.length > 0
      ? [`# The files ${from} chose, carried over by Cinch.`, ...lists]
      : []),
    ...inherited.flatMap((one) =>
      one.notes.map((note) => `# From ${one.from}: ${note}`)
    ),
    "",
  ];
};

/**
 * The first Cinch config for a repository. The file choices of a config that
 * an adapter takes over from go in, so the first check covers the files the
 * old tool covered and no others.
 */
export const starterConfig = (inherited: readonly Inherited[]): string =>
  [...HEAD, ...carried(inherited), ...PROFILE].join("\n");

/** What each adapter found to carry over, in adapter order. */
export const inheritedBy = async (
  adapters: readonly Adapter[],
  root: string
): Promise<Inherited[]> => {
  const found = await Promise.all(
    adapters.map(async (adapter) => (await adapter.inherits?.(root)) ?? null)
  );
  return found.flatMap((one) => (one === null ? [] : [one]));
};

const keptBy = (glob: string, kept: readonly string[]): string | undefined =>
  kept.find(compileGlob(glob));

const spared = (one: Inherited, kept: readonly string[]): Inherited => ({
  ...one,
  exclude: one.exclude.filter((glob) => keptBy(glob, kept) === undefined),
  notes: [
    ...one.notes,
    ...one.exclude.flatMap((glob) => {
      const file = keptBy(glob, kept);
      return file === undefined
        ? []
        : [
            `${JSON.stringify(glob)} was not carried over, because it would leave out ${file}, which Cinch keeps.`,
          ];
    }),
  ],
});

/**
 * Drops each carried `exclude` that would leave out a file Cinch keeps, and
 * says so. The old list was written for the old tool's files. Carried as it
 * is, it could stop `init` writing a preset that another kept file points at.
 */
export const sparing = (
  inherited: readonly Inherited[],
  kept: readonly string[]
): Inherited[] => inherited.map((one) => spared(one, kept));
