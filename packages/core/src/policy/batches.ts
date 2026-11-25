import type { AdapterDescriptor } from "../adapters/adapter.ts";
import type { PlanBatch, PlannedPath, PlanStep } from "../contracts/plan.ts";

/** The package of a file that no package directory holds. */
export const WORKSPACE = ".";

export const packageOf = (path: string, packages: readonly string[]): string =>
  packages
    .filter((directory) => path.startsWith(`${directory}/`))
    .toSorted((left, right) => right.length - left.length)[0] ?? WORKSPACE;

export const toStep = (descriptor: AdapterDescriptor): PlanStep => ({
  adapter: descriptor.id,
  ...(descriptor.recovery === undefined
    ? {}
    : { recovery: descriptor.recovery }),
  ...(descriptor.setup === true ? { setup: true } : {}),
  ...(descriptor.tested === undefined ? {} : { tolerates: descriptor.tested }),
  tool: descriptor.tool,
  versionRange: descriptor.versionRange,
  writes: descriptor.writes,
});

const keeps = (descriptor: AdapterDescriptor): boolean =>
  (descriptor.owns ?? []).length > 0;

/**
 * The order steps run in. Adapters that keep files go first, since a kept
 * file is often the config another step reads, and a fix has to write it
 * before that step runs. After that the order is the adapters' own, so on
 * any one file a later step still reads what an earlier one wrote.
 */
export const inRunOrder = (
  descriptors: readonly AdapterDescriptor[]
): AdapterDescriptor[] => [
  ...descriptors.filter(keeps),
  ...descriptors.filter((descriptor) => !keeps(descriptor)),
];

/**
 * A package or workspace engine starts once for its scope. File engines
 * can start separately for writable and read-only paths in each package.
 */
export const batchesFor = (
  planned: readonly PlannedPath[],
  descriptors: readonly AdapterDescriptor[]
): PlanBatch[] => {
  const packages = [...new Set(planned.map((entry) => entry.package))];
  return inRunOrder(descriptors).flatMap(({ id, unit }) =>
    (unit === "workspace" ? [WORKSPACE] : packages.toSorted()).flatMap(
      (inPackage) => {
        const steps = planned
          .filter(
            (entry) => unit === "workspace" || entry.package === inPackage
          )
          .flatMap((entry) =>
            entry.steps
              .filter((step) => step.adapter === id)
              .map((step) => ({ path: entry.path, step }))
          );
        if (unit !== "file") {
          const [first] = steps;
          return first === undefined
            ? []
            : [
                {
                  ...first.step,
                  package: inPackage,
                  paths: steps.map(({ path }) => path),
                  unit,
                  // The engine cannot fix one half of its project while checking the other.
                  writes: steps.every(({ step }) => step.writes),
                },
              ];
        }
        return [true, false].flatMap((writes) => {
          const [first, ...rest] = steps.filter(
            ({ step }) => step.writes === writes
          );
          return first === undefined
            ? []
            : [
                {
                  ...first.step,
                  package: inPackage,
                  paths: [first, ...rest].map(({ path }) => path),
                },
              ];
        });
      }
    )
  );
};

/** A project batch is read-only for every covered path if any must be protected. */
export const guardedProjectPaths = (
  paths: readonly PlannedPath[],
  batches: readonly PlanBatch[]
): PlannedPath[] => {
  const readOnly = new Map<string, Set<string>>();
  for (const batch of batches) {
    if (batch.unit !== undefined && !batch.writes) {
      for (const path of batch.paths) {
        const adapters = readOnly.get(path) ?? new Set<string>();
        adapters.add(batch.adapter);
        readOnly.set(path, adapters);
      }
    }
  }
  return paths.map((entry) => {
    const adapters = readOnly.get(entry.path);
    return adapters === undefined
      ? entry
      : {
          ...entry,
          steps: entry.steps.map((step) =>
            step.writes && adapters.has(step.adapter)
              ? { ...step, writes: false }
              : step
          ),
        };
  });
};
