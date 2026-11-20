import path from "node:path";

import type { FixReport } from "../contracts/fix.ts";
import type { Plan } from "../contracts/plan.ts";
import type { PresetFile, PresetReport } from "../contracts/preset.ts";
import { RelocateActionSchema } from "../contracts/relocate.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import type { ExitCode, Outcome, Result } from "../contracts/result.ts";
import { renderFix, renderFixJson } from "../render/fix.ts";
import { renderPresets, renderPresetsJson } from "../render/preset.ts";
import { runPlan } from "../runner/run.ts";
import type { Command, CommandRequest, CommandResponse } from "./command.ts";
import { runWrite } from "./fix.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";
import { describeGap, gapOf, gapsOf } from "./preset-gaps.ts";
import { locate, pick } from "./presets.ts";
import type { Preset } from "./presets.ts";
import { relocate } from "./relocate.ts";

const ACTIONS = new Set(["list", "add", "update"]);

const unusable = (message: string): CommandResponse => ({
  error: `cinch: ${message}`,
  exitCode: EXIT_CODE.incomplete,
});

const filesOf = (presets: readonly Preset[]): string[] =>
  presets.flatMap((preset) => preset.files);

const stateOf = async (
  root: string,
  preset: Preset,
  file: string,
  result: Result
): Promise<PresetFile> => {
  const gap = gapOf(preset, file, result.plan);
  if (gap) {
    return gap.why === "off"
      ? { path: file, state: "off" }
      : { message: describeGap(gap), path: file, state: "blocked" };
  }
  const step = result.steps.find(
    (ran) => ran.adapter === preset.adapter && ran.path === file
  );
  if (!step || step.status === "incomplete") {
    return { message: step?.reason, path: file, state: "unknown" };
  }
  if (step.status !== "findings") {
    return { path: file, state: "current" };
  }
  const [finding] = step.findings;
  if (finding && !finding.fixable) {
    return { message: finding.message, path: file, state: "blocked" };
  }
  const exists = await Bun.file(path.join(root, file)).exists();
  return { path: file, state: exists ? "stale" : "missing" };
};

const OUTCOME: Readonly<Record<PresetFile["state"], Outcome>> = {
  blocked: "findings",
  current: "clean",
  missing: "findings",
  off: "clean",
  stale: "findings",
  unknown: "incomplete",
};

/** Incomplete beats findings, and findings beat clean, as for a result. */
const exitFor = (files: readonly PresetFile[]): ExitCode => {
  const outcomes = new Set(files.map((file) => OUTCOME[file.state]));
  if (outcomes.has("incomplete")) {
    return EXIT_CODE.incomplete;
  }
  return outcomes.has("findings") ? EXIT_CODE.findings : EXIT_CODE.clean;
};

const list = async (
  request: CommandRequest,
  deps: CommandDeps,
  root: string,
  presets: readonly Preset[]
): Promise<CommandResponse> => {
  const prepared = await prepare({ cwd: root, paths: filesOf(presets) }, deps);
  if (!prepared.ok) {
    return unusable(prepared.error);
  }
  const { adapters, plan } = prepared.value;
  const result = await runPlan(plan, adapters, { mode: "check" });
  const described = await Promise.all(
    presets.map(async (preset) => ({
      files: await Promise.all(
        preset.files.map((file) => stateOf(root, preset, file, result))
      ),
      name: preset.name,
    }))
  );
  const report: PresetReport = {
    presets: described,
    schemaVersion: plan.schemaVersion,
  };
  return {
    exitCode: exitFor(described.flatMap((item) => item.files)),
    output: request.json ? renderPresetsJson(report) : renderPresets(report),
  };
};

const exitOf = (report: FixReport): ExitCode =>
  EXIT_CODE[report.result.outcome];

/**
 * The presets a write is for. One the person named is kept whatever its
 * state, so a preset that is off is an error they read. With no name the
 * write is for every preset that is on, and one that is off is passed over,
 * as `doctor --fix` passes over it. When none is on, all are kept, so the
 * error says how to switch one on.
 */
const wanted = (
  presets: readonly Preset[],
  named: boolean,
  plan: Plan
): readonly Preset[] => {
  if (named) {
    return presets;
  }
  const on = presets.filter((item) => {
    const gaps = gapsOf([item], plan);
    return gaps.length === 0 || gaps.some((gap) => gap.why !== "off");
  });
  return on.length === 0 ? presets : on;
};

const write = async (
  request: CommandRequest,
  deps: CommandDeps,
  root: string,
  picked: { readonly presets: readonly Preset[]; readonly named: boolean }
): Promise<CommandResponse> => {
  // Every file is settled before any is written: a preset the config
  // switches off, or a file it leaves out, stops the whole write.
  const prepared = await prepare(
    { cwd: root, paths: filesOf(picked.presets) },
    deps
  );
  if (!prepared.ok) {
    return unusable(prepared.error);
  }
  const presets = wanted(picked.presets, picked.named, prepared.value.plan);
  const paths = filesOf(presets);
  const gaps = gapsOf(presets, prepared.value.plan);
  if (gaps.length > 0) {
    return unusable([...new Set(gaps.map(describeGap))].join("\ncinch: "));
  }
  const ran = await runWrite({ ...request, cwd: root, paths }, deps, {
    mode: "doctor",
  });
  if (!ran.ok) {
    return ran.response;
  }
  return {
    exitCode: exitOf(ran.report),
    output: request.json ? renderFixJson(ran.report) : renderFix(ran.report),
  };
};

/**
 * `cinch preset` lists the shared configs Cinch keeps in a repository.
 * `add <name>` and `update [name]` write them. Both go through the same
 * plan as `doctor --fix`, with the preset's own files as the selection.
 * `adopt <name>` and `eject <name>` move a tool's settings into the Cinch
 * config and back out.
 */
export const preset =
  (deps: CommandDeps): Command =>
  async (request) => {
    const located = await locate(request.cwd, deps);
    if (!located.ok) {
      return unusable(located.error);
    }
    const action = request.action ?? "list";
    const names = request.paths;
    const moves = RelocateActionSchema.safeParse(action);
    if (!moves.success && !ACTIONS.has(action)) {
      return unusable(
        `unknown preset action "${action}". Use list, add, update, adopt or eject.`
      );
    }
    if (action === "add" && names.length === 0) {
      return unusable(
        "name the preset to add. Run `cinch preset` to see them."
      );
    }
    if (moves.success && names.length !== 1) {
      return unusable(
        `name one preset to ${action}. Run \`cinch preset\` to see them.`
      );
    }
    const among = moves.success ? located.movables : located.presets;
    const picked = pick(among, action === "list" ? [] : names);
    if (!picked.ok) {
      const known = among.map((item) => item.name).join(", ");
      return unusable(
        moves.success
          ? `there is nothing named "${picked.unknown}" to ${action}. Cinch can ${action}: ${known}.`
          : `there is no preset named "${picked.unknown}". Cinch ships: ${known}.`
      );
    }
    const { root } = located.root;
    const [only] = picked.presets;
    if (moves.success && only !== undefined) {
      return await relocate(request, deps, root, {
        action: moves.data,
        preset: only,
      });
    }
    return await (action === "list"
      ? list(request, deps, root, picked.presets)
      : write(request, deps, root, {
          named: names.length > 0,
          presets: picked.presets,
        }));
  };
