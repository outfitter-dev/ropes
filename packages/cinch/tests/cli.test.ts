import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import manifest from "../package.json" with { type: "json" };
import { FailureSchema } from "../src/contracts/failure.ts";
import { FixReportSchema } from "../src/contracts/fix.ts";

const CLI = new URL("../src/cli.ts", import.meta.url).pathname;
/** The repository root, so a relative path means the same from any start. */
const REPO = new URL("../../../", import.meta.url).pathname;

const run = async (...args: string[]) => {
  const child = Bun.spawn(["bun", CLI, ...args], {
    cwd: REPO,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, stdout };
};

test("--version prints the package version", async () => {
  const result = await run("--version");
  expect(result.stdout.trim()).toBe(manifest.version);
  expect(result.exitCode).toBe(0);
});

test("--help lists the three verbs", async () => {
  const result = await run("--help");
  for (const verb of ["explain", "check", "fix"]) {
    expect(result.stdout).toContain(verb);
  }
});

test("fix --dry-run reports a dry run and leaves the file alone", async () => {
  const before = await Bun.file(
    new URL("../../../README.md", import.meta.url)
  ).text();
  const result = await run("fix", "README.md", "--dry-run", "--json");
  expect(JSON.parse(result.stdout)).toMatchObject({
    dryRun: true,
    schemaVersion: 1,
  });
  expect(
    await Bun.file(new URL("../../../README.md", import.meta.url)).text()
  ).toBe(before);
});

test("explain prints a versioned plan as JSON on stdout", async () => {
  const result = await run("explain", "README.md", "--json");
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    paths: [{ path: "README.md" }],
    schemaVersion: 1,
    selection: { kind: "paths", paths: ["README.md"] },
  });
});

test("an unknown command exits 2", async () => {
  const result = await run("nope");
  expect(result.exitCode).toBe(2);
});

test("an unknown command exits 2, including names Object.prototype has", async () => {
  const results = await Promise.all(
    ["nope", "constructor", "__proto__", "toString"].map((name) => run(name))
  );
  for (const result of results) {
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("unknown command");
  }
});

test("init shows the change and writes nothing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cinch-init-"));
  await mkdir(path.join(root, ".git"));
  const child = Bun.spawn(["bun", CLI, "init"], {
    cwd: root,
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  const [stdout] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  expect(stdout).toContain("Run `cinch init --yes` to write this.");
  expect(await Bun.file(path.join(root, "cinch.toml")).exists()).toBe(false);
  const json = Bun.spawn(["bun", CLI, "init", "--json"], {
    cwd: root,
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  const [report] = await Promise.all([
    new Response(json.stdout).text(),
    json.exited,
  ]);
  expect(FixReportSchema.parse(JSON.parse(report)).dryRun).toBe(true);
  await rm(root, { force: true, recursive: true });
});

test("schema prints the JSON Schema of a command's --json output", async () => {
  const result = await run("schema", "preset", "add");
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    properties: { changed: { type: "array" }, dryRun: { type: "boolean" } },
    type: "object",
  });
  const names = await run("schema", "--json");
  expect(JSON.parse(names.stdout)).toEqual({
    commands: [
      "check",
      "doctor",
      "explain",
      "failure",
      "fix",
      "init",
      "preset",
      "preset absorb",
      "preset add",
      "preset eject",
      "preset list",
      "preset update",
    ],
    files: ["config"],
    schemaVersion: 1,
  });
  const text = await run("schema");
  expect(text.stdout).toContain("  preset update\n");
  expect(text.stdout).toContain("`cinch schema config`");
});

test("with --json a failure is one JSON document on stderr", async () => {
  const results = await Promise.all([
    run("nope", "--json"),
    run("schema", "nope", "--json"),
    run("check", "no-such-file.md", "--json"),
  ]);
  for (const result of results) {
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    const failure = FailureSchema.parse(JSON.parse(result.stderr));
    expect(failure.error.message).not.toStartWith("cinch: ");
  }
  const plain = await run("schema", "nope");
  expect(plain.stderr).toStartWith("cinch: no schema");
});
