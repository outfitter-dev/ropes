import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  BUILT_ON_RULE,
  builtOnProblem,
  installedVersion,
} from "../src/adapters/built-on.ts";
import { PRESET_BASE } from "../src/adapters/preset-base.ts";
import { adaptersFor } from "../src/adapters/registry.ts";
import type { CommandRequest } from "../src/commands/command.ts";
import { createCommands } from "../src/commands/registry.ts";
import { ResultSchema } from "../src/contracts/result.ts";

const commands = createCommands({ adapters: adaptersFor });
const KEPT = ".outfitter/configs/presets/oxlint.ts";

let root = "";
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-package-")));
  await mkdir(path.join(root, ".git"));
  await Bun.write(
    path.join(root, "cinch.toml"),
    "pilot = 0\n[lint]\npreset = true\n[markdown]\npreset = false\n"
  );
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

const run = (verb: string, request: Partial<CommandRequest> = {}) => {
  const command = commands[verb];
  if (!command) {
    throw new Error(`no command ${verb}`);
  }
  return command({ cwd: root, json: true, paths: [], ...request });
};

const install = (version: string, under: string = root): Promise<number> =>
  Bun.write(
    path.join(under, "node_modules", PRESET_BASE.name, "package.json"),
    JSON.stringify({ name: PRESET_BASE.name, version })
  );

/** The findings `check` reports on the kept lint preset. */
const found = async (): Promise<{ rule: string; fixable: boolean }[]> => {
  const checked = await run("check");
  return ResultSchema.parse(JSON.parse(checked.output ?? "null")).steps.flatMap(
    (step) =>
      step.path === KEPT
        ? step.findings.map(({ fixable, rule }) => ({ fixable, rule }))
        : []
  );
};

test("the version the presets were written for is the one this repository installs", async () => {
  const manifest: unknown = await Bun.file(
    path.join(import.meta.dir, "..", "..", "..", "package.json")
  ).json();
  expect(manifest).toMatchObject({
    devDependencies: { [PRESET_BASE.name]: PRESET_BASE.version },
  });
});

test("an older release, another major and a missing package are each a problem", () => {
  const needs = { name: "base", version: "8.1.1" };
  expect(builtOnProblem(needs, "8.1.1")).toBeNull();
  expect(builtOnProblem(needs, "8.4.0")).toBeNull();
  expect(builtOnProblem(needs, "8.1.0")).toContain("8.1.0 is installed");
  expect(builtOnProblem(needs, "9.0.0")).toContain("9.0.0 is installed");
  expect(builtOnProblem(needs, "7.9.9")).toContain("7.9.9 is installed");
  expect(builtOnProblem(needs, null)).toContain("is not installed");
});

test("the nearest node_modules at or above the root is the one read", async () => {
  const inner = path.join(root, "packages", "app");
  await mkdir(inner, { recursive: true });
  expect(await installedVersion(PRESET_BASE.name, inner)).toBeNull();
  await install("8.1.1");
  expect(await installedVersion(PRESET_BASE.name, inner)).toBe("8.1.1");
  await install("8.2.0", inner);
  expect(await installedVersion(PRESET_BASE.name, inner)).toBe("8.2.0");
  await Bun.write(
    path.join(inner, "node_modules", PRESET_BASE.name, "package.json"),
    "not json"
  );
  expect(await installedVersion(PRESET_BASE.name, inner)).toBeNull();
});

test("a kept preset whose package is missing is a finding doctor cannot fix", async () => {
  const fixed = await run("doctor", { fix: true });
  expect(fixed.exitCode).toBe(1);
  expect(await Bun.file(path.join(root, KEPT)).exists()).toBe(true);
  expect(await found()).toEqual([{ fixable: false, rule: BUILT_ON_RULE }]);
});

test("a missing preset file is reported before its package is", async () => {
  expect(await found()).toEqual([
    { fixable: true, rule: "cinch/managed-file" },
  ]);
});

test("the version it was written for, or a later one of that major, passes", async () => {
  await install(PRESET_BASE.version);
  const fixed = await run("doctor", { fix: true });
  expect(fixed.exitCode).toBe(0);
  expect(await found()).toEqual([]);
  await install("8.99.0");
  expect(await found()).toEqual([]);
  await install("7.0.0");
  expect(await found()).toEqual([{ fixable: false, rule: BUILT_ON_RULE }]);
  await install("9.0.0");
  expect(await found()).toEqual([{ fixable: false, rule: BUILT_ON_RULE }]);
});
