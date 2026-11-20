import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Inherited } from "../src/adapters/adapter.ts";
import { managedAdapter } from "../src/adapters/managed.ts";
import type { CommandRequest } from "../src/commands/command.ts";
import { createCommands } from "../src/commands/registry.ts";
import { STARTER_CONFIG } from "../src/commands/starter.ts";
import { FixReportSchema } from "../src/contracts/fix.ts";
import { PresetReportSchema } from "../src/contracts/preset.ts";

const KEPT = ".outfitter/configs/notes.toml";
const SHIPPED = "width = 80\n";

const OLD = "old-linter.json";

/** Stands in for a config the adapter takes over from. */
const oldLinter = async (dir: string): Promise<Inherited | null> => {
  const file = Bun.file(path.join(dir, OLD));
  if (!(await file.exists())) {
    return null;
  }
  const text = await file.text();
  return {
    exclude: text.includes("kept")
      ? [".outfitter/**"]
      : ["vendor", "vendor/**"],
    from: OLD,
    include: [],
    notes: [],
  };
};

const commands = createCommands({
  adapters: () => [
    managedAdapter({
      enabledBy: "markdown.preset",
      files: [
        {
          path: KEPT,
          want: () => Promise.resolve({ ok: true, text: SHIPPED }),
        },
      ],
      id: "notes-preset",
      inherits: oldLinter,
      preset: "notes",
    }),
  ],
});

let root = "";
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-preset-")));
  await mkdir(path.join(root, ".git"));
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

const textOf = async (name: string): Promise<string | null> => {
  const file = Bun.file(path.join(root, name));
  return (await file.exists()) ? await file.text() : null;
};

const statesOf = (output: string | undefined): string[] =>
  PresetReportSchema.parse(JSON.parse(output ?? "null")).presets.flatMap(
    (preset) => preset.files.map((file) => `${preset.name} ${file.state}`)
  );

test("init shows what it would write and writes nothing", async () => {
  const response = await run("init");
  const report = FixReportSchema.parse(JSON.parse(response.output ?? "null"));
  expect(report.dryRun).toBe(true);
  expect(report.changed).toEqual(["cinch.toml", KEPT]);
  expect(report.diff).toContain("+pilot = 0");
  expect(report.diff).toContain("+width = 80");
  expect(await textOf("cinch.toml")).toBeNull();
  expect(await textOf(KEPT)).toBeNull();
});

test("init only shows the change unless --yes is given", async () => {
  const hint =
    "Dry run: nothing was written. Run `cinch init --yes` to write this.";
  const plain = await run("init", { json: false });
  expect(plain.output).toEndWith(hint);
  const dry = await run("init", { dryRun: true, json: false });
  expect(dry.output).toBe(plain.output);
  await run("init", { dryRun: true, yes: true });
  expect(await textOf("cinch.toml")).toBeNull();
  await run("init", { yes: true });
  const settled = await run("init", { json: false });
  expect(settled.output).toEndWith("Nothing to set up.");
});

test("init --yes writes the config and the preset, once", async () => {
  const first = await run("init", { yes: true });
  expect(first.exitCode).toBe(0);
  expect(await textOf("cinch.toml")).toBe(STARTER_CONFIG);
  expect(await textOf(KEPT)).toBe(SHIPPED);
  expect(await run("check")).toMatchObject({ exitCode: 0 });
  const again = await run("init", { yes: true });
  const report = FixReportSchema.parse(JSON.parse(again.output ?? "null"));
  expect(report.changed).toEqual([]);
});

test("init carries the file choices of a config an adapter replaces", async () => {
  await Bun.write(path.join(root, OLD), "{}");
  const shown = await run("init");
  const report = FixReportSchema.parse(JSON.parse(shown.output ?? "null"));
  expect(report.diff).toContain('+  "vendor/**",');
  expect(await textOf("cinch.toml")).toBeNull();
  expect(await run("init", { yes: true })).toMatchObject({ exitCode: 0 });
  expect(await textOf("cinch.toml")).toContain(
    'exclude = [\n  "vendor",\n  "vendor/**",\n]'
  );
  expect(await run("check")).toMatchObject({ exitCode: 0 });
});

test("init does not carry an exclude that covers a file Cinch keeps", async () => {
  await Bun.write(path.join(root, OLD), '"kept"');
  const shown = await run("init");
  const report = FixReportSchema.parse(JSON.parse(shown.output ?? "null"));
  expect(report.changed).toEqual(["cinch.toml", KEPT]);
  expect(await run("init", { yes: true })).toMatchObject({ exitCode: 0 });
  expect(await textOf(KEPT)).toBe(SHIPPED);
  const config = (await textOf("cinch.toml")) ?? "";
  expect(config).not.toContain("exclude = [");
  expect(config).toContain(
    `# From ${OLD}: ".outfitter/**" was not carried over, because it would leave out ${KEPT}, which Cinch keeps.`
  );
});

test("init keeps a config that is already there", async () => {
  const mine = 'pilot = 0\nexclude = ["vendor/**"]\n';
  await Bun.write(path.join(root, "cinch.toml"), mine);
  const response = await run("init", { yes: true });
  const report = FixReportSchema.parse(JSON.parse(response.output ?? "null"));
  expect(report.changed).toEqual([KEPT]);
  expect(await textOf("cinch.toml")).toBe(mine);
});

test("preset lists a copy as missing, current and then stale", async () => {
  const missing = await run("preset");
  expect(statesOf(missing.output)).toEqual(["notes missing"]);
  expect(missing.exitCode).toBe(1);
  await run("preset", { action: "add", paths: ["notes"] });
  expect(await textOf(KEPT)).toBe(SHIPPED);
  const current = await run("preset");
  expect(statesOf(current.output)).toEqual(["notes current"]);
  expect(current.exitCode).toBe(0);
  await Bun.write(path.join(root, KEPT), "width = 100\n");
  const stale = await run("preset");
  expect(statesOf(stale.output)).toEqual(["notes stale"]);
});

test("preset update rewrites a stale copy, and a dry run does not", async () => {
  await Bun.write(path.join(root, KEPT), "width = 100\n");
  const preview = await run("preset", { action: "update", dryRun: true });
  const report = FixReportSchema.parse(JSON.parse(preview.output ?? "null"));
  expect(report.changed).toEqual([KEPT]);
  expect(await textOf(KEPT)).toBe("width = 100\n");
  const applied = await run("preset", { action: "update" });
  expect(applied.exitCode).toBe(0);
  expect(await textOf(KEPT)).toBe(SHIPPED);
});

test("a preset the config switches off is listed as off and not written", async () => {
  await Bun.write(
    path.join(root, "cinch.toml"),
    "pilot = 0\n[markdown]\npreset = false\n"
  );
  const listed = await run("preset");
  expect(statesOf(listed.output)).toEqual(["notes off"]);
  const response = await run("preset", { action: "add", paths: ["notes"] });
  expect(response.exitCode).toBe(2);
  expect(response.error).toContain("switched off");
  expect(await textOf(KEPT)).toBeNull();
});

test("preset rejects a name or an action it does not know", async () => {
  const name = await run("preset", { action: "add", paths: ["nope"] });
  expect(name).toMatchObject({ exitCode: 2 });
  expect(name.error).toContain('no preset named "nope". Cinch ships: notes.');
  expect(await run("preset", { action: "add" })).toMatchObject({ exitCode: 2 });
  const action = await run("preset", { action: "remove" });
  expect(action.error).toContain('unknown preset action "remove"');
});

test("a file the config leaves out is blocked, and nothing is written past it", async () => {
  await Bun.write(
    path.join(root, "cinch.toml"),
    `pilot = 0\nexclude = ["${KEPT}"]\n`
  );
  const listed = await run("preset");
  expect(statesOf(listed.output)).toEqual(["notes blocked"]);
  expect(listed.exitCode).toBe(1);
  const response = await run("preset", { action: "update" });
  expect(response.exitCode).toBe(2);
  expect(response.error).toContain(KEPT);
  expect(response.error).toContain("exclude");
  expect(await textOf(KEPT)).toBeNull();
});

test("init that cannot plan writes nothing, not even the config", async () => {
  await Bun.write(path.join(root, "mise.toml"), "[tools\n");
  const response = await run("init", { yes: true });
  expect(response.exitCode).toBe(2);
  expect(await textOf("cinch.toml")).toBeNull();
  expect(await textOf(KEPT)).toBeNull();
});
