import type { Adapter } from "../adapter.ts";
import { PRESET_BASE } from "../preset-base.ts";
import { moduleRoot } from "../root-module.ts";
import { shippedPreset } from "../shipped.ts";

/** The copy of the preset as this Cinch ships it. */
export const PRESET_PATH = ".outfitter/configs/presets/oxfmt.ts";

/** The tool's own config, which must build on the copy. */
export const ROOT_PATH = "oxfmt.config.ts";

const FRESH = `import { defineConfig } from "oxfmt";\n\nimport preset from "./${PRESET_PATH}";\n\nexport default defineConfig({ ...preset });\n`;

/**
 * The shared formatter config. It builds on Ultracite, so a repository that
 * keeps it needs Ultracite and the formatter installed. The root
 * `oxfmt.config.ts` spreads it.
 */
export const oxfmtPreset = (): Adapter =>
  shippedPreset({
    builtOn: PRESET_BASE,
    comment: "//",
    enabledBy: "format.preset",
    id: "oxfmt-preset",
    path: PRESET_PATH,
    preset: "format",
    root: moduleRoot({
      fresh: FRESH,
      path: ROOT_PATH,
      preset: PRESET_PATH,
      siblings: [".oxfmtrc.json", ".oxfmtrc.jsonc", "oxfmt.config.mts"],
      table: "format",
      use: "spread it into the config",
    }),
    source: new URL("../../../presets/oxfmt.ts", import.meta.url),
  });
