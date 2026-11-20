import { shippedText } from "../shipped-text.ts";

/** The standard as this Cinch ships it. Cinch owns the file. */
export const PRESET_PATH = ".outfitter/configs/presets/rumdl.toml";
/**
 * The config Cinch writes from the Cinch config. It extends the preset and
 * holds only what the repository stated.
 */
export const GENERATED_PATH = ".outfitter/configs/rumdl.toml";
/** The config the engine finds first. It extends the generated one. */
export const CONFIG_PATH = ".rumdl.toml";
/** The table under `tools` in the Cinch config that the generated file holds. */
export const RUMDL_TABLE = "rumdl";

const SOURCE = new URL("../../../presets/rumdl.toml", import.meta.url);

/** The Markdown standard, as shipped. */
export const standard = (): Promise<string> => shippedText(SOURCE);

/** The line that makes the root config extend the generated one. */
export const EXTENDS = `extends = ${JSON.stringify(GENERATED_PATH)}\n`;
