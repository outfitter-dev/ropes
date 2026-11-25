import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { satisfies } from "semver";
import { z } from "zod";

import type { PreviewInput, StepInput } from "../adapter.ts";

const Manifest = z.object({
  name: z.literal("typescript"),
  version: z.string(),
});
const require = createRequire(import.meta.url);

/** Root and ancestor installs are already preserved by the existing preview. */
const nestedInput = async (
  root: string,
  file: string
): Promise<PreviewInput | undefined> => {
  let directory = path.dirname(path.join(root, file));
  try {
    const manifest = await realpath(
      require.resolve("typescript/package.json", { paths: [directory] })
    );
    while (directory !== root && directory !== path.dirname(directory)) {
      const candidate = path.join(directory, "node_modules/typescript");
      try {
        // eslint-disable-next-line no-await-in-loop -- inspect each nearer installation in resolution order
        const reached = await realpath(path.join(candidate, "package.json"));
        if (reached === manifest) {
          return {
            path: path.relative(root, candidate),
            source: path.dirname(manifest),
          };
        }
      } catch {
        // This directory has no matching installation.
      }
      directory = path.dirname(directory);
    }
  } catch {
    // Missing declarations remain an incomplete check in either checkout.
  }
  return undefined;
};

export const apiPreviewInputs = async (
  input: StepInput
): Promise<PreviewInput[]> => {
  const root = await realpath(input.root);
  const entries = await Promise.all(
    input.paths.map((file) => nestedInput(root, file))
  );
  return [
    ...new Map(
      entries
        .filter((entry) => entry !== undefined)
        .map((entry) => [entry.path, entry])
    ).values(),
  ];
};

const packageProblem = async (
  directory: string,
  range: string
): Promise<string | undefined> => {
  try {
    const manifest = require.resolve("typescript/package.json", {
      paths: [directory],
    });
    const parsed = Manifest.safeParse(await Bun.file(manifest).json());
    if (!parsed.success) {
      return "the resolved TypeScript API package has an invalid identity or version";
    }
    return satisfies(parsed.data.version, range)
      ? undefined
      : `resolved TypeScript API ${parsed.data.version} does not satisfy declared support ${range}`;
  } catch (error) {
    return `cannot resolve TypeScript API declarations: ${String(error)}`;
  }
};

/** The API declarations must represent the support target the plan names. */
export const apiProblem = async (
  input: StepInput
): Promise<string | undefined> => {
  const range = input.target?.range;
  if (range === undefined) {
    return "the plan supplies no declared TypeScript API support range";
  }
  const directories = [
    ...new Set(
      input.paths.map((file) => path.dirname(path.join(input.root, file)))
    ),
  ];
  const reasons = await Promise.all(
    directories.map((directory) => packageProblem(directory, range))
  );
  return reasons.find((reason) => reason !== undefined);
};
