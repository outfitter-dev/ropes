import { EXIT_CODE, exitCodeOf } from "../contracts/result.ts";
import { renderHuman } from "../render/human.ts";
import { renderJson } from "../render/json.ts";
import { runPlan } from "../runner/run.ts";
import type { Command } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";

/** Runs the plan read-only. No adapter is asked to write. */
export const check =
  (deps: CommandDeps): Command =>
  async (request) => {
    const prepared = await prepare(request, deps);
    if (!prepared.ok) {
      return {
        error: `cinch: ${prepared.error}`,
        exitCode: EXIT_CODE.incomplete,
      };
    }
    const { adapters, plan } = prepared.value;
    const result = await runPlan(plan, adapters, { mode: "check" });
    return {
      exitCode: exitCodeOf(result),
      output: request.json ? renderJson(result) : renderHuman(result),
    };
  };
