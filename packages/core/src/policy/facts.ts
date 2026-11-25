import type { AdapterDescriptor } from "../adapters/adapter.ts";
import type { RopesConfig } from "../contracts/config.ts";
import type { Fact, SharedFacts } from "../contracts/facts.ts";
import type { PlannedPath, PlanBatch } from "../contracts/plan.ts";
import { domainsOf } from "./delegates.ts";

/** The facts the `[editor]` table states for every file. */
const statedIn = (config: RopesConfig): Fact[] => {
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
  config: RopesConfig,
  descriptors: readonly AdapterDescriptor[],
  batches: readonly PlanBatch[],
  paths: readonly PlannedPath[] = []
): SharedFacts | undefined => {
  const running = new Set(batches.map((batch) => batch.adapter));
  const reporters = descriptors.flatMap((descriptor) => {
    const delegated = paths
      .filter(
        (entry) =>
          entry.skipped === undefined &&
          entry.delegated?.some(
            ({ tool, domains }) =>
              (tool === descriptor.tool ||
                tool === descriptor.id ||
                tool === descriptor.table) &&
              domainsOf(descriptor).some((domain) => domains.includes(domain))
          ) === true &&
          (descriptor.extensions.includes("*") ||
            descriptor.extensions.some((extension) =>
              entry.path.endsWith(extension)
            ) ||
            descriptor.owns?.includes(entry.path) === true)
      )
      .map((entry) => entry.path);
    return descriptor.reports !== undefined &&
      (running.has(descriptor.id) || delegated.length > 0)
      ? [
          {
            adapter: descriptor.id,
            ...(delegated.length === 0
              ? {}
              : {
                  paths: delegated,
                  versionRange: descriptor.versionRange,
                  ...(descriptor.tested === undefined
                    ? {}
                    : { tolerates: descriptor.tested }),
                }),
            reports: descriptor.reports,
            tool: descriptor.tool,
          },
        ]
      : [];
  });
  return reporters.length === 0
    ? undefined
    : { reporters, stated: statedIn(config) };
};
