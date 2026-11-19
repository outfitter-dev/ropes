import { expect, test } from "bun:test";

import manifest from "../package.json" with { type: "json" };

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
    schemaVersion: 0,
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
    schemaVersion: 0,
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
