import type { DoctorReport, SettingsReport } from "../contracts/doctor.ts";
import type { FixReport } from "../contracts/fix.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import {
  doctorOutcome,
  renderDoctor,
  renderDoctorJson,
} from "../render/doctor.ts";
import { factSteps, observeFacts } from "../runner/facts.ts";
import { runPlan } from "../runner/run.ts";
import type {
  Command,
  CommandResponse,
  Operation,
  ReadRequest,
} from "./command.ts";
import { writePlan } from "./fix.ts";
import type { FixRun } from "./fix.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps, Prepared } from "./prepare.ts";
import { oldConfigs } from "./retire.ts";
import { declined, unadopted } from "./rules-adopt.ts";
import { prepareSetup } from "./setup.ts";
import { toolStatuses } from "./tools.ts";

export interface DoctorRequest extends ReadRequest {
  readonly fix?: boolean;
  readonly dryRun?: boolean;
}

const unusable = (message: string): CommandResponse => ({
  error: `rope: ${message}`,
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

/** The tools the workspace's plan needs, less Ropes's own setup steps. */
const workspaceStatus = async (
  root: string,
  deps: CommandDeps,
  strict: boolean,
  includeSettings: boolean
): Promise<
  | {
      readonly tools: DoctorReport["tools"];
      readonly settings?: SettingsReport;
    }
  | string
> => {
  const workspace = await prepare({ cwd: root, paths: [], strict }, deps);
  if (!workspace.ok) {
    return workspace.error;
  }
  const { adapters, plan } = workspace.value;
  const { facts: _facts, ...withoutSettings } = plan;
  const engines = {
    ...(includeSettings ? plan : withoutSettings),
    paths: plan.paths.map((entry) => ({
      ...entry,
      steps: entry.steps.filter((step) => step.setup !== true),
    })),
  };
  const statuses = await toolStatuses(engines, adapters);
  if (!includeSettings || plan.facts === undefined) {
    return { tools: statuses };
  }
  const observations = await observeFacts(
    plan.facts,
    root,
    (id) =>
      Promise.resolve(
        adapters.find(
          (adapter) =>
            adapter.descriptor.id === id &&
            statuses.some(
              (status) =>
                status.tool === adapter.descriptor.tool &&
                status.versionRange ===
                  (plan.batches.find((batch) => batch.adapter === id)
                    ?.versionRange ??
                    plan.facts?.reporters.find(
                      (reporter) => reporter.adapter === id
                    )?.versionRange) &&
                status.problem === undefined
            )
        )
      ),
    plan.batches
  );
  const observed = new Set(
    observations.map((observation) => observation.adapter)
  );
  for (const reporter of plan.facts.reporters) {
    if (!observed.has(reporter.adapter)) {
      const status = statuses.find(
        (candidate) => candidate.tool === reporter.tool
      );
      observations.push({
        adapter: reporter.adapter,
        facts: [],
        limitations: [],
        problem:
          status?.problem ??
          "The adapter does not expose the requested settings",
        tool: reporter.tool,
      });
    }
  }
  return {
    settings: {
      observations,
      stated: plan.facts.stated,
      steps: factSteps(plan.facts, observations),
    },
    tools: statuses,
  };
};

/**
 * `rope doctor` checks the Ropes setup: the files Ropes keeps, and the
 * tools the plan needs. It also names the rule packs that apply here and are
 * not adopted, which is a note and not a fault. `--fix` writes the files Ropes keeps, and makes the
 * one edit Ropes may make to a config a person wrote. It reads the same
 * plan as the other verbs, so it writes nothing `explain` does not show.
 */
const inspectDoctor = async (
  request: DoctorRequest,
  deps: CommandDeps,
  includeSettings = false
): Promise<Operation<DoctorReport>> => {
  if (request.paths.length > 0) {
    return {
      error: "doctor checks the whole setup, so it takes no paths.",
      ok: false,
    };
  }
  const prepared = await prepareSetup(request.cwd, deps);
  if (!prepared.ok) {
    return { error: prepared.error, ok: false };
  }
  const setup = prepared.value;
  const { root } = setup.root;
  const fixing = request.fix === true;
  // A new config carries over an older tool's settings, so a dry run's
  // copy must hold that tool's files even when git ignores them.
  const old = fixing
    ? await oldConfigs(setup.adapters, setup.plan, root, setup.config)
    : null;
  const ran: FixRun = fixing
    ? await writePlan(setup, {
        also: old?.files ?? [],
        dryRun: request.dryRun === true,
        mode: "doctor",
      })
    : { ok: true, value: await inspect(setup) };
  if (!ran.ok) {
    return { error: ran.error, ok: false };
  }
  const found = await workspaceStatus(
    root,
    deps,
    request.strict === true,
    includeSettings
  );
  if (typeof found === "string") {
    return { error: found, ok: false };
  }
  // A repository that states rules are off has made its choice.
  const report: DoctorReport = {
    ...ran.value,
    fix: fixing,
    notAdopted: declined(setup.config)
      ? []
      : unadopted(setup.config, setup.adapters, setup.present),
    ...found,
  };
  return { ok: true, value: report };
};

export const runDoctor = (
  request: DoctorRequest,
  deps: CommandDeps
): Promise<Operation<DoctorReport>> => {
  if (request.at !== undefined) {
    return Promise.resolve({
      error: "An explicit evaluation time is only for explain and check.",
      ok: false,
    });
  }
  if (request.dryRun === true && request.fix !== true) {
    return Promise.resolve({
      error: "A doctor dry run requires fix to be enabled.",
      ok: false,
    });
  }
  return inspectDoctor(request, deps, request.fix !== true);
};

export const doctor =
  (deps: CommandDeps): Command =>
  async (request) => {
    const ran = await inspectDoctor(request, deps);
    if (!ran.ok) {
      return unusable(ran.error);
    }
    return {
      exitCode: EXIT_CODE[doctorOutcome(ran.value)],
      output: request.json
        ? renderDoctorJson(ran.value)
        : renderDoctor(ran.value),
    };
  };
