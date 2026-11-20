import type { DoctorReport } from "../contracts/doctor.ts";
import type { FixReport } from "../contracts/fix.ts";
import { EXIT_CODE } from "../contracts/result.ts";
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
import { oldConfigs } from "./retire.ts";
import { declined, unadopted } from "./rules-adopt.ts";
import { prepareSetup } from "./setup.ts";
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
  deps: CommandDeps,
  strict: boolean
): Promise<DoctorReport["tools"] | string> => {
  const workspace = await prepare({ cwd: root, paths: [], strict }, deps);
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
 * tools the plan needs. It also names the rule packs that apply here and are
 * not adopted, which is a note and not a fault. `--fix` writes the files Cinch keeps, and makes the
 * one edit Cinch may make to a config a person wrote. It reads the same
 * plan as the other verbs, so it writes nothing `explain` does not show.
 */
export const doctor =
  (deps: CommandDeps): Command =>
  async (request) => {
    if (request.paths.length > 0) {
      return unusable("doctor checks the whole setup, so it takes no paths.");
    }
    const prepared = await prepareSetup(request.cwd, deps);
    if (!prepared.ok) {
      return unusable(prepared.error);
    }
    const setup = prepared.value;
    const { root } = setup.root;
    const fixing = request.fix === true;
    // A new config carries over an older tool's settings, so a dry run's
    // copy must hold that tool's files even when git ignores them.
    const old = fixing
      ? await oldConfigs(setup.adapters, setup.plan, root)
      : null;
    const ran: FixRun = fixing
      ? await writePlan(setup, {
          also: old?.files ?? [],
          dryRun: request.dryRun === true,
          mode: "doctor",
        })
      : { ok: true, report: await inspect(setup) };
    if (!ran.ok) {
      return ran.response;
    }
    const found = await tools(root, deps, request.strict === true);
    if (typeof found === "string") {
      return unusable(found);
    }
    // A repository that states rules are off has made its choice.
    const report: DoctorReport = {
      ...ran.report,
      fix: fixing,
      notAdopted: declined(setup.config)
        ? []
        : unadopted(setup.config, setup.adapters, setup.present),
      tools: found,
    };
    return {
      exitCode: EXIT_CODE[doctorOutcome(report)],
      output: request.json ? renderDoctorJson(report) : renderDoctor(report),
    };
  };
