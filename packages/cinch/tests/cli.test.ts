import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import manifest from "../package.json" with { type: "json" };
import { FailureSchema } from "../src/contracts/failure.ts";
import { FixReportSchema } from "../src/contracts/fix.ts";
import { SCHEMA_VERSION } from "../src/contracts/plan.ts";
import { fixtureGit, runEntry } from "./acceptance-repo.ts";

const CLI = new URL("../../cli/src/cli.ts", import.meta.url).pathname;
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
  expect(result.stdout.trim()).toContain(`rope ${manifest.version}`);
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
    schemaVersion: SCHEMA_VERSION,
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
    schemaVersion: SCHEMA_VERSION,
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
  const root = await mkdtemp(path.join(tmpdir(), "rope-cli-init-"));
  try {
    await fixtureGit(root, "init", "--quiet");
    await Bun.write(path.join(root, "README.md"), "# Fixture\n");
    await fixtureGit(root, "add", "README.md");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    const cli = new URL("../../cli/src/cli.ts", import.meta.url);
    const preview = await runEntry(cli, ["init"], root);
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toContain("rope init --yes");
    const report = await runEntry(cli, ["init", "--json"], root);
    expect(report.exitCode).toBe(0);
    expect(FixReportSchema.parse(JSON.parse(report.stdout)).dryRun).toBe(true);
    expect(await Bun.file(path.join(root, "rope.toml")).exists()).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
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
      "check migration",
      "doctor",
      "explain",
      "explain migration",
      "failure",
      "fix",
      "init",
      "preset",
      "preset add",
      "preset adopt",
      "preset eject",
      "preset list",
      "preset update",
      "rules",
      "rules adopt",
      "rules list",
    ],
    files: ["config"],
    schemaVersion: SCHEMA_VERSION,
  });
  const text = await run("schema");
  expect(text.stdout).toContain("  preset update\n");
  expect(text.stdout).toContain("`rope schema config`");
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
  expect(plain.stderr).toContain("No schema for");
});
