import path from "node:path";

import { ROPES_FILE, configFileIn } from "../config/load.ts";
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
import { readBy, unadopted } from "./rules-adopt.ts";
import { setupFiles } from "./setup.ts";
import { inheritedBy, sparing, starterConfig } from "./starter.ts";

/** Puts the config file first in a report about the files Ropes keeps. */
const withConfig = (report: FixReport, config: string): FixReport => ({
  ...report,
  changed: [ROPES_FILE, ...report.changed],
  diff: `${unifiedDiff(ROPES_FILE, "", config)}${report.diff}`,
});

/**
 * Sets a repository up: a starting config when there is none, then every
 * preset that is switched on. The starting config takes the file choices of
 * a config an adapter replaces, except a choice that would leave out a file
 * Ropes keeps, and names the rule packs that apply here. Last, the config files of a tool an adapter replaces are
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
    // Every file of the setup, so a config that is already there and asks
    // for another kept file gets it written too.
    const paths = await setupFiles(deps, root);
    // Plan before writing anything, so a setup that cannot be planned does
    // not leave a config behind with no presets beside it.
    const strict = request.strict === true;
    const planned = await prepare({ cwd: root, paths, strict }, deps);
    if (!planned.ok) {
      return {
        error: `cinch: ${planned.error}`,
        exitCode: EXIT_CODE.incomplete,
      };
    }
    const { adapters, config, plan, present } = planned.value;
    const found = await inheritedBy(adapters, root);
    // A table carried into the new config can make Ropes keep a file the
    // setup did not have yet, and an old exclude must not leave that out.
    const kept = [...paths, ...found.flatMap((one) => one.keeps ?? [])];
    const carried =
      (await configFileIn(root)) === null ? sparing(found, kept) : null;
    const packs = unadopted(config, adapters, present);
    const starter =
      carried === null
        ? null
        : starterConfig(carried, packs, readBy(adapters, packs));
    // The old config is judged now: once the new files are written, an
    // adapter can no longer tell what they were made from.
    const old = await oldConfigs(adapters, plan, root);
    if (starter !== null && apply) {
      await Bun.write(path.join(root, ROPES_FILE), starter);
    }
    const ran = await runWrite(
      { cwd: root, dryRun: !apply, paths, strict },
      deps,
      { also: old.files, mode: "init" }
    );
    if (!ran.ok) {
      return { error: `cinch: ${ran.error}`, exitCode: EXIT_CODE.incomplete };
    }
    const fixed = starter === null ? ran.value : withConfig(ran.value, starter);
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
