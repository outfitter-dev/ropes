import { loadConfig } from "../config/load.ts";
import type { FixReport } from "../contracts/fix.ts";
import type { Plan } from "../contracts/plan.ts";
import type { PresetResponse } from "../contracts/preset.ts";
import { RelocateActionSchema } from "../contracts/relocate.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import type { ExitCode } from "../contracts/result.ts";
import { renderPresetResponse } from "../render/preset-operation.ts";
import type { Command, Operation } from "./command.ts";
import { runWrite } from "./fix.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";
import { describeGap, gapsOf } from "./preset-gaps.ts";
import { listPresets } from "./preset-list.ts";
import type { PresetRequest } from "./preset-operation.ts";
import { presetOptionProblem } from "./preset-options.ts";
import { locate, pick } from "./presets.ts";
import type { Preset } from "./presets.ts";
import { runRelocate } from "./relocate.ts";

const ACTIONS = new Set(["list", "add", "update"]);

const unusable = (error: string): Operation<PresetResponse> => ({
  error,
  ok: false,
});

const filesOf = (presets: readonly Preset[]): string[] =>
  presets.flatMap((preset) => preset.files);

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
  request: PresetRequest,
  deps: CommandDeps,
  root: string,
  picked: { readonly presets: readonly Preset[]; readonly named: boolean }
): Promise<Operation<PresetResponse>> => {
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
    return unusable(ran.error);
  }
  return {
    ok: true,
    value: { exitCode: exitOf(ran.value), kind: "write", report: ran.value },
  };
};

/**
 * `cinch preset` lists the shared configs Cinch keeps in a repository.
 * `add <name>` and `update [name]` write them. Both go through the same
 * plan as `doctor --fix`, with the preset's own files as the selection.
 * `adopt <name>` and `eject <name>` move a tool's settings into the Cinch
 * config and back out.
 */
export const runPreset = async (
  request: PresetRequest,
  deps: CommandDeps,
  command: "cinch" | "rope" = "cinch"
): Promise<Operation<PresetResponse>> => {
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
      `name the preset to add. Run \`${command} preset\` to see them.`
    );
  }
  if (moves.success && names.length !== 1) {
    return unusable(
      `name one preset to ${action}. Run \`${command} preset\` to see them.`
    );
  }
  const among = moves.success ? located.movables : located.presets;
  const picked = pick(
    among,
    action === "list" && command === "cinch" ? [] : names
  );
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
    const moved = await runRelocate(
      request,
      deps,
      root,
      {
        action: moves.data,
        preset: only,
      },
      command
    );
    return moved.ok
      ? {
          ok: true,
          value: {
            exitCode: EXIT_CODE[moved.value.outcome],
            kind: "move",
            report: moved.value.report,
          },
        }
      : moved;
  }
  return await (action === "list"
    ? listPresets(deps, root, picked.presets)
    : write(request, deps, root, {
        named: names.length > 0,
        presets: picked.presets,
      }));
};

export const preset =
  (deps: CommandDeps): Command =>
  async (request) => {
    const ran = await runPreset(request, deps);
    return ran.ok
      ? {
          exitCode: ran.value.exitCode,
          output: renderPresetResponse(ran.value, request.json),
        }
      : { error: `cinch: ${ran.error}`, exitCode: EXIT_CODE.incomplete };
  };

export const runRopesPreset = async (
  request: PresetRequest,
  deps: CommandDeps
): Promise<Operation<PresetResponse>> => {
  const problem = presetOptionProblem(request);
  if (problem !== undefined) {
    return unusable(problem);
  }
  const located = await locate(request.cwd, deps);
  if (!located.ok) {
    return unusable(located.error);
  }
  const config = await loadConfig(located.root.root);
  if (!config.ok) {
    return await runPreset(request, deps, "rope");
  }
  if (config.value.file === null) {
    return unusable(
      "Run `rope init` to preview repository setup before managing presets."
    );
  }
  return await runPreset(request, deps, "rope");
};
