import type { ToolTables } from "../contracts/config.ts";
import type { EditorSettings } from "../contracts/editor.ts";
import type { Adapter } from "./adapter.ts";
import { bunCheckAdapter } from "./bun-check/adapter.ts";
import { bunFmtAdapter } from "./bun-fmt/adapter.ts";
import { editorFileAdapter } from "./editorconfig/adapter.ts";
import { oxfmtPreset } from "./oxfmt/preset.ts";
import { oxlintAdapter } from "./oxlint/adapter.ts";
import { oxlintPreset } from "./oxlint/preset.ts";
import type { Pins } from "./pins.ts";
import { rumdlAdapter } from "./rumdl/adapter.ts";
import { RUMDL_TABLE, rumdlPresetAdapter } from "./rumdl/preset.ts";
import { taploAdapter } from "./taplo/adapter.ts";
import { tsconfigPreset } from "./tsconfig/preset.ts";

/**
 * The only place adapters are listed. Adding an engine is one new folder under
 * `adapters/` and one line here. Order is the order steps run on a file. Each
 * adapter is handed the version the repository pins for its tool. An engine's
 * shared config preset is an adapter too, kept in the engine's own folder,
 * and it is handed the table the Cinch config states for that engine. The
 * editor settings file is kept only when the config states its facts. The
 * presets for the lint, format and TypeScript configs are off until the
 * config asks for each, and so are the lint engine, the type check and the
 * formatter. The
 * formatter is last, so in a fix it formats what the others wrote.
 */
export const adaptersFor = (
  pins: Pins,
  tables: ToolTables = {},
  editor?: EditorSettings
): readonly Adapter[] => [
  ...(editor === undefined ? [] : [editorFileAdapter(editor)]),
  rumdlPresetAdapter({ table: tables[RUMDL_TABLE] }),
  oxlintPreset(),
  oxfmtPreset(),
  tsconfigPreset(),
  rumdlAdapter({ version: pins.rumdl }),
  taploAdapter({ version: pins.taplo }),
  oxlintAdapter({ version: pins.oxlint }),
  bunCheckAdapter({ version: pins.bun }),
  bunFmtAdapter({ version: pins.bun }),
];
