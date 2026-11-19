import type { Adapter, StepOutcome } from "../adapters/adapter.ts";
import type { Plan, PlanStep } from "../contracts/plan.ts";
import { EXIT_CODE, outcomeOf } from "../contracts/result.ts";
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
    ? await adapter.fix(input)
    : await adapter.check(input);
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
  return {
    outcome: outcomeOf(steps),
    plan,
    schemaVersion: plan.schemaVersion,
    steps,
  };
};

export const exitCodeOf = (result: Result): ExitCode =>
  EXIT_CODE[result.outcome];
