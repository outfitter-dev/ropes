import { CINCH_MANAGED_DIR } from "../../contracts/managed-config.ts";
import type { ManagedDir } from "../../contracts/managed-config.ts";
import type { Adapter } from "../adapter.ts";
import { shippedPreset } from "../shipped.ts";
import { rootConfigFor } from "./root-config.ts";

export { PRESET_PATH, ROOT_PATH } from "./paths.ts";

/**
 * The shared strict compiler options. They name no files: the root
 * `tsconfig.json` extends the copy and states its own `include`.
 */
export const tsconfigPreset = (
  managedDir: ManagedDir = CINCH_MANAGED_DIR
): Adapter => {
  const preset = `${managedDir}/presets/tsconfig.json`;
  return shippedPreset({
    comment: "//",
    enabledBy: "typescript.preset",
    id: "tsconfig-preset",
    path: preset,
    preset: "typescript",
    root: rootConfigFor(preset),
    source: new URL("../../../presets/tsconfig.json", import.meta.url),
  });
};
