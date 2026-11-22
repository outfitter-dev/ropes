import { CINCH_MANAGED_DIR } from "../../contracts/managed-config.ts";
import type { ManagedDir } from "../../contracts/managed-config.ts";
import type { Adapter } from "../adapter.ts";
import { PRESET_BASE } from "../preset-base.ts";
import { moduleRoot } from "../root-module.ts";
import { shippedPreset } from "../shipped.ts";

/** The copy of the preset as this Cinch ships it. */
export const PRESET_PATH = `${CINCH_MANAGED_DIR}/presets/oxfmt.ts`;

/** The tool's own config, which must build on the copy. */
export const ROOT_PATH = "oxfmt.config.ts";

/** Compatibility config names the repository's formatter can discover. */
export const CONFIG_FILES = [
  ".oxfmtrc",
  ".oxfmtrc.json",
  ".oxfmtrc.jsonc",
  ".oxfmtrc.yaml",
  ".oxfmtrc.yml",
  ".oxfmtrc.toml",
  ROOT_PATH,
  "oxfmt.config.mts",
  "oxfmt.config.cts",
  "oxfmt.config.js",
  "oxfmt.config.mjs",
  "oxfmt.config.cjs",
] as const;

/**
 * The shared formatter config. It builds on Ultracite, so a repository that
 * keeps it needs Ultracite and the formatter installed. The root
 * `oxfmt.config.ts` spreads it.
 */
export const oxfmtPreset = (
  managedDir: ManagedDir = CINCH_MANAGED_DIR
): Adapter => {
  const preset = `${managedDir}/presets/oxfmt.ts`;
  return shippedPreset({
    builtOn: PRESET_BASE,
    comment: "//",
    enabledBy: "format.preset",
    id: "oxfmt-preset",
    path: preset,
    preset: "format",
    root: moduleRoot({
      fresh: `import { defineConfig } from "oxfmt";\n\nimport preset from "./${preset}";\n\nexport default defineConfig({ ...preset });\n`,
      path: ROOT_PATH,
      preset,
      siblings: [".oxfmtrc.json", ".oxfmtrc.jsonc", "oxfmt.config.mts"],
      table: "format",
      use: "spread it into the config",
    }),
    source: new URL("../../../presets/oxfmt.ts", import.meta.url),
  });
};
