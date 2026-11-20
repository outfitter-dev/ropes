import { Glob } from "bun";

/** Where this Cinch keeps the rules it ships, one folder for each pack. */
const SHIPPED = new URL("../../../rules/", import.meta.url);

/**
 * The rules this Cinch ships, as one text the engine reads from its command
 * line. Nothing is copied into a repository, so a Cinch version is a rules
 * version and no copy can go stale.
 */
export const shippedRules = async (): Promise<string> => {
  const files = await Array.fromAsync(
    new Glob("*/*.yml").scan({ cwd: SHIPPED.pathname })
  );
  const texts = await Promise.all(
    files.toSorted().map((file) => Bun.file(new URL(file, SHIPPED)).text())
  );
  return texts.map((text) => text.trim()).join("\n---\n");
};
