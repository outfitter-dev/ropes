import type { Adapter } from "./adapter.ts";
import type { Pins } from "./pins.ts";
import { rumdlAdapter } from "./rumdl/adapter.ts";

/**
 * The only place adapters are listed. Adding an engine is one new folder under
 * `adapters/` and one line here. Order is the order steps run on a file. Each
 * adapter is handed the version the repository pins for its tool. The Bun
 * formatter for fences comes next (FIT-13).
 */
export const adaptersFor = (pins: Pins): readonly Adapter[] => [
  rumdlAdapter({ version: pins.rumdl }),
];
