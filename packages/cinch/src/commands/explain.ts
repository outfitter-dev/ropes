import type { ToolStatus } from "../contracts/doctor.ts";
import type { Plan } from "../contracts/plan.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import { renderPlanJson } from "../render/json.ts";
import { renderPlan } from "../render/plan.ts";
import type { Command, Operation, ReadRequest } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";
import { toolStatuses } from "./tools.ts";

export interface Explanation {
  readonly configFile: string | null;
  readonly plan: Plan;
  readonly tools: readonly ToolStatus[];
}

/** Resolves the plan. Optional version probes do not run any planned checks. */
export const runExplain = async (
  request: ReadRequest,
  deps: CommandDeps,
  probeTools: boolean
): Promise<Operation<Explanation>> => {
  const prepared = await prepare(request, deps);
  if (!prepared.ok) {
    return prepared;
  }
  const { adapters, plan, root } = prepared.value;
  return {
    ok: true,
    value: {
      configFile: root.configFile,
      plan,
      tools: probeTools ? await toolStatuses(plan, adapters) : [],
    },
  };
};

export const explain =
  (deps: CommandDeps): Command =>
  async (request) => {
    const ran = await runExplain(request, deps, !request.json);
    if (!ran.ok) {
      return {
        error: `cinch: ${ran.error}`,
        exitCode: EXIT_CODE.incomplete,
      };
    }
    const { plan } = ran.value;
    return {
      exitCode: EXIT_CODE.clean,
      output: request.json ? renderPlanJson(plan) : renderPlan(plan, ran.value),
    };
  };
