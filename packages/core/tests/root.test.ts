import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { discoverRoot } from "../src/config/root.ts";

/** Entries ending in `/` are directories. The rest are files with content. */
type Tree = Readonly<Record<string, string>>;

const CONFIG = "pilot = 0\n";

const withTree = async <T>(
  tree: Tree,
  run: (base: string) => Promise<T>
): Promise<T> => {
  const base = await realpath(
    await mkdtemp(path.join(tmpdir(), "ropes-root-"))
  );
  try {
    await Promise.all(
      Object.entries(tree).map(([name, text]) =>
        name.endsWith("/")
          ? mkdir(path.join(base, name), { recursive: true })
          : Bun.write(path.join(base, name), text)
      )
    );
    return await run(base);
  } finally {
    await rm(base, { force: true, recursive: true });
  }
};

test("from the repo root, the root is the directory with the config", async () => {
  await withTree(
    { "repo/.git/": "", "repo/rope.toml": CONFIG },
    async (base) => {
      const repo = path.join(base, "repo");
      expect(await discoverRoot(repo)).toEqual({
        ok: true,
        value: {
          configFile: "rope.toml",
          root: repo,
          startedIn: "",
          vcs: "git",
          vcsRoot: repo,
        },
      });
    }
  );
});

test("from a nested package, discovery walks up to the same root", async () => {
  await withTree(
    {
      "repo/.git/": "",
      "repo/packages/app/src/": "",
      "repo/rope.toml": CONFIG,
    },
    async (base) => {
      const repo = path.join(base, "repo");
      const found = await discoverRoot(path.join(repo, "packages/app/src"));
      expect(found.ok && found.value).toMatchObject({
        configFile: "rope.toml",
        root: repo,
        startedIn: "packages/app/src",
      });
    }
  );
});

test("a dangling supported policy does not hide the valid parent policy", async () => {
  await withTree(
    {
      "repo/.git/": "",
      "repo/packages/app/": "",
      "repo/rope.toml": CONFIG,
    },
    async (base) => {
      const repo = path.join(base, "repo");
      const nested = path.join(repo, "packages/app");
      await symlink("missing-policy.toml", path.join(nested, "rope.toml"));
      expect(await discoverRoot(nested)).toEqual({
        ok: true,
        value: {
          configFile: "rope.toml",
          root: repo,
          startedIn: "packages/app",
          vcs: "git",
          vcsRoot: repo,
        },
      });
    }
  );
});

test("a nested outfitter.toml without a [cinch] table does not hide the root config", async () => {
  await withTree(
    {
      "repo/.git/": "",
      "repo/outfitter.toml": '[other]\nname = "root"\n',
      "repo/packages/app/outfitter.toml": '[other]\nname = "x"\n',
      "repo/rope.toml": CONFIG,
    },
    async (base) => {
      const found = await discoverRoot(path.join(base, "repo/packages/app"));
      expect(found.ok && found.value).toMatchObject({
        configFile: "rope.toml",
        root: path.join(base, "repo"),
      });
    }
  );
});

test("the nearest config sets the root, below the version-control boundary", async () => {
  await withTree(
    {
      "repo/.git/": "",
      "repo/packages/app/rope.toml": CONFIG,
      "repo/rope.toml": CONFIG,
    },
    async (base) => {
      const repo = path.join(base, "repo");
      const found = await discoverRoot(path.join(repo, "packages/app"));
      expect(found.ok && found.value).toMatchObject({
        root: path.join(repo, "packages/app"),
        vcsRoot: repo,
      });
    }
  );
});

test("with no config, the version-control boundary is the root", async () => {
  await withTree({ "repo/.git/": "", "repo/docs/": "" }, async (base) => {
    const repo = path.join(base, "repo");
    const found = await discoverRoot(path.join(repo, "docs"));
    expect(found.ok && found.value).toMatchObject({
      configFile: null,
      root: repo,
      startedIn: "docs",
    });
  });
});

test("a config above the version-control boundary is not read", async () => {
  await withTree({ "repo/.git/": "", "rope.toml": CONFIG }, async (base) => {
    const found = await discoverRoot(path.join(base, "repo"));
    expect(found.ok && found.value).toMatchObject({
      configFile: null,
      root: path.join(base, "repo"),
    });
  });
});

test("a linked git worktree, where .git is a file, is its own root", async () => {
  await withTree(
    {
      "repo/.git/": "",
      "repo/rope.toml": CONFIG,
      "repo/worktrees/feature/.git": "gitdir: ../../.git/worktrees/feature\n",
      "repo/worktrees/feature/docs/": "",
      "repo/worktrees/feature/rope.toml": CONFIG,
    },
    async (base) => {
      const tree = path.join(base, "repo/worktrees/feature");
      const found = await discoverRoot(path.join(tree, "docs"));
      expect(found.ok && found.value).toMatchObject({
        root: tree,
        vcs: "git-linked",
        vcsRoot: tree,
      });
    }
  );
});

test("a jj workspace is a root, colocated with git or not", async () => {
  await withTree(
    {
      "colocated/.git/": "",
      "colocated/.jj/": "",
      "colocated/rope.toml": CONFIG,
      "plain/.jj/": "",
      "plain/src/": "",
    },
    async (base) => {
      const colocated = await discoverRoot(path.join(base, "colocated"));
      expect(colocated.ok && colocated.value.vcs).toBe("jj");
      const plain = await discoverRoot(path.join(base, "plain/src"));
      expect(plain.ok && plain.value).toMatchObject({
        root: path.join(base, "plain"),
        vcs: "jj",
      });
    }
  );
});

test("a real linked worktree made by git resolves to itself", async () => {
  const git = Bun.which("git");
  if (git === null) {
    console.warn("skipped: git is not installed");
    return;
  }
  await withTree({ "repo/": "" }, async (base) => {
    const repo = path.join(base, "repo");
    const linked = path.join(base, "linked");
    const env = {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      PATH: process.env.PATH ?? "",
    };
    const identity = [
      "-c",
      "user.name=ropes",
      "-c",
      "user.email=ropes@example.invalid",
    ];
    const steps = [
      ["init", "--quiet"],
      [...identity, "commit", "--quiet", "--allow-empty", "-m", "init"],
      ["worktree", "add", "--quiet", linked],
    ];
    for (const args of steps) {
      // oxlint-disable-next-line no-await-in-loop -- the git steps depend on each other
      const exit = await Bun.spawn([git, "-C", repo, ...args], {
        env,
        stderr: "ignore",
        stdout: "ignore",
      }).exited;
      expect(exit).toBe(0);
    }
    const found = await discoverRoot(linked);
    expect(found.ok && found.value).toMatchObject({
      root: linked,
      vcs: "git-linked",
    });
  });
});

test("a directory with no repository above it is an error", async () => {
  await withTree({ "loose/cinch.toml": CONFIG }, async (base) => {
    const from = path.join(base, "loose");
    const found = await discoverRoot(from);
    // A stray .git or .jj above the temp directory would make this machine
    // unable to show the error, so only assert when none exists.
    if (found.ok) {
      expect(found.value.vcsRoot.length).toBeLessThan(base.length);
      return;
    }
    expect(found).toEqual({ error: { from, kind: "no-repo" }, ok: false });
  });
});
