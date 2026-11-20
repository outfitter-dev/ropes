import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { leftovers } from "../src/adapters/rumdl/markdownlint-leftovers.ts";
import { rumdlPresetAdapter } from "../src/adapters/rumdl/preset.ts";

const inRoot = async <T>(
  files: Readonly<Record<string, string>>,
  body: (root: string) => Promise<T>
): Promise<T> => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-lft-")));
  try {
    await Promise.all(
      Object.entries(files).map(async ([name, text]) => {
        await mkdir(path.dirname(path.join(root, name)), { recursive: true });
        await Bun.write(path.join(root, name), text);
      })
    );
    return await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const found = (files: Readonly<Record<string, string>>) =>
  inRoot(files, leftovers);

test("a repository that never used the old linter has none", async () => {
  expect(
    await found({
      "lefthook.yml":
        "pre-commit:\n  commands:\n    lint:\n      run: cinch check\n",
      "package.json": JSON.stringify({ scripts: { lint: "cinch check" } }),
    })
  ).toEqual([]);
});

test("the ignore list is named, with where its lines go", async () => {
  expect(await found({ ".markdownlintignore": "vendor/\n" })).toEqual([
    ".markdownlintignore lists files the old linter skipped. Add the ones that still matter to `exclude` in the Cinch config, then delete it.",
  ]);
});

test("package.json is read for settings, packages, scripts and staged runs", async () => {
  const manifest = JSON.stringify({
    dependencies: { markdownlint: "^0.38.0" },
    devDependencies: { "markdownlint-cli2": "^0.18.0", typescript: "^5.0.0" },
    "lint-staged": { "*.md": "markdownlint-cli2 --fix" },
    "markdownlint-cli2": { config: {} },
    scripts: { build: "tsc", "lint:md": "markdownlint-cli2 '**/*.md'" },
  });
  expect(await found({ "package.json": manifest })).toEqual([
    "The `markdownlint-cli2` settings in package.json.",
    "package.json still installs `markdownlint`, `markdownlint-cli2`.",
    "package.json scripts that still run it: `lint:md`.",
    "The `lint-staged` settings in package.json run it.",
  ]);
});

test("a package.json that is not JSON is passed over", async () => {
  expect(await found({ "package.json": "{ markdownlint" })).toEqual([]);
});

test("hooks and workflows that call it are named, and others are not", async () => {
  expect(
    await found({
      ".github/workflows/ci.yml": "steps:\n  - run: bun test\n",
      ".github/workflows/docs.yaml":
        "steps:\n  - uses: DavidAnson/markdownlint-cli2-action@v20\n",
      ".husky/pre-commit": "npx markdownlint-cli2\n",
      ".pre-commit-config.yaml":
        "repos:\n  - repo: https://github.com/igorshubovych/markdownlint-cli\n",
      "lefthook.yml":
        "pre-commit:\n  commands:\n    md:\n      run: markdownlint-cli2 {staged_files}\n",
    })
  ).toEqual([
    "lefthook.yml still mentions markdownlint.",
    ".pre-commit-config.yaml still mentions markdownlint.",
    ".github/workflows/docs.yaml still mentions markdownlint.",
    ".husky/pre-commit still mentions markdownlint.",
  ]);
});

test("a lint-staged config is named whatever form it is written in", async () => {
  expect(
    await found({
      ".lintstagedrc": '{ "*.md": "markdownlint-cli2 --fix" }\n',
      ".lintstagedrc.cjs":
        "module.exports = { '*.md': 'markdownlint-cli2 --fix' };\n",
      ".lintstagedrc.yml": "'*.ts': oxlint\n",
      "lint-staged.config.js":
        "export default { '*.md': 'markdownlint-cli2 --fix' };\n",
    })
  ).toEqual([
    ".lintstagedrc still mentions markdownlint.",
    ".lintstagedrc.cjs still mentions markdownlint.",
    "lint-staged.config.js still mentions markdownlint.",
  ]);
});

test("leftovers are reported even when no config file is left", async () => {
  const preset = rumdlPresetAdapter();
  const result = await inRoot(
    { ".husky/pre-commit": "npx markdownlint-cli2\n" },
    async (root) => (await preset.retires?.(root)) ?? null
  );
  expect(result).toEqual({
    files: [],
    keep: [],
    leftovers: [".husky/pre-commit still mentions markdownlint."],
    needs: [".rumdl.toml"],
  });
});
