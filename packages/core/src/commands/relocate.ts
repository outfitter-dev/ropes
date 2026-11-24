import path from "node:path";

import type { ConfigText, Relocation } from "../adapters/relocation.ts";
import { ROPES_FILE, loadConfig } from "../config/load.ts";
import { toRootRelative } from "../config/root.ts";
import { SCHEMA_VERSION } from "../contracts/plan.ts";
import type { RelocateAction, RelocateReport } from "../contracts/relocate.ts";
import { outcomeOf } from "../contracts/result.ts";
import type { Outcome } from "../contracts/result.ts";
import { unifiedDiff } from "../render/diff.ts";
import { runPlan } from "../runner/run.ts";
import type { Operation } from "./command.ts";
import { describeConfigError } from "./errors.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";
import { describeGap, gapsOf } from "./preset-gaps.ts";
import type { PresetRequest } from "./preset-operation.ts";
import { ropesPresetAdvice } from "./preset-options.ts";
import type { Preset } from "./presets.ts";
import { STARTER_CONFIG } from "./starter.ts";

const textAt = async (root: string, file: string): Promise<string | null> => {
  const handle = Bun.file(path.join(root, file));
  return (await handle.exists()) ? await handle.text() : null;
};

/** The Ropes config as it is on disk, or the one a new repository gets. */
export const configText = async (
  root: string
): Promise<ConfigText | { readonly error: string }> => {
  const config = await loadConfig(root);
  if (!config.ok) {
    return { error: describeConfigError(config.error) };
  }
  const file = config.value.file ?? ROPES_FILE;
  return {
    file,
    prefix: config.value.prefix ?? "",
    text: (await textAt(root, file)) ?? STARTER_CONFIG,
  };
};

interface Moving {
  readonly action: RelocateAction;
  readonly preset: Preset;
}

/** The move, once the preset is known to be on and to have one. */
const planned = async (
  deps: CommandDeps,
  root: string,
  { action, preset }: Moving
): Promise<Relocation | { readonly error: string }> => {
  const prepared = await prepare({ cwd: root, paths: preset.files }, deps);
  if (!prepared.ok) {
    return { error: prepared.error };
  }
  const keeper = prepared.value.adapters.find(
    (adapter) => adapter.descriptor.id === preset.adapter
  );
  // A file the adapter does not keep yet has no step to be missing. It can
  // still be excluded, and the move would then leave a file Ropes cannot keep.
  const owned = new Set(keeper?.descriptor.owns);
  const gaps = gapsOf([preset], prepared.value.plan).filter(
    (gap) =>
      owned.has(gap.file) ||
      (gap.why === "left-out" && gap.skipped?.reason === "excluded")
  );
  if (gaps.length > 0) {
    return { error: gaps.map(describeGap).join("\ncinch: ") };
  }
  const relocates = keeper?.relocates;
  if (relocates === undefined) {
    return {
      error: `the ${preset.name} preset has no table in the Cinch config, so there is nothing to ${action}.`,
    };
  }
  const config = await configText(root);
  return "error" in config ? config : await relocates[action](root, config);
};

/**
 * Whether the files Ropes keeps for the preset are as they should be. A
 * check that did not run for every file is incomplete, not a finding.
 */
const settled = async (
  deps: CommandDeps,
  root: string,
  preset: Preset
): Promise<Outcome> => {
  const prepared = await prepare({ cwd: root, paths: preset.files }, deps);
  if (!prepared.ok) {
    return "incomplete";
  }
  const { adapters, plan } = prepared.value;
  const result = await runPlan(plan, adapters, { mode: "check" });
  // Another tool may check these files too. Only the keeper's word counts.
  const kept = result.steps.filter((step) => step.adapter === preset.adapter);
  return kept.length === preset.files.length ? outcomeOf(kept) : "incomplete";
};

/** The first file of the move that leads out of the repository, if any. */
export const outside = async (
  root: string,
  files: readonly { readonly path: string }[]
): Promise<string | undefined> => {
  const placed = await Promise.all(
    files.map((file) => toRootRelative(root, root, file.path))
  );
  return files.find((_, index) => placed[index]?.ok !== true)?.path;
};

const UNSETTLED =
  "The Cinch setup is not clean after the move. Run `cinch doctor` to see why.";

const respond = (
  report: RelocateReport,
  outcome: Outcome = "clean"
): Operation<{
  readonly report: RelocateReport;
  readonly outcome: Outcome;
}> => ({
  ok: true,
  value: { outcome, report },
});

/**
 * `rope preset adopt <name>` moves the settings in a tool's own config
 * into the Ropes config, and `eject` moves them back out. Both only show
 * the change, and write it with `--yes`. Every file is settled before any
 * is written.
 */
export const runRelocate = async (
  request: PresetRequest,
  deps: CommandDeps,
  root: string,
  moving: Moving,
  command: "cinch" | "rope" = "cinch"
): Promise<
  Operation<{ readonly report: RelocateReport; readonly outcome: Outcome }>
> => {
  const { action, preset } = moving;
  const moved = await planned(deps, root, moving);
  if ("error" in moved) {
    return { error: moved.error, ok: false };
  }
  const base = {
    action,
    preset: preset.name,
    schemaVersion: SCHEMA_VERSION,
  } as const;
  if (!moved.ok) {
    return respond(
      {
        ...base,
        changed: [],
        diff: "",
        notes: [],
        stopped:
          command === "rope"
            ? moved.reasons.map(ropesPresetAdvice)
            : moved.reasons,
        written: false,
      },
      "findings"
    );
  }
  const beyond = await outside(root, moved.files);
  if (beyond !== undefined) {
    return {
      error: `${beyond} leads outside the repository, so Cinch will not write it.`,
      ok: false,
    };
  }
  const before = await Promise.all(
    moved.files.map((file) => textAt(root, file.path))
  );
  const changes = moved.files.filter(
    (file, index) => before[index] !== file.text
  );
  const diff = moved.files
    .map((file, index) =>
      unifiedDiff(file.path, before[index] ?? "", file.text)
    )
    .join("");
  const written =
    request.yes === true && request.dryRun !== true && changes.length > 0;
  if (written) {
    await Promise.all(
      changes.map((file) => Bun.write(path.join(root, file.path), file.text))
    );
  }
  const outcome = written ? await settled(deps, root, preset) : "clean";
  const clean = outcome === "clean";
  return respond(
    {
      ...base,
      changed: changes.map((file) => file.path),
      diff,
      notes: clean
        ? moved.notes
        : [
            ...moved.notes,
            command === "rope" ? ropesPresetAdvice(UNSETTLED) : UNSETTLED,
          ],
      written,
    },
    outcome
  );
};
