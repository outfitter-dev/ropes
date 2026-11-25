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
  const file = config.file ?? "the Ropes config";
  const readers = adapters.flatMap(({ descriptor }) =>
    descriptor.table === undefined ? [] : [descriptor]
  );
  for (const name of Object.keys(config.tools)) {
    const reader = readers.find((descriptor) => descriptor.table === name);
    if (reader === undefined) {
      const known = readers.map((descriptor) => descriptor.table).join(", ");
      return `${file}: tools.${name}: Ropes generates no config for "${name}". It does for: ${known || "none"}.`;
    }
    const kept = planOf(reader.owns ?? []).paths;
    if (!kept.some((entry) => isOn(entry, reader.enabledBy))) {
      return `${file}: tools.${name}: nothing reads this table while \`${reader.enabledBy} = false\`. Remove one of the two.`;
    }
  }
  return null;
};

/**
 * A protected root is never repaired, but an authored tool table still needs
 * a working connection. Validate that connection through the adapter's config-only read.
 */
export const protectedTableProblem = async (
  root: string,
  config: RopesConfig,
  adapters: readonly Adapter[],
  planOf: (paths: readonly string[]) => Plan
): Promise<string | null> => {
  const unread = unreadTable(config, adapters, planOf);
  if (unread !== null) {
    return unread;
  }
  for (const [name, table] of Object.entries(config.tools)) {
    if (Object.keys(table).length === 0) {
      continue;
    }
    const reader = adapters.find(({ descriptor }) => descriptor.table === name);
    if (reader === undefined) {
      continue;
    }
    const roots = planOf(reader.descriptor.owns ?? [])
      .paths.filter(
        (entry) =>
          entry.protected !== undefined &&
          reader.descriptor.layers?.[entry.path] === "root"
      )
      .map((entry) => entry.path);
    if (roots.length === 0) {
      continue;
    }
    let connected = false;
    try {
      // This boundary operation reads config text without starting engines.
      // eslint-disable-next-line no-await-in-loop
      const answers = await Promise.all(
        roots.map(
          (file) =>
            reader.readsGeneratedConfig?.(root, file) ?? Promise.resolve(false)
        )
      );
      connected = answers.every(Boolean);
    } catch {
      connected = false;
    }
    if (!connected) {
      return `${config.file ?? "the Ropes config"}: tools.${name}: the protected root config cannot be verified as reading the generated settings. Put these settings in the authored native config, or connect it to the generated config manually. Ropes preserves ${roots.join(", ")}.`;
    }
  }
  return null;
};
