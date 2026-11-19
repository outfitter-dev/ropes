import path from "node:path";

import type { FixReport } from "../contracts/fix.ts";
import type { Plan } from "../contracts/plan.ts";
import { EXIT_CODE, exitCodeOf } from "../contracts/result.ts";
import { unifiedDiff } from "../render/diff.ts";
import { renderFix, renderFixJson } from "../render/fix.ts";
import { runPlan } from "../runner/run.ts";
import type { Command, CommandRequest, CommandResponse } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps, Prepared } from "./prepare.ts";
import { CopyError, withCopy } from "./scratch.ts";

/** The text of each file a step may write. Null when it cannot be read. */
const snapshot = (root: string, plan: Plan): Promise<(string | null)[]> =>
  Promise.all(
    plan.paths.map(async (entry) => {
      if (!entry.steps.some((step) => step.writes)) {
        return null;
      }
      try {
        return await Bun.file(path.join(root, entry.path)).text();
      } catch {
        return null;
      }
    })
  );

/**
 * Runs the plan with writes allowed under `root`, then compares each file
 * with what it held before. The comparison does not depend on what a step
 * reported, so a run that stopped partway still names what it wrote.
 */
const apply = async (
  { adapters, plan }: Prepared,
  root: string,
  dryRun: boolean
): Promise<FixReport> => {
  const before = await snapshot(root, plan);
  const ran = await runPlan({ ...plan, root }, adapters, { mode: "fix" });
  const after = await snapshot(root, plan);
  const diffs = plan.paths.map((entry, index) =>
    unifiedDiff(entry.path, before[index] ?? "", after[index] ?? "")
  );
  return {
    changed: plan.paths
      .filter((_, index) => before[index] !== after[index])
      .map((entry) => entry.path),
    diff: diffs.join(""),
    dryRun,
    result: { ...ran, plan },
    schemaVersion: plan.schemaVersion,
  };
};

const respond = (
  request: CommandRequest,
  report: FixReport
): CommandResponse => ({
  exitCode: exitCodeOf(report.result),
  output: request.json ? renderFixJson(report) : renderFix(report),
});

export type FixRun =
  | { readonly ok: true; readonly report: FixReport }
  | { readonly ok: false; readonly response: CommandResponse };

const failed = (message: string): FixRun => ({
  ok: false,
  response: { error: `cinch: ${message}`, exitCode: EXIT_CODE.incomplete },
});

/**
 * Applies what the plan allows and returns the report. A dry run does the
 * same work on a temporary copy, so what it shows is what a real run would
 * write. `init` and `preset` call this with the files Cinch keeps.
 */
export const runFix = async (
  request: CommandRequest,
  deps: CommandDeps
): Promise<FixRun> => {
  const prepared = await prepare(request, deps);
  if (!prepared.ok) {
    return failed(prepared.error);
  }
  const { plan, root } = prepared.value;
  if (request.dryRun !== true) {
    return { ok: true, report: await apply(prepared.value, root.root, false) };
  }
  try {
    const paths = plan.paths.map((entry) => entry.path);
    const report = await withCopy(root, paths, (copy) =>
      apply(prepared.value, copy, true)
    );
    return { ok: true, report };
  } catch (error) {
    if (error instanceof CopyError) {
      return failed(error.message);
    }
    throw error;
  }
};

export const fix =
  (deps: CommandDeps): Command =>
  async (request) => {
    const ran = await runFix(request, deps);
    return ran.ok ? respond(request, ran.report) : ran.response;
  };
