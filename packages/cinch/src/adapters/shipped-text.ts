import path from "node:path";

/**
 * The files this Cinch ships, by file name. The standalone build puts them
 * here, because a compiled executable has no package folder to read. Run
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
