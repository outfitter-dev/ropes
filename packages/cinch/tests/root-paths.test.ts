import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { discoverRoot, toRootRelative } from "../src/config/root.ts";

test("selected paths become root-relative with forward slashes", async () => {
  const root = path.resolve("/work/repo");
  const cwd = path.join(root, "packages", "app");
  expect(await toRootRelative(root, cwd, "README.md")).toEqual({
    ok: true,
    value: "packages/app/README.md",
  });
  expect(await toRootRelative(root, cwd, "../../docs/a.md")).toEqual({
    ok: true,
    value: "docs/a.md",
  });
  expect(await toRootRelative(root, cwd, path.join(root, "x.md"))).toEqual({
    ok: true,
    value: "x.md",
  });
  expect(await toRootRelative(root, cwd, "../..")).toEqual({
    ok: true,
    value: "",
  });
  expect(await toRootRelative(root, cwd, "..still-inside.md")).toEqual({
    ok: true,
    value: "packages/app/..still-inside.md",
  });
});

test("a selected path outside the root is an error", async () => {
  const root = path.resolve("/work/repo");
  expect(await toRootRelative(root, root, "../other/a.md")).toEqual({
    error: { kind: "outside-root", path: "../other/a.md", root },
    ok: false,
  });
});

test("a checkout reached through a symlink still matches its physical root", async () => {
  const base = await realpath(
    await mkdtemp(path.join(tmpdir(), "cinch-link-"))
  );
  try {
    const repo = path.join(base, "repo");
    const link = path.join(base, "link");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await Bun.write(path.join(repo, "README.md"), "# hi\n");
    await symlink(repo, link);
    const found = await discoverRoot(link);
    expect(found.ok && found.value.root).toBe(repo);
    expect(await toRootRelative(repo, link, "README.md")).toEqual({
      ok: true,
      value: "README.md",
    });
    expect(
      await toRootRelative(repo, repo, path.join(link, "docs/new.md"))
    ).toEqual({ ok: true, value: "docs/new.md" });
    expect(await toRootRelative(repo, link, "../other.md")).toMatchObject({
      ok: false,
    });
  } finally {
    await rm(base, { force: true, recursive: true });
  }
});

test("a start directory that does not exist has no repository", async () => {
  const from = path.join(tmpdir(), "cinch-missing", "nowhere");
  expect(await discoverRoot(from)).toEqual({
    error: { from, kind: "no-repo" },
    ok: false,
  });
});
