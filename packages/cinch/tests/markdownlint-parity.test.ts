import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { gathered } from "../src/adapters/rumdl/migrate/markdownlint/rules.ts";
import {
  CONFIG_PATH,
  GENERATED_PATH,
  PRESET_PATH,
  rumdlPresetAdapter,
} from "../src/adapters/rumdl/preset.ts";
import { markdownlintParity } from "./markdownlint-parity.ts";
import { fixOne } from "./one-file.ts";

test("a missing legacy engine cannot produce a clean comparison", async () => {
  const report = await markdownlintParity({
    knownRules: [],
    legacyCommand: path.join(
      tmpdir(),
      "missing-ropes-markdownlint",
      "markdownlint"
    ),
    legacyConfig: ".markdownlint.json",
    paths: ["notes.md"],
    root: tmpdir(),
  });
  expect(report).toEqual({
    reason: "markdownlint is not on PATH",
    status: "incomplete",
  });
});

test("compares the legacy and migrated Markdown engines on the same files", async () => {
  if (Bun.which("rumdl") === null || Bun.which("markdownlint") === null) {
    console.warn(
      "skipped: the Markdown migration parity fixture needs rumdl and markdownlint on PATH"
    );
    return;
  }
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "ropes-parity-"))
  );
  const legacyConfig = ".markdownlint.json";
  const paths = ["notes.md", "clean.md"];
  try {
    await mkdir(path.join(root, ".git"));
    await Promise.all([
      Bun.write(
        path.join(root, legacyConfig),
        JSON.stringify({
          default: false,
          "line-length": { line_length: 16 },
        })
      ),
      Bun.write(path.join(root, ".markdownlintignore"), "notes.md\n"),
      Bun.write(
        path.join(root, "notes.md"),
        "# Notes\n\nThis line is too long.\n\nText. \n"
      ),
      Bun.write(path.join(root, "clean.md"), "# Clean\n\nText.\n"),
    ]);
    const preset = rumdlPresetAdapter();
    const stock = await fixOne(preset, { path: PRESET_PATH, root });
    const generated = await fixOne(preset, { path: GENERATED_PATH, root });
    const migrated = await fixOne(preset, { path: CONFIG_PATH, root });
    expect([stock.status, generated.status, migrated.status]).toEqual([
      "fixed",
      "fixed",
      "fixed",
    ]);
    const presetText = await Bun.file(path.join(root, PRESET_PATH)).text();
    const migration = await gathered(root, presetText);
    if (migration === null || !migration.ok) {
      throw new Error("expected a usable Markdown rule translation");
    }
    const input = { knownRules: migration.known, legacyConfig, paths, root };
    expect(await markdownlintParity(input)).toEqual({
      markdownlintOnly: [],
      rumdlOnly: [],
      status: "complete",
    });

    // Defer line-length to the old linter and introduce a new whitespace
    // requirement in the rumdl config, leaving the fixture's files alone.
    await Bun.write(
      path.join(root, CONFIG_PATH),
      `[global]
enable = ["MD009"]
`
    );
    expect(await markdownlintParity(input)).toEqual({
      markdownlintOnly: [{ line: 3, path: "notes.md", rule: "MD013" }],
      rumdlOnly: [{ line: 5, path: "notes.md", rule: "MD009" }],
      status: "complete",
    });

    const brokenConfig = "broken.json";
    await Bun.write(path.join(root, brokenConfig), "{");
    const broken = await markdownlintParity({
      ...input,
      legacyConfig: brokenConfig,
    });
    if (broken.status !== "incomplete") {
      throw new Error(
        "expected malformed configuration to stop the comparison"
      );
    }
    expect(broken.reason).toContain("markdownlint failed (exit 4)");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
