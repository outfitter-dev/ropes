import { rm } from "node:fs/promises";
import path from "node:path";

import type { Adapter, Inherited } from "../adapters/adapter.ts";
import type { Retired } from "../contracts/init.ts";
import type { Plan } from "../contracts/plan.ts";

/** What the adapters found, before anything was written. */
export interface Old {
  readonly files: readonly string[];
  readonly reasons: readonly string[];
  readonly leftovers: readonly string[];
}

/** The adapters with a step in the plan. One that is switched off has none. */
const planned = (adapters: readonly Adapter[], plan: Plan): Adapter[] => {
  const ids = new Set(
    plan.paths.flatMap((entry) => entry.steps.map((step) => step.adapter))
  );
  return adapters.filter((adapter) => ids.has(adapter.descriptor.id));
};

/**
 * Asks each adapter in the plan for the config of the tool it replaces. This
 * runs before the first write, while the adapters can still see what the new
 * files will be made from.
 */
export const oldConfigs = async (
  adapters: readonly Adapter[],
  plan: Plan,
  root: string
): Promise<Old> => {
  const found = await Promise.all(
    planned(adapters, plan).map(
      async (adapter) => (await adapter.retires?.(root)) ?? null
    )
  );
  const all = found.flatMap((one) => (one === null ? [] : [one]));
  return {
    files: [...new Set(all.flatMap((one) => one.files))],
    leftovers: [...new Set(all.flatMap((one) => one.leftovers))],
    reasons: [...new Set(all.flatMap((one) => one.keep))],
  };
};

/**
 * Why file choices keep the old config in place. `written` is what went into
 * a new Cinch config. With a config already there, nothing was carried.
 */
export const choiceReasons = (
  found: readonly Inherited[],
  written: readonly Inherited[] | null
): string[] =>
  written === null
    ? found.map(
        (one) =>
          `The files ${one.from} chose were not carried over, because a Cinch config is already here. Add them to it by hand.`
      )
    : written.flatMap((one) => one.notes.map((note) => `${one.from}: ${note}`));

const UNFINISHED =
  "The setup did not finish, so nothing was removed. Fix what is reported and run this again.";

/**
 * Decides whether the old files go, and removes them when `apply` is set.
 * They go only when no adapter gave a reason to keep them and the run that
 * wrote the new config ended clean.
 */
export const retire = async (
  old: Old,
  run: {
    readonly root: string;
    readonly clean: boolean;
    readonly apply: boolean;
  }
): Promise<Retired> => {
  const reasons =
    run.clean || old.files.length === 0
      ? old.reasons
      : [UNFINISHED, ...old.reasons];
  const removed = old.files.length > 0 && reasons.length === 0;
  if (removed && run.apply) {
    await Promise.all(
      old.files.map((file) => rm(path.join(run.root, file), { force: true }))
    );
  }
  return {
    files: old.files,
    leftovers: old.leftovers,
    reasons: old.files.length === 0 ? [] : reasons,
    removed,
  };
};
