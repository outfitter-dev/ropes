import path from "node:path";

import { z } from "zod";

/** Configs that are scripts. Reading one would mean running it. */
const SCRIPTS = [
  ".markdownlint-cli2.cjs",
  ".markdownlint-cli2.mjs",
  ".markdownlint.cjs",
  ".markdownlint.mjs",
];
/** In the order markdownlint-cli2 prefers them. */
const RUNNER_FILES = [".markdownlint-cli2.jsonc", ".markdownlint-cli2.yaml"];
const RULE_FILES = [
  ".markdownlint.jsonc",
  ".markdownlint.json",
  ".markdownlint.yaml",
  ".markdownlint.yml",
];
const PACKAGE = "package.json";
const PACKAGE_KEY = "markdownlint-cli2";

const Table = z.record(z.string(), z.unknown());

export type Rules = Readonly<Record<string, unknown>>;

/** The old Markdown linter's config, when the repository has one. */
export type Source =
  | { readonly kind: "none" }
  | { readonly kind: "blocked"; readonly message: string }
  | {
      readonly kind: "found";
      /** Root-relative, for messages. */
      readonly file: string;
      readonly rules: Rules;
      /** Settings beside the rules that have no place in the new config. */
      readonly notes: readonly string[];
    };

const present = async (
  root: string,
  names: readonly string[]
): Promise<string[]> => {
  const found = await Promise.all(
    names.map((name) => Bun.file(path.join(root, name)).exists())
  );
  return names.filter((_, index) => found[index] === true);
};

const parse = (name: string, text: string): unknown =>
  name.endsWith(".yaml") || name.endsWith(".yml")
    ? Bun.YAML.parse(text)
    : Bun.JSONC.parse(text);

const CHOOSES: Readonly<Record<string, string>> = {
  globs: "include",
  ignores: "exclude",
};

const runnerNote = (file: string, key: string): string => {
  const ours = CHOOSES[key];
  if (ours !== undefined) {
    return `\`${key}\` in ${file} chooses files, which is the Cinch config's job. \`cinch init\` writes it as \`${ours}\` in a new Cinch config. Add it by hand to one that is already there.`;
  }
  return key === "gitignore"
    ? `\`gitignore\` in ${file} needs no line here: Cinch leaves out the files git ignores.`
    : `\`${key}\` in ${file} is a markdownlint-cli2 setting with no equivalent here.`;
};

/** A note for each runner setting. Only its `config` block holds rules. */
const runnerNotes = (file: string, table: Rules): string[] =>
  Object.keys(table)
    .filter((key) => key !== "config" && key !== "$schema")
    .map((key) => runnerNote(file, key));

const unreadable = (file: string): Source => ({
  kind: "blocked",
  message: `Cinch could not read the old Markdown rules in ${file}. Fix or remove that file, or write a .rumdl.toml by hand.`,
});

const packageTable = async (root: string): Promise<unknown> => {
  const file = Bun.file(path.join(root, PACKAGE));
  if (!(await file.exists())) {
    return undefined;
  }
  try {
    const table = Table.safeParse(Bun.JSONC.parse(await file.text()));
    return table.success ? table.data[PACKAGE_KEY] : undefined;
  } catch {
    return undefined;
  }
};

const readFile = async (root: string, name: string): Promise<unknown> => {
  try {
    return parse(name, await Bun.file(path.join(root, name)).text());
  } catch {
    return undefined;
  }
};

const tableOf = async (
  root: string,
  name: string,
  inPackage: unknown
): Promise<Rules | undefined> => {
  const raw = name === PACKAGE ? inPackage : await readFile(root, name);
  const table = Table.safeParse(raw);
  return table.success ? table.data : undefined;
};

/** The rules in a runner's `config` block, when no rules file replaces it. */
const fromRunner = (file: string, table: Rules, notes: string[]): Source => {
  const rules = Table.safeParse(table.config ?? {});
  return rules.success
    ? { file, kind: "found", notes, rules: rules.data }
    : {
        kind: "blocked",
        message: `The \`config\` block in ${file} is not a table of rules.`,
      };
};

/** The runner file the old linter reads, and what it holds. */
const runnerOf = async (
  root: string,
  names: readonly string[],
  inPackage: unknown
) => {
  const [file, ...spare] = names;
  const table =
    file === undefined ? undefined : await tableOf(root, file, inPackage);
  return { file, spare, table };
};

/**
 * The runner file the old linter reads, with its table. Undefined when there
 * is none, when it cannot be read, or when a script stands in for it.
 */
export const runnerIn = async (
  root: string
): Promise<{ file: string; table: Rules } | undefined> => {
  const [scripts, runners, inPackage] = await Promise.all([
    present(root, SCRIPTS),
    present(root, RUNNER_FILES),
    packageTable(root),
  ]);
  const { file, table } = await runnerOf(
    root,
    [...runners, ...(inPackage === undefined ? [] : [PACKAGE])],
    inPackage
  );
  return scripts.length > 0 || file === undefined || table === undefined
    ? undefined
    : { file, table };
};

/**
 * Finds the config the old linter would have used and reads its rules. A
 * rules file replaces the `config` block of a runner file beside it, as it
 * does for the old linter, and the runner's other settings still get a note.
 * Any file that was not read is named, so nothing is passed over in silence.
 * A script is never run.
 */
export const findSource = async (root: string): Promise<Source> => {
  const [scripts, runners, plain, inPackage] = await Promise.all([
    present(root, SCRIPTS),
    present(root, RUNNER_FILES),
    present(root, RULE_FILES),
    packageTable(root),
  ]);
  const [script] = scripts;
  if (script !== undefined) {
    return {
      kind: "blocked",
      message: `${script} is a script, and Cinch does not run it to read the old Markdown rules. Write the rules this repository still wants into a new .rumdl.toml by hand.`,
    };
  }
  const runner = await runnerOf(
    root,
    [...runners, ...(inPackage === undefined ? [] : [PACKAGE])],
    inPackage
  );
  const [rulesFile, ...spareRules] = plain;
  if (runner.file !== undefined && runner.table === undefined) {
    return unreadable(runner.file);
  }
  const held =
    runner.file !== undefined && runner.table !== undefined
      ? { file: runner.file, table: runner.table }
      : undefined;
  const notes = [
    ...(held === undefined ? [] : runnerNotes(held.file, held.table)),
    ...[...runner.spare, ...spareRules].map(
      (name) => `${name} also holds Markdown rules and was not read.`
    ),
  ];
  if (rulesFile === undefined) {
    return held === undefined
      ? { kind: "none" }
      : fromRunner(held.file, held.table, notes);
  }
  const rules = await tableOf(root, rulesFile, inPackage);
  if (rules === undefined) {
    return unreadable(rulesFile);
  }
  const replaced =
    held?.table.config === undefined
      ? []
      : [
          `The \`config\` block in ${held.file} was not read, because ${rulesFile} replaces it.`,
        ];
  return {
    file: rulesFile,
    kind: "found",
    notes: [...replaced, ...notes],
    rules,
  };
};
