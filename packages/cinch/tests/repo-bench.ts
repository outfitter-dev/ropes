import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Glob } from "bun";

import type { CommandResponse } from "../src/commands/command.ts";
import { createCommands } from "../src/commands/registry.ts";
import { fakeAdapter } from "./fake-adapter.ts";
import type { FakeAdapter, FakeOptions } from "./fake-adapter.ts";

/** Entries ending in `/` are directories. The rest are files with content. */
export type Tree = Readonly<Record<string, string>>;

export const CONFIG = 'pilot = 0\nexclude = ["vendor/**"]\n';
export const BASE: Tree = {
  ".git/": "",
  "a.md": "# A\n",
  "cinch.toml": CONFIG,
  "docs/b.md": "# B\n",
  "src/index.ts": "export {};\n",
  "vendor/c.md": "# C\n",
};

export interface Bench {
  readonly root: string;
  readonly adapter: FakeAdapter;
  readonly run: (
    verb: string,
    paths?: readonly string[],
    options?: { json?: boolean; cwd?: string }
  ) => Promise<CommandResponse>;
}

export const withRepo = async <T>(
  tree: Tree,
  options: FakeOptions,
  body: (bench: Bench) => Promise<T>
): Promise<T> => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "cinch-cmd-")));
  try {
    await Promise.all(
      Object.entries(tree).map(([name, text]) =>
        name.endsWith("/")
          ? mkdir(path.join(root, name), { recursive: true })
          : Bun.write(path.join(root, name), text)
      )
    );
    const adapter = fakeAdapter(options);
    const commands = createCommands({ adapters: () => [adapter] });
    return await body({
      adapter,
      root,
      run: (verb, paths = [], { cwd = "", json = false } = {}) => {
        const command = commands[verb];
        if (!command) {
          throw new Error(`no command ${verb}`);
        }
        return command({ cwd: path.join(root, cwd), json, paths });
      },
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

export const snapshot = async (
  root: string
): Promise<Record<string, string>> => {
  const names = await Array.fromAsync(
    new Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: true })
  );
  const texts = await Promise.all(
    names.map((name) => Bun.file(path.join(root, name)).text())
  );
  return Object.fromEntries(
    names.toSorted().map((name) => [name, texts[names.indexOf(name)] ?? ""])
  );
};

export const planPaths = (response: CommandResponse): string[] => {
  const plan: unknown = JSON.parse(response.output ?? "null");
  if (
    typeof plan !== "object" ||
    plan === null ||
    !("paths" in plan) ||
    !Array.isArray(plan.paths)
  ) {
    throw new Error("not a plan");
  }
  return plan.paths.map((entry: unknown) =>
    typeof entry === "object" && entry !== null && "path" in entry
      ? String(entry.path)
      : ""
  );
};
