import { chmod, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { STANDALONE } from "./shipped-text.ts";

/**
 * The standalone executable has Bun's runtime inside it and no `bun` beside
 * it, and an engine may call `bun` by name. This is a `bun` that starts the
 * executable as Bun. It is kept in the user's cache folder, never in the
 * repository, under a name made from the executable's path, so two Ropes
 * binaries do not share one.
 */
const script = (executable: string): string =>
  `#!/bin/sh\nBUN_BE_BUN=1 exec '${executable.replaceAll("'", `'\\''`)}' "$@"\n`;

type OutsideCheckout = (target: string) => Promise<boolean>;

/** Resolve the entire helper directory in case a cache subdirectory is an alias. */
const cacheFolder = async (
  executable: string,
  outsideCheckout: OutsideCheckout
): Promise<string | undefined> => {
  const configured = Bun.env.XDG_CACHE_HOME;
  const home = homedir();
  const fallback = path.isAbsolute(home)
    ? path.join(home, ".cache")
    : undefined;
  for (const cache of [configured, fallback]) {
    if (cache === undefined || !path.isAbsolute(cache)) {
      continue;
    }
    const target = path.join(
      cache,
      "cinch",
      "stand-in",
      Bun.hash(executable).toString(16)
    );
    // eslint-disable-next-line no-await-in-loop -- try the configured cache before the fallback
    const [safeCache, safeHelper] = await Promise.all([
      outsideCheckout(cache),
      outsideCheckout(target),
    ]);
    if (safeCache && safeHelper) {
      return target;
    }
  }
  return undefined;
};

const write = async (
  executable: string,
  outsideCheckout: OutsideCheckout
): Promise<string | undefined> => {
  const folder = await cacheFolder(executable, outsideCheckout);
  if (folder === undefined) {
    return undefined;
  }
  const file = path.join(folder, "bun");
  const wanted = script(executable);
  try {
    const found = await lstat(file).catch(() => null);
    // eslint-disable-next-line no-bitwise -- file permissions occupy the low mode bits
    const executableMode = found !== null && (found.mode & 0o777) === 0o755;
    if (
      found?.isFile() === true &&
      executableMode &&
      (await Bun.file(file).text()) === wanted
    ) {
      return folder;
    }
    await mkdir(folder, { recursive: true });
    const staging = await mkdtemp(path.join(folder, ".install-"));
    try {
      // Replacing the entry avoids writing through links that point into the checkout.
      const staged = path.join(staging, "bun");
      await Bun.write(staged, wanted);
      await chmod(staged, 0o755);
      await rename(staged, file);
    } finally {
      await rm(staging, { force: true, recursive: true });
    }
    return folder;
  } catch {
    // A cache that cannot be written leaves the engine without a `bun`,
    // and the engine says so itself.
    return undefined;
  }
};

let standInFolder: (() => Promise<string | undefined>) | undefined;

/** The standalone entry point supplies the physical checkout boundary. */
export const configureStandIn = (outsideCheckout: OutsideCheckout): void => {
  let folder: Promise<string | undefined> | undefined;
  standInFolder = () => {
    folder ??= write(process.execPath, outsideCheckout);
    return folder;
  };
};

/**
 * The search path an engine is started with. From the package it is the one
 * Ropes was given. From the standalone executable the stand-in's folder goes
 * last, so a `bun` the machine has is still the one found first.
 */
export const enginePath = async (): Promise<string | undefined> => {
  if (!STANDALONE) {
    return Bun.env.PATH;
  }
  const standIn = await standInFolder?.();
  return [Bun.env.PATH, standIn]
    .filter((part) => part !== undefined && part !== "")
    .join(path.delimiter);
};
