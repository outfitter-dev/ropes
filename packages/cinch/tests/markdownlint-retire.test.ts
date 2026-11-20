import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { adaptersFor } from "../src/adapters/registry.ts";
import {
  CONFIG_PATH,
  GENERATED_PATH,
  rumdlPresetAdapter,
} from "../src/adapters/rumdl/preset.ts";
import { createCommands } from "../src/commands/registry.ts";
import { DoctorReportSchema } from "../src/contracts/doctor.ts";
import { InitReportSchema } from "../src/contracts/init.ts";

const OLD = ".markdownlint.json";
const RUNNER = ".markdownlint-cli2.jsonc";
const RULES = JSON.stringify({ MD007: { indent: 4 } });

const ready = Bun.which("rumdl") !== null;
const diffOf = (output: string | undefined): string =>
  DoctorReportSchema.parse(JSON.parse(output ?? "null")).diff;

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
  inRoot(
    files,
    (root) => preset.migrates?.[0]?.retires?.(root) ?? Promise.resolve(null)
  );

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
    [CONFIG_PATH]: `extends = ${JSON.stringify(GENERATED_PATH)}\n`,
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
    needs: [CONFIG_PATH],
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
    expect(found).toEqual({
      files: [RUNNER],
      keep: [],
      leftovers: [],
      needs: [CONFIG_PATH],
    });
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

withEngine(
  "a rule the old config switches on and this config off keeps it",
  async () => {
    const found = await asked({
      [CONFIG_PATH]: '[global]\ndisable = ["ul-indent"]\n',
      [OLD]: JSON.stringify({ MD007: true }),
    });
    expect(found?.keep).toEqual([
      `${OLD} switches on MD007, and the lists of rules here switch that off. The lists here were kept.`,
    ]);
  }
);

test("doctor --fix adds the line to a person's config and nothing else", async () => {
  const mine = "[MD013]\nline-length = 100\n";
  await inRoot({ [CONFIG_PATH]: mine, [OLD]: RULES }, async (root) => {
    const { doctor } = createCommands({ adapters: adaptersFor });
    await doctor?.({ cwd: root, fix: true, json: true, paths: [] });
    const text = await Bun.file(path.join(root, CONFIG_PATH)).text();
    expect(text).toBe(`extends = ${JSON.stringify(GENERATED_PATH)}\n\n${mine}`);
    expect(await Bun.file(path.join(root, OLD)).text()).toBe(RULES);
  });
});

withEngine(
  "doctor --fix --dry-run shows what an ignored old config carries over",
  async () => {
    const files = { ".gitignore": `${OLD}\n`, [OLD]: RULES };
    await inRoot(files, async (root) => {
      await rm(path.join(root, ".git"), { force: true, recursive: true });
      // A hook's `GIT_DIR` or a developer's Git config must not reach it.
      const env = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([n]) => !n.startsWith("GIT_"))
        ),
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      };
      expect(
        Bun.spawnSync(["git", "init", "-q"], { cwd: root, env })
      ).toMatchObject({ exitCode: 0 });
      const { doctor } = createCommands({ adapters: adaptersFor });
      const request = { cwd: root, fix: true, json: true, paths: [] };
      const preview = await doctor?.({ ...request, dryRun: true });
      const real = await doctor?.(request);
      expect(diffOf(preview?.output)).toContain("MD007");
      expect(diffOf(preview?.output)).toBe(diffOf(real?.output));
    });
  }
);

withEngine(
  "init --yes keeps the old config when its target is excluded",
  async () => {
    const files = {
      [OLD]: RULES,
      "cinch.toml": `pilot = 0\nexclude = [${JSON.stringify(CONFIG_PATH)}]\n`,
    };
    await inRoot(files, async (root) => {
      const commands = createCommands({ adapters: adaptersFor });
      const done = await commands.init?.({
        cwd: root,
        json: true,
        paths: [],
        yes: true,
      });
      const report = InitReportSchema.parse(JSON.parse(done?.output ?? "null"));
      expect(report.retired.removed).toBe(false);
      expect(report.retired.reasons[0]).toStartWith(
        `${CONFIG_PATH} is left out of this setup`
      );
      expect(await Bun.file(path.join(root, OLD)).exists()).toBe(true);
      expect(await Bun.file(path.join(root, CONFIG_PATH)).exists()).toBe(false);
    });
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
