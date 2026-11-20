import type { DoctorReport } from "../contracts/doctor.ts";
import type { FixReport } from "../contracts/fix.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import { setupOf } from "../policy/setup.ts";
import {
  doctorOutcome,
  renderDoctor,
  renderDoctorJson,
} from "../render/doctor.ts";
import { runPlan } from "../runner/run.ts";
import type { Command, CommandResponse } from "./command.ts";
import { writePlan } from "./fix.ts";
import type { FixRun } from "./fix.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps, Prepared } from "./prepare.ts";
import { describeGap, gapsOf } from "./preset-gaps.ts";
import { locate } from "./presets.ts";
import { setupFiles } from "./setup.ts";
import { toolStatuses } from "./tools.ts";

const unusable = (message: string): CommandResponse => ({
  error: `cinch: ${message}`,
  exitCode: EXIT_CODE.incomplete,
});

/** A read-only look at the setup, shaped like a run that wrote nothing. */
const inspect = async ({ adapters, plan }: Prepared): Promise<FixReport> => ({
  changed: [],
  diff: "",
  dryRun: false,
  result: await runPlan(plan, adapters, { mode: "check" }),
  schemaVersion: plan.schemaVersion,
});

/** The tools the workspace's plan needs, less Cinch's own setup steps. */
const tools = async (
  root: string,
  deps: CommandDeps
): Promise<DoctorReport["tools"] | string> => {
  const workspace = await prepare({ cwd: root, paths: [] }, deps);
  if (!workspace.ok) {
    return workspace.error;
  }
  const { adapters, plan } = workspace.value;
  const engines = {
    ...plan,
    paths: plan.paths.map((entry) => ({
      ...entry,
      steps: entry.steps.filter((step) => step.setup !== true),
    })),
  };
  return await toolStatuses(engines, adapters);
};

/**
 * `cinch doctor` checks the Cinch setup: the files Cinch keeps, and the
 * tools the plan needs. `--fix` writes the files Cinch keeps, and makes the
 * one edit Cinch may make to a config a person wrote. It reads the same
 * plan as the other verbs, so it writes nothing `explain` does not show.
 */
export const doctor =
  (deps: CommandDeps): Command =>
  async (request) => {
    if (request.paths.length > 0) {
      return unusable("doctor checks the whole setup, so it takes no paths.");
    }
    const located = await locate(request.cwd, deps);
    if (!located.ok) {
      return unusable(located.error);
    }
    const { root } = located.root;
    const full = await prepare({ cwd: root, paths: setupFiles(deps) }, deps);
    if (!full.ok) {
      return unusable(full.error);
    }
    // A file the config leaves out cannot be kept, and saying nothing about
    // it would read as a pass. A preset that is switched off is not a gap.
    const gaps = gapsOf(located.presets, full.value.plan).filter(
      (gap) => gap.why === "left-out"
    );
    if (gaps.length > 0) {
      return unusable(gaps.map(describeGap).join("\ncinch: "));
    }
    const setup = { ...full.value, plan: setupOf(full.value.plan) };
    const fixing = request.fix === true;
    const ran: FixRun = fixing
      ? await writePlan(setup, {
          dryRun: request.dryRun === true,
          mode: "doctor",
        })
      : { ok: true, report: await inspect(setup) };
    if (!ran.ok) {
      return ran.response;
    }
    const found = await tools(root, deps);
    if (typeof found === "string") {
      return unusable(found);
    }
    const report: DoctorReport = { ...ran.report, fix: fixing, tools: found };
    return {
      exitCode: EXIT_CODE[doctorOutcome(report)],
      output: request.json ? renderDoctorJson(report) : renderDoctor(report),
    };
  };
