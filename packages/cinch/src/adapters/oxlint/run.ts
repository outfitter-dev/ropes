import path from "node:path";

import type { FileOutcome, StepInput } from "../adapter.ts";
import { allIncomplete, inChunks } from "../batch.ts";
import { exec } from "../exec.ts";
import { whichLocal } from "../local.ts";
import { parseOutput } from "./output.ts";

const ID = "oxlint";

/**
 * The executable a run starts: the repository's own install first, then the
 * one Cinch itself can see. The probe asks here too, so the version it
 * reports is the version of what runs.
 */
export const locate = (command: string, root?: string): string | null =>
  (root === undefined ? null : whichLocal(command, root)) ??
  whichLocal(command);

const firstLine = (text: string): string => text.trim().split("\n")[0] ?? "";

const byLine = (findings: FileOutcome["findings"]): FileOutcome["findings"] =>
  findings.toSorted((a, b) => a.range.start.line - b.range.start.line);

/**
 * One start on some files that exist. The linter exits 0 when the run
 * passes and 1 when it does not: on an error, or on a warning where the
 * repository's config makes warnings fail. It counts the files it linted, and a count
 * that differs from the number handed in means it left one out without
 * saying which, so none of them can count as passed.
 */
const start = async (
  command: string,
  input: StepInput,
  flags: readonly string[]
): Promise<FileOutcome[]> => {
  const binary = locate(command, input.root);
  if (binary === null) {
    return allIncomplete(input, `${command} could not be found to run`);
  }
  const { exitCode, stderr, stdout } = await exec(
    [binary, "--format", "json", ...flags, "--", ...input.paths],
    input.root
  );
  if (exitCode !== 0 && exitCode !== 1) {
    const detail = firstLine(stderr) || "no message";
    return allIncomplete(input, `${ID} exited ${exitCode}: ${detail}`);
  }
  const parsed = parseOutput(stdout, { paths: input.paths, source: ID });
  if (!parsed.ok) {
    const detail = firstLine(stderr) || firstLine(stdout);
    return allIncomplete(
      input,
      `${ID} ran, but ${parsed.message}${detail === "" ? "" : `: ${detail}`}`
    );
  }
  if (parsed.linted !== input.paths.length) {
    return allIncomplete(
      input,
      `${ID} linted ${parsed.linted} of the ${input.paths.length} files it was given`
    );
  }
  // A config can make warnings fail the run, so exit 1 needs a finding of
  // either kind behind it, and not an error.
  const found = [...parsed.files.values()].some((list) => list.length > 0);
  if (exitCode === 1 && !found) {
    return allIncomplete(input, `${ID} exited 1 without reporting a finding`);
  }
  return input.paths.map((file) => {
    const findings = byLine(parsed.files.get(file) ?? []);
    return {
      findings,
      path: file,
      status: findings.length > 0 ? "findings" : "passed",
    };
  });
};

/**
 * Runs the linter on a batch, from the repository root, where it reads its
 * own config. Only a file another adapter keeps is planned before it exists.
 * Its keeper reports that it is missing, and there is nothing here to lint.
 */
export const runBatch = async (
  command: string,
  input: StepInput,
  flags: readonly string[]
): Promise<FileOutcome[]> => {
  const present = await Promise.all(
    input.paths.map((file) => Bun.file(path.join(input.root, file)).exists())
  );
  const paths = input.paths.filter((_, index) => present[index] === true);
  const ran =
    paths.length === 0
      ? []
      : await inChunks({ ...input, paths }, (part) =>
          start(command, part, flags)
        );
  const byPath = new Map(ran.map((outcome) => [outcome.path, outcome]));
  return input.paths.map(
    (file) => byPath.get(file) ?? { findings: [], path: file, status: "passed" }
  );
};

/**
 * Fixes a batch, then reads what is left from a second run that only
 * checks: a fixing run reports what it saw before it wrote. A file the
 * fixing run could not take stays incomplete, and every other file is
 * checked again, so none keeps a finding the fix already cleared.
 */
export const fixBatch = async (
  command: string,
  input: StepInput
): Promise<FileOutcome[]> => {
  const fixed = await runBatch(command, input, ["--fix"]);
  const stuck = new Map(
    fixed
      .filter((outcome) => outcome.status === "incomplete")
      .map((outcome) => [outcome.path, outcome])
  );
  const paths = input.paths.filter((file) => !stuck.has(file));
  const checked =
    paths.length === 0 ? [] : await runBatch(command, { ...input, paths }, []);
  const byPath = new Map(checked.map((outcome) => [outcome.path, outcome]));
  return input.paths.flatMap(
    (file) => stuck.get(file) ?? byPath.get(file) ?? []
  );
};
