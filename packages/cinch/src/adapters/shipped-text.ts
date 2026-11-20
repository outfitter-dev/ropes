import path from "node:path";

import { Glob } from "bun";

/**
 * The files this Cinch ships. The standalone build puts them here, because
 * a compiled executable has no package folder to read: a preset by its file
 * name, and a file of a shipped folder by `<folder>/<path inside it>`. Run
 * from the package, the name is not defined at all.
 */
declare const CINCH_SHIPPED: Readonly<Record<string, string>> | undefined;

// `typeof` is the one way to ask about a name that may not exist.
const held = typeof CINCH_SHIPPED === "object" ? CINCH_SHIPPED : undefined;

/** True when this is the standalone executable and not the package. */
export const STANDALONE = held !== undefined;

/** A file this Cinch ships, as text. `source` is where the package has it. */
export const shippedText = (source: URL): Promise<string> => {
  const text = held?.[path.posix.basename(source.pathname)];
  return text === undefined ? Bun.file(source).text() : Promise.resolve(text);
};

/**
 * Every file under a folder this Cinch ships, as text by its path inside
 * the folder. `folder` is where the package has it, and ends with a slash.
 */
export const shippedFolder = async (
  folder: URL
): Promise<ReadonlyMap<string, string>> => {
  if (held !== undefined) {
    const prefix = `${path.posix.basename(folder.pathname)}/`;
    return new Map(
      Object.entries(held).flatMap(([name, text]): [string, string][] =>
        name.startsWith(prefix) ? [[name.slice(prefix.length), text]] : []
      )
    );
  }
  const files = await Array.fromAsync(
    new Glob("**/*").scan({ cwd: folder.pathname })
  );
  const texts = await Promise.all(
    files.map((file) => Bun.file(new URL(file, folder)).text())
  );
  return new Map(files.map((file, index) => [file, texts[index] ?? ""]));
};
