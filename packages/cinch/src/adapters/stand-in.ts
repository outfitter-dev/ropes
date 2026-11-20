import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { STANDALONE } from "./shipped-text.ts";

/**
 * The standalone executable has Bun's runtime inside it and no `bun` beside
 * it, and an engine may call `bun` by name. This is a `bun` that starts the
 * executable as Bun. It is kept in the user's cache folder, never in the
 * repository, under a name made from the executable's path, so two Cinch
 * binaries do not share one.
 */
const script = (executable: string): string =>
  `#!/bin/sh\nBUN_BE_BUN=1 exec '${executable.replaceAll("'", `'\\''`)}' "$@"\n`;

/**
 * The user's cache folder. A folder that is not absolute would land in the
 * repository, so an override like that is passed over, and a home folder
 * like that leaves no cache folder at all.
 */
const cacheFolder = (): string | undefined => {
  const configured = Bun.env.XDG_CACHE_HOME;
  if (configured !== undefined && path.isAbsolute(configured)) {
    return configured;
  }
  const home = homedir();
  return path.isAbsolute(home) ? path.join(home, ".cache") : undefined;
};

const write = async (executable: string): Promise<string | undefined> => {
  const cache = cacheFolder();
  if (cache === undefined) {
    return undefined;
  }
  const folder = path.join(
    cache,
    "cinch",
    "stand-in",
    Bun.hash(executable).toString(16)
  );
  const file = path.join(folder, "bun");
  const wanted = script(executable);
  try {
    const found = Bun.file(file);
    if (!(await found.exists()) || (await found.text()) !== wanted) {
      await mkdir(folder, { recursive: true });
      await Bun.write(file, wanted);
    }
    await chmod(file, 0o755);
    return folder;
  } catch {
    // A cache that cannot be written leaves the engine without a `bun`,
    // and the engine says so itself.
    return undefined;
  }
};

let folder: Promise<string | undefined> | undefined;

/**
 * The search path an engine is started with. From the package it is the one
 * Cinch was given. From the standalone executable the stand-in's folder goes
 * last, so a `bun` the machine has is still the one found first.
 */
export const enginePath = async (): Promise<string | undefined> => {
  if (!STANDALONE) {
    return Bun.env.PATH;
  }
  folder ??= write(process.execPath);
  const standIn = await folder;
  return [Bun.env.PATH, standIn]
    .filter((part) => part !== undefined && part !== "")
    .join(path.delimiter);
};
