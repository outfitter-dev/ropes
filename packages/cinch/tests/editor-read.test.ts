import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { EDITOR_PATH } from "../src/adapters/editorconfig/adapter.ts";
import { readFile } from "../src/adapters/editorconfig/read.ts";
import { MARK, render } from "../src/adapters/editorconfig/render.ts";
import { tableOf } from "../src/adapters/editorconfig/source.ts";
import { adaptersFor } from "../src/adapters/registry.ts";
import type { CommandRequest } from "../src/commands/command.ts";
import { createCommands } from "../src/commands/registry.ts";
import { STARTER_CONFIG, starterConfig } from "../src/commands/starter.ts";
import { parseConfigTable } from "../src/config/parse.ts";
import { DoctorReportSchema } from "../src/contracts/doctor.ts";

const HAND = [
  "root = true",
  "",
  "[*]",
  "charset = utf-8",
  "indent_style = space",
  "indent_size = 2",
  "end_of_line = LF",
  "insert_final_newline = true",
  "trim_trailing_whitespace = true",
  "max_line_length = 100",
  "",
  "[Makefile]",
  "indent_style = tab",
  "",
  "[*.{md,mdx}]",
  "trim_trailing_whitespace = false",
  "",
].join("\n");

test("the section for every file becomes the base facts and the rest overrides", () => {
  expect(readFile(HAND)).toEqual({
    comments: [],
    dropped: [],
    lost: [],
    settings: {
      charset: "utf-8",
      end_of_line: "lf",
      final_newline: true,
      indent_size: 2,
      indent_style: "space",
      line_width: 100,
      overrides: [
        { files: ["Makefile"], indent_style: "tab" },
        { files: ["*.{md,mdx}"], trim_trailing_whitespace: false },
      ],
      trim_trailing_whitespace: true,
    },
  });
});

test("what the table cannot hold is listed and left out", () => {
  const read = readFile(
    [
      "# house style",
      "root = false",
      "[*]",
      "indent_size = tab",
      "tab_width = 4",
      "max_line_length = off",
      "indent_style = space",
      "[[Mm]akefile]",
      "indent_style = tab",
      "[*.go]",
      "indent_style = tab",
      "[*]",
      "charset = utf-8",
      "nonsense",
    ].join("\n")
  );
  expect(read.settings).toEqual({
    indent_style: "space",
    overrides: [{ files: ["*.go"], indent_style: "tab" }],
  });
  expect(read.dropped).toEqual([
    "`indent_size = tab` in `[*]`",
    "`tab_width = 4` in `[*]`",
    "`max_line_length = off` in `[*]`",
    "line 14, which Cinch could not read",
    "the settings of a `.editorconfig` in a folder above, which apply until this file states `root = true`",
    "the section `[[Mm]akefile]`, whose glob the table cannot state",
    "a `[*]` section below a narrower one, where it wins over that one",
    "the comments on lines 1",
  ]);
});

test("the table written for a config states the facts the file stated", () => {
  const config = starterConfig([
    {
      exclude: [],
      from: EDITOR_PATH,
      include: [],
      kinds: [],
      notes: [],
      tables: tableOf(HAND),
    },
  ]);
  const parsed = parseConfigTable(Bun.TOML.parse(config), {
    file: "cinch.toml",
    prefix: "",
  });
  if (!parsed.ok || parsed.value.editor === undefined) {
    throw new Error("the starter config did not parse with an editor table");
  }
  expect(render(parsed.value.editor)).toBe(render(readFile(HAND).settings));
  expect(config.startsWith(STARTER_CONFIG)).toBe(true);
});

let root = "";
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-read-")));
  await mkdir(path.join(root, ".git"));
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

const put = (file: string, text: string): Promise<number> =>
  Bun.write(path.join(root, file), text);
const text = (file: string): Promise<string> =>
  Bun.file(path.join(root, file)).text();

const run = (verb: string, request: Partial<CommandRequest> = {}) => {
  const command = createCommands({ adapters: adaptersFor })[verb];
  if (!command) {
    throw new Error(`no command ${verb}`);
  }
  return command({ cwd: root, json: true, paths: [], ...request });
};

/** Everything else off, so the checks after `init` need no engine. */
const quiet = async (): Promise<void> => {
  const config = await text("cinch.toml");
  await put(
    "cinch.toml",
    config
      .replace(
        "[markdown]\nenabled = true\npreset = true",
        "[markdown]\nenabled = false\npreset = false"
      )
      .replace("[toml]\nenabled = true", "[toml]\nenabled = false")
  );
};

const messages = async (): Promise<string[]> => {
  const response = await run("doctor");
  const report = DoctorReportSchema.parse(JSON.parse(response.output ?? ""));
  return report.result.steps.flatMap((step) =>
    step.findings.map((finding) => finding.message)
  );
};

test("init reads a hand-written file into the table and leaves the file", async () => {
  await put(EDITOR_PATH, HAND);
  await run("init", { yes: true });
  const config = await text("cinch.toml");
  expect(config).toContain(
    '[editor]\ncharset = "utf-8"\nend_of_line = "lf"\nfinal_newline = true\nindent_size = 2\n'
  );
  expect(config).toContain(
    '[[editor.overrides]]\nfiles = ["Makefile"]\nindent_style = "tab"\n'
  );
  expect(await text(EDITOR_PATH)).toBe(HAND);
});

test("after init, doctor --fix writes the generated file", async () => {
  await put(EDITOR_PATH, HAND);
  await run("init", { yes: true });
  await quiet();
  expect(await messages()).toEqual([
    "This file was written by hand and states what `[editor]` in the Cinch config states. Run `cinch doctor --fix` to have Cinch write it from the table.",
  ]);
  const fixed = await run("doctor", { fix: true });
  expect(fixed.exitCode).toBe(0);
  const kept = await text(EDITOR_PATH);
  expect(kept.startsWith(MARK)).toBe(true);
  expect(kept).toBe(render(readFile(HAND).settings));
});

test("a file with something the table cannot hold is listed and never overwritten", async () => {
  const hand = `${HAND}[*.py]\ntab_width = 8\nindent_size = 4\n`;
  await put(EDITOR_PATH, hand);
  await run("init", { yes: true });
  expect(await text("cinch.toml")).toContain(
    "# Not carried over: `tab_width = 8` in `[*.py]`."
  );
  await quiet();
  const [message, ...rest] = await messages();
  expect(rest).toEqual([]);
  expect(message).toContain(
    "The table cannot hold `tab_width = 8` in `[*.py]`."
  );
  await run("doctor", { fix: true });
  expect(await text(EDITOR_PATH)).toBe(hand);
});

test("a dry run shows the table and writes nothing", async () => {
  await put(EDITOR_PATH, HAND);
  const shown = await run("init");
  expect(shown.output).toContain("[editor]");
  expect(await Bun.file(path.join(root, "cinch.toml")).exists()).toBe(false);
});

test("a generated file is not read back into a new config", async () => {
  await put(EDITOR_PATH, render({ indent_size: 2 }));
  await run("init", { yes: true });
  expect(await text("cinch.toml")).toBe(STARTER_CONFIG);
});

test("a file that does not say it is the root keeps what it takes from above", async () => {
  const inheriting = "[*]\nindent_size = 2\n";
  expect(readFile(inheriting).lost).toEqual([
    "the settings of a `.editorconfig` in a folder above, which apply until this file states `root = true`",
  ]);
  expect(readFile(`root = false\n${inheriting}`).lost).toHaveLength(1);
  await put(EDITOR_PATH, inheriting);
  await run("init", { yes: true });
  await quiet();
  const [message] = await messages();
  expect(message).toContain("root = true");
  await run("doctor", { fix: true });
  expect(await text(EDITOR_PATH)).toBe(inheriting);
});

test("init does not carry an old exclude that leaves the editor file out", async () => {
  await put(EDITOR_PATH, HAND);
  await put(".markdownlint-cli2.jsonc", `{"ignores":["${EDITOR_PATH}"]}`);
  await run("init", { yes: true });
  const config = await text("cinch.toml");
  expect(config).toContain("[editor]");
  expect(config).toContain(`which Cinch keeps`);
  await quiet();
  const doctor = await run("doctor");
  expect(doctor.error).toBeUndefined();
});
