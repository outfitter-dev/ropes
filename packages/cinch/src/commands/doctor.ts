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
  CommandRequest,
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
  const engines = {
    ...plan,
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
                  plan.batches.find((batch) => batch.adapter === id)
                    ?.versionRange &&
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
 * `cinch doctor` checks the Cinch setup: the files Cinch keeps, and the
 * tools the plan needs. It also names the rule packs that apply here and are
 * not adopted, which is a note and not a fault. `--fix` writes the files Cinch keeps, and makes the
 * one edit Cinch may make to a config a person wrote. It reads the same
 * plan as the other verbs, so it writes nothing `explain` does not show.
 */
const inspectDoctor = async (
  request: CommandRequest,
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
    ? await oldConfigs(setup.adapters, setup.plan, root)
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

/** The public read-only inspection shares the legacy setup and tool checks. */
export const runDoctor = (request: ReadRequest, deps: CommandDeps) =>
  inspectDoctor(
    {
      cwd: request.cwd,
      json: false,
      paths: request.paths,
      ...(request.strict === undefined ? {} : { strict: request.strict }),
    },
    deps,
    true
  );

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
