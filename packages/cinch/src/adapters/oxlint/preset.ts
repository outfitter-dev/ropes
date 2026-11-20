import type { Adapter } from "../adapter.ts";
import { PRESET_BASE } from "../preset-base.ts";
import { moduleRoot } from "../root-module.ts";
import { shippedPreset } from "../shipped.ts";

/** The copy of the preset as this Cinch ships it. */
export const PRESET_PATH = ".outfitter/configs/presets/oxlint.ts";

/** The tool's own config, which must build on the copy. */
export const ROOT_PATH = "oxlint.config.ts";

const FRESH = `import { defineConfig } from "oxlint";\n\nimport preset from "./${PRESET_PATH}";\n\nexport default defineConfig({ extends: [preset] });\n`;

/**
 * The shared lint config. It builds on Ultracite, so a repository that
 * keeps it needs Ultracite and the linter installed. The root
 * `oxlint.config.ts` lists it under `extends`.
 */
export const oxlintPreset = (): Adapter =>
  shippedPreset({
    builtOn: PRESET_BASE,
    comment: "//",
    enabledBy: "lint.preset",
    id: "oxlint-preset",
    path: PRESET_PATH,
    preset: "lint",
    root: moduleRoot({
      fresh: FRESH,
      path: ROOT_PATH,
      preset: PRESET_PATH,
      siblings: [".oxlintrc.json"],
      table: "lint",
      use: "list it under `extends`",
    }),
    source: new URL("../../../presets/oxlint.ts", import.meta.url),
  });
