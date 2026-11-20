import { shippedFolder } from "../shipped-text.ts";

/** Where this Cinch keeps the rules it ships, one folder for each pack. */
const SHIPPED = new URL("../../../rules/", import.meta.url);

/**
 * The rules this Cinch ships, as one text the engine reads from its command
 * line. Nothing is copied into a repository, so a Cinch version is a rules
 * version and no copy can go stale.
 */
export const shippedRules = async (): Promise<string> => {
  const files = await shippedFolder(SHIPPED);
  return [...files.entries()]
    .filter(([file]) => file.endsWith(".yml"))
    .toSorted(([left], [right]) => (left < right ? -1 : 1))
    .map(([, text]) => text.trim())
    .join("\n---\n");
};
