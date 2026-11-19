import type { Adapter, StepOutcome } from "../adapters/adapter.ts";
import type { Plan, PlanStep } from "../contracts/plan.ts";
import { outcomeOf } from "../contracts/result.ts";
import type { Result, StepResult } from "../contracts/result.ts";
import { probeAdapter, threw, versionProblem } from "./ready.ts";
import type { Readiness } from "./ready.ts";

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
  const probes = new Map<string, Promise<Readiness>>();
  return (id: string) => {
    const adapter = byId.get(id);
    if (adapter && !probes.has(id)) {
      probes.set(id, probeAdapter(adapter, platform));
    }
    return { adapter, probe: probes.get(id) };
  };
};

const runStep = async (
  ready: ReturnType<typeof readiness>,
  step: PlanStep,
  input: { root: string; path: string },
  mode: RunMode
): Promise<StepOutcome> => {
  const { adapter, probe } = ready(step.adapter);
  if (!adapter) {
    return incomplete(`no adapter registered for "${step.adapter}"`);
  }
  const found = await probe;
  const reason =
    found?.problem ??
    versionProblem(step.tool, found?.version, step.versionRange);
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
