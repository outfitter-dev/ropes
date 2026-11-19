import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const fixtures = path.join(root, "tests/fixtures/typed-lint");

const lintCopyOf = async (fixture: string) => {
  const copy = path.join(fixtures, `copy-${crypto.randomUUID()}.ts`);
  await Bun.write(copy, Bun.file(path.join(fixtures, fixture)));
  try {
    const child = Bun.spawn(["bunx", "oxlint", "--deny-warnings", copy], {
      cwd: root,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
    ]);
    return { exitCode, stdout };
  } finally {
    await rm(copy, { force: true });
  }
};

test("typed lint is on: a floating promise fails the lint", async () => {
  const result = await lintCopyOf("floating-promise.ts.txt");
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout).toContain("no-floating-promises");
});
