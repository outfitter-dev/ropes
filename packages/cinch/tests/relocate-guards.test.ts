import { afterAll, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { adaptersFor } from "../src/adapters/registry.ts";
import { createCommands } from "../src/commands/registry.ts";
import {
  CINCH,
  CONFIG,
  EXTENDS,
  ROOT,
  cleanUp,
  move,
  read,
  repo,
} from "./relocate-repo.ts";

const PRESET = ".outfitter/configs/presets/rumdl.toml";
const TABLE = `${CONFIG}\n[tools.rumdl.MD007]\nindent = 4\n`;
const extra: string[] = [];

afterAll(async () => {
  await cleanUp();
  await Promise.all(
    extra.map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

const ELSEWHERE = {
  ".config/rumdl.toml": "[MD013]\nline-length = 120\n",
  "pyproject.toml": "[tool.rumdl.MD013]\nline-length = 120\n",
  "rumdl.toml": "[MD013]\nline-length = 120\n",
};

test.each(Object.entries(ELSEWHERE))(
  "eject does not write a root config that would hide %s",
  async (name, text) => {
    const root = await repo({ [CINCH]: TABLE, [name]: text });
    const { exitCode, report } = await move(root, "eject", { yes: true });
    expect(exitCode).toBe(1);
    expect(report.stopped?.[0]).toContain(name);
    expect(report.changed).toEqual([]);
    expect(await Bun.file(path.join(root, ROOT)).exists()).toBe(false);
    expect(await read(root, CINCH)).toBe(TABLE);
  }
);

test("eject stops on a table that sets `extends`, and writes nothing", async () => {
  const held = `${CONFIG}\n[tools.rumdl]\nextends = "custom.toml"\n`;
  const root = await repo({ [CINCH]: held });
  const before = await read(root, ROOT);
  const { exitCode, report } = await move(root, "eject", { yes: true });
  expect(exitCode).toBe(1);
  expect(report.stopped?.[0]).toContain("extends");
  expect(await read(root, CINCH)).toBe(held);
  expect(await read(root, ROOT)).toBe(before);
});

test("adopt stops while the installed preset is not the one Cinch ships", async () => {
  const own = `${EXTENDS}\n[MD007]\nindent = 2\n`;
  const root = await repo({ [ROOT]: own });
  const installed = await read(root, PRESET);
  await Bun.write(
    path.join(root, PRESET),
    `${installed}\n[MD007]\nindent = 4\n`
  );
  const { exitCode, report } = await move(root, "adopt", { yes: true });
  expect(exitCode).toBe(1);
  expect(report.stopped?.[0]).toContain("rope doctor --fix");
  expect(await read(root, ROOT)).toBe(own);
});

test("a move whose result cannot be checked is incomplete, not findings", async () => {
  const root = await repo({ [CINCH]: TABLE });
  // The keeper answers for no file, as it does when it cannot read one.
  const blind = createCommands({
    adapters: (...given) =>
      adaptersFor(...given).map((adapter) =>
        adapter.descriptor.preset === "markdown"
          ? { ...adapter, check: () => Promise.resolve([]) }
          : adapter
      ),
  });
  const response = await blind.preset?.({
    action: "eject",
    cwd: root,
    json: true,
    paths: ["markdown"],
    yes: true,
  });
  expect(JSON.parse(response?.output ?? "{}")).toMatchObject({ written: true });
  expect(response?.exitCode).toBe(2);
});

test("a comment on a setting's own line is named when the setting is left out", async () => {
  const own = `${EXTENDS}\n[MD004]\nstyle = "dash" # we like dashes\n\n[MD007] # ours\nindent = 4\n`;
  const root = await repo({ [ROOT]: own });
  const { report } = await move(root, "adopt");
  expect(report.notes.join("\n")).toContain('style = "dash" # we like dashes');
  expect(report.notes.join("\n")).not.toContain("# ours");
  expect(report.diff).toContain("+[tools.rumdl.MD007] # ours");
});

test("a Cinch config linked from outside the repository is not written", async () => {
  const outside = await realpath(
    await mkdtemp(path.join(tmpdir(), "cinch-out-"))
  );
  extra.push(outside);
  const target = path.join(outside, CINCH);
  await Bun.write(target, CONFIG);
  const own = `${EXTENDS}\n[MD007]\nindent = 4\n`;
  const root = await repo({ [ROOT]: own });
  await rm(path.join(root, CINCH));
  await symlink(target, path.join(root, CINCH));
  const failed = await move(root, "adopt", { yes: true })
    .then(() => "")
    .catch(String);
  expect(failed).toContain("cinch.toml leads outside the repository");
  expect(await Bun.file(target).text()).toBe(CONFIG);
  expect(await read(root, ROOT)).toBe(own);
});
