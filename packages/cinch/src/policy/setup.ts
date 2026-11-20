import type { Plan } from "../contracts/plan.ts";

/**
 * The part of a plan that is the Cinch setup: the files Cinch keeps, and
 * only the steps that keep them. `doctor` runs this, and `fix` checks it
 * before it writes anything.
 */
export const setupOf = (plan: Plan): Plan => {
  const paths = plan.paths
    .map((entry) => ({
      ...entry,
      steps: entry.steps.filter((step) => step.setup === true),
    }))
    .filter((entry) => entry.steps.length > 0);
  return {
    ...plan,
    batches: plan.batches.filter((batch) => batch.setup === true),
    paths,
  };
};
