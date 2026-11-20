import type { FileOutcome, StepInput, StepOutcome } from "../adapter.ts";
import { allIncomplete } from "../batch.ts";
import { exec } from "../exec.ts";
import { readFences } from "./fences.ts";
import type { Fences } from "./fences.ts";
import { parseOutput } from "./output.ts";
import type { Parsed } from "./output.ts";

const ID = "rumdl";

/**
 * How many files one start is given. A command line has a length limit, and
 * this stays far below it for paths of ordinary length.
 */
const CHUNK = 200;

const incomplete = (reason: string): StepOutcome => ({
  findings: [],
  reason,
  status: "incomplete",
});

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";

const outcomeFor = (parsed: Parsed, fences: Fences): StepOutcome => {
  if (!parsed.ok) {
    return incomplete(`${ID} ran, but ${parsed.message}`);
  }
  if (!fences.ok) {
    return incomplete(`${ID} ran, but ${fences.message}`);
  }
  const findings = [...parsed.findings, ...fences.findings].toSorted(
    (a, b) => a.range.start.line - b.range.start.line
  );
  return { findings, status: findings.length > 0 ? "findings" : "passed" };
};

/**
 * One start of rumdl on some files. It exits 0 when clean, 1 when findings
 * remain and 2 when it could not run. The files are the plan's, so rumdl's
 * own exclude patterns are switched off: with them on, it leaves a file out
 * and says nothing, and that file would count as passed.
 */
const start = async (
  command: string,
  input: StepInput,
  flags: readonly string[]
): Promise<FileOutcome[]> => {
  const { exitCode, stderr, stdout } = await exec(
    [
      Bun.which(command) ?? command,
      "check",
      ...flags,
      "--no-cache",
      "--no-exclude",
      "--output-format",
      "json",
      "--",
      ...input.paths,
    ],
    input.root
  );
  if (exitCode !== 0 && exitCode !== 1) {
    const detail = firstLine(stderr) || "no message";
    return allIncomplete(input, `${ID} exited ${exitCode}: ${detail}`);
  }
  const parsed = parseOutput(stdout, { paths: input.paths, source: ID });
  if (!parsed.ok) {
    return allIncomplete(input, `${ID} ran, but ${parsed.message}`);
  }
  const fences = readFences(stderr, { paths: input.paths, source: ID });
  if (!fences.ok) {
    return allIncomplete(input, `${ID} ran, but ${fences.message}`);
  }
  const reported = [...parsed.files.values()].some(
    (file) => !file.ok || file.findings.length > 0
  );
  if (exitCode === 1 && !reported) {
    return allIncomplete(input, `${ID} exited 1 without reporting a finding`);
  }
  return input.paths.map((path) => {
    const mine = parsed.files.get(path);
    const fenced = fences.files.get(path);
    return {
      ...(mine === undefined || fenced === undefined
        ? incomplete(`${ID} gave no answer for this file`)
        : outcomeFor(mine, fenced)),
      path,
    };
  });
};

const chunks = (paths: readonly string[]): string[][] => {
  const parts: string[][] = [];
  for (let from = 0; from < paths.length; from += CHUNK) {
    parts.push(paths.slice(from, from + CHUNK));
  }
  return parts;
};

/** Each file by itself, one after another. */
const apart = async (
  command: string,
  input: StepInput,
  flags: readonly string[]
): Promise<FileOutcome[]> => {
  const outcomes: FileOutcome[] = [];
  for (const path of input.paths) {
    // oxlint-disable-next-line no-await-in-loop
    const one = await start(command, { ...input, paths: [path] }, flags);
    outcomes.push(...one);
  }
  return outcomes;
};

/**
 * Runs rumdl on a batch, with one start for every 200 files. When a start of
 * several files could not run at all, each of its files is run by itself, so
 * one file rumdl cannot read does not leave the rest unchecked.
 */
export const runBatch = async (
  command: string,
  input: StepInput,
  flags: readonly string[]
): Promise<FileOutcome[]> => {
  const outcomes: FileOutcome[] = [];
  for (const paths of chunks(input.paths)) {
    const part = { ...input, paths };
    // One start at a time: with `--fix`, rumdl writes the files it is given.
    // oxlint-disable-next-line no-await-in-loop
    const together = await start(command, part, flags);
    const failed =
      paths.length > 1 &&
      together.every((outcome) => outcome.status === "incomplete");
    // oxlint-disable-next-line no-await-in-loop
    outcomes.push(...(failed ? await apart(command, part, flags) : together));
  }
  return outcomes;
};
