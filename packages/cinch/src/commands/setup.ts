import { loadConfig } from "../config/load.ts";
import { managedDirFor } from "../config/managed.ts";
import { discoverRoot } from "../config/root.ts";
import { DEFAULT_CONFIG } from "../contracts/config.ts";
import type { CinchConfig } from "../contracts/config.ts";
import { setupOf } from "../policy/setup.ts";
import { describeRootError } from "./errors.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps, Prepared, PrepareResult } from "./prepare.ts";
import { describeGap, gapsOf, settingOf } from "./preset-gaps.ts";
import { presetsOf } from "./presets.ts";
import { settle } from "./settle.ts";

/**
 * The files of the Cinch setup at `root`. An adapter that keeps files needs
 * no pinned tool, so the list does not depend on the repository's pins. It
 * does depend on the config, which can ask for a file to be kept. A config
 * that cannot be read is reported by the plan that follows.
 */
export const setupFiles = async (
  deps: CommandDeps,
  root: string,
  starter?: CinchConfig
): Promise<string[]> => {
  const config = await loadConfig(root, starter);
  const stated = config.ok ? config.value : DEFAULT_CONFIG;
  const adapters = deps.adapters(
    {},
    stated.tools,
    stated.editor,
    undefined,
    managedDirFor(stated.file),
    stated.install
  );
  const settled = await settle(adapters, root, stated);
  return (settled.ok ? settled.adapters : adapters).flatMap(({ descriptor }) =>
    descriptor.setup === true ? (descriptor.owns ?? []) : []
  );
};

/**
 * One line for each kept file that is not a preset's and that the config
 * excludes while its adapter is on. A preset's files are judged with the
 * preset, which has a name a person can be told.
 */
const excludedKept = ({ adapters, plan }: Prepared): string[] =>
  adapters.flatMap(({ descriptor }) => {
    if (descriptor.setup !== true || descriptor.preset !== undefined) {
      return [];
    }
    return (descriptor.owns ?? []).flatMap((file) => {
      const entry = plan.paths.find((planned) => planned.path === file);
      const off = entry?.policy.some(
        (setting) =>
          setting.key === descriptor.enabledBy && setting.value === false
      );
      return entry?.skipped?.reason === "excluded" && off !== true
        ? [
            `the Cinch config leaves ${file} out (${settingOf(entry.skipped)}), so Cinch cannot keep it. Take the file out of that setting, then run this again.`,
          ]
        : [];
    });
  });

/**
 * The plan of the Cinch setup at the root above `cwd`: every file Cinch
 * keeps there, with only the steps that keep it. It is the same plan
 * `explain` shows for those files, less the steps of other adapters.
 *
 * A kept file the config leaves out cannot be kept, and passing over it
 * would read as a setup in good shape, so that is an error for every
 * caller, whether the file is a preset's or another the config asks for. A
 * preset that is switched off is not part of the setup.
 */
export const prepareSetup = async (
  cwd: string,
  deps: CommandDeps,
  options?: { readonly starter?: CinchConfig; readonly strict?: boolean }
): Promise<PrepareResult> => {
  const found = await discoverRoot(cwd);
  if (!found.ok) {
    return { error: describeRootError(found.error), ok: false };
  }
  // With no file to keep, no paths means the whole workspace, and
  // `setupOf` then leaves an empty plan.
  const paths = await setupFiles(deps, found.value.root, options?.starter);
  const prepared = await prepare(
    { cwd: found.value.root, paths, strict: options?.strict === true },
    deps,
    false,
    options?.starter
  );
  if (!prepared.ok) {
    return prepared;
  }
  const gaps = gapsOf(
    presetsOf(prepared.value.adapters),
    prepared.value.plan
  ).filter((gap) => gap.why === "left-out");
  const problems = [...gaps.map(describeGap), ...excludedKept(prepared.value)];
  if (problems.length > 0) {
    return { error: problems.join("\ncinch: "), ok: false };
  }
  return {
    ok: true,
    value: { ...prepared.value, plan: setupOf(prepared.value.plan) },
  };
};
