import { adaptersFor } from "./adapters/registry.ts";
import { runCheck } from "./commands/check.ts";
import type { FixRequest, ReadRequest } from "./commands/command.ts";
import { runExplain } from "./commands/explain.ts";
import { runFix } from "./commands/fix.ts";

export type { FixRequest, Operation, ReadRequest } from "./commands/command.ts";
export type { Explanation } from "./commands/explain.ts";
export type { FixReport } from "./contracts/fix.ts";
export { parseFinding, parsePlan, parseResult } from "./contracts/parse.ts";
export type { Plan } from "./contracts/plan.ts";
export { EXIT_CODE, exitCodeOf } from "./contracts/result.ts";
export type { ExitCode, Result } from "./contracts/result.ts";

const deps = { adapters: adaptersFor };

export const check = (request: ReadRequest) => runCheck(request, deps);
export const explain = (request: ReadRequest, probeTools = false) =>
  runExplain(request, deps, probeTools);
export const fix = (request: FixRequest) => runFix(request, deps);
