import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { adaptersFor } from "../src/adapters/registry.ts";
import {
  CONFIG_PATH,
  PRESET_PATH,
  rumdlPresetAdapter,
} from "../src/adapters/rumdl/preset.ts";
import { createCommands } from "../src/commands/registry.ts";
import { InitReportSchema } from "../src/contracts/init.ts";

const OLD = ".markdownlint.json";
const RUNNER = ".markdownlint-cli2.jsonc";
const RULES = JSON.stringify({ MD007: { indent: 4 } });

const ready = Bun.which("rumdl") !== null;
/** A real-engine test. It says so when the engine is not there to run it. */
const withEngine = (name: string, body: () => Promise<void>) => {
  test(name, async () => {
    if (!ready) {
      console.warn(`skipped: rumdl is not on PATH, so "${name}" did not run`);
      return;
    }
    await body();
  });
};

const inRoot = async <T>(
  files: Readonly<Record<string, string>>,
  body: (root: string) => Promise<T>
): Promise<T> => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-ret-")));
  try {
    await mkdir(path.join(root, ".git"));
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

const preset = rumdlPresetAdapter();
const asked = (files: Readonly<Record<string, string>>) =>
  inRoot(files, (root) => preset.retires?.(root) ?? Promise.resolve(null));

test("a repository with no old config has nothing to retire", async () => {
  expect(await asked({ "README.md": "# Title\n" })).toBeNull();
});

test("a script is named and kept, because it was never read", async () => {
  const found = await asked({ ".markdownlint.cjs": "module.exports = {};" });
  expect(found?.files).toEqual([".markdownlint.cjs"]);
  expect(found?.keep).toEqual([
    expect.stringContaining(".markdownlint.cjs is a script"),
  ]);
});

test("a config set up before this run keeps the old file", async () => {
  const found = await asked({
    [CONFIG_PATH]: `extends = ${JSON.stringify(PRESET_PATH)}\n`,
    [OLD]: RULES,
  });
  expect(found?.keep).toEqual([
    `${CONFIG_PATH} was set up before this run, so Cinch cannot tell what was carried over from ${OLD}. Remove what is no longer wanted by hand.`,
  ]);
});

withEngine("rules that all carry over leave no reason to keep", async () => {
  expect(await asked({ [OLD]: RULES })).toEqual({
    files: [OLD],
    keep: [],
    leftovers: [],
  });
});

withEngine(
  "file choices alone are not a reason: init carries them",
  async () => {
    const found = await asked({
      [RUNNER]: JSON.stringify({
        config: { MD007: { indent: 4 } },
        gitignore: true,
        ignores: ["CHANGELOG.md"],
      }),
    });
    expect(found).toEqual({ files: [RUNNER], keep: [], leftovers: [] });
  }
);

withEngine("a setting with no equivalent keeps the old file", async () => {
  const found = await asked({
    [RUNNER]: JSON.stringify({ config: {}, customRules: ["./rule.js"] }),
  });
  expect(found?.keep).toEqual([
    `\`customRules\` in ${RUNNER} is a markdownlint-cli2 setting with no equivalent here.`,
  ]);
});

withEngine(
  "a value an existing config overrides keeps the old file",
  async () => {
    const found = await asked({
      [CONFIG_PATH]: "[MD007]\nindent = 2\n",
      [OLD]: RULES,
    });
    expect(found?.keep).toEqual([
      `\`indent\` on MD007 is 4 in ${OLD} and 2 here. The value here was kept.`,
    ]);
  }
);

withEngine("init --yes migrates and removes the old config", async () => {
  await inRoot({ [OLD]: RULES, "README.md": "# Title\n" }, async (root) => {
    const commands = createCommands({ adapters: adaptersFor });
    const request = { cwd: root, json: true, paths: [] };
    const shown = await commands.init?.(request);
    const preview = InitReportSchema.parse(JSON.parse(shown?.output ?? "null"));
    expect(preview.retired).toMatchObject({ files: [OLD], removed: true });
    expect(await Bun.file(path.join(root, OLD)).exists()).toBe(true);
    const done = await commands.init?.({ ...request, yes: true });
    expect(done?.exitCode).toBe(0);
    expect(await Bun.file(path.join(root, OLD)).exists()).toBe(false);
    const config = await Bun.file(path.join(root, CONFIG_PATH)).text();
    expect(config).toContain("[MD007]\nindent = 4\n");
    expect(await commands.check?.(request)).toMatchObject({ exitCode: 0 });
    const again = await commands.init?.({ ...request, yes: true });
    const settled = InitReportSchema.parse(JSON.parse(again?.output ?? "null"));
    expect(settled.changed).toEqual([]);
    expect(settled.retired.files).toEqual([]);
  });
});
