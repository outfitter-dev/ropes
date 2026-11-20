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
import { REPORTS, readFacts } from "./facts.ts";
import { runBatch } from "./run.ts";

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

/**
 * Markdown lint through rumdl. rumdl runs from the repository root, once for
 * the files of a batch, and reads its own config there. Cinch does not install it: the binary must be on
 * `PATH` at the pinned version, or its steps are incomplete.
 */
export const rumdlAdapter = (options: RumdlOptions = {}): Adapter => {
  const command = options.command ?? ID;
  const descriptor: AdapterDescriptor = {
    ...heldTo(options.version, SUPPORTED_RANGE),
    enabledBy: "markdown.enabled",
    extensions: [".md"],
    id: ID,
    platforms: ["darwin", "linux", "win32"],
    reports: REPORTS,
    tool: ID,
    unit: "file",
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
  const fix = (input: StepInput): Promise<FileOutcome[]> =>
    markFixed(input, () => runBatch(command, input, ["--fix"]));
  return {
    check: (input) => runBatch(command, input, []),
    descriptor,
    facts: (root) => readFacts(command, root),
    fix,
    probe,
  };
};
