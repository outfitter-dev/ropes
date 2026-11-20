import type { Adapter } from "../adapters/adapter.ts";
import { discoverRoot } from "../config/root.ts";
import type { RepoRoot } from "../contracts/root.ts";
import { describeRootError } from "./errors.ts";
import type { CommandDeps } from "./prepare.ts";

/** A shared config Cinch ships, and the adapter that keeps its files. */
export interface Preset {
  readonly name: string;
  readonly adapter: string;
  readonly enabledBy: string;
  readonly files: readonly string[];
  /** True when the preset is off until the config switches it on. */
  readonly optIn: boolean;
}

/**
 * The presets in the registry. An adapter that keeps files needs no pinned
 * tool, so the list does not depend on the repository's pins.
 */
export const presetsOf = (adapters: readonly Adapter[]): readonly Preset[] =>
  adapters.flatMap(({ descriptor }) =>
    descriptor.preset === undefined
      ? []
      : [
          {
            adapter: descriptor.id,
            enabledBy: descriptor.enabledBy,
            files: descriptor.owns ?? [],
            name: descriptor.preset,
            optIn: descriptor.optIn === true,
          },
        ]
  );

export type Located =
  | {
      readonly ok: true;
      readonly root: RepoRoot;
      readonly presets: readonly Preset[];
    }
  | { readonly ok: false; readonly error: string };

/** The root above `cwd`, and the presets this Cinch ships. */
export const locate = async (
  cwd: string,
  deps: CommandDeps
): Promise<Located> => {
  const found = await discoverRoot(cwd);
  return found.ok
    ? { ok: true, presets: presetsOf(deps.adapters({})), root: found.value }
    : { error: describeRootError(found.error), ok: false };
};

/** The presets with these names, or the first name that is not one. */
export const pick = (
  presets: readonly Preset[],
  names: readonly string[]
):
  | { readonly ok: true; readonly presets: readonly Preset[] }
  | { readonly ok: false; readonly unknown: string } => {
  const unknown = names.find(
    (name) => !presets.some((preset) => preset.name === name)
  );
  if (unknown !== undefined) {
    return { ok: false, unknown };
  }
  return {
    ok: true,
    presets:
      names.length === 0
        ? presets
        : presets.filter((preset) => names.includes(preset.name)),
  };
};
