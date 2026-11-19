import type { AdapterDescriptor } from "../adapters/adapter.ts";
import { SCHEMA_VERSION } from "../contracts/plan.ts";
import type { Plan, PlanStep, Selection } from "../contracts/plan.ts";

export interface ResolveInput {
  readonly root: string;
  /** What the caller asked for. */
  readonly selection: Selection;
  /** The root-relative paths the selection expanded to. */
  readonly paths: readonly string[];
  readonly descriptors: readonly AdapterDescriptor[];
}

const extensionOf = (path: string): string => {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot);
};

const toStep = (descriptor: AdapterDescriptor): PlanStep => ({
  adapter: descriptor.id,
  tool: descriptor.tool,
  versionRange: descriptor.versionRange,
  writes: descriptor.writes,
});

/**
 * Turns a selection into a plan. Pure: it reads no files, spawns nothing and
 * gives the same plan for the same input. Config, overrides and provenance
 * arrive with FIT-7 and FIT-9.
 */
export const resolvePlan = (input: ResolveInput): Plan => ({
  paths: input.paths.toSorted().map((path) => ({
    path,
    policy: [],
    steps: input.descriptors
      .filter((descriptor) => descriptor.extensions.includes(extensionOf(path)))
      .map(toStep),
  })),
  root: input.root,
  schemaVersion: SCHEMA_VERSION,
  selection: input.selection,
});
