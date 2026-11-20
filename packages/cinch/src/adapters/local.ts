import path from "node:path";

/** The `node_modules/.bin` folders from `from` up to the filesystem root. */
const binFolders = (from: string): string[] => {
  const folders: string[] = [];
  let folder = path.resolve(from);
  for (;;) {
    folders.push(path.join(folder, "node_modules", ".bin"));
    const above = path.dirname(folder);
    if (above === folder) {
      return folders;
    }
    folder = above;
  }
};

/**
 * Where a command is: the one a package installed at or above `from`, else
 * the one on `PATH`. A tool that ships as a package is pinned by the
 * lockfile and is not on `PATH`, so it is looked for where the package
 * manager puts it. Null when it is in neither place.
 */
export const whichLocal = (
  command: string,
  from: string = process.cwd()
): string | null =>
  Bun.which(command, {
    PATH: [...binFolders(from), Bun.env.PATH ?? ""].join(path.delimiter),
  });
