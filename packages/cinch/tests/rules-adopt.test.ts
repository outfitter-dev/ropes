import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CommandRequest } from "../src/commands/command.ts";
import { commands } from "../src/commands/registry.ts";
import { namePacks } from "../src/config/rules-table.ts";
import { RulesAdoptReportSchema } from "../src/contracts/rules-report.ts";

let root = "";
const put = (name: string, text: string): Promise<number> =>
  Bun.write(path.join(root, name), text);
const config = (): Promise<string> =>
  Bun.file(path.join(root, "cinch.toml")).text();

const run = async (request: Partial<CommandRequest> = {}) => {
  const response = await commands.rules?.({
    action: "adopt",
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
  return RulesAdoptReportSchema.parse(JSON.parse(response.output ?? "null"));
};
const packsOf = (text: string, packs: readonly string[], prefix = "") => {
  const named = namePacks(text, prefix, packs);
  return named.ok ? named.text : named.reason;
};

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-adopt-")));
  await mkdir(path.join(root, ".git"));
  await put("tsconfig.json", "{}\n");
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

test("the preview names the packs that apply and writes nothing", async () => {
  const before = "pilot = 0\n\n[rules]\nenabled = true\n";
  await put("cinch.toml", before);
  expect(await report()).toMatchObject({
    adopted: ["config"],
    changed: ["cinch.toml"],
    written: false,
  });
  expect(await config()).toBe(before);
  const shown = await run({ json: false });
  expect(shown.output).toStartWith("Would adopt:\n  config\n\n");
  expect(shown.output).toContain('+packs = ["config"]');
  expect(shown.output).toEndWith(
    "Nothing was written. Run the same command with `--yes` to write it."
  );
});

test("--yes names them, and the pack then runs", async () => {
  await put("cinch.toml", "pilot = 0\n\n[rules]\nenabled = true\n");
  expect(await report({ yes: true })).toMatchObject({
    adopted: ["config"],
    written: true,
  });
  expect(await config()).toBe(
    'pilot = 0\n\n[rules]\nenabled = true\npacks = ["config"]\n'
  );
  expect(await report({ yes: true })).toMatchObject({
    adopted: [],
    changed: [],
    written: false,
  });
});

test("a repository with no config gets one that switches rules on", async () => {
  await report({ yes: true });
  expect(await config()).toEndWith(
    '\n\n[rules]\nenabled = true\npacks = ["config"]\n'
  );
  const listed = await commands.rules?.({ cwd: root, json: false, paths: [] });
  expect(listed?.output).toContain("config  on, since tsconfig.json is here");
});

test("a pack with nothing here is adopted only by name", async () => {
  await rm(path.join(root, "tsconfig.json"));
  await put("cinch.toml", "pilot = 0\n");
  const none = await report();
  expect(none.adopted).toEqual([]);
  const named = await report({ paths: ["config"] });
  expect(named.adopted).toEqual(["config"]);
});

test("a name nothing has is refused, and a pack that is off is not adopted", async () => {
  await put("cinch.toml", 'pilot = 0\n\n[rules]\noff = ["config"]\n');
  const unknown = await run({ paths: ["nope"] });
  expect(unknown.exitCode).toBe(2);
  expect(unknown.error).toBe('cinch: Cinch ships no rule pack named "nope".');
  const none = await report();
  expect(none.adopted).toEqual([]);
  const off = await run({ paths: ["config"], yes: true });
  expect(off.exitCode).toBe(1);
  expect(
    RulesAdoptReportSchema.parse(JSON.parse(off.output ?? "")).stopped
  ).toEqual([
    "config is turned off under `rules.off`. Take it out of that list first.",
  ]);
});

test("rules a person switched off stay off, and the report says so", async () => {
  await put(
    "cinch.toml",
    'pilot = 0\ninclude = ["**/*.json"]\n\n[rules]\nenabled = false\n'
  );
  const done = await report({ yes: true });
  expect(done.notes).toEqual([
    "Rules are switched off in cinch.toml (`enabled = false`), so the packs it names do not run yet.",
  ]);
  expect(await config()).toBe(
    'pilot = 0\ninclude = ["**/*.json"]\n\n[rules]\nenabled = false\npacks = ["config"]\n'
  );
});

test("the edit keeps every other line, comments included", () => {
  const text = [
    "pilot = 0",
    "",
    "# The rules.",
    "[rules] # ours",
    'local = ["rules"]',
    "packs = [",
    '  "old", # kept for now',
    "]",
    'off = ["config/a"]',
    "",
    "[markdown]",
    "enabled = true",
    "",
  ].join("\n");
  expect(packsOf(text, ["old", "config"])).toBe(
    [
      "pilot = 0",
      "",
      "# The rules.",
      "[rules] # ours",
      'local = ["rules"]',
      "enabled = true",
      'packs = ["old", "config"]',
      'off = ["config/a"]',
      "",
      "[markdown]",
      "enabled = true",
      "",
    ].join("\n")
  );
});

test("a table without the switch gets it, under a prefix too", () => {
  expect(
    packsOf(
      '[cinch]\npilot = 0\n\n[cinch.rules]\nlocal = ["r"]\n',
      ["config"],
      "cinch."
    )
  ).toBe(
    '[cinch]\npilot = 0\n\n[cinch.rules]\nenabled = true\npacks = ["config"]\nlocal = ["r"]\n'
  );
});

test("an empty list without the switch gets the switch with its packs", () => {
  expect(packsOf("pilot = 0\n\n[rules]\npacks = []\n", ["config"])).toBe(
    'pilot = 0\n\n[rules]\nenabled = true\npacks = ["config"]\n'
  );
  expect(packsOf("[rules]\npacks = []\nenabled = false\n", ["config"])).toBe(
    '[rules]\npacks = ["config"]\nenabled = false\n'
  );
});

test("a config that leads out of the repository is not written", async () => {
  const elsewhere = await realpath(
    await mkdtemp(path.join(tmpdir(), "cinch-out-"))
  );
  try {
    const real = path.join(elsewhere, "cinch.toml");
    const before = "pilot = 0\n\n[rules]\nenabled = true\n";
    await Bun.write(real, before);
    await symlink(real, path.join(root, "cinch.toml"));
    const response = await run({ yes: true });
    expect(response.exitCode).toBe(2);
    expect(response.error).toBe(
      "cinch: cinch.toml leads outside the repository, so Cinch will not write it."
    );
    expect(await Bun.file(real).text()).toBe(before);
  } finally {
    await rm(elsewhere, { force: true, recursive: true });
  }
});

test("a config with CRLF endings keeps them on every line", () => {
  expect(
    packsOf("pilot = 0\r\n\r\n[rules]\r\nenabled = true\r\n", ["config"])
  ).toBe(
    'pilot = 0\r\n\r\n[rules]\r\nenabled = true\r\npacks = ["config"]\r\n'
  );
  expect(packsOf("pilot = 0\r\n", ["config"])).toBe(
    'pilot = 0\r\n\r\n[rules]\r\nenabled = true\r\npacks = ["config"]\r\n'
  );
  expect(packsOf("pilot = 0\r\n\n[rules]\n", ["config"])).toStartWith(
    "The file mixes line endings, so Cinch will not edit it."
  );
});

test("rules written another way are left for a person", () => {
  expect(packsOf("pilot = 0\nrules = { enabled = true }\n", ["config"])).toBe(
    'The rules settings are not in a `[rules]` table of their own. Add `packs = ["config"]` under `[rules]` by hand.'
  );
});

test("adopting a pack whose files the config leaves out says so", async () => {
  await put("cinch.toml", "pilot = 0\n\n[rules]\nenabled = true\n");
  expect(await report().then((one) => one.notes)).toEqual([
    'config will not run yet: cinch.toml leaves out the files it reads, such as tsconfig.json. Add "**/tsconfig.json" to `include` to run it.',
  ]);
  await put(
    "cinch.toml",
    'pilot = 0\ninclude = ["**/*.json"]\nexclude = ["tsconfig.json"]\n'
  );
  expect(await report().then((one) => one.notes)).toEqual([
    "config will not run yet: cinch.toml leaves out the files it reads, such as tsconfig.json. Take them out of `exclude` to run it.",
  ]);
});

test("a pack with one file the config covers gets no such note", async () => {
  await put("pkg/tsconfig.json", "{}\n");
  await put("cinch.toml", 'pilot = 0\ninclude = ["pkg/**/*.json"]\n');
  expect(await report().then((one) => one.notes)).toEqual([]);
});

test("a kept preset the plan covers still notes the files left beside it", async () => {
  await put(".outfitter/configs/presets/tsconfig.json", "{}\n");
  await put(
    "cinch.toml",
    "pilot = 0\n\n[rules]\nenabled = true\n\n[typescript]\npreset = true\n"
  );
  expect(await report().then((one) => one.notes)).toEqual([
    'config will not run yet: cinch.toml leaves out the files it reads, such as tsconfig.json. Add "**/tsconfig.json" to `include` to run it.',
  ]);
});

test("the same note is given from a directory under the root", async () => {
  await put("cinch.toml", "pilot = 0\n\n[rules]\nenabled = true\n");
  await mkdir(path.join(root, "docs"));
  const below = await report({ cwd: path.join(root, "docs") });
  expect(below.notes).toEqual([
    'config will not run yet: cinch.toml leaves out the files it reads, such as tsconfig.json. Add "**/tsconfig.json" to `include` to run it.',
  ]);
});
