import { lstat } from "node:fs/promises";
import path from "node:path";

import type { Plan } from "../contracts/plan.ts";

/** Setup owns lexical paths, so a link cannot substitute another file. */
export const setupLinkProblem = async (plan: Plan): Promise<string | null> => {
  const files = plan.paths.filter((entry) =>
    entry.steps.some((step) => step.setup === true)
  );
  for (const file of files) {
    let current = plan.root;
    for (const part of file.path.split("/")) {
      current = path.join(current, part);
      try {
        // eslint-disable-next-line no-await-in-loop -- inspect each parent before its child
        const found = await lstat(current);
        if (found.isSymbolicLink()) {
          const link = path.relative(plan.root, current);
          return `Setup path ${file.path} uses symbolic link ${link}. Replace the link with a regular file or directory before repairing setup.`;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          break;
        }
        throw error;
      }
    }
  }
  return null;
};
