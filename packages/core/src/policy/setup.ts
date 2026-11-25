import type { Plan } from "../contracts/plan.ts";

/**
 * The part of a plan that is the Cinch setup: the files Cinch keeps, and
 * only the steps that keep them. `doctor` runs this, and `fix` checks it
 * before it writes anything. Comparing shared facts is no part of it.
 */
export const setupOf = (plan: Plan): Plan => {
  const paths = plan.paths
    .map((entry) => ({
      ...entry,
      policy: entry.policy.map(({ blockingAt, ...setting }) =>
        blockingAt === undefined
          ? setting
          : { ...setting, value: blockingAt.slice(0, 10) }
      ),
      steps: entry.steps.filter((step) => step.setup === true),
    }))
    .filter((entry) => entry.steps.length > 0);
  const { evaluation: _contentClock, facts: _compared, ...rest } = plan;
  return {
    ...rest,
    batches: plan.batches.filter((batch) => batch.setup === true),
    paths,
  };
};
