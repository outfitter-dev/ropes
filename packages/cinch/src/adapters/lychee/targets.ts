import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { StepInput } from "../adapter.ts";
import { exec } from "../exec.ts";
import { localInvocation } from "./invocation.ts";

/** Resolve the existing parent too when the authored target is missing. */
const physical = async (file: string): Promise<string> => {
  let current = file;
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop -- each parent depends on the previous path
      return await realpath(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`cannot resolve local link target ${file}`);
      }
      current = parent;
    }
  }
};

/** Use native extraction, then bound target reads to this policy root. */
export const localTargets = async (
  command: string,
  input: StepInput
): Promise<readonly string[]> => {
  const invocation = localInvocation(command, input, true);
  const dumped = await exec(invocation.argv, invocation.cwd, invocation.env);
  if (dumped.exitCode !== 0 || dumped.stderr.trim() !== "") {
    throw new Error(
      `local link targets could not be extracted: ${dumped.stderr.trim()}`
    );
  }
  const root = await realpath(input.root);
  const files = [
    ...new Set(
      dumped.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => fileURLToPath(new URL(line)))
    ),
  ];
  await Promise.all(
    files.map(async (file) => {
      const relative = path.relative(root, await physical(file));
      if (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new Error(
          `local link target leaves the policy root: ${path.relative(root, file)}`
        );
      }
    })
  );
  return files;
};
