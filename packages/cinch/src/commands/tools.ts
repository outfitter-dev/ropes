import type { Adapter } from "../adapters/adapter.ts";
import type { Plan, PlanStep } from "../contracts/plan.ts";
import type { ToolStatus } from "../render/plan.ts";
import { probeAdapter, versionProblem } from "../runner/ready.ts";

/**
 * One status per tool the plan uses, from the same probe and version check
 * the runner makes. Probing asks a tool for its version. It runs no step.
 */
export const toolStatuses = (
  plan: Plan,
  adapters: readonly Adapter[]
): Promise<ToolStatus[]> => {
  const steps = new Map<string, PlanStep>();
  for (const entry of plan.paths) {
    for (const step of entry.steps) {
      steps.set(step.adapter, step);
    }
  }
  return Promise.all(
    [...steps.values()].map(async (step) => {
      const adapter = adapters.find(
        (candidate) => candidate.descriptor.id === step.adapter
      );
      const { tool, versionRange } = step;
      if (!adapter) {
        return {
          problem: `no adapter registered for "${step.adapter}"`,
          tool,
          versionRange,
        };
      }
      const found = await probeAdapter(adapter, process.platform, plan.root);
      return {
        problem:
          found.problem ?? versionProblem(tool, found.version, versionRange),
        tool,
        version: found.version,
        versionRange,
      };
    })
  );
};
