import path from "node:path";

import { run } from "./packed-run.ts";

export const checkFiles = async (
  archive: string,
  allowed: readonly string[],
  required: readonly string[]
) => {
  const listing = await run(["tar", "-tzf", archive], path.dirname(archive));
  const files = listing
    .trim()
    .split("\n")
    .filter((file) => !file.endsWith("/"));
  for (const file of files) {
    const relative = file.replace(/^package\//u, "");
    if (
      !allowed.some(
        (prefix) => relative === prefix || relative.startsWith(`${prefix}/`)
      )
    ) {
      throw new Error(`Unexpected packed file ${file}`);
    }
  }
  for (const file of required) {
    if (!files.includes(`package/${file}`)) {
      throw new Error(`The tarball is missing ${file}`);
    }
  }
};
