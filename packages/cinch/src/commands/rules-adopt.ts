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
import type {
  CommandRequest,
  CommandResponse,
  Operation,
  ReadRequest,
} from "./command.ts";
import type { CommandDeps } from "./prepare.ts";
import { outside } from "./relocate.ts";
import { unreached } from "./rules-reach.ts";
import { prepareAdoption, policyStillCurrent } from "./rules-snapshot.ts";

const unusable = (error: string): Operation<RulesAdoptReport> => ({
  error,
  ok: false,
});

export interface RulesAdoptRequest extends ReadRequest {
  readonly yes?: boolean;
  readonly dryRun?: boolean;
}

/** The packs to add: those asked for, or every one that applies here. */
const chosen = (
  states: readonly PackState[],
  asked: readonly string[]
): PackState[] =>
  asked.length === 0
    ? states.filter(
        (pack) =>
          pack.found !== undefined &&
          pack.explicitOnly !== true &&
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

/** The globs for the files the named packs are about. */
export const readBy = (
  adapters: readonly Adapter[],
  names: readonly string[]
): string[] =>
  adapters
    .flatMap(({ descriptor }) => descriptor.packs ?? [])
    .filter((pack) => names.includes(pack.name))
    .flatMap((pack) => pack.relevant);

/** Whether the config itself states that rules are off. */
export const declined = (config: CinchConfig): boolean =>
  config.settings.some(
    ({ key, source, value }) =>
      key === "rules.enabled" && value === false && source.kind === "file"
  );

const OFF_NOTE = (file: string): string =>
  `Rules are switched off in ${file} (\`enabled = false\`), so the packs it names do not run yet.`;

const respond = (
  report: Omit<RulesAdoptReport, "action" | "schemaVersion">
): Operation<RulesAdoptReport> => ({
  ok: true,
  value: { action: "adopt", ...report, schemaVersion: SCHEMA_VERSION },
});
const nothing = { adopted: [], changed: [], diff: "", written: false };
const stop = (...stopped: string[]): Operation<RulesAdoptReport> =>
  respond({ ...nothing, notes: [], stopped });

/**
 * `cinch rules adopt [pack...]` names rule packs in the Cinch config so they
 * run. With no name it takes every pack that applies to the repository and
 * is not named yet. It only shows the change, and writes it with `--yes`.
 * The Cinch config is the only file it writes.
 */
export const adoptRules = async (
  request: RulesAdoptRequest,
  deps: CommandDeps,
  requireConfig = true
): Promise<Operation<RulesAdoptReport>> => {
  const prepared = await prepareAdoption(request, deps, requireConfig);
  if (!prepared.ok) {
    return prepared;
  }
  const { adapters, config, present, root } = prepared.value.prepared;
  const { text } = prepared.value;
  const states = shippedStates(
    config,
    adapters.map(({ descriptor }) => descriptor),
    present
  );
  const unknown = request.paths.find(
    (name) => !states.some((pack) => pack.name === name)
  );
  if (unknown !== undefined) {
    return unusable(
      `${requireConfig ? "Ropes" : "Cinch"} ships no rule pack named "${unknown}".`
    );
  }
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
  const notes = declined(config) ? [OFF_NOTE(text.file)] : [];
  if (adds.length === 0) {
    return respond({ ...nothing, notes });
  }
  const adopted = adds.map(({ name }) => name);
  const preserveScope =
    requireConfig &&
    config.overrides.some(({ settings }) =>
      settings.some(({ key }) => key === "rules.enabled")
    );
  const left = await unreached(request, deps, {
    adapters,
    file: text.file,
    // Adoption enables root rules only when policy has no existing switch.
    includeDisabled:
      requireConfig &&
      (preserveScope ||
        config.settings.some(
          ({ key, source }) => key === "rules.enabled" && source.kind === "file"
        )),
    names: adopted,
    present,
    root: root.root,
  });
  const named = namePacks(
    text.text,
    text.prefix,
    [...(config.rulesPacks?.value ?? []), ...adopted],
    !preserveScope
  );
  if (!named.ok) {
    return stop(named.reason);
  }
  const beyond = await outside(root.root, [{ path: text.file }]);
  if (beyond !== undefined) {
    return unusable(
      `${beyond} leads outside the repository, so ${requireConfig ? "Ropes" : "Cinch"} will not write it.`
    );
  }
  const target = path.join(root.root, text.file);
  const handle = Bun.file(target);
  const before = (await handle.exists()) ? await handle.text() : "";
  const written = request.yes === true && request.dryRun !== true;
  if (written) {
    if (!(await policyStillCurrent(root.root, text, before))) {
      return unusable(
        "The policy changed during adoption. Run the command again."
      );
    }
    await Bun.write(target, named.text);
  }
  return respond({
    adopted,
    changed: [text.file],
    diff: unifiedDiff(text.file, before, named.text),
    notes: [...notes, ...left],
    written,
  });
};

/** Legacy rendering remains a thin wrapper around the typed operation. */
export const adopt = async (
  request: CommandRequest,
  deps: CommandDeps
): Promise<CommandResponse> => {
  const ran = await adoptRules(request, deps, false);
  if (!ran.ok) {
    return { error: `cinch: ${ran.error}`, exitCode: EXIT_CODE.incomplete };
  }
  return {
    exitCode:
      ran.value.stopped === undefined ? EXIT_CODE.clean : EXIT_CODE.findings,
    output: request.json
      ? JSON.stringify(ran.value, null, 2)
      : renderAdopt(ran.value),
  };
};
