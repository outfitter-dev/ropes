import type { Result } from "../contracts/result.ts";
import { EXIT_CODE, exitCodeOf } from "../contracts/result.ts";
import { renderHuman } from "../render/human.ts";
import { renderJson } from "../render/json.ts";
import { runPlan } from "../runner/run.ts";
import type { Command, Operation, ReadRequest } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";

/** Runs the plan read-only. No adapter is asked to write. */
export const runCheck = async (
  request: ReadRequest,
  deps: CommandDeps
): Promise<Operation<Result>> => {
  const prepared = await prepare(request, deps);
  if (!prepared.ok) {
    return prepared;
  }
  const { adapters, plan } = prepared.value;
  return { ok: true, value: await runPlan(plan, adapters, { mode: "check" }) };
};

export const check =
  (deps: CommandDeps): Command =>
  async (request) => {
    const ran = await runCheck(request, deps);
    if (!ran.ok) {
      return {
        error: `cinch: ${ran.error}`,
        exitCode: EXIT_CODE.incomplete,
      };
    }
    const result = ran.value;
    return {
      exitCode: exitCodeOf(result),
      output: request.json ? renderJson(result) : renderHuman(result),
    };
  };
