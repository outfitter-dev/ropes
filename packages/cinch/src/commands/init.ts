import path from "node:path";

import { STANDALONE_FILE, configFileIn } from "../config/load.ts";
import type { FixReport } from "../contracts/fix.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import { unifiedDiff } from "../render/diff.ts";
import { renderFix, renderFixJson } from "../render/fix.ts";
import { renderInitHint } from "../render/preset.ts";
import type { Command } from "./command.ts";
import { runFix } from "./fix.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";
import { locate } from "./presets.ts";

/**
 * What a repository with no Cinch config starts with. It states the defaults,
 * so the plan is the same before and after the file is written.
 */
export const STARTER_CONFIG = [
  "# Cinch config. This is the unstable pilot format and will change.",
  "pilot = 0",
  "",
  "[markdown]",
  "enabled = true",
  "preset = true",
  "",
].join("\n");

/** Puts the config file first in a report about the files Cinch keeps. */
const withConfig = (report: FixReport): FixReport => ({
  ...report,
  changed: [STANDALONE_FILE, ...report.changed],
  diff: `${unifiedDiff(STANDALONE_FILE, "", STARTER_CONFIG)}${report.diff}`,
});

/**
 * Sets a repository up: a starting config when there is none, then every
 * preset that is switched on. It only shows the change unless `yes` is set,
 * and `dryRun` wins over `yes`. A config that is already there is never
 * rewritten.
 */
export const init =
  (deps: CommandDeps): Command =>
  async (request) => {
    const located = await locate(request.cwd, deps);
    if (!located.ok) {
      return {
        error: `cinch: ${located.error}`,
        exitCode: EXIT_CODE.incomplete,
      };
    }
    const { root } = located.root;
    const apply = request.yes === true && request.dryRun !== true;
    const paths = located.presets.flatMap((preset) => preset.files);
    // Plan before writing anything, so a setup that cannot be planned does
    // not leave a config behind with no presets beside it.
    const planned = await prepare({ cwd: root, paths }, deps);
    if (!planned.ok) {
      return {
        error: `cinch: ${planned.error}`,
        exitCode: EXIT_CODE.incomplete,
      };
    }
    const starting = (await configFileIn(root)) === null;
    if (starting && apply) {
      await Bun.write(path.join(root, STANDALONE_FILE), STARTER_CONFIG);
    }
    const ran = await runFix(
      { cwd: root, dryRun: !apply, json: request.json, paths },
      deps
    );
    if (!ran.ok) {
      return ran.response;
    }
    const report = starting ? withConfig(ran.report) : ran.report;
    const exitCode = EXIT_CODE[report.result.outcome];
    const changes = report.changed.length;
    if (request.json) {
      return { exitCode, output: renderFixJson(report) };
    }
    const text = renderFix(report);
    return {
      exitCode,
      output: apply ? text : `${text}\n\n${renderInitHint(changes)}`,
    };
  };
