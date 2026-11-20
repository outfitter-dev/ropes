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
import { inheritedBy, starterConfig } from "./starter.ts";

/** Puts the config file first in a report about the files Cinch keeps. */
const withConfig = (report: FixReport, config: string): FixReport => ({
  ...report,
  changed: [STANDALONE_FILE, ...report.changed],
  diff: `${unifiedDiff(STANDALONE_FILE, "", config)}${report.diff}`,
});

/**
 * Sets a repository up: a starting config when there is none, then every
 * preset that is switched on. The starting config takes the file choices of
 * a config an adapter replaces. It only shows the change unless `yes` is set,
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
    const starter =
      (await configFileIn(root)) === null
        ? starterConfig(await inheritedBy(planned.value.adapters, root))
        : null;
    if (starter !== null && apply) {
      await Bun.write(path.join(root, STANDALONE_FILE), starter);
    }
    const ran = await runFix(
      { cwd: root, dryRun: !apply, json: request.json, paths },
      deps
    );
    if (!ran.ok) {
      return ran.response;
    }
    const report =
      starter === null ? ran.report : withConfig(ran.report, starter);
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
