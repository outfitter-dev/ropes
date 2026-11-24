import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { packagesAbove } from "../src/commands/packages.ts";

test("a directory with a manifest above a selected file is a package", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ropes-packages-"));
  try {
    await Promise.all(
      [
        "package.json",
        "packages/a/package.json",
        "packages/a/docs/x.md",
        "tools/py/pyproject.toml",
        "tools/py/x.md",
        "unseen/package.json",
        "plain/x.md",
      ].map((file) => Bun.write(path.join(root, file), ""))
    );
    const found = await packagesAbove(root, [
      "README.md",
      "packages/a/docs/x.md",
      "tools/py/x.md",
      "plain/x.md",
    ]);
    // The root is the workspace, and a package no selected file sits in is
    // never looked at.
    expect(found).toEqual(["packages/a", "tools/py"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
