import type { AdapterDescriptor } from "../adapters/adapter.ts";
import type { CinchConfig } from "../contracts/config.ts";
import type { PackState, Plan } from "../contracts/plan.ts";
import { compileGlobs } from "./glob.ts";

/** Whether policy asks for the adapter on any file at all. */
const isWanted = (
  { enabledBy, optIn }: AdapterDescriptor,
  config: CinchConfig
): boolean => {
  const says = (to: boolean, settings = config.settings): boolean =>
    settings.some(({ key, value }) => key === enabledBy && value === to);
  const somewhere = config.overrides.some(({ settings }) =>
    says(true, settings)
  );
  return says(true) || somewhere || (optIn !== true && !says(false));
};

/**
 * Each pack of the adapters given, as it would stand if policy asked for
 * all of them. `cinch rules` shows these where rules are not switched on.
 */
export const shippedStates = (
  config: CinchConfig,
  descriptors: readonly AdapterDescriptor[],
  present: readonly string[]
): PackState[] => {
  const named = new Set(config.rulesOff?.value);
  const off = (name: string) =>
    config.rulesOff !== undefined && named.has(name)
      ? { off: config.rulesOff.source }
      : {};
  const kept = new Set(descriptors.flatMap(({ owns }) => owns ?? []));
  const own = present.filter((file) => !kept.has(file));
  return descriptors.flatMap((descriptor) =>
    (descriptor.packs ?? []).map((pack): PackState => {
      const found = own.find(compileGlobs(pack.relevant));
      return {
        about: pack.about,
        adapter: descriptor.id,
        ...(found === undefined ? {} : { found }),
        name: pack.name,
        ...off(pack.name),
        relevant: pack.relevant,
        rules: pack.rules.map((id) => ({ id, ...off(id) })),
      };
    })
  );
};

/**
 * Each pack of each adapter policy asks for, and whether it runs: it does
 * where a file of the repository matches what makes it relevant, unless the
 * config names it as off. `present` is every root-relative file there is.
 * A file an adapter keeps is part of the Cinch setup and makes no pack
 * relevant.
 */
export const packStates = (
  config: CinchConfig,
  descriptors: readonly AdapterDescriptor[],
  present: readonly string[]
): PackState[] => {
  const wanted = new Set(
    descriptors
      .filter((descriptor) => isWanted(descriptor, config))
      .map(({ id }) => id)
  );
  return shippedStates(config, descriptors, present).filter((pack) =>
    wanted.has(pack.adapter)
  );
};

/** The ids of an adapter's rules that run. */
export const rulesOn = (
  states: readonly PackState[],
  adapter: string
): string[] =>
  states
    .filter(
      (pack) =>
        pack.adapter === adapter &&
        pack.found !== undefined &&
        pack.off === undefined
    )
    .flatMap((pack) =>
      pack.rules.flatMap((rule) => (rule.off === undefined ? [rule.id] : []))
    );

/** The names the config turns off that no shipped pack or rule has. */
export const unknownOff = (
  config: CinchConfig,
  descriptors: readonly AdapterDescriptor[]
): string[] => {
  const known = new Set(
    descriptors
      .flatMap((descriptor) => descriptor.packs ?? [])
      .flatMap((pack) => [pack.name, ...pack.rules])
  );
  return (config.rulesOff?.value ?? []).filter((name) => !known.has(name));
};

/** The folders of its own rules the config names, when an adapter runs them. */
export const localRules = (
  config: CinchConfig,
  descriptors: readonly AdapterDescriptor[]
): Plan["localRules"] => {
  const folders = descriptors
    .filter((descriptor) => isWanted(descriptor, config))
    .flatMap((descriptor) => descriptor.localRules ?? []);
  return config.rulesLocal === undefined || folders.length === 0
    ? undefined
    : { folders: [...new Set(folders)], source: config.rulesLocal.source };
};
