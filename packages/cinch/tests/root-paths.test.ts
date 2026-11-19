import { expect, test } from "bun:test";
import path from "node:path";

import { toRootRelative } from "../src/config/root.ts";

test("selected paths become root-relative with forward slashes", () => {
  const root = path.resolve("/work/repo");
  const cwd = path.join(root, "packages", "app");
  expect(toRootRelative(root, cwd, "README.md")).toEqual({
    ok: true,
    value: "packages/app/README.md",
  });
  expect(toRootRelative(root, cwd, "../../docs/a.md")).toEqual({
    ok: true,
    value: "docs/a.md",
  });
  expect(toRootRelative(root, cwd, path.join(root, "x.md"))).toEqual({
    ok: true,
    value: "x.md",
  });
  expect(toRootRelative(root, cwd, "../..")).toEqual({ ok: true, value: "" });
  expect(toRootRelative(root, cwd, "..still-inside.md")).toEqual({
    ok: true,
    value: "packages/app/..still-inside.md",
  });
});

test("a selected path outside the root is an error", () => {
  const root = path.resolve("/work/repo");
  expect(toRootRelative(root, root, "../other/a.md")).toEqual({
    error: { kind: "outside-root", path: "../other/a.md", root },
    ok: false,
  });
});
