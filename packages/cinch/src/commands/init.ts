import path from "node:path";

import { STANDALONE_FILE, configFileIn } from "../config/load.ts";
import type { FixReport } from "../contracts/fix.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import { unifiedDiff } from "../render/diff.ts";
import { renderInit, renderInitJson } from "../render/init.ts";
import type { Command } from "./command.ts";
import { runWrite } from "./fix.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";
import { locate } from "./presets.ts";
import { choiceReasons, oldConfigs, retire } from "./retire.ts";
import { inheritedBy, sparing, starterConfig } from "./starter.ts";

/** Puts the config file first in a report about the files Cinch keeps. */
const withConfig = (report: FixReport, config: string): FixReport => ({
  ...report,
  changed: [STANDALONE_FILE, ...report.changed],
  diff: `${unifiedDiff(STANDALONE_FILE, "", config)}${report.diff}`,
});

/**
 * Sets a repository up: a starting config when there is none, then every
 * preset that is switched on. The starting config takes the file choices of
 * a config an adapter replaces, except a choice that would leave out a file
 * Cinch keeps. Last, the config files of a tool an adapter replaces are
 * removed, when everything in them was carried over and the setup ended
 * clean. It only shows the change unless `yes` is set, and `dryRun` wins over
 * `yes`. A config that is already there is never rewritten.
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
    const { adapters, plan } = planned.value;
    const found = await inheritedBy(adapters, root);
    const carried =
      (await configFileIn(root)) === null ? sparing(found, paths) : null;
    const starter = carried === null ? null : starterConfig(carried);
    // The old config is judged now: once the new files are written, an
    // adapter can no longer tell what they were made from.
    const old = await oldConfigs(adapters, plan, root);
    if (starter !== null && apply) {
      await Bun.write(path.join(root, STANDALONE_FILE), starter);
    }
    const ran = await runWrite(
      { cwd: root, dryRun: !apply, json: request.json, paths },
      deps,
      { also: old.files, mode: "init" }
    );
    if (!ran.ok) {
      return ran.response;
    }
    const fixed =
      starter === null ? ran.report : withConfig(ran.report, starter);
    const retired = await retire(
      { ...old, reasons: [...old.reasons, ...choiceReasons(found, carried)] },
      { apply, clean: fixed.result.outcome === "clean", root }
    );
    const report = { ...fixed, retired };
    return {
      exitCode: EXIT_CODE[report.result.outcome],
      output: request.json ? renderInitJson(report) : renderInit(report),
    };
  };
