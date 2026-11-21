import { expect, test } from "bun:test";
import path from "node:path";

import { parseResult } from "@ropes/core";

import {
  json,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);
const CONFIG = `pilot = 0
include = ["**/*"]
[markdown]
enabled = false
preset = false
[toml]
enabled = false
[editor]
check = true
indent_size = 2
line_width = 5
final_newline = true
`;

test("the CLI checks empty files, independent indentation, Unicode, long lines and CR lines", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    await main.cinch(["doctor", "--fix", "--json"]);
    await Promise.all([
      Bun.write(path.join(main.root, "__init__.py"), ""),
      Bun.write(path.join(main.root, "unicode.txt"), "café!\n"),
      Bun.write(path.join(main.root, "indent.txt"), "   a\n"),
      Bun.write(path.join(main.root, "long.txt"), `${"x".repeat(70_000)}\n`),
      Bun.write(path.join(main.root, "cr.txt"), "ok\r   a\r"),
    ]);
    const ran = await runEntry(
      ROPE,
      [
        "check",
        "__init__.py",
        "unicode.txt",
        "indent.txt",
        "long.txt",
        "cr.txt",
        "--json",
      ],
      main.root
    );
    expect(ran.exitCode).toBe(1);
    const result = parseResult(json(ran));
    if (!result.ok) {
      throw new Error("expected an editor check result");
    }
    const steps = result.value.steps.filter(
      (step) => step.adapter === "editor-text"
    );
    expect(steps.find((step) => step.path === "__init__.py")?.status).toBe(
      "passed"
    );
    expect(steps.find((step) => step.path === "unicode.txt")?.status).toBe(
      "passed"
    );
    expect(
      steps
        .find((step) => step.path === "indent.txt")
        ?.findings.map((finding) => finding.rule)
    ).toEqual(["indent_size"]);
    expect(
      steps
        .find((step) => step.path === "long.txt")
        ?.findings.map((finding) => finding.rule)
    ).toEqual(["line_width"]);
    expect(
      steps.find((step) => step.path === "cr.txt")?.findings[0]?.range.start
        .line
    ).toBe(2);
  });
});

test("undecodable and binary selected files are incomplete without guessing their charset", async () => {
  await withFixture(async ({ main }) => {
    await Bun.write(path.join(main.root, "cinch.toml"), CONFIG);
    await main.cinch(["doctor", "--fix", "--json"]);
    await Bun.write(path.join(main.root, "bytes.txt"), new Uint8Array([0xff]));
    await Bun.write(
      path.join(main.root, "binary.bin"),
      new Uint8Array([0, 1, 2])
    );
    const ran = await runEntry(
      ROPE,
      ["check", "bytes.txt", "binary.bin", "--json"],
      main.root
    );
    expect(ran.exitCode).toBe(2);
    const result = parseResult(json(ran));
    if (!result.ok) {
      throw new Error("expected an incomplete result");
    }
    expect(
      result.value.steps.find((step) => step.path === "bytes.txt")?.reason
    ).toContain("not valid UTF-8");
    expect(
      result.value.steps.find((step) => step.path === "binary.bin")?.reason
    ).toContain("binary control");
  });
});
