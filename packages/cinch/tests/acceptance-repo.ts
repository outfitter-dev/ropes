import { test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import path from "node:path";

import { snapshot } from "./repo-bench.ts";

const CLI = new URL("../src/cli.ts", import.meta.url);

/** The file every proof reads its override from. */
export const CONFIG = [
  "pilot = 0",
  "",
  "[[overrides]]",
  'paths = ["legacy/**"]',
  "",
  "[overrides.markdown]",
  "enabled = false",
  "",
].join("\n");

/**
 * A small repository with a root config, a nested package, a path override
 * and Markdown with known problems. `legacy/old.md` has the same problem as
 * `README.md`, so only the override explains why it is not reported.
 */
export const FILES: Readonly<Record<string, string>> = {
  "README.md": "# Guide\n\n# Second title\n\nText.\n",
  "cinch.toml": CONFIG,
  "legacy/old.md": "# Old\n\n# Old again\n\nText.\n",
  "packages/app/docs/notes.md": "# App\n\n\n\nToo many blanks above.\n",
  "packages/app/package.json": '{ "name": "app" }\n',
};

export interface Ran {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface Checkout {
  readonly root: string;
  /** Runs the `cinch` executable in a child process, from `cwd` under the root. */
  readonly cinch: (
    args: readonly string[],
    options?: { cwd?: string; path?: string }
  ) => Promise<Ran>;
  readonly files: () => Promise<Record<string, string>>;
}

/**
 * A Git hook exports `GIT_DIR` and friends, which would point the fixture's
 * Git commands at the checkout running the tests. They are left out, and
 * Git is told to read no global or system config, so a developer's ignore
 * file, hooks path or init template cannot change what the fixture holds.
 */
const cleanEnv = (): Record<string, string | undefined> => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
  ),
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: "1",
});

const spawn = async (
  command: readonly string[],
  cwd: string,
  searchPath?: string
): Promise<Ran> => {
  const child = Bun.spawn([...command], {
    cwd,
    env: {
      ...cleanEnv(),
      PATH: searchPath ?? process.env.PATH ?? "",
      XDG_CONFIG_HOME: path.join(cwd, ".fixture-user-config"),
    },
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

export const fixtureGit = async (
  cwd: string,
  ...args: string[]
): Promise<void> => {
  const ran = await spawn(
    [
      "git",
      "-c",
      "user.name=cinch",
      "-c",
      "user.email=cinch@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    cwd
  );
  if (ran.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${ran.stderr}`);
  }
};

export const runEntry = (
  entry: URL,
  args: readonly string[],
  cwd: string,
  searchPath?: string
): Promise<Ran> =>
  spawn([process.execPath, entry.pathname, ...args], cwd, searchPath);

export const checkoutAt = (root: string): Checkout => ({
  cinch: (args, { cwd = "", path: searchPath } = {}) =>
    runEntry(CLI, args, path.join(root, cwd), searchPath),
  files: async () => {
    const all = await snapshot(root);
    return Object.fromEntries(
      Object.entries(all).filter(([name]) => !name.startsWith(".git"))
    );
  },
  root,
});

export interface Fixture {
  readonly main: Checkout;
  /** A linked worktree of the same repository, on its own branch. */
  readonly worktree: () => Promise<Checkout>;
  /** A directory with nothing on it, to stand in for a `PATH` without tools. */
  readonly emptyPath: string;
}

/** Builds the fixture as a real Git repository and removes it afterwards. */
export const withFixture = async <T>(
  body: (fixture: Fixture) => Promise<T>
): Promise<T> => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-acc-")));
  const root = path.join(base, "repo");
  const emptyPath = path.join(base, "no-tools");
  try {
    await mkdir(emptyPath, { recursive: true });
    await Promise.all(
      Object.entries(FILES).map(([name, text]) =>
        Bun.write(path.join(root, name), text)
      )
    );
    await fixtureGit(root, "init", "--quiet");
    await fixtureGit(root, "add", "--all");
    await fixtureGit(root, "commit", "--quiet", "--message", "fixture");
    return await body({
      emptyPath,
      main: checkoutAt(root),
      worktree: async () => {
        const linked = path.join(base, "linked");
        await fixtureGit(
          root,
          "worktree",
          "add",
          "--quiet",
          "-b",
          "linked",
          linked
        );
        return checkoutAt(linked);
      },
    });
  } finally {
    await rm(base, { force: true, recursive: true });
  }
};

const TOOLS = ["rumdl", "taplo", "git"].filter(
  (tool) => Bun.which(tool) === null
);

/** A proof that needs the real engines. It says so when it cannot run. */
export const proof = (
  name: string,
  body: (fixture: Fixture) => Promise<void>
) => {
  test(
    name,
    async () => {
      if (TOOLS.length > 0) {
        console.warn(
          `skipped: ${TOOLS.join(" and ")} not on PATH, so "${name}" did not run`
        );
        return;
      }
      await withFixture(body);
    },
    30_000
  );
};

export const json = (ran: Ran): unknown => JSON.parse(ran.stdout);
