import type { Adapter, StepOutcome } from "../src/adapters/adapter.ts";

/** One file of the workspace, as a test names it. */
export interface OneFile {
  readonly root: string;
  readonly path: string;
  /** Runs the step as `init` does. See `StepInput.migrate`. */
  readonly migrate?: boolean;
}

const only = async (
  adapter: Adapter | undefined,
  verb: "check" | "fix",
  file: OneFile
): Promise<StepOutcome> => {
  if (adapter === undefined) {
    throw new Error("no adapter to run");
  }
  const outcomes = await adapter[verb]({
    ...(file.migrate === undefined ? {} : { migrate: file.migrate }),
    package: ".",
    paths: [file.path],
    root: file.root,
  });
  const [first] = outcomes;
  if (
    first === undefined ||
    outcomes.length !== 1 ||
    first.path !== file.path
  ) {
    throw new Error(`expected one outcome for ${file.path}`);
  }
  const { path: _path, ...outcome } = first;
  return outcome;
};

/** Checks one file by itself and gives its outcome without the path. */
export const checkOne = (
  adapter: Adapter | undefined,
  file: OneFile
): Promise<StepOutcome> => only(adapter, "check", file);

/** Fixes one file by itself and gives its outcome without the path. */
export const fixOne = (
  adapter: Adapter | undefined,
  file: OneFile
): Promise<StepOutcome> => only(adapter, "fix", file);
