import type { Adapter } from "../adapters/adapter.ts";
import { discoverRoot } from "../config/root.ts";
import type { RepoRoot } from "../contracts/root.ts";
import { describeRootError } from "./errors.ts";
import type { CommandDeps } from "./prepare.ts";

/**
 * A set of files one adapter keeps. A preset leaves `kind` unset. A setup
 * file that is not a preset sets it, so a message does not call it one.
 */
export interface Preset {
  readonly name: string;
  readonly adapter: string;
  readonly enabledBy: string;
  readonly files: readonly string[];
  readonly kind?: "file";
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
          },
        ]
  );

/** An id ending in `-file` is spoken without that suffix, then as a file. */
const fileName = (id: string): string => {
  const suffix = "-file";
  return id.endsWith(suffix) ? id.slice(0, -suffix.length) : id;
};

const keptOne = (descriptor: Adapter["descriptor"]): Preset => {
  const base = {
    adapter: descriptor.id,
    enabledBy: descriptor.enabledBy,
    files: descriptor.owns ?? [],
  };
  return descriptor.preset === undefined
    ? { ...base, kind: "file", name: fileName(descriptor.id) }
    : { ...base, name: descriptor.preset };
};

/**
 * The setup files a gap check judges, in adapter order. Presets are not the
 * only files Cinch keeps: one that has no preset name is still left out when
 * `exclude` covers it while its adapter is on.
 */
export const keptOf = (adapters: readonly Adapter[]): readonly Preset[] =>
  adapters.flatMap(({ descriptor }) =>
    descriptor.setup === true ? [keptOne(descriptor)] : []
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
