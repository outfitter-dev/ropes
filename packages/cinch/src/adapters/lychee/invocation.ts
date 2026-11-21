import { devNull } from "node:os";

import type { StepInput } from "../adapter.ts";

/** Escape glob syntax without changing the source name returned by Lychee. */
export const literalSource = (file: string): string =>
  file.replaceAll(/[[\]*?{}]/gu, (character) => {
    if (character === "[") {
      return "[[]";
    }
    return character === "]" ? "[]]" : `[${character}]`;
  });

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
    ...input.paths.map(literalSource),
  ],
  cwd: input.root,
  env: { RUST_LOG: "warn" },
});
