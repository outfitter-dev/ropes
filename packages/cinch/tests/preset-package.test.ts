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
import { DoctorReportSchema } from "../src/contracts/doctor.ts";
import { PresetReportSchema } from "../src/contracts/preset.ts";
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
    { fixable: true, rule: "ropes/managed-file" },
  ]);
});

test.each([
  { state: "missing", version: null },
  { state: "incompatible", version: "9.0.0" },
])("$state Ultracite only blocks the kept presets", async ({ version }) => {
  await Bun.write(
    path.join(root, "cinch.toml"),
    "pilot = 0\n[lint]\npreset = true\n[format]\npreset = true\n[markdown]\npreset = false\n"
  );
  if (version !== null) {
    await install(version);
  }
  const fixed = await run("doctor", { fix: true });
  const { result } = DoctorReportSchema.parse(
    JSON.parse(fixed.output ?? "null")
  );
  const kept = [".outfitter/configs/presets/oxfmt.ts", KEPT];
  expect(fixed.exitCode).toBe(1);
  expect(
    result.steps
      .flatMap((step) => step.findings)
      .filter((finding) => finding.rule === BUILT_ON_RULE)
      .map((finding) => finding.path)
      .toSorted()
  ).toEqual(kept);

  const listed = await run("preset", { action: "list" });
  const { presets } = PresetReportSchema.parse(
    JSON.parse(listed.output ?? "null")
  );
  const files = presets.flatMap((preset) => preset.files);
  expect(
    files
      .filter((file) => file.state === "blocked")
      .map((file) => file.path)
      .toSorted()
  ).toEqual(kept);
  expect(files).toContainEqual({ path: "oxlint.config.ts", state: "current" });
  expect(files).toContainEqual({ path: "oxfmt.config.ts", state: "current" });
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

test("a preview finds a package installed above a nested root, as a real run does", async () => {
  const app = path.join(root, "packages", "app");
  await mkdir(app, { recursive: true });
  await Bun.write(
    path.join(app, "cinch.toml"),
    "pilot = 0\n[lint]\npreset = true\n[markdown]\npreset = false\n"
  );
  await install(PRESET_BASE.version);
  const preview = await run("doctor", { cwd: app, dryRun: true, fix: true });
  expect(preview.exitCode).toBe(0);
  expect(await Bun.file(path.join(app, KEPT)).exists()).toBe(false);
  const fixed = await run("doctor", { cwd: app, fix: true });
  expect(fixed.exitCode).toBe(0);
});
