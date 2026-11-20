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
import { sharedFacts } from "./facts.ts";
import { compileGlobs } from "./glob.ts";
import type { Matcher } from "./glob.ts";
import { packStates, rulesOn } from "./packs.ts";

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
  /**
   * Every root-relative file in the repository. A rule pack applies where
   * one matches. Left out, there are none and no pack applies.
   */
  readonly present?: readonly string[];
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
  const keysSet = (to: boolean): Set<string> =>
    new Set(
      policy
        .filter((setting) => setting.value === to)
        .map((setting) => setting.key)
    );
  const off = keysSet(false);
  const on = keysSet(true);
  return inRunOrder(descriptors)
    .filter(
      (descriptor) =>
        // A step is one file. A package or workspace adapter gets none until
        // the plan can describe a step of that size.
        descriptor.unit === "file" &&
        (descriptor.extensions.includes(extension) ||
          descriptor.owns?.includes(path) === true) &&
        (descriptor.optIn === true
          ? on.has(descriptor.enabledBy)
          : !off.has(descriptor.enabledBy))
    )
    .map(toStep);
};

/**
 * The steps of one path. A file Cinch writes whole, such as a preset, is
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

const plan = (path: string, input: ResolveInput, scope: Scope): PlannedPath => {
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
  const steps = guarded(
    path,
    stepsFor(path, policy, input.descriptors),
    input.descriptors
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
  };
};

/**
 * Turns a selection into a plan. Pure: it reads no files, spawns nothing and
 * gives the same plan for the same input. Every path it is given appears in
 * the plan, including the ones the config leaves out, so `explain` can say
 * why nothing runs on them.
 */
export const resolvePlan = (given: ResolveInput): Plan => {
  const rules = packStates(
    given.config,
    given.descriptors,
    given.present ?? []
  );
  // An adapter that ships rule packs has nothing to run when none is on.
  const input = {
    ...given,
    descriptors: given.descriptors.filter(
      ({ id, packs }) => packs === undefined || rulesOn(rules, id).length > 0
    ),
  };
  const withPacks = new Set(
    input.descriptors.flatMap(({ id, packs }) => (packs ? [id] : []))
  );
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
  const batches = batchesFor(planned, input.descriptors).map((batch) =>
    withPacks.has(batch.adapter)
      ? { ...batch, rules: rulesOn(rules, batch.adapter) }
      : batch
  );
  const facts = sharedFacts(input.config, input.descriptors, batches);
  return {
    batches,
    ...(facts === undefined ? {} : { facts }),
    paths: planned,
    root: input.root,
    ...(rules.length === 0 ? {} : { rules }),
    schemaVersion: SCHEMA_VERSION,
    selection: input.selection,
  };
};
