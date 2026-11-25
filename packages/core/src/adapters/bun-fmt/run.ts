import path from "node:path";

import type { FileOutcome, StepInput } from "../adapter.ts";
import { allIncomplete, inChunks } from "../batch.ts";
import { exec } from "../exec.ts";
import { linesOf, parseOutput, writeFailures } from "./output.ts";

const NAME = "bun fmt";
const SOURCE = "bun-fmt";

const lastLine = (text: string): string => text.trim().split("\n").at(-1) ?? "";

/**
 * `--no-script` keeps a `fmt` package script from running in its place.
 * Each file is given as `./file`: the formatter reads a name that starts
 * with `!` as files to leave out, and then takes the whole folder. It
 * prints the names without the `./`.
 */
const run = (binary: string, input: StepInput, flags: readonly string[]) =>
  exec(
    [
      binary,
      "fmt",
      "--no-script",
      ...flags,
      "--",
      ...input.paths.map((file) => `./${file}`),
    ],
    input.root
  );

/**
 * One start on some files. The formatter passes over a file an ignore file
 * or its config leaves out, and over one that is missing, and says nothing.
 * So it is first asked which of the files it would format, and a file that
 * is there and that it leaves out is incomplete, not passed. Then it lists
 * the ones that need formatting. It exits 0 when none does, 1 when one does and 2 when a file
 * did not parse.
 */
const start = async (
  binary: string,
  input: StepInput
): Promise<FileOutcome[]> => {
  const listing = await run(binary, input, ["--list-files"]);
  if (listing.exitCode !== 0) {
    const detail = lastLine(listing.stderr) || "no message";
    return allIncomplete(
      input,
      `${NAME} exited ${listing.exitCode} when asked which files it formats: ${detail}`
    );
  }
  const taken = new Set(linesOf(listing.stdout));
  const paths = input.paths.filter((file) => taken.has(file));
  const checked =
    paths.length === 0
      ? { exitCode: 0, stderr: "", stdout: "" }
      : await run(binary, { ...input, paths }, ["--list-different"]);
  const parsed = parseOutput(checked, { paths, source: SOURCE });
  const all = (reason: string): FileOutcome[] => allIncomplete(input, reason);
  if (checked.exitCode < 0 || checked.exitCode > 2) {
    const detail = lastLine(checked.stderr) || "no message";
    return all(`${NAME} exited ${checked.exitCode}: ${detail}`);
  }
  if (!parsed.ok) {
    return all(`${NAME} ran, but ${parsed.message}`);
  }
  const found = [...parsed.files.values()].flat();
  const expected = parsed.stopped
    ? 2
    : Math.min(linesOf(checked.stdout).length, 1);
  if (checked.exitCode !== expected) {
    return all(
      `${NAME} exited ${checked.exitCode} and reported ${found.length} files: ${lastLine(checked.stderr) || "it printed nothing more"}`
    );
  }
  const present = await Promise.all(
    input.paths.map((file) => Bun.file(path.join(input.root, file)).exists())
  );
  return input.paths.map((file, index) => {
    const findings = parsed.files.get(file);
    if (findings !== undefined) {
      return {
        findings,
        path: file,
        status: findings.length > 0 ? "findings" : "passed",
      };
    }
    // Only a file another adapter keeps is planned before it exists. Its
    // keeper reports that it is missing, and there is nothing to format.
    return present[index] === true
      ? {
          findings: [],
          path: file,
          reason: `${NAME} does not format this file: an ignore file or the formatter config leaves it out`,
          status: "incomplete",
        }
      : { findings: [], path: file, status: "passed" };
  });
};

/** Checks a batch, from the repository root, where the config is read. */
export const checkBatch = (
  binary: string,
  input: StepInput
): Promise<FileOutcome[]> => inChunks(input, (part) => start(binary, part));

/**
 * Formats a batch in place, then checks it, so what is reported is what is
 * left. A file that does not parse stops nothing: the others are written.
 * A file the formatter could not write is incomplete, with the reason it
 * gave: the check after it can still read the file, and would call it an
 * ordinary finding.
 */
export const fixBatch = (
  binary: string,
  input: StepInput
): Promise<FileOutcome[]> =>
  inChunks(input, async (part) => {
    const wrote = await run(binary, part, []);
    const unwritten = writeFailures(wrote.stderr);
    const outcomes = await start(binary, part);
    return outcomes.map((outcome) => {
      const reason = unwritten.get(outcome.path);
      return reason === undefined || outcome.status === "incomplete"
        ? outcome
        : {
            findings: [],
            path: outcome.path,
            reason: `${NAME} could not write this file: ${reason}`,
            status: "incomplete",
          };
    });
  });
