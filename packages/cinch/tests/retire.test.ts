import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Inherited, Retired } from "../src/adapters/adapter.ts";
import { managedAdapter } from "../src/adapters/managed.ts";
import type { CommandRequest } from "../src/commands/command.ts";
import { createCommands } from "../src/commands/registry.ts";
import { InitReportSchema } from "../src/contracts/init.ts";

const KEPT = ".outfitter/configs/notes.toml";
const OLD = "old-linter.json";
const HAND = "Remove it by hand.";

let root = "";
const exists = (name: string): Promise<boolean> =>
  Bun.file(path.join(root, name)).exists();
const put = (name: string, text: string): Promise<number> =>
  Bun.write(path.join(root, name), text);

/** The old file's text decides what the stand-in adapter says about it. */
const retires = async (dir: string): Promise<Retired | null> => {
  const file = Bun.file(path.join(dir, OLD));
  if (!(await file.exists())) {
    return null;
  }
  const text = await file.text();
  return {
    files: [OLD],
    keep: text.includes("custom") ? [HAND] : [],
    leftovers: text.includes("hook") ? ["A hook still calls it."] : [],
  };
};

const inherits = async (dir: string): Promise<Inherited | null> => {
  const file = Bun.file(path.join(dir, OLD));
  const text = (await file.exists()) ? await file.text() : "";
  return text.includes("glob")
    ? { exclude: ["vendor/**"], from: OLD, include: [], notes: [] }
    : null;
};

const commands = createCommands({
  adapters: () => [
    managedAdapter({
      enabledBy: "markdown.preset",
      files: [
        {
          path: KEPT,
          want: async (_current, dir) =>
            (await Bun.file(path.join(dir, "broken")).exists())
              ? { message: "Cinch cannot keep this file.", ok: false }
              : { ok: true, text: "width = 80\n" },
        },
      ],
      id: "notes-preset",
      inherits,
      preset: "notes",
      retires,
    }),
  ],
});

const init = async (request: Partial<CommandRequest> = {}) => {
  const response = await commands.init?.({
    cwd: root,
    json: true,
    paths: [],
    ...request,
  });
  return InitReportSchema.parse(JSON.parse(response?.output ?? "null")).retired;
};

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-retire-")));
  await mkdir(path.join(root, ".git"));
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

test("with no old config there is nothing to report", async () => {
  expect(await init({ yes: true })).toEqual({
    files: [],
    leftovers: [],
    reasons: [],
    removed: false,
  });
});

test("the preview names the old file and leaves it there", async () => {
  await put(OLD, "{}");
  expect(await init()).toMatchObject({ files: [OLD], removed: true });
  expect(await exists(OLD)).toBe(true);
  const shown = await commands.init?.({ cwd: root, json: false, paths: [] });
  expect(shown?.output).toContain(
    `Old config files \`cinch init --yes\` will remove:\n  ${OLD}`
  );
  expect(shown?.output).toEndWith("Run `cinch init --yes` to write this.");
});

test("--yes removes an old file that was carried over whole", async () => {
  await put(OLD, "{}");
  expect(await init({ yes: true })).toMatchObject({
    files: [OLD],
    removed: true,
  });
  expect(await exists(OLD)).toBe(false);
  expect(await exists(KEPT)).toBe(true);
});

test("an old file that ignores hide is still there in the preview's copy", async () => {
  await put(OLD, "{}");
  await put(".gitignore", `${OLD}\n`);
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  expect(await init()).toMatchObject({ files: [OLD], removed: true });
});

test("a reason from the adapter keeps the old file, and is given", async () => {
  await put(OLD, "custom hook");
  expect(await init({ yes: true })).toEqual({
    files: [OLD],
    leftovers: ["A hook still calls it."],
    reasons: [HAND],
    removed: false,
  });
  expect(await exists(OLD)).toBe(true);
  const shown = await commands.init?.({ cwd: root, json: false, paths: [] });
  expect(shown?.output).toContain(
    `Old config files left in place:\n  ${OLD}\n\nThey stay because:\n  ${HAND}\n\nStill here, and not removed by Cinch:\n  A hook still calls it.`
  );
});

test("file choices a config that is already here did not get keep it", async () => {
  await put(OLD, "glob");
  await put("cinch.toml", "pilot = 0\n");
  const retired = await init({ yes: true });
  expect(retired.removed).toBe(false);
  expect(retired.reasons).toEqual([
    `The files ${OLD} chose were not carried over, because a Cinch config is already here. Add them to it by hand.`,
  ]);
  expect(await exists(OLD)).toBe(true);
});

test("file choices written into a new config do not keep it", async () => {
  await put(OLD, "glob");
  expect(await init({ yes: true })).toMatchObject({ removed: true });
  expect(await exists(OLD)).toBe(false);
});

test("a setup that did not end clean removes nothing", async () => {
  await put(OLD, "{}");
  await put("broken", "");
  const retired = await init({ yes: true });
  expect(retired.removed).toBe(false);
  expect(retired.reasons[0]).toStartWith("The setup did not finish");
  expect(await exists(OLD)).toBe(true);
});

test("a preset that is switched off is not asked", async () => {
  await put(OLD, "{}");
  await put("cinch.toml", "pilot = 0\n\n[markdown]\npreset = false\n");
  expect(await init({ yes: true })).toMatchObject({
    files: [],
    removed: false,
  });
  expect(await exists(OLD)).toBe(true);
});
