import path from "node:path";

import { STANDALONE_FILE, configFileIn } from "../config/load.ts";
import type { FixReport } from "../contracts/fix.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import { unifiedDiff } from "../render/diff.ts";
import { renderFix, renderFixJson } from "../render/fix.ts";
import { INIT_CONFIRM, renderInitHint } from "../render/preset.ts";
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
 * preset that is switched on. With `yes` it writes. With `dryRun` it only
 * shows the change. With neither it shows the change and offers to write it,
 * which the caller confirms. A config that is already there is never rewritten.
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
    const asks = !apply && changes > 0 && request.dryRun !== true;
    const offer = asks ? { confirm: INIT_CONFIRM } : {};
    if (request.json) {
      return { ...offer, exitCode, output: renderFixJson(report) };
    }
    const text = renderFix(report);
    if (apply) {
      return { exitCode, output: text };
    }
    const hint = renderInitHint(changes, request.dryRun === true);
    return {
      ...offer,
      exitCode,
      output: hint === "" ? text : `${text}\n\n${hint}`,
    };
  };
