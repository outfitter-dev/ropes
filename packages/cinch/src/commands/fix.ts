import path from "node:path";

import type { FixReport } from "../contracts/fix.ts";
import type { Plan } from "../contracts/plan.ts";
import { EXIT_CODE, exitCodeOf } from "../contracts/result.ts";
import { unifiedDiff } from "../render/diff.ts";
import { renderFix, renderFixJson } from "../render/fix.ts";
import { runPlan } from "../runner/run.ts";
import type { Command } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps, Prepared } from "./prepare.ts";
import { withCopy } from "./scratch.ts";

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

/**
 * Applies what the plan allows. A dry run does the same work on a temporary
 * copy, so what it shows is what a real run would write.
 */
export const fix =
  (deps: CommandDeps): Command =>
  async (request) => {
    const prepared = await prepare(request, deps);
    if (!prepared.ok) {
      return {
        error: `cinch: ${prepared.error}`,
        exitCode: EXIT_CODE.incomplete,
      };
    }
    const { root } = prepared.value;
    const report =
      request.dryRun === true
        ? await withCopy(
            root,
            prepared.value.plan.paths.map((entry) => entry.path),
            (copy) => apply(prepared.value, copy, true)
          )
        : await apply(prepared.value, root.root, false);
    return {
      exitCode: exitCodeOf(report.result),
      output: request.json ? renderFixJson(report) : renderFix(report),
    };
  };
