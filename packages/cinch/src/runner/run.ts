import type { Adapter, StepOutcome } from "../adapters/adapter.ts";
import type { Plan, PlanStep } from "../contracts/plan.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import type { ExitCode, Result, StepResult } from "../contracts/result.ts";

export type RunMode = "check" | "fix";

const incomplete = (reason: string): StepOutcome => ({
  findings: [],
  reason,
  status: "incomplete",
});

const runStep = async (
  adapter: Adapter | undefined,
  step: PlanStep,
  input: { root: string; path: string },
  mode: RunMode
): Promise<StepOutcome> => {
  if (!adapter) {
    return incomplete(`no adapter registered for "${step.adapter}"`);
  }
  const probe = await adapter.probe();
  if (!probe.available) {
    return incomplete(probe.reason ?? `${step.tool} is not available`);
  }
  return mode === "fix" && step.writes
    ? adapter.fix(input)
    : adapter.check(input);
};

/**
 * Runs a plan through adapters. It never branches on which adapter it holds,
 * and a step that could not run is incomplete, never passed.
 */
export const runPlan = async (
  plan: Plan,
  adapters: readonly Adapter[],
  mode: RunMode
): Promise<Result> => {
  const byId = new Map(
    adapters.map((adapter) => [adapter.descriptor.id, adapter])
  );
  const steps: StepResult[] = [];
  for (const planned of plan.paths) {
    for (const step of planned.steps) {
      // Steps on one file must run in plan order: a later step reads what an
      // earlier one wrote.
      // oxlint-disable-next-line no-await-in-loop
      const outcome = await runStep(
        byId.get(step.adapter),
        step,
        { path: planned.path, root: plan.root },
        mode
      );
      steps.push({ adapter: step.adapter, path: planned.path, ...outcome });
    }
  }
  return { plan, schemaVersion: plan.schemaVersion, steps };
};

/** Incomplete beats findings, and findings beat clean. */
export const exitCodeOf = (result: Result): ExitCode => {
  if (result.steps.some((step) => step.status === "incomplete")) {
    return EXIT_CODE.incomplete;
  }
  if (result.steps.some((step) => step.status === "findings")) {
    return EXIT_CODE.findings;
  }
  return EXIT_CODE.clean;
};
