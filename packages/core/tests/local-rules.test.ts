import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseConfigTable } from "../src/config/parse.ts";
import type { RopesConfig } from "../src/contracts/config.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import type { Provenance } from "../src/contracts/plan.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { localRulesBlock } from "../src/render/rules.ts";
import { describeFake } from "./fake-adapter.ts";

const CLI = new URL("../../cli/src/cli.ts", import.meta.url).pathname;
const ENGINE = "ast-grep";
const ORIGIN = { file: "rope.toml", prefix: "" };
const LOCAL: Provenance = {
  file: "rope.toml",
  key: "rules.local",
  kind: "file",
};
const NO_LOG = `id: no-log
language: typescript
severity: error
message: Say it through the logger.
rule:
  pattern: console.log($A)
`;

test("the config names folders of local rules, and only ones inside the repository", () => {
  const parsed = parseConfigTable(
    { pilot: 0, rules: { enabled: true, local: ["rules"] } },
    ORIGIN
  );
  expect(parsed.ok && parsed.value.rulesLocal).toEqual({
    source: LOCAL,
    value: ["rules"],
  });
  const outside = [
    "../rules",
    "/rules",
    "a/../../rules",
    "\\rules",
    "\\\\server\\share",
  ];
  for (const folder of outside) {
    const refused = parseConfigTable(
      { pilot: 0, rules: { local: [folder] } },
      ORIGIN
    );
    expect(refused.ok).toBe(false);
  }
});

const config: RopesConfig = {
  ...DEFAULT_CONFIG,
  file: "rope.toml",
  include: { source: { kind: "default" }, value: ["**/*"] },
  rulesLocal: { source: LOCAL, value: ["rules"] },
  settings: [
    { key: "rules.enabled", source: { kind: "default" }, value: true },
  ],
};

const fake = (localRules?: readonly string[]) =>
  describeFake({
    enabledBy: "rules.enabled",
    extensions: [".ts"],
    id: "fake-rules",
    ...(localRules === undefined ? {} : { localRules }),
    optIn: true,
    packs: [
      { about: "Configs.", name: "config", relevant: ["x.json"], rules: ["a"] },
    ],
    writes: false,
  });

const resolve = (localRules?: readonly string[]) =>
  resolvePlan({
    config,
    descriptors: [fake(localRules)],
    packages: [],
    paths: ["a.ts"],
    present: ["a.ts"],
    root: "/repo",
    selection: { kind: "workspace" },
  });

test("an adapter with local rules has a step where no shipped pack is on", () => {
  const plan = resolve(["rules"]);
  expect(plan.batches).toMatchObject([{ adapter: "fake-rules", rules: [] }]);
  expect(plan.localRules).toEqual([{ folder: "rules", source: LOCAL }]);
  expect(resolve().batches).toEqual([]);
  expect(resolve().localRules).toBeUndefined();
});

test("explain lists local folders apart from the shipped packs", () => {
  expect(localRulesBlock([{ folder: "rules", source: LOCAL }])).toBe(
    "Local rules\n  rules  (rope.toml: rules.local)"
  );
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
  root = await realpath(await mkdtemp(path.join(tmpdir(), "ropes-local-")));
  await mkdir(path.join(root, ".git"));
  await Bun.write(
    path.join(root, "rope.toml"),
    'pilot = 0\ninclude = ["**/*.ts"]\n\n[rules]\nenabled = true\nlocal = ["rules"]\n\n[markdown]\nenabled = false\n\n[toml]\nenabled = false\n'
  );
  await Bun.write(path.join(root, "a.ts"), "console.log(1);\n");
});
afterEach(() => rm(root, { force: true, recursive: true }));

const rope = async (...args: readonly string[]) => {
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
const rule = (name: string, text: string) =>
  Bun.write(path.join(root, "rules", name), text);

/** Whether the engine is here. Says why a test did not run when it is not. */
const hasEngine = (): boolean => {
  if (Bun.which(ENGINE) === null) {
    console.log(`skipped: ${ENGINE} is not on PATH, so no local rule was run`);
    return false;
  }
  return true;
};

test("explain shows the folder, and a folder that is not there is incomplete", async () => {
  await rule("no-log.yml", NO_LOG);
  const shown = await rope("explain");
  expect(shown.stdout).toContain(
    "Local rules\n  rules  (rope.toml: rules.local)"
  );
  if (!hasEngine()) {
    return;
  }
  await rm(path.join(root, "rules"), { recursive: true });
  const ran = await rope("check");
  expect(ran.stdout).toContain(
    "rules.local names rules, which is not a folder here"
  );
  expect(ran.exitCode).toBe(2);
});

test("a local rule's finding is reported as the repository's own", async () => {
  if (!hasEngine()) {
    return;
  }
  await rule("no-log.yml", NO_LOG);
  const ran = await rope("check", "--json");
  const result: unknown = JSON.parse(ran.stdout);
  expect(JSON.stringify(result)).toContain('"rule":"local/no-log"');
  expect(ran.stdout).toContain("Say it through the logger.");
  expect(ran.exitCode).toBe(1);
});

test("a rule file the engine refuses is incomplete, and is named", async () => {
  if (!hasEngine()) {
    return;
  }
  await rule("no-log.yml", NO_LOG);
  await rule(
    "deep/bad.yml",
    "id: bad\nlanguage: typescript\nrule:\n  nope: 1\n"
  );
  const ran = await rope("check");
  expect(ran.stdout).toContain("rules/deep/bad.yml: error: line 3");
  expect(ran.stdout).toContain("unknown field `nope`");
  expect(ran.exitCode).toBe(2);
});

test("an id is used once: not twice here, and not one Ropes ships", async () => {
  if (!hasEngine()) {
    return;
  }
  await rule("no-log.yml", NO_LOG);
  await rule("twice.yml", NO_LOG);
  const twice = await rope("check");
  expect(twice.stdout).toContain(
    "rules/twice.yml: the id no-log is already used by rules/no-log.yml"
  );
  expect(twice.exitCode).toBe(2);
  await rule("twice.yml", NO_LOG.replace("no-log", "config/tsconfig-extends"));
  const shipped = await rope("check");
  expect(shipped.stdout).toContain(
    "the id config/tsconfig-extends is already used by a rule Ropes ships"
  );
  expect(shipped.exitCode).toBe(2);
});

test("a rule in a dot-named file or folder is read like any other", async () => {
  if (!hasEngine()) {
    return;
  }
  await rule(".shared/no-log.yml", NO_LOG);
  await rule(".todo.yml", NO_LOG.replace("no-log", "no-log-again"));
  const ran = await rope("check");
  expect(ran.stdout).toContain("local/no-log ");
  expect(ran.stdout).toContain("local/no-log-again ");
});
