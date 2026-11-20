import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { readProject } from "../src/adapters/ast-grep/project.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import type { CinchConfig } from "../src/contracts/config.ts";
import type { Provenance } from "../src/contracts/plan.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { describeFake } from "./fake-adapter.ts";

const CLI = new URL("../src/cli.ts", import.meta.url).pathname;
const ENGINE = "ast-grep";
const PROJECT = "sgconfig.yml";
const STATED: Provenance = {
  file: "cinch.toml",
  key: "rules.local",
  kind: "file",
};
const FOUND: Provenance = { file: PROJECT, key: "ruleDirs", kind: "file" };
const UTILITY = `id: is-log
language: typescript
rule:
  pattern: console.log($A)
`;
const NO_LOG = `id: no-log
language: typescript
severity: error
message: Say it through the logger.
rule:
  matches: is-log
`;
const CONFIG =
  'pilot = 0\ninclude = ["**/*.ts"]\n\n[rules]\nenabled = true\n\n[markdown]\nenabled = false\n\n[toml]\nenabled = false\n';

const config: CinchConfig = {
  ...DEFAULT_CONFIG,
  file: "cinch.toml",
  include: { source: { kind: "default" }, value: ["**/*"] },
  rulesLocal: { source: STATED, value: ["rules"] },
  settings: [
    { key: "rules.enabled", source: { kind: "default" }, value: true },
  ],
};

test("folders the project config names are planned beside the config's own, each with its source", () => {
  const plan = resolvePlan({
    config,
    descriptors: [
      describeFake({
        enabledBy: "rules.enabled",
        extensions: [".ts"],
        foundRules: {
          file: PROJECT,
          folders: ["rules", "more"],
          key: "ruleDirs",
        },
        id: "fake-rules",
        localRules: ["rules"],
        optIn: true,
        packs: [],
        writes: false,
      }),
    ],
    packages: [],
    paths: ["a.ts"],
    present: ["a.ts"],
    root: "/repo",
    selection: { kind: "workspace" },
  });
  expect(plan.batches).toMatchObject([{ adapter: "fake-rules" }]);
  expect(plan.localRules).toEqual([
    { folder: "rules", source: STATED },
    { folder: "more", source: FOUND },
  ]);
});

// A hook's `GIT_DIR` or a developer's Git config must not reach a fixture.
const ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

let root = "";
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-project-")));
  await mkdir(path.join(root, ".git"));
  await Bun.write(path.join(root, "cinch.toml"), CONFIG);
  await Bun.write(path.join(root, "a.ts"), "console.log(1);\n");
});
afterEach(() => rm(root, { force: true, recursive: true }));

const write = (file: string, text: string) =>
  Bun.write(path.join(root, file), text);
const cinch = async (...args: readonly string[]) => {
  const child = Bun.spawn(["bun", CLI, ...args], {
    cwd: root,
    env: ENV,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, stdout };
};

/** Whether the engine is here. Says why a test did not run when it is not. */
const hasEngine = (): boolean => {
  if (Bun.which(ENGINE) === null) {
    console.log(`skipped: ${ENGINE} is not on PATH, so no rule was run`);
    return false;
  }
  return true;
};

test("the project config's rule folders are read and tidied", async () => {
  expect(await readProject(root)).toEqual({ ok: true });
  await write(PROJECT, "utilDirs:\n  - utils\n");
  expect(await readProject(root)).toEqual({ ok: true });
  await write(PROJECT, "ruleDirs:\n  - ./rules/\n  - rules\n  - more\n");
  expect(await readProject(root)).toEqual({
    found: { file: PROJECT, folders: ["rules", "more"], key: "ruleDirs" },
    ok: true,
  });
  await write(PROJECT, "ruleDirs: rules\n");
  expect(await readProject(root)).toEqual({
    message: `${PROJECT}: ruleDirs must be a list of folders`,
    ok: false,
  });
  await write(PROJECT, "ruleDirs: [\n");
  expect(await readProject(root)).toMatchObject({ ok: false });
});

test.each(["../rules", "/rules", "a/../../rules"])(
  "a rule folder outside the repository is refused: %s",
  async (outside) => {
    await write(PROJECT, `ruleDirs:\n  - ${outside}\n`);
    expect(await readProject(root)).toEqual({
      message: `${PROJECT}: ruleDirs names ${outside}, which is outside the repository`,
      ok: false,
    });
  }
);

test("explain shows the project config as the source, and the file is left as written", async () => {
  const text = "ruleDirs:\n  - ./rules/\nutilDirs:\n  - utils\n";
  await write(PROJECT, text);
  await write("rules/no-log.yml", NO_LOG);
  const shown = await cinch("explain");
  expect(shown.stdout).toContain(
    `Local rules\n  rules  (${PROJECT}: ruleDirs)`
  );
  expect(await Bun.file(path.join(root, PROJECT)).text()).toBe(text);
});

test("a project config that cannot be read stops a run that asks for rules, and no other", async () => {
  await write(PROJECT, "ruleDirs: rules\n");
  const stopped = await cinch("explain");
  expect(stopped.stderr).toContain(
    `${PROJECT}: ruleDirs must be a list of folders`
  );
  expect(stopped.exitCode).toBe(2);
  await write(
    "cinch.toml",
    CONFIG.replace("enabled = true", "enabled = false")
  );
  const ran = await cinch("explain");
  expect(ran.exitCode).toBe(0);
});

test("with only a project config, its rules run, one that uses a utility rule too", async () => {
  if (!hasEngine()) {
    return;
  }
  await write(PROJECT, "ruleDirs:\n  - rules\nutilDirs:\n  - utils\n");
  await write("utils/is-log.yml", UTILITY);
  await write("rules/no-log.yml", NO_LOG);
  const ran = await cinch("check", "--json");
  const result: unknown = JSON.parse(ran.stdout);
  expect(JSON.stringify(result)).toContain('"rule":"local/no-log"');
  expect(ran.stdout).toContain("Say it through the logger.");
  expect(ran.exitCode).toBe(1);
});

test("a folder the project config names that is not there is incomplete, and says who named it", async () => {
  if (!hasEngine()) {
    return;
  }
  await write(PROJECT, "ruleDirs:\n  - rules\n");
  const ran = await cinch("check");
  expect(ran.stdout).toContain(
    `${PROJECT}: ruleDirs names rules, which is not a folder here`
  );
  expect(ran.exitCode).toBe(2);
});
