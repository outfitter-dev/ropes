import { expect, test } from "bun:test";
import { rm, symlink } from "node:fs/promises";
import path from "node:path";

import { BASE, planPaths, withRepo } from "./repo-bench.ts";

test("a directory brings in only what the config includes, and a named file is always shown", async () => {
  await withRepo(BASE, {}, async ({ run }) => {
    const workspace = await run("explain", [], { json: true });
    expect(planPaths(workspace)).toEqual(["a.md", "docs/b.md"]);
    const named = await run("explain", ["vendor/c.md", "src/index.ts"]);
    expect(named.output).toContain(
      "vendor/c.md\n  left out: excluded (cinch.toml: exclude)"
    );
    expect(named.output).toContain(
      "src/index.ts\n  left out: not included (default)"
    );
  });
});

test("paths are read from where the command was started", async () => {
  await withRepo(BASE, {}, async ({ run }) => {
    const here = await run("explain", ["."], { cwd: "docs", json: true });
    expect(planPaths(here)).toEqual(["docs/b.md"]);
    expect(JSON.parse(here.output ?? "")).toHaveProperty("selection", {
      kind: "paths",
      paths: ["docs"],
    });
    const up = await run("explain", ["../a.md"], { cwd: "docs", json: true });
    expect(planPaths(up)).toEqual(["a.md"]);
  });
});

test("nothing selected is clean, and says nothing ran", async () => {
  await withRepo(BASE, {}, async ({ adapter, run }) => {
    const response = await run("check", ["src"]);
    expect(response.exitCode).toBe(0);
    expect(response.output).toContain("No files selected, so nothing ran.");
    expect(adapter.calls).toEqual([]);
  });
});

test("unusable input exits 2 with a reason and no output", async () => {
  await withRepo(BASE, {}, async ({ root, run }) => {
    const responses = await Promise.all([
      run("check", ["missing.md"]),
      run("check", [path.join(root, "..")]),
      run("explain", ["missing.md"]),
    ]);
    for (const response of responses) {
      expect(response.exitCode).toBe(2);
      expect(response.output).toBeUndefined();
    }
    expect(responses[0]?.error).toBe("cinch: missing.md does not exist.");
    expect(responses[1]?.error).toContain("is outside the root");
  });
});

test("a config that cannot be used exits 2", async () => {
  await withRepo(
    { ...BASE, "cinch.toml": "pilot = 9\n" },
    {},
    async ({ run }) => {
      const response = await run("check");
      expect(response.exitCode).toBe(2);
      expect(response.error).toContain("pilot version 9");
    }
  );
});

test("outside a repository exits 2", async () => {
  await withRepo({ "a.md": "# A\n" }, {}, async ({ run }) => {
    const response = await run("check");
    expect(response.exitCode).toBe(2);
    expect(response.error).toContain("is not inside a git or jj repository");
  });
});

const git = async (cwd: string, ...args: string[]): Promise<void> => {
  const child = Bun.spawn(["git", "-C", cwd, ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
    stderr: "ignore",
    stdout: "ignore",
  });
  expect(await child.exited).toBe(0);
};

test("in a git repository, ignored and deleted files are not picked up, unless named", async () => {
  const tree = {
    ".gitignore": "ignored.md\n",
    "a.md": "# A\n",
    "gone.md": "# Gone\n",
    "ignored.md": "# Ignored\n",
    "untracked.md": "# New\n",
  };
  await withRepo(tree, {}, async ({ root, run }) => {
    await git(root, "init", "--quiet");
    await git(root, "add", "a.md", "gone.md", ".gitignore");
    await rm(path.join(root, "gone.md"));
    const workspace = await run("explain", [], { json: true });
    expect(planPaths(workspace)).toEqual(["a.md", "untracked.md"]);
    const named = await run("explain", ["ignored.md"], { json: true });
    expect(planPaths(named)).toEqual(["ignored.md"]);
  });
});

test("expanding a directory does not follow a symlink out of the root", async () => {
  const tree = { "outside.md": "# Outside\n", "repo/a.md": "# A\n" };
  await withRepo(tree, {}, async ({ root, run }) => {
    const repo = path.join(root, "repo");
    await git(repo, "init", "--quiet");
    await symlink("../outside.md", path.join(repo, "link.md"));
    await symlink("a.md", path.join(repo, "inside.md"));
    const workspace = await run("explain", [], { cwd: "repo", json: true });
    expect(planPaths(workspace)).toEqual(["a.md", "inside.md"]);
    const named = await run("explain", ["link.md"], { cwd: "repo" });
    expect(named.exitCode).toBe(2);
  });
});

test("a directory whose name looks like a pattern means only itself", async () => {
  const tree = { ...BASE, "*/in.md": "# In\n" };
  await withRepo(tree, {}, async ({ root, run }) => {
    await git(root, "init", "--quiet");
    const scoped = await run("explain", ["*"], { json: true });
    expect(planPaths(scoped)).toEqual(["*/in.md"]);
  });
});
