import type { Adapter } from "../adapter.ts";
import { shippedPreset } from "../shipped.ts";

/** The copy of the preset as this Cinch ships it. */
export const PRESET_PATH = ".outfitter/configs/presets/tsconfig.json";

/**
 * The shared strict compiler options. They name no files: the root
 * `tsconfig.json` extends the copy and states its own `include`.
 */
export const tsconfigPreset = (): Adapter =>
  shippedPreset({
    comment: "//",
    enabledBy: "typescript.preset",
    id: "tsconfig-preset",
    path: PRESET_PATH,
    preset: "typescript",
    source: new URL("../../../presets/tsconfig.json", import.meta.url),
  });
