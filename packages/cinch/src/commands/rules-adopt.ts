import path from "node:path";

import type { Adapter } from "../adapters/adapter.ts";
import { namePacks } from "../config/rules-table.ts";
import type { CinchConfig } from "../contracts/config.ts";
import type { PackState } from "../contracts/plan.ts";
import { SCHEMA_VERSION } from "../contracts/plan.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import type { RulesAdoptReport } from "../contracts/rules-report.ts";
import { shippedStates } from "../policy/packs.ts";
import { unifiedDiff } from "../render/diff.ts";
import { renderAdopt } from "../render/rules.ts";
import type { CommandRequest, CommandResponse } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";
import { configText, outside } from "./relocate.ts";

const unusable = (message: string): CommandResponse => ({
  error: `cinch: ${message}`,
  exitCode: EXIT_CODE.incomplete,
});

/** The packs to add: those asked for, or every one that applies here. */
const chosen = (
  states: readonly PackState[],
  asked: readonly string[]
): PackState[] =>
  asked.length === 0
    ? states.filter(
        (pack) =>
          pack.found !== undefined &&
          pack.named === undefined &&
          pack.off === undefined
      )
    : states.filter(
        (pack) => asked.includes(pack.name) && pack.named === undefined
      );

/**
 * The names of the packs that apply to the repository and that its config
 * neither names nor turns off. `init` starts a new config with them, and
 * `doctor` reports them.
 */
export const unadopted = (
  config: CinchConfig,
  adapters: readonly Adapter[],
  present: readonly string[]
): string[] =>
  chosen(
    shippedStates(
      config,
      adapters.map(({ descriptor }) => descriptor),
      present
    ),
    []
  ).map(({ name }) => name);

/** Whether the config itself states that rules are off. */
export const declined = (config: CinchConfig): boolean =>
  config.settings.some(
    ({ key, source, value }) =>
      key === "rules.enabled" && value === false && source.kind === "file"
  );

const OFF_NOTE = (file: string): string =>
  `Rules are switched off in ${file} (\`enabled = false\`), so the packs it names do not run yet.`;

/**
 * `cinch rules adopt [pack...]` names rule packs in the Cinch config so they
 * run. With no name it takes every pack that applies to the repository and
 * is not named yet. It only shows the change, and writes it with `--yes`.
 * The Cinch config is the only file it writes.
 */
export const adopt = async (
  request: CommandRequest,
  deps: CommandDeps
): Promise<CommandResponse> => {
  const prepared = await prepare({ ...request, paths: [] }, deps);
  if (!prepared.ok) {
    return unusable(prepared.error);
  }
  const { adapters, config, present, root } = prepared.value;
  const states = shippedStates(
    config,
    adapters.map(({ descriptor }) => descriptor),
    present
  );
  const unknown = request.paths.find(
    (name) => !states.some((pack) => pack.name === name)
  );
  if (unknown !== undefined) {
    return unusable(`Cinch ships no rule pack named "${unknown}".`);
  }
  const respond = (
    report: Omit<RulesAdoptReport, "action" | "schemaVersion">,
    exitCode: CommandResponse["exitCode"] = EXIT_CODE.clean
  ): CommandResponse => {
    const whole: RulesAdoptReport = {
      action: "adopt",
      ...report,
      schemaVersion: SCHEMA_VERSION,
    };
    return {
      exitCode,
      output: request.json
        ? JSON.stringify(whole, null, 2)
        : renderAdopt(whole),
    };
  };
  const nothing = { adopted: [], changed: [], diff: "", written: false };
  const stop = (...stopped: string[]): CommandResponse =>
    respond({ ...nothing, notes: [], stopped }, EXIT_CODE.findings);
  const adds = chosen(states, request.paths);
  const stopped = adds.filter((pack) => pack.off !== undefined);
  if (stopped.length > 0) {
    return stop(
      ...stopped.map(
        ({ name }) =>
          `${name} is turned off under \`rules.off\`. Take it out of that list first.`
      )
    );
  }
  const text = await configText(root.root);
  if ("error" in text) {
    return unusable(text.error);
  }
  const notes = declined(config) ? [OFF_NOTE(text.file)] : [];
  if (adds.length === 0) {
    return respond({ ...nothing, notes });
  }
  const adopted = adds.map(({ name }) => name);
  const named = namePacks(text.text, text.prefix, [
    ...(config.rulesPacks?.value ?? []),
    ...adopted,
  ]);
  if (!named.ok) {
    return stop(named.reason);
  }
  const beyond = await outside(root.root, [{ path: text.file }]);
  if (beyond !== undefined) {
    return unusable(
      `${beyond} leads outside the repository, so Cinch will not write it.`
    );
  }
  const target = path.join(root.root, text.file);
  const handle = Bun.file(target);
  const before = (await handle.exists()) ? await handle.text() : "";
  const written = request.yes === true && request.dryRun !== true;
  if (written) {
    await Bun.write(target, named.text);
  }
  return respond({
    adopted,
    changed: [text.file],
    diff: unifiedDiff(text.file, before, named.text),
    notes,
    written,
  });
};
