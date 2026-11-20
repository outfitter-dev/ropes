import path from "node:path";

import type {
  Adapter,
  AdapterDescriptor,
  FileOutcome,
  ProbeResult,
  StepInput,
} from "../adapter.ts";
import { exec } from "../exec.ts";
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

const textOf = async (file: string): Promise<string | null> => {
  const handle = Bun.file(file);
  return (await handle.exists()) ? await handle.text() : null;
};

/**
 * Markdown lint through rumdl. rumdl runs from the repository root, once for
 * the files of a batch, and reads its own config there. Cinch does not install it: the binary must be on
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
  const fix = async (input: StepInput): Promise<FileOutcome[]> => {
    const read = () =>
      Promise.all(
        input.paths.map((file) => textOf(path.join(input.root, file)))
      );
    const before = await read();
    const outcomes = await runBatch(command, input, ["--fix"]);
    const after = await read();
    const changed = new Set(
      input.paths.filter((_, index) => after[index] !== before[index])
    );
    return outcomes.map((outcome) =>
      outcome.status === "passed" && changed.has(outcome.path)
        ? { ...outcome, status: "fixed" }
        : outcome
    );
  };
  return {
    check: (input) => runBatch(command, input, []),
    descriptor,
    fix,
    probe,
  };
};
