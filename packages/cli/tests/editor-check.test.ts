import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parsePlan, parseResult } from "@ropes/core";

import {
  json,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);
const CONFIG = `pilot = 0
include = ["**/*"]
[markdown]
preset = false
[toml]
enabled = false
[editor]
check = true
indent_style = "space"
indent_size = 2
end_of_line = "lf"
final_newline = true
trim_trailing_whitespace = true
[[editor.overrides]]
files = ["Makefile"]
indent_style = "tab"
`;

test("the plan fills editor gaps only after explicit adoption", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(
      path.join(main.root, "cinch.toml"),
      `${CONFIG}
[format]
enabled = true
[[overrides]]
paths = ["off.json"]
[overrides.format]
enabled = false
`
    );
    for (const file of [
      "a.txt",
      "source.py",
      "Makefile",
      "on.json",
      "off.json",
      "doc.md",
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await Bun.write(path.join(main.root, file), "");
    }
    const explained = await runEntry(ROPE, ["explain", "--json"], main.root);
    const parsed = parsePlan(json(explained));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("expected a usable plan");
    }
    const editors = parsed.value.paths
      .filter((file) =>
        file.steps.some((step) => step.adapter === "editor-text")
      )
      .map((file) => file.path);
    expect(editors).toContain("a.txt");
    expect(editors).toContain("source.py");
    expect(editors).toContain("Makefile");
    expect(editors).toContain("off.json");
    expect(editors).not.toContain("on.json");
    expect(editors).not.toContain("doc.md");
    expect(editors).not.toContain(".editorconfig");

    await Bun.write(
      path.join(main.root, "cinch.toml"),
      CONFIG.replace("check = true\n", "")
    );
    const disabled = await runEntry(
      ROPE,
      ["explain", "a.txt", "--json"],
      main.root
    );
    expect(disabled.stdout).not.toContain('"adapter": "editor-text"');
  });
});

test("editor findings name settings and preserve the worktree and index", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    const dirty = path.join(main.root, "nested/[literal]/file.txt");
    await Bun.write(dirty, "\tbad ");
    await Bun.write(path.join(main.root, "Makefile"), "\tgood\n");
    const before = await readFile(dirty);
    const indexBefore = await readFile(path.join(main.root, ".git/index"));
    const ran = await runEntry(
      ROPE,
      ["check", "nested/[literal]/file.txt", "Makefile", "--json"],
      main.root
    );
    const parsed = parseResult(json(ran));
    expect(ran.exitCode).toBe(1);
    if (!parsed.ok) {
      throw new Error("expected a result");
    }
    const editor = parsed.value.steps.filter(
      (step) => step.adapter === "editor-text"
    );
    expect(editor.find((step) => step.path === "Makefile")?.status).toBe(
      "passed"
    );
    const failing = editor.find(
      (step) => step.path === "nested/[literal]/file.txt"
    );
    expect(failing?.findings.map((finding) => finding.rule).toSorted()).toEqual(
      ["final_newline", "indent_style", "trim_trailing_whitespace"]
    );
    expect(
      failing?.findings.every((finding) => finding.message.includes("[editor]"))
    ).toBe(true);
    expect(await readFile(dirty)).toEqual(before);
    expect(await readFile(path.join(main.root, ".git/index"))).toEqual(
      indexBefore
    );
  });
});

test("the built-in editor checker runs without an external executable", async () => {
  await withFixture(async ({ main, emptyPath }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    await Bun.write(path.join(main.root, "a.txt"), "clean\n");
    await main.rope(["doctor", "--fix", "--json"]);
    const ran = await runEntry(
      ROPE,
      ["check", "a.txt", "--json"],
      main.root,
      emptyPath
    );
    expect(ran.exitCode).toBe(0);
    const parsed = parseResult(json(ran));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(
        parsed.value.steps.find((step) => step.adapter === "editor-text")
          ?.status
      ).toBe("passed");
    }
  });
});
