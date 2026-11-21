import { mkdir } from "node:fs/promises";
import { devNull } from "node:os";
import path from "node:path";

import { CommitSchema } from "../../contracts/cleanup.ts";

export const gitBytes = async (
  cwd: string,
  ...args: string[]
): Promise<Uint8Array> => {
  const child = Bun.spawn(
    ["git", "--no-pager", "-c", "core.fsmonitor=false", "-C", cwd, ...args],
    {
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) => !name.startsWith("GIT_")
          )
        ),
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_NOSYSTEM: "1",
      },
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).bytes(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(`Cannot read immutable Git input: ${stderr.trim()}`);
  }
  return stdout;
};

export const gitText = async (
  cwd: string,
  ...args: string[]
): Promise<string> => new TextDecoder().decode(await gitBytes(cwd, ...args));

export const exactCommit = async (
  cwd: string,
  commit: string
): Promise<string> => {
  CommitSchema.parse(commit);
  const text = await gitText(
    cwd,
    "rev-parse",
    "--verify",
    `${commit}^{commit}`
  );
  const resolved = text.trim();
  if (resolved !== commit) {
    throw new Error("Supply the full immutable commit id.");
  }
  return resolved;
};

export const ancestor = async (
  cwd: string,
  before: string,
  after: string
): Promise<void> => {
  try {
    await gitText(cwd, "merge-base", "--is-ancestor", before, after);
  } catch {
    throw new Error(
      `The required ancestor ${before} is not available in ${after}'s history.`
    );
  }
};

export interface Entry {
  readonly file: string;
  readonly object: string;
}

export const treeEntries = async (
  cwd: string,
  commit: string
): Promise<Entry[]> => {
  const text = await gitText(cwd, "ls-tree", "-r", "-z", commit);
  return text
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const [mode, kind, object] = entry.slice(0, tab).split(" ");
      const file = entry.slice(tab + 1);
      if (
        tab === -1 ||
        kind !== "blob" ||
        !["100644", "100755"].includes(mode ?? "") ||
        object === undefined ||
        file
          .split("/")
          .some((part) =>
            ["..", ".git", ".jj", "node_modules"].includes(part.toLowerCase())
          ) ||
        path.isAbsolute(file)
      ) {
        throw new Error(
          `Unsupported snapshot entry ${file}. Cleanup comparisons require ordinary tracked files.`
        );
      }
      return { file, object };
    });
};

/** Materialize only immutable blobs. Hooks, filters, links and submodules never run. */
export const materialize = async (
  cwd: string,
  entries: readonly Entry[],
  destination: string
): Promise<void> => {
  await mkdir(path.join(destination, ".git"), { recursive: true });
  const copied = await Promise.allSettled(
    entries.map(async ({ file, object }) => {
      const target = path.join(destination, file);
      await mkdir(path.dirname(target), { recursive: true });
      await Bun.write(target, await gitBytes(cwd, "cat-file", "blob", object));
    })
  );
  const failure = copied.find((entry) => entry.status === "rejected");
  if (failure?.status === "rejected") {
    throw failure.reason;
  }
};
