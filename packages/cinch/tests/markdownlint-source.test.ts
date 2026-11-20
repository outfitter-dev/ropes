import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { findSource } from "../src/adapters/rumdl/migrate/markdownlint/source.ts";

const inRoot = async <T>(
  files: Readonly<Record<string, string>>,
  body: (root: string) => Promise<T>
): Promise<T> => {
  const root = await mkdtemp(path.join(tmpdir(), "cinch-source-"));
  try {
    await Promise.all(
      Object.entries(files).map(([name, text]) =>
        Bun.write(path.join(root, name), text)
      )
    );
    return await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const find = (files: Readonly<Record<string, string>>) =>
  inRoot(files, findSource);

const JSON_RULES = '{ "MD007": { "indent": 4 } }';
const YAML_RULES = "MD007:\n  indent: 4\n";
const RULES = { MD007: { indent: 4 } };

const FORMS: readonly (readonly [string, string])[] = [
  [".markdownlint.json", JSON_RULES],
  [".markdownlint.jsonc", `// The list indent.\n${JSON_RULES}`],
  [".markdownlint.yaml", YAML_RULES],
  [".markdownlint.yml", YAML_RULES],
  [".markdownlint-cli2.jsonc", `{ /* rules */ "config": ${JSON_RULES} }`],
  [".markdownlint-cli2.yaml", "config:\n  MD007:\n    indent: 4\n"],
  ["package.json", `{ "markdownlint-cli2": { "config": ${JSON_RULES} } }`],
];

for (const [name, text] of FORMS) {
  test(`the rules in ${name} are read`, async () => {
    expect(await find({ [name]: text })).toEqual({
      file: name,
      kind: "found",
      notes: [],
      rules: RULES,
      settled: [],
    });
  });
}

test("a repository with no old config has no source", async () => {
  const files = { "package.json": '{ "name": "x" }' };
  expect(await find(files)).toEqual({ kind: "none" });
});

for (const name of [".markdownlint.cjs", ".markdownlint-cli2.mjs"]) {
  test(`${name} is a script, so it is reported and not run`, async () => {
    const marker = path.join(tmpdir(), `cinch-ran-${crypto.randomUUID()}`);
    const script = `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x");`;
    const found = await find({
      ".markdownlint.json": JSON_RULES,
      [name]: script,
    });
    expect(found.kind).toBe("blocked");
    expect(found.kind === "blocked" ? found.message : "").toContain(name);
    expect(await Bun.file(marker).exists()).toBe(false);
  });
}

test("a file that does not parse stops the migration", async () => {
  const found = await find({ ".markdownlint.json": "{ not json" });
  expect(found.kind).toBe("blocked");
  expect(found.kind === "blocked" ? found.message : "").toContain(
    ".markdownlint.json"
  );
});

test("the runner's own settings are named, with the Cinch key for paths", async () => {
  const text = JSON.stringify({
    config: RULES,
    customRules: ["./rule.js"],
    globs: ["docs/**/*.md"],
    ignores: ["CHANGELOG.md"],
  });
  const found = await find({ ".markdownlint-cli2.jsonc": text });
  expect(found).toMatchObject({
    notes: [
      "`customRules` in .markdownlint-cli2.jsonc is a markdownlint-cli2 setting with no equivalent here.",
      "`globs` in .markdownlint-cli2.jsonc chooses files, which is the Cinch config's job. `cinch init` writes it as `include` in a new Cinch config. Add it by hand to one that is already there.",
      "`ignores` in .markdownlint-cli2.jsonc chooses files, which is the Cinch config's job. `cinch init` writes it as `exclude` in a new Cinch config. Add it by hand to one that is already there.",
    ],
    rules: RULES,
    // The file choices are the Cinch config's to carry.
    settled: [
      "`globs` in .markdownlint-cli2.jsonc chooses files, which is the Cinch config's job. `cinch init` writes it as `include` in a new Cinch config. Add it by hand to one that is already there.",
      "`ignores` in .markdownlint-cli2.jsonc chooses files, which is the Cinch config's job. `cinch init` writes it as `exclude` in a new Cinch config. Add it by hand to one that is already there.",
    ],
  });
});

test("a rules file replaces the runner's `config` block", async () => {
  const found = await find({
    ".markdownlint-cli2.jsonc": `{ "config": { "MD007": { "indent": 8 } }, "fix": true }`,
    ".markdownlint.yaml": YAML_RULES,
  });
  expect(found).toMatchObject({
    file: ".markdownlint.yaml",
    notes: [
      "The `config` block in .markdownlint-cli2.jsonc was not read, because .markdownlint.yaml replaces it.",
      "`fix` in .markdownlint-cli2.jsonc is a markdownlint-cli2 setting with no equivalent here.",
    ],
    rules: RULES,
    settled: [
      "The `config` block in .markdownlint-cli2.jsonc was not read, because .markdownlint.yaml replaces it.",
    ],
  });
});

test("a runner with no rules of its own leaves them to the rules file", async () => {
  const found = await find({
    ".markdownlint-cli2.jsonc": `{ "ignores": ["CHANGELOG.md"] }`,
    ".markdownlint.json": JSON_RULES,
  });
  expect(found).toMatchObject({
    file: ".markdownlint.json",
    notes: [
      "`ignores` in .markdownlint-cli2.jsonc chooses files, which is the Cinch config's job. `cinch init` writes it as `exclude` in a new Cinch config. Add it by hand to one that is already there.",
    ],
    rules: RULES,
  });
});

test("only the first file of a kind is read, and any other is named", async () => {
  const found = await find({
    ".markdownlint.json": JSON_RULES,
    ".markdownlint.yaml": "MD007:\n  indent: 8\n",
  });
  expect(found).toMatchObject({
    file: ".markdownlint.json",
    notes: [".markdownlint.yaml also holds Markdown rules and was not read."],
    rules: RULES,
  });
});
