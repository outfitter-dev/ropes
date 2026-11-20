import { CINCH_MANAGED_DIR } from "../../contracts/managed-config.ts";
import type { ManagedDir } from "../../contracts/managed-config.ts";
import { shippedText } from "../shipped-text.ts";

export interface MarkdownPaths {
  readonly generated: string;
  readonly preset: string;
  readonly extendsLine: string;
}

export const markdownPaths = (dir: ManagedDir): MarkdownPaths => {
  const generated = `${dir}/rumdl.toml`;
  return {
    extendsLine: `extends = ${JSON.stringify(generated)}\n`,
    generated,
    preset: `${dir}/presets/rumdl.toml`,
  };
};

export const CINCH_PATHS = markdownPaths(CINCH_MANAGED_DIR);

/** The standard as this Cinch ships it. Cinch owns the file. */
export const PRESET_PATH = CINCH_PATHS.preset;
/**
 * The config Cinch writes from the Cinch config. It extends the preset and
 * holds only what the repository stated.
 */
export const GENERATED_PATH = CINCH_PATHS.generated;
/** The config the engine finds first. It extends the generated one. */
export const CONFIG_PATH = ".rumdl.toml";
/** The table under `tools` in the Cinch config that the generated file holds. */
export const RUMDL_TABLE = "rumdl";

const SOURCE = new URL("../../../presets/rumdl.toml", import.meta.url);

/** The Markdown standard, as shipped. */
export const standard = (): Promise<string> => shippedText(SOURCE);

/** The line that makes the root config extend the generated one. */
export const EXTENDS = CINCH_PATHS.extendsLine;
