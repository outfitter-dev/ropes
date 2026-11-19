import type { PresetFile, PresetReport } from "../contracts/preset.ts";

const line = (file: PresetFile): string =>
  [`  ${file.state.padEnd(8)} ${file.path}`, file.message]
    .filter((part) => part !== undefined)
    .join("\n           ");

const NEEDS_UPDATE = new Set(["stale", "missing"]);

/** Text for a person: each preset, its files and the state of each. */
export const renderPresets = (report: PresetReport): string => {
  if (report.presets.length === 0) {
    return "This version of Cinch ships no presets.";
  }
  const blocks = report.presets.map((preset) =>
    [preset.name, ...preset.files.map(line)].join("\n")
  );
  const behind = report.presets.some((preset) =>
    preset.files.some((file) => NEEDS_UPDATE.has(file.state))
  );
  return [
    ...blocks,
    ...(behind ? ["Run `cinch preset update` to write what is behind."] : []),
  ].join("\n\n");
};

export const renderPresetsJson = (report: PresetReport): string =>
  JSON.stringify(report, null, 2);

/** What `init` adds below the fix report when it only showed the change. */
export const renderInitHint = (changes: number, dryRun: boolean): string => {
  if (changes === 0) {
    return "Nothing to set up.";
  }
  return dryRun ? "Dry run: nothing was written." : "";
};

/** How `init` asks before it writes, and what to run when it cannot ask. */
export const INIT_CONFIRM = {
  otherwise: "Run `cinch init --yes` to write this.",
  question: "Write these files?",
};
