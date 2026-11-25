import { rm } from "node:fs/promises";
import path from "node:path";

import type { Adapter, Inherited } from "../adapters/adapter.ts";
import type { RopesConfig } from "../contracts/config.ts";
import type { Retired } from "../contracts/init.ts";
import type { Plan } from "../contracts/plan.ts";
import { protectedPathsAt } from "./protected-config.ts";

/** What the adapters found, before anything was written. */
export interface Old {
  readonly files: readonly string[];
  readonly reasons: readonly string[];
  readonly leftovers: readonly string[];
}

/** The paths each adapter has a step on in the plan. */
const planned = (plan: Plan): Map<string, Set<string>> => {
  const paths = new Map<string, Set<string>>();
  for (const entry of plan.paths) {
    for (const step of entry.steps) {
      paths.set(
        step.adapter,
        (paths.get(step.adapter) ?? new Set<string>()).add(entry.path)
      );
    }
  }
  return paths;
};

/**
 * Asks each migration source of an adapter in the plan what it holds. This
 * runs before the first write, while the adapters can still see what the new
 * files will be made from. An adapter that is switched off has no step and is
 * not asked. One whose own file is left out of the run cannot carry anything
 * into it, and that is a reason to keep the old files.
 */
export const oldConfigs = async (
  adapters: readonly Adapter[],
  plan: Plan,
  root: string,
  config?: RopesConfig
): Promise<Old> => {
  const paths = planned(plan);
  const asked = adapters.flatMap((adapter) =>
    (adapter.migrates ?? []).map((source) => ({
      mine: paths.get(adapter.descriptor.id),
      source,
    }))
  );
  const found = await Promise.all(
    asked.map(async ({ mine, source }) => {
      const old = mine === undefined ? null : await source.retires?.(root);
      if (mine === undefined || old === null || old === undefined) {
        return null;
      }
      const missing = old.needs.filter((need) => !mine.has(need));
      return missing.length === 0 || old.files.length === 0
        ? old
        : {
            ...old,
            keep: [
              `${missing.join(", ")} is left out of this setup, so nothing was carried over from ${old.files.join(", ")}. Take it out of \`exclude\` and any override that switches it off, or move the settings by hand.`,
              ...old.keep,
            ],
          };
    })
  );
  const all = found.flatMap((one) => (one === null ? [] : [one]));
  const physicalProtection =
    config === undefined
      ? undefined
      : await protectedPathsAt(
          root,
          config,
          all.flatMap((one) => one.files)
        );
  const protectedFiles = new Set([
    ...(physicalProtection?.keys() ?? []),
    ...plan.paths
      .filter((entry) => entry.protected !== undefined)
      .map((entry) => entry.path),
    ...(config?.delegates ?? []).flatMap((delegate) => delegate.config ?? []),
  ]);
  return {
    files: [...new Set(all.flatMap((one) => one.files))].filter(
      (file) => !protectedFiles.has(file)
    ),
    leftovers: [...new Set(all.flatMap((one) => one.leftovers))],
    reasons: [...new Set(all.flatMap((one) => one.keep))],
  };
};

const choseFiles = (one: Inherited): boolean =>
  one.include.length + one.exclude.length + one.notes.length > 0;

/**
 * Why file choices keep the old config in place. `written` is what went into
 * a new Ropes config. With a config already there, nothing was carried.
 */
export const choiceReasons = (
  found: readonly Inherited[],
  written: readonly Inherited[] | null
): string[] =>
  written === null
    ? found
        .filter(choseFiles)
        .map(
          (one) =>
            `The files ${one.from} chose were not carried over, because a Ropes config is already here. Add them to it by hand.`
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
