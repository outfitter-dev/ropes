import type { AdapterDescriptor } from "../adapters/adapter.ts";
import type { RopesConfig } from "../contracts/config.ts";
import { ENFORCEMENT_PREFIX } from "../contracts/enforcement.ts";

/** A typo cannot silently leave the intended rule at its blocking default. */
export const unknownEnforcement = (
  config: RopesConfig,
  descriptors: readonly AdapterDescriptor[]
): string | undefined => {
  const known = new Set(
    descriptors.flatMap(({ packs }) =>
      (packs ?? []).flatMap(({ rules }) => rules)
    )
  );
  return [config.settings, ...config.overrides.map(({ settings }) => settings)]
    .flat()
    .map(({ key }) => key)
    .filter((key) => key.startsWith(ENFORCEMENT_PREFIX))
    .map((key) => key.slice(ENFORCEMENT_PREFIX.length))
    .find((rule) => !known.has(rule));
};
