import type { BuiltOn } from "./built-on.ts";

/**
 * The package the lint and formatter presets import their rules from, at
 * the version this Cinch wrote them against.
 */
export const PRESET_BASE: BuiltOn = { name: "ultracite", version: "8.1.1" };
