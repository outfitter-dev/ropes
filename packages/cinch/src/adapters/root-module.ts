import path from "node:path";

import type { ManagedFile, Wanted } from "./managed.ts";

/** A root config that is a TypeScript module and builds on a kept preset. */
export interface ModuleRoot {
  /** The root config, root-relative. */
  readonly path: string;
  /** The preset's copy, root-relative. */
  readonly preset: string;
  /** Other files the tool reads its config from, root-relative. */
  readonly siblings: readonly string[];
  /** What a new root config holds. */
  readonly fresh: string;
  /** How the config uses the import, as the end of a sentence. */
  readonly use: string;
  /** The Cinch config table whose `preset` key switches this off. */
  readonly table: string;
}

const scanner = new Bun.Transpiler({ loader: "ts" });

/** Whether the module imports the preset, by any spelling of its path. */
const importsPreset = (text: string, options: ModuleRoot): boolean => {
  const here = path.posix.dirname(options.path);
  const bare = options.preset.replace(/\.ts$/u, "");
  return scanner.scan(text).imports.some((found) => {
    if (!found.path.startsWith("./") && !found.path.startsWith("../")) {
      return false;
    }
    const target = path.posix.normalize(path.posix.join(here, found.path));
    return target === options.preset || target === bare;
  });
};

const off = (options: ModuleRoot): string =>
  `set \`preset = false\` under \`[${options.table}]\` in the Cinch config`;

const fresh = async (root: string, options: ModuleRoot): Promise<Wanted> => {
  const found = await Promise.all(
    options.siblings.map((name) => Bun.file(path.join(root, name)).exists())
  );
  const other = options.siblings.find((_, index) => found[index] === true);
  return other === undefined
    ? { ok: true, text: options.fresh }
    : {
        message: `This repository keeps its config in ${other}, which cannot build on the preset Cinch keeps, and Cinch will not write ${options.path} beside it. Move those settings into ${options.path}, or ${off(options)}.`,
        ok: false,
      };
};

/**
 * The root config must import the preset. A missing file is written whole.
 * Any other file is the repository's own and a module a person wrote, so
 * Cinch says what to add and writes nothing.
 */
export const moduleRoot = (options: ModuleRoot): ManagedFile => ({
  beside: options.siblings,
  layer: "root",
  path: options.path,
  want: async (current, root) => {
    if (current === null) {
      return await fresh(root, options);
    }
    const own = `${options.path} is the repository's own, so Cinch will not rewrite it.`;
    let imported = false;
    try {
      imported = importsPreset(current, options);
    } catch {
      return {
        message: `${own} It is not valid TypeScript, so Cinch cannot tell whether it builds on the preset.`,
        ok: false,
      };
    }
    return imported
      ? { ok: true, text: current }
      : {
          message: `${own} It does not import the preset Cinch keeps. Add \`import preset from "./${options.preset}";\` and ${options.use}, or ${off(options)}.`,
          ok: false,
        };
  },
});
