import { realpath } from "node:fs/promises";
import path from "node:path";

import { discoverRoot } from "../config/root.ts";
import type { Operation } from "./command.ts";

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pinIn = async (
  directory: string,
  name: string
): Promise<string | null> => {
  const file = Bun.file(path.join(directory, "package.json"));
  if (!(await file.exists())) {
    return null;
  }
  const value: unknown = await file.json();
  if (!object(value)) {
    throw new Error(`Invalid package manifest in ${directory}.`);
  }
  const pins = [value.dependencies, value.devDependencies]
    .filter(object)
    .map((table) => table[name])
    .filter((pin) => pin !== undefined);
  if (pins.length === 0) {
    return null;
  }
  const [pin] = pins;
  if (
    typeof pin !== "string" ||
    !EXACT.test(pin) ||
    pins.some((other) => other !== pin)
  ) {
    throw new Error(
      `Pin ${name} to one exact version in ${directory}/package.json.`
    );
  }
  return pin;
};

/** Stops at the current checkout, including a linked Git worktree. */
const selection = async (from: string, name: string) => {
  const found = await discoverRoot(from);
  if (!found.ok) {
    throw new Error(
      "Run rope inside a Git or jj checkout with a pinned @ropes/cli installation."
    );
  }
  let directory = await realpath(from);
  let selected: { directory: string; pin: string } | undefined;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- each ancestor depends on the previous one
    const pin = selected === undefined ? await pinIn(directory, name) : null;
    selected ??= pin === null ? undefined : { directory, pin };
    if (directory === found.value.vcsRoot) {
      if (selected === undefined) {
        throw new Error(
          `Pin ${name} to an exact version in this checkout's package.json and install it.`
        );
      }
      return { ...selected, root: directory };
    }
    const parent = path.dirname(directory);
    directory = parent;
  }
};

const localEntry = async (
  cwd: string,
  name: string,
  protocol: number
): Promise<string> => {
  const selected = await selection(cwd, name);
  let metadata: string;
  try {
    metadata = Bun.resolveSync(`${name}/package.json`, selected.directory);
  } catch {
    throw new Error(
      `Install the pinned ${name}@${selected.pin} in ${selected.directory}.`
    );
  }
  const packageRoot = path.dirname(await realpath(metadata));
  const relative = path.relative(selected.root, packageRoot);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `The ${name} installation resolves outside this checkout. Install its pinned dependency here.`
    );
  }
  const installed: unknown = await Bun.file(metadata).json();
  if (
    !object(installed) ||
    installed.name !== name ||
    installed.version !== selected.pin ||
    installed.ropesLauncher !== protocol ||
    !object(installed.bin) ||
    typeof installed.bin.rope !== "string"
  ) {
    throw new Error(
      `The local installation must be ${name}@${selected.pin} with a rope executable. Reinstall the pinned dependency.`
    );
  }
  const entry = await realpath(path.resolve(packageRoot, installed.bin.rope));
  const inside = path.relative(packageRoot, entry);
  if (
    inside === ".." ||
    inside.startsWith(`..${path.sep}`) ||
    path.isAbsolute(inside)
  ) {
    throw new Error(
      "The local rope executable must belong to its @ropes/cli package."
    );
  }
  return entry;
};

export interface LocalCliRequest {
  readonly cwd: string;
  readonly entry: string;
  readonly name: string;
  readonly protocol: number;
}

/** Resolves an explicitly pinned local CLI without installing or running it. */
export const resolveLocalCli = async (
  request: LocalCliRequest
): Promise<
  Operation<{ readonly current: string; readonly selected: string }>
> => {
  try {
    return {
      ok: true,
      value: {
        current: await realpath(request.entry),
        selected: await localEntry(request.cwd, request.name, request.protocol),
      },
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
};
