import path from "node:path";

import type {
  Adapter,
  AdapterDescriptor,
  ProbeResult,
  StepInput,
  StepOutcome,
} from "../adapter.ts";
import { eachFile } from "../batch.ts";
import type { FileInput } from "../batch.ts";
import { exec } from "../exec.ts";
import type { Exit } from "../exec.ts";
import { heldTo } from "../pins.ts";
import { configProblem, readOnly, parseOutput, ruleOf } from "./output.ts";
import {
  isMacProxyPanic,
  nativeCommand,
  recoverTaplo,
  WASM_VERSION,
} from "./wasm.ts";

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

const failureExcerpt = (stderr: string): string => {
  const lines = stderr
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "");
  const failure = lines.filter(
    (line) => !/^\s*(?:(?:note|help):|(?:TRACE|DEBUG|INFO)\b)/u.test(line)
  );
  return (
    (failure.length > 0 ? failure : lines)
      .slice(0, 4)
      .join("\n")
      .slice(0, 1000) || "no diagnostic output"
  );
};

/**
 * Taplo exits 0 when the file is valid and 1 when it is not. It also exits 0
 * when it read no file at all, for one its own config excludes, so a pass
 * counts only when it says it read the file.
 */
/**
 * Taplo reads every file argument as a glob, even after `--`. Each glob
 * character goes in a class of its own, so the path names one file only.
 */
const literal = (file: string): string =>
  file.replaceAll(/[*?[\]]/gu, (character) => `[${character}]`);

/**
 * How often Taplo is asked before its silence counts. Taplo 0.10 now and then
 * drops a log line, mostly on a busy machine, though it linted the file: the
 * line that says which files it read, about once in a thousand starts, and
 * the line that names the check that failed, far more often. When its own
 * config excludes the file it exits sooner, and the first of those lines
 * was missing in 42 of 200 starts, so three asks were too few: all three
 * came back silent about once in a hundred runs.
 */
const ASKS = 6;

const lint = (command: string, input: FileInput) =>
  exec(
    [
      command,
      "lint",
      "--colors",
      "never",
      "--",
      literal(path.join(input.root, input.path)),
    ],
    input.root,
    { RUST_LOG: "taplo=info" }
  );

/**
 * Asks again while Taplo ran but left out a line the result depends on: which
 * files it read, or, when it exits 1, which check failed.
 */
const asked = async (
  command: string,
  input: FileInput,
  left = ASKS
): Promise<Exit> => {
  const ran = await lint(command, input);
  const silent =
    (ran.exitCode === 0 || ran.exitCode === 1) &&
    configProblem(ran.stderr) === undefined &&
    (readOnly(ran.stderr, input.path) === undefined ||
      (ran.exitCode === 1 && ruleOf(ran.stderr) === undefined));
  return silent && left > 1 ? await asked(command, input, left - 1) : ran;
};

const check = async (
  command: string,
  input: FileInput
): Promise<StepOutcome> => {
  // Only a file another adapter keeps is planned before it exists. Its keeper
  // reports that it is missing, and there is no TOML here to be wrong.
  if (!(await Bun.file(path.join(input.root, input.path)).exists())) {
    return { findings: [], status: "passed" };
  }
  const ran = await asked(command, input);
  const { exitCode, stderr } = ran;
  if (exitCode !== 0 && exitCode !== 1) {
    const cause = `${ID} exited ${exitCode}: ${failureExcerpt(stderr)}`;
    return isMacProxyPanic(ran)
      ? await recoverTaplo(input.root, input.path, cause)
      : incomplete(cause);
  }
  const problem = configProblem(stderr);
  if (problem !== undefined) {
    return incomplete(`${ID} could not use its own config: ${problem}`);
  }
  const read = readOnly(stderr, input.path);
  if (read === undefined) {
    return incomplete(
      `${ID} did not say which files it read in ${ASKS} starts: ${lastLine(stderr) || "it printed nothing"}`
    );
  }
  if (!read) {
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
    ...heldTo(options.version, SUPPORTED_RANGE),
    enabledBy: "toml.enabled",
    extensions: [".toml"],
    id: ID,
    platforms: ["darwin", "linux", "win32"],
    recovery: {
      package: "@taplo/cli@0.7.0",
      platform: "darwin",
      tool: "Taplo WebAssembly",
      version: WASM_VERSION,
      when: "native Taplo panics in macOS SystemConfiguration proxy discovery",
    },
    tool: ID,
    unit: "file",
    writes: false,
  };
  const probe = async (): Promise<ProbeResult> => {
    const binary = await nativeCommand(command);
    if (binary === null) {
      return { available: false, reason: `${command} is not on PATH` };
    }
    const { exitCode, stdout } = await exec([binary, "--version"]);
    const version = VERSION.exec(stdout)?.[0];
    return exitCode === 0 && version !== undefined
      ? { available: true, version }
      : { available: false, reason: `${command} --version did not answer` };
  };
  // One start for each file: a pass counts only when Taplo says it read
  // that one file, and it does not say which of several it left out.
  const run = async (input: StepInput) => {
    const binary = await nativeCommand(command);
    return await eachFile(input, (file) =>
      binary === null
        ? Promise.resolve(incomplete(`${command} is not on PATH`))
        : check(binary, file)
    );
  };
  return { check: run, descriptor, fix: run, probe };
};
