import { devNull } from "node:os";

import type { StepInput } from "../adapter.ts";

/** One isolated, read-only local check, shared by execution and tracing. */
export const localInvocation = (
  command: string,
  input: StepInput,
  dump = false
) => ({
  argv: [
    command,
    "--config",
    devNull,
    "--offline=true",
    "--cache=false",
    "--include-fragments=anchor-only",
    "--no-progress",
    "--format=json",
    "--scheme=file",
    "--include=^file:",
    "--no-ignore",
    "--hidden",
    ...(dump ? ["--dump"] : []),
    "--",
    ...input.paths,
  ],
  cwd: input.root,
});
