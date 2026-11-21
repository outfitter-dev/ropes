import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { PreviewInput, StepInput } from "../adapter.ts";
import { chunkPaths } from "../batch.ts";
import { localTargets } from "./targets.ts";

/** Let the engine extract targets so previews share its Markdown grammar. */
export const previewInputs = async (
  command: string,
  input: StepInput
): Promise<PreviewInput[]> => {
  const files = new Set<string>();
  for (const paths of chunkPaths(input.paths)) {
    // eslint-disable-next-line no-await-in-loop -- match the executor's bounded batches
    for (const file of await localTargets(command, { ...input, paths })) {
      files.add(file);
    }
  }
  const selected = new Set(
    input.paths.map((file) => path.resolve(input.root, file))
  );
  const targets = await Promise.all(
    [...files].map(async (source): Promise<PreviewInput | undefined> => {
      if (selected.has(source)) {
        return undefined;
      }
      const found = await stat(source).catch(() => null);
      if (found === null) {
        // A missing target must remain missing in the preview's check.
        return undefined;
      }
      if ((await realpath(source)) !== path.resolve(source)) {
        throw new Error(
          `local link previews require direct target paths instead of symlink aliases: ${path.relative(input.root, source)}`
        );
      }
      const relative = path.relative(input.root, source);
      return relative === ""
        ? undefined
        : {
            ...(found.isDirectory() ? { directory: true } : {}),
            path: relative,
            source,
          };
    })
  );
  return targets.filter((target) => target !== undefined);
};
