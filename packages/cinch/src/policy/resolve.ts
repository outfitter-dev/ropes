import type { AdapterDescriptor } from "../adapters/adapter.ts";
import type { CinchConfig } from "../contracts/config.ts";
import { SCHEMA_VERSION } from "../contracts/plan.ts";
import type {
  Plan,
  PlannedPath,
  PlanStep,
  PolicyValue,
  Selection,
} from "../contracts/plan.ts";
import { batchesFor, inRunOrder, packageOf, toStep } from "./batches.ts";
import { compileGlobs } from "./glob.ts";
import type { Matcher } from "./glob.ts";

export interface ResolveInput {
  readonly root: string;
  readonly config: CinchConfig;
  /** What the caller asked for. */
  readonly selection: Selection;
  /** The root-relative paths the selection expanded to. */
  readonly paths: readonly string[];
  /** In execution order. */
  readonly descriptors: readonly AdapterDescriptor[];
  /**
   * Root-relative directories that are packages. A file belongs to the
   * nearest one above it, or to the workspace when there is none.
   */
  readonly packages: readonly string[];
}

interface Scope {
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
  config: CinchConfig,
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
  const off = new Set(
    policy
      .filter((setting) => setting.value === false)
      .map((setting) => setting.key)
  );
  return inRunOrder(descriptors)
    .filter(
      (descriptor) =>
        // A step is one file. A package or workspace adapter gets none until
        // the plan can describe a step of that size.
        descriptor.unit === "file" &&
        (descriptor.extensions.includes(extension) ||
          descriptor.owns?.includes(path) === true) &&
        !off.has(descriptor.enabledBy)
    )
    .map(toStep);
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

const plan = (path: string, input: ResolveInput, scope: Scope): PlannedPath => {
  const inPackage = packageOf(path, input.packages);
  if (scope.excluded(path)) {
    return {
      package: inPackage,
      path,
      policy: [],
      skipped: { reason: "excluded", source: input.config.exclude.source },
      steps: [],
    };
  }
  const policy = policyFor(path, input.config, scope);
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
  return {
    package: inPackage,
    path,
    policy,
    steps: stepsFor(path, policy, input.descriptors),
  };
};

/**
 * Turns a selection into a plan. Pure: it reads no files, spawns nothing and
 * gives the same plan for the same input. Every path it is given appears in
 * the plan, including the ones the config leaves out, so `explain` can say
 * why nothing runs on them.
 */
export const resolvePlan = (input: ResolveInput): Plan => {
  const scope: Scope = {
    excluded: compileGlobs(input.config.exclude.value),
    included: compileGlobs(input.config.include.value),
    overrides: input.config.overrides.map((override) =>
      compileGlobs(override.paths)
    ),
  };
  const kept = new Set(
    input.descriptors.flatMap((descriptor) => descriptor.owns ?? [])
  );
  const paths = [...new Set(input.paths)].toSorted();
  const planned = [
    ...paths.filter((path) => kept.has(path)),
    ...paths.filter((path) => !kept.has(path)),
  ].map((path) => plan(path, input, scope));
  return {
    batches: batchesFor(planned, input.descriptors),
    paths: planned,
    root: input.root,
    schemaVersion: SCHEMA_VERSION,
    selection: input.selection,
  };
};
