import { createRequire } from "node:module";
import path from "node:path";

import { satisfies } from "semver";
import { z } from "zod";

import type { StepInput } from "../adapter.ts";

const Manifest = z.object({
  name: z.literal("typescript"),
  version: z.string(),
});
const require = createRequire(import.meta.url);

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
