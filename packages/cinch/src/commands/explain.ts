import { EXIT_CODE } from "../contracts/result.ts";
import { renderPlanJson } from "../render/json.ts";
import { renderPlan } from "../render/plan.ts";
import type { Command } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";
import { toolStatuses } from "./tools.ts";

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
