import { expect, test } from "bun:test";
import { chmod, mkdir, realpath, symlink } from "node:fs/promises";
import path from "node:path";

import { parsePlan, parseResult } from "@ropes/core";

import {
  fixtureGit,
  json,
  runEntry,
  withFixture,
} from "../../cinch/tests/acceptance-repo.ts";

const ROPE = new URL("../src/cli.ts", import.meta.url);
const AT = "2099-01-01T00:00:00.000Z";
const PATHS = [
  "docs/first.md",
  "docs/second.md",
  "excluded/old.md",
  "app.toml",
];

test("check accounts for the explained batches, exclusions and unavailable engines without writes", async () => {
  await withFixture(async ({ main }) => {
    const tools = path.join(main.root, "..", "coverage-tools");
    const log = path.join(main.root, "..", "coverage-invocations.jsonl");
    await mkdir(tools);
    const git = Bun.which("git");
    if (git === null) {
      throw new Error("The CLI coverage proof requires Git on PATH");
    }
    await symlink(await realpath(git), path.join(tools, "git"));
    const engine = path.join(tools, "rumdl");
    await Bun.write(
      engine,
      `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
if (args[0] === "--version") {
  console.log("rumdl 0.3.5");
} else if (args[0] === "check") {
  console.log("[]");
} else if (args[0] === "config") {
  console.log("");
} else {
  process.exitCode = 2;
}
`
    );
    await chmod(engine, 0o755);
    await Bun.write(
      path.join(main.root, "cinch.toml"),
      'pilot = 0\ninclude = ["**/*.md", "**/*.toml"]\nexclude = ["excluded/**"]\n[markdown]\nenabled = true\npreset = false\n[toml]\nenabled = true\n'
    );
    await Promise.all(
      PATHS.map((file) =>
        Bun.write(
          path.join(main.root, file),
          file.endsWith(".toml") ? "a = 1\n" : "# Guide\n"
        )
      )
    );
    await fixtureGit(main.root, "add", "--all");
    // Leave a worktree edit alongside a different staged version.
    await Bun.write(
      path.join(main.root, "docs/second.md"),
      "# Unstaged guide\n"
    );
    const before = await main.files();
    const index = new Uint8Array(
      await Bun.file(path.join(main.root, ".git/index")).arrayBuffer()
    );
    expect(Bun.which("taplo", { PATH: tools })).toBeNull();
    const run = (verb: string) =>
      runEntry(ROPE, [verb, ...PATHS, "--at", AT, "--json"], main.root, tools);
    const explained = await run("explain");
    expect(explained.exitCode).toBe(0);
    expect(explained.stderr).toBe("");
    expect(await Bun.file(log).exists()).toBe(false);
    const plan = parsePlan(json(explained));
    if (!plan.ok) {
      throw new Error(JSON.stringify(plan.error));
    }
    const checked = await run("check");
    expect(checked.exitCode).toBe(2);
    expect(checked.stderr).toBe("");
    const result = parseResult(json(checked));
    if (!result.ok) {
      throw new Error(JSON.stringify(result.error));
    }
    expect(result.value.plan).toEqual(plan.value);
    expect(result.value.outcome).toBe("incomplete");
    expect(
      plan.value.paths.find((file) => file.path === "excluded/old.md")
    ).toMatchObject({
      skipped: {
        reason: "excluded",
        source: { file: "cinch.toml", key: "exclude" },
      },
      steps: [],
    });
    const required = plan.value.paths.flatMap((file) =>
      file.steps.map((step) => ({ adapter: step.adapter, path: file.path }))
    );
    expect(required).toEqual([
      { adapter: "taplo", path: "app.toml" },
      { adapter: "rumdl", path: "docs/first.md" },
      { adapter: "rumdl", path: "docs/second.md" },
    ]);
    expect(
      result.value.steps.map(({ adapter, path: file }) => ({
        adapter,
        path: file,
      }))
    ).toEqual(required);
    expect(result.value.steps).toMatchObject([
      { reason: "taplo is not on PATH", status: "incomplete" },
      { status: "passed" },
      { status: "passed" },
    ]);
    const batch = plan.value.batches.find((entry) => entry.adapter === "rumdl");
    expect(batch?.paths).toEqual(["docs/first.md", "docs/second.md"]);
    expect(plan.value.facts?.reporters).toContainEqual({
      adapter: "rumdl",
      reports: ["line_width"],
      tool: "rumdl",
    });
    const logged = await Bun.file(log).text();
    const invocations = logged
      .trim()
      .split("\n")
      .map((line): unknown => JSON.parse(line));
    expect(invocations).toEqual([
      { args: ["--version"], cwd: main.root },
      {
        args: [
          "check",
          "--no-cache",
          "--no-exclude",
          "--output-format",
          "json",
          "--",
          ...(batch?.paths ?? []),
        ],
        cwd: main.root,
      },
      { args: ["config", "--color", "never"], cwd: main.root },
    ]);
    expect(await main.files()).toEqual(before);
    expect(
      new Uint8Array(
        await Bun.file(path.join(main.root, ".git/index")).arrayBuffer()
      )
    ).toEqual(index);
  });
});
