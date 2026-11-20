import type { Adapter } from "../adapter.ts";
import { shippedPreset } from "../shipped.ts";

/** The copy of the preset as this Cinch ships it. */
export const PRESET_PATH = ".outfitter/configs/presets/oxfmt.ts";

/**
 * The shared formatter config. It builds on Ultracite, so a repository that
 * keeps it needs Ultracite and the formatter installed. The root
 * `oxfmt.config.ts` spreads it.
 */
export const oxfmtPreset = (): Adapter =>
  shippedPreset({
    comment: "//",
    enabledBy: "format.preset",
    id: "oxfmt-preset",
    path: PRESET_PATH,
    preset: "format",
    source: new URL("../../../presets/oxfmt.ts", import.meta.url),
  });
