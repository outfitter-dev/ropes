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

test("an empty Markdown selection cannot produce a clean comparison", async () => {
  const report = await markdownlintParity({
    knownRules: [],
    paths: [],
    root: tmpdir(),
  });
  expect(report).toEqual({
    reason: "no Markdown files were selected",
    status: "incomplete",
  });
});

test("compares the legacy and migrated Markdown engines on the same files", async () => {
  if (Bun.which("rumdl") === null) {
    if (Bun.env.CI === "true") {
      throw new Error("CI must install the pinned rumdl for Markdown parity");
    }
    console.warn(
      "skipped: the Markdown migration parity fixture needs rumdl on PATH"
    );
    return;
  }
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "ropes-parity-"))
  );
  const legacyConfig = ".markdownlint.jsonc";
  const paths = ["notes.md", "clean.md"];
  try {
    await mkdir(path.join(root, ".git"));
    await Promise.all([
      Bun.write(
        path.join(root, legacyConfig),
        `{
  // Keep the old setting to exercise the migration's JSONC reader.
  "default": false,
  "line-length": { "line_length": 16 },
}
`
      ),
      Bun.write(path.join(root, ".markdownlintignore"), "notes.md\n"),
      Bun.write(path.join(root, ".markdownlintrc"), '{"MD009":true}'),
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
    const input = { knownRules: migration.known, paths, root };
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

    await Bun.write(path.join(root, legacyConfig), "{");
    const broken = await markdownlintParity(input);
    if (broken.status !== "incomplete") {
      throw new Error(
        "expected malformed configuration to stop the comparison"
      );
    }
    expect(broken.reason).toContain(
      `could not read the old Markdown rules in ${legacyConfig}`
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
