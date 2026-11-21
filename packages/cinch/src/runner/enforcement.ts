import {
  ENFORCEMENT_PREFIX,
  EnforcementLevelSchema,
} from "../contracts/enforcement.ts";
import type { Plan } from "../contracts/plan.ts";
import type { StepResult } from "../contracts/result.ts";

/** Apply the plan's decision after native diagnostics have been collected. */
export const enforce = (
  plan: Plan,
  steps: readonly StepResult[]
): StepResult[] => {
  const policies = new Map(
    plan.paths.map(({ path, policy }) => [path, policy])
  );
  return steps.map((step) => ({
    ...step,
    findings: step.findings.map((finding) => {
      const { enforcement: _previous, ...native } = finding;
      const policy = policies.get(finding.path);
      const setting = policy?.find(
        ({ key }) => key === `${ENFORCEMENT_PREFIX}${finding.rule}`
      );
      const level = EnforcementLevelSchema.safeParse(setting?.value);
      return setting !== undefined && level.success
        ? {
            ...native,
            enforcement: { level: level.data, source: setting.source },
          }
        : native;
    }),
  }));
};
