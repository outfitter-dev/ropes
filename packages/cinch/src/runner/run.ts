import type { Adapter, StepOutcome } from "../adapters/adapter.ts";
import type { Plan, PlanStep } from "../contracts/plan.ts";
import { EXIT_CODE, outcomeOf } from "../contracts/result.ts";
import type { ExitCode, Result, StepResult } from "../contracts/result.ts";
import { notReady, threw } from "./ready.ts";

export type RunMode = "check" | "fix";

export interface RunOptions {
  readonly mode: RunMode;
  /** Defaults to the platform this process runs on. */
  readonly platform?: string;
}

const incomplete = (reason: string): StepOutcome => ({
  findings: [],
  reason,
  status: "incomplete",
});

/** Probes each adapter at most once per run, however many steps use it. */
const readiness = (adapters: readonly Adapter[], platform: string) => {
  const byId = new Map(
    adapters.map((adapter) => [adapter.descriptor.id, adapter])
  );
  const problems = new Map<string, Promise<string | undefined>>();
  return (id: string) => {
    const adapter = byId.get(id);
    if (adapter && !problems.has(id)) {
      problems.set(id, notReady(adapter, platform));
    }
    return { adapter, problem: problems.get(id) };
  };
};

const runStep = async (
  ready: ReturnType<typeof readiness>,
  step: PlanStep,
  input: { root: string; path: string },
  mode: RunMode
): Promise<StepOutcome> => {
  const { adapter, problem } = ready(step.adapter);
  if (!adapter) {
    return incomplete(`no adapter registered for "${step.adapter}"`);
  }
  const reason = await problem;
  if (reason !== undefined) {
    return incomplete(reason);
  }
  try {
    return mode === "fix" && step.writes
      ? await adapter.fix(input)
      : await adapter.check(input);
  } catch (error) {
    return incomplete(threw(step.tool, error));
  }
};

/**
 * Runs a plan through adapters. It never branches on which adapter it holds,
 * and a step that could not run is incomplete, never passed.
 */
export const runPlan = async (
  plan: Plan,
  adapters: readonly Adapter[],
  options: RunOptions
): Promise<Result> => {
  const ready = readiness(adapters, options.platform ?? process.platform);
  const steps: StepResult[] = [];
  for (const planned of plan.paths) {
    for (const step of planned.steps) {
      // Steps on one file must run in plan order: a later step reads what an
      // earlier one wrote.
      // oxlint-disable-next-line no-await-in-loop
      const outcome = await runStep(
        ready,
        step,
        { path: planned.path, root: plan.root },
        options.mode
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
