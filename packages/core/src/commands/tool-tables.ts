import type { Adapter } from "../adapters/adapter.ts";
import type { RopesConfig } from "../contracts/config.ts";
import type { Plan, PlannedPath } from "../contracts/plan.ts";

/** Whether policy leaves the adapter behind `key` on for a file it keeps. */
const isOn = (entry: PlannedPath, key: string): boolean =>
  entry.skipped?.reason !== "not-included" &&
  !entry.policy.some(
    (setting) => setting.key === key && setting.value === false
  );

/**
 * Why a table under `tools` would be read by nothing, or null when each one
 * has a reader. A table Ropes quietly ignored would look like a setting that
 * took effect. A reader is on when policy leaves it on for any file it
 * keeps, so an override that switches a preset back on counts. `planOf`
 * resolves the plan for those files.
 */
export const unreadTable = (
  config: RopesConfig,
  adapters: readonly Adapter[],
  planOf: (paths: readonly string[]) => Plan
): string | null => {
  const file = config.file ?? "the Cinch config";
  const readers = adapters.flatMap(({ descriptor }) =>
    descriptor.table === undefined ? [] : [descriptor]
  );
  for (const name of Object.keys(config.tools)) {
    const reader = readers.find((descriptor) => descriptor.table === name);
    if (reader === undefined) {
      const known = readers.map((descriptor) => descriptor.table).join(", ");
      return `${file}: tools.${name}: Cinch generates no config for "${name}". It does for: ${known || "none"}.`;
    }
    const kept = planOf(reader.owns ?? []).paths;
    if (!kept.some((entry) => isOn(entry, reader.enabledBy))) {
      return `${file}: tools.${name}: nothing reads this table while \`${reader.enabledBy} = false\`. Remove one of the two.`;
    }
  }
  return null;
};
