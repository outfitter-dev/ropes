import { SCHEMA_VERSION } from "../contracts/plan.ts";
import type { Evaluation, Plan, Selection } from "../contracts/plan.ts";
import { batchesFor } from "./batches.ts";
import { resolveDeadlines } from "./deadlines.ts";
import { sharedFacts } from "./facts.ts";
import { compileGlobs } from "./glob.ts";
import { localRules, packStates, rulesOn } from "./packs.ts";
import { planPath } from "./plan-path.ts";
import type { PathPlanInput, Scope } from "./plan-path.ts";

export interface ResolveInput extends PathPlanInput {
  readonly root: string;
  readonly evaluation?: Evaluation;
  /** What the caller asked for. */
  readonly selection: Selection;
  /** The root-relative paths the selection expanded to. */
  readonly paths: readonly string[];
  /**
   * Every root-relative file in the repository. A rule pack applies where
   * one matches. Left out, there are none and no pack applies.
   */
  readonly present?: readonly string[];
}

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
  // An adapter that ships rule packs has nothing to run when none is on
  // and the repository names no rules of its own.
  const input = {
    ...given,
    descriptors: given.descriptors.filter(
      (descriptor) =>
        descriptor.packs === undefined ||
        rulesOn(rules, descriptor.id).length > 0 ||
        (descriptor.localRules ?? []).length > 0 ||
        descriptor.foundRules !== undefined
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
  ].map((path) => planPath(path, input, scope));
  const batches = batchesFor(planned, input.descriptors).map((batch) =>
    withPacks.has(batch.adapter)
      ? { ...batch, rules: rulesOn(rules, batch.adapter) }
      : batch
  );
  const facts = sharedFacts(input.config, input.descriptors, batches);
  const local = localRules(input.config, input.descriptors);
  const deadlines = resolveDeadlines(
    given.config,
    given.evaluation,
    planned,
    batches,
    input.descriptors
  );
  return {
    batches,
    ...(facts === undefined ? {} : { facts }),
    ...(local === undefined ? {} : { localRules: local }),
    ...deadlines,
    root: input.root,
    ...(rules.length === 0 ? {} : { rules }),
    schemaVersion: SCHEMA_VERSION,
    selection: input.selection,
  };
};
