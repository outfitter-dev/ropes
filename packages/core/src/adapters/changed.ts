import path from "node:path";

import type { FileOutcome, StepInput } from "./adapter.ts";

/**
 * What a file holds, for telling whether a fix changed it. Null when it is
 * missing or cannot be read: the engine then says so for that one file, and
 * the other files of the batch are still fixed.
 */
const textOf = async (file: string): Promise<string | null> => {
  try {
    const handle = Bun.file(file);
    return (await handle.exists()) ? await handle.text() : null;
  } catch {
    return null;
  }
};

/**
 * Runs a fix and marks as fixed each file that passed and whose text the
 * run changed.
 */
export const markFixed = async (
  input: StepInput,
  run: () => Promise<FileOutcome[]>
): Promise<FileOutcome[]> => {
  const read = () =>
    Promise.all(input.paths.map((file) => textOf(path.join(input.root, file))));
  const before = await read();
  const outcomes = await run();
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
