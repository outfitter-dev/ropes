import type { Adapter, AdapterDescriptor, StepInput } from "../adapter.ts";
import { allIncomplete } from "../batch.ts";
import { probeOnPath } from "../on-path.ts";
import { heldTo } from "../pins.ts";
import { checkBatch } from "./run.ts";

const ID = "bun-check";
const TOOL = "bun";

/**
 * What applies when the repository does not pin Bun. The output mapping was
 * checked against 1.4.4.
 */
export const SUPPORTED_RANGE = ">=1.4.4 <2.0.0";

export interface BunCheckOptions {
  /** The exact version the repository pins, when it pins one. */
  readonly version?: string | undefined;
  /** The executable to look up on `PATH`. */
  readonly command?: string;
}

/**
 * The type check, through `bun check`. It runs once for the files of a
 * batch and never writes, so `fix` only checks. Ropes does not install Bun:
 * the binary must be on `PATH` at the pinned version, or its steps are
 * incomplete. It is off until the Ropes config asks for it.
 */
export const bunCheckAdapter = (options: BunCheckOptions = {}): Adapter => {
  const command = options.command ?? TOOL;
  const descriptor: AdapterDescriptor = {
    ...heldTo(options.version, SUPPORTED_RANGE),
    enabledBy: "typescript.enabled",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    id: ID,
    optIn: true,
    platforms: ["darwin", "linux", "win32"],
    tool: TOOL,
    unit: "file",
    writes: false,
  };
  const run = (input: StepInput) => {
    const binary = Bun.which(command);
    return binary === null
      ? Promise.resolve(allIncomplete(input, `${command} is not on PATH`))
      : checkBatch(binary, input);
  };
  return {
    check: run,
    descriptor,
    fix: run,
    probe: () => probeOnPath(command),
  };
};
