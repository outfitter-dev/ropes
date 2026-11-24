import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Glob } from "bun";

import { shippedPacks } from "../src/adapters/ast-grep/rules.ts";
import { parseConfigTable } from "../src/config/parse.ts";
import type { RopesConfig } from "../src/contracts/config.ts";
import { DEFAULT_CONFIG } from "../src/contracts/config.ts";
import { parsePlan } from "../src/contracts/parse.ts";
import type { Provenance } from "../src/contracts/plan.ts";
import { unknownOff, unknownPacks } from "../src/policy/packs.ts";
import { resolvePlan } from "../src/policy/resolve.ts";
import { rulesBlock } from "../src/render/rules.ts";
import { describeFake } from "./fake-adapter.ts";

const CLI = new URL("../../cli/src/cli.ts", import.meta.url).pathname;
const RULES = path.join(import.meta.dir, "..", "rules");
const ORIGIN = { file: "rope.toml", prefix: "" };
const OFF: Provenance = { file: "rope.toml", key: "rules.off", kind: "file" };
const NAMED: Provenance = {
  file: "rope.toml",
  key: "rules.packs",
  kind: "file",
};
const BOTH = ["config", "typescript"];

const rules = describeFake({
  enabledBy: "rules.enabled",
  extensions: [".json", ".ts"],
  id: "fake-rules",
  optIn: true,
  packs: [
    {
      about: "Configs.",
      name: "config",
      relevant: ["**/tsconfig.json"],
      rules: ["config/a", "config/b"],
    },
    {
      about: "TypeScript.",
      name: "typescript",
      relevant: ["**/*.ts"],
      rules: ["typescript/c"],
    },
  ],
  writes: false,
});

const asked = (
  off?: readonly string[],
  packs: readonly string[] = BOTH
): RopesConfig => ({
  ...DEFAULT_CONFIG,
  file: "rope.toml",
  include: { source: { kind: "default" }, value: ["**/*"] },
  ...(off === undefined ? {} : { rulesOff: { source: OFF, value: off } }),
  rulesPacks: { source: NAMED, value: packs },
  settings: [
    { key: "rules.enabled", source: { kind: "default" }, value: true },
  ],
});

const resolve = (config: RopesConfig, present: readonly string[]) =>
  resolvePlan({
    config,
    descriptors: [rules],
    packages: [],
    paths: ["tsconfig.json"],
    present,
    root: "/repo",
    selection: { kind: "workspace" },
  });

test("a pack runs only where the repository has a file it is about", () => {
  const plan = resolve(asked(), ["pkg/tsconfig.json", "README.md"]);
  expect(plan.batches.map((batch) => batch.rules)).toEqual([
    ["config/a", "config/b"],
  ]);
  expect(plan.rules).toMatchObject([
    { found: "pkg/tsconfig.json", name: "config" },
    { name: "typescript" },
  ]);
  expect(plan.rules?.[1]?.found).toBeUndefined();
  expect(parsePlan(structuredClone(plan)).ok).toBe(true);
});

test("a file Cinch keeps makes no pack relevant", () => {
  const keeper = describeFake({ id: "keeper", owns: ["kept/tsconfig.json"] });
  const plan = resolvePlan({
    config: asked(),
    descriptors: [keeper, rules],
    packages: [],
    paths: ["tsconfig.json"],
    present: ["kept/tsconfig.json"],
    root: "/repo",
    selection: { kind: "workspace" },
  });
  expect(plan.rules?.[0]?.found).toBeUndefined();
});

test("an adapter with no pack on gets no step, and the plan says why", () => {
  const plan = resolve(asked(), ["README.md"]);
  expect(plan.batches).toEqual([]);
  expect(plan.paths[0]?.steps).toEqual([]);
  expect(rulesBlock(plan.rules ?? [])).toContain(
    "typescript  not relevant: no file matches **/*.ts"
  );
});

test("the config turns off one rule or a whole pack", () => {
  const present = ["tsconfig.json", "a.ts"];
  const one = resolve(asked(["config/a"]), present);
  expect(one.batches[0]?.rules).toEqual(["config/b", "typescript/c"]);
  const pack = resolve(asked(["config"]), present);
  expect(pack.batches[0]?.rules).toEqual(["typescript/c"]);
  const text = rulesBlock(one.rules ?? []);
  expect(text).toContain(
    "config  on, since tsconfig.json is here (rope.toml: rules.packs)"
  );
  expect(text).toContain("config/a  off (rope.toml: rules.off)");
  expect(rulesBlock(pack.rules ?? [])).toContain(
    "config  off (rope.toml: rules.off)"
  );
});

test("a pack the config does not name does not run, and the plan says so", () => {
  const plan = resolve(asked(undefined, ["typescript"]), [
    "tsconfig.json",
    "a.ts",
  ]);
  expect(plan.batches[0]?.rules).toEqual(["typescript/c"]);
  expect(rulesBlock(plan.rules ?? [], true, "rope")).toContain(
    "config  not adopted, and tsconfig.json is here. Run `rope rules adopt config` to run it"
  );
});

test("no pack is listed while policy leaves the adapter off", () => {
  const plan = resolve({ ...asked(), settings: [] }, ["tsconfig.json"]);
  expect(plan.rules).toBeUndefined();
  expect(plan.batches).toEqual([]);
});

test("the loader reads the names turned off, and a wrong one is found", () => {
  const parsed = parseConfigTable(
    {
      pilot: 0,
      rules: { enabled: true, off: ["config/a", "nope"], packs: ["config"] },
    },
    ORIGIN
  );
  if (!parsed.ok) {
    throw new Error("the config did not parse");
  }
  expect(parsed.value.rulesOff).toEqual({
    source: OFF,
    value: ["config/a", "nope"],
  });
  expect(
    parsed.value.settings.filter((setting) => setting.key.startsWith("rules."))
  ).toMatchObject([{ key: "rules.enabled", value: true }]);
  expect(parsed.value.rulesPacks).toEqual({ source: NAMED, value: ["config"] });
  expect(unknownOff(parsed.value, [rules])).toEqual(["nope"]);
  expect(
    unknownPacks(
      { ...parsed.value, rulesPacks: { source: NAMED, value: ["gone"] } },
      [rules]
    )
  ).toEqual(["gone"]);
});

test("every shipped rule sits in a pack that has a manifest", async () => {
  const files = await Array.fromAsync(new Glob("*/*.yml").scan({ cwd: RULES }));
  const ids = files.map((file) => file.replace(/\.yml$/u, "")).toSorted();
  expect(shippedPacks.flatMap((pack) => pack.rules).toSorted()).toEqual(ids);
  for (const pack of shippedPacks) {
    expect(pack.about).toMatch(/\.$/u);
  }
});

// A hook's `GIT_DIR` or a developer's Git config must not reach a fixture.
const ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const explain = async (root: string, ...paths: readonly string[]) => {
  const child = Bun.spawn(["bun", CLI, "explain", ...paths], {
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

test("explain names the shipped packs, and refuses a name nothing has", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-pk-")));
  try {
    const config = (off: string) =>
      Bun.write(
        path.join(root, "rope.toml"),
        `pilot = 0\ninclude = ["**/*.json"]\n\n[rules]\nenabled = true\npacks = ["config"]\noff = ["${off}"]\n`
      );
    await mkdir(path.join(root, ".git"));
    await Bun.write(path.join(root, "tsconfig.json"), "{}\n");
    await config("config/tsconfig-extends");
    const shown = await explain(root);
    expect(shown.stdout).toContain(
      "config  on, since tsconfig.json is here (rope.toml: rules.packs)"
    );
    expect(shown.stdout).toContain(
      "config/tsconfig-extends  off (rope.toml: rules.off)"
    );
    expect(shown.stdout).toContain("no step applies to this file");
    await config("config/nope");
    const refused = await explain(root);
    expect(refused.stderr).toContain(
      'rope.toml: rules.off: Cinch ships no rule pack or rule named "config/nope".'
    );
    expect(refused.exitCode).toBe(2);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a named file git ignores still makes its pack relevant", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-pk-")));
  try {
    const made = Bun.spawnSync(["git", "init", "-q"], { cwd: root, env: ENV });
    expect(made.exitCode).toBe(0);
    await Bun.write(path.join(root, ".gitignore"), "tsconfig.json\n");
    await Bun.write(path.join(root, "tsconfig.json"), "{}\n");
    await Bun.write(
      path.join(root, "rope.toml"),
      'pilot = 0\ninclude = ["**/*.json"]\n\n[rules]\nenabled = true\npacks = ["config"]\n'
    );
    const shown = await explain(root, "tsconfig.json");
    expect(shown.stdout).toContain(
      "config  on, since tsconfig.json is here (rope.toml: rules.packs)"
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
