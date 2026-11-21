import path from "node:path";

import type { FixReport } from "../contracts/fix.ts";
import type { Plan } from "../contracts/plan.ts";
import { EXIT_CODE, exitCodeOf } from "../contracts/result.ts";
import { changeAt, unifiedDiff } from "../render/diff.ts";
import { renderFix, renderFixJson } from "../render/fix.ts";
import { runPlan, writesIn } from "../runner/run.ts";
import type {
  Command,
  CommandRequest,
  CommandResponse,
  FixRequest,
  Operation,
} from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps, Prepared } from "./prepare.ts";
import { CopyError, withCopy } from "./scratch.ts";
import { prepareSetup } from "./setup.ts";

/** `fix` writes the repository's files, and `doctor` the Cinch setup. */
export type WriteMode = "doctor" | "fix" | "init";

/** The text of each file a step may write. Null when it cannot be read. */
const snapshot = (
  root: string,
  plan: Plan,
  mode: WriteMode
): Promise<(string | null)[]> =>
  Promise.all(
    plan.paths.map(async (entry) => {
      if (!entry.steps.some((step) => writesIn(mode, step))) {
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
  run: { readonly dryRun: boolean; readonly mode: WriteMode }
): Promise<FixReport> => {
  const before = await snapshot(root, plan, run.mode);
  const ran = await runPlan({ ...plan, root }, adapters, {
    changeAt,
    mode: run.mode,
  });
  const after = await snapshot(root, plan, run.mode);
  const diffs = plan.paths.map((entry, index) =>
    unifiedDiff(entry.path, before[index] ?? "", after[index] ?? "")
  );
  return {
    changed: plan.paths
      .filter((_, index) => before[index] !== after[index])
      .map((entry) => entry.path),
    diff: diffs.join(""),
    dryRun: run.dryRun,
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

export type FixRun = Operation<FixReport>;

export interface WriteOptions {
  readonly dryRun: boolean;
  readonly mode: WriteMode;
  /** Files a dry run's copy must hold even when git ignores them. */
  readonly also?: readonly string[];
}

/**
 * Applies what the plan allows in this mode and returns the report. A dry
 * run does the same work on a temporary copy, so what it shows is what a
 * real run would write.
 */
export const writePlan = async (
  prepared: Prepared,
  options: WriteOptions
): Promise<FixRun> => {
  const { plan, root } = prepared;
  const { also = [], dryRun, mode } = options;
  if (!dryRun) {
    return {
      ok: true,
      value: await apply(prepared, root.root, { dryRun, mode }),
    };
  }
  try {
    // A file an adapter reads beside its own decides what it writes, so the
    // copy holds it even where git ignores it. A missing one is left out.
    const beside = prepared.adapters.flatMap(
      ({ descriptor }) => descriptor.beside ?? []
    );
    const paths = [
      ...plan.paths.map((entry) => entry.path),
      ...also,
      ...beside,
    ];
    const snapshots = await Promise.all(
      plan.batches
        .filter((batch) => batch.incomplete === undefined)
        .map(async (batch) => {
          const adapter = prepared.adapters.find(
            ({ descriptor }) => descriptor.id === batch.adapter
          );
          return await (adapter?.previewInputs?.({
            package: batch.package,
            paths: batch.paths,
            root: root.root,
            ...(batch.rules === undefined ? {} : { rules: batch.rules }),
            ...(batch.target === undefined ? {} : { target: batch.target }),
          }) ?? []);
        })
    );
    const inputs = snapshots.flat();
    const uniqueInputs = [
      ...new Map(inputs.map((input) => [input.path, input])).values(),
    ];
    const report = await withCopy(
      root,
      paths,
      (copy) => apply(prepared, copy, { dryRun, mode }),
      uniqueInputs
    );
    return { ok: true, value: report };
  } catch (error) {
    if (error instanceof CopyError) {
      return { error: error.message, ok: false };
    }
    throw error;
  }
};

/** Plans the request's paths, then writes what the mode allows. */
export const runWrite = async (
  request: FixRequest,
  deps: CommandDeps,
  options: Omit<WriteOptions, "dryRun">
): Promise<FixRun> => {
  const prepared = await prepare(request, deps);
  return prepared.ok
    ? await writePlan(prepared.value, {
        ...options,
        dryRun: request.dryRun === true,
      })
    : prepared;
};

const STOPPED =
  "Nothing was fixed: the Cinch setup needs repair first. Run `cinch doctor --fix`, then run this again.";

/**
 * The setup is checked before anything is written. A config Cinch keeps
 * that is missing or behind would have an engine fix files by the wrong
 * rules, so `fix` stops and leaves the repair to `doctor --fix`.
 */
const brokenSetup = async (
  request: FixRequest,
  deps: CommandDeps
): Promise<FixRun | null> => {
  const setup = await prepareSetup(request.cwd, deps);
  if (!setup.ok) {
    return setup;
  }
  const { adapters, plan } = setup.value;
  const result = await runPlan(plan, adapters, { mode: "check" });
  if (result.outcome === "clean") {
    return null;
  }
  return {
    ok: true,
    value: {
      changed: [],
      diff: "",
      dryRun: request.dryRun === true,
      result,
      schemaVersion: plan.schemaVersion,
      stopped: STOPPED,
    },
  };
};

/**
 * Fix the repository's own files. This never writes a file
 * Cinch keeps: that is `cinch doctor --fix`.
 */
export const runFix = async (
  request: FixRequest,
  deps: CommandDeps
): Promise<FixRun> =>
  request.at === undefined
    ? ((await brokenSetup(request, deps)) ??
      (await runWrite(request, deps, { mode: "fix" })))
    : {
        error: "An explicit evaluation time is only for explain and check.",
        ok: false,
      };

export const fix =
  (deps: CommandDeps): Command =>
  async (request) => {
    const ran = await runFix(request, deps);
    return ran.ok
      ? respond(request, ran.value)
      : { error: `cinch: ${ran.error}`, exitCode: EXIT_CODE.incomplete };
  };
