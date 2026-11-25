import { LEGACY_MANAGED_DIR } from "../../contracts/managed-config.ts";
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

export const LEGACY_PATHS = markdownPaths(LEGACY_MANAGED_DIR);

/** The standard as this Ropes ships it. Ropes owns the file. */
export const PRESET_PATH = LEGACY_PATHS.preset;
/**
 * The config Ropes writes from the Ropes config. It extends the preset and
 * holds only what the repository stated.
 */
export const GENERATED_PATH = LEGACY_PATHS.generated;
/** The config the engine finds first. It extends the generated one. */
export const CONFIG_PATH = ".rumdl.toml";
/** The table under `tools` in the Ropes config that the generated file holds. */
export const RUMDL_TABLE = "rumdl";

const SOURCE = new URL("../../../presets/rumdl.toml", import.meta.url);

/** The Markdown standard, as shipped. */
export const standard = (): Promise<string> => shippedText(SOURCE);

/** The line that makes the root config extend the generated one. */
export const EXTENDS = LEGACY_PATHS.extendsLine;
