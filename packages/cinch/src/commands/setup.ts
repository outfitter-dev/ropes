import { discoverRoot } from "../config/root.ts";
import { setupOf } from "../policy/setup.ts";
import { describeRootError } from "./errors.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps, PrepareResult } from "./prepare.ts";

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
  return prepared.ok
    ? {
        ok: true,
        value: { ...prepared.value, plan: setupOf(prepared.value.plan) },
      }
    : prepared;
};
