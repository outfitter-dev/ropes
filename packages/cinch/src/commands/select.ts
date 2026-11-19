import { stat } from "node:fs/promises";
import path from "node:path";

import { toRootRelative } from "../config/root.ts";
import type { Selection } from "../contracts/plan.ts";
import type { RepoRoot } from "../contracts/root.ts";
import { describeRootError } from "./errors.ts";
import { filesUnder } from "./files.ts";

export interface Selected {
  /** What the caller asked for. */
  readonly selection: Selection;
  /** Files named one by one. They stay in the plan whatever the config says. */
  readonly named: readonly string[];
  /** Files found by expanding a directory or the whole workspace. */
  readonly found: readonly string[];
}

export type SelectResult =
  | { readonly ok: true; readonly value: Selected }
  | { readonly ok: false; readonly error: string };

type Expanded =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "dir"; readonly path: string; readonly files: string[] }
  | { readonly kind: "error"; readonly error: string };

const expand = async (
  root: RepoRoot,
  cwd: string,
  selected: string
): Promise<Expanded> => {
  const relative = await toRootRelative(root.root, cwd, selected);
  if (!relative.ok) {
    return { error: describeRootError(relative.error), kind: "error" };
  }
  try {
    const stats = await stat(path.join(root.root, relative.value));
    return stats.isDirectory()
      ? {
          files: await filesUnder(root, relative.value),
          kind: "dir",
          path: relative.value,
        }
      : { kind: "file", path: relative.value };
  } catch {
    return { error: `${selected} does not exist.`, kind: "error" };
  }
};

/**
 * Turns the paths a caller typed into root-relative files. No paths means the
 * whole workspace. A directory means the files under it. A path that does not
 * exist or sits outside the root is an error, never a silent skip.
 */
export const select = async (
  root: RepoRoot,
  cwd: string,
  paths: readonly string[]
): Promise<SelectResult> => {
  if (paths.length === 0) {
    return {
      ok: true,
      value: {
        found: await filesUnder(root, ""),
        named: [],
        selection: { kind: "workspace" },
      },
    };
  }
  const expanded = await Promise.all(
    paths.map((selected) => expand(root, cwd, selected))
  );
  const failed = expanded.find((entry) => entry.kind === "error");
  if (failed?.kind === "error") {
    return { error: failed.error, ok: false };
  }
  const good = expanded.flatMap((entry) =>
    entry.kind === "error" ? [] : [entry]
  );
  // Selecting the root itself is selecting the workspace.
  const wholeRoot = good.some((entry) => entry.path === "");
  return {
    ok: true,
    value: {
      found: good.flatMap((entry) => (entry.kind === "dir" ? entry.files : [])),
      named: good.flatMap((entry) =>
        entry.kind === "file" ? [entry.path] : []
      ),
      selection: wholeRoot
        ? { kind: "workspace" }
        : { kind: "paths", paths: good.map((entry) => entry.path) },
    },
  };
};
