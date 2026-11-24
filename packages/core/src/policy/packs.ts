import type { AdapterDescriptor } from "../adapters/adapter.ts";
import type { RopesConfig } from "../contracts/config.ts";
import type { PackState, Plan, Provenance } from "../contracts/plan.ts";
import { compileGlobs } from "./glob.ts";

/** Whether policy asks for the adapter on any file at all. */
export const isWanted = (
  { enabledBy, optIn }: AdapterDescriptor,
  config: RopesConfig
): boolean => {
  const says = (to: boolean, settings = config.settings): boolean =>
    settings.some(({ key, value }) => key === enabledBy && value === to);
  const somewhere = config.overrides.some(({ settings }) =>
    says(true, settings)
  );
  return says(true) || somewhere || (optIn !== true && !says(false));
};

/**
 * The files Ropes writes whole. A root config is kept too, and is still the
 * repository's own file, so it is not among them.
 */
export const keptWhole = (
  descriptors: readonly AdapterDescriptor[]
): Set<string> =>
  new Set(
    descriptors.flatMap(({ layers, owns }) =>
      (owns ?? []).filter((file) => layers?.[file] !== "root")
    )
  );

/**
 * Each pack of the adapters given, as it would stand if policy asked for
 * all of them. `rope rules` shows these where rules are not switched on.
 */
export const shippedStates = (
  config: RopesConfig,
  descriptors: readonly AdapterDescriptor[],
  present: readonly string[]
): PackState[] => {
  const stopped = new Set(config.rulesOff?.value);
  const off = (name: string) =>
    config.rulesOff !== undefined && stopped.has(name)
      ? { off: config.rulesOff.source }
      : {};
  const asked = new Set(config.rulesPacks?.value);
  const named = (name: string) =>
    config.rulesPacks !== undefined && asked.has(name)
      ? { named: config.rulesPacks.source }
      : {};
  const kept = keptWhole(descriptors);
  const own = present.filter((file) => !kept.has(file));
  return descriptors.flatMap((descriptor) =>
    (descriptor.packs ?? []).map((pack): PackState => {
      const found = own.find(compileGlobs(pack.relevant));
      return {
        about: pack.about,
        adapter: descriptor.id,
        ...(pack.explicitOnly === undefined
          ? {}
          : { explicitOnly: pack.explicitOnly }),
        ...(found === undefined ? {} : { found }),
        name: pack.name,
        ...named(pack.name),
        ...off(pack.name),
        relevant: pack.relevant,
        rules: pack.rules.map((id) => ({
          ...(descriptor.ruleDigests?.[id] === undefined
            ? {}
            : { digest: descriptor.ruleDigests[id] }),
          id,
          ...(descriptor.ruleIdentities?.[id] === undefined
            ? {}
            : { identity: descriptor.ruleIdentities[id] }),
          ...off(id),
        })),
      };
    })
  );
};

/**
 * Each pack of each adapter policy asks for, and whether it runs: it does
 * where the config names it and a file of the repository matches what makes
 * it relevant, unless the config also names it as off. `present` is every root-relative file there is.
 * A file an adapter keeps is part of the Ropes setup and makes no pack
 * relevant.
 */
export const packStates = (
  config: RopesConfig,
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
        pack.named !== undefined &&
        pack.found !== undefined &&
        pack.off === undefined
    )
    .flatMap((pack) =>
      pack.rules.flatMap((rule) => (rule.off === undefined ? [rule.id] : []))
    );

/** The names the config turns off that no shipped pack or rule has. */
export const unknownOff = (
  config: RopesConfig,
  descriptors: readonly AdapterDescriptor[]
): string[] => {
  const known = new Set(
    descriptors
      .flatMap((descriptor) => descriptor.packs ?? [])
      .flatMap((pack) => [pack.name, ...pack.rules])
  );
  return (config.rulesOff?.value ?? []).filter((name) => !known.has(name));
};

/** The names the config asks for that no shipped pack has. */
export const unknownPacks = (
  config: RopesConfig,
  descriptors: readonly AdapterDescriptor[]
): string[] => {
  const known = new Set(
    descriptors
      .flatMap((descriptor) => descriptor.packs ?? [])
      .map(({ name }) => name)
  );
  return (config.rulesPacks?.value ?? []).filter((name) => !known.has(name));
};

/**
 * The folders of its own rules the repository names, in its Ropes config
 * or in an engine's project config, as they would stand if policy asked for
 * every adapter given. A folder both name is the Ropes config's.
 */
export const namedLocalRules = (
  config: RopesConfig,
  descriptors: readonly AdapterDescriptor[]
): Plan["localRules"] => {
  const stated = config.rulesLocal?.source;
  const named = descriptors.flatMap(
    ({ foundRules: found, localRules: own }) => {
      const theirs: Provenance | undefined =
        found === undefined
          ? undefined
          : { file: found.file, key: found.key, kind: "file" };
      return [
        ...(stated === undefined
          ? []
          : (own ?? []).map((folder) => ({ folder, source: stated }))),
        ...(theirs === undefined
          ? []
          : (found?.folders ?? []).map((folder) => ({
              folder,
              source: theirs,
            }))),
      ];
    }
  );
  const folders = named.filter(
    ({ folder }, index) =>
      named.findIndex((other) => other.folder === folder) === index
  );
  return folders.length === 0 ? undefined : folders;
};

/** The folders of its own rules the repository names, when an adapter runs them. */
export const localRules = (
  config: RopesConfig,
  descriptors: readonly AdapterDescriptor[]
): Plan["localRules"] =>
  namedLocalRules(
    config,
    descriptors.filter((descriptor) => isWanted(descriptor, config))
  );
