import type { ToolTables } from "../contracts/config.ts";
import type { EditorSettings } from "../contracts/editor.ts";
import { CINCH_MANAGED_DIR } from "../contracts/managed-config.ts";
import type { ManagedDir } from "../contracts/managed-config.ts";
import type { Adapter } from "./adapter.ts";
import { rulesAdapter } from "./ast-grep/adapter.ts";
import { bunCheckAdapter } from "./bun-check/adapter.ts";
import { compilerApiAdapter } from "./bun-check/compatibility.ts";
import { bunFmtAdapter } from "./bun-fmt/adapter.ts";
import { editorFileAdapter } from "./editorconfig/adapter.ts";
import { editorCheckerAdapter } from "./editorconfig/check-adapter.ts";
import { lycheeAdapter } from "./lychee/adapter.ts";
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
 * editor settings file is kept only when the config states its facts, and
 * until then its adapter keeps nothing. The
 * presets for the lint, format and TypeScript configs are off until the
 * config asks for each, and so are the lint engine, the type check and the
 * formatter, and the rules Cinch ships. The rules adapter is also handed the
 * folders of rules the repository names as its own. The
 * formatter is last, so in a fix it formats what the others wrote.
 */
export const adaptersFor = (
  pins: Pins,
  tables: ToolTables = {},
  editor?: EditorSettings,
  localRules?: readonly string[],
  managedDir: ManagedDir = CINCH_MANAGED_DIR
): readonly Adapter[] => [
  editorFileAdapter(editor),
  editorCheckerAdapter(editor, pins["editorconfig-checker"]),
  rumdlPresetAdapter({ managedDir, table: tables[RUMDL_TABLE] }),
  oxlintPreset(managedDir),
  oxfmtPreset(managedDir),
  tsconfigPreset(managedDir),
  rumdlAdapter({ version: pins.rumdl }),
  lycheeAdapter(pins.lychee),
  taploAdapter({ version: pins.taplo }),
  oxlintAdapter({ version: pins.oxlint }),
  compilerApiAdapter(pins.bun, "tsconfig.json"),
  bunCheckAdapter({ version: pins.bun }),
  rulesAdapter({ local: localRules, version: pins["ast-grep"] }),
  bunFmtAdapter({ version: pins.bun }),
];
