import type { Adapter, FileOutcome, StepOutcome } from "../adapters/adapter.ts";
import type { Plan, PlanBatch } from "../contracts/plan.ts";
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

/** One outcome for each file of the batch, whatever the adapter returned. */
const answered = (
  batch: PlanBatch,
  outcomes: readonly FileOutcome[]
): FileOutcome[] => {
  const byPath = new Map(outcomes.map((outcome) => [outcome.path, outcome]));
  return batch.paths.map(
    (path) =>
      byPath.get(path) ?? {
        ...incomplete(`${batch.tool} gave no answer for this file`),
        path,
      }
  );
};

const runBatch = async (
  ready: ReturnType<typeof readiness>,
  batch: PlanBatch,
  root: string,
  mode: RunMode
): Promise<FileOutcome[]> => {
  const all = (reason: string) =>
    batch.paths.map((path) => ({ ...incomplete(reason), path }));
  const { adapter, probe } = ready(batch.adapter);
  if (!adapter) {
    return all(`no adapter registered for "${batch.adapter}"`);
  }
  const found = await probe;
  const reason =
    found?.problem ??
    versionProblem(batch.tool, found?.version, batch.versionRange);
  if (reason !== undefined) {
    return all(reason);
  }
  const input = { package: batch.package, paths: batch.paths, root };
  try {
    return answered(
      batch,
      mode === "fix" && batch.writes
        ? await adapter.fix(input)
        : await adapter.check(input)
    );
  } catch (error) {
    return all(threw(batch.tool, error));
  }
};

/**
 * Runs a plan through adapters, one start of an engine for each batch. It
 * never branches on which adapter it holds. A step that could not run marks
 * every file of its batch incomplete, never passed.
 */
export const runPlan = async (
  plan: Plan,
  adapters: readonly Adapter[],
  options: RunOptions
): Promise<Result> => {
  const ready = readiness(adapters, options.platform ?? process.platform);
  const ran: StepResult[] = [];
  for (const batch of plan.batches) {
    // Batches run in plan order: a later step reads what an earlier one
    // wrote, and a kept config is written before the step that reads it.
    // oxlint-disable-next-line no-await-in-loop
    const outcomes = await runBatch(ready, batch, plan.root, options.mode);
    ran.push(
      ...outcomes.map((outcome) => ({ adapter: batch.adapter, ...outcome }))
    );
  }
  // Reported file by file, in the order the plan lists them.
  const steps = plan.paths.flatMap((planned) =>
    ran.filter((step) => step.path === planned.path)
  );
  return {
    outcome: outcomeOf(steps),
    plan,
    schemaVersion: plan.schemaVersion,
    steps,
  };
};
