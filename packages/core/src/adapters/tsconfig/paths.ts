import { LEGACY_MANAGED_DIR } from "../../contracts/managed-config.ts";

/** The copy of the preset as this Ropes ships it. */
export const PRESET_PATH = `${LEGACY_MANAGED_DIR}/presets/tsconfig.json`;

/** The compiler's own config, which must extend the copy. */
export const ROOT_PATH = "tsconfig.json";
