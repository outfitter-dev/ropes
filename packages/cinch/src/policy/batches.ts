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
  ...(descriptor.setup === true ? { setup: true } : {}),
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
 * Groups the steps into batches, in the order they run: one for each
 * adapter and package, and two where some of its files may be written and
 * others only read.
 */
export const batchesFor = (
  planned: readonly PlannedPath[],
  descriptors: readonly AdapterDescriptor[]
): PlanBatch[] => {
  const packages = [...new Set(planned.map((entry) => entry.package))];
  return inRunOrder(descriptors).flatMap(({ id }) =>
    packages.toSorted().flatMap((inPackage) => {
      const steps = planned
        .filter((entry) => entry.package === inPackage)
        .flatMap((entry) =>
          entry.steps
            .filter((step) => step.adapter === id)
            .map((step) => ({ path: entry.path, step }))
        );
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
    })
  );
};
