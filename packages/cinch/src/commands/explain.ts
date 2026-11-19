import type { Adapter } from "../adapters/adapter.ts";
import type { Plan, PlanStep } from "../contracts/plan.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import { renderPlanJson } from "../render/json.ts";
import { renderPlan } from "../render/plan.ts";
import type { ToolStatus } from "../render/plan.ts";
import { probeAdapter, versionProblem } from "../runner/ready.ts";
import type { Command } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";

/**
 * One status per tool the plan uses, from the same probe and version check
 * the runner makes. Probing asks a tool for its version. It runs no step.
 */
const toolStatuses = (
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
      const found = await probeAdapter(adapter, process.platform);
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

/** Shows the plan. A missing tool is reported and the plan is still shown. */
export const explain =
  (deps: CommandDeps): Command =>
  async (request) => {
    const prepared = await prepare(request, deps);
    if (!prepared.ok) {
      return {
        error: `cinch: ${prepared.error}`,
        exitCode: EXIT_CODE.incomplete,
      };
    }
    const { adapters, plan, root } = prepared.value;
    return {
      exitCode: EXIT_CODE.clean,
      output: request.json
        ? renderPlanJson(plan)
        : renderPlan(plan, {
            configFile: root.configFile,
            tools: await toolStatuses(plan, adapters),
          }),
    };
  };
