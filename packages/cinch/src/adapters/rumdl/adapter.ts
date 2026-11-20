import path from "node:path";

import type {
  Adapter,
  AdapterDescriptor,
  ProbeResult,
  StepInput,
  StepOutcome,
} from "../adapter.ts";
import { exec } from "../exec.ts";
import { readFences } from "./fences.ts";
import { parseOutput } from "./output.ts";

const ID = "rumdl";

/**
 * What applies when the repository does not pin rumdl. The output mapping was
 * checked against 0.3.5, and a 0.x minor release may change it.
 */
export const SUPPORTED_RANGE = ">=0.3.5 <0.4.0";

export interface RumdlOptions {
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

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";

/**
 * rumdl exits 0 when clean, 1 when findings remain and 2 when it could not
 * run. Anything it could not report on is incomplete, except a fenced block
 * that is not valid code: that block is a finding.
 */
const run = async (
  command: string,
  input: StepInput,
  flags: readonly string[]
): Promise<StepOutcome> => {
  const { exitCode, stderr, stdout } = await exec(
    [
      Bun.which(command) ?? command,
      "check",
      ...flags,
      "--no-cache",
      "--output-format",
      "json",
      "--",
      input.path,
    ],
    input.root
  );
  if (exitCode !== 0 && exitCode !== 1) {
    const detail = firstLine(stderr) || "no message";
    return incomplete(`${ID} exited ${exitCode}: ${detail}`);
  }
  const parsed = parseOutput(stdout, { path: input.path, source: ID });
  if (!parsed.ok) {
    return incomplete(`${ID} ran, but ${parsed.message}`);
  }
  const fences = readFences(stderr, { path: input.path, source: ID });
  if (!fences.ok) {
    return incomplete(`${ID} ran, but ${fences.message}`);
  }
  if (exitCode === 1 && parsed.findings.length === 0) {
    return incomplete(`${ID} exited 1 without reporting a finding`);
  }
  const findings = [...parsed.findings, ...fences.findings].toSorted(
    (a, b) => a.range.start.line - b.range.start.line
  );
  return { findings, status: findings.length > 0 ? "findings" : "passed" };
};

/**
 * Markdown lint through rumdl. rumdl runs from the repository root and reads
 * its own config there. Cinch does not install it: the binary must be on
 * `PATH` at the pinned version, or its steps are incomplete.
 */
export const rumdlAdapter = (options: RumdlOptions = {}): Adapter => {
  const command = options.command ?? ID;
  const descriptor: AdapterDescriptor = {
    enabledBy: "markdown.enabled",
    extensions: [".md"],
    id: ID,
    platforms: ["darwin", "linux", "win32"],
    tool: ID,
    unit: "file",
    versionRange: options.version ?? SUPPORTED_RANGE,
    writes: true,
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
  const fix = async (input: StepInput): Promise<StepOutcome> => {
    const file = Bun.file(path.join(input.root, input.path));
    const before = await file.text();
    const outcome = await run(command, input, ["--fix"]);
    const changed = (await file.text()) !== before;
    return outcome.status === "passed" && changed
      ? { ...outcome, status: "fixed" }
      : outcome;
  };
  return {
    check: (input) => run(command, input, []),
    descriptor,
    fix,
    probe,
  };
};
