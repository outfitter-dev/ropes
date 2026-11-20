import type { Adapter } from "../adapter.ts";
import { shippedPreset } from "../shipped.ts";
import { PRESET_PATH } from "./paths.ts";
import { rootConfig } from "./root-config.ts";

export { PRESET_PATH, ROOT_PATH } from "./paths.ts";

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
    root: rootConfig,
    source: new URL("../../../presets/tsconfig.json", import.meta.url),
  });
