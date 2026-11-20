import type { FileOutcome, StepInput, StepOutcome } from "./adapter.ts";

/** One file of a step, for an engine that judges each file by itself. */
export interface FileInput {
  readonly root: string;
  readonly path: string;
  /** See `StepInput.migrate`. */
  readonly migrate: boolean;
}

/** The same reason for every file of a step that could not run. */
export const allIncomplete = (
  input: StepInput,
  reason: string
): FileOutcome[] =>
  input.paths.map((path) => ({
    findings: [],
    path,
    reason,
    status: "incomplete",
  }));

/**
 * Runs `one` on each file of a step, in order and one at a time, so a file
 * that is written is settled before the next is read.
 */
export const eachFile = async (
  input: StepInput,
  one: (file: FileInput) => Promise<StepOutcome>
): Promise<FileOutcome[]> => {
  const outcomes: FileOutcome[] = [];
  for (const path of input.paths) {
    // oxlint-disable-next-line no-await-in-loop
    const outcome = await one({
      migrate: input.migrate === true,
      path,
      root: input.root,
    });
    outcomes.push({ ...outcome, path });
  }
  return outcomes;
};
