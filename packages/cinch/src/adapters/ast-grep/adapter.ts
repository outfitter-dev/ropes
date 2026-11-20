import type { Adapter, AdapterDescriptor, StepInput } from "../adapter.ts";
import { allIncomplete } from "../batch.ts";
import { probeOnPath } from "../on-path.ts";
import { heldTo } from "../pins.ts";
import { scanBatch } from "./run.ts";

const ID = "ast-grep";

/**
 * What applies when the repository does not pin the engine. The output
 * mapping was checked against 0.51.3, and a 0.x minor release may change it.
 */
export const SUPPORTED_RANGE = ">=0.51.3 <0.52.0";

export interface RulesOptions {
  /** The exact version the repository pins, when it pins one. */
  readonly version?: string | undefined;
  /** The executable to look up on `PATH`. */
  readonly command?: string;
}

/**
 * The rules Cinch ships, run through ast-grep: small structural checks that
 * no linter has a rule for. It runs once for the files of a batch and never
 * writes, so `fix` only checks. Cinch does not install the engine: the
 * binary must be on `PATH` at the pinned version, or its steps are
 * incomplete. It is off until the Cinch config asks for it.
 */
export const rulesAdapter = (options: RulesOptions = {}): Adapter => {
  const command = options.command ?? ID;
  const descriptor: AdapterDescriptor = {
    enabledBy: "rules.enabled",
    extensions: [".json"],
    id: ID,
    optIn: true,
    platforms: ["darwin", "linux", "win32"],
    tool: ID,
    unit: "file",
    ...heldTo(options.version, SUPPORTED_RANGE),
    writes: false,
  };
  const run = (input: StepInput) => {
    const binary = Bun.which(command);
    return binary === null
      ? Promise.resolve(allIncomplete(input, `${command} is not on PATH`))
      : scanBatch(binary, ID, input);
  };
  return {
    check: run,
    descriptor,
    fix: run,
    probe: () => probeOnPath(command),
  };
};
