import { expect, test } from "bun:test";
import path from "node:path";

import { withFixture } from "../packages/core/tests/acceptance-repo.ts";

const SCRIPT = new URL("../scripts/check-workflows.ts", import.meta.url)
  .pathname;
const VALID = `name: Fixture
on: push
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
`;

const gate = async (root: string, text: string) => {
  const file = path.join(root, ".github/workflows/check.yml");
  await Bun.write(file, text);
  const before = await Bun.file(file).bytes();
  const child = Bun.spawn([process.execPath, SCRIPT], {
    cwd: root,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(await Bun.file(file).bytes()).toEqual(before);
  return { exitCode, output: stdout + stderr };
};

test("the offline workflow gate rejects syntax, security and unpinned-action findings", async () => {
  const missing = ["actionlint", "zizmor", "pinact"].filter(
    (tool) => Bun.which(tool) === null
  );
  if (missing.length > 0) {
    console.warn(
      `skipped: workflow regression needs the pinned tools on PATH: ${missing.join(", ")}`
    );
    return;
  }
  await withFixture(async ({ main }) => {
    const valid = await gate(main.root, VALID);
    expect(valid.exitCode).toBe(0);
    const syntax = await gate(
      main.root,
      VALID.replace("runs-on: ubuntu-latest", "runs-on: [")
    );
    expect(syntax.exitCode).not.toBe(0);
    expect(syntax.output).toContain("could not parse");
    const security = await gate(
      main.root,
      VALID.replace("on: push", "on: pull_request_target")
    );
    expect(security.exitCode).toBe(14);
    expect(security.output).toContain("dangerous-triggers");
    const unpinned = await gate(
      main.root,
      VALID.replace("@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1", "@v7")
    );
    expect(unpinned.exitCode).not.toBe(0);
    expect(unpinned.output).toContain("checkout");
    const uncommented = await gate(main.root, VALID.replace(" # v7.0.1", ""));
    expect(uncommented.exitCode).not.toBe(0);
    expect(uncommented.output).toContain("version comment");
  });
}, 30_000);
