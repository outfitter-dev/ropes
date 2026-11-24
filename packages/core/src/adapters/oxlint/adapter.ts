import type {
  Adapter,
  AdapterDescriptor,
  FileOutcome,
  ProbeResult,
  StepInput,
} from "../adapter.ts";
import { markFixed } from "../changed.ts";
import { exec } from "../exec.ts";
import { heldTo } from "../pins.ts";
import { fixBatch, locate, runBatch } from "./run.ts";

const ID = "oxlint";

/**
 * What applies when the repository does not pin the linter where Ropes
 * reads pins. The report mapping was checked against 1.93.0.
 */
export const SUPPORTED_RANGE = ">=1.93.0 <2.0.0";

export interface OxlintOptions {
  /** The exact version the repository pins, when it pins one. */
  readonly version?: string | undefined;
  /** The executable to look up. */
  readonly command?: string;
}

const VERSION = /\d+\.\d+\.\d+/u;

/**
 * Lint for TypeScript and JavaScript through Oxlint. It runs from the
 * repository root, once for the files of a batch, and reads its own config
 * there, type-aware rules included. Ropes does not install it: the package
 * must be installed in the repository, or the binary be on `PATH`, or its
 * steps are incomplete. It is off until the Ropes config asks for it.
 */
export const oxlintAdapter = (options: OxlintOptions = {}): Adapter => {
  const command = options.command ?? ID;
  const descriptor: AdapterDescriptor = {
    ...heldTo(options.version, SUPPORTED_RANGE),
    enabledBy: "lint.enabled",
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    id: ID,
    optIn: true,
    platforms: ["darwin", "linux", "win32"],
    tool: ID,
    unit: "file",
    writes: true,
  };
  const probe = async (root?: string): Promise<ProbeResult> => {
    const binary = locate(command, root);
    if (binary === null) {
      return {
        available: false,
        reason: `${command} is not installed in the repository or on PATH`,
      };
    }
    const { exitCode, stdout } = await exec([binary, "--version"]);
    const version = VERSION.exec(stdout)?.[0];
    return exitCode === 0 && version !== undefined
      ? { available: true, version }
      : { available: false, reason: `${command} --version did not answer` };
  };
  const fix = (input: StepInput): Promise<FileOutcome[]> =>
    markFixed(input, () => fixBatch(command, input));
  return {
    check: (input) => runBatch(command, input, []),
    descriptor,
    fix,
    probe,
  };
};
