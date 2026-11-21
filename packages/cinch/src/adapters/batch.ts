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
    // eslint-disable-next-line no-await-in-loop
    const outcome = await one({
      migrate: input.migrate === true,
      path,
      root: input.root,
    });
    outcomes.push({ ...outcome, path });
  }
  return outcomes;
};

/**
 * How many files one start of an engine is given. A command line has a
 * length limit, and this stays far below it for paths of ordinary length.
 */
const CHUNK = 200;

export const chunkPaths = (paths: readonly string[]): string[][] => {
  const parts: string[][] = [];
  for (let from = 0; from < paths.length; from += CHUNK) {
    parts.push(paths.slice(from, from + CHUNK));
  }
  return parts;
};

/** Each file by itself, one after another. */
const apart = async (
  input: StepInput,
  start: (part: StepInput) => Promise<FileOutcome[]>
): Promise<FileOutcome[]> => {
  const outcomes: FileOutcome[] = [];
  for (const path of input.paths) {
    // eslint-disable-next-line no-await-in-loop
    outcomes.push(...(await start({ ...input, paths: [path] })));
  }
  return outcomes;
};

/**
 * Runs an engine on a step, with one start for every 200 files. When a start
 * of several files could not run at all, each of its files is run by itself,
 * so one file the engine cannot read does not leave the rest unchecked.
 */
export const inChunks = async (
  input: StepInput,
  start: (part: StepInput) => Promise<FileOutcome[]>
): Promise<FileOutcome[]> => {
  const outcomes: FileOutcome[] = [];
  for (const paths of chunkPaths(input.paths)) {
    const part = { ...input, paths };
    // One start at a time: an engine that fixes writes the files it is given.
    // eslint-disable-next-line no-await-in-loop
    const together = await start(part);
    const failed =
      paths.length > 1 &&
      together.every((outcome) => outcome.status === "incomplete");
    // eslint-disable-next-line no-await-in-loop
    outcomes.push(...(failed ? await apart(part, start) : together));
  }
  return outcomes;
};
