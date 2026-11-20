import { discoverRoot } from "../config/root.ts";
import { setupOf } from "../policy/setup.ts";
import { describeRootError } from "./errors.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps, PrepareResult } from "./prepare.ts";
import { describeGap, gapsOf } from "./preset-gaps.ts";
import { presetsOf } from "./presets.ts";

/**
 * The files of the Cinch setup. An adapter that keeps files needs no pinned
 * tool, so the list does not depend on the repository's pins.
 */
export const setupFiles = (deps: CommandDeps): string[] =>
  deps
    .adapters({})
    .flatMap(({ descriptor }) =>
      descriptor.setup === true ? (descriptor.owns ?? []) : []
    );

/**
 * The plan of the Cinch setup at the root above `cwd`: every file Cinch
 * keeps there, with only the steps that keep it. It is the same plan
 * `explain` shows for those files, less the steps of other adapters.
 *
 * A kept file the config leaves out cannot be kept, and passing over it
 * would read as a setup in good shape, so that is an error for every
 * caller. A preset that is switched off is not part of the setup.
 */
export const prepareSetup = async (
  cwd: string,
  deps: CommandDeps
): Promise<PrepareResult> => {
  const found = await discoverRoot(cwd);
  if (!found.ok) {
    return { error: describeRootError(found.error), ok: false };
  }
  // With no file to keep, no paths means the whole workspace, and
  // `setupOf` then leaves an empty plan.
  const paths = setupFiles(deps);
  const prepared = await prepare({ cwd: found.value.root, paths }, deps);
  if (!prepared.ok) {
    return prepared;
  }
  const gaps = gapsOf(presetsOf(deps.adapters({})), prepared.value.plan).filter(
    (gap) => gap.why === "left-out"
  );
  if (gaps.length > 0) {
    return { error: gaps.map(describeGap).join("\ncinch: "), ok: false };
  }
  return {
    ok: true,
    value: { ...prepared.value, plan: setupOf(prepared.value.plan) },
  };
};
