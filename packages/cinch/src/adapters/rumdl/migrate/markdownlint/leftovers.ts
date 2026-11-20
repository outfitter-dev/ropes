import path from "node:path";

import { z } from "zod";

const NAME = "markdownlint";
const IGNORE_FILE = ".markdownlintignore";
const PACKAGE = "package.json";
const PACKAGE_KEY = "markdownlint-cli2";
const WORKFLOWS = ".github/workflows";

/** Files that run commands on a commit or a push. */
const HOOK_FILES = [
  "lefthook.yml",
  "lefthook.yaml",
  ".lefthook.yml",
  ".lefthook.yaml",
  ".pre-commit-config.yaml",
];
/**
 * The lint-staged globs take in its script configs as well. Those are read
 * as text and never run.
 */
const HOOK_GLOBS = [
  ".husky/*",
  ".lintstagedrc",
  ".lintstagedrc.*",
  "lint-staged.config.*",
  `${WORKFLOWS}/*.yml`,
  `${WORKFLOWS}/*.yaml`,
];

const Names = z.record(z.string(), z.unknown());
const Package = z.looseObject({
  dependencies: Names.optional(),
  devDependencies: Names.optional(),
  "lint-staged": z.unknown().optional(),
  optionalDependencies: Names.optional(),
  scripts: Names.optional(),
});

const read = async (file: string): Promise<string | null> => {
  const handle = Bun.file(file);
  return (await handle.exists()) ? await handle.text() : null;
};

const quoted = (names: readonly string[]): string =>
  names.map((name) => `\`${name}\``).join(", ");

/** What `package.json` still says about the old linter. */
const inPackage = (text: string): string[] => {
  let parsed: z.infer<typeof Package> | undefined;
  try {
    parsed = Package.safeParse(JSON.parse(text)).data;
  } catch {
    return [];
  }
  if (parsed === undefined) {
    return [];
  }
  const packages = [
    ...new Set(
      [
        parsed.dependencies,
        parsed.devDependencies,
        parsed.optionalDependencies,
      ].flatMap((group) =>
        Object.keys(group ?? {}).filter((name) => name.startsWith(NAME))
      )
    ),
  ].toSorted();
  const scripts = Object.entries(parsed.scripts ?? {})
    .filter(([, run]) => typeof run === "string" && run.includes(NAME))
    .map(([name]) => name);
  const staged = JSON.stringify(parsed["lint-staged"] ?? null).includes(NAME);
  return [
    ...(PACKAGE_KEY in parsed
      ? [`The \`${PACKAGE_KEY}\` settings in ${PACKAGE}.`]
      : []),
    ...(packages.length > 0
      ? [`${PACKAGE} still installs ${quoted(packages)}.`]
      : []),
    ...(scripts.length > 0
      ? [`${PACKAGE} scripts that still run it: ${quoted(scripts)}.`]
      : []),
    ...(staged ? [`The \`lint-staged\` settings in ${PACKAGE} run it.`] : []),
  ];
};

/** The hook and workflow files in the repository, root-relative. */
const hookFiles = async (root: string): Promise<string[]> => {
  const globbed = await Promise.all(
    HOOK_GLOBS.map((pattern) =>
      Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: root, dot: true }))
    )
  );
  return [...HOOK_FILES, ...globbed.flat().toSorted()];
};

/**
 * What is left of the old Markdown linter outside its config files: its
 * ignore list, its packages and scripts, and the hooks and workflows that
 * still call it. Cinch names these and changes none of them.
 */
export const leftovers = async (root: string): Promise<string[]> => {
  const at = (name: string): Promise<string | null> =>
    read(path.join(root, name));
  const names = await hookFiles(root);
  const [ignore, manifest, ...texts] = await Promise.all([
    at(IGNORE_FILE),
    at(PACKAGE),
    ...names.map(at),
  ]);
  const calling = names.filter(
    (_, index) => texts[index]?.includes(NAME) === true
  );
  return [
    ...(ignore === null || ignore === undefined
      ? []
      : [
          `${IGNORE_FILE} lists files the old linter skipped. Add the ones that still matter to \`exclude\` in the Cinch config, then delete it.`,
        ]),
    ...(manifest === null || manifest === undefined ? [] : inPackage(manifest)),
    ...calling.map((name) => `${name} still mentions ${NAME}.`),
  ];
};
