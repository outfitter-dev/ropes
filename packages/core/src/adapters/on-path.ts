import type { ProbeResult } from "./adapter.ts";
import { exec } from "./exec.ts";

const VERSION = /\d+\.\d+\.\d+/u;

/**
 * Whether a tool Cinch does not install is on `PATH`, and the version it
 * answers `--version` with.
 */
export const probeOnPath = async (command: string): Promise<ProbeResult> => {
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
