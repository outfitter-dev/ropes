import type { AdapterDescriptor } from "../adapters/adapter.ts";
import type { CinchConfig } from "../contracts/config.ts";
import type { Fact, SharedFacts } from "../contracts/facts.ts";
import type { PlanBatch } from "../contracts/plan.ts";

/** The facts the `[editor]` table states for every file. */
const statedIn = (config: CinchConfig): Fact[] => {
  const { editor, file, prefix = "" } = config;
  if (editor === undefined || file === null) {
    return [];
  }
  return Object.entries(editor).flatMap(([name, value]) =>
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
      ? [{ file, key: `${prefix}editor.${name}`, name, value }]
      : []
  );
};

/**
 * What a run of these batches compares: the facts the config states, and
 * each adapter with a step in the plan whose tool has settings for such
 * facts. Undefined when no such adapter runs, and then nothing is compared.
 */
export const sharedFacts = (
  config: CinchConfig,
  descriptors: readonly AdapterDescriptor[],
  batches: readonly PlanBatch[]
): SharedFacts | undefined => {
  const running = new Set(batches.map((batch) => batch.adapter));
  const reporters = descriptors.flatMap((descriptor) =>
    descriptor.reports !== undefined && running.has(descriptor.id)
      ? [
          {
            adapter: descriptor.id,
            reports: descriptor.reports,
            tool: descriptor.tool,
          },
        ]
      : []
  );
  return reporters.length === 0
    ? undefined
    : { reporters, stated: statedIn(config) };
};
