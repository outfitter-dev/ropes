import type { Adapter, FileOutcome, StepOutcome } from "../adapters/adapter.ts";
import type { ChangeAt, Conflict } from "../contracts/conflict.ts";
import type { Plan, PlanBatch } from "../contracts/plan.ts";
import { outcomeOf } from "../contracts/result.ts";
import type { Result, StepResult } from "../contracts/result.ts";
import { conflictsAfter, textsOf } from "./conflicts.ts";
import type { Settled } from "./conflicts.ts";
import { enforce } from "./enforcement.ts";
import { compareFacts } from "./facts.ts";
import { noticesFor } from "./notices.ts";
import { probeAdapter, threw, versionProblem } from "./ready.ts";
import type { Readiness } from "./ready.ts";

/**
 * `fix` writes the repository's own files and `doctor` writes the Cinch
 * setup. Each only checks what the other writes. `init` writes what
 * `doctor` does, and is the one run in which an adapter may migrate.
 */
export type RunMode = "check" | "doctor" | "fix" | "init";

/** Whether a batch may write in this mode. */
export const writesIn = (
  mode: RunMode,
  step: { readonly setup?: boolean | undefined; readonly writes: boolean }
): boolean =>
  step.writes &&
  (step.setup === true ? mode === "doctor" || mode === "init" : mode === "fix");

export interface RunOptions {
  readonly mode: RunMode;
  /** Defaults to the platform this process runs on. */
  readonly platform?: string;
  /**
   * How to show one step's change to a file. A `fix` run that is given it
   * looks for steps that undo each other.
   */
  readonly changeAt?: ChangeAt;
}

const incomplete = (reason: string): StepOutcome => ({
  findings: [],
  reason,
  status: "incomplete",
});

/** Probes each adapter at most once per run, however many steps use it. */
const readiness = (
  adapters: readonly Adapter[],
  platform: string,
  root: string
) => {
  const byId = new Map(
    adapters.map((adapter) => [adapter.descriptor.id, adapter])
  );
  const probes = new Map<string, Promise<Readiness>>();
  return (id: string) => {
    const adapter = byId.get(id);
    if (adapter && !probes.has(id)) {
      probes.set(id, probeAdapter(adapter, platform, root));
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
    versionProblem(
      batch.tool,
      found?.version,
      batch.versionRange,
      batch.tolerates
    );
  if (reason !== undefined) {
    return all(reason);
  }
  const input = {
    ...(mode === "init" ? { migrate: true } : {}),
    package: batch.package,
    paths: batch.paths,
    root,
    ...(batch.rules === undefined ? {} : { rules: batch.rules }),
  };
  try {
    return answered(
      batch,
      writesIn(mode, batch)
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
 * every file of its batch incomplete, never passed. When the plan names
 * shared facts, it then compares what the tools resolve for them.
 */
export const runPlan = async (
  plan: Plan,
  adapters: readonly Adapter[],
  options: RunOptions
): Promise<Result> => {
  const ready = readiness(
    adapters,
    options.platform ?? process.platform,
    plan.root
  );
  const byPath = new Map<string, StepResult[]>();
  const { changeAt, mode } = options;
  const settled: Settled[] = [];
  const conflicts: Conflict[] = [];
  const undone: StepResult[] = [];
  for (const batch of plan.batches) {
    const watched =
      mode === "fix" && changeAt !== undefined && writesIn(mode, batch);
    // Batches run in plan order: a later step reads what an earlier one
    // wrote, and a kept config is written before the step that reads it.
    /* eslint-disable no-await-in-loop */
    const held = watched ? await textsOf(plan.root, batch.paths) : undefined;
    const outcomes = await runBatch(ready, batch, plan.root, mode);
    if (held !== undefined && changeAt !== undefined) {
      const found = await conflictsAfter(settled, {
        adapterOf: (id) => ready(id).adapter,
        after: await textsOf(plan.root, batch.paths),
        batch,
        before: held,
        changeAt,
        root: plan.root,
      });
      conflicts.push(...found.conflicts);
      undone.push(...found.steps);
      settled.push({ batch, outcomes });
    }
    /* eslint-enable no-await-in-loop */
    for (const outcome of outcomes) {
      const step = { adapter: batch.adapter, ...outcome };
      const before = byPath.get(outcome.path);
      if (before === undefined) {
        byPath.set(outcome.path, [step]);
      } else {
        before.push(step);
      }
    }
  }
  // Reported file by file, in the order the plan lists them.
  const ran = plan.paths.flatMap((planned) => byPath.get(planned.path) ?? []);
  // Compared last, so a config a step of this run wrote is the one read.
  const compared =
    plan.facts === undefined
      ? []
      : await compareFacts(plan.facts, plan.root, async (id) => {
          const { adapter, probe } = ready(id);
          const found = await probe;
          // Held to the ranges the plan shows, as its file steps are.
          const unfit =
            found?.problem !== undefined ||
            plan.batches.some(
              (batch) =>
                batch.adapter === id &&
                versionProblem(
                  batch.tool,
                  found?.version,
                  batch.versionRange,
                  batch.tolerates
                ) !== undefined
            );
          return unfit ? undefined : adapter;
        });
  const steps = enforce(plan, [...ran, ...undone, ...compared]);
  const notices = await noticesFor(plan, (id) => ready(id).probe);
  return {
    ...(conflicts.length === 0 ? {} : { conflicts }),
    ...(notices.length === 0 ? {} : { notices }),
    outcome: outcomeOf(steps),
    plan,
    schemaVersion: plan.schemaVersion,
    steps,
  };
};
