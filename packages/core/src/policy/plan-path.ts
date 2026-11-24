import type { AdapterDescriptor } from "../adapters/adapter.ts";
import type { RopesConfig } from "../contracts/config.ts";
import type { PlannedPath, PlanStep, PolicyValue } from "../contracts/plan.ts";
import type { PackageTarget } from "../contracts/targets.ts";
import { inRunOrder, packageOf, toStep } from "./batches.ts";
import type { Matcher } from "./glob.ts";
import { targetSteps } from "./targets.ts";

export interface PathPlanInput {
  readonly config: RopesConfig;
  /** In execution order. */
  readonly descriptors: readonly AdapterDescriptor[];
  /**
   * Root-relative directories that are packages. A file belongs to the
   * nearest one above it, or to the workspace when there is none.
   */
  readonly packages: readonly string[];
  /** Actual files, when the command boundary collected them. */
  readonly presentFiles?: ReadonlySet<string>;
  readonly ruleWriters?: ReadonlyMap<string, Matcher>;
  /** Declared support evidence collected at the command boundary. */
  readonly targets?: readonly PackageTarget[];
}

export interface Scope {
  readonly included: Matcher;
  readonly excluded: Matcher;
  /** One matcher per override, in file order. */
  readonly overrides: readonly Matcher[];
}

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
};

/**
 * The base settings, then every override whose globs match the path, in file
 * order. A later override replaces an earlier value for the same key, and the
 * value keeps the provenance of the override that set it.
 */
const policyFor = (
  path: string,
  config: RopesConfig,
  scope: Scope
): PolicyValue[] => {
  const byKey = new Map<string, PolicyValue>();
  const layers = [
    config.settings,
    ...config.overrides
      .filter((_, index) => scope.overrides[index]?.(path) === true)
      .map((override) => override.settings),
  ];
  for (const setting of layers.flat()) {
    byKey.set(setting.key, setting);
  }
  return [...byKey.values()].toSorted((left, right) =>
    left.key < right.key ? -1 : 1
  );
};

const stepsFor = (
  path: string,
  policy: readonly PolicyValue[],
  descriptors: readonly AdapterDescriptor[]
): PlanStep[] => {
  const extension = extensionOf(path);
  const keysSet = (to: boolean): Set<string> =>
    new Set(
      policy
        .filter((setting) => setting.value === to)
        .map((setting) => setting.key)
    );
  const off = keysSet(false);
  const on = keysSet(true);
  const selected = inRunOrder(descriptors).filter(
    (descriptor) =>
      // A step is one file. A package or workspace adapter gets none until
      // the plan can describe a step of that size.
      descriptor.unit === "file" &&
      (descriptor.extensions.includes("*") ||
        descriptor.extensions.includes(extension) ||
        descriptor.owns?.includes(path) === true) &&
      (descriptor.optIn === true
        ? on.has(descriptor.enabledBy)
        : !off.has(descriptor.enabledBy))
  );
  const formatted = selected.some(
    (descriptor) => descriptor.formats === true || descriptor.setup === true
  );
  return selected
    .filter((descriptor) => !formatted || descriptor.fallbackFormat !== true)
    .map(toStep);
};

/**
 * The steps of one path. A file Ropes writes whole, such as a preset, is
 * part of the setup, and only `doctor --fix` writes the setup. So a step of
 * another adapter may read such a file and never write it. A root config is
 * a person's file, and stays theirs to fix.
 */
const guarded = (
  path: string,
  steps: readonly PlanStep[],
  descriptors: readonly AdapterDescriptor[]
): PlanStep[] => {
  const whole = descriptors.some(
    (descriptor) =>
      descriptor.setup === true &&
      descriptor.owns?.includes(path) === true &&
      descriptor.layers?.[path] !== "root" &&
      steps.some((step) => step.adapter === descriptor.id)
  );
  return steps.map((step) =>
    whole && step.setup !== true && step.writes
      ? { ...step, writes: false }
      : step
  );
};

/** Whether an adapter that policy leaves on keeps this exact file. */
const isKept = (
  path: string,
  policy: readonly PolicyValue[],
  descriptors: readonly AdapterDescriptor[]
): boolean =>
  stepsFor(
    path,
    policy,
    descriptors.filter((descriptor) => descriptor.owns?.includes(path) === true)
  ).length > 0;

export const planPath = (
  path: string,
  input: PathPlanInput,
  scope: Scope
): PlannedPath => {
  const inPackage = packageOf(path, input.packages);
  const policy = policyFor(path, input.config, scope);
  if (scope.excluded(path)) {
    // The policy is still stated, so a reader can tell a kept file that is
    // excluded while its adapter is on from one whose adapter is off.
    return {
      package: inPackage,
      path,
      policy,
      skipped: { reason: "excluded", source: input.config.exclude.source },
      steps: [],
    };
  }
  // A kept file needs no `include` entry. When policy switches its adapter
  // off, the path is treated like any other.
  if (!isKept(path, policy, input.descriptors) && !scope.included(path)) {
    return {
      package: inPackage,
      path,
      policy: [],
      skipped: { reason: "not-included", source: input.config.include.source },
      steps: [],
    };
  }
  const candidates = guarded(
    path,
    stepsFor(
      path,
      policy,
      input.descriptors.filter(
        (descriptor) =>
          descriptor.target === undefined ||
          input.presentFiles === undefined ||
          input.presentFiles.has(path)
      )
    ).map((step) =>
      input.ruleWriters?.get(step.adapter)?.(path) === true
        ? { ...step, writes: true }
        : step
    ),
    input.descriptors
  );
  const { steps, targets } = targetSteps(
    candidates,
    input.descriptors,
    inPackage,
    input.targets ?? []
  );
  const layer = input.descriptors.find(
    (descriptor) =>
      descriptor.layers?.[path] !== undefined &&
      steps.some((step) => step.adapter === descriptor.id)
  )?.layers?.[path];
  return {
    ...(layer === undefined ? {} : { layer }),
    package: inPackage,
    path,
    policy,
    steps,
    ...(targets.length === 0 ? {} : { targets }),
  };
};
