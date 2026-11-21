import path from "node:path";

import { z } from "zod";

import type { StepInput } from "../adapter.ts";

const Config = z.looseObject({
  compilerOptions: z.record(z.string(), z.unknown()).optional(),
  extends: z.unknown().optional(),
  references: z.unknown().optional(),
});
const OVERRIDES = [
  "baseUrl",
  "paths",
  "rootDirs",
  "moduleSuffixes",
  "typeRoots",
  "types",
  "customConditions",
];
const RESOLUTION = new Set(["bundler", "node16", "nodenext"]);

/** Until symbol resolution is available, require an unmodified module path. */
const configProblem = async (
  root: string,
  file: string,
  configName: string
): Promise<string | undefined> => {
  const boundary = path.resolve(root);
  const selected = path.resolve(boundary, file);
  const relative = path.relative(boundary, selected);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return "compatibility source is outside the repository";
  }
  let directory = path.dirname(selected);
  for (;;) {
    const config = path.join(directory, configName);
    // eslint-disable-next-line no-await-in-loop -- each parent depends on the previous directory
    if (await Bun.file(config).exists()) {
      try {
        // eslint-disable-next-line no-await-in-loop -- the nearest compiler config governs this source file
        const parsed = Config.safeParse(await Bun.file(config).json());
        if (!parsed.success || parsed.data.extends !== undefined) {
          return `${path.relative(root, config)}: compatibility supports a plain compiler config without extends`;
        }
        if (parsed.data.references !== undefined) {
          return `${path.relative(root, config)}: project references are outside the compatibility pilot`;
        }
        const options = parsed.data.compilerOptions ?? {};
        if (options.noCheck === true) {
          return `${path.relative(root, config)}: noCheck disables the semantic check required by compatibility`;
        }
        const override = OVERRIDES.find((key) => options[key] !== undefined);
        if (override !== undefined) {
          return `${path.relative(root, config)}: compiler module-resolution overrides are outside the compatibility pilot`;
        }
        return typeof options.moduleResolution !== "string" ||
          !RESOLUTION.has(options.moduleResolution.toLowerCase())
          ? `${path.relative(root, config)}: compatibility needs explicit bundler, node16, or nodenext module resolution`
          : undefined;
      } catch {
        return `${path.relative(root, config)}: compatibility needs a readable plain JSON compiler config`;
      }
    }
    if (directory === boundary) {
      return `compatibility needs a compiler config inside the selected repository for ${file}`;
    }
    directory = path.dirname(directory);
  }
};

export const apiConfigProblem = async (
  input: StepInput,
  configName: string
): Promise<string | undefined> => {
  const reasons = await Promise.all(
    input.paths.map((file) => configProblem(input.root, file, configName))
  );
  return reasons.find((reason) => reason !== undefined);
};
