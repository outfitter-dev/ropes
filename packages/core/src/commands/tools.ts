import type { Adapter } from "../adapters/adapter.ts";
import type { Plan, PlanStep } from "../contracts/plan.ts";
import { toStep } from "../policy/batches.ts";
import type { ToolStatus } from "../render/plan.ts";
import {
  probeAdapter,
  versionNotice,
  versionProblem,
} from "../runner/ready.ts";

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
      if (step.incomplete === undefined) {
        steps.set(step.adapter, step);
      }
    }
  }
  for (const reporter of plan.facts?.reporters ?? []) {
    const descriptor = adapters.find(
      (adapter) => adapter.descriptor.id === reporter.adapter
    )?.descriptor;
    if (descriptor !== undefined && reporter.paths !== undefined) {
      const { tolerates: _registeredRange, ...step } = toStep(descriptor);
      steps.set(descriptor.id, {
        ...step,
        ...(reporter.tolerates === undefined
          ? {}
          : { tolerates: reporter.tolerates }),
        versionRange: reporter.versionRange ?? descriptor.versionRange,
      });
    }
  }
  return Promise.all(
    [...steps.values()].map(async (step) => {
      const adapter = adapters.find(
        (candidate) => candidate.descriptor.id === step.adapter
      );
      const { tolerates, tool, versionRange } = step;
      if (!adapter) {
        return {
          problem: `no adapter registered for "${step.adapter}"`,
          tool,
          versionRange,
        };
      }
      const found = await probeAdapter(adapter, process.platform, plan.root);
      const notice =
        found.problem === undefined
          ? versionNotice(tool, found.version, versionRange, tolerates)
          : undefined;
      return {
        ...(notice === undefined ? {} : { notice }),
        problem:
          found.problem ??
          versionProblem(tool, found.version, versionRange, tolerates),
        tool,
        version: found.version,
        versionRange,
      };
    })
  );
};
