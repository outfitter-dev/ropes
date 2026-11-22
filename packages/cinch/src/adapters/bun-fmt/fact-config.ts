import { readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const OptionsSchema = z.object({
  overrides: z.array(z.unknown()).optional(),
  printWidth: z.number().int().positive().optional(),
});

export const staticOptions = async (file: string) => {
  const text = await Bun.file(file).text();
  if (path.basename(file) === "bunfig.toml") {
    return OptionsSchema.parse(
      z.object({ fmt: z.unknown().optional() }).parse(Bun.TOML.parse(text))
        .fmt ?? {}
    );
  }
  if (
    file.endsWith(".json") ||
    file.endsWith(".jsonc") ||
    path.basename(file) === ".prettierrc"
  ) {
    return OptionsSchema.parse(Bun.JSON5.parse(text));
  }
  throw new Error(`Cannot inspect unsupported formatter config ${file}`);
};

export type FormatterOptions = z.infer<typeof OptionsSchema>;

const CONFIG = /^(?:\.prettierrc(?:\..+)?|prettier\.config\..+)$/u;
const DATA = /(?:\.jsonc?|\.toml)$/u;
const ObjectSchema = z.record(z.string(), z.unknown());

const executableOptions = (value: unknown): boolean => {
  if (typeof value === "string") {
    return true;
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([key, child]) =>
      key === "plugins" ||
      key === "preload" ||
      (child !== null && typeof child === "object" && executableOptions(child))
  );
};

const limitForFile = async (
  file: string,
  name: string,
  isConfig: boolean
): Promise<string | undefined> => {
  if (
    isConfig &&
    !DATA.test(name) &&
    name !== ".prettierrc" &&
    path.extname(name) !== ""
  ) {
    return `Formatter options were not inspected because native discovery may execute ${file}`;
  }
  try {
    const text = await Bun.file(file).text();
    const parsed: unknown =
      name === "bunfig.toml" ? Bun.TOML.parse(text) : Bun.JSON5.parse(text);
    const object = ObjectSchema.safeParse(parsed);
    let settings = parsed;
    if (name === "package.json") {
      settings = object.success ? object.data.prettier : undefined;
    }
    if (executableOptions(settings)) {
      return `Formatter options were not inspected because ${file} may load executable configuration or plugins`;
    }
  } catch {
    // Invalid inactive static data must not decide the active config.
    if (name === ".prettierrc" || (isConfig && path.extname(name) === "")) {
      return `Formatter options in ${file} are not supported static JSON`;
    }
  }
  return undefined;
};

/** Bun's discovery commands evaluate JS configs. Refuse those before spawning. */
export const discoveryLimit = async (
  root: string,
  paths: readonly string[],
  compatibilityConfigs: readonly string[]
): Promise<string | undefined> => {
  const directories = new Set<string>();
  for (const file of paths) {
    let directory = path.dirname(path.resolve(root, file));
    while (!directories.has(directory)) {
      directories.add(directory);
      const parent = path.dirname(directory);
      if (directory === parent) {
        break;
      }
      directory = parent;
    }
  }
  for (const directory of directories) {
    // eslint-disable-next-line no-await-in-loop -- directory reads do not execute authored config
    const names = await readdir(directory);
    for (const name of names) {
      const isConfig = CONFIG.test(name) || compatibilityConfigs.includes(name);
      if (!isConfig && name !== "package.json" && name !== "bunfig.toml") {
        continue;
      }
      const file = path.join(directory, name);
      // eslint-disable-next-line no-await-in-loop -- inspect static data before native discovery
      const limit = await limitForFile(file, name, isConfig);
      if (limit !== undefined) {
        return limit;
      }
    }
  }
  return undefined;
};
