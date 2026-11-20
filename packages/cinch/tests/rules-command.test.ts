import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CommandRequest } from "../src/commands/command.ts";
import { commands } from "../src/commands/registry.ts";
import { RulesReportSchema } from "../src/contracts/rules-report.ts";

let root = "";
const put = (name: string, text: string): Promise<number> =>
  Bun.write(path.join(root, name), text);
const config = (rules: string): Promise<number> =>
  put("cinch.toml", `pilot = 0\n\n[rules]\n${rules}`);

const run = async (request: Partial<CommandRequest> = {}) => {
  const response = await commands.rules?.({
    cwd: root,
    json: true,
    paths: [],
    ...request,
  });
  if (response === undefined) {
    throw new Error("the rules command is not registered");
  }
  return response;
};
const report = async (request: Partial<CommandRequest> = {}) => {
  const response = await run(request);
  return RulesReportSchema.parse(JSON.parse(response.output ?? "null"));
};

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-rules-")));
  await mkdir(path.join(root, ".git"));
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

const only = async (request: Partial<CommandRequest> = {}) => {
  const { packs } = await report(request);
  const pack = packs.find(({ name }) => name === "config");
  if (pack === undefined) {
    throw new Error("the config pack is not listed");
  }
  return pack;
};

const state = async (request: Partial<CommandRequest> = {}) => {
  const pack = await only(request);
  return pack.state;
};

test("a pack with a file here is on, and without one is not relevant", async () => {
  await config("enabled = true\n");
  expect(await state()).toBe("not-relevant");
  await put("tsconfig.json", "{}\n");
  const pack = await only();
  expect(pack).toMatchObject({ found: "tsconfig.json", state: "on" });
  expect(pack.rules.map((rule) => rule.state)).toEqual(["on"]);
});

test("a name the config turns off is off, pack or rule", async () => {
  await put("tsconfig.json", "{}\n");
  await config('enabled = true\noff = ["config"]\n');
  expect(await only()).toMatchObject({
    rules: [{ state: "off" }],
    state: "off",
  });
  await config('enabled = true\noff = ["config/tsconfig-extends"]\n');
  expect(await only()).toMatchObject({
    rules: [{ id: "config/tsconfig-extends", state: "off" }],
    state: "on",
  });
});

test("with rules not switched on, the packs are still listed", async () => {
  await put("cinch.toml", "pilot = 0\n");
  await put("tsconfig.json", "{}\n");
  const listed = await report();
  expect(listed.enabled).toBe(false);
  expect(await state()).toBe("not-enabled");
  const shown = await run({ json: false });
  expect(shown.output).toStartWith(
    "Rules are not switched on here, so none of these run. Set `enabled = true` under `[rules]` in cinch.toml to run them."
  );
  expect(shown.output).toContain(
    "config  would run, since tsconfig.json is here"
  );
});

test("it lists the whole repository from a folder inside it", async () => {
  await config("enabled = true\n");
  await put("tsconfig.json", "{}\n");
  await put("docs/guide.md", "# Guide\n");
  expect(await state({ cwd: path.join(root, "docs") })).toBe("on");
});

test("the text names the local rule folders", async () => {
  await config('enabled = true\nlocal = ["rules"]\n');
  await put(
    "rules/no-thing.yml",
    "id: no-thing\nlanguage: TypeScript\nrule:\n  pattern: thing\n"
  );
  const shown = await run({ json: false });
  expect(shown.exitCode).toBe(0);
  expect(shown.output).toContain(
    "Local rules\n  rules  (cinch.toml: rules.local)"
  );
});

test("an action it does not have is refused", async () => {
  await config("enabled = true\n");
  const refused = await run({ action: "nope" });
  expect(refused.exitCode).toBe(2);
  expect(refused.error).toBe('cinch: unknown rules action "nope". Use list.');
});
