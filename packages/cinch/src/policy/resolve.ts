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

const toStep = (descriptor: AdapterDescriptor): PlanStep => ({
  adapter: descriptor.id,
  tool: descriptor.tool,
  versionRange: descriptor.versionRange,
  writes: descriptor.writes,
});

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
  return descriptors
    .filter(
      (descriptor) =>
        descriptor.extensions.includes(extension) &&
        !off.has(descriptor.enabledBy)
    )
    .map(toStep);
};

const plan = (path: string, input: ResolveInput, scope: Scope): PlannedPath => {
  if (scope.excluded(path)) {
    return {
      path,
      policy: [],
      skipped: { reason: "excluded", source: input.config.exclude.source },
      steps: [],
    };
  }
  if (!scope.included(path)) {
    return {
      path,
      policy: [],
      skipped: { reason: "not-included", source: input.config.include.source },
      steps: [],
    };
  }
  const policy = policyFor(path, input.config, scope);
  return { path, policy, steps: stepsFor(path, policy, input.descriptors) };
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
  return {
    paths: [...new Set(input.paths)]
      .toSorted()
      .map((path) => plan(path, input, scope)),
    root: input.root,
    schemaVersion: SCHEMA_VERSION,
    selection: input.selection,
  };
};
