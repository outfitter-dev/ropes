import path from "node:path";

import type {
  Adapter,
  AdapterDescriptor,
  ProbeResult,
  StepInput,
  StepOutcome,
} from "../adapter.ts";
import { exec } from "../exec.ts";
import { filesRead, parseOutput } from "./output.ts";

const ID = "taplo";

/**
 * What applies when the repository does not pin Taplo. The output mapping was
 * checked against 0.10.0, and a 0.x minor release may change it.
 */
export const SUPPORTED_RANGE = ">=0.10.0 <0.11.0";

export interface TaploOptions {
  /** The exact version the repository pins, when it pins one. */
  readonly version?: string | undefined;
  /** The executable to look up on `PATH`. */
  readonly command?: string;
}

const VERSION = /\d+\.\d+\.\d+/u;

const incomplete = (reason: string): StepOutcome => ({
  findings: [],
  reason,
  status: "incomplete",
});

const lastLine = (text: string): string => text.trim().split("\n").at(-1) ?? "";

/**
 * Taplo exits 0 when the file is valid and 1 when it is not. It also exits 0
 * when it read no file at all, for one its own config excludes, so a pass
 * counts only when it says it read the file.
 */
const check = async (
  command: string,
  input: StepInput
): Promise<StepOutcome> => {
  // Only a file another adapter keeps is planned before it exists. Its keeper
  // reports that it is missing, and there is no TOML here to be wrong.
  if (!(await Bun.file(path.join(input.root, input.path)).exists())) {
    return { findings: [], status: "passed" };
  }
  const { exitCode, stderr } = await exec(
    [
      Bun.which(command) ?? command,
      "lint",
      "--colors",
      "never",
      "--",
      input.path,
    ],
    input.root
  );
  if (exitCode !== 0 && exitCode !== 1) {
    return incomplete(`${ID} exited ${exitCode}: ${lastLine(stderr)}`);
  }
  if (filesRead(stderr) !== 1) {
    return incomplete(`${ID} did not read the file. Its config may exclude it`);
  }
  const parsed = parseOutput(stderr, { path: input.path, source: ID });
  if (!parsed.ok) {
    return incomplete(`${ID} ran, but ${parsed.message}`);
  }
  if ((exitCode === 1) !== parsed.findings.length > 0) {
    return incomplete(
      `${ID} exited ${exitCode} and reported ${parsed.findings.length} problems: ${lastLine(stderr)}`
    );
  }
  return {
    findings: parsed.findings,
    status: parsed.findings.length > 0 ? "findings" : "passed",
  };
};

/**
 * TOML lint through Taplo: whether a file parses, and whether it fits the
 * schema Taplo's own config gives it. Taplo runs from the repository root and
 * reads its config there. It only checks. Formatting TOML is the formatter's
 * job, so this adapter never writes. Cinch does not install Taplo: the binary
 * must be on `PATH` at the pinned version, or its steps are incomplete.
 */
export const taploAdapter = (options: TaploOptions = {}): Adapter => {
  const command = options.command ?? ID;
  const descriptor: AdapterDescriptor = {
    enabledBy: "toml.enabled",
    extensions: [".toml"],
    id: ID,
    platforms: ["darwin", "linux", "win32"],
    tool: ID,
    unit: "file",
    versionRange: options.version ?? SUPPORTED_RANGE,
    writes: false,
  };
  const probe = async (): Promise<ProbeResult> => {
    const binary = Bun.which(command);
    if (binary === null) {
      return { available: false, reason: `${command} is not on PATH` };
    }
    const { exitCode, stdout } = await exec([binary, "--version"]);
    const version = VERSION.exec(stdout)?.[0];
    return exitCode === 0 && version !== undefined
      ? { available: true, version }
      : { available: false, reason: `${command} --version did not answer` };
  };
  const run = (input: StepInput): Promise<StepOutcome> => check(command, input);
  return { check: run, descriptor, fix: run, probe };
};
