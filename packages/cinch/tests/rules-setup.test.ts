import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CommandRequest } from "../src/commands/command.ts";
import { commands } from "../src/commands/registry.ts";
import { starterConfig, STARTER_CONFIG } from "../src/commands/starter.ts";
import { DoctorReportSchema } from "../src/contracts/doctor.ts";
import { parsePlan } from "../src/contracts/parse.ts";

const RULES = '[rules]\nenabled = true\npacks = ["config"]\n';

let root = "";
const put = (name: string, text: string): Promise<number> =>
  Bun.write(path.join(root, name), text);
const config = (): Promise<string> =>
  Bun.file(path.join(root, "cinch.toml")).text();

const run = async (verb: string, request: Partial<CommandRequest> = {}) => {
  const response = await commands[verb]?.({
    cwd: root,
    json: true,
    paths: [],
    ...request,
  });
  if (response === undefined) {
    throw new Error(`no command ${verb}`);
  }
  return response;
};
const notAdopted = async (): Promise<readonly string[]> => {
  const response = await run("doctor");
  const report = DoctorReportSchema.parse(
    JSON.parse(response.output ?? "null")
  );
  return report.notAdopted;
};

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-setup-")));
  await mkdir(path.join(root, ".git"));
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

test("the starting config names the packs given, and none when there are none", () => {
  expect(starterConfig([])).toBe(STARTER_CONFIG);
  expect(starterConfig([], ["config"])).toBe(`${STARTER_CONFIG}\n${RULES}`);
});

test("the files a named pack reads join the default include, or the carried one", () => {
  const fresh = starterConfig([], ["config"], ["**/tsconfig.json"]);
  expect(fresh).toContain(
    '# The files the rule packs named below read are included too.\ninclude = [\n  "**/*.md",\n  "**/*.toml",\n  "**/tsconfig.json",\n]\n'
  );
  expect(fresh).toEndWith(RULES);
  const old = { exclude: [], from: "old.json", kinds: [".md"], notes: [] };
  const carried = starterConfig(
    [{ ...old, include: ["docs/**/*.md"] }],
    ["config"],
    ["**/tsconfig.json"]
  );
  expect(carried).toContain(
    'include = [\n  "docs/**/*.md",\n  "**/tsconfig.json",\n]\n'
  );
  expect(starterConfig([], [], ["**/tsconfig.json"])).toBe(STARTER_CONFIG);
});

test("init starts a new config with the packs that apply here", async () => {
  await put("tsconfig.json", "{}\n");
  const shown = await run("init", { json: false });
  expect(shown.output).toContain('+packs = ["config"]');
  expect(await Bun.file(path.join(root, "cinch.toml")).exists()).toBe(false);
  await run("init", { yes: true });
  expect(await config()).toEndWith(RULES);
  expect(await notAdopted()).toEqual([]);
  const explained = await run("explain", { paths: ["tsconfig.json"] });
  const plan = parsePlan(JSON.parse(explained.output ?? "null"));
  if (!plan.ok) {
    throw new Error("the plan did not parse");
  }
  expect(plan.value.paths[0]?.steps.map((step) => step.adapter)).toEqual([
    "ast-grep",
  ]);
});

test("init names no pack where none applies", async () => {
  await run("init", { yes: true });
  expect(await config()).toBe(STARTER_CONFIG);
});

test("init leaves a config that is already here as it is", async () => {
  await put("tsconfig.json", "{}\n");
  await put("cinch.toml", "pilot = 0\n");
  await run("init", { yes: true });
  expect(await config()).toBe("pilot = 0\n");
});

test("doctor names a pack that applies and is not adopted, as a note", async () => {
  await put("tsconfig.json", "{}\n");
  await put("cinch.toml", "pilot = 0\n\n[markdown]\npreset = false\n");
  expect(await notAdopted()).toEqual(["config"]);
  const shown = await run("doctor", { json: false });
  expect(shown.exitCode).toBe(0);
  expect(shown.output).toContain(
    "Rule packs not adopted\n  config\nRun `cinch rules adopt` to see the change, and add `--yes` to write it."
  );
});

test("doctor says nothing where the config turns rules or the pack off", async () => {
  await put("tsconfig.json", "{}\n");
  await put("cinch.toml", "pilot = 0\n\n[rules]\nenabled = false\n");
  expect(await notAdopted()).toEqual([]);
  await put("cinch.toml", 'pilot = 0\n\n[rules]\noff = ["config"]\n');
  expect(await notAdopted()).toEqual([]);
});
