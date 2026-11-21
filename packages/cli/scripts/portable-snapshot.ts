import { lstat, readlink } from "node:fs/promises";
import path from "node:path";

import { Glob } from "bun";

interface FileState {
  readonly bytes?: Uint8Array;
  readonly link?: string;
  readonly mode: number;
}

/** Preserve raw bytes and permissions, including the installed launcher link. */
export const portableSnapshot = async (
  root: string,
  installed: readonly string[]
): Promise<Record<string, FileState>> => {
  const authored = await Array.fromAsync(
    new Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: true })
  );
  const files = [
    ...authored.filter(
      (file) => !file.startsWith(".git/") && !file.includes("node_modules/")
    ),
    ...installed,
  ];
  return Object.fromEntries(
    await Promise.all(
      [...new Set(files)]
        .toSorted()
        .map(async (file): Promise<[string, FileState]> => {
          const location = path.join(root, file);
          const stats = await lstat(location);
          const state = stats.isSymbolicLink()
            ? { link: await readlink(location), mode: stats.mode }
            : { bytes: await Bun.file(location).bytes(), mode: stats.mode };
          return [file, state];
        })
    )
  );
};
