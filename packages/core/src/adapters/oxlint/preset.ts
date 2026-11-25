import { LEGACY_MANAGED_DIR } from "../../contracts/managed-config.ts";
import type { ManagedDir } from "../../contracts/managed-config.ts";
import type { Adapter } from "../adapter.ts";
import { PRESET_BASE } from "../preset-base.ts";
import { moduleRoot } from "../root-module.ts";
import { shippedPreset } from "../shipped.ts";

/** The copy of the preset as this Ropes ships it. */
export const PRESET_PATH = `${LEGACY_MANAGED_DIR}/presets/oxlint.ts`;

/** The tool's own config, which must build on the copy. */
export const ROOT_PATH = "oxlint.config.ts";

/**
 * The shared lint config. It builds on Ultracite, so a repository that
 * keeps it needs Ultracite and the linter installed. The root
 * `oxlint.config.ts` lists it under `extends`.
 */
export const oxlintPreset = (
  managedDir: ManagedDir = LEGACY_MANAGED_DIR
): Adapter => {
  const preset = `${managedDir}/presets/oxlint.ts`;
  return shippedPreset({
    builtOn: PRESET_BASE,
    comment: "//",
    enabledBy: "lint.preset",
    id: "oxlint-preset",
    path: preset,
    preset: "lint",
    root: moduleRoot({
      fresh: `import { defineConfig } from "oxlint";\n\nimport preset from "./${preset}";\n\nexport default defineConfig({ extends: [preset] });\n`,
      path: ROOT_PATH,
      preset,
      siblings: [".oxlintrc.json"],
      table: "lint",
      use: "list it under `extends`",
    }),
    source: new URL("../../../presets/oxlint.ts", import.meta.url),
  });
};
