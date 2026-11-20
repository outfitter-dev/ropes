import type { Adapter } from "../adapters/adapter.ts";
import type { CinchConfig } from "../contracts/config.ts";

/**
 * Why a table under `tools` would be read by nothing, or null when each one
 * has a reader. A table Cinch quietly ignored would look like a setting that
 * took effect.
 */
export const unreadTable = (
  config: CinchConfig,
  adapters: readonly Adapter[]
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
    const off = config.settings.find(
      (setting) => setting.key === reader.enabledBy && setting.value === false
    );
    if (off !== undefined) {
      return `${file}: tools.${name}: nothing reads this table while \`${off.key} = false\`. Remove one of the two.`;
    }
  }
  return null;
};
