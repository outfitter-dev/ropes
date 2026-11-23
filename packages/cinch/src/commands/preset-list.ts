import path from "node:path";

import type {
  PresetFile,
  PresetReport,
  PresetResponse,
} from "../contracts/preset.ts";
import type { ExitCode, Outcome, Result } from "../contracts/result.ts";
import { EXIT_CODE } from "../contracts/result.ts";
import { runPlan } from "../runner/run.ts";
import type { Operation } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";
import { describeGap, gapOf } from "./preset-gaps.ts";
import type { Preset } from "./presets.ts";

const filesOf = (presets: readonly Preset[]): string[] =>
  presets.flatMap((preset) => preset.files);
const unusable = (error: string): Operation<PresetResponse> => ({
  error,
  ok: false,
});

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

export const listPresets = async (
  deps: CommandDeps,
  root: string,
  presets: readonly Preset[]
): Promise<Operation<PresetResponse>> => {
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
    ok: true,
    value: {
      exitCode: exitFor(described.flatMap((item) => item.files)),
      kind: "list",
      report,
    },
  };
};
