import { resolveLocalCli } from "@ropes/core";

import manifest from "../package.json" with { type: "json" };

const MARKER = "ROPES_DELEGATED_ENTRY";

/** Returns a delegated exit code, or lets the selected CLI handle its arguments. */
export const delegate = async (
  argv: readonly string[]
): Promise<number | null> => {
  if (manifest.dependencies["@ropes/core"] === "workspace:*") {
    return null;
  }
  const resolved = await resolveLocalCli({
    cwd: process.cwd(),
    entry: `${import.meta.dir}/cli.ts`,
    name: manifest.name,
    protocol: manifest.ropesLauncher,
  });
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }
  const { current: entry, selected } = resolved.value;
  const previous = process.env[MARKER];
  if (previous !== undefined) {
    if (previous !== entry || selected !== entry) {
      throw new Error(
        "Recursive rope delegation detected. Reinstall the repository-pinned @ropes/cli dependency."
      );
    }
    return null;
  }
  if (selected === entry) {
    return null;
  }
  const child = Bun.spawn([process.execPath, selected, ...argv], {
    env: { ...process.env, [MARKER]: selected },
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  return await child.exited;
};
