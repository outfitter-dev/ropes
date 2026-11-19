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

test("a verb that is not built yet exits 2, never 0", async () => {
  const result = await run("fix", "README.md");
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("not built yet");
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
