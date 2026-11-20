import type { ToolTable } from "../../contracts/config.ts";
import type { Adapter } from "../adapter.ts";
import { managedAdapter } from "../managed.ts";
import { generated, preset } from "./generated.ts";
import { markdownlintSource } from "./migrate/markdownlint/index.ts";
import {
  CONFIG_PATH,
  GENERATED_PATH,
  PRESET_PATH,
  RUMDL_TABLE,
  standard,
} from "./paths.ts";
import { adopt } from "./relocate/adopt.ts";
import { eject } from "./relocate/eject.ts";
import { ELSEWHERE, rootConfig } from "./root-config.ts";

export {
  CONFIG_PATH,
  GENERATED_PATH,
  PRESET_PATH,
  RUMDL_TABLE,
} from "./paths.ts";
export { POINTER } from "./root-config.ts";

/**
 * Keeps the Markdown config in a repository as three files the engine
 * reads through `extends`, and never merges them: the preset this Cinch
 * ships, the config generated from the Cinch config, and the root config
 * that extends the generated one.
 */
export const rumdlPresetAdapter = (
  options: {
    /** The engine's executable. */
    readonly command?: string;
    /** What the Cinch config states for the engine. */
    readonly table?: ToolTable | undefined;
  } = {}
): Adapter =>
  managedAdapter({
    enabledBy: "markdown.preset",
    files: [
      { layer: "preset", path: PRESET_PATH, want: preset },
      {
        layer: "generated",
        path: GENERATED_PATH,
        want: () => generated(options.table),
      },
      {
        beside: ELSEWHERE,
        layer: "root",
        path: CONFIG_PATH,
        want: (current, root, migrate) =>
          rootConfig(current, {
            ...(options.command === undefined
              ? {}
              : { command: options.command }),
            migrate,
            root,
            table: options.table,
          }),
      },
    ],
    id: "rumdl-preset",
    migrates: [
      markdownlintSource(async () => ({
        ...(options.command === undefined ? {} : { command: options.command }),
        config: CONFIG_PATH,
        extended: GENERATED_PATH,
        standard: await standard(),
        table: options.table,
      })),
    ],
    preset: "markdown",
    relocates: {
      adopt: (root, config) => adopt(root, config, options.table),
      eject: (root, config) => eject(root, config, options.table),
    },
    table: RUMDL_TABLE,
  });
